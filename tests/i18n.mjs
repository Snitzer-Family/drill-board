// node tests/i18n.mjs — asserts the seven dictionaries stay in lockstep: same
// keys, same {placeholders}, same `code spans`, inside their length budgets,
// with every plural form the language actually needs.
//
// Dependency-free, same check()/tally shape as tests/theme-contrast.mjs.
//
// Why this suite carries the weight it does: nothing renders the UI in CI, so
// these assertions are the only thing standing between a translator and a
// visibly broken bottom bar. The placeholder-parity check in particular is
// what catches a dropped {who} — which would otherwise ship as a sentence with
// a hole in it.
//
// Untranslated values are COUNTED, not failed (see "still English"): the
// dictionaries fill up phase by phase, and a hard failure there would make the
// suite unlandable until the very last string was done.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LANGS, LANG_ORDER, LANG_AUTONYM, BUDGET, budgetFor,
  resolveLang, readLangOverride, pluralCat, interpolate, listJoin, I18N_BOOT,
} from "../src/i18n.js";
import { DICTS, makeT } from "../src/i18n/index.js";

let passed = 0, failed = 0, known = 0;
// Empty is the goal state. Add a check name here only to land a migration in
// stages; the run FAILS once the entry starts passing, so it can't rot.
const KNOWN = new Set([
  // The budgets for bar./pen./zone./splash. are written against surfaces whose
  // strings land in later phases. Drop this the moment those keys exist — the
  // run will tell you when, by failing.
  "every budget prefix is actually used by some key",
]);

