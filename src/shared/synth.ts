import { SAMPLE_RATE, type SfxParams } from "./types.js";

/** Deterministic PRNG (mulberry32). Same seed → same numbers on every platform. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_PARAMS: SfxParams = {
  wave: "square",
  duty: 0.5,
  dutySweep: 0,
  attack: 0,
  sustain: 0.08,
  punch: 0,
  decay: 0.15,
  freq: 440,
  slide: 0,
  deltaSlide: 0,
  freqMin: 0,
  vibratoDepth: 0,
  vibratoSpeed: 0,
  arpMult: 1,
  arpTime: 0,
  repeat: 0,
  lowpass: 0,
  highpass: 0,
  crush: 0,
  volume: 0.5,
};

/** Slider ranges for the editor and validation. */
export const PARAM_RANGES: Record<Exclude<keyof SfxParams, "wave">, { min: number; max: number; step: number; label: string }> = {
  duty: { min: 0.02, max: 0.98, step: 0.01, label: "Duty" },
  dutySweep: { min: -2, max: 2, step: 0.01, label: "Duty sweep /s" },
  attack: { min: 0, max: 1, step: 0.005, label: "Attack s" },
  sustain: { min: 0, max: 2, step: 0.005, label: "Sustain s" },
  punch: { min: 0, max: 1, step: 0.01, label: "Punch" },
  decay: { min: 0, max: 3, step: 0.005, label: "Decay s" },
  freq: { min: 20, max: 8000, step: 1, label: "Frequency Hz" },
  slide: { min: -16, max: 16, step: 0.05, label: "Slide oct/s" },
  deltaSlide: { min: -64, max: 64, step: 0.1, label: "Δ slide oct/s²" },
  freqMin: { min: 0, max: 2000, step: 1, label: "Stop below Hz" },
  vibratoDepth: { min: 0, max: 12, step: 0.05, label: "Vibrato st" },
  vibratoSpeed: { min: 0, max: 60, step: 0.1, label: "Vibrato Hz" },
  arpMult: { min: 0.25, max: 4, step: 0.01, label: "Arp ×" },
  arpTime: { min: 0, max: 1, step: 0.005, label: "Arp at s" },
  repeat: { min: 0, max: 1, step: 0.005, label: "Repeat s" },
  lowpass: { min: 0, max: 20000, step: 10, label: "Low-pass Hz" },
  highpass: { min: 0, max: 8000, step: 10, label: "High-pass Hz" },
  crush: { min: 0, max: 1, step: 0.01, label: "Bit crush" },
  volume: { min: 0, max: 1, step: 0.01, label: "Volume" },
};

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Fill in defaults and clamp to the slider ranges. */
export function normalizeParams(p: Partial<SfxParams>): SfxParams {
  const out = { ...DEFAULT_PARAMS, ...p } as SfxParams;
  for (const [k, r] of Object.entries(PARAM_RANGES)) {
    const key = k as keyof typeof PARAM_RANGES;
    const v = Number(out[key]);
    out[key] = Number.isFinite(v) ? clamp(v, r.min, r.max) : DEFAULT_PARAMS[key];
  }
  return out;
}

export function soundLength(p: SfxParams): number {
  return p.attack + p.sustain + p.decay;
}

const OVERSAMPLE = 4;

/**
 * Render one sfxr-style sound to mono float samples in [-1, 1].
 * Deterministic for a given (params, seed): noise comes from the seeded PRNG.
 */
export function renderSfx(input: Partial<SfxParams>, seed = 1, sampleRate = SAMPLE_RATE): Float32Array {
  const p = normalizeParams(input);
  const total = soundLength(p);
  const n = Math.max(1, Math.ceil(total * sampleRate));
  const out = new Float32Array(n);
  const rand = rng(seed);
  const noise = new Float32Array(32);
  const refillNoise = () => {
    for (let i = 0; i < 32; i++) noise[i] = rand() * 2 - 1;
  };
  refillNoise();
  const sr = sampleRate * OVERSAMPLE;
  const dt = 1 / sr;
  let phase = 0;
  let lp = 0;
  let hpIn = 0;
  let hpOut = 0;
  const lpA = p.lowpass > 0 ? 1 - Math.exp((-2 * Math.PI * p.lowpass) / sr) : 1;
  const hpA = p.highpass > 0 ? 1 / (1 + 2 * Math.PI * p.highpass * dt) : 1;
  let stopped = false;
  for (let i = 0; i < n && !stopped; i++) {
    let acc = 0;
    for (let s = 0; s < OVERSAMPLE; s++) {
      const t = (i * OVERSAMPLE + s) * dt;
      const tr = p.repeat > 0 ? t % p.repeat : t;
      let f = p.freq * 2 ** (p.slide * tr + 0.5 * p.deltaSlide * tr * tr);
      if (p.arpMult !== 1 && p.arpTime > 0 && tr >= p.arpTime) f *= p.arpMult;
      if (p.vibratoDepth > 0 && p.vibratoSpeed > 0) f *= 2 ** ((p.vibratoDepth * Math.sin(2 * Math.PI * p.vibratoSpeed * t)) / 12);
      if (p.freqMin > 0 && f < p.freqMin) {
        stopped = true;
        break;
      }
      f = clamp(f, 1, sr / 2);
      const prev = phase;
      phase += f * dt;
      if (Math.floor(phase) !== Math.floor(prev) && p.wave === "noise") refillNoise();
      const fr = phase - Math.floor(phase);
      let v: number;
      switch (p.wave) {
        case "square": {
          const d = clamp(p.duty + p.dutySweep * t, 0.02, 0.98);
          v = fr < d ? 1 : -1;
          break;
        }
        case "saw":
          v = 2 * fr - 1;
          break;
        case "triangle":
          v = 4 * Math.abs(fr - 0.5) - 1;
          break;
        case "sine":
          v = Math.sin(2 * Math.PI * fr);
          break;
        default:
          v = noise[Math.floor(fr * 32)]!;
      }
      lp += lpA * (v - lp);
      v = lp;
      if (p.highpass > 0) {
        hpOut = hpA * (hpOut + v - hpIn);
        hpIn = v;
        v = hpOut;
      }
      acc += v * envelope(p, t);
    }
    let v = (acc / OVERSAMPLE) * p.volume;
    if (p.crush > 0) {
      const levels = 2 ** Math.round(16 - p.crush * 13);
      v = Math.round(v * levels) / levels;
    }
    out[i] = Math.tanh(v);
  }
  return out;
}

function envelope(p: SfxParams, t: number): number {
  if (t < p.attack) return t / p.attack;
  const ts = t - p.attack;
  if (ts < p.sustain) return 1 + p.punch * 2 * (1 - ts / p.sustain);
  const td = ts - p.sustain;
  return p.decay > 0 ? Math.max(0, 1 - td / p.decay) : 0;
}

/** Peak, RMS and duration for reports / tests. */
export function stats(samples: Float32Array, sampleRate = SAMPLE_RATE) {
  let peak = 0;
  let sum = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { seconds: +(samples.length / sampleRate).toFixed(4), samples: samples.length, peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, samples.length)).toFixed(4) };
}
