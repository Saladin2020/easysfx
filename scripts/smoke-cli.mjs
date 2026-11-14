/** CLI smoke test: init a temp workspace, check, render, add and export through the real CLI. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ws = mkdtempSync(path.join(os.tmpdir(), "easysfx-cli-"));
const cli = (...args) => execFileSync("npx", ["tsx", "src/cli.ts", ...args, "--workspace", ws], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failed = true;
};

cli("init");
ok(existsSync(path.join(ws, "banks", "village.easysfx.json")), "init copies the demo bank");
const check = JSON.parse(cli("check", "village", "--json"));
ok(check.errors.length === 0 && check.warnings.length === 0, "check: demo bank is clean");

const bad = JSON.parse(readFileSync(path.join(ws, "banks", "village.easysfx.json"), "utf8"));
bad.tracks.village_day.patterns.A[0] = "E5 . X9";
writeFileSync(path.join(ws, "banks", "broken.easysfx.json"), JSON.stringify(bad));
let out = "";
try {
  cli("check", "broken");
} catch (e) {
  out = String(e.stdout) + String(e.stderr);
}
ok(/tracks\.village_day\.patterns\.A\.0/.test(out) && /"X9"/.test(out), "check reports the JSON path and bad token");

const wav = path.join(ws, "coin.wav");
cli("render", "coin", "--out", wav, "--waveform", path.join(ws, "coin.png"));
const b = readFileSync(wav);
ok(b.toString("ascii", 0, 4) === "RIFF" && b.readUInt16LE(22) === 1 && b.readUInt32LE(24) === 44100, "render → 44.1 kHz mono WAV");
ok(readFileSync(path.join(ws, "coin.png")).toString("ascii", 1, 4) === "PNG", "render --waveform → PNG");
cli("add", "laser", "--preset", "hit", "--seed", "12", "--mutate", "0.2");
ok(/laser/.test(cli("list", "--bank", "village")), "add puts a mutated sound in the bank");

cli("export", "--preset", "all");
for (const f of ["exports/village-pixi/easysfx.manifest.json", "exports/village-godot/project.godot", "exports/village-godot/easysfx/bank.sfxbank.json", "exports/village-wav/waveforms/village_day.png", "exports/village-json/village.easysfx.json"]) {
  ok(existsSync(path.join(ws, f)), `export → ${f}`);
}

rmSync(ws, { recursive: true, force: true });
console.log(failed ? "CLI smoke FAILED" : "CLI smoke OK");
process.exit(failed ? 1 : 0);
