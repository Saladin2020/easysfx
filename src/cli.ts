#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Command } from "commander";
import open from "open";
import { createApp, defaultWebRoot } from "./server/app.js";
import { resolveToken } from "./shared/requestGuard.js";
import { validateBank } from "./shared/bank.js";
import { PRESET_LABELS, VOICE_TABLE, mutate, resolveSound } from "./shared/presets.js";
import { DRUM_KIT } from "./shared/tracker.js";
import { PRESETS, VOICES, type Preset, type Voice } from "./shared/types.js";
import { EXPORT_PRESETS, exportBank, type ExportPreset } from "./lib/export.js";
import { ffmpegPath, renderRef, stats, waveformPng, writeAudio } from "./lib/audio.js";
import { dirs, initWorkspace, listBanks, loadBank, loadConfig, readBankRaw, resolveWorkspace, saveBank, splitRef, workspaceSummary } from "./lib/workspace.js";

const program = new Command();

function workspaceOf(cli?: string): string {
  const v = cli?.trim() || process.env.EASYSFX_HOME?.trim() || process.env.EASYSFX_WORKSPACE?.trim() || process.cwd();
  return resolveWorkspace(v);
}

const fail = (e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
};

program.name("easysfx").description("8-bit sound effects and chiptune loops from code; export for Godot / PixiJS").version("0.1.0");

program
  .command("init")
  .description("Create banks/ exports/ with the Thai village demo bank")
  .option("--force", "Overwrite samples and config")
  .option("--workspace <path>", "Workspace directory")
  .action(async (o: { force?: boolean; workspace?: string }) => {
    const root = await initWorkspace(workspaceOf(o.workspace), { force: o.force });
    console.log(`Initialized Easy SFX workspace at ${root}`);
    console.log("  banks/    <id>.easysfx.json (village: 16 sounds incl. 5 dialogue voices, 3 tracks)");
    console.log("  exports/  Godot / PixiJS / WAV / JSON exports");
  });

program
  .command("info")
  .description("Workspace summary")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { workspace?: string; json?: boolean }) => {
    const s = await workspaceSummary(workspaceOf(o.workspace));
    if (o.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`Easy SFX workspace ${s.root}`);
    console.log(`  default bank ${s.config.bank} · ogg ${s.config.ogg ? "on" : "off"} · ffmpeg ${ffmpegPath() ? "found" : "missing"}`);
    console.log(`  banks: ${s.banks.map((b) => b.id).join(", ") || "(none)"}`);
    if (s.current) {
      console.log(`  sounds: ${s.current.sounds.map((x) => x.id).join(", ")}`);
      console.log(`  tracks: ${s.current.tracks.map((x) => `${x.id} (${x.seconds}s)`).join(", ")}`);
    }
    console.log(`  presets: ${PRESETS.join(", ")} · voices: ${VOICES.join(", ")} · export: ${EXPORT_PRESETS.join(", ")}`);
  });

