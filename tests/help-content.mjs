// node tests/help-content.mjs — help articles and the seed data the authed
// shell renders.
//
// Same reasoning as content-drills.mjs: the Next build already fails on these
// (the loaders throw and the pages are force-static), but this runs in a second
// and covers two things the loaders can't check about themselves — that seed
// practice plans reference drills that actually exist, and that every relative
// link between help articles resolves.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { CONTENT } from "./paths.mjs";

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
};

const HELP = new URL("help/", CONTENT);
if (!existsSync(HELP)) {
  console.log("no content/help yet — nothing to check\n0 passed, 0 failed");
  process.exit(0);
}

const cats = JSON.parse(readFileSync(new URL("categories.json", HELP), "utf8")).categories;
const dirs = readdirSync(HELP, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

check("there is help content to check (guards a vacuous pass)", () => {
  assert.ok(cats.length > 0, "categories.json lists nothing");
  assert.ok(dirs.length > 0, "no category directories");
});

check("categories.json and the directories agree in both directions", () => {
  const listed = new Set(cats.map((c) => c.slug));
  for (const c of cats)
    assert.ok(dirs.includes(c.slug), `categories.json lists "${c.slug}" but the directory is missing`);
  for (const d of dirs)
    // A stray directory has no nav entry and no route: silently unreachable.
    assert.ok(listed.has(d), `content/help/${d} is not in categories.json — unreachable`);
});

const articles = [];
for (const c of cats) {
  const files = readdirSync(new URL(`${c.slug}/`, HELP)).filter((f) => f.endsWith(".md"));

  check(`${c.slug}: has articles`, () => {
    assert.ok(files.length > 0, `content/help/${c.slug} is empty`);
  });

  for (const f of files) {
    const raw = readFileSync(new URL(`${c.slug}/${f}`, HELP), "utf8");
    check(`${c.slug}/${f}: frontmatter and heading agree`, () => {
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
      for (const k of ["title", "summary", "order", "updated"])
        assert.ok(fm[k], `missing frontmatter "${k}"`);
      const h1 = /^#\s+(.+)$/m.exec(raw.slice(m[0].length))?.[1]?.trim();
      assert.ok(h1, "no '# ' heading");
      assert.equal(h1, fm.title, "H1 and frontmatter title disagree");
      articles.push({ cat: c.slug, slug: fm.slug, body: raw });
    });
  }
}

// Internal links are hand-written in prose, so they rot silently — the page
// still renders, the link just 404s for whoever clicks it.
check("every internal markdown link points at a real route", () => {
  const drills = new Set(
    existsSync(new URL("drills/", CONTENT))
      ? readdirSync(new URL("drills/", CONTENT)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
      : []
  );
  const help = new Set(articles.map((a) => `/help/${a.cat}/${a.slug}`));
  const catPaths = new Set(cats.map((c) => `/help/${c.slug}`));
  const STATIC = new Set(["/", "/drills", "/pricing", "/help", "/help/contact", "/planner", "/about", "/register", "/login", "/legal/terms", "/legal/privacy"]);

  const bad = [];
  for (const a of articles) {
    for (const [, href] of a.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
      const path = href.split("#")[0].replace(/\/$/, "") || "/";
      if (STATIC.has(path) || help.has(path) || catPaths.has(path)) continue;
      const drill = /^\/drills\/(.+)$/.exec(path);
      if (drill && drills.has(drill[1])) continue;
      bad.push(`${a.cat}/${a.slug}.md -> ${href}`);
    }
  }
  assert.deepEqual(bad, [], `dead internal links:\n      ${bad.join("\n      ")}`);
});

// A practice-plan block pointing at a missing drill renders a blank block
// rather than an error, which is exactly the kind of thing nobody notices.
check("seed practice plans reference drills that exist", () => {
  const seed = new URL("seed/practice-plans.ts", CONTENT);
  if (!existsSync(seed)) return;
  const src = readFileSync(seed, "utf8");
  const drills = new Set(
    readdirSync(new URL("drills/", CONTENT)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
  );
  const refs = [...src.matchAll(/drill:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "no drill references found — did the seed shape change?");
  const bad = refs.filter((r) => !drills.has(r));
  assert.deepEqual(bad, [], `practice plans reference missing drills: ${bad.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
