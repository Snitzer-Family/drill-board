// Bezier & route geometry: evaluation, subdivision, zigzags, sketch fitting.
import { RINK } from "./constants.js";

/* ---------------- geometry ---------------- */

export const clampX = v => Math.max(0, Math.min(RINK.W, v));
export const clampY = v => Math.max(0, Math.min(RINK.H, v));
export const segEnd = (p, i) => (i < 0 ? { x: p.x, y: p.y } : { x: p.path[i].x, y: p.path[i].y });

export function segD(prev, s) {
  if (s.type === "L") return `M ${prev.x} ${prev.y} L ${s.x} ${s.y}`;
  if (s.type === "Q") return `M ${prev.x} ${prev.y} Q ${s.cx} ${s.cy} ${s.x} ${s.y}`;
  return `M ${prev.x} ${prev.y} C ${s.c1x} ${s.c1y} ${s.c2x} ${s.c2y} ${s.x} ${s.y}`;
}

export function evalSeg(prev, s, t) {
  const u = 1 - t;
  if (s.type === "L") return { x: prev.x + t * (s.x - prev.x), y: prev.y + t * (s.y - prev.y) };
  if (s.type === "Q") return {
    x: u * u * prev.x + 2 * u * t * s.cx + t * t * s.x,
    y: u * u * prev.y + 2 * u * t * s.cy + t * t * s.y,
  };
  return {
    x: u * u * u * prev.x + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x,
    y: u * u * u * prev.y + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y,
  };
}

export function segTangentAngle(prev, s, t) {
  const a = evalSeg(prev, s, Math.max(0, t - 0.02));
  const b = evalSeg(prev, s, Math.min(1, t + 0.02));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI || 0;
}

export function nearestT(prev, s, pt) {
  let best = 0.5, bd = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const q = evalSeg(prev, s, t);
    const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return Math.min(0.92, Math.max(0.08, best));
}

// de Casteljau subdivision: split one segment into two at t without
// changing the curve's shape
export function splitSeg(prev, s, t) {
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const meta = { mode: s.mode || "carry", dir: s.dir || "fwd", rate: s.rate || 1 };
  if (s.type === "L") {
    const B = evalSeg(prev, s, t);
    return [
      { type: "L", ...meta, stop: s.stop || 0, x: B.x, y: B.y },
      { type: "L", ...meta, stop: 0, x: s.x, y: s.y },
    ];
  }
  if (s.type === "Q") {
    const C = { x: s.cx, y: s.cy }, P1 = { x: s.x, y: s.y };
    const q0 = lerp(prev, C), q1 = lerp(C, P1), B = lerp(q0, q1);
    return [
      { type: "Q", ...meta, stop: s.stop || 0, cx: q0.x, cy: q0.y, x: B.x, y: B.y },
      { type: "Q", ...meta, stop: 0, cx: q1.x, cy: q1.y, x: s.x, y: s.y },
    ];
  }
  const c1 = { x: s.c1x, y: s.c1y }, c2 = { x: s.c2x, y: s.c2y }, P1 = { x: s.x, y: s.y };
  const p01 = lerp(prev, c1), p12 = lerp(c1, c2), p23 = lerp(c2, P1);
  const p012 = lerp(p01, p12), p123 = lerp(p12, p23), B = lerp(p012, p123);
  return [
    { type: "C", ...meta, stop: s.stop || 0, c1x: p01.x, c1y: p01.y, c2x: p012.x, c2y: p012.y, x: B.x, y: B.y },
    { type: "C", ...meta, stop: 0, c1x: p123.x, c1y: p123.y, c2x: p23.x, c2y: p23.y, x: s.x, y: s.y },
  ];
}

// `ar` is the rink→screen aspect ratio (Sx/Sy). The zigzag's bump direction and
// spacing are computed in stretched "screen" space so the pattern still reads as
// even, upright squiggles after the fill-mode stretch (ar=1 → no correction).
// a smooth sine "wiggle" along a segment — the hockey convention for skating
// WITH the puck. Whole cycles so it starts/ends on the line (connects cleanly).
// taperEnd flattens the wiggle over the final stretch so the line runs straight
// into the end arrowhead (no bump poking through it) — pass it only on the
// segment that carries the route's arrowhead.
export function wigglePoints(prev, s, ar = 1, taperEnd = false) {
  const wlen = (ax, ay, bx, by) => Math.hypot((bx - ax) * ar, by - ay);
  const approx =
    s.type === "L" ? wlen(prev.x, prev.y, s.x, s.y)
    : s.type === "Q" ? wlen(prev.x, prev.y, s.cx, s.cy) + wlen(s.cx, s.cy, s.x, s.y)
    : wlen(prev.x, prev.y, s.c1x, s.c1y) + wlen(s.c1x, s.c1y, s.c2x, s.c2y) + wlen(s.c2x, s.c2y, s.x, s.y);
  const cycles = Math.max(1, Math.round(approx / 3.4));   // ~3.4 screen units per wave
  const n = Math.max(14, cycles * 10), A = 0.85;          // amplitude in screen units
  const TAPER = 5;                                         // screen units of straight line under the arrowhead
  const pts = [];
  let cum = 0, prevPt = evalSeg(prev, s, 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n, pt = evalSeg(prev, s, t);
    if (i > 0) cum += wlen(prevPt.x, prevPt.y, pt.x, pt.y);
    prevPt = pt;
    if (i === 0 || i === n) { pts.push(pt); continue; }
    const ahead = evalSeg(prev, s, Math.min(1, t + 0.005));
    const tx = (ahead.x - pt.x) * ar, ty = ahead.y - pt.y;   // screen-space tangent
    const px = -ty, py = tx, l = Math.hypot(px, py) || 1;    // screen-space normal
    const taper = taperEnd ? Math.min(1, (approx - cum) / TAPER) : 1;
    const a = Math.sin((cum / (approx || 1)) * cycles * 2 * Math.PI) * A * taper;
    pts.push({ x: pt.x + (px / l) * a / ar, y: pt.y + (py / l) * a });
  }
  return pts.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ");
}

