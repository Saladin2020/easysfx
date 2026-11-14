"""Headless Chrome screenshots of the web editor (README images) + console error check.

  python3 scripts/capture-ui.py [url] [out-prefix]

Saves <prefix>-sound.png (synth sliders + waveform) and <prefix>-track.png (pattern view while playing).
Needs Playwright for Python and Chrome (CHROME_PATH or /usr/bin/google-chrome).
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8828/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/assets/ui-editor"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), args=["--autoplay-policy=no-user-gesture-required"])
        pg = await b.new_page(viewport={"width": 1640, "height": 1100}, device_scale_factor=1)
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_selector(".wave-canvas")
        await pg.get_by_role("button", name="blip_kid").click()
        await pg.wait_for_selector(".panel-synth")
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f"{OUT}-sound.png")
        await pg.locator(".sound-item.is-track").first.click()
        await pg.wait_for_selector(".pattern")
        await pg.get_by_role("button", name="▶ Play").click()
        await pg.wait_for_timeout(2300)
        await pg.screenshot(path=f"{OUT}-track.png")
        print("saved", OUT + "-sound.png", OUT + "-track.png")
        print("console errors:", errs)
        await b.close()
        if errs:
            sys.exit(1)


asyncio.run(main())
