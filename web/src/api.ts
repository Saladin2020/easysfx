import type { SfxBank, Diagnostic } from "../../src/shared/types";

export interface BankListItem {
  id: string;
  name: string;
  sounds: number;
  tracks: number;
  errors: number;
}

export interface WorkspaceSummary {
  root: string;
  config: { name: string; bank: string; ogg: boolean };
  banks: BankListItem[];
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export const fetchWorkspace = () => fetch("/api/workspace").then((r) => json<WorkspaceSummary>(r));
export const fetchBank = (id: string) => fetch(`/api/banks/${id}`).then((r) => json<{ bank: SfxBank; errors: Diagnostic[]; warnings: Diagnostic[] }>(r));
export const saveBank = (id: string, bank: SfxBank) =>
  fetch(`/api/banks/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bank }) }).then((r) => json<{ ok: boolean; errors: Diagnostic[]; warnings: Diagnostic[] }>(r));
export const exportBank = (id: string, preset: string) =>
  fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, preset }) }).then((r) => json<{ dirs: string[]; files: number; warnings: string[]; ogg: boolean }>(r));
