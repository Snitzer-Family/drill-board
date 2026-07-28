// The possession ledger — ONE derived, pure picture of who holds which puck where,
// and under WHAT CONDITIONS, built from the authoring model alone (no seed, no DOM).
//
// The core idea is that possession facts carry a first-class condition set: a
// conjunction of branch-choice atoms `{ playerId: branchRef }` meaning "this fact
// holds on runs where that player took that branch". Receiving a pass released on
// P3's red branch yields a stint conditioned on { P3: "#e5342b" }; P2's green branch
// gated by `when=P1!` implies whatever conditions P1's release carries. Because each
// player takes at most one branch per run, two atoms for the same player are
// compatible only when one ref is an ancestor of the other — which lets the ledger
// PROVE mutual exclusion ("P2 cannot be holding on the green branch") where the
// lineage-ancestor math alone must answer "maybe".
//
// Everything here is possibility-level (per-branch, not per-seed): the resolver's
// fixpoint stays the authority on what a CONCRETE run does. Consumers ask:
//   mayHoldOn(ledger, pieces, pid, ref)  — could pid hold an unspent puck on this route?
//   looseOn(ledger, pieces, pid, ref)    — loose pucks a collect here could target
//   branchCtx(ledger, pieces, pid, ref)  — the atoms taking this branch implies
//
// Refs are the in-memory colour-path form ("#2ea043/#e5342b"), lowercased; "" = base.

const norm = r => String(r || "").toLowerCase();
// is `a` an ancestor-or-equal lineage of `b`? ("" is an ancestor of everything)
export const isAncRef = (a, b) => { a = norm(a); b = norm(b); return !a || a === b || b.startsWith(a + "/"); };
// two lineages on ONE player's route tree can co-occur only along one root→leaf path
const refsCompat = (a, b) => isAncRef(a, b) || isAncRef(b, a);

// ----- condition sets: plain { pid: ref } conjunctions; null = unsatisfiable -----
export function mergeCond(...conds) {
  const out = {};
  for (const c of conds) {
    if (c === null) return null;
    for (const pid in (c || {})) {
      const r = norm(c[pid]);
      if (!r) continue;
      const cur = out[pid];
      if (!cur) out[pid] = r;
      else if (isAncRef(cur, r)) out[pid] = r;        // keep the deeper choice
      else if (!isAncRef(r, cur)) return null;        // two different branches of one player
    }
  }
  return out;
}
// does context `ctx` guarantee `cond` (every atom already implied)?
export const entailsCond = (ctx, cond) => {
  for (const pid in (cond || {})) { const r = ctx && ctx[pid]; if (!r || !isAncRef(cond[pid], r)) return false; }
  return true;
};
const atomsFor = (pid, ref) => (norm(ref) ? { [pid]: norm(ref) } : {});
const condKey = c => JSON.stringify(Object.keys(c || {}).sort().map(k => [k, c[k]]));
// the atoms common to EVERY condition in `list` (the disjunction's shared truth):
// whichever alternative holds, these do — for one player keep the shallowest ref
// both entail, drop the atom when refs diverge. Sound to conjoin onto an implication
// whose cause is "one of these".
function intersectConds(list) {
  if (!list.length) return {};
  const out = { ...list[0] };
  for (const c of list.slice(1)) {
    for (const pid of Object.keys(out)) {
      const a = out[pid], b = c[pid];
      if (!b) { delete out[pid]; continue; }
      if (isAncRef(a, b)) continue;             // a is the shallower — both entail it
      if (isAncRef(b, a)) out[pid] = b;         // b shallower — keep it
      else delete out[pid];                     // different branches — nothing shared
    }
  }
  return out;
}

