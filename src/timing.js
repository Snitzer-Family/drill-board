// Timing & pass-planning engine: leg times, receiver warps, transfer chains,
// shots, releases, and warp-aware positions. Pure functions over the pieces
// array; the React component passes its refs in each render.
import { SPEED, ICON_SCALE } from "./constants.js";
import { clampX, clampY, segEnd, segTangentAngle } from "./geometry.js";

export function createTiming({ pieces, pace, segRefs, planCache }) {
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

  function routeTimeW(p, warp, upto = Infinity) {
    let t = 0;
    for (let i = 0; i < p.path.length; i++) {
      if (i > upto) break;
      t += (p.path[i].stop || 0) + effMove(p, p.path[i], i, warp);
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
    if (pc.key === pieces && pc.pace === pace && pc.sig === lenSig) return pc;
    const warp = {};
    const plans = {};
    const rel = {};
    pieces.forEach(pk => {
      if (pk.kind !== "puck") return;
      const vPass = () => pace * SPEED.pass * (pk.speed || 1);
      const legs = [];
      let cur = null;
      let tBase = 0;
      if (pk.carrier) {
        cur = pieces.find(q => q.id === pk.carrier && q.kind === "player");
        if (!cur) return;
        legs.push({ type: "ride", id: cur.id, t0: 0 });
      } else if (pk.pickup) {
        const pl = pieces.find(q => q.id === pk.pickup.to && q.kind === "player");
        if (!pl || !pl.path.length) return;
        const atIdx = Math.max(0, Math.min(pk.pickup.at, pl.path.length - 1));
        const tPick = routeTimeW(pl, warp, atIdx);
        legs.push({ type: "free", t0: 0 });
        legs.push({ type: "ride", id: pl.id, t0: tPick });
        cur = pl;
        tBase = tPick;
      } else return;
      (pk.transfers || []).forEach(tr => {
        const rec = pieces.find(q => q.id === tr.to && q.kind === "player");
        if (!rec || rec.id === cur.id || !cur.path.length) return;
        const atIdx = Math.max(0, Math.min(tr.at, cur.path.length - 1));
        const launchT = Math.max(tBase, routeTimeW(cur, warp, atIdx));
        const launch = bladeAt(cur, launchT, warp);
        let target, tArr;
        if (tr.recvAt != null && rec.path.length) {
          const rj = Math.max(0, Math.min(tr.recvAt, rec.path.length - 1));
          const anchor = { x: rec.path[rj].x, y: rec.path[rj].y };
          tArr = launchT + Math.hypot(anchor.x - launch.x, anchor.y - launch.y) / vPass();
          if (!warp[rec.id]) {
            let stops = 0, moving = 0;
            for (let i = 0; i <= rj; i++) {
              stops += rec.path[i].stop || 0;
              moving += segMoveTime(rec, rec.path[i], i);
            }
            const avail = tArr - stops;
            if (moving > 0 && avail > 0.05)
              warp[rec.id] = { upto: rj, f: Math.min(4, Math.max(0.25, moving / avail)) };
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
        legs.push({ type: "fly", x0: launch.x, y0: launch.y, x1: target.x, y1: target.y, t0: launchT, t1: tArr });
        legs.push({ type: "ride", id: rec.id, t0: tArr });
        cur = rec;
        tBase = tArr;
      });
      if (pk.shotAt != null && cur.path.length) {
        const atIdx = Math.max(0, Math.min(pk.shotAt, cur.path.length - 1));
        const launchT = Math.max(tBase, routeTimeW(cur, warp, atIdx));
        const launch = bladeAt(cur, launchT, warp);
        const net = launch.x < 100 ? { x: 15, y: 42.5 } : { x: 185, y: 42.5 };
        const vShot = pace * SPEED.shot * (pk.speed || 1);
        const tArr = launchT + Math.hypot(net.x - launch.x, net.y - launch.y) / vShot;
        legs.push({ type: "fly", shot: true, x0: launch.x, y0: launch.y, x1: net.x, y1: net.y, t0: launchT, t1: tArr });
        legs.push({ type: "rest", x: net.x, y: net.y, t0: tArr });
        tBase = tArr;
      }
      let relT = Infinity;
      if (pk.path.length && pk.shotAt == null && !pk.pickup) {
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
    planCache.current = { key: pieces, pace, sig: lenSig, warp, plans, rel };
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
  const RAMP = 0.4;
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
    if (e <= 0) {
      const s0 = p.path[0];
      return { x: p.x, y: p.y, a: segTangentAngle({ x: p.x, y: p.y }, s0, 0.02) + flip(s0), v: 0, dist: 0 };
    }
    let prev = { x: p.x, y: p.y };
    let dist = 0;
    for (let i = 0; i < p.path.length; i++) {
      const s = p.path[i];
      const hold = s.stop || 0;
      if (e < hold) return { ...prev, a: segTangentAngle(prev, s, 0.02) + flip(s), v: 0, dist };
      e -= hold;
      const mt = effMove(p, s, i, warp);
      const el = segRefs.current[`${p.id}/${i}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      if (mt > 0 && e < mt) {
        try {
          // ramp up only when leaving a genuine rest (route start / after a
          // stop), ramp down only when arriving at one (route end / a stop)
          const entryRest = i === 0 || (p.path[i].stop || 0) > 0;
          const nxt = p.path[i + 1];
          const exitRest = i === p.path.length - 1 || (nxt && (nxt.stop || 0) > 0);
          const { s: sf, v } = easeLeg(e / mt, entryRest ? RAMP : 0, exitRest ? RAMP : 0);
          const l = L * sf;
          const pt = el.getPointAtLength(l);
          const q = el.getPointAtLength(Math.min(L, l + 0.6));
          let a;
          if (Math.hypot(q.x - pt.x, q.y - pt.y) < 0.05) {
            const b = el.getPointAtLength(Math.max(0, l - 0.6));
            a = (Math.atan2(pt.y - b.y, pt.x - b.x) * 180) / Math.PI;
          } else {
            a = (Math.atan2(q.y - pt.y, q.x - pt.x) * 180) / Math.PI;
          }
          return { x: pt.x, y: pt.y, a: a + flip(s), v, dist: dist + l };
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
        if (leg.type === "free") return routePosAt(p, e, warp);
        if (leg.type === "fly") return { x: leg.x1, y: leg.y1, a: 0 };
        if (leg.type === "rest") return { x: leg.x, y: leg.y, a: 0 };
        const car = pieces.find(q => q.id === leg.id);
        if (car) return bladeAt(car, Math.min(e, routeTimeW(car, warp)), warp);
        return { x: p.x, y: p.y, a: 0 };
      }
      return routePosAt(p, e, warp);
    }
    return routePosAt(p, e, warp);
  }

  return { getPlan, pieceTime, displayPosAt };
}
