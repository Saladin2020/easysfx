# `easysfx/1` bank format

A bank is one JSON file, `banks/<id>.easysfx.json`. It holds one-shot **sounds** and looping **tracks**.

```json
{
  "format": "easysfx/1",
  "name": "Thai Village",
  "sampleRate": 44100,
  "sounds": {
    "coin":     { "preset": "coin", "seed": 3, "note": "เก็บเหรียญ" },
    "laser":    { "preset": "hit", "seed": 4, "params": { "wave": "square", "freq": 1400 } },
    "footstep": { "preset": "footstep", "seed": 6, "variants": 3 },
    "blip_kid": { "preset": "voice", "voice": "kid", "seed": 2, "variants": 4 }
  },
  "tracks": { "village_day": { "...": "see below" } }
}
```

## Sounds

| Field | Meaning |
| --- | --- |
| `preset` | `coin jump hit hurt powerup select blip footstep door explosion voice` — a seeded generator (like sfxr's buttons) |
| `seed` | integer; the same seed always gives the same params **and** the same noise (deterministic WAV bytes) |
| `params` | overrides on top of the preset (see the table below); out-of-range values are clamped with a warning |
| `variants` | 1–8; renders `<id>_0 … <id>_n` (voices spread over ±jitter semitones low → high; other presets re-seeded) |
| `voice` | for `preset: "voice"` only: `mid low high kid elder monk auntie robot` |

### Synth parameters (`SfxParams`)

| Param | Range | Unit |
| --- | --- | --- |
| `wave` | `square saw triangle sine noise` | |
| `duty`, `dutySweep` | 0.02–0.98, ±2 | fraction, per second |
| `attack`, `sustain`, `decay` | 0–1, 0–2, 0–3 | seconds |
| `punch` | 0–1 | boosts the start of the sustain |
| `freq` | 20–8000 | Hz (for noise: how often the noise changes) |
| `slide`, `deltaSlide` | ±16, ±64 | octaves / s, octaves / s² |
| `freqMin` | 0–2000 | Hz; the sound stops when the slide goes below it |
| `vibratoDepth`, `vibratoSpeed` | 0–12, 0–60 | semitones, Hz |
| `arpMult`, `arpTime` | 0.25–4, 0–1 | pitch × after `arpTime` seconds |
| `repeat` | 0–1 | seconds; restarts pitch, slide and arpeggio |
| `lowpass`, `highpass` | 0–20000, 0–8000 | Hz, 0 = off |
| `crush` | 0–1 | bit crush (0 = 16-bit, 1 = 3-bit) |
| `volume` | 0–1 | |

Rendering is 4× oversampled, soft-clipped (`tanh`) and written as 16-bit mono PCM.

## Tracks

```json
{
  "title": "ตลาดเช้า · Village Morning",
  "bpm": 100, "steps": 4, "loop": true,
  "channels": [
    { "name": "khim",  "instrument": "khim" },
    { "name": "ranat", "instrument": "ranat", "volume": 0.8 },
    { "name": "bass",  "instrument": "bass" },
    { "name": "ching", "instrument": "drums" }
  ],
  "instruments": {
    "khim":  { "wave": "pluck", "attack": 0, "decay": 0.6, "sustain": 0.35, "release": 0.25, "volume": 0.8, "detune": 7 },
    "ranat": { "wave": "sine", "partials": [[1, 1], [3.93, 0.32], [9.2, 0.08]], "attack": 0.002, "decay": 0.12, "sustain": 0.25, "release": 0.12, "volume": 0.42, "tremolo": 9 },
    "bass":  { "wave": "triangle", "attack": 0.005, "decay": 0.15, "sustain": 0.7, "release": 0.06, "volume": 0.55 }
  },
  "patterns": {
    "A": ["E5 . G5 . A5 . G5 E5 D5 . E5 . C5 . . .",
          "C5 . . . . . . . A4 . . . G4 . . .",
          "C3 . . . . . G2 . A2 . . . G2 . . .",
          "k+c . p . c . p . k+c . p . c . p ."]
  },
  "order": ["A", "B", "C", "D"]
}
```

* 1–4 channels. A pattern has one string per channel; steps are separated by spaces (`|` is ignored).
* Steps: a note (`C4` = MIDI 60, `D#5`, `Bb3`), `.` holds the previous note, `-` releases it.
* `steps` = steps per beat (4 → 16th notes). Pattern length = its longest channel.
* Instruments: `wave` = `square saw triangle sine noise pluck` (Karplus–Strong), or `partials` (additive sine,
  higher partials decay faster: mallets and bells). ADSR with `sustain` as a level, `release` in seconds.
  Optional `duty`, `vibratoDepth/Speed/Delay`, `tremolo` (re-strike roll in Hz, the ranat *kro*),
  `detune` (cents, second voice), `octave`, `lowpass`.
* Drum channel (`"instrument": "drums"`): `k` kick, `s` snare, `h` hat, `o` open hat, `c` ching (ฉิ่ง),
  `p` chap (ฉับ), `g` gong (ฆ้อง), `x` click; combine hits with `+` (`k+c`).
* `loop: true` (default) renders exactly one pass; release tails wrap to the start so the loop is seamless.
  `loop: false` keeps a 2.5 s tail.

Validation errors carry JSON paths, e.g. `tracks.village_day.patterns.A.0: step 3: "X9" is not a note`.
