import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bankSummary, clipsOf, renderClip, validateBank } from "../../src/shared/bank";
import { PRESET_LABELS, VOICE_TABLE, mutate, resolveSound } from "../../src/shared/presets";
import { PARAM_RANGES, renderSfx, stats } from "../../src/shared/synth";
import { parseTrack, renderTrack } from "../../src/shared/tracker";
import { PRESETS, SAMPLE_RATE, VOICES, WAVES, type Preset, type SfxBank, type SfxParams, type SoundDef, type Voice } from "../../src/shared/types";
import { drawWaveform, type Ctx2D } from "../../src/shared/waveform";
import { exportBank, fetchBank, fetchWorkspace, saveBank, type WorkspaceSummary } from "./api";
import { playSamples, position, stopAll } from "./audio";

const EXPORTS = [
  { id: "godot", label: "Godot 4.3+", hint: "SfxBank autoload · WAV/OGG" },
  { id: "pixi", label: "PixiJS v8", hint: "@pixi/sound manifest + helper" },
  { id: "wav", label: "WAV / OGG", hint: "+ waveform PNGs" },
  { id: "all", label: "All", hint: "json · wav · pixi · godot" },
] as const;

const PARAM_GROUPS: { title: string; keys: (keyof typeof PARAM_RANGES)[] }[] = [
  { title: "Envelope", keys: ["attack", "sustain", "punch", "decay", "volume"] },
  { title: "Pitch", keys: ["freq", "slide", "deltaSlide", "freqMin", "vibratoDepth", "vibratoSpeed", "arpMult", "arpTime", "repeat"] },
  { title: "Tone", keys: ["duty", "dutySweep", "lowpass", "highpass", "crush"] },
];

function Waveform({ samples, title, sub, progress, beatSec, loop }: { samples: Float32Array; title?: string; sub?: string; progress?: number | null; beatSec?: number; loop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    drawWaveform(g as unknown as Ctx2D, samples, { w: c.width, h: c.height, px: 3, title, subtitle: sub, beatSec, loop, font: '"IBM Plex Sans Thai", "IBM Plex Sans", sans-serif' });
  }, [samples, title, sub, beatSec, loop]);
  return (
    <div className="wave-wrap">
      <canvas ref={ref} className="wave-canvas" width={900} height={210} />
      {progress !== null && progress !== undefined && <span className="wave-head" style={{ left: `calc(6px + ${progress} * (100% - 12px))` }} />}
    </div>
  );
}

