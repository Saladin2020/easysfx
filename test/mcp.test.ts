import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { access } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, createEasySfxMcp } from "../src/mcp/server.js";
import { createApp } from "../src/server/app.js";
import { readWavInfo } from "../src/shared/wav.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
let client: Client;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
  const server = createEasySfxMcp(root);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(b);
});
afterAll(async () => {
  await client.close();
  await cleanup();
});

const body = (res: unknown) => JSON.parse(((res as { content: Array<{ text: string }> }).content[0]!).text);

describe("MCP server", () => {
  it("lists the seven tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toHaveLength(7);
  });

  it("writes a sound and a track, renders and exports end to end", async () => {
    const info = body(await client.callTool({ name: "workspace_info", arguments: {} }));
    expect(info.current.sounds.map((s: { id: string }) => s.id)).toContain("coin");
    expect(info.trackFormat).toMatch(/ching/);

    const ws = body(await client.callTool({ name: "write_sound", arguments: { id: "laser", preset: "hit", seed: 4, params: { wave: "square", freq: 1400 } } }));
    expect(ws.saved).toBe(true);
    const got = body(await client.callTool({ name: "get_sound", arguments: { id: "laser" } }));
    expect(got.clips[0].params.freq).toBe(1400);

    const bad = body(await client.callTool({ name: "write_track", arguments: { id: "bad", track: { bpm: 120, steps: 4, channels: [{ name: "a", instrument: "drums" }], patterns: { A: ["k zz"] }, order: ["A"] } } }));
    expect(bad.saved).toBe(false);
    expect(bad.errors[0].message).toMatch(/unknown drum "zz"/);
    const good = body(await client.callTool({ name: "write_track", arguments: { id: "jingle", track: { bpm: 120, steps: 4, loop: false, channels: [{ name: "a", instrument: "sq" }], instruments: { sq: { wave: "square", attack: 0, decay: 0.1, sustain: 0.4, release: 0.1, volume: 0.5 } }, patterns: { A: ["C5 E5 G5 C6"] }, order: ["A"] } } }));
    expect(good.saved).toBe(true);
    expect(good.seconds).toBeCloseTo(0.5);

    const r = await client.callTool({ name: "render_audio", arguments: { id: "laser" } });
    const content = r.content as Array<{ type: string; mimeType?: string; text?: string }>;
    expect(content.some((c) => c.type === "image" && c.mimeType === "image/png")).toBe(true);
    const meta = JSON.parse(content[0]!.text!);
    const { readFile } = await import("node:fs/promises");
    expect(readWavInfo(await readFile(meta.file)).sampleRate).toBe(44100);

    const exported = body(await client.callTool({ name: "export_bank", arguments: { preset: "godot" } }));
    for (const d of exported.dirs) await access(d);
    const escape = await client.callTool({ name: "export_bank", arguments: { preset: "json", out: "../../outside" } });
    expect((escape as { isError?: boolean }).isError).toBe(true);
  }, 60_000);
});

describe("HTTP API", () => {
  it("serves banks, validation and WAV render; blocks cross-origin writes", async () => {
    const app = createApp({ workspaceRoot: root, webRoot: "/nonexistent" });
    const h = { host: "127.0.0.1:8828" };
    expect((await app.request("/api/health", { headers: h })).status).toBe(200);
    const b = (await (await app.request("/api/banks/village", { headers: h })).json()) as { errors: unknown[]; summary: { tracks: unknown[] } };
    expect(b.errors).toEqual([]);
    expect(b.summary.tracks.length).toBeGreaterThanOrEqual(3);
    const wav = await app.request("/api/render", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ id: "village", ref: "coin" }) });
    expect(wav.headers.get("content-type")).toBe("audio/wav");
    expect(readWavInfo(new Uint8Array(await wav.arrayBuffer())).channels).toBe(1);
    const cross = await app.request("/api/banks/village", { method: "POST", headers: { ...h, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(cross.status).toBe(403);
    const rebinding = await app.request("/api/banks", { headers: { host: "evil.example:8828" } });
    expect(rebinding.status).toBe(403);
  });
});
