// node tests/content-drills.mjs — every drill content file must parse, render
// and stay inside the taxonomy.
//
// The Next build already fails on a bad drill (the pages are force-static and
// lib/content/drills.ts throws), so why this too? Because `npm test` runs in
// about a second and `next build` does not — this is the fast feedback loop
// while writing content, and it also covers the two things the loader can't
// assert about ITSELF: that the rendered SVG carries no script/handler, and
// that the share hash decodes back to the exact DSL.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { extractDrill, parseDrill, deriveInventory } from "@coachvision/drill-core/drill-format.js";
import { drillSvg } from "@coachvision/drill-core/drill-svg.js";
import { CONTENT } from "./paths.mjs";

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

const DRILLS = new URL("drills/", CONTENT);
if (!existsSync(DRILLS)) {
  console.log("no content/drills yet — nothing to check\n0 passed, 0 failed");
  process.exit(0);
}

const files = readdirSync(DRILLS).filter((f) => f.endsWith(".md")).sort();
const taxonomy = JSON.parse(readFileSync(new URL("taxonomy.json", CONTENT), "utf8"));

check("there are drills to check (guards a vacuous pass)", () => {
  assert.ok(files.length > 0, "content/drills is empty");
});

const slugs = new Set();

for (const f of files) {
  const raw = readFileSync(new URL(f, DRILLS), "utf8");

  check(`${f}: frontmatter + body are well formed`, () => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    assert.ok(m, "no frontmatter block");
    const fm = Object.fromEntries(
      m[1].split(/\r?\n/).filter(Boolean).map((l) => {
        const i = l.indexOf(":");
        assert.ok(i > 0, `frontmatter line has no ":" — ${l}`);
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
    );
    assert.equal(fm.slug, f.replace(/\.md$/, ""), "slug must equal the filename stem");
    assert.ok(!slugs.has(fm.slug), `duplicate slug ${fm.slug}`);
    slugs.add(fm.slug);
    for (const k of ["summary", "zone", "level", "duration", "players", "updated"])
      assert.ok(fm[k], `missing frontmatter "${k}"`);

    // A tag outside the taxonomy silently creates an orphan facet with one
    // drill on it — visible to nobody until someone clicks it.
    const listOf = (k) => (fm[k] ?? "[]").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    assert.ok(fm.zone in taxonomy.zones, `zone "${fm.zone}" not in taxonomy`);
    assert.ok(fm.level in taxonomy.levels, `level "${fm.level}" not in taxonomy`);
    for (const t of listOf("tags")) assert.ok(t in taxonomy.tags, `tag "${t}" not in taxonomy`);
    for (const s of listOf("skills")) assert.ok(s in taxonomy.skills, `skill "${s}" not in taxonomy`);
  });

  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  check(`${f}: has a drill fence and parses cleanly`, () => {
    // extractDrill returns its INPUT UNCHANGED when there's no fence, so a
    // missing fence would sail through and parse prose as DSL.
    assert.match(body, /```drill\s/, "no ```drill fence");
    const dsl = extractDrill(body);
    const d = parseDrill(dsl);
    assert.deepEqual(d.errors, [], `parse errors: ${d.errors.join("; ")}`);
    assert.ok(d.pieces.length > 0, "drill has no pieces");
    assert.ok(deriveInventory(d.pieces, d.items).length > 0, "empty inventory");

    // Authored in two places, so they drift.
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    assert.ok(h1, "no '# ' heading");
    assert.equal(h1, d.title, "markdown H1 and DSL TITLE disagree");
  });

  check(`${f}: renders to a safe SVG`, () => {
    const svg = drillSvg(extractDrill(body), { width: 960 });
    assert.ok(svg.startsWith("<svg"), "not an SVG document");
    assert.match(svg, /viewBox=/, "no viewBox");
    // The whole reason server-rendering this markup is acceptable.
    assert.ok(!/<script/i.test(svg), "generated SVG contains <script");
    assert.ok(!/\son[a-z]+\s*=/i.test(svg), "generated SVG contains an on* handler");
  });

  check(`${f}: share hash round-trips byte-for-byte`, () => {
    const dsl = extractDrill(body);
    const enc = Buffer.from(dsl, "utf8").toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const back = Buffer.from(enc.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    assert.equal(back, dsl, "the board would receive different bytes than we rendered");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