// ----- what taking a branch IMPLIES, beyond the choice atom itself -----
// Walks the fork chain root→leaf; a `link` condition adds the linked player's route
// atom, and an `event`/`possession` condition resolves through the PREVIOUS ledger
// pass when it has exactly one candidate cause (single-candidate closure — with
// several possible causes we add nothing, degrading safely to "maybe").
function implOf(prev, pieces, pid, ref) {
  let c = atomsFor(pid, ref);
  const r = norm(ref);
  if (!r) return c;
  const p = pieces.find(q => q.id === pid && q.kind === "player");
  if (!p) return c;
  let list = p.forks || [], acc = "";
  for (const part of r.split("/")) {
    const node = (list || []).find(f => norm(f.color) === part);
    if (!node) break;
    acc = acc ? acc + "/" + part : part;
    const cond = node.cond;
    if (cond) {
      if (cond.type === "link" && cond.player && cond.route) c = mergeCond(c, atomsFor(cond.player, cond.route));
      else if (cond.type === "event" && cond.on && cond.mode !== "waypoint") {
        // "X released" ⇒ one of X's recorded losses happened ⇒ their SHARED atoms hold
        // (with several candidate releases, the intersection is what's certain).
        // CAUSALITY filter: a release whose conditions depend on THIS player's own
        // branch choice (an atom for `pid` at/under the node being decided) happens
        // downstream of the decision — it can't be the trigger that causes it.
        const admissible = x => { const a = x && x[pid]; return !a || (a !== acc && isAncRef(a, acc)); };
        const causes = [];
        for (const st of prev.stints) if (st.player === cond.on) for (const l of st.losses) causes.push(l.cond);
        const uniq = new Map(causes.filter(x => x && admissible(x)).map(x => [condKey(x), x]));
        if (uniq.size) c = mergeCond(c, intersectConds([...uniq.values()]));
      } else if (cond.type === "possession") {
        // no player = MY possession (gains on this lineage); with a player it's THAT
        // player holding — their stints live in their own route namespace. With
        // several candidate deliveries, conjoin their shared atoms (same causality
        // filter: a delivery contingent on my own downstream choice can't inform it).
        const admissible = x => { const a = x && x[pid]; return !a || (a !== acc && isAncRef(a, acc)); };
        const who = cond.player || pid;
        const gains = prev.stints.filter(st => st.player === who && (who !== pid || isAncRef(st.gainRef, acc)) && admissible(st.cond));
        if (gains.length) c = mergeCond(c, intersectConds(gains.map(g => g.cond)));
      }
      if (c === null) return null;
    }
    list = node.forks || [];
  }
  return c;
}

