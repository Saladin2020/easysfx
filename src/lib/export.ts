import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { bankClips, renderClip } from "../shared/bank.js";
import { stats } from "../shared/synth.js";
import { renderTrack } from "../shared/tracker.js";
import { SAMPLE_RATE, type SfxBank } from "../shared/types.js";
import { encodeWav } from "../shared/wav.js";
import { RUNTIME_DIR } from "./assets.js";
import { ffmpegPath, renderRef, transcode, waveformPng } from "./audio.js";
import { assertSafeId, dirs, loadBank, loadConfig, resolveInside } from "./workspace.js";

export const EXPORT_PRESETS = ["godot", "pixi", "wav", "json", "all"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];

export interface ExportOptions {
  bank: string;
  preset?: ExportPreset;
  out?: string;
  /** Force .ogg on/off (default: config.ogg && ffmpeg present). */
  ogg?: boolean;
  trustedPaths?: boolean;
}

export interface ExportResult {
  preset: ExportPreset;
  dirs: string[];
  files: string[];
  warnings: string[];
  ogg: boolean;
}

class Writer {
  files: string[] = [];
  constructor(public root: string) {}
  async write(rel: string, body: string | Uint8Array) {
    const f = path.join(this.root, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
    this.files.push(f);
    return f;
  }
  async copy(src: string, rel: string) {
    const f = path.join(this.root, rel);
    await mkdir(path.dirname(f), { recursive: true });
    await copyFile(src, f);
    this.files.push(f);
  }
}

interface AudioFile {
  alias: string;
  wav: string;
  ogg?: string;
  seconds: number;
  samples: number;
}

/** Render every clip + track into `sfx/` and `music/`. Music prefers .ogg for size; sfx always keep .wav. */
async function writeAudioFiles(w: Writer, bank: SfxBank, ogg: boolean) {
  const sr = bank.sampleRate ?? SAMPLE_RATE;
  const clips: Record<string, AudioFile[]> = {};
  for (const c of bankClips(bank)) {
    const s = renderClip(c, sr);
    const wav = `sfx/${c.id}.wav`;
    const f = await w.write(wav, encodeWav(s, sr));
    const a: AudioFile = { alias: c.id, wav, seconds: +(s.length / sr).toFixed(4), samples: s.length };
    if (ogg && transcode(f, f.replace(/\.wav$/, ".ogg"))) {
      a.ogg = wav.replace(/\.wav$/, ".ogg");
      w.files.push(f.replace(/\.wav$/, ".ogg"));
    }
    (clips[c.sound] ??= []).push(a);
  }
  const music: (AudioFile & { id: string; title: string; loop: boolean; bpm: number })[] = [];
  for (const [id, t] of Object.entries(bank.tracks)) {
    const r = renderTrack(t, { id, sampleRate: sr });
    const loop = t.loop !== false;
    const wav = `music/${id}.wav`;
    const f = await w.write(wav, encodeWav(r.samples, sr, { loop }));
    const a = { id, title: t.title ?? id, loop, bpm: t.bpm, alias: `music_${id}`, wav, seconds: +r.seconds.toFixed(4), samples: r.samples.length } as AudioFile & { id: string; title: string; loop: boolean; bpm: number };
    if (ogg && transcode(f, f.replace(/\.wav$/, ".ogg"))) {
      a.ogg = wav.replace(/\.wav$/, ".ogg");
      w.files.push(f.replace(/\.wav$/, ".ogg"));
    }
    music.push(a);
  }
  return { clips, music, sr };
}

function soundMeta(bank: SfxBank, id: string) {
  const d = bank.sounds[id]!;
  return { id, preset: d.preset ?? null, voice: d.voice ?? null, note: d.note ?? "" };
}

export async function exportBank(root: string, opts: ExportOptions): Promise<ExportResult> {
  const id = assertSafeId(opts.bank, "bank id");
  const preset = opts.preset ?? "all";
  if (!(EXPORT_PRESETS as readonly string[]).includes(preset)) throw new Error(`Unknown preset ${preset} (${EXPORT_PRESETS.join(", ")})`);
  const cfg = await loadConfig(root);
  const bank = await loadBank(root, id);
  const warnings: string[] = [];
  const hasFf = !!ffmpegPath();
  const ogg = (opts.ogg ?? cfg.ogg) && hasFf;
  if ((opts.ogg ?? cfg.ogg) && !hasFf) warnings.push("ffmpeg not found — exported .wav only (music loops via the WAV smpl chunk)");
  const outFor = (p: string) => {
    if (opts.out) {
      const base = opts.trustedPaths ? path.resolve(root, opts.out) : resolveInside(root, opts.out);
      return preset === "all" ? path.join(base, `${id}-${p}`) : base;
    }
    return path.join(dirs(root).exports, `${id}-${p}`);
  };
  const res: ExportResult = { preset, dirs: [], files: [], warnings, ogg };
  const presets: ExportPreset[] = preset === "all" ? ["json", "wav", "pixi", "godot"] : [preset];
  for (const p of presets) {
    const dir = outFor(p);
    await rm(dir, { recursive: true, force: true });
    const w = new Writer(dir);
    await mkdir(dir, { recursive: true });
    if (p === "json") await w.write(`${id}.easysfx.json`, `${JSON.stringify(bank, null, 2)}\n`);
    if (p === "wav") await writeWavPack(w, bank, ogg);
    if (p === "pixi") await writePixi(w, bank, ogg);
    if (p === "godot") await writeGodot(w, bank, ogg);
    res.dirs.push(dir);
    res.files.push(...w.files);
  }
  return res;
}

async function writeWavPack(w: Writer, bank: SfxBank, ogg: boolean) {
  const a = await writeAudioFiles(w, bank, ogg);
  for (const id of [...Object.keys(bank.sounds), ...Object.keys(bank.tracks)]) await w.write(`waveforms/${id}.png`, waveformPng(renderRef(bank, id), { width: 720, height: 220 }));
  const rows = [
    ...Object.entries(a.clips).flatMap(([sid, cs]) => cs.map((c) => [sid, c.alias, c.wav, c.ogg ?? "", c.seconds])),
    ...a.music.map((m) => [m.id, m.alias, m.wav, m.ogg ?? "", m.seconds]),
  ];
  await w.write("index.csv", `sound,clip,wav,ogg,seconds\n${rows.map((r) => r.join(",")).join("\n")}\n`);
}

async function writePixi(w: Writer, bank: SfxBank, ogg: boolean) {
  const a = await writeAudioFiles(w, bank, ogg);
  const src = (f: AudioFile) => (f.ogg ? [f.ogg, f.wav] : [f.wav]);
  const manifest = {
    bundles: [
      { name: "sfx", assets: Object.values(a.clips).flat().map((c) => ({ alias: c.alias, src: src(c) })) },
      { name: "music", assets: a.music.map((m) => ({ alias: m.alias, src: src(m) })) },
    ],
    easysfx: {
      format: "easysfx-manifest/1",
      bank: bank.name,
      sampleRate: a.sr,
      sounds: Object.entries(a.clips).map(([sid, cs]) => ({ ...soundMeta(bank, sid), clips: cs.map((c) => ({ alias: c.alias, seconds: c.seconds })) })),
      tracks: a.music.map((m) => ({ id: m.id, title: m.title, alias: m.alias, loop: m.loop, bpm: m.bpm, seconds: m.seconds })),
    },
  };
  await w.write("easysfx.manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await w.copy(path.join(RUNTIME_DIR, "pixi", "easysfx-pixi.js"), "easysfx-pixi.js");
  await w.write("index.html", pixiHtml(bank));
  await w.write(
    "README.txt",
    `Easy SFX — PixiJS v8 export of "${bank.name}"

Serve this folder over HTTP (audio is fetched):  npx serve .   or   python3 -m http.server
Open index.html and click the buttons.

Files
  easysfx.manifest.json   PixiJS Assets manifest (bundles "sfx", "music") + "easysfx" metadata (variants, loops)
  easysfx-pixi.js         SfxBank: play(id), blip(id), playMusic(id), stopMusic(), attachDialogueBox(box, { voices })
  sfx/*.wav|ogg  music/*.ogg|wav

With @pixi/sound:   SfxBank.load("./easysfx.manifest.json", { sound: PIXI.sound })
Without it the helper uses Web Audio directly. Generated by Easy SFX (MIT); sounds are CC0.
`,
  );
}

function pixiHtml(bank: SfxBank): string {
  const name = bank.name.replace(/</g, "&lt;");
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name} — Easy SFX (PixiJS v8)</title>
  <link rel="icon" href="data:,">
  <style>
    html, body { margin: 0; min-height: 100vh; background: #140e0a; color: #f7ebd3; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    canvas { image-rendering: pixelated; width: min(1440px, 96vw); height: auto; }
    p { opacity: .7; font-size: 13px; margin: 10px; }
  </style>
</head>
<body>
  <p>Click a sound · music buttons loop · 1-9 keys play the first sounds</p>
  <script>
    // Local pixi.min.js / pixi-sound.js if you dropped them next to this file, else the CDN builds.
    const load = (srcs) => new Promise((ok, fail) => {
      const next = (i) => { if (i >= srcs.length) return fail(new Error("not found: " + srcs[0])); const s = document.createElement("script"); s.src = srcs[i]; s.onload = ok; s.onerror = () => next(i + 1); document.head.appendChild(s); };
      next(0);
    });
    window.__pixiReady = load(["./pixi.min.js", "https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"])
      .then(() => load(["./pixi-sound.js", "https://cdn.jsdelivr.net/npm/@pixi/sound@6/dist/pixi-sound.js"]).catch(() => null));
  </script>
  <script type="module">
    import { SfxBank } from "./easysfx-pixi.js";
    await window.__pixiReady;
    const W = 480, H = 270;
    const app = new PIXI.Application();
    await app.init({ width: W, height: H, resolution: 3, antialias: false, background: "#140e0a", roundPixels: true });
    app.canvas.style.width = "";
    document.body.prepend(app.canvas);
    const bank = await SfxBank.load("./easysfx.manifest.json", { sound: PIXI.sound ?? null });
    const log = [];
    const font = { fontFamily: "system-ui, sans-serif", fontSize: 9, fill: "#f7ebd3" };
    const title = new PIXI.Text({ text: bank.meta.bank + " — Easy SFX", style: { ...font, fontSize: 12, fill: "#ffd27a" } });
    title.position.set(10, 6);
    app.stage.addChild(title);
    const buttons = [];
    const mk = (label, x, y, w, color, fn) => {
      const c = new PIXI.Container();
      const g = new PIXI.Graphics().rect(0, 0, w, 15).fill("#0d0906").rect(1, 1, w - 2, 13).fill(color).rect(1, 1, w - 2, 1).fill("#ffffff33");
      const t = new PIXI.Text({ text: label, style: font });
      t.position.set(4, 2);
      c.addChild(g, t);
      c.position.set(x, y);
      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointertap", fn);
      app.stage.addChild(c);
      buttons.push({ label, fn });
      return c;
    };
    let i = 0;
    for (const s of bank.meta.sounds) {
      const col = i % 4, row = Math.floor(i / 4);
      mk(s.id + (s.clips.length > 1 ? " ×" + s.clips.length : ""), 10 + col * 116, 26 + row * 18, 110, s.preset === "voice" ? "#2e3f78" : "#7a5230", () => { bank.play(s.id); log.push("sfx " + s.id); });
      i++;
    }
    const y = 26 + Math.ceil(i / 4) * 18 + 8;
    bank.meta.tracks.forEach((t, k) => mk("♪ " + t.id, 10 + k * 116, y, 110, "#3f7d52", () => { bank.playMusic(t.id); log.push("music " + t.id); }));
    mk("■ stop", 10 + bank.meta.tracks.length * 116, y, 60, "#9e2820", () => { bank.stopMusic(); log.push("stop"); });
    addEventListener("keydown", (e) => { const n = Number(e.key); if (n >= 1 && n <= 9 && buttons[n - 1]) buttons[n - 1].fn(); });
    window.__sfx = { bank, log, app, buttons: buttons.map((b) => b.label), pixiSound: !!PIXI.sound };
    window.__ready = true;
  </script>
</body>
</html>
`;
}

async function writeGodot(w: Writer, bank: SfxBank, ogg: boolean) {
  const a = await writeAudioFiles(w, bank, ogg);
  const res = (f: string) => `res://${f}`;
  const manifest = {
    format: "easysfx-bank/1",
    bank: bank.name,
    sampleRate: a.sr,
    sounds: Object.entries(a.clips).map(([sid, cs]) => ({ ...soundMeta(bank, sid), clips: cs.map((c) => ({ file: res(c.wav), seconds: c.seconds, samples: c.samples })) })),
    // music: .ogg when available (AudioStreamOggVorbis), else .wav (AudioStreamWAV, loop from the smpl chunk)
    tracks: a.music.map((m) => ({ id: m.id, title: m.title, file: res(m.ogg ?? m.wav), loop: m.loop, bpm: m.bpm, seconds: m.seconds, samples: m.samples })),
  };
  // Godot imports every .wav/.ogg it finds; drop the duplicate music .wav when an .ogg exists.
  for (const m of a.music) {
    if (m.ogg) {
      const f = path.join(w.root, m.wav);
      await rm(f, { force: true });
      w.files = w.files.filter((x) => x !== f);
    }
  }
  for (const cs of Object.values(a.clips)) {
    for (const c of cs) {
      if (c.ogg) {
        const f = path.join(w.root, c.ogg);
        await rm(f, { force: true });
        w.files = w.files.filter((x) => x !== f);
      }
    }
  }
  await w.write("easysfx/bank.sfxbank.json", `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of ["sfx_bank.gd", "dialogue_blips.gd"]) await w.copy(path.join(RUNTIME_DIR, "godot", f), `addons/easysfx/${f}`);
  await w.write("addons/easysfx/LICENSE.txt", "Easy SFX runtime — MIT License. Copyright (c) 2026 Salahuddin Benno.\nGenerated sounds and music: CC0 1.0.\n");
  await w.write(
    "project.godot",
    `; Engine configuration file — generated by Easy SFX.
config_version=5

[application]

config/name="${bank.name.replace(/"/g, "'")} (Easy SFX)"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.3")

[autoload]

SfxBank="*res://addons/easysfx/sfx_bank.gd"

[display]

window/size/viewport_width=480
window/size/viewport_height=270
window/size/window_width_override=1440
window/size/window_height_override=810
window/stretch/mode="canvas_items"
window/stretch/scale_mode="integer"

[rendering]

textures/canvas_textures/default_texture_filter=0
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
`,
  );
  await w.write(
    "main.tscn",
    `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1_main"]

[node name="Main" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
script = ExtResource("1_main")

[node name="Bg" type="ColorRect" parent="."]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
color = Color(0.078, 0.055, 0.039, 1)

[node name="Grid" type="GridContainer" parent="."]
layout_mode = 0
offset_left = 8.0
offset_top = 8.0
offset_right = 472.0
offset_bottom = 262.0
columns = 4
`,
  );
  await w.write(
    "main.gd",
    `extends Control
## Demo: one button per sound and track in the SfxBank autoload. Keys 1-9 play the first sounds.

@onready var grid: GridContainer = $Grid
var _ids: Array[String] = []


func _ready() -> void:
	for s in SfxBank.manifest.get("sounds", []):
		_add(s["id"] + (" x%d" % s["clips"].size() if s["clips"].size() > 1 else ""), func(): SfxBank.play(s["id"]))
		_ids.append(s["id"])
	for t in SfxBank.manifest.get("tracks", []):
		_add("♪ " + t["id"], func(): SfxBank.play_music(t["id"]))
	_add("■ stop", func(): SfxBank.stop_music())


func _add(label: String, fn: Callable) -> void:
	var b := Button.new()
	b.text = label
	b.custom_minimum_size = Vector2(112, 16)
	b.add_theme_font_size_override("font_size", 8)
	b.pressed.connect(fn)
	grid.add_child(b)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode >= KEY_1 and event.keycode <= KEY_9:
		var i: int = event.keycode - KEY_1
		if i < _ids.size():
			SfxBank.play(_ids[i])
`,
  );
  await w.write(
    "test_bank.gd",
    `extends SceneTree
## Headless check (after one import pass: godot --headless --editor --quit --path .):
##   godot --headless --path . --script res://test_bank.gd
## Loads the manifest with the SfxBank script, checks every stream type/length and plays a few.


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var bank = load("res://addons/easysfx/sfx_bank.gd").new()
	root.add_child(bank)
	await process_frame
	if not bank.load_manifest("res://easysfx/bank.sfxbank.json"):
		print("FAIL manifest")
		quit(1)
		return
	var bad := 0
	for s in bank.manifest["sounds"]:
		var arr: Array = bank.sounds[s["id"]]
		var lens := []
		for i in arr.size():
			var st: AudioStream = arr[i]
			var expect: float = s["clips"][i]["seconds"]
			lens.append(snappedf(st.get_length(), 0.001))
			if absf(st.get_length() - expect) > 0.01:
				bad += 1
		print("S| ", s["id"], " ", arr.size(), " ", arr[0].get_class() if arr.size() else "none", " ", lens)
		if arr.size() != s["clips"].size():
			bad += 1
	for t in bank.manifest["tracks"]:
		var st = bank.tracks.get(t["id"])
		if st == null:
			bad += 1
			continue
		var looped: bool = st.loop if st is AudioStreamOggVorbis else st.loop_mode == AudioStreamWAV.LOOP_FORWARD
		print("T| ", t["id"], " ", st.get_class(), " ", snappedf(st.get_length(), 0.01), " loop=", looped)
		if absf(st.get_length() - float(t["seconds"])) > 0.05 or looped != bool(t["loop"]):
			bad += 1
	var p = bank.play("coin")
	bank.blip(bank.manifest["sounds"][0]["id"])
	if bank.manifest["tracks"].size():
		bank.play_music(bank.manifest["tracks"][0]["id"], 0.0)
	await process_frame
	print("PLAY| coin=", p != null and p.playing, " music=", bank.current_music)
	var blips = load("res://addons/easysfx/dialogue_blips.gd").new()
	root.add_child(blips)
	print("BLIPS| voice_for(kid)=", blips.voice_for({"speaker": "kid", "name": "ต้น"}))
	if bad:
		print("FAIL ", bad)
		quit(1)
		return
	print("OK")
	quit(0)
`,
  );
  await w.write(
    "README.txt",
    `Easy SFX — Godot 4.3+ export of "${bank.name}"

Open this folder as a project and press F5: one button per sound / track.

Use it in your own game:
  1. Copy addons/easysfx, easysfx/, sfx/ and music/ into your project root (paths in the manifest are res://…).
  2. Project Settings → Autoload: add res://addons/easysfx/sfx_bank.gd as "SfxBank".
  3. SfxBank.play("coin")  ·  SfxBank.blip("blip_kid")  ·  SfxBank.play_music("${Object.keys(bank.tracks)[0] ?? "track"}")  ·  SfxBank.stop_music()
  4. Easy Dialogue typing blips: add a Node with addons/easysfx/dialogue_blips.gd, set dialogue_box to your
     DialogueBox and voices = {"kid": "blip_kid", "vendor": "blip_auntie"} (character id → sound id).

Sounds are .wav (AudioStreamWAV). Music is .ogg (AudioStreamOggVorbis, looped by SfxBank) when ffmpeg was
available at export time, else .wav with a loop point. Headless check:
  godot --headless --editor --quit --path .   (imports)   then   godot --headless --path . --script res://test_bank.gd
Generated by Easy SFX (MIT). Sounds and music are CC0.
`,
  );
}

export { stats };