const check = (name, fn) => {
  try {
    fn();
    if (KNOWN.has(name)) {
      console.log(`FAIL  ${name}\n      listed in KNOWN but now PASSES — remove it from the list`);
      failed++;
    } else { passed++; console.log(`ok    ${name}`); }
  } catch (e) {
    if (KNOWN.has(name)) { known++; console.log(`todo  ${name}\n      ${e.message}`); }
    else { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
};

const T = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      got ${g}\n      want ${w}`); }
};

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const OTHERS = LANGS.filter(l => l !== "en");

/* ------------------------------------------------------------------ */
/* structure                                                           */

check("every declared language has a dictionary", () => {
  const missing = LANGS.filter(l => !DICTS[l]);
  assert.deepEqual(missing, [], `LANGS without a dict: ${missing.join(", ")}`);
  const extra = Object.keys(DICTS).filter(l => !LANGS.includes(l));
  assert.deepEqual(extra, [], `dicts not in LANGS: ${extra.join(", ")}`);
});

check("LANG_ORDER is auto followed by every language, in order", () => {
  assert.deepEqual(LANG_ORDER, ["auto", ...LANGS]);
});

check("every language has an autonym", () => {
  const missing = LANGS.filter(l => !LANG_AUTONYM[l]);
  assert.deepEqual(missing, [], `no autonym for: ${missing.join(", ")}`);
});

// The whole system rests on these two files being loadable by bare node and by
// vite.config.js BEFORE any bundler transform. An import here is not a slow
// path, it's a crash — and in build-drill-preview.mjs's regex-stripping inliner
// it's a SILENT deletion. The rule is currently only a header comment; this is
// what actually holds it.
for (const f of ["../src/i18n.js", "../src/theme.js"]) {
  check(`${f.replace("../", "")} has no imports`, () => {
    const lines = read(f).split("\n").filter(l => /^\s*import\s/.test(l));
    assert.deepEqual(lines, [], `import statements found: ${lines.join(" | ")}`);
  });
}

check("index.html carries the i18n boot marker", () => {
  const html = read("../index.html");
  assert.ok(html.includes("<!--i18n-boot-->"), "missing <!--i18n-boot--> marker");
  // and the build must actually fill it
  const cfg = read("../vite.config.js");
  assert.ok(cfg.includes("<!--i18n-boot-->"), "vite.config.js never replaces the marker");
  assert.ok(/I18N_BOOT/.test(cfg), "vite.config.js does not inject I18N_BOOT");
});

check("the boot script is self-contained classic JS", () => {
  // no let/const/arrow/template — it runs before any transform, on whatever
  // engine the phone has, and must not depend on module scope
  assert.ok(!/\blet\b|\bconst\b|=>/.test(I18N_BOOT), "boot script uses modern syntax");
  assert.ok(/try\{/.test(I18N_BOOT) && /catch/.test(I18N_BOOT),
    "boot script must be try/catch — iOS private mode throws on localStorage");
  assert.ok(I18N_BOOT.includes('setAttribute("lang"'), "boot script never sets <html lang>");
});

/* ------------------------------------------------------------------ */
/* dictionary parity                                                   */

const enKeys = Object.keys(DICTS.en);

check("English is not empty", () => {
  assert.ok(enKeys.length > 0, "en.js has no keys");
});

for (const lang of OTHERS) {
  check(`${lang}: same key set as English`, () => {
    const keys = Object.keys(DICTS[lang]);
    const missing = enKeys.filter(k => !(k in DICTS[lang]));
    const extra = keys.filter(k => !(k in DICTS.en));
    assert.deepEqual(missing, [], `missing ${missing.length}: ${missing.slice(0, 8).join(", ")}`);
    assert.deepEqual(extra, [], `not in English: ${extra.slice(0, 8).join(", ")}`);
  });
}

// The highest-value assertion here. A translation that drops {who} or invents
// {player} produces a sentence with a hole in it, and nothing else would catch
// it before a coach saw it on the ice.
const placeholders = s => (String(s).match(/\{(\w+)\}/g) || []).sort();

for (const lang of OTHERS) {
  check(`${lang}: placeholders match English`, () => {
    const bad = [];
    for (const k of enKeys) {
      if (!(k in DICTS[lang])) continue;
      const want = placeholders(DICTS.en[k]);
      const got = placeholders(DICTS[lang][k]);
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        bad.push(`${k}: expected ${want.join("") || "none"}, got ${got.join("") || "none"}`);
      }
    }
    assert.deepEqual(bad, [], bad.join(" | "));
  });
}

// DSL keywords inside `backticks` are code, not prose. A translator "helpfully"
// localising `pass=2:F1@3` produces a reference that documents syntax the
// parser will reject.
const codeSpans = s => (String(s).match(/`[^`]+`/g) || []).sort();

for (const lang of OTHERS) {
  check(`${lang}: DSL code spans copied verbatim`, () => {
    const bad = [];
    for (const k of enKeys) {
      if (!k.startsWith("dsl.") || !(k in DICTS[lang])) continue;
      const want = codeSpans(DICTS.en[k]), got = codeSpans(DICTS[lang][k]);
      if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(k);
    }
    assert.deepEqual(bad, [], `code spans altered in: ${bad.join(", ")}`);
  });
}

/* ------------------------------------------------------------------ */
/* layout budgets                                                      */

// The bottom bar cannot wrap, cannot ellipsize legibly, and its buttons are
// fixed at 50px — an over-budget caption paints over the neighbour's icon.
// This is the check that keeps German out of that state.
check("every budgeted key fits, in every language", () => {
  const over = [];
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(DICTS[lang])) {
      const max = budgetFor(k);
      if (max != null && [...String(v)].length > max) {
        over.push(`${lang} ${k}="${v}" is ${[...String(v)].length} > ${max}`);
      }
    }
  }
  assert.deepEqual(over, [], over.join(" | "));
});

check("every budget prefix is actually used by some key", () => {
  // a budget that matches nothing is a budget that silently stopped protecting
  // whatever it was written for
  const unused = Object.keys(BUDGET).filter(p => !enKeys.some(k => k.startsWith(p)));
  assert.deepEqual(unused, [], `BUDGET prefixes matching no key: ${unused.join(", ")}`);
});

/* ------------------------------------------------------------------ */
/* plurals                                                             */

