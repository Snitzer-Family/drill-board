// Skate direction is stored densely — every leg carries its own `dir` — but it
// EDITS stickily: setting a waypoint to backwards means "and everything after it,
// including down the branches", until a later waypoint is flipped the other way.
// This module is that write rule, kept pure (no DOM, no React) so it is
// node-testable on its own — see tests/route-dir.mjs.

export const dirOf = s => (s && s.dir === "bwd" ? "bwd" : "fwd");

// the direction in effect when departing waypoint `at` of `segs`
// (at < 0 = the route's own origin, which is always forward)
export const dirAtWaypoint = (segs, at) =>
  (at >= 0 && segs && segs[at] ? dirOf(segs[at]) : "fwd");

// Rewrite segs[from].dir to `dir` and carry it downstream: every following leg
// that still reads the OLD direction flips too, stopping at the first leg that
// differs — that leg is a later explicit flip and stays put. Where the run
// governs a waypoint a branch departs from, the branch is rewritten the same way,
// recursively. Returns { path, forks, changed }, handing the SAME arrays back
// when nothing moved so React identity stays stable.
export function spreadDir(segs, forks, from, dir) {
  if (!segs || from < 0 || from >= segs.length || (dir !== "fwd" && dir !== "bwd"))
    return { path: segs, forks, changed: false };
  const old = dirOf(segs[from]);
  if (old === dir) return { path: segs, forks, changed: false };
  return run(segs, forks, from, old, dir);
}

function run(segs, forks, from, oldDir, newDir) {
  const out = segs.slice();
  let segChanged = false, last = from - 1;
  for (let k = from; k < out.length; k++) {
    if (k > from && dirOf(out[k]) !== oldDir) break;   // a later explicit flip — stop the run
    if (dirOf(out[k]) !== newDir) { out[k] = { ...out[k], dir: newDir }; segChanged = true; }
    last = k;
  }
  // A branch leaves waypoint `at` (an absent `at` = the route's end) and runs in
  // PARALLEL with leg at+1 — it is the alternative continuation, not a successor.
  // So it inherits whatever we just assigned to that sibling leg; a branch off the
  // very last waypoint has no sibling and follows the last leg instead.
  let nf = forks, forkChanged = false;
  if (forks && forks.length) {
    let touched = false;
    nf = forks.map(f => {
      if (!f || !f.path || !f.path.length) return f;
      const at = Math.min(f.at != null ? f.at : segs.length - 1, segs.length - 1);
      const sib = at + 1 < segs.length ? at + 1 : at;
      if (sib < from || sib > last) return f;           // its sibling leg is outside the run
      if (dirOf(f.path[0]) !== oldDir) return f;        // branch flipped on its own — leave its subtree
      const r = run(f.path, f.forks, 0, oldDir, newDir);
      if (!r.changed) return f;
      touched = true;
      return { ...f, path: r.path, forks: r.forks };
    });
    if (!touched) nf = forks;
    forkChanged = touched;
  }
  return { path: segChanged ? out : segs, forks: nf, changed: segChanged || forkChanged };
}
