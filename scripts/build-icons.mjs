// node scripts/build-icons.mjs — regenerate public/ from src/app-icon.js.
//
// RUN THIS BY HAND. It is deliberately NOT wired into the build or CI, unlike
// copyPreviewPage() in vite.config.js, which is the nearest-looking precedent:
// CI runs on ubuntu with no browser, so the PNGs are generated here and
// COMMITTED. tests/app-icon.mjs is what stops them going stale.
//
// Rasterising with the system Chrome keeps the promise in CLAUDE.md rule 5 —
// no new dependencies. Two Chrome behaviours are worked around below; both were
// found the hard way and neither is obvious from the flag documentation.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appIconSvg } from "../src/app-icon.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const CHROME = process.env.CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PNGS = [
  ["apple-touch-icon.png", 180],   // iOS home screen; iOS ignores manifest icons for this
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

// favicon.ico exists for ONE reason: iOS Safari does not support SVG favicons,
// so icon.svg is invisible to it and it needs a raster candidate or it shows no
// favicon at all. Same picture as icon.svg, just rasterised.
const ICO_SIZES = [16, 32, 48];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// QUIRK 1: Chrome clamps the layout viewport to ~520 CSS px wide on macOS. Point
// it at a bare .svg — or at a wrapper sized with 100vw/100vh — and the art is
// laid out CENTRED in that 520px box and the screenshot silently captures a
// crop of it. Inlining the markup and pinning it top-left in absolute pixels is
// immune. Inlining also removes the <img> load race, so no --virtual-time-budget.
const wrapper = (svg, px) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0 }
svg { position: fixed; top: 0; left: 0; width: ${px}px; height: ${px}px; display: block }
</style></head><body>${svg}</body></html>
`;

// QUIRK 2: --screenshot writes the file and then Chrome NEVER EXITS. So we
// cannot spawnSync and wait; we poll until the file size stops changing and
// then kill it. The profile dir must be fresh per run — we SIGKILL, so a reused
// one would be left dirty and the next run would stall on session recovery.
async function shoot(svg, out, px, { alpha = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "db-icons-"));
  const page = join(dir, "icon.html");
  writeFileSync(page, wrapper(svg, px));
  rmSync(out, { force: true });

  const child = spawn(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-sync", "--disable-default-apps",
    `--user-data-dir=${join(dir, "profile")}`,
    `--window-size=${px},${px}`,
    // transparent outside the tile's rounded corners for the favicon rasters.
    // NEVER for apple-touch-icon: iOS composites its alpha against black.
    ...(alpha ? ["--default-background-color=00000000"] : []),
    `--screenshot=${out}`,
    `file://${page}`,
  ], { stdio: "ignore" });
  child.on("error", () => {});

  let size = -1, stable = 0;
  for (let i = 0; i < 200 && stable < 3; i++) {     // 20s ceiling
    await sleep(100);
    let now = -1;
    try { now = statSync(out).size; } catch { /* not written yet */ }
    stable = now > 0 && now === size ? stable + 1 : 0;
    size = now;
  }
  child.kill("SIGKILL");
  rmSync(dir, { recursive: true, force: true });
  if (size <= 0)
    throw new Error(`Chrome wrote no PNG to ${out}.\n  Tried: ${CHROME}\n`
      + `  Set CHROME=/path/to/chrome if it lives somewhere else.`);
  return size;
}

/* ---------------- .ico container ---------------- */

// ICO is a 6-byte header, then one 16-byte directory entry per image, then the
// images. The payloads are whole PNG files — legal since Windows Vista and
// understood by every browser — so no bitmap encoder is needed here.
function buildIco(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);                 // reserved
  head.writeUInt16LE(1, 2);                 // 1 = icon
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = head.length + dir.length;
  images.forEach(({ px, buf }, i) => {
    const o = i * 16;
    dir[o] = px >= 256 ? 0 : px;            // width  (0 means 256)
    dir[o + 1] = px >= 256 ? 0 : px;        // height
    dir[o + 2] = 0;                         // palette entries
    dir[o + 3] = 0;                         // reserved
    dir.writeUInt16LE(1, o + 4);            // colour planes
    dir.writeUInt16LE(32, o + 6);           // bits per pixel
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, dir, ...images.map(i => i.buf)]);
}

/* ---------------- run ---------------- */

mkdirSync(PUBLIC, { recursive: true });

const favicon = appIconSvg("favicon");
const bleed = appIconSvg("bleed");

// The PNGs are bitmaps; nothing about them tells a test whether they still match
// the art. Stamping the bleed variant's hash into icon.svg gives the drift guard
// something to compare, so changing only its field colour or its inset — neither
// of which touches icon.svg — still fails the suite instead of shipping stale
// bitmaps.
//
// The favicon needs no stamp: icon.svg IS that variant, byte-matched by the test,
// and the .ico frames are rasterised from the same string in this same run — so a
// hash of it would only be a hash of the text directly beneath it.
const sha = s => createHash("sha256").update(s).digest("hex");
writeFileSync(join(PUBLIC, "icon.svg"),
  `<!-- generated by scripts/build-icons.mjs — do not edit;`
  + ` bleed sha256:${sha(bleed)} -->\n${favicon}`);
console.log("icon.svg");

for (const [name, px] of PNGS) {
  const bytes = await shoot(bleed, join(PUBLIC, name), px);
  console.log(`${name}  ${px}x${px}  ${(bytes / 1024).toFixed(1)}kB`);
}

const scratch = mkdtempSync(join(tmpdir(), "db-ico-"));
const frames = [];
for (const px of ICO_SIZES) {
  const f = join(scratch, `f${px}.png`);
  await shoot(favicon, f, px, { alpha: true });
  frames.push({ px, buf: readFileSync(f) });
}
rmSync(scratch, { recursive: true, force: true });
const ico = buildIco(frames);
writeFileSync(join(PUBLIC, "favicon.ico"), ico);
console.log(`favicon.ico  ${ICO_SIZES.join("/")}  ${(ico.length / 1024).toFixed(1)}kB`);
