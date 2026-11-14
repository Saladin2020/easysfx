import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SAFE_ID, bankSummary, validateBank } from "../shared/bank.js";
import type { Diagnostic, SfxBank } from "../shared/types.js";
import { pkgRoot } from "./assets.js";

export const CONFIG_NAME = "easysfx.config.json";
export const BANK_EXT = ".easysfx.json";

export interface EasySfxConfig {
  name: string;
  /** Bank used when a command gets no --bank. */
  bank: string;
  /** Write .ogg next to .wav in exports when ffmpeg is available. */
  ogg: boolean;
}

export const DEFAULT_CONFIG: EasySfxConfig = { name: "Easy SFX Workspace", bank: "village", ogg: true };

export function assertSafeId(id: unknown, label = "id"): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error(`Invalid ${label} ${JSON.stringify(id)} (use a-z, 0-9, _ or -)`);
  return id;
}

export function resolveWorkspace(dir = process.cwd()): string {
  return path.resolve(dir);
}

export const dirs = (root: string) => ({
  banks: path.join(root, "banks"),
  exports: path.join(root, "exports"),
});

/** Writes outside the workspace must be inside one of these (env, `:`-separated). */
export function allowedRoots(root: string): string[] {
  const extra = (process.env.EASYSFX_ALLOWED_DIRS ?? "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => path.resolve(p));
  return [path.resolve(root), ...extra];
}

/** Resolve a user path (relative to the workspace) and refuse anything outside the allowed roots. */
export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const ok = allowedRoots(root).some((r) => abs === r || abs.startsWith(r + path.sep));
  if (!ok) throw new Error(`Path ${p} is outside the workspace (allow it with EASYSFX_ALLOWED_DIRS)`);
  return abs;
}

export async function initWorkspace(dir = process.cwd(), opts: { force?: boolean } = {}): Promise<string> {
  const root = resolveWorkspace(dir);
  const d = dirs(root);
  for (const p of Object.values(d)) await mkdir(p, { recursive: true });
  const cfg = path.join(root, CONFIG_NAME);
  if (!existsSync(cfg) || opts.force) await writeFile(cfg, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  const src = path.join(pkgRoot, "samples", "banks");
  for (const f of await readdir(src)) {
    const dest = path.join(d.banks, f);
    if (!existsSync(dest) || opts.force) await copyFile(path.join(src, f), dest);
  }
  return root;
}

export async function loadConfig(root: string): Promise<EasySfxConfig> {
  const f = path.join(root, CONFIG_NAME);
  if (!existsSync(f)) return DEFAULT_CONFIG;
  return { ...DEFAULT_CONFIG, ...(JSON.parse(await readFile(f, "utf8")) as Partial<EasySfxConfig>) };
}

export function bankPath(root: string, id: string): string {
  return path.join(dirs(root).banks, `${assertSafeId(id, "bank id")}${BANK_EXT}`);
}

export async function readBankRaw(root: string, id: string): Promise<unknown> {
  const f = bankPath(root, id);
  if (!existsSync(f)) throw new Error(`Bank "${id}" not found in ${dirs(root).banks} (try: easysfx list)`);
  return JSON.parse(await readFile(f, "utf8"));
}

/** Load + validate; throws with the first errors when the bank is invalid. */
export async function loadBank(root: string, id: string): Promise<SfxBank> {
  const v = validateBank(await readBankRaw(root, id));
  if (!v.bank) throw new Error(`Bank "${id}" has ${v.errors.length} error(s):\n${v.errors.slice(0, 6).map((e) => `  ${e.path}: ${e.message}`).join("\n")}`);
  return v.bank;
}

export async function saveBank(root: string, id: string, raw: unknown, opts: { force?: boolean; dryRun?: boolean } = {}): Promise<{ file: string; saved: boolean; errors: Diagnostic[]; warnings: Diagnostic[] }> {
  const v = validateBank(raw);
  const file = bankPath(root, id);
  if (opts.dryRun || (v.errors.length && !opts.force)) return { file, saved: false, errors: v.errors, warnings: v.warnings };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
  return { file, saved: true, errors: v.errors, warnings: v.warnings };
}

export async function listBanks(root: string) {
  const d = dirs(root).banks;
  if (!existsSync(d)) return [];
  const out = [];
  for (const f of (await readdir(d)).sort()) {
    if (!f.endsWith(BANK_EXT)) continue;
    const id = f.slice(0, -BANK_EXT.length);
    if (!SAFE_ID.test(id)) continue;
    const file = path.join(d, f);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      out.push({ id, file, name: id, sounds: 0, tracks: 0, errors: 1, warnings: 0, firstError: `invalid JSON: ${(e as Error).message}`, modified: (await stat(file)).mtime.toISOString() });
      continue;
    }
    const v = validateBank(raw);
    const b = raw as Partial<SfxBank>;
    out.push({
      id,
      file,
      name: b.name ?? id,
      sounds: Object.keys(b.sounds ?? {}).length,
      tracks: Object.keys(b.tracks ?? {}).length,
      errors: v.errors.length,
      warnings: v.warnings.length,
      firstError: v.errors[0] ? `${v.errors[0].path}: ${v.errors[0].message}` : "",
      modified: (await stat(file)).mtime.toISOString(),
    });
  }
  return out;
}

export async function workspaceSummary(root: string) {
  const banks = await listBanks(root);
  const config = await loadConfig(root);
  let current = null;
  try {
    current = bankSummary(await loadBank(root, config.bank));
  } catch {
    /* default bank missing or invalid */
  }
  return { root, config, ...dirs(root), banks, current };
}

/** `bank:sound`, `sound` (default bank) → ids. */
export function splitRef(ref: string, defaultBank: string): { bank: string; id: string } {
  const [a, b] = ref.includes(":") ? ref.split(":", 2) : [defaultBank, ref];
  return { bank: assertSafeId(a, "bank id"), id: assertSafeId(b, "sound/track id") };
}