program
  .command("list")
  .description("List banks, or the sounds + tracks of one bank (--bank)")
  .option("--bank <id>")
  .option("--workspace <path>")
  .option("--json")
  .action(async (o: { bank?: string; workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      if (!o.bank) {
        const list = await listBanks(root);
        if (o.json) return console.log(JSON.stringify(list, null, 2));
        for (const b of list) console.log(`${b.id.padEnd(18)} ${b.sounds} sounds · ${b.tracks} tracks · ${b.errors ? `${b.errors} errors (${b.firstError})` : "ok"}  ${b.name}`);
        if (!list.length) console.log("(no banks — run easysfx init)");
        return;
      }
      const bank = await loadBank(root, o.bank);
      const { bankSummary } = await import("./shared/bank.js");
      const s = bankSummary(bank);
      if (o.json) return console.log(JSON.stringify(s, null, 2));
      for (const x of s.sounds) console.log(`sound  ${x.id.padEnd(16)} ${(x.preset ?? "custom").padEnd(10)} seed ${x.seed}${x.variants > 1 ? ` ×${x.variants}` : ""}${x.voice ? ` voice=${x.voice}` : ""}  ${x.note}`);
      for (const t of s.tracks) console.log(`track  ${t.id.padEnd(16)} ${t.bpm} bpm · ${t.seconds}s · ${t.order.join(" ")} · ${t.channels.join(", ")}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .description("Validate a bank. Exit code 1 when there are errors")
  .argument("<bank>", "bank id or path to a .easysfx.json")
  .option("--workspace <path>")
  .option("--json")
  .action(async (arg: string, o: { workspace?: string; json?: boolean }) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = arg.endsWith(".json") ? JSON.parse(await readFile(arg, "utf8")) : await readBankRaw(workspaceOf(o.workspace), arg);
      const v = validateBank(raw);
      if (o.json) console.log(JSON.stringify({ errors: v.errors, warnings: v.warnings }, null, 2));
      else {
        for (const d of [...v.errors, ...v.warnings]) console.error(`${d.severity}: ${d.path}: ${d.message}`);
        if (v.bank) console.log(`ok  ${Object.keys(v.bank.sounds).length} sounds · ${Object.keys(v.bank.tracks).length} tracks · ${v.warnings.length} warnings`);
      }
      if (v.errors.length) process.exit(1);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("presets")
  .description("Presets, dialogue voices and the drum kit")
  .option("--json")
  .action((o: { json?: boolean }) => {
    if (o.json) return console.log(JSON.stringify({ presets: PRESET_LABELS, voices: VOICE_TABLE, drums: DRUM_KIT }, null, 2));
    for (const p of PRESETS) console.log(`${p.padEnd(10)} ${PRESET_LABELS[p].label} · ${PRESET_LABELS[p].th}`);
    console.log(`voices: ${VOICES.map((v) => `${v} (${VOICE_TABLE[v].th})`).join(", ")}`);
    console.log(`drums: ${Object.entries(DRUM_KIT).map(([k, d]) => `${k}=${d.label}`).join(" ")}`);
  });

program
  .command("render")
  .description("Render a sound or track to .wav / .ogg / .mp3 (and optionally a waveform PNG)")
  .argument("<ref>", "sound or track id (bank:id for another bank)")
  .requiredOption("--out <file>", "out.wav | out.ogg | out.mp3")
  .option("--variant <n>", "One variant of a multi-variant sound (default: all, back to back)")
  .option("--loops <n>", "Repeat a looping track n times", "1")
  .option("--waveform <png>", "Also write a waveform PNG")
  .option("--workspace <path>")
  .action(async (ref: string, o: { out: string; variant?: string; loops: string; waveform?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const cfg = await loadConfig(root);
      const { bank, id } = splitRef(ref, cfg.bank);
      const r = renderRef(await loadBank(root, bank), id, { variant: o.variant !== undefined ? Number(o.variant) : undefined, loops: Number(o.loops) });
      const w = await writeAudio(r, o.out);
      const s = stats(r.samples, r.sampleRate);
      console.log(`wrote ${w.file} · ${s.seconds}s · peak ${s.peak} · rms ${s.rms}`);
      if (o.waveform) {
        await mkdir(path.dirname(path.resolve(o.waveform)), { recursive: true });
        await writeFile(o.waveform, waveformPng(r));
        console.log(`wrote ${o.waveform}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("waveform")
  .description("Waveform PNG of a sound or track")
  .argument("<ref>")
  .requiredOption("--out <png>")
  .option("--width <px>", "", "960")
  .option("--height <px>", "", "300")
  .option("--workspace <path>")
  .action(async (ref: string, o: { out: string; width: string; height: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const { bank, id } = splitRef(ref, (await loadConfig(root)).bank);
      const r = renderRef(await loadBank(root, bank), id);
      await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
      await writeFile(o.out, waveformPng(r, { width: Number(o.width), height: Number(o.height) }));
      console.log(`wrote ${o.out}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("add")
  .description("Add or replace a sound in a bank from a preset + seed (optionally mutated)")
  .argument("<id>", "new sound id")
  .requiredOption("--preset <preset>", PRESETS.join(" | "))
  .option("--seed <n>", "Seed", "1")
  .option("--voice <voice>", VOICES.join(" | "))
  .option("--variants <n>")
  .option("--mutate <amount>", "Bake a mutated copy of the preset params (0..1)")
  .option("--bank <id>")
  .option("--workspace <path>")
  .action(async (id: string, o: { preset: string; seed: string; voice?: string; variants?: string; mutate?: string; bank?: string; workspace?: string }) => {
    try {
      const root = workspaceOf(o.workspace);
      const bankId = o.bank ?? (await loadConfig(root)).bank;
      const raw = (await readBankRaw(root, bankId)) as { sounds: Record<string, unknown> };
      if (!(PRESETS as readonly string[]).includes(o.preset)) throw new Error(`Unknown preset ${o.preset} (${PRESETS.join(", ")})`);
      const def: Record<string, unknown> = { preset: o.preset as Preset, seed: Number(o.seed) };
      if (o.voice) def.voice = o.voice as Voice;
      if (o.variants) def.variants = Number(o.variants);
      if (o.mutate) def.params = mutate(resolveSound(def), Number(o.seed) + 17, Number(o.mutate));
      raw.sounds[id] = def;
      const res = await saveBank(root, bankId, raw);
      if (!res.saved) throw new Error(res.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
      console.log(`added ${id} to ${res.file}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("export")
  .description("Export a bank: godot | pixi | wav | json | all")
  .argument("[bank]")
  .option("--preset <preset>", EXPORT_PRESETS.join(" | "), "all")
  .option("--out <dir>", "Output folder (default exports/<bank>-<preset>)")
  .option("--no-ogg", "WAV only")
  .option("--workspace <path>")
  .option("--json")
  .action(async (bankArg: string | undefined, o: { preset: string; out?: string; ogg: boolean; workspace?: string; json?: boolean }) => {
    try {
      const root = workspaceOf(o.workspace);
      const bank = bankArg ?? (await loadConfig(root)).bank;
      const res = await exportBank(root, { bank, preset: o.preset as ExportPreset, out: o.out, ogg: o.ogg === false ? false : undefined, trustedPaths: true });
      if (o.json) return console.log(JSON.stringify(res, null, 2));
      for (const d of res.dirs) console.log(`exported ${d}`);
      console.log(`  ${res.files.length} files · ogg ${res.ogg ? "yes" : "no"}`);
      res.warnings.forEach((w) => console.log(`  warning: ${w}`));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("serve")
  .description("Web editor + API (default http://127.0.0.1:8828)")
  .option("--port <port>", "Port", "8828")
  .option("--host <host>", "Interface (non-loopback requires the printed token)", "127.0.0.1")
  .option("--dev", "API only; use the Vite UI on :5178")
  .option("--open", "Open the browser")
  .option("--workspace <path>")
  .action(async (o: { port: string; host: string; dev?: boolean; open?: boolean; workspace?: string }) => {
    const root = workspaceOf(o.workspace);
    if (!existsSync(dirs(root).banks)) await initWorkspace(root);
    const token = resolveToken(o.host);
    const app = createApp({ workspaceRoot: root, webRoot: defaultWebRoot(), dev: o.dev, host: o.host, token });
    const port = Number(o.port);
    serve({ fetch: app.fetch, port, hostname: o.host }, () => {
      const url = `http://${o.host === "0.0.0.0" ? "127.0.0.1" : o.host}:${port}/`;
      console.log(`Easy SFX ${o.dev ? "API (dev)" : "editor"} → ${url}`);
      console.log(`Workspace ${root}`);
      if (token) console.log(`Token (needed off-loopback): ${url}?token=${token}`);
      if (o.dev) console.log("Run the UI with: npx vite --config web/vite.config.ts");
      if (o.open) void open(o.dev ? "http://127.0.0.1:5178" : url);
    });
  });

program.parseAsync(process.argv).catch(fail);
