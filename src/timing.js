// Timing & pass-planning engine: leg times, receiver warps, transfer chains,
// shots, releases, and warp-aware positions. Pure functions over the pieces
// array; the React component passes its refs in each render.
import { SPEED, ICON_SCALE, PLAYER_SCALE, SAVE_PROB, MISS_POST, MISS_WIDE, MISS_OVER, SHOT_AIR_PROB, BOUNCE_REST } from "./constants.js";
import { clampX, clampY, segEnd, segTangentAngle } from "./geometry.js";
import * as boards from "./boards.js";
import { netShapes, solidShapes, bumperShapes, reflectPath, segCrossesNet, bounceOffNets } from "./net-collide.js";

// A "nearest" loose-puck collect (pickup.nearest) is a live intent, not a fixed
// binding: at play/render time the collect grabs whichever loose puck sits
// closest to the collector's gather spot — re-resolving as the drill is edited.
// This rewrites the pieces array so each nearest intent's whole action-chain
// (pickup → transfers → terminal) rides the actually-nearest loose puck, while
// the puck it was authored on becomes plain loose. Ids and positions are left
// untouched, so rendering (keyed by id) and serialization stay on the raw array.
export function resolveNearest(pieces) {
  const intents = pieces.filter(p => p.kind === "puck" && p.pickup && p.pickup.nearest);
  if (!intents.length) return pieces;
  // "plain loose": nothing authored on it at all. `terminals` counts — a puck
  // someone is due to shoot is not free for a nearest-collect to steal, even
  // though its shot hasn't been lowered to a scalar yet.
  const looseOK = q => !q.carrier && !q.pickup && !(q.transfers || []).length
    && !(q.terminals || []).length
    && q.shotAt == null && q.rimAt == null && q.chipAt == null;
  let out = pieces;                       // clone lazily, only if something migrates
  const claimed = new Set();              // pucks already assigned to a collector
  for (const owner of intents) {
    const pl = pieces.find(q => q.id === owner.pickup.to && q.kind === "player");
    if (!pl) continue;
    const spot = pl.path.length ? segEnd(pl, Math.min(owner.pickup.at, pl.path.length - 1)) : { x: pl.x, y: pl.y };
    // candidates: the puck it was authored on (its position) + any plain loose
    // puck not already claimed by an earlier nearest collect
    const cands = pieces.filter(q => q.kind === "puck" && !claimed.has(q.id)
      && (q.id === owner.id || looseOK(q)));
    if (!cands.length) { claimed.add(owner.id); continue; }
    const d = q => Math.hypot(q.x - spot.x, q.y - spot.y);
    const near = cands.reduce((b, q) => (d(q) < d(b) ? q : b));
    claimed.add(near.id);
    if (near.id === owner.id) continue;   // already sits nearest — nothing to move
    if (out === pieces) out = pieces.slice();
    const oi = out.findIndex(q => q.id === owner.id), ni = out.findIndex(q => q.id === near.id);
    // `terminals` is the AUTHORING form of shoot=/rim=/chip= — what the parser
    // produces and what resolveForks later lowers into the scalars below. This
    // pass runs BEFORE that lowering, so at this point the scalars are still
    // undefined and terminals holds the whole story. Moving only the scalars left
    // the shot behind on the puck we had just emptied: "collect the nearest puck
    // and shoot it" collected, then carried it forever.
    out[ni] = { ...out[ni], carrier: null, pickup: { ...owner.pickup },
      transfers: owner.transfers || [], terminals: owner.terminals,
      shotAt: owner.shotAt, rimAt: owner.rimAt, chipAt: owner.chipAt,
      rimAim: owner.rimAim, chipAim: owner.chipAim, chipDist: owner.chipDist, rimDist: owner.rimDist,
      net: owner.net, termBy: owner.termBy };
    out[oi] = { ...out[oi], carrier: null, pickup: null, transfers: [], terminals: undefined,
      shotAt: null, rimAt: null,
      chipAt: null, rimAim: null, chipAim: null, chipDist: null, rimDist: null, net: null, termBy: null };
  }
  return out;
}

const GOALIE_DEPTH = 2.5; // how far out front of the net the goalie plays
// stickhandling cradle: ONE oscillation, applied to the stick's rotation — the puck
// rides the blade tip through it, so they move together by construction rather than
// by two amplitudes being kept in step by hand.
const DRIB_W = 2 * Math.PI * 2.0;          // ~2 cradles per second
const DRIB_SWING = 7;                       // matching stick sweep (deg)

// A forward↔backward transition is a PIVOT, not a teleport: the skater sweeps
// through 180° over this long, centred on the waypoint where the direction
// changes (or standing in place, if they pause there).
const PIVOT_SEC = 0.4;
// Opening up: a receiver whose pass would arrive on the backhand turns to face
// where the puck is coming from, takes it on the forehand, then squares back up
// and skates on. Times are relative to the catch.
const OPEN_IN = 0.7, OPEN_SET = 0.15, OPEN_HELD = 0.2, OPEN_OUT = 0.45;
const OPEN_BACK_FT = 15;   // how far back down the puck's path counts as "where it came from"
// icons.jsx rotates the whole stick group about (1, 0) in icon units, so a point on
// the blade travels with it. Swinging the puck's lever by the SAME angle is what
// keeps the puck welded to the blade instead of orbiting it on its own cradle.
const STICK_PIVOT = 1;
const swungLever = (fwd, lat, deg) => {
  if (!deg) return { fwd, lat };
  const r = (deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  const dx = fwd - STICK_PIVOT, dy = lat;
  return { fwd: STICK_PIVOT + dx * c - dy * sn, lat: dx * sn + dy * c };
};

// A shot or pass is released a stride's width off to the strong side and only just
// in front of the near foot — NOT off the toe of a stick pointed down the barrel.
// On a compass with the player's nose at N, a right shot's forehand release lives
// around NE→E and a left shot's around NW→W; the icon mirrors the stick group by
// hand, so one set of (forward, lateral) numbers covers both. Icon units, ×ICON_SCALE
// to get feet — the same convention as BLADE_/TIP_ in the animator.
const TIP_FWD_U = 5.6, TIP_LAT_U = 2.45;         // the drawn blade tip, in icon units
// How far the stick group swings from its drawn rest pose to release. The release
// SPOT is derived from the swing rather than specified alongside it — that is what
// guarantees the puck is exactly on the blade at the moment it leaves.
const RELEASE_SWING = 44;                        // forehand: blade round to ~72° off the nose
const BACK_SWING = -75;                          // backhand: round the other way, off the far face
// A backhand is not an arms shot. The shoulders come round into it and the whole body
// turns with the release, then unwinds. Applied to the heading, so the stick and the
// puck riding it come along by construction — and folded into the launch point too,
// or the puck would leave from a blade the body had already turned away from.
const BACK_TWIST = 28;
// ...and the release spots themselves, derived rather than declared alongside
const FORE_LEVER = swungLever(TIP_FWD_U, TIP_LAT_U, RELEASE_SWING);
const BACK_LEVER = swungLever(TIP_FWD_U, TIP_LAT_U, BACK_SWING);
// piecewise smoothstep through [t, value] keyframes — reads as an animation curve
const keyframe = (ks, t) => {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) {
      const [t0, v0] = ks[i - 1], [t1, v1] = ks[i];
      return v0 + (v1 - v0) * smooth01(t1 > t0 ? (t - t0) / (t1 - t0) : 1);
    }
  }
  return ks[ks.length - 1][1];
};
const CENTRE_Y = 42.5;                                            // mid-ice, the default thing to open toward
const stepFlip = s => (s && s.dir === "bwd" ? 180 : 0);           // the old instant flip
const smooth01 = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const wrapDeg = d => ((d % 360) + 540) % 360 - 180;               // → (-180, 180]

