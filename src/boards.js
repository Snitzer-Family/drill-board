// Rink boards: a rounded-rectangle boundary the puck can rim along or bounce
// off. Coordinates are rink feet (x 0..200, y 0..85). The puck-center boundary
// is inset slightly from the painted board line so the puck rides the boards.

const X0 = 2.5, X1 = 197.5, Y0 = 2.5, Y1 = 82.5, R = 23;
const cxL = X0 + R, cxR = X1 - R, cyT = Y0 + R, cyB = Y1 - R;
const HALF = Math.PI / 2;
const W = cxR - cxL, H = cyB - cyT, A = HALF * R;
export const PERIM = 2 * W + 2 * H + 4 * A;

// perimeter, clockwise from the top-left tangent point
const S = [];
let acc = 0;
const line = (ax, ay, ux, uy, len) => { S.push({ s0: acc, len, kind: "line", ax, ay, ux, uy }); acc += len; };
const arc = (cx, cy, a0) => { S.push({ s0: acc, len: A, kind: "arc", cx, cy, a0 }); acc += A; };
line(cxL, Y0, 1, 0, W);      // top
arc(cxR, cyT, -HALF);        // top-right corner
line(X1, cyT, 0, 1, H);      // right
arc(cxR, cyB, 0);            // bottom-right
line(cxR, Y1, -1, 0, W);     // bottom
arc(cxL, cyB, HALF);         // bottom-left
line(X0, cyB, 0, -1, H);     // left
arc(cxL, cyT, Math.PI);      // top-left

export function isInside(x, y) {
  if (x < X0 || x > X1 || y < Y0 || y > Y1) return false;
  if (x < cxL && y < cyT) return Math.hypot(x - cxL, y - cyT) <= R;
  if (x > cxR && y < cyT) return Math.hypot(x - cxR, y - cyT) <= R;
  if (x > cxR && y > cyB) return Math.hypot(x - cxR, y - cyB) <= R;
  if (x < cxL && y > cyB) return Math.hypot(x - cxL, y - cyB) <= R;
  return true;
}

// nearest boundary point + inward unit normal
function nearest(x, y) {
  let cx = null, cy = null;
  if (x < cxL && y < cyT) { cx = cxL; cy = cyT; }
  else if (x > cxR && y < cyT) { cx = cxR; cy = cyT; }
  else if (x > cxR && y > cyB) { cx = cxR; cy = cyB; }
  else if (x < cxL && y > cyB) { cx = cxL; cy = cyB; }
  if (cx != null) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return { x: cx + (dx / d) * R, y: cy + (dy / d) * R, nx: -dx / d, ny: -dy / d };
  }
  const dTop = y - Y0, dBot = Y1 - y, dLeft = x - X0, dRight = X1 - x;
  const m = Math.min(dTop, dBot, dLeft, dRight);
  if (m === dTop) return { x, y: Y0, nx: 0, ny: 1 };
  if (m === dBot) return { x, y: Y1, nx: 0, ny: -1 };
  if (m === dLeft) return { x: X0, y, nx: 1, ny: 0 };
  return { x: X1, y, nx: -1, ny: 0 };
}

export function clampInside(x, y) {
  if (isInside(x, y)) return { x, y };
  const n = nearest(x, y);
  return { x: n.x, y: n.y };
}

// keep a moving puck inside the boards, reflecting its velocity off them
export function contain(x, y, vx, vy, restitution = 0.7) {
  if (isInside(x, y)) return { x, y, vx, vy, hit: false };
  const n = nearest(x, y);
  const dot = vx * n.nx + vy * n.ny;                 // n is the inward normal
  if (dot < 0) { vx = (vx - 2 * dot * n.nx) * restitution; vy = (vy - 2 * dot * n.ny) * restitution; }
  return { x: n.x, y: n.y, vx, vy, hit: true };
}

// unit tangent along the boards near a point, pointing toward `toward`
export function tangentToward(from, toward) {
  const s = project(from).s;
  const a = pointAt(s + 3), b = pointAt(s - 3);
  const pick = Math.hypot(a.x - toward.x, a.y - toward.y) < Math.hypot(b.x - toward.x, b.y - toward.y) ? a : b;
  const dx = pick.x - from.x, dy = pick.y - from.y, m = Math.hypot(dx, dy) || 1;
  return { x: dx / m, y: dy / m };
}

// distance from a point to the nearest board
export const edgeDist = (x, y) => { const p = project({ x, y }); return Math.hypot(p.x - x, p.y - y); };

export function pointAt(s) {
  s = ((s % PERIM) + PERIM) % PERIM;
  for (const g of S) {
    if (s <= g.s0 + g.len + 1e-9) {
      const local = s - g.s0;
      if (g.kind === "line") return { x: g.ax + g.ux * local, y: g.ay + g.uy * local };
      const ang = g.a0 + (local / g.len) * HALF;
      return { x: g.cx + Math.cos(ang) * R, y: g.cy + Math.sin(ang) * R };
    }
  }
  return { x: S[0].ax, y: S[0].ay };
}

