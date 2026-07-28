// Every esbuild JSX warning is a real render bug — but `vite build` prints them
// and still exits 0, so "the build passed" does not mean the JSX is sound.
//
// This has bitten for real. A merge resolution added a class as a SECOND
// attribute — `<div className="hd-poprow" className="hd-stephint">` — and JSX
// keeps the last one, so the layout class was silently dropped. The build said
// nothing an exit code could catch, and it reached a full browser sweep.
//
// So run the same check the build runs, and fail on it. esbuild is already
// present (vite compiles the app with it); this adds no dependency.
import { transform } from 'esbuild';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const files = readdirSync(SRC).filter(f => f.endsWith('.jsx')).sort();
T('there are .jsx files to check', files.length > 0, true);

for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8');
  const { warnings } = await transform(src, { loader: 'jsx', sourcefile: f });
  // Report the text AND the line so a failure points straight at the element.
  const found = warnings.map(w => `${f}:${w.location ? w.location.line : '?'} ${w.text}`);
  T(`${f}: no esbuild warnings`, found, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
