// node tests/web-tokens.mjs — keeps apps/web inside the token system.
//
// The whole reason the site consumes drill-core's --db-* tokens is that
// drill-svg.js paints diagrams from the same table: a private palette here
// would render every drill in the board's LIGHT fallbacks on a dark page. That
// property is invisible in review — a hardcoded #1f2937 looks fine until
// someone switches theme — so it gets a test.
//
// Same shape as the other suites: dependency-free, plain node.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { THEMES, NON_COLOR_TOKENS } from "@coachvision/drill-core/theme.js";
import { WEB, src } from "./paths.mjs";

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

// apps/web may not exist yet on an older checkout; skip cleanly rather than fail.
if (!existsSync(new URL("package.json", WEB))) {
  console.log("apps/web not present — nothing to check\n0 passed, 0 failed");
  process.exit(0);
}

// Walk the source we author. node_modules and .next are generated and not ours.
const SKIP = new Set(["node_modules", ".next", "dist", ".turbo"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) walk(u, out);
    else out.push(u);
  }
  return out;
}
const files = walk(WEB);
const rel = (u) => u.pathname.slice(u.pathname.indexOf("/apps/web/") + 1);
const byExt = (...ext) => files.filter((u) => ext.some((e) => u.pathname.endsWith(e)));

const tsx = byExt(".tsx", ".ts");
const css = byExt(".css");

check("there is source to check (guards against a vacuous pass)", () => {
  assert.ok(tsx.length >= 5, `only ${tsx.length} ts/tsx files found — wrong path?`);
  assert.ok(css.length >= 1, "no css files found — wrong path?");
});

check("no raw colour literals in the site's CSS", () => {
  const bad = [];
  for (const u of css) {
    const text = readFileSync(u, "utf8");
    for (const m of text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])
      bad.push(`${rel(u)}: ${m}`);
  }
  assert.deepEqual(bad, [],
    `raw colours must be --db-* tokens:\n      ${bad.join("\n      ")}`);
});

check("no Tailwind arbitrary colour values in components", () => {
  const bad = [];
  for (const u of tsx) {
    const text = readFileSync(u, "utf8");
    // bg-[#123456], text-[rgb(...)], border-[hsl(...)] — all bypass the tokens
    for (const m of text.match(/-\[(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/g) || [])
      bad.push(`${rel(u)}: ${m}`);
  }
  assert.deepEqual(bad, [],
    `use a token-backed class instead:\n      ${bad.join("\n      ")}`);
});

// There are FIVE themes. `dark:` knows about two, so a site built with it looks
// right in dark and wrong in sheet/barn/slate. The tokens already flip.
check("no `dark:` variants — the tokens already flip", () => {
  const bad = [];
  for (const u of tsx) {
    const text = readFileSync(u, "utf8");
    if (/(?:^|["'\s:])dark:[a-z[-]/.test(text)) bad.push(rel(u));
  }
  assert.deepEqual(bad, [],
    `dark: understands 2 of 5 themes — add a token to theme.js instead:\n      ${bad.join("\n      ")}`);
});

// A token nobody surfaced to Tailwind is invisible to the site — which is how a
// colour ends up hardcoded "just this once".
check("every colour token is mapped into the Tailwind theme", () => {
  const globals = readFileSync(src(WEB, "app/globals.css", 2000), "utf8");
  const block = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(globals);
  assert.ok(block, "no `@theme inline` block found in globals.css");
  const mapped = new Set(
    [...block[1].matchAll(/var\(--db-([a-z0-9-]+)\)/g)].map((m) => m[1])
  );
  const missing = Object.keys(THEMES.light)
    .filter((k) => !NON_COLOR_TOKENS.includes(k))
    .filter((k) => !mapped.has(k));
  assert.deepEqual(missing, [],
    `tokens with no Tailwind mapping: ${missing.join(", ")}`);
});

check("the site asks themeCss for the document shell, not the app shell", () => {
  const layout = readFileSync(src(WEB, "app/layout.tsx", 500), "utf8");
  assert.match(layout, /themeCss\(\s*\{\s*appShell:\s*false\s*\}\s*\)/,
    "a marketing page rendered with the app shell is unscrollable");
  assert.match(layout, /suppressHydrationWarning/,
    "BOOT_SCRIPT sets data-theme before hydration; without this React warns every load");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
