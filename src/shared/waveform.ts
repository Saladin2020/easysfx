/** Pixel-style waveform drawing on any 2D canvas context (browser canvas or @napi-rs/canvas). */

export interface Ctx2D {
  fillStyle: unknown;
  font: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export const WAVE_COLORS = {
  bg: "#140e0a",
  panel: "#21160e",
  grid: "#3a2819",
  mid: "#523822",
  wave: "#f4ae3d",
  waveHi: "#ffd27a",
  rms: "#b9741f",
  text: "#f7ebd3",
  muted: "#97805f",
  loop: "#79c48a",
};

/** Column min/max/rms of `samples` reduced to `cols` buckets. */
export function peaks(samples: Float32Array, cols: number): { min: Float32Array; max: Float32Array; rms: Float32Array } {
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const rms = new Float32Array(cols);
  const per = samples.length / cols;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor(c * per);
    const b = Math.max(a + 1, Math.floor((c + 1) * per));
    let lo = 0;
    let hi = 0;
    let s = 0;
    for (let i = a; i < b && i < samples.length; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      s += v * v;
    }
    min[c] = lo;
    max[c] = hi;
    rms[c] = Math.sqrt(s / (b - a));
  }
  return { min, max, rms };
}

/**
 * Draw a waveform into (x, y, w, h) with `px`-sized pixels: chunky columns, RMS core, grid every 0.1 s
 * (or every beat when `beatSec` is given) and an optional title strip.
 */
export function drawWaveform(g: Ctx2D, samples: Float32Array, opts: { x?: number; y?: number; w: number; h: number; px?: number; sampleRate?: number; title?: string; subtitle?: string; beatSec?: number; loop?: boolean; font?: string }) {
  const px = opts.px ?? 3;
  const x0 = opts.x ?? 0;
  const y0 = opts.y ?? 0;
  const sr = opts.sampleRate ?? 44100;
  const C = WAVE_COLORS;
  g.fillStyle = C.bg;
  g.fillRect(x0, y0, opts.w, opts.h);
  let top = y0;
  if (opts.title) {
    const fs = Math.max(10, Math.round(px * 5));
    g.font = `${fs}px ${opts.font ?? '"Kanit Medium", Kanit, sans-serif'}`;
    g.fillStyle = C.text;
    g.fillText(opts.title, x0 + px * 3, y0 + fs + px * 2);
    if (opts.subtitle) {
      g.font = `${Math.round(fs * 0.75)}px ${opts.font ?? "Kanit, sans-serif"}`;
      g.fillStyle = C.muted;
      g.fillText(opts.subtitle, x0 + px * 3, y0 + fs * 2 + px * 2);
    }
    top = y0 + (opts.subtitle ? fs * 2 : fs) + px * 5;
  }
  const ph = opts.h - (top - y0) - px * 2;
  const pw = opts.w - px * 4;
  const px0 = x0 + px * 2;
  g.fillStyle = C.panel;
  g.fillRect(px0, top, pw, ph);
  const cols = Math.max(1, Math.floor(pw / px));
  const rows = Math.max(2, Math.floor(ph / px));
  const midRow = Math.floor(rows / 2);
  const seconds = samples.length / sr;
  const step = opts.beatSec ?? (seconds > 4 ? 1 : seconds > 1 ? 0.25 : 0.05);
  g.fillStyle = C.grid;
  for (let t = step; t < seconds; t += step) g.fillRect(px0 + Math.floor((t / seconds) * cols) * px, top, px, ph);
  g.fillStyle = C.mid;
  g.fillRect(px0, top + midRow * px, pw, px);
  const pk = peaks(samples, cols);
  const half = rows / 2 - 1;
  for (let c = 0; c < cols; c++) {
    const hi = Math.round(pk.max[c]! * half);
    const lo = Math.round(pk.min[c]! * half);
    const r = Math.round(pk.rms[c]! * half);
    if (hi === 0 && lo === 0) continue;
    g.fillStyle = C.wave;
    g.fillRect(px0 + c * px, top + (midRow - hi) * px, px, (hi - lo + 1) * px);
    g.fillStyle = C.rms;
    g.fillRect(px0 + c * px, top + (midRow - r) * px, px, (2 * r + 1) * px);
    g.fillStyle = C.waveHi;
    g.fillRect(px0 + c * px, top + (midRow - hi) * px, px, px);
  }
  if (opts.loop) {
    g.fillStyle = C.loop;
    g.fillRect(px0, top, px, ph);
    g.fillRect(px0 + pw - px, top, px, ph);
  }
}
