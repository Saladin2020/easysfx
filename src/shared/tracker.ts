import { renderSfx, rng } from "./synth.js";
import { SAMPLE_RATE, type Diagnostic, type Instrument, type SfxParams, type Track } from "./types.js";

const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `C4` → 60, `A4` → 69, `Bb3` → 58. Null when not a note. */
export function noteToMidi(tok: string): number | null {
  const m = NOTE_RE.exec(tok);
  if (!m) return null;
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + SEMI[m[1]!.toUpperCase()]! + acc;
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * Noise-channel drum kit: one-shot sfx params per token. `c`/`p` are the Thai ching/chap cymbals, `g` a small gong.
 * Frame drums of the south: `b` rebana / kompang "bung" (open bass), `t` rebana / kompang "pak" (slap),
 * `m` rammana "tum" (deep), `a` rammana slap.
 */
export const DRUM_KIT: Record<string, { label: string; params: Partial<SfxParams> }> = {
  k: { label: "kick", params: { wave: "sine", freq: 150, slide: -5, punch: 0.6, sustain: 0.02, decay: 0.16, volume: 0.9 } },
  s: { label: "snare", params: { wave: "noise", freq: 2600, slide: -0.5, punch: 0.4, sustain: 0.01, decay: 0.13, highpass: 500, volume: 0.55 } },
  h: { label: "hat", params: { wave: "noise", freq: 9000, sustain: 0.004, decay: 0.035, highpass: 5000, volume: 0.32 } },
  o: { label: "open hat", params: { wave: "noise", freq: 9000, sustain: 0.01, decay: 0.2, highpass: 4500, volume: 0.28 } },
  c: { label: "ching", params: { wave: "square", duty: 0.5, freq: 2960, vibratoDepth: 0.25, vibratoSpeed: 42, sustain: 0.005, punch: 0.4, decay: 0.42, highpass: 1800, volume: 0.22 } },
  p: { label: "chap", params: { wave: "noise", freq: 7000, sustain: 0.006, decay: 0.06, highpass: 2600, lowpass: 9000, volume: 0.3 } },
  g: { label: "gong", params: { wave: "sine", freq: 98, vibratoDepth: 0.12, vibratoSpeed: 4.5, punch: 0.3, sustain: 0.05, decay: 2.2, volume: 0.7 } },
  x: { label: "click", params: { wave: "square", freq: 1800, sustain: 0.002, decay: 0.01, volume: 0.3 } },
  b: { label: "rebana bung", params: { wave: "sine", freq: 210, slide: -4, punch: 0.6, sustain: 0.015, decay: 0.2, volume: 0.75 } },
  t: { label: "rebana pak", params: { wave: "noise", freq: 3400, slide: -0.6, punch: 0.5, sustain: 0.004, decay: 0.07, highpass: 900, lowpass: 7000, volume: 0.5 } },
  m: { label: "rammana tum", params: { wave: "sine", freq: 105, slide: -2.6, punch: 0.65, sustain: 0.03, decay: 0.36, lowpass: 1300, volume: 0.85 } },
  a: { label: "rammana slap", params: { wave: "noise", freq: 2200, slide: -0.8, punch: 0.45, sustain: 0.006, decay: 0.1, highpass: 500, lowpass: 5000, volume: 0.45 } },
};

export interface NoteEvent {
  step: number;
  /** Steps the note is held (until the next note / `-`). */
  len: number;
  midi?: number;
  drums?: string[];
}

export interface ParsedTrack {
  stepSec: number;
  totalSteps: number;
  seconds: number;
  channels: { name: string; instrument: string; volume: number; events: NoteEvent[] }[];
  errors: Diagnostic[];
}

/** Expand the order into per-channel note events and report bad tokens / references. */
export function parseTrack(track: Track, id = "track"): ParsedTrack {
  const errors: Diagnostic[] = [];
  const err = (path: string, message: string) => errors.push({ path: `tracks.${id}.${path}`, message, severity: "error" });
  if (!(track.bpm >= 20 && track.bpm <= 400)) err("bpm", "bpm must be 20..400");
  if (!(track.steps >= 1 && track.steps <= 8)) err("steps", "steps per beat must be 1..8");
  if (!Array.isArray(track.channels) || track.channels.length < 1 || track.channels.length > 4) err("channels", "1–4 channels");
  const chs = (track.channels ?? []).slice(0, 4);
  chs.forEach((c, i) => {
    if (c.instrument !== "drums" && !track.instruments?.[c.instrument]) err(`channels.${i}`, `unknown instrument "${c.instrument}"`);
  });
  const stepSec = 60 / (track.bpm || 120) / (track.steps || 4);
  const out = chs.map((c) => ({ name: c.name, instrument: c.instrument, volume: c.volume ?? 1, events: [] as NoteEvent[] }));
  let cursor = 0;
  for (const [oi, pid] of (track.order ?? []).entries()) {
    const pat = track.patterns?.[pid];
    if (!pat) {
      err(`order.${oi}`, `unknown pattern "${pid}"`);
      continue;
    }
    const rows = chs.map((_, ci) => (pat[ci] ?? "").split(/\s+/).filter((t) => t && t !== "|"));
    const len = Math.max(1, ...rows.map((r) => r.length));
    rows.forEach((toks, ci) => {
      const ch = out[ci]!;
      const drums = chs[ci]!.instrument === "drums";
      toks.forEach((tok, si) => {
        const step = cursor + si;
        const last = ch.events.at(-1);
        const extend = () => {
          if (last && last.midi !== undefined && last.step + last.len === step) last.len++;
        };
        if (tok === ".") return extend();
        if (tok === "-") return;
        if (drums) {
          const hits = tok.split("+");
          const bad = hits.filter((h) => !DRUM_KIT[h]);
          if (bad.length) err(`patterns.${pid}.${ci}`, `step ${si + 1}: unknown drum "${bad.join("+")}" (use ${Object.keys(DRUM_KIT).join(" ")})`);
          ch.events.push({ step, len: 1, drums: hits.filter((h) => DRUM_KIT[h]) });
          return;
        }
        const midi = noteToMidi(tok);
        if (midi === null) err(`patterns.${pid}.${ci}`, `step ${si + 1}: "${tok}" is not a note (C4, D#5, Bb3), "." or "-"`);
        else ch.events.push({ step, len: 1, midi });
      });
    });
    cursor += len;
  }
  if (!track.order?.length) err("order", "order is empty");
  return { stepSec, totalSteps: cursor, seconds: cursor * stepSec, channels: out, errors };
}

const drumCache = new Map<string, Float32Array>();
function drumSamples(tok: string, sampleRate: number): Float32Array {
  const key = `${tok}@${sampleRate}`;
  let s = drumCache.get(key);
  if (!s) {
    s = renderSfx(DRUM_KIT[tok]!.params, 1000 + tok.charCodeAt(0), sampleRate);
    drumCache.set(key, s);
  }
  return s;
}

/** Render one tonal note (held `hold` seconds, then released) into `buf` at `offset`, wrapping when `wrap`. */
function renderNote(buf: Float32Array, offset: number, inst: Instrument, midi: number, hold: number, gain: number, sampleRate: number, seed: number, wrap: boolean) {
  const f0 = midiToHz(midi + 12 * (inst.octave ?? 0));
  const total = hold + inst.release;
  const n = Math.ceil(total * sampleRate);
  const voices = inst.detune ? [0, inst.detune] : [0];
  const partials = inst.partials?.length ? inst.partials : null;
  const pSum = partials ? partials.reduce((a, [, amp]) => a + Math.abs(amp), 0) || 1 : 1;
  const r = rng(seed);
  const lpA = inst.lowpass ? 1 - Math.exp((-2 * Math.PI * inst.lowpass) / sampleRate) : 1;
  let lp = 0;
  // Karplus-Strong state per voice
  const ks = inst.wave === "pluck" && !partials
    ? voices.map((c) => {
        const len = Math.max(2, Math.round(sampleRate / (f0 * 2 ** (c / 1200))));
        const b = new Float32Array(len);
        for (let i = 0; i < len; i++) b[i] = r() * 2 - 1;
        return { b, i: 0 };
      })
    : null;
  const phases = voices.map(() => 0);
  let noiseV = 0;
  const strike = inst.tremolo ? 1 / inst.tremolo : 0;
  let relFrom = -1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // envelope (re-struck every `strike` seconds while held)
    const te = strike && t < hold ? t % strike : t;
    let env: number;
    if (t < hold) env = adsr(inst, te);
    else {
      if (relFrom < 0) relFrom = adsr(inst, strike ? hold % strike : hold);
      env = inst.release > 0 ? relFrom * Math.max(0, 1 - (t - hold) / inst.release) : 0;
    }
    let vib = 1;
    if (inst.vibratoDepth && inst.vibratoSpeed && t >= (inst.vibratoDelay ?? 0)) vib = 2 ** ((inst.vibratoDepth * Math.sin(2 * Math.PI * inst.vibratoSpeed * t)) / 12);
    let v = 0;
    voices.forEach((cents, vi) => {
      const f = f0 * 2 ** (cents / 1200) * vib;
      if (ks) {
        const k = ks[vi]!;
        const a = k.b[k.i]!;
        const b2 = k.b[(k.i + 1) % k.b.length]!;
        k.b[k.i] = 0.5 * (a + b2) * 0.9965;
        k.i = (k.i + 1) % k.b.length;
        v += a;
        return;
      }
      const prev = phases[vi]!;
      phases[vi] = prev + f / sampleRate;
      const fr = phases[vi]! - Math.floor(phases[vi]!);
      if (partials) {
        const ts = strike && t < hold ? te : t;
        for (const [ratio, amp] of partials) v += (Math.sin(2 * Math.PI * phases[vi]! * ratio) * amp * Math.exp(-ts * (ratio - 1) * 0.9)) / pSum;
        return;
      }
      switch (inst.wave) {
        case "square":
          v += fr < (inst.duty ?? 0.5) ? 1 : -1;
          break;
        case "saw":
          v += 2 * fr - 1;
          break;
        case "triangle":
          v += 4 * Math.abs(fr - 0.5) - 1;
          break;
        case "sine":
          v += Math.sin(2 * Math.PI * fr);
          break;
        default:
          if (Math.floor(phases[vi]!) !== Math.floor(prev)) noiseV = r() * 2 - 1;
          v += noiseV;
      }
    });
    v /= voices.length;
    lp += lpA * (v - lp);
    let j = offset + i;
    if (j >= buf.length) {
      if (!wrap) break;
      j %= buf.length;
    }
    buf[j]! += lp * env * inst.volume * gain;
  }
}

