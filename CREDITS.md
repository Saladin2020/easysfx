# Credits

## Sounds and music (CC0 1.0)

* Every sound effect and track is **synthesized from code** at render time (`src/shared/synth.ts`,
  `src/shared/tracker.ts`) — no samples, no recordings, no AI generation, no network calls.
  The demo bank (`samples/banks/village.easysfx.json`), its 3 tracks and everything you render from it are
  dedicated to the public domain (CC0 1.0): use them in any project, no attribution required.
* The synth follows the classic **sfxr** idea (DrPetter, 2007) — square/saw/triangle/sine/noise, envelope with
  punch, pitch slide, vibrato, arpeggio, retrigger, filters — re-implemented from scratch in TypeScript with
  readable units (seconds, Hz, octaves) and a seeded PRNG.
* The Thai-feel instruments are approximations: *khim* = Karplus–Strong plucked string with a detuned second
  voice, *ranat* = sine partials (1, 3.93, 9.2) with a re-strike roll, *ching/chap* = metallic square + noise.

## Fonts

* **Kanit** (Regular, Medium) — Copyright 2020 The Kanit Project Authors (https://github.com/cadsondemak/kanit).
  SIL Open Font License 1.1, see `assets/fonts/OFL.txt`. Used only for Thai labels in waveform PNGs.

## Runtimes

* PixiJS v8 and @pixi/sound are **not** bundled: the exported `index.html` loads `./pixi.min.js` /
  `./pixi-sound.js` if you drop them next to the file, otherwise the jsDelivr CDN (both MIT).
* OGG / MP3 encoding uses your local **ffmpeg** (libvorbis / libmp3lame) when present; WAV needs nothing.
