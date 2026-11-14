/** Easy SFX shared types — the `easysfx/1` bank format. Pure data, usable in Node and the browser. */

export const FORMAT = "easysfx/1";
export const SAMPLE_RATE = 44100;

export const WAVES = ["square", "saw", "triangle", "sine", "noise"] as const;
export type Wave = (typeof WAVES)[number];

/** sfxr-style one-shot parameters, in readable units (seconds, Hz, octaves). */
export interface SfxParams {
  wave: Wave;
  /** Square duty 0.02..0.98 and its sweep per second. */
  duty: number;
  dutySweep: number;
  /** Envelope (seconds). Punch boosts the start of the sustain (0..1). */
  attack: number;
  sustain: number;
  punch: number;
  decay: number;
  /** Start frequency (Hz) and pitch slide in octaves per second (+ its own change per second). */
  freq: number;
  slide: number;
  deltaSlide: number;
  /** The sound stops when the slide drops below this (Hz, 0 = never). */
  freqMin: number;
  /** Vibrato depth (semitones) and speed (Hz). */
  vibratoDepth: number;
  vibratoSpeed: number;
  /** Arpeggio: multiply the pitch by arpMult after arpTime seconds (arpMult 1 = off). */
  arpMult: number;
  arpTime: number;
  /** Retrigger period in seconds (pitch, slide and arp restart; 0 = off). */
  repeat: number;
  /** One-pole filters in Hz (0 = off). */
  lowpass: number;
  highpass: number;
  /** Bit crush 0 (off) .. 1 (3-bit). */
  crush: number;
  /** Output gain 0..1. */
  volume: number;
}

export const PRESETS = ["coin", "jump", "hit", "hurt", "powerup", "select", "blip", "footstep", "door", "explosion", "voice"] as const;
export type Preset = (typeof PRESETS)[number];

export const VOICES = ["mid", "low", "high", "kid", "elder", "monk", "auntie", "robot"] as const;
export type Voice = (typeof VOICES)[number];

/** A sound in a bank: preset + seed, plus parameter overrides. `variants` > 1 renders pitch-jittered copies (dialogue blips). */
export interface SoundDef {
  preset?: Preset;
  seed?: number;
  voice?: Voice;
  variants?: number;
  params?: Partial<SfxParams>;
  /** Human note shown in the editor / manifest. */
  note?: string;
}

export const INSTRUMENT_WAVES = [...WAVES, "pluck"] as const;
export type InstrumentWave = (typeof INSTRUMENT_WAVES)[number];

/** Tracker instrument (one note = one ADSR voice). */
export interface Instrument {
  wave: InstrumentWave;
  duty?: number;
  /** Additive sine partials [ratio, amplitude] — overrides `wave` (mallets, bells). */
  partials?: [number, number][];
  attack: number;
  decay: number;
  /** Sustain level 0..1. */
  sustain: number;
  release: number;
  volume: number;
  vibratoDepth?: number;
  vibratoSpeed?: number;
  vibratoDelay?: number;
  /** Re-strike rate in Hz while a note is held (ranat "kro" roll). */
  tremolo?: number;
  /** Second voice detuned by this many cents (khim chorus). */
  detune?: number;
  /** Transpose in octaves. */
  octave?: number;
  lowpass?: number;
}

export interface Channel {
  name: string;
  /** Instrument id, or "drums" for the noise kit (k s h o c p g x tokens). */
  instrument: string;
  volume?: number;
}

/**
 * Tracker song: 4 channels, patterns of whitespace-separated steps per channel.
 * Steps: a note (`C4`, `D#5`, `Bb3`), `.` hold, `-` note off; on the drums channel `k s h o c p g x`
 * (kick snare hat open-hat ching chap gong click), combined with `+` (`k+c`). `|` is ignored.
 */
export interface Track {
  title?: string;
  bpm: number;
  /** Steps per beat (4 = 16th notes). */
  steps: number;
  loop?: boolean;
  channels: Channel[];
  instruments?: Record<string, Instrument>;
  patterns: Record<string, string[]>;
  order: string[];
  note?: string;
}

export interface SfxBank {
  format: typeof FORMAT;
  name: string;
  sampleRate?: number;
  sounds: Record<string, SoundDef>;
  tracks: Record<string, Track>;
}

export interface Diagnostic {
  path: string;
  message: string;
  severity: "error" | "warning";
}