export function createTiming({ pieces, pace, segRefs, planCache, seed = 0, realisticShots = true, detail = true, odds }) {
  // tunable shot odds (0..1), falling back to the constant defaults; `bounce` is
  // the fraction of speed a missed puck keeps when it caroms off a board or post
  const OD = { save: SAVE_PROB, post: MISS_POST, wide: MISS_WIDE, over: MISS_OVER, air: SHOT_AIR_PROB, bounce: BOUNCE_REST, ...(odds || {}) };
  // deterministic per-shot randomness — stable within a playback, varies as the
  // play seed changes so replays can produce different saves/goals
  const hashStr = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const rand = salt => { const x = Math.sin((seed + 1) * 99991 + hashStr(salt) * 131) * 43758.5453; return x - Math.floor(x); };
  /* ----- timing ----- */
  function segLen(id, i) {
    const el = segRefs.current[`${id}/${i}`];
    try { return el ? el.getTotalLength() : 0; } catch { return 0; }
  }
  function segMoveTime(p, s, i) {
    const v = pace * SPEED[s.mode || "carry"] * (p.speed || 1) * (s.rate || 1);
    return v > 0 ? segLen(p.id, i) / v : 0;
  }
  const lenSig = pieces.reduce((a, p) => a + p.path.reduce((b, _, i) => b + segLen(p.id, i), 0), 0);

  /* ---- pass planning ----
     Pucks can be handed between players: each transfer launches at a
     point on the current carrier's route and flies (at PASS speed) to
     the receiver. If the transfer names a reception point (recvAt), the
     receiver's legs up to that point are time-warped so they arrive
     exactly as the puck does; otherwise the puck leads the receiver to
     wherever they will be when it lands. After the last transfer the
     puck's own route (if any) releases by the usual proximity rule. */

  function effMove(p, s, i, warp) {
    const base = segMoveTime(p, s, i);
    const w = warp[p.id];
    return w && i <= w.upto ? base / w.f : base;
  }

  // blue-line entry delay: playerId -> { seg, dur } holds a "hold=line" player
  // at the start of segment `seg` (their last neutral waypoint) for `dur`
  // seconds, until the puck first crosses into the zone they're entering.
  let currentHolds = {};
  const holdAt = (p, i) => { const h = currentHolds[p.id]; return h && h.seg === i ? h.dur : 0; };
  // per-player start delay: the player waits this many seconds before beginning
  // their route (until a trigger — another player reaching a waypoint — fires)
  let currentStartWait = {};
  const startWaitOf = p => currentStartWait[p.id] || 0;
  // trigger pause: a waypoint can pause the player until another player reaches
  // a waypoint. Resolved to an extra hold (seconds) on that segment, keyed
  // "playerId/segIndex", so it flows through the same machinery as a fixed stop.
  let currentTrigPause = {};
  const trigPauseOf = (p, i) => currentTrigPause[p.id + "/" + i] || 0;
  // pivot windows: pieceId -> { path, byIdx: Map(boundary i -> { from, to, t0, t1, sign }) },
  // where boundary i is the waypoint between legs i and i+1 and t0/t1 are ROUTE-LOCAL
  // seconds. Resolving a window's sweep direction needs the other pieces' positions,
  // which means calling back into the position machinery — `planPhase` makes
  // that re-entrant pass fall back to the old instant flip, so it can't recurse.
  let currentPivots = {};
  // open-up windows: playerId -> [{ t0, t1, t2, t3, deg }] in ROUTE-LOCAL seconds —
  // the receiver turns to face where the puck is coming from, holds it through the
  // catch, then squares back up. Display-only, like the pivot.
  let currentOpens = {};
  // true while the plan is still being solved (and while pivot signs sample the
  // rest of the ice). Every display-only smoothing below reads this and stands
  // down, so nothing the renderer does can feed back into a leg time.
  let planPhase = false;

  // how far the body is turned out of its route heading by an open-up, at
  // route-local elapsed `eLoc` (0 outside a window)
  // the turn AND how far into it we are — a standing player blends its idle gaze
  // against this, so the weight has to come out too, not just the product
  function openPart(p, eLoc) {
    if (planPhase) return { deg: 0, k: 0 };
    const list = currentOpens[p.id];
    if (!list) return { deg: 0, k: 0 };
    let best = { deg: 0, k: 0 };
    for (const w of list) {
      if (eLoc <= w.t0 || eLoc >= w.t3) continue;
      const k = eLoc < w.t1 ? smooth01((eLoc - w.t0) / (w.t1 - w.t0))
        : eLoc <= w.t2 ? 1
        : 1 - smooth01((eLoc - w.t2) / (w.t3 - w.t2));
      if (Math.abs(w.deg * k) > Math.abs(best.deg * best.k)) best = { deg: w.deg, k };
    }
    return best;
  }
  const openAt = (p, eLoc) => { const o = openPart(p, eLoc); return o.deg * o.k; };

  /* ---- idle gaze ----
     A player standing still watches the play. Rather than snapping between whoever
     is momentarily "nearest" — which jumps every time the ranking changes — each
     moving thing pulls on the gaze by how fast and how close it is, and the player
     looks down the sum. That drifts smoothly with the action and lands naturally on
     whichever end of the ice is busiest. Display only, and a pure function of t.  */
  const GAZE_IN = 0.6;       // ease off the authored facing over the first beat
  const GAZE_MIN_SPD = 2;    // ft/s — slower than this is not "activity"
  const GAZE_NEAR = 5;       // ft — ignore what is already on their own stick
  const GAZE_PUCK = 2.4;     // the puck pulls harder than a body: you watch the puck
  let gazeE = null, gazeSnap = null, gazeBusy = false;
  // one pass per frame, shared by every standing player
  function activityAt(e) {
    if (gazeE === e && gazeSnap) return gazeSnap;
    gazeBusy = true;                       // nested position lookups must not re-enter
    try {
      const out = [];
      for (const q of pieces) {
        if (q.kind !== "player" && q.kind !== "puck") continue;
        if (q.kind === "player" && q.defense) continue;
        const a = displayPosAt(q, Math.max(0, e - 0.12)), b2 = displayPosAt(q, e + 0.12);
        out.push({ id: q.id, kind: q.kind, x: b2.x, y: b2.y,
          spd: Math.hypot(b2.x - a.x, b2.y - a.y) / 0.24 });
      }
      gazeSnap = out; gazeE = e;
    } finally { gazeBusy = false; }
    return gazeSnap;
  }
  // Where a standing player should be looking, and how strongly. `conf` matters as
  // much as the bearing: a hard "is it moving?" cutoff makes the head snap round the
  // instant a skater crosses the threshold, so activity fades IN with speed and the
  // gaze eases back to the authored pose as the rink goes quiet.
  const GAZE_REF = 0.004;    // pull at which the player is fully watching
  function gazeAt(p, e) {
    if (gazeBusy || planPhase || !detail || e <= 0) return null;
    let vx = 0, vy = 0, tot = 0;
    for (const q of activityAt(e)) {
      if (q.id === p.id) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < GAZE_NEAR * GAZE_NEAR) continue;
      const moving = smooth01((q.spd - GAZE_MIN_SPD) / GAZE_MIN_SPD);
      if (moving <= 0) continue;
      const d = Math.sqrt(d2), w = (q.kind === "puck" ? GAZE_PUCK : 1) * moving * q.spd / d2;
      vx += (dx / d) * w; vy += (dy / d) * w; tot += w;
    }
    if (!tot) return null;
    return { deg: (Math.atan2(vy, vx) * 180) / Math.PI, conf: smooth01(tot / GAZE_REF) };
  }

  // the flip (deg) to add to leg i's tangent at route-local elapsed `eLoc` — the
  // stepped 0/180 outside a pivot, a smooth sweep through one
  function flipAt(p, i, eLoc) {
    const base = stepFlip(p.path[i]);
    if (planPhase) return base;
    const pv = currentPivots[p.id];
    // identity check: callers sometimes pass the RAW piece for a branching player,
    // whose leg indices don't line up with the effective path the windows were built on
    if (!pv || pv.path !== p.path) return base;
    const blend = w => w.from + w.sign * 180 * smooth01(w.t1 > w.t0 ? (eLoc - w.t0) / (w.t1 - w.t0) : 1);
    const wIn = pv.byIdx.get(i - 1);            // the pivot into this leg, still finishing
    if (wIn && eLoc < wIn.t1) return blend(wIn);
    const wOut = pv.byIdx.get(i);               // the pivot out of this leg, already starting
    if (wOut && eLoc > wOut.t0) return blend(wOut);
    return base;
  }

  function routeTimeW(p, warp, upto = Infinity) {
    let t = startWaitOf(p);
    for (let i = 0; i < p.path.length; i++) {
      if (i > upto) break;
      t += (p.path[i].stop || 0) + trigPauseOf(p, i) + holdAt(p, i) + effMove(p, p.path[i], i, warp);
    }
    return t;
  }

  // the carried puck's DISPLAY position: rides the blade, plus a dribble cradle
  // Display-only — planning geometry keeps using bladeAt. The stickhandle lives in
  // the LEVER now (stickSpot swings it with the stick), so the puck is welded to the
  // blade rather than orbiting it on a cradle of its own. Uses the display heading:
  // the puck has to stay on the stick through a pivot or an open-up too.
  function carriedPuckAt(car, e, warp) {
    // The clamp keeps the puck from walking past the end of the carrier's ROUTE. A
    // carrier with no route has no such end — clamping them to t=0 froze the blade at
    // the authored facing while the body turned to watch the play, and the puck sat
    // off the stick for the whole drill.
    const te = car.path.length ? Math.min(e, routeTimeW(car, warp)) : e;
    return bladeAt(car, te, warp, true, stickSpot(car.id, e));
  }
  // `disp` picks the display heading (pivot-smoothed); everything that PLANS puck
  // geometry leaves it off and rides the stepped heading, so a pivot can never
  // move a launch point — and therefore never change a flight time.
  // `off` overrides the local (forward, lateral) lever — the carry blade by default,
  // the release spot out beside the foot for a shot or pass.
  function bladeAt(pl, e, warp, disp = false, off = null, turn = 0) {
    const cp = routePosAt(pl, e, warp);
    const rad = ((((disp ? cp.a : cp.aStep) || 0) + turn) * Math.PI) / 180;
    const side = pl.hand === "L" ? -1 : 1;
    // PLAYER_SCALE: the levers are in the glyph's own units, and the glyph draws
    // under full icon scale — leave it out and the puck floats past the blade
    const k = ICON_SCALE * PLAYER_SCALE;
    const lx = (off ? off.fwd : 4.9) * k, ly = (off ? off.lat : 2.55) * k * side;
    return {
      x: clampX(cp.x + Math.cos(rad) * lx - Math.sin(rad) * ly),
      y: clampY(cp.y + Math.sin(rad) * lx + Math.cos(rad) * ly),
      a: 0,
    };
  }
  // The puck leaves from here, not off the toe of the blade.
  // A backhand comes off the OTHER face of the blade: the puck leaves from in front
  // of the body and round to the weak side, where a forehand leaves out beside the
  // strong-side foot. (Compass, nose at N: right shot's forehand NE→E, backhand N→NW.)
  const releaseAt = (pl, e, warp, turn = 0, back = false) =>
    bladeAt(pl, e, warp, false, back ? BACK_LEVER : FORE_LEVER, turn);
  // Which hand a shot comes off. "fore"/"back" are the coach's call; with no call it
  // is whichever side the target is already on — you do not reach across your body
  // for a net sitting on your backhand.
  function shotBack(sh, e, warp, aimPt, forced) {
    if (forced === "fore") return false;
    if (forced === "back") return true;
    if (!sh || !aimPt) return false;
    const cp = routePosAt(sh, e, warp);
    const rel = wrapDeg((Math.atan2(aimPt.y - cp.y, aimPt.x - cp.x) * 180) / Math.PI - (cp.aStep || 0));
    const side = sh.hand === "L" ? -1 : 1;
    return rel * side < -20;                 // clearly across the body → backhand
  }

  // Where the puck sits on the stick at time e, as a local (forward, lateral) lever
  // in icon units: the blade tip while carrying, sweeping round to the release spot
  // through the wind-up so it travels out to the near foot WITH the stick instead of
  // teleporting there the frame it is fired. Shared by the plan's carried-puck
  // position and the renderer's blade tip, so the two can't drift apart.
  function stickSpot(id, e) {
    if (!detail) return { fwd: TIP_FWD_U, lat: TIP_LAT_U };
    // The puck sits on the blade tip — wherever the stick actually is. Swinging it by
    // the same curve that DRAWS the stick is the whole point: the previous version
    // slid the puck straight to the release spot while the stick drew back off it, so
    // for the length of a wind-up the two were pulling in opposite directions and the
    // puck visibly left the blade before the shot.
    return swungLever(TIP_FWD_U, TIP_LAT_U, swingDeg(id, e));
  }

  function getPlan() {
    const pc = planCache.current;
    // realisticShots / detail / odds change the OUTCOMES a plan bakes in (miss
    // trajectories, rest spots) — a cached plan from the other mode must not be
    // reused, or toggling e.g. Whiteboard replays a stale realistic miss
    if (pc.key === pieces && pc.pace === pace && pc.sig === lenSig && pc.seed === seed
      && pc.real === realisticShots && pc.det === detail && pc.odds === odds) { currentHolds = pc.holds || {}; currentStartWait = pc.startWait || {}; currentTrigPause = pc.trigPause || {}; currentPivots = pc.pivots || {}; currentOpens = pc.opens || {}; return pc; }
    const warp = {};
    const plans = {};
    const rel = {};
    // A delay trigger can fire on a puck ACTION (pass/chip/rim/shot). Those
    // release times come out of the puck plan, which itself depends on the holds
    // — so resolve holds → plan pucks → feed the releases back, in a bounded
    // fixpoint. A drill with no action trigger runs a single pass (identical to
    // the old one-shot ordering); the loop only iterates when an action trigger
    // needs the previous plan's release times.
    const hasActionTrigger = pieces.some(p => p.kind === "player" && (
      (p.wait && p.wait.on && p.wait.mode === "action") ||
      p.path.some(s => s.waitOn && s.waitOn.on && s.waitOn.mode === "action")));
    let sw = {}, tp = {};
    let events = [];            // puck releases from the last plan: { by, at, t, kind }
    const evSig = a => a.map(e => `${e.by}/${e.at}/${e.kind}/${(e.t || 0).toFixed(3)}`).sort().join("|");
    // earliest release by actor `on` (optionally at a specific waypoint `at`);
    // null → that actor never performs a matching action, so the hold is 0
    const actionTimeOf = (on, at) => {
      let best = Infinity;
      events.forEach(e => { if (e.by === on && (at == null || e.at === at) && e.t < best) best = e.t; });
      return isFinite(best) ? best : null;
    };
    const rawTo = (p, at) => { let t = 0; for (let i = 0; i < p.path.length; i++) { if (i > at) break; t += (p.path[i].stop || 0) + effMove(p, p.path[i], i, warp); } return t; };
    // ...and the same clock run to a DISTANCE rather than a waypoint: how long
    // until `p` has covered `dist` feet of their own route. A line releases the
    // next skater once the one ahead is a set distance clear, and a waypoint is
    // far too coarse a ruler for that — on a four-point route the choices are
    // tens of feet apart. Interpolates within the leg the distance falls in.
    // Arc length ÷ pace like every other leg time; no screen geometry enters,
    // because segLen returns rink feet (the viewBox is in rink feet).
    const rawSpan = (p, dist) => {
      let t = 0, acc = 0;
      for (let i = 0; i < p.path.length; i++) {
        t += (p.path[i].stop || 0);
        const L = segLen(p.id, i), mt = effMove(p, p.path[i], i, warp);
        if (acc + L >= dist) return t + (L > 0 ? (mt * (dist - acc)) / L : 0);
        acc += L; t += mt;
      }
      return t;                     // never gets that far clear — go when they finish
    };
    let newEvents = [];
    for (let outer = 0, OUTER = hasActionTrigger ? 6 : 1; outer < OUTER; outer++) {
    // fresh warp/plans each pass so hold resolution always starts from the same
    // (empty-warp) point the old single-pass code did
    for (const k in warp) delete warp[k];
    for (const k in plans) delete plans[k];
    for (const k in rel) delete rel[k];
    // resolve per-player start waits BEFORE the puck plans (a waiting player's
    // passes/shots must launch at their delayed time). A waypoint trigger fires
    // when the trigger player reaches waypoint `at`; an action trigger fires at
    // that player's release time (from the previous pass's plan). Chains
    // (A waits B waits C) resolve over a few passes.
    const swNew = {};
    for (let pass = 0; pass <= pieces.length; pass++) {
      let changed = false;
      pieces.forEach(p => {
        if (p.kind !== "player" || !p.wait || !p.wait.on) return;
        let w;
        if (p.wait.mode === "action") {
          if (p.wait.on === p.id) return;                  // no self-trigger
          const t = actionTimeOf(p.wait.on, p.wait.at);   // absolute release time
          w = t == null ? 0 : t;                           // we sit at the start, so the hold IS t
        } else if (p.wait.mode === "span") {
          // "go when the one ahead is clear" — a queue release. Same shape as the
          // waypoint case (their start-wait plus their own travel), measured to a
          // distance instead of a waypoint, so it converges on the same argument:
          // a line's triggers chain strictly backwards to the head, who never waits.
          const trig = pieces.find(q => q.id === p.wait.on && q.kind === "player");
          if (!trig || trig.id === p.id) return;
          w = (swNew[trig.id] || 0) + rawSpan(trig, Math.max(0, p.wait.dist || 0));
        } else {
          const trig = pieces.find(q => q.id === p.wait.on && q.kind === "player");
          if (!trig || trig.id === p.id) return;
          const at = p.wait.at == null ? trig.path.length - 1 : Math.max(-1, Math.min(p.wait.at, trig.path.length - 1));
          w = (swNew[trig.id] || 0) + (at < 0 ? 0 : rawTo(trig, at));
        }
        if (Math.abs((swNew[p.id] || 0) - w) > 1e-6) { swNew[p.id] = w; changed = true; }
      });
      if (!changed) break;
    }
    sw = swNew;
    currentStartWait = sw;
    // trigger pauses: a waypoint holds until the trigger player reaches a
    // waypoint (arrival) or performs a puck action (release). The pause length
    // = max(0, trigger-time − our-arrival at that waypoint). rawArr includes
    // start-waits + fixed stops + already-resolved trig pauses.
    const tpNew = {};
    // Time for `p` to travel `dist` feet BEYOND waypoint `from`, measured the same
    // way every other leg time is (arc length ÷ pace). This is what "wait until
    // the one ahead is N feet clear of this point" resolves to — the mid-route
    // twin of rawSpan, which only ever measures from a route's start.
    const rawSpanFrom = (p, from, dist) => {
      let t = 0, acc = 0;
      for (let i = from + 1; i < p.path.length; i++) {
        const L = segLen(p.id, i), mt = effMove(p, p.path[i], i, warp);
        t += (p.path[i].stop || 0) + (tpNew[p.id + "/" + i] || 0);
        if (acc + L >= dist) return t + (L > 0 ? (mt * (dist - acc)) / L : 0);
        acc += L; t += mt;
      }
      return t;                    // never gets that far clear — go when they finish
    };
    const rawArr = (p, at) => {
      let t = (sw[p.id] || 0);
      for (let i = 0; i < p.path.length; i++) { if (i > at) break; t += (p.path[i].stop || 0) + (tpNew[p.id + "/" + i] || 0) + effMove(p, p.path[i], i, warp); }
      return t;
    };
    for (let pass = 0; pass <= pieces.length + 1; pass++) {
      let changed = false;
      pieces.forEach(p => {
        if (p.kind !== "player" || !p.path.length) return;
        p.path.forEach((s, i) => {
          if (!s.waitOn || !s.waitOn.on) return;
          const key = p.id + "/" + i;
          let trigT;
          if (s.waitOn.mode === "action") {
            if (s.waitOn.on === p.id) return;              // no self-trigger
            const t = actionTimeOf(s.waitOn.on, s.waitOn.at);
            if (t == null) { if (tpNew[key]) { tpNew[key] = 0; changed = true; } return; }
            trigT = t;
          } else if (s.waitOn.mode === "span") {
            // a queue release at a point mid-route: hold here until the one ahead
            // is `dist` feet past the same point. Same shape as the waypoint case,
            // measured to a distance, so it chains backwards the same way.
            const trig = pieces.find(q => q.id === s.waitOn.on && q.kind === "player");
            if (!trig || trig.id === p.id) return;
            const at = Math.max(-1, Math.min(s.waitOn.at == null ? 0 : s.waitOn.at, trig.path.length - 1));
            trigT = (at < 0 ? (sw[trig.id] || 0) : rawArr(trig, at))
              + rawSpanFrom(trig, at, Math.max(0, s.waitOn.dist || 0));
          } else {
            const trig = pieces.find(q => q.id === s.waitOn.on && q.kind === "player");
            if (!trig || trig.id === p.id) return;
            const at = s.waitOn.at == null ? trig.path.length - 1 : Math.max(-1, Math.min(s.waitOn.at, trig.path.length - 1));
            trigT = at < 0 ? (sw[trig.id] || 0) : rawArr(trig, at);
          }
          const arriveT = rawArr(p, i - 1);        // the pause sits at the start of segment i (= the prior waypoint)
          const dur = Math.max(0, trigT - arriveT);
          if (Math.abs((tpNew[key] || 0) - dur) > 1e-6) { tpNew[key] = dur; changed = true; }
        });
      });
      if (!changed) break;
    }
    tp = tpNew;
    currentTrigPause = tp;
    newEvents = [];    // puck releases collected as the plans below fire them
    const netSh = solidShapes(pieces);        // solid obstacles pucks carom off (nets + bumpers)
    const bumpSh = bumperShapes(pieces);      // a flat pass across a bumper auto-lifts (sauces) over it
    pieces.forEach(pk => {
      if (pk.kind !== "puck") return;
      const vPass = () => pace * SPEED.pass * (pk.speed || 1);
      const vRim = () => pace * SPEED.pass * 1.1 * (pk.speed || 1);   // rim rides fast
      const vChip = () => pace * SPEED.pass * 0.7 * (pk.speed || 1);  // chip is soft
      const legs = [];
      let cur = null;
      let tBase = 0;
      let chainBlocked = false;   // a rebound that can't reach its collector (thru a net)
      // lay a moving polyline (rim / chip travel) down as a chain of fly legs.
      // flag.easeOut (ft) ramps the speed down over the final stretch so the puck
      // glides to a stop instead of halting abruptly.
      const pushTravel = (poly, t0, speed, flag = {}) => {
        const remTo = new Array(poly.length).fill(0);
        for (let k = poly.length - 2; k >= 0; k--)
          remTo[k] = remTo[k + 1] + Math.hypot(poly[k + 1].x - poly[k].x, poly[k + 1].y - poly[k].y);
        let t = t0, prev = poly[0];
        for (let k = 1; k < poly.length; k++) {
          const seg = poly[k];
          let v = speed;
          if (flag.easeOut) {
            const rem = (remTo[k - 1] + remTo[k]) / 2;         // avg distance-to-end over this leg
            // friction glide: v ∝ √(distance-to-end), so it decelerates smoothly
            // and crawls the last bit instead of stopping short
            if (rem < flag.easeOut) v = speed * Math.max(0.04, Math.sqrt(rem / flag.easeOut));
          }
          const dt = Math.max(1e-3, Math.hypot(seg.x - prev.x, seg.y - prev.y) / Math.max(1e-3, v));
          legs.push({ type: "fly", x0: prev.x, y0: prev.y, x1: seg.x, y1: seg.y, t0: t, t1: t + dt,
            ...(k === 1 && flag.by ? { by: flag.by } : {}), rim: !!flag.rim, chip: !!flag.chip });
          t += dt; prev = seg;
        }
        return { t, end: prev };
      };
      // subdivide a polyline into ~step-ft segments so a per-leg speed ramp
      // (ease-out) reads smoothly instead of jumping between sparse vertices
      const densify = (poly, step = 2.5) => {
        const out = [poly[0]];
        for (let k = 1; k < poly.length; k++) {
          const a = poly[k - 1], b = poly[k];
          const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
          for (let j = 1; j <= n; j++) out.push({ x: a.x + (b.x - a.x) * (j / n), y: a.y + (b.y - a.y) * (j / n) });
        }
        return out;
      };
      // the direction the player is facing at time t — the exact angle its icon
      // shows (facing for a stationary player, the movement/tangent for a route
      // player), so a chip goes the way they're pointed
      const chipHeading = (p, t, aim) => {
        const deg = aim != null ? aim : routePosAt(p, t, warp).aStep || 0;   // explicit aim overrides facing
        const a = (deg * Math.PI) / 180;
        return { x: Math.cos(a), y: Math.sin(a) };
      };
      if (pk.carrier) {
        cur = pieces.find(q => q.id === pk.carrier && q.kind === "player");
        if (!cur) return;
        legs.push({ type: "ride", id: cur.id, t0: 0 });
      } else if (pk.pickup) {
        const pl = pieces.find(q => q.id === pk.pickup.to && q.kind === "player");
        if (!pl) return;
        let tPick = 0;
        if (pl.path.length) {
          if (pk.pickup.at < 0) {
            tPick = 0;                                        // waypoint 0 (the start): pinned — collect before moving, then carry
          } else if (pk.pickup.nearest) {
            // a "nearest" collect grabs the puck where the player passes CLOSEST to
            // it — so a puck by the start is picked up early and carried, not
            // dragged across to the route's end
            const total = routeTimeW(pl, warp, pl.path.length - 1);
            let bestD = Infinity;
            for (let k = 0; k <= 48; k++) {
              const tt = (total * k) / 48;
              const pos = routePosAt(pl, tt, warp);
              const d = Math.hypot(pos.x - pk.x, pos.y - pk.y);
              if (d < bestD) { bestD = d; tPick = tt; }
            }
          } else {
            const atIdx = Math.min(pk.pickup.at, pl.path.length - 1);
            tPick = routeTimeW(pl, warp, atIdx);
          }
        } else if (pk.path.length) {
          // stationary picker: gather the loose puck when its own route delivers it
          tPick = routeTimeW(pk, warp);
        }
        // a player collecting several pucks at the SAME spot handles them one at a
        // time — offset each successive collect (in piece order) by a handling gap
        // so collect→shoot→collect→shoot sequences instead of firing at once
        let seq = 0;
        for (const q of pieces) { if (q === pk) break;
          if (q.kind === "puck" && q.pickup && q.pickup.to === pk.pickup.to && q.pickup.at === pk.pickup.at) seq++; }
        // a STATIONARY collector who ALSO starts with a puck in hand must release
        // it before collecting — otherwise the held shot and the first collect both
        // fire at t0 (two pucks at once). Queue the collects past that first release.
        if (!pl.path.length && pieces.some(q => q.kind === "puck" && q.carrier === pk.pickup.to)) seq++;
        tPick += seq * 1.6;
        legs.push({ type: "free", t0: 0 });
        legs.push({ type: "ride", id: pl.id, t0: tPick, catch: true, ...(pk.pickup.open ? { open: true } : {}) });
        cur = pl;
        tBase = tPick;
      } else return;
      // fire the current carrier's shot at shootIdx; the puck flies to the net,
      // caroms off it and glides to rest in the slot. Returns the rest point.
      // Path-less (stationary) shooters release immediately at tBase.
      // netId targets THIS shot's net (each shot in a chain aims independently:
      // the terminal uses pk.net, a rebound transfer its own tr.net)
      const doShot = (shootIdx, aimPt, netId = pk.net, shand = null) => {
        const launchT = (cur.path.length && shootIdx >= 0)
          ? Math.max(tBase, routeTimeW(cur, warp, Math.min(shootIdx, cur.path.length - 1)))
          : tBase;
        newEvents.push({ by: cur.id, at: shootIdx, t: launchT, kind: "shot" });
        // Provisional launch, only so the nearest net can be picked: the fore/back
        // choice moves the release ~4ft, nowhere near enough to change WHICH net is
        // closest, and the real launch is re-taken off the chosen hand below.
        let launch = releaseAt(cur, launchT, warp);
        // target the nearest net or passer (respecting a forced side), else default;
        // a passer has no goalie, so shots at it always take the carom/rebound path.
        // A bumper or tire can also be an EXPLICIT target (netId = its id) — a
        // shot deflects off it — but they never auto-attract a shot on their own.
        const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
        const props = pieces.filter(q => q.kind === "bumper" || q.kind === "tire");
        let net, netPiece = null;
        netPiece = netId ? [...nets, ...props].find(n => n.id === netId) || null : null;
        if (!netPiece && nets.length) {
          let cands = netId === "left" ? nets.filter(n => n.x < 100)
            : netId === "right" ? nets.filter(n => n.x >= 100) : nets;  // legacy side / nearest
          if (!cands.length) cands = nets;
          netPiece = cands.reduce((a, b) =>
            Math.hypot(b.x - launch.x, b.y - launch.y) < Math.hypot(a.x - launch.x, a.y - launch.y) ? b : a);
        }
        if (netPiece) net = { x: netPiece.x, y: netPiece.y };
        else net = netId === "left" ? { x: 11, y: 42.5 } : netId === "right" ? { x: 189, y: 42.5 }
          : launch.x < 100 ? { x: 11, y: 42.5 } : { x: 189, y: 42.5 };   // crease centers — where an auto-net would sit
        // now the target is known, so the hand is too: the coach's call if they made
        // one, else whichever side the net is already on — nobody reaches across their
        // body for a net sitting on their backhand
        const back = shotBack(cur, launchT, warp, aimPt || net, shand);
        // twist toward the backhand side — the way their shoulders actually go
        const twist = back ? -BACK_TWIST * (cur.hand === "L" ? -1 : 1) : 0;
        if (back) launch = releaseAt(cur, launchT, warp, twist, true);
        const vShot = pace * SPEED.shot * (pk.speed || 1);
        const inx = net.x - launch.x, iny = net.y - launch.y;
        const mag = Math.hypot(inx, iny) || 1;
        const ux = inx / mag, uy = iny / mag;                 // unit vector toward the net
        const goalie = !!(netPiece && netPiece.goalie);
        const isTire = !!(netPiece && netPiece.kind === "tire");
        const onNet = !!(netPiece && netPiece.kind === "net");
        // randomize placement across the ~6 ft mouth: posts / sides / center
        const px = -uy, py = ux;                              // lateral (across the mouth)
        const GOAL_HALF = 2.6;
        const place = rand(`${pk.id}:${legs.length}:p`) * 2 - 1; // −1..1 across the net
        const side = place >= 0 ? 1 : -1;                     // which post / side missed toward
        // a rebound-designated shot (aimPt = a collector's gather spot) must be
        // saved so the rebound actually comes out; only free shots roll an outcome.
        // On an EMPTY net a free shot usually scores, but can miss: ring the post
        // (rebounds), sail wide into the corner, or fly over the net.
        // realisticShots gates the random spread: off = an empty net always buries
        // (no post/wide/over) and every shot stays flat on the ice.
        const emptyFree = onNet && !goalie && !aimPt;
        let miss = null;                                      // "post" | "wide" | "over"
        if (emptyFree && realisticShots) {
          const r = rand(`${pk.id}:${legs.length}:out`);
          if (r < OD.post) miss = "post";
          else if (r < OD.post + OD.wide) miss = "wide";
          else if (r < OD.post + OD.wide + OD.over) miss = "over";
        }
        // a rebound collector set up within reach of the net (≤30 ft) — the only
        // thing that forces a save when realistic shots are off
        const nearCollect = !!aimPt && Math.hypot(aimPt.x - net.x, aimPt.y - net.y) <= 30;
        // realistic OFF ("simple"): every shot on a net scores — even past a goalie
        // — unless a near-net rebound collect is set up, which forces a save out.
        const isGoal = !realisticShots ? (onNet && !nearCollect)
          : goalie && !aimPt ? rand(`${pk.id}:${legs.length}`) >= OD.save
          : emptyFree ? !miss : false;
        // flat or airborne (sauce-style rise + shadow) — an over-the-net miss must
        // leave the ice; everything else rolls. Deflect props (tire/passer/bumper)
        // and blocked rebounds stay flat so their carom geometry reads cleanly. The
        // rising lift is a detailed-animation flourish, so turn it off with `detail`
        // (an OVER miss still lofts, since it has to clear the cage).
        const airborne = miss === "over" || (realisticShots && detail && onNet && rand(`${pk.id}:${legs.length}:air`) < OD.air);

        // a missed shot flies to a contact/landing point (carrying the outcome flag
        // for the splash + air lift), then rolls & banks off the boards like a rim,
        // gliding to a stop — a miss doesn't just die behind the net.
        // ice friction (ft/s^2) and the crawl speed (ft/s) below which it's at rest
        const MISS_FRIC = 62, MISS_STOP = 8;
        const missOut = (contact, rollDir, flagKey, air, entryV = vShot, rise = false) => {
          const tArr = launchT + Math.hypot(contact.x - launch.x, contact.y - launch.y) / vShot;
          // a shot that reaches the net plane (post) climbs into it (rise); a puck
          // that sails wide/over arcs like a sauce and comes back down to land
          legs.push({ type: "fly", shot: true, [flagKey]: true, ...(air ? (rise ? { rise: true } : { sauce: true }) : {}), by: cur.id, ...(back ? { back: true, relTurn: twist } : {}),
            x0: launch.x, y0: launch.y, x1: contact.x, y1: contact.y, t0: launchT, t1: tArr });
          const dm = Math.hypot(rollDir.x, rollDir.y) || 1;
          // integrate the roll step by step, caroming off BOTH the rink boards and
          // the net cages (losing 1−bounce of speed per carom) and bleeding off with
          // ice friction, until it crawls to rest — so a puck that banks off the net
          // then a board keeps rebounding instead of leaking through either one
          let t = tArr, cx = contact.x, cy = contact.y;
          let vx = (rollDir.x / dm) * entryV, vy = (rollDir.y / dm) * entryV;
          const STEP = 1.6;
          const travelTo = (px, py) => {                        // glide to a point, bleeding speed to friction
            const d = Math.hypot(px - cx, py - cy);
            if (d < 1e-4) return;
            const sp = Math.hypot(vx, vy) || 1;
            const spNext = Math.sqrt(Math.max(0, sp * sp - 2 * MISS_FRIC * d));
            const dt = d / Math.max(MISS_STOP, (sp + spNext) / 2);
            legs.push({ type: "fly", x0: cx, y0: cy, x1: px, y1: py, t0: t, t1: t + dt });
            t += dt; const k = spNext / sp; vx *= k; vy *= k; cx = px; cy = py;
          };
          let guard = 0;
          while (guard++ < 500) {
            const sp = Math.hypot(vx, vy);
            if (sp <= MISS_STOP) break;
            const tx = cx + (vx / sp) * STEP, ty = cy + (vy / sp) * STEP;
            const nb = bounceOffNets(cx, cy, tx, ty, vx, vy, netSh, OD.bounce);   // carom off a net cage
            if (nb.hit) { travelTo(nb.x, nb.y); vx = nb.vx; vy = nb.vy; continue; }
            const bc = boards.contain(tx, ty, vx, vy, OD.bounce);                 // carom off the rink boards
            if (bc.hit) { travelTo(bc.x, bc.y); vx = bc.vx; vy = bc.vy; continue; }
            travelTo(tx, ty);                                                     // free glide (friction only)
          }
          legs.push({ type: "rest", x: cx, y: cy, t0: t });
          tBase = t;
          return { x: cx, y: cy };
        };
        // POST: rings the iron and caroms off it like a wall — out along the goal
        // line toward the corner, with a touch of kick back toward the slot. The
        // post takes energy too (enter the glide at bounce × shot speed).
        if (miss === "post") {
          const postPt = { x: clampX(net.x + px * side * GOAL_HALF), y: clampY(net.y + py * side * GOAL_HALF) };
          const defl = { x: px * side - ux * 0.4, y: py * side - uy * 0.4 };   // reflect off the post
          return missOut(postPt, defl, "post", airborne, vShot * OD.bounce, true);
        }
        // WIDE: sails just past the post and keeps going into the corner, banking
        if (miss === "wide") {
          const passPt = boards.clampInside(net.x + ux * 0.5 + px * side * (GOAL_HALF + 2), net.y + uy * 0.5 + py * side * (GOAL_HALF + 2));
          const dir = { x: passPt.x - launch.x, y: passPt.y - launch.y };      // straight on past the post
          return missOut(passPt, dir, "wide", airborne);
        }
        // OVER: rises above the cage, lands behind the net, then rolls on until the
        // end boards stop it (always airborne to clear the crossbar)
        if (miss === "over") {
          const landPt = boards.clampInside(net.x + ux * 7, net.y + uy * 7);   // clear the cage back (~3.3 ft)
          return missOut(landPt, { x: ux, y: uy }, "over", true);
        }

        // a scored shot on a NET (goalie beaten, or an empty net) buries it BEHIND
        // the plane, where it rests in the cage. A tire "goalie" beaten doesn't
        // concede — the puck deflects off the rubber (handled below), so skip it.
        if (isGoal && onNet && !isTire) {                     // in the net — to a post/corner
          // spread goals across the mouth (mid-net out to either post) at varying
          // depth, so repeated goals bury in different spots instead of clustering
          const lat = side * (0.45 + Math.abs(place) * 0.55) * GOAL_HALF;
          const depth = 1.1 + rand(`${pk.id}:${legs.length}:d`) * 1.3;   // 1.1–2.4 ft behind the line
          const endPt = { x: clampX(net.x + ux * depth + px * lat), y: clampY(net.y + uy * depth + py * lat) };
          const tArr = launchT + Math.hypot(endPt.x - launch.x, endPt.y - launch.y) / vShot;
          // goal=true rides through the rest too: the puck sits BEHIND the net
          // plane, so render (via puckInGoal) sinks it under the cage
          legs.push({ type: "fly", shot: true, goal: true, rise: airborne, by: cur.id, ...(back ? { back: true, relTurn: twist } : {}), x0: launch.x, y0: launch.y, x1: endPt.x, y1: endPt.y, t0: launchT, t1: tArr });
          legs.push({ type: "rest", goal: true, x: endPt.x, y: endPt.y, t0: tArr });
          tBase = tArr;
          // if a collector was expecting this shot's rebound (aimPt) but it went in
          // anyway, end the chain so the puck stays buried (no teleport to them)
          if (aimPt) chainBlocked = true;
          return endPt;
        }

        // where the shot strikes. A tire is a circle: with no keeper (or a keeper
        // who's beaten) the puck contacts the rubber off-centre and deflects off
        // the radial normal there; a tire keeper who saves it steps out front and
        // stops it. Everything else is struck across a flat mouth/face.
        const tireDeflect = isTire && !(goalie && !isGoal);   // empty tire, or its keeper was beaten
        let hit, tireNrm = null;
        if (tireDeflect) {
          const R = 2.6 * ICON_SCALE * (netPiece.size || 1);    // rubber radius, feet
          const off = place * R * 0.82;                         // how far off-centre it lands
          const back = Math.sqrt(Math.max(0, R * R - off * off));
          hit = { x: net.x - ux * back + px * off, y: net.y - uy * back + py * off };
          const nm = Math.hypot(hit.x - net.x, hit.y - net.y) || 1;
          tireNrm = { x: (hit.x - net.x) / nm, y: (hit.y - net.y) / nm };  // outward radial normal
        } else if (isTire) {                                    // tire keeper steps out and stops it
          const R = 2.6 * ICON_SCALE * (netPiece.size || 1);
          hit = { x: net.x - ux * (R + 1.3), y: net.y - uy * (R + 1.3) };
        } else if (goalie) {
          hit = { x: net.x - ux * GOALIE_DEPTH, y: net.y - uy * GOALIE_DEPTH };
        } else {
          hit = { x: clampX(net.x + px * place * GOAL_HALF), y: clampY(net.y + py * place * GOAL_HALF) };
        }
        const tArr = launchT + Math.hypot(hit.x - launch.x, hit.y - launch.y) / vShot;
        // scored shots and empty-net misses (post/wide/over) already returned; what
        // reaches here on a net is a goalie save or a designated rebound (aimPt)
        // reading as a save. A passer is a pass, not a shot on net, so it stays quiet.
        const saved = (goalie && !isGoal) || (onNet && !!aimPt);
        // a blocked designated rebound stays flat (its carom is cut off at the net);
        // an airborne save/shot climbs into the net (rise), not a sauce arc
        const flyLeg = { type: "fly", shot: true, save: saved, goal: false, rise: airborne && !aimPt, by: cur.id, ...(back ? { back: true, relTurn: twist } : {}), x0: launch.x, y0: launch.y, x1: hit.x, y1: hit.y, t0: launchT, t1: tArr };
        legs.push(flyLeg);
        // a designated rebound whose collection spot sits behind/through the net
        // can never get there — stop the puck dead at the net and break the chain
        // (the collector never receives it) instead of zooming it through the cage
        if (aimPt && segCrossesNet(hit, { x: clampX(aimPt.x), y: clampY(aimPt.y) }, netSh)) {
          flyLeg.blockedRebound = true;
          legs.push({ type: "rest", x: hit.x, y: hit.y, t0: tArr });
          tBase = tArr; chainBlocked = true;
          return hit;
        }
        // rebound: to the collector's gather spot, else a damped carom. A passer
        // reflects the shot off its face (normal = its facing); a net without a
        // goalie just kicks it back toward the slot.
        let restPt;
        if (aimPt) {
          restPt = { x: clampX(aimPt.x), y: clampY(aimPt.y) };
        } else {
          let bx, by;
          if (tireNrm) {                                      // tire: reflect off the radial normal at the contact point
            const dot = ux * tireNrm.x + uy * tireNrm.y;
            bx = ux - 2 * dot * tireNrm.x; by = uy - 2 * dot * tireNrm.y;
          } else if (netPiece && (netPiece.kind === "passer" || netPiece.kind === "bumper")) {
            const fa = ((netPiece.facing || 0) * Math.PI) / 180;
            // a passer is long across its facing (face normal = facing); a bumper
            // is long ALONG its facing, so its face normal is perpendicular to it
            const nx = netPiece.kind === "bumper" ? -Math.sin(fa) : Math.cos(fa);
            const ny = netPiece.kind === "bumper" ? Math.cos(fa) : Math.sin(fa);
            const dot = ux * nx + uy * ny;
            bx = ux - 2 * dot * nx; by = uy - 2 * dot * ny;   // r = d − 2(d·n)n
          } else {
            bx = -ux; by = uy * 0.5;                          // net w/o goalie: kick back
          }
          const bmag = Math.hypot(bx, by) || 1;
          const BOUNCE = goalie ? 5 : 8;
          restPt = boards.clampInside(hit.x + (bx / bmag) * BOUNCE, hit.y + (by / bmag) * BOUNCE);
        }
        const dGlide = Math.hypot(restPt.x - hit.x, restPt.y - hit.y);
        const tGlide = Math.max(0.35, dGlide / Math.max(1e-3, pace * 3.2)); // loose-puck roll
        legs.push({ type: "skid", x0: hit.x, y0: hit.y, x1: restPt.x, y1: restPt.y, t0: tArr, t1: tArr + tGlide });
        legs.push({ type: "rest", x: restPt.x, y: restPt.y, t0: tArr + tGlide });
        tBase = tArr + tGlide;
        return restPt;
      };
      // walk the chain: each transfer is a pass or a shot-with-rebound. A shot
      // transfer fires at the net, its carom rolls to the named collector's
      // gather spot, and that collector takes possession and carries on — so
      // the normal pass/shoot options resume from the collection point.
      (pk.transfers || []).forEach(tr => {
        if (chainBlocked) return;                             // a prior rebound died at the net
        // an intended actor (`by`) that isn't the one actually holding the puck
        // is an impossible step — it (and everything after) won't happen
        if (tr.by && tr.by !== cur.id) { chainBlocked = true; return; }
        const rec = pieces.find(q => q.id === tr.to && q.kind === "player");
        if (!rec) return;
        if (tr.kind === "pass" && rec.id === cur.id && !tr.via) return;  // plain pass to yourself is a no-op (a `via` bounce off a passer is not)
        if (tr.kind === "rim" || tr.kind === "chip") {        // rim the boards / chip (to self ok)
          const launchT = (cur.path.length && tr.at >= 0)
            ? Math.max(tBase, routeTimeW(cur, warp, Math.min(tr.at, cur.path.length - 1))) : tBase;
          newEvents.push({ by: cur.id, at: tr.at, t: launchT, kind: tr.kind });
          const lb = releaseAt(cur, launchT, warp);
          const launch = boards.clampInside(lb.x, lb.y);       // a blade past the boards → no path
          let anchor, gj = -1;
          if (rec.path.length) {
            gj = tr.recvAt == null ? rec.path.length - 1 : Math.max(0, Math.min(tr.recvAt, rec.path.length - 1));
            anchor = { x: rec.path[gj].x, y: rec.path[gj].y };
          } else anchor = { x: rec.x, y: rec.y };
          // rim follows the boards to the collector; a chip fires along the
          // carrier's facing/aim, banks off the boards, and travels exactly as
          // far as it takes to reach the collector's spot — a harder chip for a
          // farther pickup, softer for a nearer one
          let poly, speed, ease = 0;
          if (tr.kind === "rim") {
            poly = densify(tr.aim != null ? boards.rimTo(launch, tr.aim, anchor) : boards.rimPath(launch, anchor));
            speed = vRim(); ease = 14;                                                    // settle at the collector
          } else {
            const h = chipHeading(cur, launchT, tr.aim);
            poly = densify(boards.slideTo(launch.x, launch.y, h.x, h.y, anchor));
            let len = 0;
            for (let k = 1; k < poly.length; k++) len += Math.hypot(poly[k].x - poly[k - 1].x, poly[k].y - poly[k - 1].y);
            speed = vChip() + (vRim() - vChip()) * Math.min(1, Math.max(0, (len - 18) / 40));  // hard vs soft
            ease = Math.min(len * 0.5, 15);                                                     // glide to a settle
          }
          const r = pushTravel(poly, launchT, speed, { by: cur.id, rim: tr.kind === "rim", chip: tr.kind === "chip", easeOut: ease });
          // the puck lands loose and waits at the spot until the collector's route
          // reaches its collect waypoint (pick it up like a rebound)
          const gatherT = gj >= 0 ? Math.max(r.t, routeTimeW(rec, warp, gj)) : r.t;
          if (gatherT > r.t + 1e-3) legs.push({ type: "rest", x: r.end.x, y: r.end.y, t0: r.t });
          legs.push({ type: "ride", id: rec.id, t0: gatherT, catch: true, ...(tr.open ? { open: true } : {}) });
          cur = rec; tBase = gatherT; return;
        }
        if (tr.kind === "shot") {                             // (may rebound to the shooter)
          let gi = -1, aim = null;
          if (rec.path.length) {
            gi = tr.recvAt == null ? rec.path.length - 1
              : Math.max(0, Math.min(tr.recvAt, rec.path.length - 1));
            aim = { x: rec.path[gi].x, y: rec.path[gi].y };
          } else {
            aim = { x: rec.x, y: rec.y };
          }
          doShot(tr.at, aim, tr.net != null ? tr.net : null);  // this rebound shot's own net (independent of the terminal)
          if (chainBlocked) return;                      // rebound died at the net — no collect
          const tGather = gi >= 0 ? Math.max(tBase, routeTimeW(rec, warp, gi)) : tBase;
          legs.push({ type: "ride", id: rec.id, t0: tGather, catch: true, ...(tr.open ? { open: true } : {}) });
          cur = rec;
          tBase = tGather;
          return;
        }
        // at < 0 means "from the starting spot" (before skating); a route-less
        // carrier likewise releases as soon as it has the puck (tBase)
        const launch0T = (cur.path.length && tr.at >= 0)
          ? Math.max(tBase, routeTimeW(cur, warp, Math.min(tr.at, cur.path.length - 1)))
          : tBase;
        // A standing passer squares up to whoever they are feeding before they let it
        // go — a give-and-go aims at the board it is banked off, not the eventual
        // receiver. Skaters are unaffected (aimTurn only moves a stationary body).
        const viaPc = tr.via ? pieces.find(q => q.id === tr.via
          && (q.kind === "passer" || q.kind === "net" || q.kind === "player" || q.kind === "tire" || q.kind === "bumper")) : null;
        const aimPt = viaPc ? { x: viaPc.x, y: viaPc.y }
          : rec.path.length
            ? segEnd(rec, tr.recvAt != null ? Math.max(0, Math.min(tr.recvAt, rec.path.length - 1)) : rec.path.length - 1)
            : { x: rec.x, y: rec.y };
        const rTurn = aimTurn(cur, launch0T, aimPt, warp);
        const launch0 = releaseAt(cur, launch0T, warp, rTurn);
        // a give-and-go bounced off a stationary passer: the puck flies to the
        // passer first, then returns to the receiver from the passer's face; a
        // plain pass launches straight from the carrier's blade
        let launchMin = launch0T, launchT = launch0T, launch = launch0, byId = cur.id, viaFrom = false;
        if (tr.via) {
          const passer = pieces.find(q => q.id === tr.via && (q.kind === "passer" || q.kind === "net" || q.kind === "player" || q.kind === "tire" || q.kind === "bumper"));
          if (!passer) return;                                  // the passer was removed → drop the play
          const pPt = { x: passer.x, y: passer.y };
          const tHit = launch0T + Math.hypot(pPt.x - launch0.x, pPt.y - launch0.y) / vPass();
          legs.push({ type: "fly", by: cur.id, x0: launch0.x, y0: launch0.y, x1: pPt.x, y1: pPt.y, t0: launch0T, t1: tHit,
            ...(rTurn ? { relTurn: rTurn } : {}) });
          launchMin = tHit; launchT = tHit; launch = pPt; byId = tr.via; viaFrom = true;
        }
        let target, tArr;
        if (tr.recvAt != null && rec.path.length) {
          const rj = Math.max(0, Math.min(tr.recvAt, rec.path.length - 1));
          const anchor = { x: rec.path[rj].x, y: rec.path[rj].y };
          // the receiver's natural (unwarped) time + stops/moving to reach recvAt
          let stops = 0, moving = 0;
          for (let i = 0; i <= rj; i++) {
            stops += rec.path[i].stop || 0;
            moving += segMoveTime(rec, rec.path[i], i);
          }
          const tRecvNat = stops + moving;
          // hold the pass until the receiver has run into range so they arrive at
          // natural pace — never fire early and blast them through the whole route
          for (let k = 0; k < 3; k++) {
            const flight = Math.hypot(anchor.x - launch.x, anchor.y - launch.y) / vPass();
            launchT = Math.max(launchMin, tRecvNat - flight);
            if (!viaFrom) launch = releaseAt(cur, launchT, warp, rTurn);  // a via return launches from the fixed passer
          }
          tArr = launchT + Math.hypot(anchor.x - launch.x, anchor.y - launch.y) / vPass();
          // warp only to SLOW an early receiver; never speed them up (f ≤ 1)
          if (!warp[rec.id]) {
            const avail = tArr - stops;
            if (moving > 0 && avail > 0.05)
              warp[rec.id] = { upto: rj, f: Math.min(1, Math.max(0.25, moving / avail)) };
          }
          const tRj = routeTimeW(rec, warp, rj);
          target = bladeAt(rec, tRj, warp, false, null, openIn(tr, rec) ? openTurn(rec, tRj, launch, warp) : 0);
          tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
        } else {
          tArr = launchT;
          for (let k = 0; k < 3; k++) {
            target = bladeAt(rec, tArr, warp, false, null, openIn(tr, rec) ? openTurn(rec, tArr, launch, warp) : 0);
            tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
          }
          target = bladeAt(rec, tArr, warp, false, null, openIn(tr, rec) ? openTurn(rec, tArr, launch, warp) : 0);
        }
        // a flat pass that would cut through a bumper lifts over it automatically
        const sauce = !!tr.sauce || (bumpSh.length > 0 && segCrossesNet(launch, target, bumpSh));
        legs.push({ type: "fly", by: byId, x0: launch.x, y0: launch.y, x1: target.x, y1: target.y, t0: launchT, t1: tArr, sauce,
          ...(byId === cur.id && rTurn ? { relTurn: rTurn } : {}) });
        legs.push({ type: "ride", id: rec.id, t0: tArr, catch: true, ...(tr.open ? { open: true } : {}) });
        // the carrier's own release (a `via` bounces off a passer first, so the
        // carrier lets go earlier, at launch0T)
        newEvents.push({ by: cur.id, at: tr.at, t: tr.via ? launch0T : launchT, kind: "pass" });
        cur = rec;
        tBase = tArr;
      });
      if (chainBlocked) { /* chain died at a net — no terminal action */ }
      else if (pk.termBy && cur && pk.termBy !== cur.id) { /* intended shooter never got it */ }
      else if (pk.shotAt != null && cur) doShot(pk.shotAt, null, pk.net, pk.shand || null); // terminal shot (no collector)
      else if (pk.rimAt != null && cur) {              // terminal hard rim around the boards
        const at = pk.rimAt;
        const launchT = (cur.path.length && at >= 0) ? Math.max(tBase, routeTimeW(cur, warp, Math.min(at, cur.path.length - 1))) : tBase;
        newEvents.push({ by: cur.id, at, t: launchT, kind: "rim" });
        const lb = releaseAt(cur, launchT, warp);
        const launch = boards.clampInside(lb.x, lb.y);           // a blade past the boards → no path
        const dist = pk.rimDist != null ? pk.rimDist : 65;       // handle-set travel distance
        const r = pushTravel(densify(reflectPath(boards.rimAround(launch, dist, pk.rimAim), netSh)), launchT, vRim(), { by: cur.id, rim: true, easeOut: Math.min(55, dist * 0.6) });
        legs.push({ type: "rest", x: r.end.x, y: r.end.y, t0: r.t }); tBase = r.t;
      } else if (pk.chipAt != null && cur) {           // terminal chip into space (bounces)
        const at = pk.chipAt;
        const launchT = (cur.path.length && at >= 0) ? Math.max(tBase, routeTimeW(cur, warp, Math.min(at, cur.path.length - 1))) : tBase;
        newEvents.push({ by: cur.id, at, t: launchT, kind: "chip" });
        const lb = releaseAt(cur, launchT, warp);
        const launch = boards.clampInside(lb.x, lb.y);           // a blade past the boards → no path
        const h = chipHeading(cur, launchT, pk.chipAim);
        const dist = pk.chipDist != null ? pk.chipDist : 26;     // handle-set travel distance
        const r = pushTravel(densify(reflectPath(boards.slide(launch.x, launch.y, h.x, h.y, dist), netSh)), launchT, vChip(), { by: cur.id, chip: true, easeOut: Math.min(28, dist * 0.6) });
        legs.push({ type: "rest", x: r.end.x, y: r.end.y, t0: r.t }); tBase = r.t;
      }
      let relT = Infinity;
      if (pk.path.length && pk.shotAt == null && pk.rimAt == null && pk.chipAt == null && !pk.pickup) {
        const finish = Math.max(tBase + 0.01, routeTimeW(cur, warp));
        relT = finish;
        const step = Math.max(0.03, (finish - tBase) / 200);
        for (let t = tBase; t <= finish + 1e-6; t += step) {
          const b = bladeAt(cur, t, warp);
          if (Math.hypot(b.x - pk.x, b.y - pk.y) < 3) { relT = t; break; }
        }
      }
      plans[pk.id] = { legs, final: cur.id };
      rel[pk.id] = relT;
    });
    // action triggers fire on these releases; loop until the fed-back times settle
    const converged = evSig(newEvents) === evSig(events);
    events = newEvents;
    if (converged) break;
    }   // end action-trigger fixpoint loop
    planCache.current = { key: pieces, pace, sig: lenSig, seed, real: realisticShots, det: detail, odds,
      warp, plans, rel, holds: {}, startWait: sw, trigPause: tp };
    currentHolds = {};
    currentPivots = {};
    currentOpens = {};

    // blue-line entry holds: a "hold=line" player waits at their last neutral
    // waypoint until the puck first crosses into the zone they are entering.
    // Computed after the plan (and with holds still empty) so the puck's own
    // timing — sampled below via displayPosAt — is unaffected.
    // how long anything is still in motion — carried pucks ride a player, so
    // bound the sampling by the players' route times, not just the puck legs
    let horizon = 1;
    pieces.forEach(q => { if (q.path && q.path.length) horizon = Math.max(horizon, routeTimeW(q, warp)); });
    Object.values(plans).forEach(pl => pl.legs.forEach(l => { horizon = Math.max(horizon, l.t1 || l.t0); }));
    horizon += 1;
    const puckEnter = (bx, into) => {
      let best = Infinity;
      pieces.forEach(pk => {
        if (pk.kind !== "puck" || !plans[pk.id]) return;
        let wasIn = null;
        for (let e = 0; e <= horizon; e += 0.1) {
          const isIn = (into < 0 ? displayPosAt(pk, e).x < bx : displayPosAt(pk, e).x > bx);
          if (wasIn === false && isIn) { best = Math.min(best, e); break; }
          wasIn = isIn;
        }
      });
      return best;
    };
    const holds = {};
    pieces.forEach(p => {
      if (p.kind !== "player" || !p.holdLine || !p.path.length) return;
      const endX = p.path[p.path.length - 1].x;
      const bx = endX < 75 ? 75 : endX > 125 ? 125 : null; // the zone's blue line
      if (bx == null) return;                              // route doesn't end in an o-zone
      const into = endX < 75 ? -1 : 1;
      const inZone = x => (into < 0 ? x < bx : x > bx);
      if (inZone(p.x) && inZone(p.path[0].x)) return;      // already starts in the zone
      let seg = -1;
      for (let i = 0; i < p.path.length; i++) if (inZone(p.path[i].x)) { seg = i; break; }
      if (seg < 0) return;
      // locate where segment `seg` actually crosses the blue line (mid-segment)
      const el = segRefs.current[`${p.id}/${seg}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      if (!el || !L) return;
      // the crossing must go from the NEUTRAL zone (75..125) over the blue line
      // into the offensive zone — not just any blue line the route may touch
      let found = false, fCross = 0, cx = p.path[seg].x, cy = p.path[seg].y;
      let prevX = seg === 0 ? p.x : p.path[seg - 1].x, prevL = 0;
      const steps = Math.max(10, Math.ceil(L));
      for (let k = 1; k <= steps; k++) {
        const l = (L * k) / steps;
        let pt; try { pt = el.getPointAtLength(l); } catch { break; }
        const fromNeutral = prevX >= 75 && prevX <= 125;
        const crossed = fromNeutral && (into < 0 ? pt.x < bx : pt.x > bx);
        if (crossed) {
          const f = (bx - prevX) / ((pt.x - prevX) || 1);
          const lc = prevL + (l - prevL) * f;
          fCross = Math.max(0, Math.min(1, lc / L));
          try { const c = el.getPointAtLength(lc); cx = c.x; cy = c.y; } catch { /* keep endpoint */ }
          found = true;
          break;
        }
        prevX = pt.x; prevL = l;
      }
      if (!found) return;                                  // no neutral → o-zone entry to hold at
      // when the player naturally reaches the blue line, then the puck's entry
      const tCross = routeTimeW(p, warp, seg - 1) + effMove(p, p.path[seg], seg, warp) * fCross;
      const tPuck = puckEnter(bx, into);
      if (isFinite(tPuck) && tPuck - tCross > 0.05) holds[p.id] = { seg, fCross, cx, cy, dur: tPuck - tCross };
    });
    currentHolds = holds;
    planCache.current.holds = holds;
    currentPivots = buildPivots(warp, plans);
    planCache.current.pivots = currentPivots;
    currentOpens = buildOpens(warp, plans);
    planCache.current.opens = currentOpens;
    return planCache.current;
  }

  // How far a receiver has turned to face the puck at the moment they take it.
  // Used in TWO places that must agree: the plan aims the pass at the blade this
  // puts the stick on, and buildOpens turns the body through it. If only the body
  // knew, the pass would fly at the un-opened stick and then visibly hook across at
  // the last moment to find the real one.
  // A fwd↔bwd reversal AT the catch waypoint already turns the receiver right round,
  // and that pivot IS the opening-up — they turn to take the pass and keep turning
  // into the backward stride. Layering a catch turn on top of it swings them most of
  // the way round and then back, which reads as a wild spin. Read straight off the
  // path so the planner and the renderer reach the same answer without either
  // needing the other's timing.
  const reversesAtCatch = (rec, at) =>
    !!(rec && rec.path && at != null && at >= 0 && at + 1 < rec.path.length
       && stepFlip(rec.path[at]) !== stepFlip(rec.path[at + 1]));
  // does this delivery turn its receiver? — flagged by the coach, or a standing
  // player, who always squares up to what is coming at them
  const openIn = (tr, rec) => (!!(tr && tr.open) || !!(rec && !rec.path.length))
    && !reversesAtCatch(rec, tr && tr.recvAt);
  // The mirror of openTurn: a player standing still squares up to what they are
  // about to play the puck at, so it leaves off their forehand instead of off
  // whatever angle they were parked at. A skater is already going somewhere — their
  // route is the aim — so this only moves a stationary body.
  function aimTurn(rel, tAt, to, warp) {
    if (!rel || rel.path.length || !to) return 0;
    const here = routePosAt(rel, tAt, warp);
    if (Math.hypot(to.x - here.x, to.y - here.y) < 1) return 0;
    const deg = wrapDeg((Math.atan2(to.y - here.y, to.x - here.x) * 180) / Math.PI - (here.aStep || 0));
    return Math.abs(deg) < 1 ? 0 : deg;
  }
  function openTurn(rec, tAt, from, warp) {
    const here = routePosAt(rec, tAt, warp);
    if (!from || Math.hypot(from.x - here.x, from.y - here.y) < 1) return 0;
    let deg = wrapDeg((Math.atan2(from.y - here.y, from.x - here.x) * 180) / Math.PI - (here.aStep || 0));
    if (Math.abs(deg) < 1) return 0;                    // already looking right at it
    // dead astern is a coin flip — open over the shoulder that presents the forehand
    if (Math.abs(deg) > 179) deg = 180 * (rec.hand === "L" ? -1 : 1);
    return deg;
  }

  // Opening up. At every catch flagged `open`, the receiver turns to face where the
  // puck is coming FROM — walked back down the puck's own planned legs until it is
  // OPEN_BACK_FT away, so a pass points at the passer, a rim back along the boards,
  // a rebound at the net, and a puck already lying there points at itself (no turn).
  // Display-only: the flight was planned off the stepped heading and stays that way,
  // so opening up cannot move a leg time.
  function buildOpens(warp, plans) {
    const out = {};
    planPhase = true;
    try {
      for (const pk of pieces) {
        const pl = plans[pk.id];
        if (!pl) continue;
        pl.legs.forEach((leg, k) => {
          // a standing passer squaring up to their receiver: the plan already aimed
          // the release off this exact turn (relTurn), so the body and the puck agree
          if (leg.type === "fly" && leg.relTurn) {
            const sh = pieces.find(q => q.id === leg.by && q.kind === "player");
            if (sh) {
              const t = leg.t0 - startWaitOf(sh);
              (out[sh.id] = out[sh.id] || []).push({ t0: t - OPEN_IN - OPEN_SET, t1: t - OPEN_SET,
                t2: t + OPEN_HELD, t3: t + OPEN_HELD + OPEN_OUT, deg: leg.relTurn });
            }
            return;
          }
          const rec = pieces.find(q => q.id === leg.id && q.kind === "player");
          if (!rec || leg.type !== "ride") return;
          // A player who is standing still turns to take it on their forehand as a
          // matter of course — nobody waits square while a pass arrives over their
          // shoulder. A skater only does it when the coach asked for it.
          if (!leg.open && rec.path.length) return;
          // the pivot at this waypoint is already doing the turning (see reversesAtCatch)
          const pv = currentPivots[rec.id];
          if (pv && [...pv.byIdx.values()].some(w => Math.abs(w.tc - (leg.t0 - startWaitOf(rec))) < 0.6)) return;
          const here = routePosAt(rec, leg.t0, warp);
          let sx = null, sy = null;
          for (let j = k - 1; j >= 0; j--) {
            const L = pl.legs[j];
            const px = L.type === "rest" ? L.x : L.x0, py = L.type === "rest" ? L.y : L.y0;
            if (px == null || py == null) break;
            sx = px; sy = py;
            if (Math.hypot(px - here.x, py - here.y) >= OPEN_BACK_FT) break;
          }
          // the SAME turn the plan aimed the delivery at (openTurn), so the stick is
          // where the puck was sent and the flight stays straight
          const deg = openTurn(rec, leg.t0, sx == null ? null : { x: sx, y: sy }, warp);
          if (!deg) return;
          const t = leg.t0 - startWaitOf(rec);              // route-local, to match routePosAt
          (out[rec.id] = out[rec.id] || []).push({ t0: t - OPEN_IN - OPEN_SET, t1: t - OPEN_SET,
            t2: t + OPEN_HELD, t3: t + OPEN_HELD + OPEN_OUT, deg });
        });
      }
    } finally { planPhase = false; }
    return out;
  }

  // Where does a pivoting skater end up looking? Left/right are literal shoulders;
  // otherwise they open toward the nearest other player, or (the default) toward
  // whichever puck is on someone's stick — a loose puck or a corner pile is not
  // something you turn to watch. With nothing to read, they open to mid-ice.
  function pivotSign(p, i, from, tAbs, warp, plans) {
    const want = p.path[i + 1].turn || "puck";
    if (want === "left") return -1;
    if (want === "right") return 1;
    const px = p.path[i].x, py = p.path[i].y;
    const h0 = segTangentAngle(segEnd(p, i - 1), p.path[i], 0.98) + from;   // heading before the sweep
    let tx = null, ty = null, best = Infinity;
    for (const q of pieces) {
      if (q.id === p.id) continue;
      if (want === "player") { if (q.kind !== "player") continue; }
      else {
        if (q.kind !== "puck") continue;
        const pl = plans[q.id];
        if (!pl) continue;
        let leg = pl.legs[0];
        for (const L of pl.legs) { if (tAbs >= L.t0) leg = L; else break; }
        // a puck is "on a stick" only while it RIDES a carrier — in flight, loose, or
        // sitting in a pile it isn't something you turn to watch, and a player doesn't
        // turn to look at the puck they are carrying themselves
        if (!leg || leg.type !== "ride" || leg.id === p.id) continue;
        if (!pieces.some(c => c.id === leg.id && c.kind === "player")) continue;
      }
      const d = displayPosAt(q, tAbs);
      const dd = Math.hypot(d.x - px, d.y - py);
      if (dd > 0.5 && dd < best) { best = dd; tx = d.x; ty = d.y; }
    }
    if (tx == null) { tx = px; ty = CENTRE_Y; }                 // nothing to read — open to mid-ice
    if (Math.hypot(tx - px, ty - py) < 1) return 1;
    const rel = wrapDeg((Math.atan2(ty - py, tx - px) * 180) / Math.PI - h0);
    return rel >= 0 ? 1 : -1;                                   // sweep the front THROUGH that bearing
  }

  // one pivot window per waypoint where the skate direction changes
  function buildPivots(warp, plans) {
    const out = {};
    const lists = [];
    for (const p of pieces) {
      if (p.kind !== "player" || !p.path || p.path.length < 2) continue;
      const sw = startWaitOf(p);
      // when this player takes a puck (route-local), so a reversal landing on a catch
      // can lead into it rather than starting as the puck arrives
      const catches = [];
      for (const pid in plans)
        for (const L of plans[pid].legs)
          if (L.type === "ride" && L.catch && L.id === p.id) catches.push(L.t0 - sw);
      const list = [];
      for (let i = 0; i < p.path.length - 1; i++) {
        const from = stepFlip(p.path[i]), to = stepFlip(p.path[i + 1]);
        if (from === to) continue;
        const tc = routeTimeW(p, warp, i) - sw;                 // route-local arrival at waypoint i
        const pause = (p.path[i + 1].stop || 0) + trigPauseOf(p, i + 1);
        let t0, t1;
        if (pause > 0.05) {                                    // they stop here — pivot standing still
          const w = Math.min(PIVOT_SEC, pause);
          t0 = tc + (pause - w) / 2; t1 = t0 + w;
        } else {                                               // straddle the waypoint, clamped so a
          const inT = effMove(p, p.path[i], i, warp);          // very short leg isn't swallowed whole
          const outT = effMove(p, p.path[i + 1], i + 1, warp);
          // A reversal that lands on a catch starts EARLY and runs long: the skater
          // opens toward the pass before it arrives, takes it side-on, and settles the
          // rest of the way into the backward stride. Centred on the waypoint instead,
          // the turn only begins as the puck lands and reads as a reaction to it.
          const meets = catches.some(ct => Math.abs(ct - tc) < 0.35);
          const lead = meets ? Math.min(PIVOT_SEC * 1.1, 0.55 * inT) : Math.min(PIVOT_SEC / 2, 0.4 * inT);
          const tail = meets ? Math.min(PIVOT_SEC * 0.9, 0.5 * outT) : Math.min(PIVOT_SEC / 2, 0.4 * outT);
          t0 = tc - lead;
          t1 = tc + tail;
        }
        list.push({ i, from, to, tc, tAbs: tc + sw, t0, t1, sign: 1 });
      }
      if (!list.length) continue;
      for (let k = 1; k < list.length; k++) {                   // back-to-back flips must not overlap
        if (list[k].t0 < list[k - 1].t1) {
          const m = (list[k - 1].tc + list[k].tc) / 2;
          list[k - 1].t1 = Math.min(list[k - 1].t1, m);
          list[k].t0 = Math.max(list[k].t0, m);
        }
      }
      lists.push([p, list]);
      out[p.id] = { path: p.path, byIdx: new Map(list.map(w => [w.i, w])) };
    }
    // sampling the rest of the ice re-enters routePosAt; the guard keeps that pass
    // on the stepped flip, so it bottoms out immediately (and positions don't
    // depend on the flip anyway — only a puck riding a blade shifts slightly)
    planPhase = true;
    try {
      for (const [p, list] of lists)
        for (const w of list) w.sign = pivotSign(p, w.i, w.from, w.tAbs, warp, plans);
    } finally { planPhase = false; }
    return out;
  }

  function pieceTime(p) {
    const { warp, plans, rel } = getPlan();
    if (p.kind === "puck") {
      const pl = plans[p.id];
      if (pl) {
        if (p.path.length && p.shotAt == null && !p.pickup) return rel[p.id] + routeTimeW(p, warp);
        const fin = pieces.find(q => q.id === pl.final);
        const lastT = pl.legs[pl.legs.length - 1].t0;
        return fin ? Math.max(lastT, routeTimeW(fin, warp)) : lastT;
      }
    }
    return routeTimeW(p, warp);
  }
  // trapezoidal (constant-accel) time→distance easing within a leg. a/b are the
  // fraction of the leg spent ramping up / down; they preserve the leg's total
  // duration (so routeTimeW / pass sync are untouched) while shaping velocity.
  // Returns eased arc fraction s and normalized speed v (0 at rest, 1 cruising).
  const RAMP_UP = 0.15;   // explosive push-off — short accel ramp
  const RAMP_DOWN = 0.12; // hockey stop — carry speed then bite the ice hard
  // A hockey stop bites sideways and THEN settles square — the sideways plant is
  // at its deepest the instant they come to rest, so it has to keep decaying after
  // the route stops rather than vanishing in one frame. `brake` (0..1) rises over
  // the deceleration ramp, holds while the edges bite, and relaxes away.
  const PLANT_HOLD = 0.12, PLANT_RELAX = 0.55;
  const brakeRelax = t => 1 - smooth01((t - PLANT_HOLD) / PLANT_RELAX);
  // WHICH edge they plant on comes from the stride phase, so it has to be frozen at
  // the arrival distance — sampled live it flips sign mid-stop and the body snaps
  // across. `brakeAt` is that frozen distance; the renderer turns it into a side.
  // returns eased arc fraction s and normalized speed v (0 at rest, 1 at the
  // leg's flat-top cruise) — v is vmax-free, so it maps cleanly to speed class
  function easeLeg(u, a, b) {
    if (a <= 0 && b <= 0) return { s: u, v: 1 };
    const vmax = 1 / (1 - (a + b) / 2);
    if (a > 0 && u < a) return { s: (vmax * u * u) / (2 * a), v: u / a };
    if (b > 0 && u > 1 - b) {
      const w = u - (1 - b);
      return { s: vmax * (1 - b - a / 2 + w - (w * w) / (2 * b)), v: (b - w) / b };
    }
    return { s: vmax * (u - a / 2), v: 1 };
  }

  // position/heading along a piece's own route at elapsed e (warp-aware).
  // Also returns v (normalized speed) and dist (feet travelled) for stride FX.
  function routePosAt(p, e, warp) {
    if (!p.path.length) {
      // A standing piece is not furniture: it watches the play, and squares up to a
      // pass it is taking or making. aStep stays the AUTHORED facing, so every
      // planned launch/catch point is unmoved — the plan adds its own turn explicitly.
      const base = p.facing || 0;
      const o = openPart(p, e - startWaitOf(p));
      let show = base;
      if (p.kind === "player") {
        const g = gazeAt(p, e);
        // ease off the authored pose rather than starting the drill mid-turn
        if (g) show = base + wrapDeg(g.deg - base) * g.conf * smooth01(e / GAZE_IN);
        // ...and a catch or release takes precedence over idle watching as it peaks
        if (o.k > 0) show += wrapDeg(base + o.deg - show) * o.k;
      } else show = base + o.deg * o.k;
      return { x: p.x, y: p.y, a: show, aStep: base, flip: wrapDeg(show - base), v: 0, dist: 0 };
    }
    e -= startWaitOf(p);   // hold at the start until the trigger fires (e<=0 → start pose below)
    // `a` is the DISPLAY heading — smoothed through a fwd↔bwd pivot; `aStep` keeps
    // the old instant flip, and everything that plans puck geometry (blade spots,
    // chip headings) stays on it so no pivot can move a launch point or a leg time.
    const eLoc = e;
    const flip = i => flipAt(p, i, eLoc) + openAt(p, eLoc);
    // Sharp interior corners get a speed dip (carve the turn) so the skater
    // decelerates in and accelerates out instead of pivoting at full speed.
    const dirN = (dx, dy) => { const m = Math.hypot(dx, dy) || 1; return [dx / m, dy / m]; };
    const legStart = j => (j === 0 ? { x: p.x, y: p.y } : { x: p.path[j - 1].x, y: p.path[j - 1].y });
    const exitDir = j => { const sj = p.path[j], pv = legStart(j);
      if (sj.type === "Q") return dirN(sj.x - sj.cx, sj.y - sj.cy);
      if (sj.type === "C") return dirN(sj.x - sj.c2x, sj.y - sj.c2y);
      return dirN(sj.x - pv.x, sj.y - pv.y); };
    const entryDir = j => { const sj = p.path[j], pv = legStart(j);
      if (sj.type === "Q") return dirN(sj.cx - pv.x, sj.cy - pv.y);
      if (sj.type === "C") return dirN(sj.c1x - pv.x, sj.c1y - pv.y);
      return dirN(sj.x - pv.x, sj.y - pv.y); };
    // ramp fraction for the corner between leg j and j+1 (0 straight → ~0.2 hairpin)
    const cornerRamp = j => {
      if (j < 0 || j + 1 >= p.path.length) return 0;
      const [ax, ay] = exitDir(j), [bx, by] = entryDir(j + 1);
      const ang = (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) * 180) / Math.PI;
      return Math.max(0, Math.min(1, (ang - 22) / (120 - 22))) * 0.2;
    };
    if (e <= 0) {
      const s0 = p.path[0], t0 = segTangentAngle({ x: p.x, y: p.y }, s0, 0.02), f0 = flip(0);
      return { x: p.x, y: p.y, a: t0 + f0, aStep: t0 + stepFlip(s0), flip: f0, v: 0, dist: 0 };
    }
    // position + heading at arc-length `arc` along segment element el
    const atArc = (el, L, arc, s, i) => {
      const pt = el.getPointAtLength(arc);
      const q = el.getPointAtLength(Math.min(L, arc + 0.6));
      let a;
      if (Math.hypot(q.x - pt.x, q.y - pt.y) < 0.05) {
        const b = el.getPointAtLength(Math.max(0, arc - 0.6));
        a = (Math.atan2(pt.y - b.y, pt.x - b.x) * 180) / Math.PI;
      } else {
        a = (Math.atan2(q.y - pt.y, q.x - pt.x) * 180) / Math.PI;
      }
      const f = flip(i);
      return { x: pt.x, y: pt.y, a: a + f, aStep: a + stepFlip(s), flip: f };
    };
    let prev = { x: p.x, y: p.y };
    let dist = 0, lastSpd = 0;   // cruise speed of the leg just skated (for the stop spray)
    for (let i = 0; i < p.path.length; i++) {
      const s = p.path[i];
      const stop = (s.stop || 0) + trigPauseOf(p, i);
      if (e < stop) {
        // pausing at a waypoint: the tangent jumps to the next leg's the instant they
        // arrive, so a pivot taken standing still swings the tangent across too
        const tOut = segTangentAngle(prev, s, 0.02);
        let tan = tOut;
        const pvw = i > 0 && !planPhase && currentPivots[p.id]?.path === p.path
          ? currentPivots[p.id].byIdx.get(i - 1) : null;
        if (pvw && eLoc < pvw.t1) {
          const tIn = segTangentAngle(legStart(i - 1), p.path[i - 1], 0.98);
          const u = smooth01(pvw.t1 > pvw.t0 ? (eLoc - pvw.t0) / (pvw.t1 - pvw.t0) : 1);
          tan = tIn + wrapDeg(tOut - tIn) * u;
        }
        const f = flip(i);
        return { ...prev, a: tan + f, aStep: tOut + stepFlip(s), flip: f, v: 0, dist,
          // only a real STOP braked the previous leg (exitRest tests s.stop, not a
          // trigger pause) — relaxing a plant they never took would snap it on
          brakeAt: dist, brakeUp: false, brakeSpd: lastSpd,
          brake: i > 0 && (s.stop || 0) > 0 ? brakeRelax(e) : 0 };
      }
      e -= stop;
      const mt = effMove(p, s, i, warp);
      const el = segRefs.current[`${p.id}/${i}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      const nxt = p.path[i + 1];
      const entryRest = i === 0 || stop > 0;
      const exitRest = i === p.path.length - 1 || (nxt && (nxt.stop || 0) > 0);
      const zh = currentHolds[p.id];
      const zHold = zh && zh.seg === i && mt > 0 && L > 0 ? zh : null;

      if (zHold) {
        // blue-line delay: skate to the crossing, drift laterally while waiting
        // for the puck, then explode into the zone
        const tBefore = mt * zHold.fCross, tAfter = mt * (1 - zHold.fCross);
        try {
          if (e < tBefore) {
            const { s: sf, v } = easeLeg(tBefore > 0 ? e / tBefore : 1, entryRest ? RAMP_UP : 0, RAMP_DOWN);
            const arc = zHold.fCross * L * sf;
            const smul = tBefore > 0 ? ((zHold.fCross * L / tBefore) / pace) * v : 0;
            return { ...atArc(el, L, arc, s, i), v, smul, dist: dist + arc, brakeAt: dist + L,
              brake: e / tBefore > 1 - RAMP_DOWN ? 1 - v : 0 };
          }
          e -= tBefore;
          const dir = zHold.cy <= 42.5 ? 1 : -1;                   // one-way, toward center ice
          const DRIFT_RATE = 3, DRIFT_MAX = 10;
          const dyEnd = Math.min(DRIFT_MAX, DRIFT_RATE * zHold.dur);
          if (e < zHold.dur) {
            // hold on the line, slowly gliding toward the middle
            const dy = Math.min(DRIFT_MAX, DRIFT_RATE * e) * dir;
            const ha = dir > 0 ? 90 : -90;   // the hold's own pose wins over any pivot
            return { x: zHold.cx, y: clampY(zHold.cy + dy), a: ha, aStep: ha, flip: 0, v: 0, dist: dist + zHold.fCross * L };
          }
          e -= zHold.dur;
          if (e < tAfter) {
            const { s: sf, v } = easeLeg(tAfter > 0 ? e / tAfter : 1, RAMP_UP, exitRest ? RAMP_DOWN : 0);
            const arc = zHold.fCross * L + (1 - zHold.fCross) * L * sf;
            const smul = tAfter > 0 ? (((1 - zHold.fCross) * L / tAfter) / pace) * v : 0;
            const off = dyEnd * (1 - sf) * dir;                    // cut in and rejoin the route
            const pos = atArc(el, L, arc, s, i);
            const br = exitRest && e / tAfter > 1 - RAMP_DOWN;
            return { ...pos, y: clampY(pos.y + off), v, smul, dist: dist + arc, brakeAt: dist + L, brake: br ? 1 - v : 0 };
          }
          e -= tAfter;
        } catch { return { ...prev, a: 0, aStep: 0, flip: 0, v: 0, dist }; }
        dist += L;
        prev = { x: s.x, y: s.y };
        continue;
      }

      if (mt > 0 && e < mt) {
        try {
          const aRamp = entryRest ? RAMP_UP : cornerRamp(i - 1);   // ease out of a sharp corner
          const bRamp = exitRest ? RAMP_DOWN : cornerRamp(i);      // ease into the next sharp corner
          const { s: sf, v } = easeLeg(e / mt, aRamp, bRamp);
          const braking = exitRest && e / mt > 1 - RAMP_DOWN;   // biting into a stop
          const smul = mt > 0 ? ((L / mt) / pace) * v : 0;
          return { ...atArc(el, L, L * sf, s, i), v, smul, dist: dist + L * sf, brakeAt: dist + L,
            brake: braking ? 1 - v : 0, brakeUp: braking, brakeSpd: mt > 0 ? (L / mt) / pace : 0 };
        } catch { return { ...prev, a: 0, aStep: 0, flip: 0, v: 0, dist }; }
      }
      e -= mt;
      dist += L;
      lastSpd = mt > 0 ? (L / mt) / pace : 0;
      prev = { x: s.x, y: s.y };
    }
    const last = p.path[p.path.length - 1], li = p.path.length - 1;
    const lp = segEnd(p, li - 1);
    const ta = segTangentAngle(lp, last, 0.98), fl = flip(li);
    return { x: last.x, y: last.y, a: ta + fl, aStep: ta + stepFlip(last), flip: fl, v: 0, dist,
      brakeAt: dist, brakeUp: false, brakeSpd: lastSpd, brake: brakeRelax(e) };
  }

  // A puck in the closing stretch of a delivery that ends in a catch: who takes it,
  // and how far through that stretch it is. timing can only steer onto the ROUTE-pose
  // blade; the renderer owns the body lean, hockey-stop plant and puck shield, so it
  // finishes the job onto the blade actually on screen.
  function catchApproach(pkId, e) {
    const { plans } = getPlan();
    const pl = plans[pkId];
    if (!pl) return null;
    let li = 0;
    for (let k = 0; k < pl.legs.length; k++) { if (e >= pl.legs[k].t0) li = k; else break; }
    const leg = pl.legs[li], nx = pl.legs[li + 1];
    if (!leg || leg.type !== "fly" || e >= leg.t1 || !nx || nx.type !== "ride" || !nx.catch) return null;
    const w = smooth01(((e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0) - 0.65) / 0.35);
    return w > 0 ? { id: nx.id, w } : null;
  }

  // Is this puck in the air (or skidding) right now? The renderer attaches a puck to
  // the nearest blade by proximity, which is right for a carry but wrong the instant
  // one is fired: for a frame or two the puck is still within reach of the stick that
  // just shot it, so it gets snapped back onto the blade and then let go all at once.
  function puckInFlight(pkId, e) {
    const { plans } = getPlan();
    const pl = plans[pkId];
    if (!pl) return false;
    let leg = pl.legs[0];
    for (const L of pl.legs) { if (e >= L.t0) leg = L; else break; }
    return !!leg && (leg.type === "fly" || leg.type === "skid") && e < leg.t1;
  }

  function displayPosAt(p, e) {
    const { warp, plans, rel } = getPlan();
    if (p.kind === "puck") {
      const pl = plans[p.id];
      if (pl) {
        const relT = rel[p.id];
        if (p.path.length && e >= relT) return routePosAt(p, e - relT, warp);
        let leg = pl.legs[0], li = 0;
        for (let k = 0; k < pl.legs.length; k++) { if (e >= pl.legs[k].t0) { leg = pl.legs[k]; li = k; } else break; }
        // Both ENDS of a flight are planned off the stepped heading, while the puck
        // is drawn riding a live, leaning, pivoting body — so the planned launch and
        // landing points are both a foot or two from where the stick really is. The
        // rendered path is nudged onto the real thing at each end (display only: the
        // plan's own endpoints, and every time derived from them, are untouched).
        const catchPull = tEnd => {
          const nx = pl.legs[li + 1];
          if (planPhase || !nx || nx.type !== "ride" || !nx.catch) return null;
          // a route-less player is a perfectly good receiver — they just stand and
          // take it, and bladeAt reads their blade off `facing` all the same
          const car = pieces.find(q => q.id === nx.id && q.kind === "player");
          if (!car) return null;
          // Aim at the lever the caught puck will actually sit on — the blade TIP on
          // the live display pose — rather than the blade mid-point on the stepped
          // heading the flight was planned against. Those differ even when nobody is
          // turning, which is the pop every plain catch used to end on.
          return bladeAt(car, tEnd, warp, true, stickSpot(car.id, tEnd));
        };
        const pull = (x, y, ex, ey, w) => {
          const b = w > 0 ? catchPull(pl.legs[li + 1].t0) : null;
          return b ? { x: x + (b.x - ex) * w, y: y + (b.y - ey) * w, a: 0 } : { x, y, a: 0 };
        };
        // ...and the launch end: leave from the stick that actually fired it
        const releasePush = () => {
          const prev = pl.legs[li - 1];
          if (planPhase || !leg.by || !prev || prev.type !== "ride" || prev.id !== leg.by) return null;
          const sh = pieces.find(q => q.id === leg.by && q.kind === "player");
          if (!sh) return null;
          return bladeAt(sh, leg.t0, warp, true, leg.back ? BACK_LEVER : FORE_LEVER);
        };
        if (leg.type === "fly" && e < leg.t1) {
          const k = Math.max(0, Math.min(1, (e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)));
          let x = leg.x0 + (leg.x1 - leg.x0) * k, y = leg.y0 + (leg.y1 - leg.y0) * k;
          const wOut = 1 - smooth01(k / 0.35);
          if (wOut > 0) { const r = releasePush();
            if (r) { x += (r.x - leg.x0) * wOut; y += (r.y - leg.y0) * wOut; } }
          return pull(x, y, leg.x1, leg.y1, smooth01((k - 0.65) / 0.35));
        }
        if (leg.type === "skid" && e < leg.t1) {
          const u = Math.max(0, Math.min(1, (e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)));
          const k = 1 - (1 - u) * (1 - u); // ease-out: rebound pops then glides to rest
          return { x: leg.x0 + (leg.x1 - leg.x0) * k, y: leg.y0 + (leg.y1 - leg.y0) * k, a: 0 };
        }
        if (leg.type === "free") return routePosAt(p, e, warp);
        if (leg.type === "fly" || leg.type === "skid") {
          const nx = pl.legs[li + 1];
          return pull(leg.x1, leg.y1, leg.x1, leg.y1,
            nx ? smooth01((e - (nx.t0 - OPEN_OUT)) / OPEN_OUT) : 0);
        }
        if (leg.type === "rest") {
          const nx = pl.legs[li + 1];   // sat there waiting to be gathered
          return pull(leg.x, leg.y, leg.x, leg.y,
            nx ? smooth01((e - (nx.t0 - OPEN_OUT)) / OPEN_OUT) : 0);
        }
        const car = pieces.find(q => q.id === leg.id);
        if (car) return carriedPuckAt(car, e, warp);
        return { x: p.x, y: p.y, a: 0 };
      }
      return routePosAt(p, e, warp);
    }
    return routePosAt(p, e, warp);
  }

  // true while a puck sits in / crosses the net as a goal (its active leg is
  // flagged goal) — the renderer sinks it under the cage so it reads as "in"
  function puckInGoal(p, e) {
    if (p.kind !== "puck") return false;
    const { plans } = getPlan();
    const pl = plans[p.id];
    if (!pl) return false;
    let leg = pl.legs[0];
    for (const L of pl.legs) { if (e >= L.t0) leg = L; else break; }
    return !!leg.goal;
  }

  // stick-motion angle (deg) for a player at elapsed e: 0 except in the brief
  // window of one of their stick events —
  //   shot:  draw the blade back off the puck, sweep THROUGH it, follow through
  //   pass:  the same, smaller and quicker
  //   catch: reach out to meet the puck, then cushion back to neutral
  // Positive rotates the blade outboard/back (toward the strong side); the icon
  // mirrors the whole stick group for a left shot, so one sign serves both hands.
  // At the release frame the blade sits at RELEASE_SWING — out beside the near
  // foot, where the puck actually leaves — not swept across the nose.
  const stickSwing = (id, e) => (detail ? swingDeg(id, e) : 0);
  // the stick's rotation (deg) at time e — one curve, drawn on the stick AND carried
  // by the puck, so the two can never come apart
  function swingDeg(id, e) {
    const { plans } = getPlan();
    let ang = 0, best = Infinity; // pick the most-centered event when several overlap
    let carrying = false;         // no shot/catch nearby → cradle the puck instead
    for (const pid in plans) {
      const legs = plans[pid].legs;
      legs.forEach((leg, k) => {
        if (leg.type === "ride" && leg.id === id) {
          const end = k + 1 < legs.length ? legs[k + 1].t0 : Infinity;
          if (e >= leg.t0 && e < end) carrying = true;
        }
      });
      for (const leg of plans[pid].legs) {
        if (leg.type === "fly" && leg.by === id) {
          const shot = !!leg.shot;
          const WU = shot ? 0.22 : 0.15, FT = shot ? 0.32 : 0.2;
          // The blade sits at ~28° off the nose at rest and at ~72° when it releases.
          // The wind-up must stay INSIDE the player's own side: +34 swung it round to
          // ~106°, i.e. behind them, and the stick read as flailing rather than loading.
          // A backhand loads and follows through the OTHER way round, so the whole
          // curve mirrors about its own release angle rather than being bolted on.
          const REL = leg.back ? BACK_SWING : RELEASE_SWING, dir = leg.back ? -1 : 1;
          const BACK = REL + dir * (shot ? 18 : 12);    // drawn back off the puck
          const THRU = REL - dir * (shot ? 50 : 34);    // follow through across
          const tau = e - leg.t0;
          if (tau < -WU || tau > FT || Math.abs(tau) >= best) continue;
          best = Math.abs(tau);
          // 0 → back → (release, blade on the puck out beside the foot) → through → 0
          ang = keyframe([[-WU, 0], [-0.55 * WU, BACK], [0, REL], [0.4 * FT, THRU], [FT, 0]], tau);
        }
        if (leg.catch && leg.id === id) {
          const IN = 0.12, OUT = 0.24, MAX = 15;
          const tau = e - leg.t0;
          // slight bias so a shot/pass release outranks a catch at the same moment
          if (tau < -IN || tau > OUT || Math.abs(tau) + 0.05 >= best) continue;
          best = Math.abs(tau) + 0.05;
          ang = tau < 0
            ? MAX * (1 + tau / IN)                              // reach out to meet the puck
            : MAX * (1 - tau / OUT);                            // cushion back to neutral
        }
      }
    }
    // stickhandling cradle — same phase as the carried puck's lateral sweep, so
    // stick and puck move in unison (only when no shot/catch swing is active)
    if (best === Infinity && carrying) ang = Math.sin((e * DRIB_W) / 2) * DRIB_SWING;
    return ang;
  }

  // warped arrival time at a player's waypoint index (for movement captions)
  function waypointTime(p, i) { const { warp } = getPlan(); return routeTimeW(p, warp, i); }

  return { getPlan, pieceTime, displayPosAt, stickSwing, stickSpot, catchApproach, puckInFlight, waypointTime, puckInGoal };
}
