import { DEFAULT_PARAMS, PARAM_RANGES, renderSfx, stats } from "./synth.js";
import { noiseSeed, resolveSound } from "./presets.js";
import { parseTrack, renderTrack } from "./tracker.js";
import { FORMAT, INSTRUMENT_WAVES, PRESETS, SAMPLE_RATE, VOICES, WAVES, type Diagnostic, type SfxBank, type SfxParams, type SoundDef } from "./types.js";

export const SAFE_ID = /^[a-z0-9_-]+$/;

/** Every rendered clip in a bank: variants expand to `<id>_<n>`. */
export interface Clip {
  id: string;
  sound: string;
  variant: number;
  params: SfxParams;
  seed: number;
}

export function clipsOf(id: string, def: SoundDef): Clip[] {
  const n = Math.max(1, Math.min(8, Math.floor(def.variants ?? 1)));
  return Array.from({ length: n }, (_, v) => ({ id: n > 1 ? `${id}_${v}` : id, sound: id, variant: v, params: resolveSound(def, v), seed: noiseSeed(def, v) }));
}

export function bankClips(bank: SfxBank): Clip[] {
  return Object.entries(bank.sounds).flatMap(([id, d]) => clipsOf(id, d));
}

export function renderClip(c: Clip, sampleRate = SAMPLE_RATE): Float32Array {
  return renderSfx(c.params, c.seed, sampleRate);
}

/** Validate the bank structure; returns diagnostics with JSON paths. */
export function validateBank(raw: unknown): { bank: SfxBank | null; errors: Diagnostic[]; warnings: Diagnostic[] } {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const e = (path: string, message: string) => errors.push({ path, message, severity: "error" });
  const w = (path: string, message: string) => warnings.push({ path, message, severity: "warning" });
  if (!raw || typeof raw !== "object") return { bank: null, errors: [{ path: "", message: "bank must be a JSON object", severity: "error" }], warnings };
  const b = raw as Partial<SfxBank>;
  if (b.format !== FORMAT) e("format", `format must be "${FORMAT}"`);
  if (typeof b.name !== "string") e("name", "name is required");
  if (b.sampleRate !== undefined && ![22050, 32000, 44100, 48000].includes(b.sampleRate)) e("sampleRate", "sampleRate must be 22050, 32000, 44100 or 48000");
  const sounds = b.sounds ?? {};
  const tracks = b.tracks ?? {};
  for (const [id, d] of Object.entries(sounds)) {
    const p = `sounds.${id}`;
    if (!SAFE_ID.test(id)) e(p, "sound ids use a-z, 0-9, _ or -");
    if (d.preset && !(PRESETS as readonly string[]).includes(d.preset)) e(`${p}.preset`, `unknown preset "${d.preset}" (${PRESETS.join(", ")})`);
    if (d.voice && !(VOICES as readonly string[]).includes(d.voice)) e(`${p}.voice`, `unknown voice "${d.voice}" (${VOICES.join(", ")})`);
    if (d.voice && d.preset !== "voice") w(`${p}.voice`, 'voice only applies to preset "voice"');
    if (d.variants !== undefined && !(d.variants >= 1 && d.variants <= 8)) e(`${p}.variants`, "variants must be 1..8");
    for (const [k, v] of Object.entries(d.params ?? {})) {
      if (k === "wave") {
        if (!(WAVES as readonly string[]).includes(v as string)) e(`${p}.params.wave`, `wave must be one of ${WAVES.join(", ")}`);
        continue;
      }
      const r = PARAM_RANGES[k as keyof typeof PARAM_RANGES];
      if (!r) e(`${p}.params.${k}`, `unknown parameter "${k}" (${Object.keys(DEFAULT_PARAMS).join(", ")})`);
      else if (typeof v !== "number" || v < r.min || v > r.max) w(`${p}.params.${k}`, `${k} is clamped to ${r.min}..${r.max}`);
    }
    if (!d.preset && !d.params) w(p, "no preset and no params: renders the default beep");
  }
  for (const [id, t] of Object.entries(tracks)) {
    if (!SAFE_ID.test(id)) e(`tracks.${id}`, "track ids use a-z, 0-9, _ or -");
    if (sounds[id]) e(`tracks.${id}`, `"${id}" is both a sound and a track`);
    for (const [iid, inst] of Object.entries(t.instruments ?? {})) {
      if (!(INSTRUMENT_WAVES as readonly string[]).includes(inst.wave)) e(`tracks.${id}.instruments.${iid}.wave`, `wave must be one of ${INSTRUMENT_WAVES.join(", ")}`);
      for (const k of ["attack", "decay", "sustain", "release", "volume"] as const) if (typeof inst[k] !== "number") e(`tracks.${id}.instruments.${iid}.${k}`, `${k} is required (number)`);
    }
    errors.push(...parseTrack(t, id).errors);
  }
  return { bank: errors.length ? null : (b as SfxBank), errors, warnings };
}

export function bankSummary(bank: SfxBank) {
  const sr = bank.sampleRate ?? SAMPLE_RATE;
  return {
    name: bank.name,
    sampleRate: sr,
    sounds: Object.entries(bank.sounds).map(([id, d]) => ({ id, preset: d.preset ?? null, voice: d.voice ?? null, seed: d.seed ?? 1, variants: d.variants ?? 1, note: d.note ?? "" })),
    tracks: Object.entries(bank.tracks).map(([id, t]) => {
      const p = parseTrack(t, id);
      return { id, title: t.title ?? id, bpm: t.bpm, seconds: +p.seconds.toFixed(2), patterns: Object.keys(t.patterns).length, order: t.order, channels: t.channels.map((c) => `${c.name}:${c.instrument}`), loop: t.loop !== false };
    }),
  };
}

export { renderTrack, stats };
