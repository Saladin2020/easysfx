"""Headless Chrome check of a PixiJS export: no console errors, every sound decodes and plays, music loops.

  python3 scripts/check-pixi.py <pixi-export-dir> [screenshot.png]

Serves the folder on 127.0.0.1:8978, waits for window.__ready, plays every sound + the first track through
the SfxBank helper (@pixi/sound when the CDN is reachable, else Web Audio), prints a JSON report.
"""
import asyncio, json, os, subprocess, sys, time
from playwright.async_api import async_playwright

DIR = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
PORT = 8978
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
        pg = await b.new_page(viewport={"width": 1500, "height": 900})
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        # the page probes ./pixi.min.js and ./pixi-sound.js before the CDN — those 404s are expected
        pg.on("response", lambda r: errs.append(f"http {r.status}: {r.url}") if r.status >= 400 and not r.url.endswith(("/pixi.min.js", "/pixi-sound.js")) else None)
        await pg.goto(f"http://127.0.0.1:{PORT}/index.html")
        await pg.wait_for_function("window.__ready === true", timeout=30000)
        report = await pg.evaluate(
            """async () => {
              const { bank } = window.__sfx;
              const played = [];
              for (const s of bank.meta.sounds) { const r = await bank.play(s.id); played.push([s.id, !!r]); }
              await bank.preload("music");
              await bank.playMusic(bank.meta.tracks[0].id);
              const m = bank.music;
              const dur = bank.sound ? m.buf.duration : m.inst.buffer.duration;
              const loop = !!m.inst.loop;
              return { pixiSound: window.__sfx.pixiSound, buttons: window.__sfx.buttons.length, played, music: { id: m.id, seconds: dur, loop } };
            }"""
        )
        await pg.wait_for_timeout(400)
        if SHOT:
            await pg.locator("canvas").screenshot(path=SHOT)
        real = [e for e in errs if "GL Driver Message" not in e and "AudioContext was not allowed" not in e and "Failed to load resource" not in e]
        report["errors"] = real
        print(json.dumps(report, ensure_ascii=False))
        ok = not real and all(x[1] for x in report["played"]) and report["music"]["seconds"] > 1 and report["music"]["loop"]
        await b.close()
        if not ok:
            sys.exit(1)


try:
    asyncio.run(main())
finally:
    srv.terminate()