function adsr(inst: Instrument, t: number): number {
  if (inst.attack > 0 && t < inst.attack) return t / inst.attack;
  const td = t - inst.attack;
  if (inst.decay > 0 && td < inst.decay) return 1 - (1 - inst.sustain) * (td / inst.decay);
  return inst.sustain;
}

export interface TrackRender {
  samples: Float32Array;
  seconds: number;
  errors: Diagnostic[];
  channels: Float32Array[];
}

/** Render a track (one pass of the order, seamless when `loop`), mixed and soft-clipped. */
export function renderTrack(track: Track, opts: { id?: string; sampleRate?: number; loops?: number; stems?: boolean } = {}): TrackRender {
  const sampleRate = opts.sampleRate ?? SAMPLE_RATE;
  const parsed = parseTrack(track, opts.id);
  if (parsed.errors.length) return { samples: new Float32Array(0), seconds: 0, errors: parsed.errors, channels: [] };
  const loop = track.loop !== false;
  const len = Math.max(1, Math.round(parsed.seconds * sampleRate));
  // non-looping songs keep their release tails
  const tail = loop ? 0 : Math.ceil(2.5 * sampleRate);
  const stems = parsed.channels.map((ch, ci) => {
    const buf = new Float32Array(len + tail);
    ch.events.forEach((ev, ei) => {
      const at = Math.round(ev.step * parsed.stepSec * sampleRate);
      if (ev.drums) {
        for (const d of ev.drums) {
          const s = drumSamples(d, sampleRate);
          for (let i = 0; i < s.length; i++) {
            let j = at + i;
            if (j >= buf.length) {
              if (!loop) break;
              j %= buf.length;
            }
            buf[j]! += s[i]! * ch.volume;
          }
        }
        return;
      }
      const inst = track.instruments![ch.instrument]!;
      renderNote(buf, at, inst, ev.midi!, ev.len * parsed.stepSec, ch.volume, sampleRate, 7 + ci * 1009 + ei, loop);
    });
    return buf;
  });
  const loops = Math.max(1, opts.loops ?? 1);
  const out = new Float32Array((len + tail) * 1 + len * (loops - 1));
  for (let L = 0; L < loops; L++) {
    for (const s of stems) {
      const n = L === loops - 1 ? s.length : len;
      for (let i = 0; i < n; i++) out[L * len + i]! += s[i]!;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * 0.55);
  return { samples: out, seconds: out.length / sampleRate, errors: [], channels: opts.stems ? stems : [] };
}