// ----- one build pass over every puck's chain -----
// `viability` records a proof-level verdict per authored action, keyed
// `t:<puckId>:<transferIdx>` / `x:<puckId>:<terminalIdx>`:
//   "ok"         — fires and (if it has a catcher) can deliver on at least one run
//   "no-release" — the releaser never has the puck under any satisfiable conditions
//   "no-catch"   — the release happens, but the catch point's conditions can NEVER
//                  co-occur with it (a pass dies; a chip/rim/shot lands loose)
//   "no-fire"    — a terminal whose actor never has the puck there
//   "self-pass"  — a pass with no valid OTHER target (to yourself with no give-and-go
//                  via, or no target at all). Shots/chips/rims may self-collect —
//                  only a pass needs another player or a bounce piece.
function buildPass(prev, pieces) {
  const stints = [], loose = [], viability = {};
  for (const pk of pieces) {
    if (pk.kind !== "puck") continue;
    const head = pk.carrier || (pk.pickup && pk.pickup.to) || null;
    const open = [];
    const mkStint = (player, gainRef, gainAt, gainType, cond) => {
      const st = { puck: pk.id, player, gainRef: norm(gainRef), gainAt, gainType, cond, losses: [] };
      stints.push(st); open.push(st); return st;
    };
    if (pk.carrier) mkStint(pk.carrier, "", -1, "carry", {});
    else if (pk.pickup) {
      const ref = norm(pk.pickup.atRef);
      const c = mergeCond(atomsFor(pk.pickup.to, ref), implOf(prev, pieces, pk.pickup.to, ref));
      if (c) mkStint(pk.pickup.to, ref, pk.pickup.at, "pickup", c);
    }
    const ts = pk.transfers || [];
    // legacy releaser inference (matches the app's releaserOf) for un-pinned transfers
    const inferRel = s => { let h = head; for (let k = 0; k < s; k++) if (isAncRef(norm(ts[k].atRef), norm(ts[s].atRef))) h = ts[k].to; return h; };
    ts.forEach((t, s) => {
      const vKey = `t:${pk.id}:${s}`;
      const rel = t.by || inferRel(s);
      const relRef = norm(t.atRef);
      const src = [...open].reverse().find(st => st.player === rel && refsCompat(st.gainRef, relRef));
      if (!src) { viability[vKey] = "no-release"; return; }  // releaser never has it → impossible on every run
      const relCond = mergeCond(src.cond, atomsFor(rel, relRef), implOf(prev, pieces, rel, relRef));
      if (relCond === null) { viability[vKey] = "no-release"; return; }
      src.losses.push({ kind: t.kind, ref: relRef, at: t.at, cond: relCond });
      const recvRef = norm(t.recvRef);
      const dCond = mergeCond(relCond, atomsFor(t.to, recvRef), implOf(prev, pieces, t.to, recvRef));
      viability[vKey] = (t.kind === "pass" && (!t.to || (t.to === rel && !t.via))) ? "self-pass"
        : dCond ? "ok" : "no-catch";
      if (dCond) mkStint(t.to, recvRef, t.recvAt ?? null, t.kind === "pass" ? "receive" : "collect", dCond);
      // a chip/rim/shot whose catch is MORE conditional than its release can sit loose
      // (released, nobody came) — a plain pass just dies, no loose puck
      if (t.kind !== "pass" && (dCond === null || condKey(dCond) !== condKey(relCond)))
        loose.push({ puck: pk.id, by: rel, kind: t.kind, ref: relRef, at: t.at, cond: relCond, deliveredCond: dCond });
    });
    (pk.terminals || []).forEach((t, ti) => {
      const vKey = `x:${pk.id}:${ti}`;
      const ref = norm(t.ref);
      const actor = t.by || (open.length ? open[open.length - 1].player : head);
      const src = [...open].reverse().find(st => st.player === actor && refsCompat(st.gainRef, ref));
      if (!src) { viability[vKey] = "no-fire"; return; }
      const tCond = mergeCond(src.cond, atomsFor(actor, ref), implOf(prev, pieces, actor, ref));
      if (tCond === null) { viability[vKey] = "no-fire"; return; }
      viability[vKey] = "ok";
      src.losses.push({ kind: t.kind, ref, at: t.at, cond: tCond });
      loose.push({ puck: pk.id, by: actor, kind: t.kind, ref, at: t.at, cond: tCond, deliveredCond: null });
    });
    // a placed loose puck (no carrier, no pickup, no chain) is available unconditionally
    if (!head && !ts.length) loose.push({ puck: pk.id, by: null, kind: "placed", ref: "", at: null, cond: {}, deliveredCond: null });
  }
  return { stints, loose, viability };
}

// conditions resolve through stints, which resolve through conditions — iterate a few
// bounded passes from an empty ledger (mirrors the resolver's fixpoint; conditions can
// only gain atoms between passes, so this settles fast)
export function buildLedger(pieces) {
  let ledger = { stints: [], loose: [], viability: {} };
  for (let i = 0; i < 3; i++) ledger = buildPass(ledger, pieces);
  return ledger;
}

// the condition context of standing ON route `ref` of player `pid` (the branch choice
// plus everything that choice implies); null = branch provably unreachable
export const branchCtx = (ledger, pieces, pid, ref) =>
  mergeCond(atomsFor(pid, norm(ref)), implOf(ledger, pieces, pid, norm(ref)));

// could `pid` hold an unspent puck somewhere on route `ref`? (possibility across all
// runs compatible with taking that route — the menu leads with releases when true)
export function mayHoldOn(ledger, pieces, pid, ref) {
  const r = norm(ref);
  const ctx = branchCtx(ledger, pieces, pid, r);
  if (ctx === null) return false;
  return ledger.stints.some(st => {
    if (st.player !== pid || !isAncRef(st.gainRef, r)) return false;
    const both = mergeCond(st.cond, ctx);
    if (both === null) return false;                        // gain can't co-occur with this branch
    // spent only when a loss on this lineage is GUARANTEED given the branch + gain —
    // a merely-compatible loss (fires on some sibling run) leaves "maybe holding"
    return !st.losses.some(l => isAncRef(l.ref, r) && entailsCond(both, l.cond));
  });
}

