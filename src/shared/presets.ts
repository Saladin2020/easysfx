import { DEFAULT_PARAMS, normalizeParams, rng } from "./synth.js";
import type { Preset, SfxParams, SoundDef, Voice } from "./types.js";

type R = () => number;
const between = (r: R, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: R, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export const PRESET_LABELS: Record<Preset, { label: string; th: string }> = {
  coin: { label: "Coin / pickup", th: "เก็บเหรียญ" },
  jump: { label: "Jump", th: "กระโดด" },
  hit: { label: "Hit", th: "ตี" },
  hurt: { label: "Hurt", th: "เจ็บ" },
  powerup: { label: "Power-up", th: "เพิ่มพลัง" },
  select: { label: "Menu select", th: "เลือกเมนู" },
  blip: { label: "UI blip", th: "ติ๊ด" },
  footstep: { label: "Footstep", th: "เสียงเท้า" },
  door: { label: "Door creak", th: "ประตูเอี๊ยด" },
  explosion: { label: "Explosion", th: "ระเบิด" },
  rebana: { label: "Rebana frame drum (open stroke)", th: "รือบานา" },
  rammana: { label: "Rammana frame drum (deep stroke)", th: "รำมะนา" },
  voice: { label: "Dialogue blip voice", th: "เสียงพิมพ์บทพูด" },
};

/** Typing-blip voices: base pitch, wave, length and jitter. */
export const VOICE_TABLE: Record<Voice, { freq: number; wave: SfxParams["wave"]; duty: number; len: number; jitter: number; vibrato?: number; th: string }> = {
  mid: { freq: 440, wave: "square", duty: 0.5, len: 0.045, jitter: 2, th: "กลาง" },
  low: { freq: 196, wave: "square", duty: 0.35, len: 0.055, jitter: 1.5, th: "ทุ้ม" },
  high: { freq: 784, wave: "square", duty: 0.25, len: 0.035, jitter: 2.5, th: "แหลม" },
  kid: { freq: 660, wave: "triangle", duty: 0.5, len: 0.04, jitter: 3, th: "เด็ก" },
  elder: { freq: 247, wave: "saw", duty: 0.5, len: 0.06, jitter: 1, vibrato: 0.6, th: "ผู้สูงอายุ" },
  monk: { freq: 165, wave: "triangle", duty: 0.5, len: 0.07, jitter: 0.5, th: "พระ (นุ่ม)" },
  auntie: { freq: 523, wave: "square", duty: 0.4, len: 0.045, jitter: 3.5, vibrato: 0.3, th: "ป้าแม่ค้า" },
  robot: { freq: 330, wave: "square", duty: 0.125, len: 0.04, jitter: 0, th: "หุ่นยนต์" },
};

const GENERATORS: Record<Exclude<Preset, "voice">, (r: R) => Partial<SfxParams>> = {
  coin: (r) => ({
    wave: pick(r, ["square", "square", "saw"] as const),
    duty: between(r, 0.3, 0.6),
    freq: between(r, 820, 1500),
    sustain: between(r, 0.02, 0.07),
    punch: between(r, 0.3, 0.6),
    decay: between(r, 0.12, 0.3),
    arpMult: between(r, 1.25, 1.6),
    arpTime: between(r, 0.035, 0.08),
    volume: 0.45,
  }),
  jump: (r) => ({
    wave: "square",
    duty: between(r, 0.2, 0.55),
    freq: between(r, 240, 420),
    slide: between(r, 1.8, 4),
    sustain: between(r, 0.05, 0.12),
    decay: between(r, 0.1, 0.22),
    highpass: r() < 0.5 ? between(r, 60, 200) : 0,
    volume: 0.42,
  }),
  hit: (r) => {
    const noisy = r() < 0.6;
    return {
      wave: noisy ? "noise" : "saw",
      freq: noisy ? between(r, 600, 2400) : between(r, 180, 520),
      slide: between(r, -7, -3),
      sustain: between(r, 0.01, 0.04),
      punch: between(r, 0.2, 0.6),
      decay: between(r, 0.07, 0.18),
      lowpass: noisy ? between(r, 3000, 9000) : 0,
      volume: 0.5,
    };
  },
  hurt: (r) => ({
    wave: pick(r, ["square", "saw"] as const),
    duty: between(r, 0.15, 0.4),
    freq: between(r, 300, 560),
    slide: between(r, -4.5, -2),
    sustain: between(r, 0.04, 0.09),
    decay: between(r, 0.15, 0.28),
    vibratoDepth: between(r, 0.5, 2),
    vibratoSpeed: between(r, 18, 34),
    crush: between(r, 0.15, 0.4),
    volume: 0.45,
  }),
  powerup: (r) => {
    const rep = r() < 0.5;
    return {
      wave: pick(r, ["square", "triangle", "square"] as const),
      duty: between(r, 0.3, 0.5),
      freq: between(r, 260, 480),
      slide: rep ? between(r, 4, 8) : between(r, 1, 2.2),
      repeat: rep ? between(r, 0.07, 0.12) : 0,
      vibratoDepth: rep ? 0 : between(r, 0.3, 1),
      vibratoSpeed: between(r, 12, 20),
      sustain: between(r, 0.18, 0.32),
      decay: between(r, 0.2, 0.4),
      volume: 0.4,
    };
  },
  select: (r) => ({
    wave: "square",
    duty: between(r, 0.25, 0.5),
    freq: between(r, 880, 1250),
    sustain: between(r, 0.015, 0.03),
    decay: between(r, 0.04, 0.08),
    arpMult: between(r, 1.4, 1.6),
    arpTime: between(r, 0.02, 0.035),
    volume: 0.35,
  }),
  blip: (r) => ({
    wave: pick(r, ["square", "triangle", "sine"] as const),
    duty: between(r, 0.2, 0.5),
    freq: between(r, 600, 1150),
    sustain: between(r, 0.01, 0.03),
    decay: between(r, 0.025, 0.06),
    volume: 0.35,
  }),
  footstep: (r) => ({
    wave: "noise",
    freq: between(r, 300, 900),
    slide: between(r, -3, -1),
    sustain: between(r, 0.004, 0.012),
    punch: between(r, 0.3, 0.6),
    decay: between(r, 0.04, 0.09),
    lowpass: between(r, 1200, 2800),
    highpass: between(r, 60, 160),
    volume: 0.55,
  }),
  door: (r) => ({
    wave: "saw",
    freq: between(r, 130, 210),
    slide: between(r, -0.8, -0.2),
    vibratoDepth: between(r, 2, 4),
    vibratoSpeed: between(r, 22, 38),
    attack: between(r, 0.02, 0.06),
    sustain: between(r, 0.25, 0.45),
    decay: between(r, 0.12, 0.25),
    lowpass: between(r, 1400, 2600),
    highpass: 90,
    volume: 0.38,
  }),
  explosion: (r) => ({
    wave: "noise",
    freq: between(r, 260, 700),
    slide: between(r, -1.6, -0.4),
    punch: between(r, 0.5, 0.85),
    sustain: between(r, 0.12, 0.3),
    decay: between(r, 0.5, 0.95),
    lowpass: between(r, 1600, 4200),
    repeat: r() < 0.3 ? between(r, 0.25, 0.4) : 0,
    volume: 0.6,
  }),
  // Frame drums of the Malay-Muslim south (rebana / kompang family) and the Thai rammana: a skin "dung" that
  // drops in pitch right after the hit. Slaps ("tak" / "pak") are drum-kit tokens t and a in tracks.
  rebana: (r) => ({
    wave: "sine",
    freq: between(r, 170, 240),
    slide: between(r, -5, -3),
    punch: between(r, 0.45, 0.7),
    sustain: between(r, 0.01, 0.03),
    decay: between(r, 0.16, 0.26),
    vibratoDepth: between(r, 0.05, 0.15),
    vibratoSpeed: between(r, 6, 10),
    volume: 0.7,
  }),
  rammana: (r) => ({
    wave: "sine",
    freq: between(r, 85, 125),
    slide: between(r, -3.5, -2),
    punch: between(r, 0.5, 0.8),
    sustain: between(r, 0.02, 0.05),
    decay: between(r, 0.3, 0.45),
    lowpass: between(r, 900, 1600),
    volume: 0.8,
  }),
};

function voiceParams(voice: Voice, r: R, variant: number, variants: number): Partial<SfxParams> {
  const v = VOICE_TABLE[voice];
  // spread variants over ±jitter semitones (deterministic order: low → high), plus a small seeded wobble
  const span = variants > 1 ? (variant / (variants - 1)) * 2 - 1 : 0;
  const st = span * v.jitter + (r() - 0.5) * 0.4;
  return {
    wave: v.wave,
    duty: v.duty,
    freq: v.freq * 2 ** (st / 12),
    attack: 0.002,
    sustain: v.len * 0.55,
    decay: v.len * 0.45,
    slide: voice === "robot" ? 0 : between(r, -0.6, 0.6),
    vibratoDepth: v.vibrato ?? 0,
    vibratoSpeed: v.vibrato ? 28 : 0,
    lowpass: v.wave === "square" ? 5200 : 0,
    volume: 0.3,
  };
}

/** Resolve a sound definition to final params (variant index for voices). */
export function resolveSound(def: SoundDef, variant = 0): SfxParams {
  const seed = def.seed ?? 1;
  const r = rng(seed * 7919 + variant * 104729);
  let base: Partial<SfxParams> = {};
  if (def.preset === "voice") base = voiceParams(def.voice ?? "mid", r, variant, Math.max(1, def.variants ?? 1));
  else if (def.preset) base = GENERATORS[def.preset](r);
  const merged = normalizeParams({ ...DEFAULT_PARAMS, ...base, ...def.params });
  for (const k of Object.keys(merged) as (keyof SfxParams)[]) if (typeof merged[k] === "number") (merged as unknown as Record<string, number>)[k] = round(merged[k] as number);
  return merged;
}

/** Seed used for the noise of a sound (and its variants). */
export const noiseSeed = (def: SoundDef, variant = 0) => (def.seed ?? 1) * 31 + variant;

/** Small random nudge of every numeric param (sfxr "mutate"), deterministic per seed. */
export function mutate(p: SfxParams, seed: number, amount = 0.1): SfxParams {
  const r = rng(seed);
  const out = { ...p };
  for (const k of Object.keys(p) as (keyof SfxParams)[]) {
    const v = p[k];
    if (typeof v !== "number" || k === "volume") continue;
    const span = Math.abs(v) > 1e-6 ? Math.abs(v) : 0.05;
    (out as unknown as Record<string, number>)[k] = round(v + (r() * 2 - 1) * span * amount);
  }
  return normalizeParams(out);
}
