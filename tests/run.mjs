// node tests/run.mjs — runs every suite in tests/ and sums the results.
//
// Auto-discovers *.mjs rather than listing them, so a new suite is enforced the
// moment it lands: nothing to remember to add to package.json or the workflow.
// Each suite runs in its own process, so one crashing can't take the rest down.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here)
  .filter(f => f.endsWith(".mjs") && f !== "run.mjs")
  .sort();

if (!suites.length) {
  console.error("no test suites found in tests/ — that is almost certainly wrong");
  process.exit(1);
}

let failed = 0;
const summary = [];
for (const f of suites) {
  const r = spawnSync(process.execPath, [join(here, f)], { encoding: "utf8" });
  const out = ((r.stdout || "") + (r.stderr || "")).trimEnd();
  const tail = out.split("\n").filter(Boolean).pop() || "(no output)";
  const ok = r.status === 0;
  if (!ok) {
    failed++;
    // only a failing suite prints in full — a green run stays readable
    console.log(`\n${"=".repeat(60)}\nFAIL  ${f}\n${"=".repeat(60)}\n${out}`);
  }
  summary.push(`  ${ok ? "ok  " : "FAIL"}  ${f.padEnd(24)} ${tail}`);
}

console.log(`\n${suites.length} suite${suites.length === 1 ? "" : "s"}`);
console.log(summary.join("\n"));
console.log(failed ? `\n${failed} suite(s) FAILED` : "\nall suites passed");
process.exit(failed ? 1 : 0);
