// Timing & pass-planning engine: leg times, receiver warps, transfer chains,
// shots, releases, and warp-aware positions. Pure functions over the pieces
// array; the React component passes its refs in each render.
import { SPEED, ICON_SCALE, SAVE_PROB } from "./constants.js";
import { clampX, clampY, segEnd, segTangentAngle } from "./geometry.js";
import * as boards from "./boards.js";
import { netShapes, solidShapes, bumperShapes, reflectPath, segCrossesNet } from "./net-collide.js";

const GOALIE_DEPTH = 2.5; // how far out front of the net the goalie plays

export function createTiming({ pieces, pace, segRefs, planCache, seed = 0 }) {
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

  function routeTimeW(p, warp, upto = Infinity) {
    let t = startWaitOf(p);
    for (let i = 0; i < p.path.length; i++) {
      if (i > upto) break;
      t += (p.path[i].stop || 0) + trigPauseOf(p, i) + holdAt(p, i) + effMove(p, p.path[i], i, warp);
    }
    return t;
  }

  function bladeAt(pl, e, warp) {
    const cp = routePosAt(pl, e, warp);
    const rad = ((cp.a || 0) * Math.PI) / 180;
    const side = pl.hand === "L" ? -1 : 1;
    const lx = 4.9 * ICON_SCALE, ly = 2.55 * ICON_SCALE * side;
    return {
      x: clampX(cp.x + Math.cos(rad) * lx - Math.sin(rad) * ly),
      y: clampY(cp.y + Math.sin(rad) * lx + Math.cos(rad) * ly),
      a: 0,
    };
  }

  function getPlan() {
    const pc = planCache.current;
    if (pc.key === pieces && pc.pace === pace && pc.sig === lenSig && pc.seed === seed) { currentHolds = pc.holds || {}; currentStartWait = pc.startWait || {}; currentTrigPause = pc.trigPause || {}; return pc; }
    const warp = {};
    const plans = {};
    const rel = {};
    // resolve per-player start waits BEFORE the puck plans (a waiting player's
    // passes/shots must launch at their delayed time). A wait fires when the
    // trigger player reaches waypoint `at`; chains (A waits B waits C) resolve
    // over a few passes. rawTo ignores start-waits so the base times are stable.
    const rawTo = (p, at) => { let t = 0; for (let i = 0; i < p.path.length; i++) { if (i > at) break; t += (p.path[i].stop || 0) + effMove(p, p.path[i], i, warp); } return t; };
    const sw = {};
    for (let pass = 0; pass <= pieces.length; pass++) {
      let changed = false;
      pieces.forEach(p => {
        if (p.kind !== "player" || !p.wait || !p.wait.on) return;
        const trig = pieces.find(q => q.id === p.wait.on && q.kind === "player");
        if (!trig || trig.id === p.id) return;
        const at = p.wait.at == null ? trig.path.length - 1 : Math.max(-1, Math.min(p.wait.at, trig.path.length - 1));
        const w = (sw[trig.id] || 0) + (at < 0 ? 0 : rawTo(trig, at));
        if (Math.abs((sw[p.id] || 0) - w) > 1e-6) { sw[p.id] = w; changed = true; }
      });
      if (!changed) break;
    }
    currentStartWait = sw;
    // trigger pauses: a waypoint holds until another player reaches a waypoint.
    // The pause length = max(0, trigger-arrival − our-arrival at that waypoint).
    // rawArr includes start-waits + fixed stops + already-resolved trig pauses.
    const tp = {};
    const rawArr = (p, at) => {
      let t = (sw[p.id] || 0);
      for (let i = 0; i < p.path.length; i++) { if (i > at) break; t += (p.path[i].stop || 0) + (tp[p.id + "/" + i] || 0) + effMove(p, p.path[i], i, warp); }
      return t;
    };
    for (let pass = 0; pass <= pieces.length + 1; pass++) {
      let changed = false;
      pieces.forEach(p => {
        if (p.kind !== "player" || !p.path.length) return;
        p.path.forEach((s, i) => {
          if (!s.waitOn || !s.waitOn.on) return;
          const trig = pieces.find(q => q.id === s.waitOn.on && q.kind === "player");
          if (!trig || trig.id === p.id) return;
          const at = s.waitOn.at == null ? trig.path.length - 1 : Math.max(-1, Math.min(s.waitOn.at, trig.path.length - 1));
          const trigT = at < 0 ? (sw[trig.id] || 0) : rawArr(trig, at);
          const arriveT = rawArr(p, i - 1);        // the pause sits at the start of segment i (= the prior waypoint)
          const dur = Math.max(0, trigT - arriveT);
          const key = p.id + "/" + i;
          if (Math.abs((tp[key] || 0) - dur) > 1e-6) { tp[key] = dur; changed = true; }
        });
      });
      if (!changed) break;
    }
    currentTrigPause = tp;
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
        const deg = aim != null ? aim : routePosAt(p, t, warp).a || 0;   // explicit aim overrides facing
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
          const atIdx = Math.max(0, Math.min(pk.pickup.at, pl.path.length - 1));
          tPick = routeTimeW(pl, warp, atIdx);
        } else if (pk.path.length) {
          // stationary picker: gather the loose puck when its own route delivers it
          tPick = routeTimeW(pk, warp);
        }
        legs.push({ type: "free", t0: 0 });
        legs.push({ type: "ride", id: pl.id, t0: tPick, catch: true });
        cur = pl;
        tBase = tPick;
      } else return;
      // fire the current carrier's shot at shootIdx; the puck flies to the net,
      // caroms off it and glides to rest in the slot. Returns the rest point.
      // Path-less (stationary) shooters release immediately at tBase.
      // netId targets THIS shot's net (each shot in a chain aims independently:
      // the terminal uses pk.net, a rebound transfer its own tr.net)
      const doShot = (shootIdx, aimPt, netId = pk.net) => {
        const launchT = (cur.path.length && shootIdx >= 0)
          ? Math.max(tBase, routeTimeW(cur, warp, Math.min(shootIdx, cur.path.length - 1)))
          : tBase;
        const launch = bladeAt(cur, launchT, warp);
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
        else net = netId === "left" ? { x: 15, y: 42.5 } : netId === "right" ? { x: 185, y: 42.5 }
          : launch.x < 100 ? { x: 15, y: 42.5 } : { x: 185, y: 42.5 };
        const vShot = pace * SPEED.shot * (pk.speed || 1);
        const inx = net.x - launch.x, iny = net.y - launch.y;
        const mag = Math.hypot(inx, iny) || 1;
        const ux = inx / mag, uy = iny / mag;                 // unit vector toward the net
        const goalie = !!(netPiece && netPiece.goalie);
        const isTire = !!(netPiece && netPiece.kind === "tire");
        // a rebound-designated shot (aimPt = a collector's gather spot) must be
        // saved so the rebound actually comes out; only free shots roll goal/save
        const isGoal = goalie && !aimPt ? rand(`${pk.id}:${legs.length}`) >= SAVE_PROB : false;
        // randomize placement across the ~6 ft mouth: posts / sides / center
        const px = -uy, py = ux;                              // lateral (across the mouth)
        const GOAL_HALF = 2.6;
        const place = rand(`${pk.id}:${legs.length}:p`) * 2 - 1; // −1..1 across the net

        // a NET goalie who is beaten lets it into a post/corner (a goal). A tire
        // goalie who is beaten doesn't concede a goal — the puck just gets past
        // and deflects off the rubber (handled below), so skip the corner here.
        if (goalie && isGoal && !isTire) {                    // beats the goalie — to a post/corner
          const side = place >= 0 ? 1 : -1;
          const lat = side * (0.7 + Math.abs(place) * 0.3) * GOAL_HALF;
          const endPt = { x: clampX(net.x + ux * 1.5 + px * lat), y: clampY(net.y + uy * 1.5 + py * lat) };
          const tArr = launchT + Math.hypot(endPt.x - launch.x, endPt.y - launch.y) / vShot;
          legs.push({ type: "fly", shot: true, goal: true, by: cur.id, x0: launch.x, y0: launch.y, x1: endPt.x, y1: endPt.y, t0: launchT, t1: tArr });
          legs.push({ type: "rest", x: endPt.x, y: endPt.y, t0: tArr });
          tBase = tArr;
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
        // a shot on a real net: empty net = goal; a designated rebound (aimPt,
        // carom out to a collector) reads as a save. A passer is a pass, not a
        // shot on net, so it stays quiet either way.
        const onNet = !!(netPiece && netPiece.kind === "net");
        const scored = onNet && !goalie && !aimPt;
        const saved = (goalie && !isGoal) || (onNet && !!aimPt);
        const flyLeg = { type: "fly", shot: true, save: saved, goal: scored, by: cur.id, x0: launch.x, y0: launch.y, x1: hit.x, y1: hit.y, t0: launchT, t1: tArr };
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
          const lb = bladeAt(cur, launchT, warp);
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
          legs.push({ type: "ride", id: rec.id, t0: gatherT, catch: true });
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
          legs.push({ type: "ride", id: rec.id, t0: tGather, catch: true });
          cur = rec;
          tBase = tGather;
          return;
        }
        // at < 0 means "from the starting spot" (before skating); a route-less
        // carrier likewise releases as soon as it has the puck (tBase)
        const launch0T = (cur.path.length && tr.at >= 0)
          ? Math.max(tBase, routeTimeW(cur, warp, Math.min(tr.at, cur.path.length - 1)))
          : tBase;
        const launch0 = bladeAt(cur, launch0T, warp);
        // a give-and-go bounced off a stationary passer: the puck flies to the
        // passer first, then returns to the receiver from the passer's face; a
        // plain pass launches straight from the carrier's blade
        let launchMin = launch0T, launchT = launch0T, launch = launch0, byId = cur.id, viaFrom = false;
        if (tr.via) {
          const passer = pieces.find(q => q.id === tr.via && (q.kind === "passer" || q.kind === "net" || q.kind === "player"));
          if (!passer) return;                                  // the passer was removed → drop the play
          const pPt = { x: passer.x, y: passer.y };
          const tHit = launch0T + Math.hypot(pPt.x - launch0.x, pPt.y - launch0.y) / vPass();
          legs.push({ type: "fly", by: cur.id, x0: launch0.x, y0: launch0.y, x1: pPt.x, y1: pPt.y, t0: launch0T, t1: tHit });
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
            if (!viaFrom) launch = bladeAt(cur, launchT, warp);  // a via return launches from the fixed passer
          }
          tArr = launchT + Math.hypot(anchor.x - launch.x, anchor.y - launch.y) / vPass();
          // warp only to SLOW an early receiver; never speed them up (f ≤ 1)
          if (!warp[rec.id]) {
            const avail = tArr - stops;
            if (moving > 0 && avail > 0.05)
              warp[rec.id] = { upto: rj, f: Math.min(1, Math.max(0.25, moving / avail)) };
          }
          target = bladeAt(rec, routeTimeW(rec, warp, rj), warp);
          tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
        } else {
          tArr = launchT;
          for (let k = 0; k < 3; k++) {
            target = bladeAt(rec, tArr, warp);
            tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
          }
          target = bladeAt(rec, tArr, warp);
        }
        // a flat pass that would cut through a bumper lifts over it automatically
        const sauce = !!tr.sauce || (bumpSh.length > 0 && segCrossesNet(launch, target, bumpSh));
        legs.push({ type: "fly", by: byId, x0: launch.x, y0: launch.y, x1: target.x, y1: target.y, t0: launchT, t1: tArr, sauce });
        legs.push({ type: "ride", id: rec.id, t0: tArr, catch: true });
        cur = rec;
        tBase = tArr;
      });
      if (chainBlocked) { /* chain died at a net — no terminal action */ }
      else if (pk.termBy && cur && pk.termBy !== cur.id) { /* intended shooter never got it */ }
      else if (pk.shotAt != null && cur) doShot(pk.shotAt); // terminal shot (no collector)
      else if (pk.rimAt != null && cur) {              // terminal hard rim around the boards
        const at = pk.rimAt;
        const launchT = (cur.path.length && at >= 0) ? Math.max(tBase, routeTimeW(cur, warp, Math.min(at, cur.path.length - 1))) : tBase;
        const lb = bladeAt(cur, launchT, warp);
        const launch = boards.clampInside(lb.x, lb.y);           // a blade past the boards → no path
        const dist = pk.rimDist != null ? pk.rimDist : 65;       // handle-set travel distance
        const r = pushTravel(densify(reflectPath(boards.rimAround(launch, dist, pk.rimAim), netSh)), launchT, vRim(), { by: cur.id, rim: true, easeOut: Math.min(55, dist * 0.6) });
        legs.push({ type: "rest", x: r.end.x, y: r.end.y, t0: r.t }); tBase = r.t;
      } else if (pk.chipAt != null && cur) {           // terminal chip into space (bounces)
        const at = pk.chipAt;
        const launchT = (cur.path.length && at >= 0) ? Math.max(tBase, routeTimeW(cur, warp, Math.min(at, cur.path.length - 1))) : tBase;
        const lb = bladeAt(cur, launchT, warp);
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
    planCache.current = { key: pieces, pace, sig: lenSig, seed, warp, plans, rel, holds: {}, startWait: sw, trigPause: tp };
    currentHolds = {};

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
    return planCache.current;
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
    const flip = s => (s.dir === "bwd" ? 180 : 0);
    if (!p.path.length) return { x: p.x, y: p.y, a: p.facing || 0, v: 0, dist: 0 };
    e -= startWaitOf(p);   // hold at the start until the trigger fires (e<=0 → start pose below)
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
      const s0 = p.path[0];
      return { x: p.x, y: p.y, a: segTangentAngle({ x: p.x, y: p.y }, s0, 0.02) + flip(s0), v: 0, dist: 0 };
    }
    // position + heading at arc-length `arc` along segment element el
    const atArc = (el, L, arc, s) => {
      const pt = el.getPointAtLength(arc);
      const q = el.getPointAtLength(Math.min(L, arc + 0.6));
      let a;
      if (Math.hypot(q.x - pt.x, q.y - pt.y) < 0.05) {
        const b = el.getPointAtLength(Math.max(0, arc - 0.6));
        a = (Math.atan2(pt.y - b.y, pt.x - b.x) * 180) / Math.PI;
      } else {
        a = (Math.atan2(q.y - pt.y, q.x - pt.x) * 180) / Math.PI;
      }
      return { x: pt.x, y: pt.y, a: a + flip(s) };
    };
    let prev = { x: p.x, y: p.y };
    let dist = 0;
    for (let i = 0; i < p.path.length; i++) {
      const s = p.path[i];
      const stop = (s.stop || 0) + trigPauseOf(p, i);
      if (e < stop) return { ...prev, a: segTangentAngle(prev, s, 0.02) + flip(s), v: 0, dist };
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
            return { ...atArc(el, L, arc, s), v, smul, dist: dist + arc, braking: e / tBefore > 1 - RAMP_DOWN };
          }
          e -= tBefore;
          const dir = zHold.cy <= 42.5 ? 1 : -1;                   // one-way, toward center ice
          const DRIFT_RATE = 3, DRIFT_MAX = 10;
          const dyEnd = Math.min(DRIFT_MAX, DRIFT_RATE * zHold.dur);
          if (e < zHold.dur) {
            // hold on the line, slowly gliding toward the middle
            const dy = Math.min(DRIFT_MAX, DRIFT_RATE * e) * dir;
            return { x: zHold.cx, y: clampY(zHold.cy + dy), a: dir > 0 ? 90 : -90, v: 0, dist: dist + zHold.fCross * L };
          }
          e -= zHold.dur;
          if (e < tAfter) {
            const { s: sf, v } = easeLeg(tAfter > 0 ? e / tAfter : 1, RAMP_UP, exitRest ? RAMP_DOWN : 0);
            const arc = zHold.fCross * L + (1 - zHold.fCross) * L * sf;
            const smul = tAfter > 0 ? (((1 - zHold.fCross) * L / tAfter) / pace) * v : 0;
            const off = dyEnd * (1 - sf) * dir;                    // cut in and rejoin the route
            const pos = atArc(el, L, arc, s);
            return { ...pos, y: clampY(pos.y + off), v, smul, dist: dist + arc, braking: exitRest && e / tAfter > 1 - RAMP_DOWN };
          }
          e -= tAfter;
        } catch { return { ...prev, a: 0, v: 0, dist }; }
        dist += L;
        prev = { x: s.x, y: s.y };
        continue;
      }

      if (mt > 0 && e < mt) {
        try {
          const aRamp = entryRest ? RAMP_UP : cornerRamp(i - 1);   // ease out of a sharp corner
          const bRamp = exitRest ? RAMP_DOWN : cornerRamp(i);      // ease into the next sharp corner
          const { s: sf, v } = easeLeg(e / mt, aRamp, bRamp);
          const braking = exitRest && e / mt > 1 - RAMP_DOWN;
          const smul = mt > 0 ? ((L / mt) / pace) * v : 0;
          return { ...atArc(el, L, L * sf, s), v, smul, dist: dist + L * sf, braking };
        } catch { return { ...prev, a: 0, v: 0, dist }; }
      }
      e -= mt;
      dist += L;
      prev = { x: s.x, y: s.y };
    }
    const last = p.path[p.path.length - 1];
    const lp = segEnd(p, p.path.length - 2);
    return { x: last.x, y: last.y, a: segTangentAngle(lp, last, 0.98) + flip(last), v: 0, dist };
  }

  function displayPosAt(p, e) {
    const { warp, plans, rel } = getPlan();
    if (p.kind === "puck") {
      const pl = plans[p.id];
      if (pl) {
        const relT = rel[p.id];
        if (p.path.length && e >= relT) return routePosAt(p, e - relT, warp);
        let leg = pl.legs[0];
        for (const L of pl.legs) { if (e >= L.t0) leg = L; else break; }
        if (leg.type === "fly" && e < leg.t1) {
          const k = Math.max(0, Math.min(1, (e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)));
          return { x: leg.x0 + (leg.x1 - leg.x0) * k, y: leg.y0 + (leg.y1 - leg.y0) * k, a: 0 };
        }
        if (leg.type === "skid" && e < leg.t1) {
          const u = Math.max(0, Math.min(1, (e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)));
          const k = 1 - (1 - u) * (1 - u); // ease-out: rebound pops then glides to rest
          return { x: leg.x0 + (leg.x1 - leg.x0) * k, y: leg.y0 + (leg.y1 - leg.y0) * k, a: 0 };
        }
        if (leg.type === "free") return routePosAt(p, e, warp);
        if (leg.type === "fly" || leg.type === "skid") return { x: leg.x1, y: leg.y1, a: 0 };
        if (leg.type === "rest") return { x: leg.x, y: leg.y, a: 0 };
        const car = pieces.find(q => q.id === leg.id);
        if (car) return bladeAt(car, Math.min(e, routeTimeW(car, warp)), warp);
        return { x: p.x, y: p.y, a: 0 };
      }
      return routePosAt(p, e, warp);
    }
    return routePosAt(p, e, warp);
  }

  // stick-motion angle (deg) for a player at elapsed e: 0 except in the brief
  // window of one of their stick events —
  //   shot:  hard wind-back then snap through the puck
  //   pass:  the same, smaller and quicker
  //   catch: reach out to meet the puck, then cushion back to neutral
  function stickSwing(id, e) {
    const { plans } = getPlan();
    let ang = 0, best = Infinity; // pick the most-centered event when several overlap
    for (const pid in plans) {
      for (const leg of plans[pid].legs) {
        if (leg.type === "fly" && leg.by === id) {
          const shot = !!leg.shot;
          const WU = shot ? 0.16 : 0.11, FT = shot ? 0.3 : 0.2, MAX = shot ? 34 : 20;
          const tau = e - leg.t0;
          if (tau < -WU || tau > FT || Math.abs(tau) >= best) continue;
          best = Math.abs(tau);
          ang = tau < 0
            ? -MAX * (tau + WU) / WU                            // wind back to -MAX at release
            : -MAX * Math.cos((Math.PI * tau) / FT) * (1 - tau / FT); // snap through, settle
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
    return ang;
  }

  // warped arrival time at a player's waypoint index (for movement captions)
  function waypointTime(p, i) { const { warp } = getPlan(); return routeTimeW(p, warp, i); }

  return { getPlan, pieceTime, displayPosAt, stickSwing, waypointTime };
}
