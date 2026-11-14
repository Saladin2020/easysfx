/**
 * Optional Godot check: GODOT=/path/to/godot npx vitest run test/godot.test.ts
 * Exports the demo bank, imports it headless, then test_bank.gd loads every stream through the SfxBank
 * script and compares lengths / loop flags with the manifest.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportBank } from "../src/lib/export.js";
import { tempWorkspace } from "./helpers.js";

const GODOT = process.env.GODOT;
let root: string;
let cleanup: () => Promise<void>;
beforeAll(async () => {
  if (GODOT) ({ root, cleanup } = await tempWorkspace());
});
afterAll(() => cleanup?.());

describe.skipIf(!GODOT)("Godot export", () => {
  it.each([[true], [false]])("streams load with the right type, length and loop (ogg=%s)", async (ogg) => {
    const out = path.join(root, "exports", `godot-${ogg}`);
    await exportBank(root, { bank: "village", preset: "godot", out, ogg });
    // Godot 4.3 has no --import flag; editor passes import the assets (the editor may crash on quit — ignored, so run twice).
    for (let i = 0; i < 2; i++) spawnSync(GODOT!, ["--headless", "--editor", "--quit", "--path", out], { encoding: "utf8", timeout: 180_000 });
    const run = spawnSync(GODOT!, ["--headless", "--path", out, "--script", "res://test_bank.gd"], { encoding: "utf8", timeout: 120_000 });
    expect(run.stdout).toMatch(/^OK$/m);
    expect(run.stdout).toMatch(/^S\| blip_kid 4 AudioStreamWAV/m);
    expect(run.stdout).toMatch(new RegExp(`^T\\| village_day ${ogg ? "AudioStreamOggVorbis" : "AudioStreamWAV"} 9\\.6 loop=true`, "m"));
    // the demo scene with the autoload runs a few frames without script errors
    const main = spawnSync(GODOT!, ["--headless", "--path", out, "--quit-after", "30"], { encoding: "utf8", timeout: 120_000 });
    expect(main.stderr + main.stdout).not.toMatch(/SCRIPT ERROR|Parse Error/);
  }, 600_000);
});
