import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportBank } from "../src/lib/export.js";
import { ffmpegPath } from "../src/lib/audio.js";
import { readWavInfo } from "../src/shared/wav.js";
import { tempWorkspace } from "./helpers.js";

let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

const resPath = (dir: string, res: string) => path.join(dir, res.replace(/^res:\/\//, ""));

describe("export", () => {
  it("godot: project + SfxBank autoload + manifest whose res:// files exist", async () => {
    const res = await exportBank(root, { bank: "village", preset: "godot", ogg: false });
    const dir = res.dirs[0]!;
    const project = readFileSync(path.join(dir, "project.godot"), "utf8");
    expect(project).toMatch(/\[autoload\]\s+SfxBank="\*res:\/\/addons\/easysfx\/sfx_bank\.gd"/);
    expect(project).toMatch(/config\/features=PackedStringArray\("4\.3"\)/);
    for (const f of ["addons/easysfx/sfx_bank.gd", "addons/easysfx/dialogue_blips.gd", "main.tscn", "main.gd", "test_bank.gd", "README.txt"]) expect(existsSync(path.join(dir, f)), f).toBe(true);
    const m = JSON.parse(readFileSync(path.join(dir, "easysfx/bank.sfxbank.json"), "utf8"));
    expect(m.format).toBe("easysfx-bank/1");
    expect(m.sounds.find((s: { id: string }) => s.id === "blip_kid").clips).toHaveLength(4);
    for (const s of m.sounds) {
      for (const c of s.clips) {
        const info = readWavInfo(readFileSync(resPath(dir, c.file)));
        expect(info.samples).toBe(c.samples);
      }
    }
    // without ffmpeg / --no-ogg music is WAV with a loop point
    for (const t of m.tracks) {
      expect(t.file).toMatch(/\.wav$/);
      expect(readWavInfo(readFileSync(resPath(dir, t.file))).loop).toEqual({ start: 0, end: t.samples - 1 });
    }
  });

  it.skipIf(!ffmpegPath())("godot with ffmpeg: music is .ogg and no duplicate files Godot would import twice", async () => {
    const res = await exportBank(root, { bank: "village", preset: "godot" });
    const dir = res.dirs[0]!;
    const m = JSON.parse(readFileSync(path.join(dir, "easysfx/bank.sfxbank.json"), "utf8"));
    for (const t of m.tracks) {
      expect(t.file).toMatch(/\.ogg$/);
      expect(readFileSync(resPath(dir, t.file)).subarray(0, 4).toString()).toBe("OggS");
      expect(existsSync(resPath(dir, t.file.replace(/\.ogg$/, ".wav")))).toBe(false);
    }
    expect(res.files.some((f) => f.endsWith(".ogg") && f.includes("/sfx/"))).toBe(false);
  });

  it("pixi: Assets manifest with sfx + music bundles, helper and demo page", async () => {
    const res = await exportBank(root, { bank: "village", preset: "pixi" });
    const dir = res.dirs[0]!;
    const m = JSON.parse(readFileSync(path.join(dir, "easysfx.manifest.json"), "utf8"));
    expect(m.bundles.map((b: { name: string }) => b.name)).toEqual(["sfx", "music"]);
    for (const b of m.bundles) for (const a of b.assets) for (const s of a.src) expect(existsSync(path.join(dir, s)), s).toBe(true);
    expect(m.easysfx.tracks.map((t: { id: string }) => t.id)).toEqual(["village_day", "market_chase", "night_temple", "kompang", "raya_loop"]);
    const helper = readFileSync(path.join(dir, "easysfx-pixi.js"), "utf8");
    expect(helper).toMatch(/attachDialogueBox/);
    expect(readFileSync(path.join(dir, "index.html"), "utf8")).toMatch(/pixi\.js@8/);
  });

  it("wav: clips, waveform PNGs and an index; json: the bank", async () => {
    const res = await exportBank(root, { bank: "village", preset: "all", out: "exports/everything", ogg: false });
    expect(res.dirs.map((d) => path.basename(d))).toEqual(["village-json", "village-wav", "village-pixi", "village-godot"]);
    const wav = res.dirs[1]!;
    expect(readFileSync(path.join(wav, "waveforms", "village_day.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(readFileSync(path.join(wav, "index.csv"), "utf8").split("\n")[0]).toBe("sound,clip,wav,ogg,seconds");
    expect(JSON.parse(readFileSync(path.join(res.dirs[0]!, "village.easysfx.json"), "utf8")).format).toBe("easysfx/1");
  });

  it("refuses output outside the workspace for API callers", async () => {
    await expect(exportBank(root, { bank: "village", preset: "json", out: "../../escape" })).rejects.toThrow(/outside the workspace/);
  });
});
