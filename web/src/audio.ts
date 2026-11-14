/** Web Audio playback of Float32 sample buffers (rendered by the shared synth in the browser). */
let ctx: AudioContext | null = null;
let current: { src: AudioBufferSourceNode; started: number; seconds: number; loop: boolean } | null = null;

export function audioCtx(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playSamples(samples: Float32Array, sampleRate: number, opts: { loop?: boolean; exclusive?: boolean } = {}) {
  const ac = audioCtx();
  const buf = ac.createBuffer(1, Math.max(1, samples.length), sampleRate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.loop = !!opts.loop;
  src.connect(ac.destination);
  if (opts.exclusive) stopAll();
  src.start();
  const entry = { src, started: ac.currentTime, seconds: samples.length / sampleRate, loop: !!opts.loop };
  if (opts.exclusive) {
    current = entry;
    src.onended = () => {
      if (current === entry) current = null;
    };
  }
  return entry;
}

export function stopAll() {
  if (current) {
    try {
      current.src.stop();
    } catch {
      /* already stopped */
    }
    current = null;
  }
}

/** Playback position 0..1 of the exclusive (music) player, or null. */
export function position(): number | null {
  if (!current || !ctx) return null;
  const t = ctx.currentTime - current.started;
  return current.loop ? (t % current.seconds) / current.seconds : Math.min(1, t / current.seconds);
}
