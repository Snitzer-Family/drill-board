// The mark flag that opts ink out of Smart-pen recognition is written `sketch`
// from DSL 10. It used to be `note`, and the old spelling is still READ — every
// drill, autosave and share link saved before the rename contains it, and if it
// stopped being honoured that ink would quietly start converting into players
// and routes the next time someone tapped Convert. That is the assertion that
// matters here; the rest is round-trip hygiene.
import { parseDrill, serializeDrill } from '../src/drill-format.js';
import { DSL_VERSION } from '../src/constants.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const head = 'RINK full\n';
const mark = flag => `${head}MARK M1 #d7263d 0.5 solid${flag} 10,10 20,20 30,15\n`;
const markOf = src => parseDrill(src).pieces.find(p => p.kind === 'mark');

// --- reading both spellings ------------------------------------------------
{
  const oldWay = parseDrill(mark(' note'));
  T('old `note` parses without error', oldWay.errors, []);
  T('old `note` still opts the ink out of recognition', markOf(mark(' note')).sketch, true);

  const newWay = parseDrill(mark(' sketch'));
  T('new `sketch` parses without error', newWay.errors, []);
  T('new `sketch` opts the ink out of recognition', markOf(mark(' sketch')).sketch, true);

  T('plain ink is still convertible', !!markOf(mark('')).sketch, false);
  T('the flag is case-insensitive', [markOf(mark(' SKETCH')).sketch, markOf(mark(' Note')).sketch], [true, true]);
}

// --- writing ---------------------------------------------------------------
{
  const out = serializeDrill('full', parseDrill(mark(' sketch')).pieces);
  T('serializes as `sketch`', /\bsketch\b/.test(out), true);
  T('...and no longer writes `note`', /\bnote\b/.test(out), false);

  // the load-bearing one: an OLD file is rewritten in the new spelling with the
  // behaviour intact, so opening and saving a pre-rename drill loses nothing
  const migrated = serializeDrill('full', parseDrill(mark(' note')).pieces);
  T('an old `note` drill re-serializes as `sketch`', /\bsketch\b/.test(migrated), true);
  T('...and still round-trips as non-convertible', markOf(migrated).sketch, true);
}

// --- round trip ------------------------------------------------------------
{
  const src = serializeDrill('full', parseDrill(mark(' sketch')).pieces);
  T('round-trips byte-identically', serializeDrill('full', parseDrill(src).pieces), src);

  // lock and sketch are independent flags and must not swallow each other
  const both = markOf(`${head}MARK M1 #d7263d 0.5 solid lock sketch 10,10 20,20\n`);
  T('lock and sketch coexist', [both.lock, both.sketch], [true, true]);
  const onlyLock = markOf(`${head}MARK M1 #d7263d 0.5 solid lock 10,10 20,20\n`);
  T('lock alone does not imply sketch', [onlyLock.lock, !!onlyLock.sketch], [true, false]);
}

// --- the version that records the change -----------------------------------
T('DSL_VERSION is at least 10 (older readers drop `sketch`)', DSL_VERSION >= 10, true);
{
  const out = serializeDrill('full', parseDrill(mark(' sketch')).pieces);
  T('the stamped header matches DSL_VERSION', new RegExp(`DSL ${DSL_VERSION}\\b`).test(out), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
