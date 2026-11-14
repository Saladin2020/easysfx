import { describe, expect, it } from "vitest";
import { midiToHz, noteToMidi, parseTrack, renderTrack } from "../src/shared/tracker.js";
import type { Track } from "../src/shared/types.js";
import { sampleBank } from "./helpers.js";

const tiny: Track = {
  bpm: 120,
  steps: 4,
  channels: [
    { name: "lead", instrument: "sq" },
    { name: "drums", instrument: "drums" },
  ],
  instruments: { sq: { wave: "square", attack: 0, decay: 0.05, sustain: 0.5, release: 0.3, volume: 0.5 } },
  patterns: { A: ["C4 . . - E4 . G4 .", "k . h . s . h ."] },
  order: ["A", "A"],
};

describe("tracker", () => {
  it("parses note names", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("Bb3")).toBe(58);
    expect(noteToMidi("D#5")).toBe(75);
    expect(noteToMidi("H2")).toBeNull();
    expect(midiToHz(69)).toBeCloseTo(440);
  });

  it("expands holds, note-offs and the order", () => {
    const p = parseTrack(tiny, "tiny");
    expect(p.errors).toEqual([]);
    expect(p.totalSteps).toBe(16);
    expect(p.seconds).toBeCloseTo(2);
    const lead = p.channels[0]!.events;
    expect(lead.slice(0, 3)).toEqual([
      { step: 0, len: 3, midi: 60 },
      { step: 4, len: 2, midi: 64 },
      { step: 6, len: 2, midi: 67 },
    ]);
    expect(p.channels[1]!.events[0]).toEqual({ step: 0, len: 1, drums: ["k"] });
  });

  it("reports bad tokens, instruments and patterns with paths", () => {
    const bad: Track = { ...tiny, channels: [{ name: "x", instrument: "nope" }, { name: "d", instrument: "drums" }], patterns: { A: ["C4 Q9", "k z"] }, order: ["A", "B"] };
    const msgs = parseTrack(bad, "bad").errors.map((e) => `${e.path}: ${e.message}`);
    expect(msgs).toContain('tracks.bad.channels.0: unknown instrument "nope"');
    expect(msgs.some((m) => m.startsWith("tracks.bad.patterns.A.0") && m.includes('"Q9"'))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown drum "z"'))).toBe(true);
    expect(msgs).toContain('tracks.bad.order.1: unknown pattern "B"');
  });

  it("loops seamlessly: length is exact and release tails wrap to the start", () => {
    const r = renderTrack({ ...tiny, loop: true }, { sampleRate: 22050 });
    expect(r.samples.length).toBe(2 * 22050);
    const once = renderTrack({ ...tiny, loop: false }, { sampleRate: 22050 });
    expect(once.samples.length).toBeGreaterThan(2 * 22050);
    const twice = renderTrack({ ...tiny, loop: true }, { sampleRate: 22050, loops: 2 });
    expect(twice.samples.length).toBe(4 * 22050);
  });

  it("renders the three demo tracks with 4 channels and no clipping", async () => {
    const bank = await sampleBank();
    expect(Object.keys(bank.tracks)).toEqual(["village_day", "market_chase", "night_temple"]);
    for (const [id, t] of Object.entries(bank.tracks)) {
      expect(t.channels).toHaveLength(4);
      const r = renderTrack(t, { id, sampleRate: 22050, stems: true });
      expect(r.errors).toEqual([]);
      expect(r.channels).toHaveLength(4);
      let peak = 0;
      for (const v of r.samples) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.2);
      expect(peak).toBeLessThan(1);
    }
    // Thai feel: the khim lead only uses the C pentatonic (C D E G A)
    const lead = parseTrack(bank.tracks.village_day!).channels[0]!.events;
    expect(new Set(lead.map((e) => e.midi! % 12))).toEqual(new Set([0, 2, 4, 7, 9]));
  });
});
