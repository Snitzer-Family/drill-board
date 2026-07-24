---
name: verify
description: Drive DrillBoard in headless Chrome against the session dev server and screenshot the rink to verify rendering/behavior changes.
---

# Verifying DrillBoard changes

The surface is the SVG rink in the browser. The session dev server is already
running (SessionStart hook, port derived from session id — the LAN URL is in
context). Load a purpose-built drill via the `#d=` hash and screenshot it.

## Static frame (no interaction)

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --window-size=1290,700 --screenshot=/tmp/shot.png \
  --virtual-time-budget=6000 "http://localhost:<PORT>/drill-board/#d=<enc>"
```

`<enc>` = drill DSL, UTF-8 → base64 → url-safe (`+`→`-`, `/`→`_`, strip `=`);
see CLAUDE.md "Loading a sample drill via URL". Read the PNG to inspect.
The version watermark (bottom-right) confirms which build rendered.

## Driving playback / clicks

Headless Chrome alone can't click. Use puppeteer-core (no browser download —
points at system Chrome). Install it OUTSIDE the repo (no new deps rule):

```bash
mkdir -p /tmp/db-verify && cd /tmp/db-verify && npm install puppeteer-core@23
```

```js
// /tmp/db-verify/drive.mjs — node drive.mjs "<url>"
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--window-size=1290,700'] });
const page = await browser.newPage();
await page.setViewport({ width: 1290, height: 700 });
await page.goto(process.argv[2], { waitUntil: 'networkidle0' });
await page.click('.hd-scrubbtn.play');            // play/pause toggle
await new Promise(r => setTimeout(r, 3500));      // mid-animation
await page.screenshot({ path: '/tmp/playing.png' });
await browser.close();
```

Useful handles: `.hd-scrubbtn.play` (play/pause), sibling `.hd-scrubbtn`
(reset/stop). Playback state matters: planner (not animating) renders ALL
conditional branches solid/active; only during playback (animT > 0) does the
chosen run highlight and alternatives go dashed.

## Gotchas

- `node -e` with `npm exec --package=…` can't resolve the module — install
  into /tmp/db-verify and run a script file from there instead.
- Screenshots are the evidence; the final on-device check (iPhone standalone)
  is still the user's, via the LAN URL.
