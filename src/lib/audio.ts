import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { clipsOf, renderClip } from "../shared/bank.js";
import { PRESET_LABELS } from "../shared/presets.js";
import { stats } from "../shared/synth.js";
import { renderTrack } from "../shared/tracker.js";
import { SAMPLE_RATE, type SfxBank } from "../shared/types.js";
import { drawWaveform, type Ctx2D } from "../shared/waveform.js";
import { encodeWav } from "../shared/wav.js";
import { registerFonts } from "./assets.js";

export interface Rendered {
  kind: "sound" | "track";
  id: string;
  title: string;
  samples: Float32Array;
  sampleRate: number;
  loop: boolean;
  beatSec?: number;
  variants: number;
}

/** Render a sound (variant n, or all variants back to back with a gap) or a track by id. */
export function renderRef(bank: SfxBank, id: string, opts: { variant?: number; loops?: number } = {}): Rendered {
  const sr = bank.sampleRate ?? SAMPLE_RATE;
  const def = bank.sounds[id];
  if (def) {
    const clips = clipsOf(id, def);
    const pickOne = opts.variant !== undefined;
    const chosen = pickOne ? [clips[Math.min(opts.variant!, clips.length - 1)]!] : clips;
    const gap = Math.round(0.08 * sr);
    const parts = chosen.map((c) => renderClip(c, sr));
    const total = parts.reduce((a, p) => a + p.length, 0) + gap * (parts.length - 1);
    const out = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length + gap;
    }
    const label = def.preset ? PRESET_LABELS[def.preset].label : "custom";
    return { kind: "sound", id, title: `${id} · ${label}${def.voice ? ` (${def.voice})` : ""}`, samples: out, sampleRate: sr, loop: false, variants: clips.length };
  }
  const t = bank.tracks[id];
  if (!t) throw new Error(`No sound or track "${id}" in bank "${bank.name}" (sounds: ${Object.keys(bank.sounds).join(", ")}; tracks: ${Object.keys(bank.tracks).join(", ")})`);
  const r = renderTrack(t, { id, sampleRate: sr, loops: opts.loops });
  if (r.errors.length) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
  return { kind: "track", id, title: t.title ?? id, samples: r.samples, sampleRate: sr, loop: t.loop !== false, beatSec: 60 / t.bpm, variants: 1 };
}

export function wavBytes(r: Rendered): Buffer {
  return Buffer.from(encodeWav(r.samples, r.sampleRate, { loop: r.kind === "track" && r.loop }));
}

let ffmpegChecked: string | null | undefined;
/** ffmpeg binary (EASYSFX_FFMPEG or PATH) or null. */
export function ffmpegPath(): string | null {
  if (ffmpegChecked !== undefined) return ffmpegChecked;
  const bin = process.env.EASYSFX_FFMPEG?.trim() || "ffmpeg";
  const r = spawnSync(bin, ["-hide_banner", "-version"], { encoding: "utf8" });
  ffmpegChecked = r.status === 0 ? bin : null;
  return ffmpegChecked;
}

/** Encode a WAV file to .ogg (Vorbis) or .mp3 with ffmpeg. Deterministic flags; returns false without ffmpeg. */
export function transcode(wavFile: string, outFile: string): boolean {
  const ff = ffmpegPath();
  if (!ff) return false;
  const ogg = outFile.endsWith(".ogg");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", wavFile, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];
  if (ogg) args.push("-c:a", "libvorbis", "-q:a", "5", "-serial_offset", "1");
  else args.push("-c:a", "libmp3lame", "-q:a", "3", "-id3v2_version", "0", "-write_xing", "0");
  args.push(outFile);
  const r = spawnSync(ff, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim().split("\n").at(-1)}`);
  return true;
}

export async function writeAudio(r: Rendered, out: string): Promise<{ file: string; format: string; transcoded: boolean }> {
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const ext = path.extname(out).toLowerCase();
  if (ext === ".wav") {
    await writeFile(out, wavBytes(r));
    return { file: out, format: "wav", transcoded: false };
  }
  if (ext !== ".ogg" && ext !== ".mp3") throw new Error("--out must end in .wav, .ogg or .mp3");
  const tmp = `${out}.tmp.wav`;
  await writeFile(tmp, wavBytes(r));
  try {
    if (!transcode(tmp, out)) throw new Error("ffmpeg not found — write a .wav instead (or set EASYSFX_FFMPEG)");
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(tmp, { force: true });
  }
  return { file: out, format: ext.slice(1), transcoded: true };
}

/** Waveform PNG: 3px pixels, teak palette, title + duration/peak/RMS. */
export function waveformPng(r: Rendered, opts: { width?: number; height?: number; px?: number } = {}): Buffer {
  registerFonts();
  const w = opts.width ?? 960;
  const h = opts.height ?? 300;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const s = stats(r.samples, r.sampleRate);
  drawWaveform(g as unknown as Ctx2D, r.samples, {
    w,
    h,
    px: opts.px ?? 3,
    sampleRate: r.sampleRate,
    title: r.title,
    subtitle: `${s.seconds.toFixed(2)} s · peak ${s.peak.toFixed(2)} · rms ${s.rms.toFixed(2)}${r.variants > 1 ? ` · ${r.variants} variants` : ""}${r.loop ? " · loop" : ""}`,
    beatSec: r.beatSec,
    loop: r.loop,
  });
  return c.toBuffer("image/png");
}

/** Contact sheet: several waveforms stacked (used for the README / demo). */
export function waveformSheet(items: Rendered[], opts: { width?: number; rowHeight?: number } = {}): Buffer {
  registerFonts();
  const w = opts.width ?? 1200;
  const rh = opts.rowHeight ?? 150;
  const c = createCanvas(w, rh * items.length);
  const g = c.getContext("2d");
  items.forEach((r, i) => {
    const s = stats(r.samples, r.sampleRate);
    drawWaveform(g as unknown as Ctx2D, r.samples, { y: i * rh, w, h: rh, px: 3, sampleRate: r.sampleRate, title: r.title, subtitle: `${s.seconds.toFixed(2)} s · peak ${s.peak.toFixed(2)}${r.loop ? " · loop" : ""}`, beatSec: r.beatSec, loop: r.loop });
  });
  return c.toBuffer("image/png");
}

export { stats };
