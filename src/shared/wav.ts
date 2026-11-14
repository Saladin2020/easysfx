import { SAMPLE_RATE } from "./types.js";

/** 16-bit PCM mono WAV. Deterministic: same samples → same bytes. Optional loop points via a `smpl` chunk. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE, opts: { loop?: boolean } = {}): Uint8Array {
  const dataBytes = samples.length * 2;
  const smpl = opts.loop ? 60 : 0;
  const buf = new ArrayBuffer(44 + dataBytes + (smpl ? smpl + 8 : 0));
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, buf.byteLength - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  if (smpl) {
    const o = 44 + dataBytes;
    str(o, "smpl");
    v.setUint32(o + 4, smpl, true);
    v.setUint32(o + 8 + 8, Math.round(1e9 / sampleRate), true); // sample period ns
    v.setUint32(o + 8 + 12, 60, true); // MIDI unity note
    v.setUint32(o + 8 + 28, 1, true); // one loop
    v.setUint32(o + 8 + 36 + 4, 0, true); // forward
    v.setUint32(o + 8 + 36 + 8, 0, true); // start
    v.setUint32(o + 8 + 36 + 12, Math.max(0, samples.length - 1), true); // end
  }
  return new Uint8Array(buf);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: number;
  seconds: number;
  dataOffset: number;
  loop: { start: number; end: number } | null;
}

/** Parse and validate a PCM WAV header (throws on anything that is not RIFF/WAVE PCM). */
export function readWavInfo(bytes: Uint8Array): WavInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  if (v.getUint32(4, true) !== bytes.length - 8) throw new Error("RIFF size mismatch");
  let o = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  let loop: WavInfo["loop"] = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      if (v.getUint16(o + 8, true) !== 1) throw new Error("not PCM");
      fmt = { channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (id === "data") data = { offset: o + 8, size };
    else if (id === "smpl" && v.getUint32(o + 8 + 28, true) > 0) loop = { start: v.getUint32(o + 8 + 44, true), end: v.getUint32(o + 8 + 48, true) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  const samples = data.size / ((fmt.bits / 8) * fmt.channels);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, samples, seconds: samples / fmt.sampleRate, dataOffset: data.offset, loop };
}

/** FNV-1a 32-bit over bytes — tiny, dependency-free determinism hash (also used in the browser). */
export function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