export function App() {
  const [ws, setWs] = useState<WorkspaceSummary | null>(null);
  const [bankId, setBankId] = useState("");
  const [bank, setBank] = useState<SfxBank | null>(null);
  const [saved, setSaved] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [sel, setSel] = useState<{ kind: "sound" | "track"; id: string }>({ kind: "sound", id: "coin" });
  const [variant, setVariant] = useState(0);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err" | ""; text: string }>({ kind: "", text: "" });
  const [exportRes, setExportRes] = useState<{ dirs: string[]; files: number; warnings: string[]; ogg: boolean } | null>(null);
  const [newId, setNewId] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    fetchWorkspace()
      .then(async (w) => {
        setWs(w);
        const id = w.config.bank;
        const b = await fetchBank(id);
        setBankId(id);
        setBank(b.bank);
        setSaved(JSON.stringify(b.bank));
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setProgress(position());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sr = bank?.sampleRate ?? SAMPLE_RATE;
  const dirty = !!bank && JSON.stringify(bank) !== saved;
  const validation = useMemo(() => (bank ? validateBank(bank) : null), [bank]);
  const def: SoundDef | undefined = sel.kind === "sound" ? bank?.sounds[sel.id] : undefined;
  const clips = useMemo(() => (def ? clipsOf(sel.id, def) : []), [def, sel.id]);
  const clip = clips[Math.min(variant, Math.max(0, clips.length - 1))];
  const params: SfxParams | null = clip?.params ?? null;
  const samples = useMemo(() => (clip ? renderClip(clip, sr) : new Float32Array(1)), [clip, sr]);
  const track = sel.kind === "track" ? bank?.tracks[sel.id] : undefined;
  const trackRender = useMemo(() => (track ? renderTrack(track, { id: sel.id, sampleRate: sr }) : null), [track, sel.id, sr]);
  const parsed = useMemo(() => (track ? parseTrack(track, sel.id) : null), [track, sel.id]);

  const flash = (kind: "ok" | "err", text: string) => setStatus({ kind, text });

  const updateSound = useCallback(
    (patch: Partial<SoundDef>, play = autoPlay) => {
      if (!bank || sel.kind !== "sound") return;
      const next: SfxBank = { ...bank, sounds: { ...bank.sounds, [sel.id]: { ...bank.sounds[sel.id], ...patch } } };
      setBank(next);
      if (play) {
        const c = clipsOf(sel.id, next.sounds[sel.id]!)[0]!;
        playSamples(renderSfx(c.params, c.seed, sr), sr);
      }
    },
    [bank, sel, sr, autoPlay],
  );

  const setParam = (k: keyof SfxParams, v: number | string) => {
    if (!def) return;
    updateSound({ params: { ...(def.params ?? {}), [k]: v } }, false);
  };

  const playCurrent = () => {
    if (sel.kind === "sound" && clip) playSamples(samples, sr);
    if (sel.kind === "track" && trackRender) playSamples(trackRender.samples, sr, { loop: track?.loop !== false, exclusive: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void onSave();
      } else if (e.key === " " && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        playCurrent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function onSave() {
    if (!bank) return;
    setBusy("save");
    try {
      const r = await saveBank(bankId, bank);
      if (r.ok) {
        setSaved(JSON.stringify(bank));
        flash("ok", `Saved banks/${bankId}.easysfx.json`);
      } else flash("err", `Not saved: ${r.errors[0]?.path}: ${r.errors[0]?.message}`);
    } catch (e) {
      flash("err", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function onExport(preset: string) {
    if (dirty) await onSave();
    setBusy(`export-${preset}`);
    try {
      const r = await exportBank(bankId, preset);
      setExportRes(r);
      flash("ok", `Exported ${r.files} files`);
    } catch (e) {
      flash("err", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function onNew(preset: Preset) {
    if (!bank) return;
    const base = newId.trim() || preset;
    let id = base.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    for (let n = 2; bank.sounds[id] || bank.tracks[id]; n++) id = `${base}_${n}`;
    const d: SoundDef = { preset, seed: Math.floor(Math.random() * 9999) + 1, ...(preset === "voice" ? { voice: "mid" as Voice, variants: 4 } : {}) };
    setBank({ ...bank, sounds: { ...bank.sounds, [id]: d } });
    setSel({ kind: "sound", id });
    setVariant(0);
    setNewId("");
    const c = clipsOf(id, d)[0]!;
    playSamples(renderSfx(c.params, c.seed, sr), sr);
  }

  if (loadErr) {
    return (
      <div className="splash">
        <div className="splash-card">
          <h1 className="brand">
            Easy <span>SFX</span>
          </h1>
          <p className="hint err">{loadErr}</p>
          <p className="hint">Start the API with <code>npx easysfx serve</code> (or <code>npm run dev</code>).</p>
        </div>
      </div>
    );
  }
  if (!bank) return <div className="splash"><div className="splash-card"><p className="splash-msg">Loading bank…</p></div></div>;

  const summary = bankSummary(bank);
  const s = stats(sel.kind === "sound" ? samples : (trackRender?.samples ?? new Float32Array(1)), sr);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark brand-mark-sfx" aria-hidden />
          <div>
            <h1 className="brand">
              Easy <span>SFX</span>
            </h1>
            <p className="brand-th">เสียงเอฟเฟกต์ 8-bit · เพลง chiptune · ระนาด ขิม ฉิ่ง</p>
            <div className="sub">
              <span className="tag tag-sky">easysfx/1</span>
              <span className="tag">{summary.sounds.length} sounds</span>
              <span className="tag">{summary.tracks.length} tracks</span>
              <span className="tag tag-leaf">Godot · PixiJS</span>
            </div>
          </div>
        </div>
        <div className="toolbar">
          <div className="tool-group">
            <label className="field-label" htmlFor="bank-pick">Bank</label>
            <div className="row nowrap">
              <select
                id="bank-pick"
                value={bankId}
                onChange={async (e) => {
                  const b = await fetchBank(e.target.value);
                  setBankId(e.target.value);
                  setBank(b.bank);
                  setSaved(JSON.stringify(b.bank));
                }}
              >
                {ws?.banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.id})
                  </option>
                ))}
              </select>
              <button type="button" className={`save-btn${dirty ? " is-dirty" : ""}`} disabled={busy === "save"} title="Save (Ctrl/⌘+S)" onClick={() => void onSave()}>
                <span className="dot" aria-hidden />
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
          </div>
          <label className="tool-group">
            <span className="field-label">Auto-play on change</span>
            <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
          </label>
        </div>
      </header>

      <main className="layout-sfx">
        <section className="panel panel-list">
          <h2>
            <span className="step">1</span> Sounds <small>{summary.sounds.length}</small>
          </h2>
          <ul className="sound-list">
            {summary.sounds.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={`sound-item${sel.kind === "sound" && sel.id === x.id ? " is-active" : ""}${x.preset === "voice" ? " is-voice" : ""}`}
                  onClick={() => {
                    setSel({ kind: "sound", id: x.id });
                    setVariant(0);
                    const c = clipsOf(x.id, bank.sounds[x.id]!)[0]!;
                    playSamples(renderSfx(c.params, c.seed, sr), sr);
                  }}
                >
                  <b>{x.id}</b>
                  <small>
                    {x.preset ?? "custom"}
                    {x.variants > 1 ? ` ×${x.variants}` : ""}
                    {x.note ? ` · ${x.note}` : ""}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <h2 className="sub-h2">
            <span className="step step-leaf">♪</span> Tracks
          </h2>
          <ul className="sound-list">
            {summary.tracks.map((t) => (
              <li key={t.id}>
                <button type="button" className={`sound-item is-track${sel.kind === "track" && sel.id === t.id ? " is-active" : ""}`} onClick={() => setSel({ kind: "track", id: t.id })}>
                  <b>{t.title}</b>
                  <small>
                    {t.bpm} bpm · {t.seconds}s · {t.order.join(" ")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className="field section">
            <label className="field-label" htmlFor="new-id">New sound from a preset</label>
            <input id="new-id" value={newId} placeholder="id (optional)" onChange={(e) => setNewId(e.target.value)} />
            <div className="preset-grid">
              {PRESETS.map((p) => (
                <button key={p} type="button" title={PRESET_LABELS[p].th} onClick={() => onNew(p)}>
                  {PRESET_LABELS[p].label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="col-main">
          <section className="panel panel-wave">
            <h2>
              <span className="step">2</span> {sel.kind === "sound" ? "Sound" : "Track"} <small>{sel.id}</small>
              {dirty && <span className="badge-dirty">unsaved</span>}
            </h2>
            {sel.kind === "sound" ? (
              <Waveform samples={samples} title={`${sel.id}${clips.length > 1 ? ` · variant ${variant + 1}/${clips.length}` : ""}`} sub={`${s.seconds.toFixed(3)} s · peak ${s.peak.toFixed(2)} · rms ${s.rms.toFixed(2)}`} />
            ) : (
              trackRender && <Waveform samples={trackRender.samples} title={track?.title ?? sel.id} sub={`${s.seconds.toFixed(2)} s · ${track?.bpm} bpm · loop`} beatSec={60 / (track?.bpm ?? 120)} loop progress={progress} />
            )}
            <div className="transport">
              <button type="button" className="primary play-btn" onClick={playCurrent}>
                ▶ Play <kbd>Space</kbd>
              </button>
              {sel.kind === "track" && (
                <button type="button" onClick={() => stopAll()}>
                  ■ Stop
                </button>
              )}
              {sel.kind === "sound" && def && (
                <>
                  <label className="tool-group inline">
                    <span className="field-label">Seed</span>
                    <input type="number" value={def.seed ?? 1} min={0} style={{ width: "6rem" }} onChange={(e) => updateSound({ seed: Number(e.target.value) })} />
                  </label>
                  <button type="button" title="New random seed" onClick={() => updateSound({ seed: Math.floor(Math.random() * 99999) + 1, params: undefined }, true)}>
                    🎲 Randomize
                  </button>
                  <button type="button" title="Bake a slightly mutated copy of the current params" onClick={() => params && updateSound({ params: mutate(params, Math.floor(Math.random() * 99999), 0.12) }, true)}>
                    ≈ Mutate
                  </button>
                  {def.params && (
                    <button type="button" onClick={() => updateSound({ params: undefined }, true)}>
                      ↺ Preset
                    </button>
                  )}
                  {clips.length > 1 && (
                    <div className="segmented">
                      {clips.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={i === variant ? "active" : ""}
                          onClick={() => {
                            setVariant(i);
                            playSamples(renderClip(c, sr), sr);
                          }}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {sel.kind === "sound" && def && params && (
            <section className="panel panel-synth">
              <h2>
                <span className="step">3</span> Synth <small>{def.preset ? `${PRESET_LABELS[def.preset].label} · ${PRESET_LABELS[def.preset].th}` : "custom"}</small>
              </h2>
              <div className="row synth-top">
                <div className="segmented" role="radiogroup" aria-label="Wave">
                  {WAVES.map((w) => (
                    <button key={w} type="button" className={params.wave === w ? "active" : ""} onClick={() => setParam("wave", w)}>
                      {w}
                    </button>
                  ))}
                </div>
                {def.preset === "voice" && (
                  <label className="tool-group inline">
                    <span className="field-label">Voice</span>
                    <select value={def.voice ?? "mid"} onChange={(e) => updateSound({ voice: e.target.value as Voice })}>
                      {VOICES.map((v) => (
                        <option key={v} value={v}>
                          {v} · {VOICE_TABLE[v].th}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="tool-group inline">
                  <span className="field-label">Variants</span>
                  <input type="number" min={1} max={8} value={def.variants ?? 1} style={{ width: "4.5rem" }} onChange={(e) => updateSound({ variants: Math.max(1, Math.min(8, Number(e.target.value))) })} />
                </label>
              </div>
              <div className="param-groups">
                {PARAM_GROUPS.map((g) => (
                  <fieldset key={g.title} className="param-group">
                    <legend>{g.title}</legend>
                    {g.keys.map((k) => {
                      const r = PARAM_RANGES[k];
                      const v = params[k] as number;
                      const overridden = def.params && k in def.params;
                      return (
                        <label key={k} className={`slider-row${overridden ? " is-set" : ""}`}>
                          <span>{r.label}</span>
                          <input type="range" min={r.min} max={r.max} step={r.step} value={v} onChange={(e) => setParam(k, Number(e.target.value))} onPointerUp={playCurrent} />
                          <output className="mono">{Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(3)}</output>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
              <p className="hint">Sliders write overrides into the bank (<code>params</code>); highlighted rows differ from the preset. Release a slider to hear it.</p>
            </section>
          )}

          {sel.kind === "track" && track && parsed && (
            <section className="panel panel-pattern">
              <h2>
                <span className="step">3</span> Patterns <small>{track.note}</small>
              </h2>
              <div className="pattern-scroll">
                <table className="pattern">
                  <thead>
                    <tr>
                      <th />
                      {track.channels.map((c) => (
                        <th key={c.name}>
                          {c.name}
                          <small>{c.instrument}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {track.order.map((pid, oi) => {
                    const pat = track.patterns[pid] ?? [];
                    const rows = track.channels.map((_, ci) => (pat[ci] ?? "").split(/\s+/).filter((t) => t && t !== "|"));
                    const len = Math.max(...rows.map((r) => r.length));
                    const start = track.order.slice(0, oi).reduce((a, p) => a + Math.max(...(track.patterns[p] ?? [""]).map((x) => x.split(/\s+/).filter((t) => t && t !== "|").length)), 0);
                    const playStep = progress !== null ? Math.floor(progress * parsed.totalSteps) : -1;
                    return (
                      <tbody key={oi}>
                        {Array.from({ length: len }, (_, si) => (
                          <tr key={si} className={`${si % track.steps === 0 ? "beat" : ""}${playStep === start + si ? " is-playing" : ""}`}>
                            <th className="mono">{si === 0 ? `${pid}` : si.toString(16).toUpperCase()}</th>
                            {rows.map((r, ci) => (
                              <td key={ci} className={`mono${r[si] && r[si] !== "." ? " note" : ""}`}>
                                {r[si] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
              <p className="hint">Edit tracks in <code>banks/{bankId}.easysfx.json</code> or via the MCP <code>write_track</code> tool. Drums: k s h o · c=ฉิ่ง p=ฉับ g=ฆ้อง.</p>
            </section>
          )}
        </div>

        <section className="panel panel-export">
          <h2>
            <span className="step">4</span> Export
          </h2>
          <div className="export-grid">
            {EXPORTS.map((p) => (
              <button key={p.id} type="button" className={p.id === "all" ? "primary" : ""} disabled={!!busy} onClick={() => void onExport(p.id)}>
                <span>{busy === `export-${p.id}` ? "Exporting…" : p.label}</span>
                <small>{p.hint}</small>
              </button>
            ))}
          </div>
          {exportRes && (
            <ul className="export-list">
              {exportRes.dirs.map((d) => (
                <li key={d} className="mono">
                  {d}
                </li>
              ))}
              {exportRes.warnings.map((w) => (
                <li key={w} className="hint err">
                  {w}
                </li>
              ))}
            </ul>
          )}
          <h3 className="sub-head">Validation</h3>
          {validation && validation.errors.length + validation.warnings.length === 0 ? (
            <p className="hint ok">✓ bank is clean</p>
          ) : (
            <ul className="diag-list">
              {[...(validation?.errors ?? []), ...(validation?.warnings ?? [])].map((d, i) => (
                <li key={i} className={`diag-${d.severity}`}>
                  <span className="mono">{d.path}</span> <span>{d.message}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="sub-head">Easy Dialogue typing blips</h3>
          <pre className="snippet">{`# Godot (SfxBank autoload)
blips.voices = {"kid": "blip_kid"}
# PixiJS
sfx.attachDialogueBox(box, {
  voices: { kid: "blip_kid" } })`}</pre>
        </section>
      </main>
      <footer className={`statusbar ${status.kind}`}>{status.text || `Workspace ${ws?.root ?? ""}`}</footer>
    </div>
  );
}
