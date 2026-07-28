// node tests/drill-core-safety.mjs — the two properties drill-core has to hold
// now that a SECOND app (the Next.js site) renders its output server-side.
//
//   1. themeCss({appShell}) — one token table, two host shapes. The board must
//      keep overflow:hidden; the site must not get it. If someone "fixes" the
//      unscrollable-site bug by overriding html/body in the site's own CSS
//      instead, the two apps' base styles fork silently — this pins the seam.
//   2. Colour tokens are validated at parse time. drill-svg.js interpolates
//      colours into SVG attributes with no escaping, so the parser is the only
//      place that can make its output safe by construction.

import assert from "node:assert/strict";
import { themeCss, THEMES } from "@coachvision/drill-core/theme.js";
import { parseDrill, serializeDrill } from "@coachvision/drill-core/drill-format.js";
import { drillSvg } from "@coachvision/drill-core/drill-svg.js";

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

/* ---------------- themeCss({ appShell }) ---------------- */

check("default themeCss() keeps the app shell unscrollable", () => {
  const css = themeCss();
  assert.match(css, /html,body\{[^}]*overflow:hidden/,
    "the board is fixed-inset; without overflow:hidden iOS rubber-bands the shell");
});

check("themeCss({appShell:false}) drops overflow:hidden and nothing else", () => {
  const site = themeCss({ appShell: false });
  assert.ok(!/html,body\{[^}]*overflow:hidden/.test(site),
    "a marketing page would be unscrollable");
  assert.match(site, /html,body\{[^}]*background:var\(--db-surface-app\)/,
    "the site must still take its background from the token, not its own CSS");
});

check("both shapes emit every theme block and the media query", () => {
  for (const css of [themeCss(), themeCss({ appShell: false })]) {
    for (const t of Object.keys(THEMES))
      assert.ok(css.includes(`[data-theme="${t}"]`), `no override block for "${t}"`);
    assert.ok(css.includes("@media (prefers-color-scheme:dark)"), "no prefers-color-scheme block");
  }
});

check("the two shapes differ ONLY by overflow:hidden", () => {
  assert.equal(themeCss().replace("overflow:hidden;", ""), themeCss({ appShell: false }),
    "appShell must not change the token output — only the html/body shell rule");
});

/* ---------------- colour validation ---------------- */

const base = (extra) => `RINK full\nPIECE F1 player 40 40 ${extra}`;

check("a valid hex colour still parses", () => {
  for (const c of ["#d7263d", "#fff", "#1F4FA3"]) {
    const d = parseDrill(base(c));
    assert.deepEqual(d.errors, [], `${c} should be accepted`);
    assert.equal(d.pieces[0].color, c);
  }
});

// The comment-stripper keeps a `#` only when 3-or-6 hex digits and a word
// boundary follow, so #rgba/#rrggbbaa are eaten as comments long before the
// parser sees them. The validator must agree with that, or it advertises
// support the format doesn't have.
check("4- and 8-digit hex are treated as comments, not colours", () => {
  for (const c of ["#ffff", "#d7263d80"]) {
    const d = parseDrill(base(c));
    assert.deepEqual(d.errors, [], `${c} should be stripped as a comment, not error`);
    assert.equal(d.pieces[0].color, "#d7263d", `${c} should leave the default colour`);
  }
});

// The attack: whitespace tokenisation means this arrives as ONE token, so it
// survives to `fill="${p.color}"` and closes the attribute.
check("an attribute-escaping colour is rejected, not rendered", () => {
  const evil = '#fff"onload=alert(1)';
  const d = parseDrill(base(evil));
  assert.equal(d.errors.length, 1, "should report exactly one parse error");
  assert.match(d.errors[0], /bad colour/, `got: ${d.errors[0]}`);
  const svg = drillSvg(serializeDrill(d.rink, d.pieces, d.title, d.desc));
  assert.ok(!svg.includes("onload"), "the payload reached the rendered SVG");
});

// MARK has TWO colour sinks — the stroke colour at token 2 and an optional
// fill= among the trailing flags. Both reach drill-svg.js unescaped.
check("MARK stroke colour is validated", () => {
  const d = parseDrill(`RINK full\nMARK m1 #fff"onload=alert(1) 1.1 solid 10,10 20,20`);
  assert.ok(d.errors.some(e => /bad colour/.test(e)),
    `MARK colour must be validated; errors were ${JSON.stringify(d.errors)}`);
});

check("MARK fill= is validated", () => {
  const d = parseDrill(`RINK full\nMARK m1 #ffd447 1.1 solid fill=fff"onload=alert(1) 10,10 20,20`);
  assert.ok(d.errors.some(e => /bad colour/.test(e)),
    `MARK fill must be validated; errors were ${JSON.stringify(d.errors)}`);
});

check("a well-formed MARK still round-trips", () => {
  const d = parseDrill(`RINK full\nMARK m1 #ffd447 1.1 solid fill=#1f4fa3:0.3 10,10 20,20`);
  assert.deepEqual(d.errors, []);
  assert.equal(d.pieces[0].color, "#ffd447");
  assert.equal(d.pieces[0].fill, "#1f4fa3");
});

check("no drill-core render path emits <script or an on* handler", () => {
  // every piece kind that takes a colour, through the real renderer
  const dsl = [
    "RINK full",
    "PIECE N2 net 183 42.5 face=180 goalie",
    "PIECE D1 player 110 20 #1f4fa3 D1 defense",
    "PIECE C1 cone 60 30",
    "PIECE L1 label 100 73 \"Regroup\" bg=#1f4fa3:0.4",
    "PIECE PK1 puck 46 26 on=D1",
  ].join("\n");
  const svg = drillSvg(dsl, { width: 640 });
  assert.ok(svg.startsWith("<svg"), "expected an SVG document");
  assert.ok(!/<script/i.test(svg), "script tag in generated SVG");
  assert.ok(!/\son[a-z]+=/i.test(svg), "event handler attribute in generated SVG");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