// nearest boundary location (arc-length s + point) to an arbitrary point
export function project(p) {
  let best = null;
  for (const g of S) {
    let proj, s;
    if (g.kind === "line") {
      let t = (p.x - g.ax) * g.ux + (p.y - g.ay) * g.uy;
      t = Math.max(0, Math.min(g.len, t));
      proj = { x: g.ax + g.ux * t, y: g.ay + g.uy * t }; s = g.s0 + t;
    } else {
      let d = (((Math.atan2(p.y - g.cy, p.x - g.cx) - g.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d > HALF) d = d - HALF < 2 * Math.PI - d ? HALF : 0;   // clamp onto the quarter
      const aa = g.a0 + d;
      proj = { x: g.cx + Math.cos(aa) * R, y: g.cy + Math.sin(aa) * R }; s = g.s0 + (d / HALF) * g.len;
    }
    const dist = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (!best || dist < best.dist) best = { dist, s, x: proj.x, y: proj.y };
  }
  return best;
}

// how far along the boards to aim the entry so the puck meets them at a shallow
// angle instead of driving straight in and turning 90°
const leadOf = (from, sF) => Math.min(Math.hypot(from.x - sF.x, from.y - sF.y) * 2.1, 52);
const segAt = s => { s = ((s % PERIM) + PERIM) % PERIM; for (const g of S) if (s <= g.s0 + g.len + 1e-9) return g; return S[S.length - 1]; };
// room left on the current straight/arc ahead in direction `dir`
const roomAhead = (s, dir) => { const g = segAt(s); return dir > 0 ? g.s0 + g.len - s : s - g.s0; };

// polyline that rims from `from` to `to` the short way around the boards
export function rimPath(from, to) {
  const sF = project(from), sT = project(to);
  const dPlus = (((sT.s - sF.s) % PERIM) + PERIM) % PERIM;
  const dir = dPlus <= PERIM - dPlus ? 1 : -1;
  const origTotal = dir > 0 ? dPlus : PERIM - dPlus;
  // keep the entry on the same board section as the nearest point (no corner wrap)
  const lead = Math.min(leadOf(from, sF), origTotal * 0.5, roomAhead(sF.s, dir));
  const entryS = sF.s + dir * lead;
  const total = origTotal - lead;
  const pts = [{ x: from.x, y: from.y }, pointAt(entryS)];
  for (let d = 3; d < total; d += 3) pts.push(pointAt(entryS + dir * d));
  pts.push({ x: sT.x, y: sT.y }, { x: to.x, y: to.y });
  return pts;
}

// polyline that rims `dist` ft around the boards, taking the long way along the
// nearest board so the entry stays shallow and doesn't cut across a corner
export function rimAround(from, dist) {
  const sF = project(from);
  const dir = roomAhead(sF.s, 1) >= roomAhead(sF.s, -1) ? 1 : -1;  // more straight ahead
  const lead = Math.min(leadOf(from, sF), Math.max(0, roomAhead(sF.s, dir) - 1));
  const entryS = sF.s + dir * lead;
  const pts = [{ x: from.x, y: from.y }, pointAt(entryS)];
  for (let d = 3; d <= dist; d += 3) pts.push(pointAt(entryS + dir * d));
  return pts;
}

// polyline of a puck sliding `dist` ft from a point, reflecting off the boards
export function slide(x, y, ux, uy, dist) {
  let m = Math.hypot(ux, uy) || 1; ux /= m; uy /= m;
  let cx = x, cy = y, rem = dist, guard = 0;
  const pts = [{ x, y }];
  while (rem > 0.5 && guard++ < 16) {
    const tHit = rayHit(cx, cy, ux, uy, rem);
    if (tHit >= rem) { cx += ux * rem; cy += uy * rem; pts.push({ x: cx, y: cy }); break; }
    cx += ux * tHit; cy += uy * tHit; pts.push({ x: cx, y: cy });
    const n = nearest(cx, cy), dot = ux * n.nx + uy * n.ny;   // reflect off the boards
    ux -= 2 * dot * n.nx; uy -= 2 * dot * n.ny;
    rem -= Math.max(tHit, 0.5);
  }
  return pts;
}
function rayHit(x, y, ux, uy, max) {
  for (let t = 0.5; t <= max; t += 0.5) if (!isInside(x + ux * t, y + uy * t)) return t - 0.5;
  return max;
}

// a chip fired along (ux,uy) that banks off the boards and travels only as far
// as needed to reach `target` — the distance auto-adjusts to the pickup spot,
// so aiming into the boards banks it there. Returns the polyline (ends at target).
export function slideTo(x, y, ux, uy, target, maxDist = 130) {
  const v = slide(x, y, ux, uy, maxDist);
  let best = { d: Infinity, seg: 1 };
  for (let k = 1; k < v.length; k++) {
    const a = v[k - 1], b = v[k];
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
    const s = Math.max(0, Math.min(1, ((target.x - a.x) * vx + (target.y - a.y) * vy) / L2));
    const d = Math.hypot(target.x - (a.x + vx * s), target.y - (a.y + vy * s));
    if (d < best.d) best = { d, seg: k };
  }
  const pts = v.slice(0, best.seg);   // bank vertices before the closest approach
  pts.push({ x: target.x, y: target.y });
  return pts;
}
