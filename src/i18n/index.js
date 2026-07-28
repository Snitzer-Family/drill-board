// Pulls the dictionaries together and builds the lookup function.
//
// This file is free to import (unlike ../i18n.js) because nothing outside the
// bundler loads it — vite.config.js and tests/*.mjs go to ../i18n.js for the
// import-free half of the system.
//
// All seven dictionaries are bundled statically rather than lazy-loaded. They
// are ~40 KB gzip against an app that is already one big chunk, and t() has to
// be SYNCHRONOUS: it's called from SVG render loops and from buildSteps(),
// which runs on every plan recompute. Lazy loading would mean an async init
// and therefore a flash of English on every launch — for exactly the users who
// need this feature most.

import { pluralCat, interpolate, listJoin } from "../i18n.js";
import en from "./en.js";
import sv from "./sv.js";
import fi from "./fi.js";
import cs from "./cs.js";
import sk from "./sk.js";
import de from "./de.js";
import fr from "./fr.js";

export const DICTS = { en, sv, fi, cs, sk, de, fr };

// Plural key first, then the bare key. Returns null if neither is present, so
// the caller can fall through to the next dictionary.
function pick(dict, key, pluralKey) {
  if (pluralKey && dict[pluralKey] != null) return dict[pluralKey];
  return dict[key] != null ? dict[key] : null;
}

// Builds the `t` for one language. Lookup order is
//   dictionary → English → the key itself
// The last step is deliberate: a missing key renders as "bar.menu" on screen,
// which is obviously wrong at a glance and trivially greppable. Blanking it
// would hide the bug.
export function makeT(lang) {
  const dict = DICTS[lang] || DICTS.en;

  const t = (key, vars) => {
    const pluralKey = vars && typeof vars.count === "number"
      ? `${key}.${pluralCat(lang, vars.count)}`
      : null;
    let raw = pick(dict, key, pluralKey);
    if (raw == null) raw = pick(DICTS.en, key, pluralKey);
    if (raw == null) raw = key;
    return interpolate(raw, vars);
  };

  // Carried on the function so callers don't have to thread `lang` separately.
  t.lang = lang;
  t.list = arr => listJoin(lang, arr);
  return t;
}
