import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bankClips, renderClip } from "../src/shared/bank.js";
import { mutate, resolveSound } from "../src/shared/presets.js";
import { normalizeParams, renderSfx, rng, stats } from "../src/shared/synth.js";
import { renderTrack } from "../src/shared/tracker.js";
import { PRESETS, VOICES } from "../src/shared/types.js";
import { encodeWav, fnv1a, readWavInfo } from "../src/shared/wav.js";
import { sampleBank } from "./helpers.js";

const GOLDEN = path.join(import.meta.dirname, "golden.json");

describe("synth", () => {
  it("rng is deterministic and seed-dependent", () => {
    const a = rng(42);
    const b = rng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(rng(43)()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it.each(PRESETS.filter((p) => p !== "voice"))("preset %s renders an audible, unclipped, repeatable sound", (preset) => {
    const p = resolveSound({ preset, seed: 5 });
    const a = renderSfx(p, 9);
    const s = stats(a);
    expect(s.peak).toBeGreaterThan(0.05);
    expect(s.peak).toBeLessThanOrEqual(1);
    expect(s.seconds).toBeGreaterThan(0.01);
    expect(s.seconds).toBeLessThan(3);
    expect(fnv1a(encodeWav(renderSfx(p, 9)))).toBe(fnv1a(encodeWav(a)));
  });

  it("different seeds give different sounds", () => {
    const h = new Set([1, 2, 3, 4].map((seed) => fnv1a(encodeWav(renderSfx(resolveSound({ preset: "coin", seed }), seed)))));
    expect(h.size).toBe(4);
  });

  it.each(VOICES)("voice %s: 4 short variants, ascending pitch", (voice) => {
    const ps = [0, 1, 2, 3].map((v) => resolveSound({ preset: "voice", voice, seed: 1, variants: 4 }, v));
    for (const p of ps) expect(p.attack + p.sustain + p.decay).toBeLessThan(0.1);
    if (voice !== "robot") for (let i = 1; i < 4; i++) expect(ps[i]!.freq).toBeGreaterThan(ps[i - 1]!.freq);
  });

  it("normalizes and clamps params; mutate stays in range and is deterministic", () => {
    const p = normalizeParams({ freq: 1e9, duty: -3, volume: Number.NaN });
    expect(p.freq).toBe(8000);
    expect(p.duty).toBe(0.02);
    expect(p.volume).toBe(0.5);
    const base = resolveSound({ preset: "jump", seed: 2 });
    expect(mutate(base, 7, 0.3)).toEqual(mutate(base, 7, 0.3));
    expect(mutate(base, 7, 0.3)).not.toEqual(base);
  });
});

describe("WAV", () => {
  it("writes a valid 16-bit mono PCM header", () => {
    const s = renderSfx(resolveSound({ preset: "coin", seed: 3 }), 1);
    const w = encodeWav(s, 44100);
    const info = readWavInfo(w);
    expect(info).toMatchObject({ sampleRate: 44100, channels: 1, bitsPerSample: 16, samples: s.length, dataOffset: 44, loop: null });
    expect(w.length).toBe(44 + s.length * 2);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(w.buffer).getUint32(4, true)).toBe(w.length - 8);
  });

  it("stores the loop in a smpl chunk", () => {
    const w = encodeWav(new Float32Array(1000).fill(0.1), 22050, { loop: true });
    const info = readWavInfo(w);
    expect(info.loop).toEqual({ start: 0, end: 999 });
    expect(info.sampleRate).toBe(22050);
  });

  it("rejects non-WAV data", () => {
    expect(() => readWavInfo(new TextEncoder().encode("OggS not a wav file at all...."))).toThrow(/RIFF/);
  });
});

describe("determinism hashes (test/golden.json; UPDATE_GOLDEN=1 to rewrite)", () => {
  it("every sample clip and track matches its recorded hash", async () => {
    const bank = await sampleBank();
    const got: Record<string, string> = {};
    for (const c of bankClips(bank)) got[c.id] = fnv1a(encodeWav(renderClip(c)));
    for (const [id, t] of Object.entries(bank.tracks)) got[`track:${id}`] = fnv1a(encodeWav(renderTrack(t, { id }).samples, 44100, { loop: true }));
    if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    const want = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(got).toEqual(want);
  }, 60_000);
});