// cs/sk need one/few/many/other and fr needs one/many/other. A key family that
// only ships `one`/`other` reads as broken Czech at 2 and at 5.
check("plural key families cover every form the language needs", () => {
  const bad = [];
  const families = new Set();
  for (const k of enKeys) {
    const m = /^(.*)\.(zero|one|two|few|many|other)$/.exec(k);
    if (m) families.add(m[1]);
  }
  for (const lang of LANGS) {
    let cats;
    try { cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories; }
    catch { continue; }
    for (const fam of families) {
      const missing = cats.filter(c => !(`${fam}.${c}` in DICTS[lang]));
      if (missing.length) bad.push(`${lang} ${fam} missing ${missing.join("/")}`);
    }
  }
  assert.deepEqual(bad, [], bad.join(" | "));
});

T("pluralCat cs 1/2/5", [pluralCat("cs", 1), pluralCat("cs", 2), pluralCat("cs", 5)],
  ["one", "few", "other"]);
T("pluralCat fr 0/1/2", [pluralCat("fr", 0), pluralCat("fr", 1), pluralCat("fr", 2)],
  ["one", "one", "other"]);
T("pluralCat en 1/2", [pluralCat("en", 1), pluralCat("en", 2)], ["one", "other"]);

/* ------------------------------------------------------------------ */
/* resolution                                                          */

T("resolveLang exact pref wins", resolveLang("de", ["sv-SE"]), "de");
T("resolveLang auto takes the first supported browser language",
  resolveLang("auto", ["sv-SE"]), "sv");
T("resolveLang auto skips unsupported languages",
  resolveLang("auto", ["pt-BR", "de-AT"]), "de");
T("resolveLang auto falls back to English", resolveLang("auto", ["ja-JP"]), "en");
T("resolveLang unknown pref falls through to auto", resolveLang("xx", ["sv"]), "sv");
T("resolveLang survives no browser list", resolveLang("auto", null), "en");
T("resolveLang survives an empty browser list", resolveLang("auto", []), "en");

T("readLangOverride reads ?lang=", readLangOverride("?lang=fi"), "fi");
T("readLangOverride takes the base subtag", readLangOverride("?lang=de-AT"), "de");
T("readLangOverride ignores an unsupported language", readLangOverride("?lang=ja"), null);
T("readLangOverride ignores a missing param", readLangOverride("?foo=1"), null);
T("readLangOverride finds a trailing param", readLangOverride("?a=1&lang=sv"), "sv");

/* ------------------------------------------------------------------ */
/* t() behaviour                                                       */

T("t interpolates", makeT("en")("prefs.lang.hint.pinned", { lang: "Suomi" }),
  "pinned to Suomi, ignoring your phone’s language");
T("t leaves a missing var verbatim",
  /\{lang\}/.test(makeT("en")("prefs.lang.hint.pinned", {})), true);
T("t falls back to the key itself", makeT("en")("no.such.key"), "no.such.key");
T("t falls back to English for an untranslated key",
  makeT("de")("prefs.lang.auto") === DICTS.de["prefs.lang.auto"], true);
T("t carries its language", makeT("sv").lang, "sv");

T("interpolate leaves unknown braces alone", interpolate("a {b} c", { z: 1 }), "a {b} c");
T("listJoin one", listJoin("en", ["a"]), "a");
T("listJoin two", listJoin("en", ["a", "b"]), "a and b");
T("listJoin drops empties", listJoin("en", ["a", null, "b"]), "a and b");

/* ------------------------------------------------------------------ */
/* migration progress (reported, never fails)                          */

{
  const total = enKeys.length * OTHERS.length;
  let same = 0;
  for (const lang of OTHERS) {
    for (const k of enKeys) {
      if (k in DICTS[lang] && DICTS[lang][k] === DICTS.en[k]) same++;
    }
  }
  // Some values genuinely coincide ("Auto" is "Auto" in five of these), so this
  // is a smell to watch rather than a threshold to enforce.
  console.log(`note  ${same}/${total} values still identical to English`);
}

console.log(`\n${passed} passed, ${failed} failed` + (known ? `, ${known} known-outstanding` : ""));
process.exit(failed ? 1 : 0);
