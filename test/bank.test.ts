import { describe, expect, it } from "vitest";
import { bankClips, bankSummary, validateBank } from "../src/shared/bank.js";
import { sampleBank } from "./helpers.js";

describe("bank", () => {
  it("the sample bank is clean and has every preset + dialogue voices", async () => {
    const bank = await sampleBank();
    const v = validateBank(bank);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    const presets = new Set(Object.values(bank.sounds).map((s) => s.preset));
    for (const p of ["coin", "jump", "hit", "hurt", "powerup", "select", "blip", "footstep", "door", "explosion", "voice"]) expect(presets.has(p as never)).toBe(true);
    const clips = bankClips(bank).map((c) => c.id);
    expect(clips).toContain("blip_kid_3");
    expect(clips).toContain("footstep_2");
    expect(bankSummary(bank).tracks.find((t) => t.id === "village_day")!.seconds).toBeCloseTo(9.6);
  });

  it("reports structural errors with JSON paths", () => {
    const v = validateBank({ format: "easysfx/0", name: "x", sounds: { "Bad Id": {}, a: { preset: "laser", params: { nope: 1, wave: "fm" } }, b: { preset: "voice", voice: "dragon" } }, tracks: { a: { bpm: 1, steps: 4, channels: [], patterns: {}, order: [] } } });
    const paths = v.errors.map((e) => e.path);
    expect(v.bank).toBeNull();
    for (const p of ["format", "sounds.Bad Id", "sounds.a.preset", "sounds.a.params.nope", "sounds.a.params.wave", "sounds.b.voice", "tracks.a", "tracks.a.bpm", "tracks.a.channels", "tracks.a.order"]) expect(paths).toContain(p);
  });

  it("warns (not fails) on out-of-range params", () => {
    const v = validateBank({ format: "easysfx/1", name: "x", sounds: { a: { preset: "coin", params: { freq: 99999 } } }, tracks: {} });
    expect(v.errors).toEqual([]);
    expect(v.warnings[0]!.path).toBe("sounds.a.params.freq");
  });
});
