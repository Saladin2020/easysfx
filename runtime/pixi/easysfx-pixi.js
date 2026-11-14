// Easy SFX — PixiJS v8 / @pixi/sound helper. MIT © Salahuddin Benno.
//
//   import { SfxBank } from "./easysfx-pixi.js";
//   const bank = await SfxBank.load("./easysfx.manifest.json", { sound: PIXI.sound });  // @pixi/sound (optional)
//   bank.play("coin"); bank.blip("blip_kid"); bank.playMusic("village_day"); bank.stopMusic();
//   bank.attachDialogueBox(box, { voices: { kid: "blip_kid" } });   // Easy Dialogue typing blips
//
// The manifest is a PixiJS Assets manifest (bundles "sfx" and "music"): with @pixi/sound imported,
// `PIXI.Assets.init({ manifest })` + `PIXI.Assets.loadBundle("sfx")` also works and returns Sound objects.
// Without @pixi/sound the helper falls back to plain Web Audio, so the same calls work anywhere.

const AC = globalThis.AudioContext || globalThis.webkitAudioContext;

export class SfxBank {
  /** @param {object} manifest parsed easysfx.manifest.json @param {string} base folder URL */
  constructor(manifest, base, opts = {}) {
    this.manifest = manifest;
    this.base = base;
    this.sound = opts.sound ?? null; // @pixi/sound `sound` singleton
    this.meta = manifest.easysfx;
    this.sounds = Object.fromEntries(this.meta.sounds.map((s) => [s.id, s]));
    this.tracks = Object.fromEntries(this.meta.tracks.map((t) => [t.id, t]));
    this.volume = opts.volume ?? 1;
    this.musicVolume = opts.musicVolume ?? 0.6;
    this.music = null;
    this._buffers = new Map();
    this._seed = 7;
  }

  static async load(url, opts = {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`easysfx: cannot load ${url}`);
    const manifest = await res.json();
    const base = new URL(".", new URL(url, location.href)).href;
    const bank = new SfxBank(manifest, base, opts);
    await bank.preload(opts.preload ?? "sfx");
    return bank;
  }

  /** Source URL for an alias; prefers .ogg unless the browser cannot play it. */
  src(alias) {
    for (const b of this.manifest.bundles) {
      const a = b.assets.find((x) => x.alias === alias);
      if (!a) continue;
      const list = Array.isArray(a.src) ? a.src : [a.src];
      const probe = typeof document !== "undefined" ? document.createElement("audio") : null;
      const ok = list.find((s) => !s.endsWith(".ogg") || !probe || probe.canPlayType("audio/ogg; codecs=vorbis"));
      return new URL(ok ?? list[0], this.base).href;
    }
    return null;
  }

  async preload(which = "sfx") {
    const aliases = this.manifest.bundles.filter((b) => which === "all" || b.name === which).flatMap((b) => b.assets.map((a) => a.alias));
    await Promise.all(aliases.map((a) => this._get(a)));
  }

  async _get(alias) {
    if (this._buffers.has(alias)) return this._buffers.get(alias);
    const url = this.src(alias);
    if (!url) throw new Error(`easysfx: unknown alias ${alias}`);
    let p;
    if (this.sound) {
      p = new Promise((ok, fail) => {
        if (this.sound.exists(alias)) return ok(this.sound.find(alias));
        this.sound.add(alias, { url, preload: true, loaded: (err, s) => (err ? fail(err) : ok(s)) });
      });
    } else {
      this.ctx ??= new AC();
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b));
    }
    this._buffers.set(alias, p);
    return p;
  }

  _rand() {
    this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff;
    return this._seed / 0x7fffffff;
  }

  has(id) {
    return !!this.sounds[id];
  }

  /** Play a sound (random variant). Returns a promise of the playing instance / source node. */
  async play(id, { volume = 1, speed = 1, variant = -1 } = {}) {
    const s = this.sounds[id];
    if (!s) return console.warn(`easysfx: unknown sound ${id}`), null;
    const clip = s.clips[variant >= 0 ? Math.min(variant, s.clips.length - 1) : Math.floor(this._rand() * s.clips.length)];
    const buf = await this._get(clip.alias);
    if (this.sound) return buf.play({ volume: volume * this.volume, speed });
    return this._playBuffer(buf, volume * this.volume, speed, false);
  }

  blip(id, opts = {}) {
    return this.play(id, { volume: opts.volume ?? 0.7, speed: 0.97 + this._rand() * 0.06 });
  }

  async playMusic(id, { volume } = {}) {
    const t = this.tracks[id];
    if (!t) return console.warn(`easysfx: unknown track ${id}`);
    if (this.music?.id === id) return;
    this.stopMusic();
    const buf = await this._get(t.alias);
    const v = (volume ?? this.musicVolume) * this.volume;
    const inst = this.sound ? await buf.play({ loop: t.loop, volume: v }) : this._playBuffer(buf, v, 1, t.loop);
    this.music = { id, inst, buf };
  }

  stopMusic() {
    if (!this.music) return;
    if (this.sound) this.music.buf.stop();
    else this.music.inst.stop();
    this.music = null;
  }

  _playBuffer(buf, volume, speed, loop) {
    if (this.ctx.state === "suspended") this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = speed;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.ctx.destination);
    src.start();
    return src;
  }

  /**
   * Typing blips for an Easy Dialogue `DialogueBox` (easydialogue-pixi.js). Wraps `box.update` and plays
   * `blip(voice)` every `every` revealed grapheme clusters, skipping spaces and punctuation.
   * voices: { [characterId or display name]: soundId }. Returns a detach function.
   */
  attachDialogueBox(box, { voices = {}, defaultVoice = "blip_mid", narration = false, every = 2, volume = 0.6 } = {}) {
    const orig = box.update.bind(box);
    let last = 0;
    let key = null;
    const skip = /^[\s.,!?…—\-"'()]*$/;
    box.update = (dt) => {
      orig(dt);
      if (box.state !== "typing" || !box.line) return;
      const k = `${box.line.id}|${box.line.text}`;
      if (k !== key) {
        key = k;
        last = 0;
      }
      const shown = Math.floor(box.revealed);
      if (shown <= last) return;
      const steps = shown - last;
      last = shown;
      const sp = box.line.speaker;
      const voice = sp ? voices[sp] ?? voices[box.line.name] ?? defaultVoice : narration ? defaultVoice : null;
      if (!voice || !this.has(voice)) return;
      if (shown % Math.max(1, every) !== 0 && steps < every) return;
      const cl = box.clusters?.[shown - 1] ?? "";
      if (skip.test(cl)) return;
      this.blip(voice, { volume });
      this.onBlip?.(voice, cl);
    };
    return () => {
      box.update = orig;
    };
  }
}