// could `pid` hold a puck ENTERING branch `ref` — a stint gained on an ANCESTOR
// route (strictly before this branch), compatible with the conditions taking the
// branch implies, and not yet spent? Drives the carry-wiggle at a branch start: a
// pickup branch whose only gain happens ON the branch reads clean until the catch,
// even when a sibling-run delivery credits the player on the shared base.
export function mayHoldEntering(ledger, pieces, pid, ref) {
  const r = norm(ref);
  if (!r) return mayHoldOn(ledger, pieces, pid, "");
  const ctx = branchCtx(ledger, pieces, pid, r);
  if (ctx === null) return false;
  return ledger.stints.some(st => {
    if (st.player !== pid || st.gainRef === r || !isAncRef(st.gainRef, r)) return false;
    const both = mergeCond(st.cond, ctx);
    if (both === null) return false;
    // spent only by a loss BEFORE the branch (strict ancestor route) — a loss ON the
    // branch itself (e.g. a shot at its waypoint) happens after entry, so the player
    // still carries IN (that's what makes the branch reachable at all)
    return !st.losses.some(l => { const lr = norm(l.ref); return lr !== r && isAncRef(lr, r) && entailsCond(both, l.cond); });
  });
}

// loose pucks a collect on `pid`'s route `ref` could target (their release can
// co-occur with taking this branch)
export function looseOn(ledger, pieces, pid, ref) {
  const ctx = branchCtx(ledger, pieces, pid, norm(ref));
  if (ctx === null) return [];
  return ledger.loose.filter(lo => mergeCond(lo.cond, ctx) !== null);
}

// The puck chain is a POSITIONAL array: transfers[s]'s releaser is whoever holds
// the puck after transfers[0..s-1]. Authoring, though, is by waypoint — so adding a
// hop that happens EARLIER in the play appends it at the END, and from there the
// chain no longer resolves: the later releases read as "isn't holding the puck",
// and the terminal (a shot) has no final holder to belong to, so the app stops
// offering it. Completing the chain (e.g. the give-and-go back) doesn't help,
// because the ORDER is still wrong.
//
// This re-derives an order that resolves. It is deliberately conservative: if the
// stored order already resolves it is returned untouched (same array identity), and
// if no order resolves it is also left alone rather than half-rewritten.
export function orderTransfers(pk) {
  const ts = (pk && pk.transfers) || [];
  if (ts.length < 2) return ts;
  // branch-tagged chains resolve per-lineage rather than by position, which a flat
  // reordering can't express — leave those to the author
  if (ts.some(t => t.atRef || t.recvRef)) return ts;
  const head = pk.carrier || (pk.pickup && pk.pickup.to) || null;
  if (!head) return ts;
  // a hop is releasable by `h` when h is the pinned actor (or none is pinned) and it
  // isn't a pass from a player to themselves (a give-and-go via a passer is fine)
  const canRelease = (t, h) => (t.by || h) === h && (t.to !== h || !!t.via);
  const resolves = order => {
    let h = head;
    for (const t of order) { if (!canRelease(t, h)) return false; h = t.to; }
    return true;
  };
  if (resolves(ts)) return ts;                       // already a valid chain — never reorder
  const left = ts.slice(), out = [];
  let h = head;
  while (left.length) {
    // of everything this holder could release, take the one they let go of FIRST:
    // earliest release waypoint, then the earliest catch (two hops off the same spot)
    const cand = left.filter(t => canRelease(t, h));
    if (!cand.length) return ts;                     // unresolvable — leave the author's order
    cand.sort((a, b) => (a.at - b.at)
      || ((a.recvAt == null ? Infinity : a.recvAt) - (b.recvAt == null ? Infinity : b.recvAt)));
    out.push(cand[0]);
    left.splice(left.indexOf(cand[0]), 1);
    h = cand[0].to;
  }
  return out;
}
