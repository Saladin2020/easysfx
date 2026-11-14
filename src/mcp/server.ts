#!/usr/bin/env node
/**
 * Easy SFX MCP server (stdio by default; optional Streamable HTTP).
 *
 *   npx tsx src/mcp/server.ts
 *   npx tsx src/mcp/server.ts --http --port 8829
 *
 * Env: EASYSFX_WORKSPACE  absolute path to the workspace (default: cwd)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { z } from "zod";
import { checkRequest, resolveToken } from "../shared/requestGuard.js";
import { bankSummary, clipsOf } from "../shared/bank.js";
import { PRESET_LABELS, VOICE_TABLE, mutate, resolveSound } from "../shared/presets.js";
import { DRUM_KIT, parseTrack } from "../shared/tracker.js";
import { PARAM_RANGES } from "../shared/synth.js";
import { INSTRUMENT_WAVES, PRESETS, VOICES, WAVES, type SfxBank } from "../shared/types.js";
import { EXPORT_PRESETS, exportBank } from "../lib/export.js";
import { renderRef, stats, waveformPng, writeAudio } from "../lib/audio.js";
import { dirs, loadConfig, readBankRaw, resolveWorkspace, saveBank, workspaceSummary } from "../lib/workspace.js";

export const MCP_TOOL_NAMES = ["workspace_info", "list_sounds", "get_sound", "write_sound", "write_track", "render_audio", "export_bank"] as const;

const IdSchema = z.string().regex(/^[a-z0-9_-]+$/, "Use a-z, 0-9, _ or -");

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TRACK_CHEATSHEET = `Track: { title, bpm, steps (per beat, 4 = 16ths), loop, channels: [{name, instrument, volume?}] ×1-4,
instruments: { id: { wave: ${INSTRUMENT_WAVES.join("|")}, partials?: [[ratio, amp]], attack, decay, sustain (level), release, volume, duty?, vibratoDepth?, vibratoSpeed?, tremolo? (Hz roll), detune? (cents), octave?, lowpass? } },
patterns: { A: ["C5 . E5 . G5 - …", "<ch2>", "<ch3>", "<drums>"] }, order: ["A","A","B"] }
Steps: note (C4, D#5, Bb3) · "." hold · "-" off · drums channel (instrument "drums"): ${Object.entries(DRUM_KIT).map(([k, d]) => `${k}=${d.label}`).join(" ")}, combine with + (k+c).`;

function parseArgs(argv: string[]) {
  const out = { http: false, port: 8829, host: "127.0.0.1", workspace: process.env.EASYSFX_WORKSPACE ?? process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--http") out.http = true;
    else if (a === "--port") out.port = Number(argv[++i] ?? out.port);
    else if (a === "--host") out.host = argv[++i] ?? out.host;
    else if (a === "--workspace") out.workspace = argv[++i] ?? out.workspace;
  }
  return out;
}

export function createEasySfxMcp(workspaceRoot: string): McpServer {
  const root = resolveWorkspace(workspaceRoot);
  const server = new McpServer({ name: "easysfx", version: "0.1.0" });
  const bankOf = async (b?: string) => b ?? (await loadConfig(root)).bank;

  server.registerTool(
    "workspace_info",
    { title: "Workspace info", description: "Summarize the Easy SFX workspace (banks, default bank sounds + tracks), presets, dialogue voices, drum kit, synth parameter ranges and the tracker format. Call this first.", inputSchema: {} },
    async () => {
      const s = await workspaceSummary(root);
      return text({
        name: "easysfx",
        root: s.root,
        config: s.config,
        banks: s.banks,
        current: s.current,
        presets: PRESET_LABELS,
        voices: Object.fromEntries(Object.entries(VOICE_TABLE).map(([k, v]) => [k, v.th])),
        waves: WAVES,
        params: PARAM_RANGES,
        exportPresets: EXPORT_PRESETS,
        trackFormat: TRACK_CHEATSHEET,
      });
    },
  );

  server.registerTool(
    "list_sounds",
    { title: "List sounds", description: "List the sounds and tracks of a bank (default bank when omitted) with preset, seed, variants and track length.", inputSchema: { bank: IdSchema.optional() } },
    async ({ bank }) => {
      try {
        const id = await bankOf(bank);
        const raw = (await readBankRaw(root, id)) as SfxBank;
        return text({ bank: id, ...bankSummary(raw) });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "get_sound",
    { title: "Get sound", description: "Resolved synth params (per variant) and stats for a sound, or the full definition + parsed length for a track.", inputSchema: { id: IdSchema, bank: IdSchema.optional() } },
    async ({ id, bank }) => {
      try {
        const b = (await readBankRaw(root, await bankOf(bank))) as SfxBank;
        if (b.sounds[id]) {
          const clips = clipsOf(id, b.sounds[id]!);
          const r = renderRef(b, id);
          return text({ kind: "sound", id, def: b.sounds[id], clips: clips.map((c) => ({ id: c.id, params: c.params })), stats: stats(r.samples, r.sampleRate) });
        }
        if (b.tracks[id]) {
          const p = parseTrack(b.tracks[id]!, id);
          return text({ kind: "track", id, def: b.tracks[id], seconds: p.seconds, steps: p.totalSteps, errors: p.errors });
        }
        return err(`No sound or track "${id}"`);
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_sound",
    {
      title: "Write sound",
      description: `Add or replace a sound in a bank: preset + seed (+ voice/variants for dialogue blips), optional param overrides, or mutate to bake a nudged copy. Validates before saving; dryRun only validates. Presets: ${PRESETS.join(", ")}. Voices: ${VOICES.join(", ")}.`,
      inputSchema: {
        id: IdSchema,
        bank: IdSchema.optional(),
        preset: z.enum(PRESETS).optional(),
        seed: z.number().int().min(0).optional(),
        voice: z.enum(VOICES).optional(),
        variants: z.number().int().min(1).max(8).optional(),
        params: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe("Overrides, e.g. {\"freq\": 600, \"wave\": \"triangle\"}"),
        mutate: z.number().min(0).max(1).optional().describe("Bake a mutated copy of the preset params"),
        note: z.string().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ id, bank, preset, seed, voice, variants, params, mutate: mut, note, dryRun }) => {
      try {
        const bid = await bankOf(bank);
        const raw = (await readBankRaw(root, bid)) as SfxBank;
        if (raw.tracks?.[id]) return err(`"${id}" is a track`);
        const def: Record<string, unknown> = {};
        if (preset) def.preset = preset;
        if (seed !== undefined) def.seed = seed;
        if (voice) def.voice = voice;
        if (variants) def.variants = variants;
        if (params) def.params = params;
        if (note) def.note = note;
        if (mut !== undefined) def.params = { ...mutate(resolveSound(def), (seed ?? 1) + 17, mut), ...(params ?? {}) };
        raw.sounds[id] = def;
        const res = await saveBank(root, bid, raw, { dryRun });
        return text({ saved: res.saved, file: res.file, errors: res.errors, warnings: res.warnings, def });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "write_track",
    { title: "Write track", description: `Add or replace a 4-channel chiptune track in a bank. Refuses to save with errors (path + message) unless dryRun to just validate.\n${TRACK_CHEATSHEET}`, inputSchema: { id: IdSchema, bank: IdSchema.optional(), track: z.record(z.string(), z.unknown()).describe("Track object"), dryRun: z.boolean().optional() } },
    async ({ id, bank, track, dryRun }) => {
      try {
        const bid = await bankOf(bank);
        const raw = (await readBankRaw(root, bid)) as SfxBank;
        if (raw.sounds?.[id]) return err(`"${id}" is a sound`);
        raw.tracks[id] = track as unknown as SfxBank["tracks"][string];
        const res = await saveBank(root, bid, raw, { dryRun });
        const p = parseTrack(raw.tracks[id]!, id);
        return text({ saved: res.saved, file: res.file, errors: res.errors, warnings: res.warnings, seconds: +p.seconds.toFixed(2) });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "render_audio",
    {
      title: "Render audio",
      description: "Render a sound or track to exports/renders/<id>.<format> (wav, ogg or mp3; ogg/mp3 need ffmpeg) and return its stats plus a waveform PNG image.",
      inputSchema: { id: IdSchema, bank: IdSchema.optional(), format: z.enum(["wav", "ogg", "mp3"]).optional(), variant: z.number().int().min(0).optional(), loops: z.number().int().min(1).max(8).optional() },
    },
    async ({ id, bank, format, variant, loops }) => {
      try {
        const b = (await readBankRaw(root, await bankOf(bank))) as SfxBank;
        const r = renderRef(b, id, { variant, loops });
        const out = path.join(dirs(root).exports, "renders", `${id}.${format ?? "wav"}`);
        await mkdir(path.dirname(out), { recursive: true });
        await writeAudio(r, out);
        const png = waveformPng(r);
        await writeFile(out.replace(/\.\w+$/, ".png"), png);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ file: out, waveform: out.replace(/\.\w+$/, ".png"), kind: r.kind, ...stats(r.samples, r.sampleRate) }, null, 2) },
            { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  server.registerTool(
    "export_bank",
    { title: "Export bank", description: "Export a bank: godot (Godot 4.3+ project, SfxBank autoload, AudioStreamWAV/.ogg, dialogue_blips.gd), pixi (PixiJS v8 / @pixi/sound manifest + SfxBank helper + demo), wav (WAV/OGG + waveform PNGs), json, or all.", inputSchema: { bank: IdSchema.optional(), preset: z.enum(EXPORT_PRESETS).optional(), out: z.string().optional().describe("Workspace-relative output folder") } },
    async ({ bank, preset, out }) => {
      try {
        const res = await exportBank(root, { bank: await bankOf(bank), preset, out });
        return text({ dirs: res.dirs, files: res.files.length, ogg: res.ogg, warnings: res.warnings });
      } catch (e) {
        return err(msg(e));
      }
    },
  );

  return server;
}

async function startMcp(opts: ReturnType<typeof parseArgs>) {
  const workspace = resolveWorkspace(opts.workspace);
  if (opts.http) return startHttp(workspace, opts.host, opts.port);
  await createEasySfxMcp(workspace).connect(new StdioServerTransport());
}

async function startHttp(workspace: string, host: string, port: number) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const sessions = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();
  const token = resolveToken(host);
  if (token) console.error(`Non-loopback host: send "Authorization: Bearer <token>" — token printed once: ${token}`);
  const httpServer = createServer(async (req, res) => {
    const auth = req.headers.authorization;
    const denied = checkRequest(
      { bindHost: host, token },
      { method: req.method ?? "GET", host: req.headers.host, origin: req.headers.origin, token: auth?.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-easysfx-token"] as string | undefined) },
    );
    if (denied) {
      res.writeHead(denied.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: denied.error }));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "easysfx", transport: "streamable-http", endpoint: `http://${host}:${port}/mcp`, workspace }));
      return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (req.method === "POST") {
        let transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          const mcp = createEasySfxMcp(workspace);
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport!);
            },
          });
          transport.onclose = () => {
            const id = transport!.sessionId;
            if (id) sessions.delete(id);
          };
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sessionId ? sessions.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing mcp-session-id" }));
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg(e) }));
      }
    }
  });
  httpServer.listen(port, host, () => {
    console.error(`Easy SFX MCP (HTTP) http://${host}:${port}/mcp`);
    console.error(`Workspace ${workspace}`);
  });
}

function entryIndex(): number {
  return process.argv.findIndex((arg) => /(?:^|[/\\])mcp[/\\]server\.(?:ts|js|mjs)$/i.test(arg));
}

if (entryIndex() >= 0) {
  await startMcp(parseArgs(process.argv.slice(entryIndex() + 1)));
}
