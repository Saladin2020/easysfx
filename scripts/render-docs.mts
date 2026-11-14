/**
 * README images (and optional demo audio) from the sample bank.
 *   npx tsx scripts/render-docs.mts docs/assets            # PNGs
 *   npx tsx scripts/render-docs.mts out/ --audio            # + preset medley + track renders (.wav/.ogg/.mp3)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bankClips, renderClip } from "../src/shared/bank.js";
import type { SfxBank } from "../src/shared/types.js";
import { renderRef, waveformPng, waveformSheet, writeAudio, type Rendered } from "../src/lib/audio.js";

const out = path.resolve(process.argv[2] ?? "docs/assets");
const audio = process.argv.includes("--audio");
await mkdir(out, { recursive: true });
const bank = JSON.parse(await readFile(new URL("../samples/banks/village.easysfx.json", import.meta.url), "utf8")) as SfxBank;
const sr = bank.sampleRate ?? 44100;

const presetIds = ["coin", "jump", "hit", "hurt", "powerup", "select", "footstep", "door", "explosion", "blip_kid"];
await writeFile(path.join(out, "presets-waveforms.png"), waveformSheet(presetIds.map((id) => renderRef(bank, id)), { width: 1200, rowHeight: 120 }));
await writeFile(path.join(out, "tracks-waveforms.png"), waveformSheet(Object.keys(bank.tracks).map((id) => renderRef(bank, id)), { width: 1200, rowHeight: 170 }));
await writeFile(path.join(out, "village_day-waveform.png"), waveformPng(renderRef(bank, "village_day"), { width: 1200, height: 300 }));
console.log("wrote presets-waveforms.png, tracks-waveforms.png, village_day-waveform.png");

if (audio) {
  // Medley: every one-shot with a gap, then each dialogue voice "typing" ten clusters at 30 cps (every 2nd cluster).
  const gap = Math.round(0.28 * sr);
  const parts: Float32Array[] = [];
  const clips = bankClips(bank);
  for (const c of clips.filter((c) => !c.sound.startsWith("blip_"))) parts.push(renderClip(c, sr), new Float32Array(gap));
  for (const voice of ["blip_kid", "blip_auntie", "blip_monk", "blip_elder", "blip_mid"]) {
    const vs = clips.filter((c) => c.sound === voice);
    const step = Math.round(sr / 15); // 30 cps, blip every 2nd cluster
    const line = new Float32Array(step * 12 + sr / 4);
    for (let i = 0; i < 12; i++) {
      const s = renderClip(vs[(i * 7) % vs.length]!, sr);
      line.set(s.subarray(0, Math.min(s.length, line.length - i * step)), i * step);
    }
    parts.push(line, new Float32Array(gap));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const medley = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    medley.set(p, o);
    o += p.length;
  }
  const m: Rendered = { kind: "sound", id: "preset_medley", title: "Preset medley", samples: medley, sampleRate: sr, loop: false, variants: 1 };
  for (const ext of ["wav", "ogg", "mp3"]) await writeAudio(m, path.join(out, `preset-medley.${ext}`));
  await writeFile(path.join(out, "preset-medley-waveform.png"), waveformPng(m, { width: 1200, height: 260 }));
  for (const id of Object.keys(bank.tracks)) {
    const r = renderRef(bank, id, { loops: 2 });
    for (const ext of ["wav", "ogg", "mp3"]) await writeAudio(r, path.join(out, `${id}-x2.${ext}`));
  }
  console.log("wrote preset-medley.{wav,ogg,mp3} and <track>-x2.{wav,ogg,mp3}");
}
