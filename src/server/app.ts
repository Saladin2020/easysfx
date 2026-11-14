import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEV_UI_ORIGINS, checkRequest } from "../shared/requestGuard.js";
import { bankSummary, validateBank } from "../shared/bank.js";
import type { SfxBank } from "../shared/types.js";
import { exportBank, type ExportPreset } from "../lib/export.js";
import { renderRef, waveformPng, wavBytes } from "../lib/audio.js";
import { assertSafeId, listBanks, loadBank, readBankRaw, saveBank, workspaceSummary } from "../lib/workspace.js";

export interface CreateAppOptions {
  workspaceRoot: string;
  webRoot?: string;
  dev?: boolean;
  host?: string;
  token?: string;
}

const TOKEN_COOKIE = "easysfx_token";
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function tokenPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Easy SFX</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy SFX token required</h1>
<p>Paste the token printed in the terminal that started Easy SFX.</p>
<form method="get"><input name="token" autocomplete="off" style="width:22rem"> <button>Open</button></form>
</body>`;
}

const bytes = (buf: Buffer) => new Uint8Array(buf);

export function createApp(options: CreateAppOptions): Hono {
  const app = new Hono();
  const { workspaceRoot: root, webRoot, dev, host = "127.0.0.1", token } = options;
  const guard = { bindHost: host, token, extraOrigins: dev ? DEV_UI_ORIGINS : [] };

  app.use("*", async (c, next) => {
    const queryToken = c.req.query("token");
    const provided = c.req.header("x-easysfx-token") ?? queryToken ?? getCookie(c, TOKEN_COOKIE);
    const denied = checkRequest(guard, { method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin"), token: provided });
    if (denied) {
      if (denied.status === 401 && c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.html(tokenPage(), 401);
      return c.json({ error: denied.error }, denied.status);
    }
    if (token && queryToken) setCookie(c, TOKEN_COOKIE, queryToken, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, workspaceRoot: root }));
  app.get("/api/workspace", async (c) => c.json(await workspaceSummary(root)));
  app.get("/api/banks", async (c) => c.json({ banks: await listBanks(root) }));

  app.get("/api/banks/:id", async (c) => {
    try {
      const raw = await readBankRaw(root, c.req.param("id"));
      const v = validateBank(raw);
      return c.json({ id: c.req.param("id"), bank: raw, errors: v.errors, warnings: v.warnings, summary: v.bank ? bankSummary(v.bank) : null });
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/banks/:id", async (c) => {
    try {
      const body = (await c.req.json()) as { bank: unknown; force?: boolean };
      const res = await saveBank(root, c.req.param("id"), body.bank, { force: body.force });
      return c.json({ ok: res.saved, file: res.file, errors: res.errors, warnings: res.warnings });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/validate", async (c) => {
    const body = (await c.req.json()) as { bank: unknown };
    const v = validateBank(body.bank);
    return c.json({ errors: v.errors, warnings: v.warnings });
  });

  /** Render a ref from a saved bank (or an unsaved `bank` body) as WAV or waveform PNG. */
  app.post("/api/render", async (c) => {
    try {
      const body = (await c.req.json()) as { id?: string; bank?: SfxBank; ref: string; format?: "wav" | "png"; variant?: number };
      let bank: SfxBank;
      if (body.bank) {
        const v = validateBank(body.bank);
        if (!v.bank) return c.json({ error: "Bank has errors", errors: v.errors }, 400);
        bank = v.bank;
      } else bank = await loadBank(root, assertSafeId(body.id, "bank id"));
      const r = renderRef(bank, assertSafeId(body.ref, "sound/track id"), { variant: body.variant });
      if (body.format === "png") return c.body(bytes(waveformPng(r)), 200, { "Content-Type": "image/png" });
      return c.body(bytes(wavBytes(r)), 200, { "Content-Type": "audio/wav" });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/export", async (c) => {
    try {
      const body = (await c.req.json()) as { id: string; preset?: ExportPreset; out?: string };
      const res = await exportBank(root, { bank: assertSafeId(body.id, "bank id"), preset: body.preset, out: body.out });
      return c.json({ ok: true, ...res, files: res.files.length });
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  if (!dev && webRoot) {
    app.use("/*", serveStatic({ root: webRoot }));
    app.get("*", async (c) => {
      try {
        return c.html((await readFile(path.join(webRoot, "index.html"))).toString("utf8"));
      } catch {
        return c.text("Web UI not built yet. Run npm run build:web or start with --dev.", 503);
      }
    });
  } else if (dev) {
    app.get("/", (c) =>
      c.html(`<!doctype html><meta charset="utf-8"><title>Easy SFX (dev)</title>
<body style="font-family:system-ui;background:#1a1410;color:#f3e7d3;padding:2rem">
<h1>Easy SFX API is running</h1><p>Workspace: <code>${root}</code></p>
<p>Open the Vite UI at <a href="http://127.0.0.1:5178" style="color:#f0c36a">http://127.0.0.1:5178</a></p></body>`),
    );
  }
  return app;
}

export function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../web/dist"), path.resolve(here, "../../web/dist")];
  return candidates.find((p) => existsSync(path.join(p, "index.html"))) ?? candidates[1]!;
}
