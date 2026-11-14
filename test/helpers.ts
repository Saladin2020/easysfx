import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SfxBank } from "../src/shared/types.js";
import { initWorkspace } from "../src/lib/workspace.js";

/** Fresh workspace with the sample bank. */
export async function tempWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "easysfx-test-"));
  await initWorkspace(root);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function sampleBank(): Promise<SfxBank> {
  return JSON.parse(await readFile(path.join(import.meta.dirname, "..", "samples", "banks", "village.easysfx.json"), "utf8")) as SfxBank;
}