export function zigzagPoints(prev, s, ar = 1) {
  // arc length measured in aspect-weighted space (x scaled by ar) so bump
  // spacing stays uniform on screen regardless of the segment's direction
  const wlen = (ax, ay, bx, by) => Math.hypot((bx - ax) * ar, by - ay);
  const approx =
    s.type === "L" ? wlen(prev.x, prev.y, s.x, s.y)
    : s.type === "Q" ? wlen(prev.x, prev.y, s.cx, s.cy) + wlen(s.cx, s.cy, s.x, s.y)
    : wlen(prev.x, prev.y, s.c1x, s.c1y) + wlen(s.c1x, s.c1y, s.c2x, s.c2y) + wlen(s.c2x, s.c2y, s.x, s.y);
  const n = Math.max(6, Math.round(approx / 2.4));
  const A = 0.9;                                   // bump amplitude, in screen units
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pt = evalSeg(prev, s, t);
    if (i === 0 || i === n) { pts.push(pt); continue; }
    const ahead = evalSeg(prev, s, Math.min(1, t + 0.01));
    // perpendicular to the on-SCREEN tangent, then mapped back to rink coords
    const tx = (ahead.x - pt.x) * ar, ty = ahead.y - pt.y;   // screen-space tangent
    const px = -ty, py = tx;                                 // screen-space normal
    const l = Math.hypot(px, py) || 1;
    const a = (i % 2 ? 1 : -1) * A;
    pts.push({ x: pt.x + (px / l) * a / ar, y: pt.y + (py / l) * a });
  }
  return pts.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ");
}

export function convertSeg(seg, prev) {
  const { x, y, mode = "carry", dir = "fwd", stop = 0, rate = 1 } = seg;
  const nx = -(y - prev.y), ny = x - prev.x;
  const len = Math.hypot(nx, ny) || 1;
  const off = 12;
  if (seg.type === "L") return { type: "L", mode, dir, stop, rate, x, y };
  if (seg.type === "Q")
    return {
      type: "Q", mode, dir, stop, rate,
      cx: clampX((prev.x + x) / 2 + (nx / len) * off),
      cy: clampY((prev.y + y) / 2 + (ny / len) * off), x, y,
    };
  return {
    type: "C", mode, dir, stop, rate,
    c1x: clampX(prev.x + (x - prev.x) / 3 + (nx / len) * off),
    c1y: clampY(prev.y + (y - prev.y) / 3 + (ny / len) * off),
    c2x: clampX(prev.x + (2 * (x - prev.x)) / 3 - (nx / len) * off),
    c2y: clampY(prev.y + (2 * (y - prev.y)) / 3 - (ny / len) * off),
    x, y,
  };
}

/* ---- finger drawing ---- */

export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

export function catmullToBezier(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push({
      type: "C", mode: "carry", dir: "fwd", stop: 0, rate: 1,
      c1x: clampX(p1.x + (p2.x - p0.x) / 6), c1y: clampY(p1.y + (p2.y - p0.y) / 6),
      c2x: clampX(p2.x - (p3.x - p1.x) / 6), c2y: clampY(p2.y - (p3.y - p1.y) / 6),
      x: p2.x, y: p2.y,
    });
  }
  return segs;
}

export function fitRoute(start, raw) {
  const pts = [start];
  raw.forEach(q => {
    const last = pts[pts.length - 1];
    if (Math.hypot(q.x - last.x, q.y - last.y) > 2.2) pts.push(q);
  });
  if (pts.length < 2) return [];
  const simp = pts.length > 3 ? [pts[0], ...rdp(pts.slice(1), 1.6)] : pts;
  const chain = simp.filter((q, i) => i === 0 || Math.hypot(q.x - simp[i - 1].x, q.y - simp[i - 1].y) > 1.5);
  if (chain.length < 2) return [];
  if (chain.length === 2)
    return [{ type: "L", mode: "carry", dir: "fwd", stop: 0, rate: 1, x: chain[1].x, y: chain[1].y }];
  return catmullToBezier(chain);
}

