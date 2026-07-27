// Smart-pen sketch recognition: a $P point-cloud matcher over hand-authored
// symbol templates, with geometric guards for the confusable letter pairs.
// Everything runs on the stroke vectors the pen already captures (rink feet) —
// no rasterizing, no network, sub-millisecond on a phone.
//
// Pure module — no React/DOM — node-tested by tests/sketch-recognize.mjs.
//
// Precedence contract (classifyPenGroup): puck-gate → dash-group → symbol →
// (zigzag | shot | route) → mark. Every captured stroke lands in exactly one
// op; `mark` (plain ink) is the universal fallback, so recognition can only
// ever add meaning, never lose ink.
//
// $P (Vatavu et al.) rather than $1/$Q on purpose: it is stroke-order and
// stroke-direction invariant (left-handed coaches draw an X's strokes in any
// order, either direction) but NOT rotation invariant — a letter must stop
// matching when it's on its side. W-the-letter never collides with a zigzag
// route purely because of the SYMBOL_MAX size gate.

import { rdp } from "./geometry.js";

const N = 32;                   // $P resample count
export const SYMBOL_MAX = 8;    // ft bbox diagonal — bigger strokes are routes, never symbols
// Minimum $P confidence to materialize a symbol. Tuned in the node harness:
// jittered true draws score 0.66–0.9 while lines/hooks/scribbles score < 0.05,
// so 0.55 keeps headroom for sloppier-than-fixture hands without letting any
// observed negative through.
export const ACCEPT = 0.55;

/* ---------------- small helpers ---------------- */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(p => {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const strokesDiag = strokes => {
  const b = bboxOf(strokes.flat());
  return Math.hypot(b.w, b.h);
};
const pathLen = strokes =>
  strokes.reduce((L, pts) => L + pts.reduce((l, p, i) => (i ? l + dist(pts[i - 1], p) : l), 0), 0);

/* ---------------- $P core ---------------- */

// Resample the whole multi-stroke cloud to n points evenly spaced along drawn
// ink. Interpolation stays within a stroke — the walk restarts at each stroke's
// first point so the gap between strokes contributes no phantom ink.
function resample(strokes, n) {
  const total = pathLen(strokes);
  if (total < 1e-9) return null;
  const I = total / (n - 1);
  const out = [];
  let D = 0;
  strokes.forEach((pts, s) => {
    if (!pts.length) return;
    if (!out.length) out.push({ x: pts[0].x, y: pts[0].y, s });
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i];
      let d = dist(prev, cur);
      while (D + d >= I && d > 1e-12) {
        const t = (I - D) / d;
        const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y), s };
        out.push(q);
        prev = q;
        d = dist(prev, cur);
        D = 0;
      }
      D += d;
      prev = cur;
    }
  });
  while (out.length < n) out.push({ ...out[out.length - 1] });
  return out.slice(0, n);
}

// Resample → UNIFORM scale (larger bbox side → 1; classic $P scales per-axis,
// but that would square up elongated glyphs and let slivers match O) →
// centroid to origin.
function normalize(strokes) {
  const pts = resample(strokes, N);
  if (!pts) return null;
  const b = bboxOf(pts);
  const m = Math.max(b.w, b.h);
  if (m < 1e-9) return null;
  let cx = 0, cy = 0;
  const scaled = pts.map(p => {
    const q = { x: p.x / m, y: p.y / m, s: p.s };
    cx += q.x; cy += q.y;
    return q;
  });
  cx /= scaled.length; cy /= scaled.length;
  return scaled.map(p => ({ x: p.x - cx, y: p.y - cy, s: p.s }));
}

// Standard $P greedy matching: from a handful of start offsets, pair each point
// of A with its nearest unmatched point of B, early points weighted heaviest;
// symmetric (both directions), minimum over all starts.
function cloudDist(a, b, start) {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0, i = start;
  do {
    let min = Infinity, idx = 0;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = dist(a[i], b[j]);
      if (d < min) { min = d; idx = j; }
    }
    matched[idx] = true;
    sum += (1 - ((i - start + n) % n) / n) * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}
function greedyMatch(a, b) {
  const step = Math.max(1, Math.floor(Math.sqrt(a.length)));
  let min = Infinity;
  for (let i = 0; i < a.length; i += step)
    min = Math.min(min, cloudDist(a, b, i), cloudDist(b, a, i));
  return min;
}

/* ---------------- templates ---------------- */

// Stroke skeletons in a unit box (x right, y down, 0..1). Aspect matters
// (uniform scaling preserves it): letters run ~0.6–0.9 wide per 1 tall, like
// whiteboard capitals. Several templates may share a sym — drawn variants
// (e.g. a D penned without lifting) are just extra entries.
const arc = (cx, cy, r, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
};
const P = (...xy) => {
  const out = [];
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
};
const RAW_TEMPLATES = [
  { sym: "X", strokes: [P(0, 0, 1, 1), P(1, 0, 0, 1)] },
  { sym: "O", strokes: [arc(0.5, 0.5, 0.5, -90, 270, 16)] },
  { sym: "C", strokes: [arc(0.5, 0.5, 0.5, 60, 300, 12)] },
  { sym: "G", strokes: [arc(0.5, 0.5, 0.5, 60, 300, 12), P(0.95, 0.7, 0.95, 0.55, 0.55, 0.55)] },
  { sym: "D", strokes: [P(0.15, 0, 0.15, 1), P(0.15, 0, 0.6, 0.04, 0.9, 0.3, 0.9, 0.7, 0.6, 0.96, 0.15, 1)] },
  { sym: "D", strokes: [P(0.15, 1, 0.15, 0, 0.6, 0.04, 0.9, 0.3, 0.9, 0.7, 0.6, 0.96, 0.15, 1)] },
  { sym: "F", strokes: [P(0.2, 0, 0.2, 1), P(0.2, 0, 0.85, 0), P(0.2, 0.5, 0.7, 0.5)] },
  { sym: "F", strokes: [P(0.85, 0, 0.2, 0, 0.2, 1), P(0.2, 0.5, 0.7, 0.5)] },
  { sym: "W", strokes: [P(0, 0, 0.25, 1, 0.5, 0.3, 0.75, 1, 1, 0)] },
  { sym: "L", strokes: [P(0.2, 0, 0.2, 1, 0.85, 1)] },
  { sym: "R", strokes: [P(0.15, 0, 0.15, 1), P(0.15, 0, 0.7, 0.05, 0.8, 0.25, 0.7, 0.45, 0.15, 0.5), P(0.4, 0.5, 0.85, 1)] },
  { sym: "R", strokes: [P(0.15, 1, 0.15, 0, 0.7, 0.05, 0.8, 0.25, 0.7, 0.45, 0.15, 0.5, 0.85, 1)] },
  { sym: "△", strokes: [P(0.5, 0, 1, 1, 0, 1, 0.5, 0)] },
  { sym: "□", strokes: [P(0, 0, 1, 0, 1, 1, 0, 1, 0, 0)] },
];
const TEMPLATES = RAW_TEMPLATES.map(t => ({ sym: t.sym, cloud: normalize(t.strokes) }));

/* ---------------- confusability guards ---------------- */

// $P alone will not separate O/C/G/D/△/□ at coach-sloppiness levels; these
// cheap geometric features are the real classifier for that family. A guard is
// an eligibility gate: a sym that fails its guard can't win no matter its score.
const turnDeg = (a, b, c) => {
  const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-9 || l2 < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
};

function features(strokes) {
  const all = strokes.flat();
  const b = bboxOf(all);
  const dg = Math.hypot(b.w, b.h) || 1e-9;
  // the longest stroke carries the shape for closure/corner tests
  let main = strokes[0], best = -1;
  strokes.forEach(pts => {
    const L = pathLen([pts]);
    if (L > best) { best = L; main = pts; }
  });
  const closure = dist(main[0], main[main.length - 1]) / dg;
  // corners: RDP the dominant stroke, count sharp turns; the start/end junction
  // of a closed outline is a corner too when the wrap-around turn is sharp
  const r = rdp(main, 0.05 * dg);
  let corners = 0;
  for (let i = 1; i < r.length - 1; i++) if (turnDeg(r[i - 1], r[i], r[i + 1]) > 62) corners++;
  if (closure < 0.3 && r.length >= 3 &&
      turnDeg(r[r.length - 2], r[r.length - 1], r[1]) > 62) corners++;
  // D's spine: how line-straight the left 25% band is (x-RMS over diag)
  const band = all.filter(p => p.x <= b.x + 0.25 * (b.w || 1e-9));
  let leftRMS = 1;
  if (band.length >= 3) {
    const mx = band.reduce((s, p) => s + p.x, 0) / band.length;
    leftRMS = Math.sqrt(band.reduce((s, p) => s + (p.x - mx) ** 2, 0) / band.length) / dg;
  }
  // G's tail: resampled ink in the middle-right interior cell (C leaves it empty)
  const rs = resample(strokes, N) || [];
  const tail = rs.filter(p =>
    p.x > b.x + 0.3 * b.w && p.x < b.x + 0.8 * b.w &&
    p.y > b.y + 0.38 * b.h && p.y < b.y + 0.68 * b.h).length;
  return { closure, corners, leftRMS, tail };
}

const GUARDS = {
  O: f => f.closure < 0.3,
  C: f => f.closure > 0.35 && f.tail <= 1,
  G: f => f.tail >= 2,
  D: f => f.leftRMS < 0.07,
  "△": f => f.closure < 0.35 && f.corners === 3,
  "□": f => f.closure < 0.35 && f.corners === 4,
};

/* ---------------- public API ---------------- */

// Pre-recognizer gate: tiny ink (a dot) or a small dense scribble is a puck,
// whatever its nominal shape.
export function puckGate(strokes) {
  const dg = strokesDiag(strokes);
  if (dg < 1.8) return true;
  return dg < 4 && pathLen(strokes) / (dg || 1e-9) > 4;
}

// Tuning window for the node harness: every sym's best score + the guard
// features, so threshold changes are argued from numbers, not vibes.
export function scoreAll(strokes) {
  const cloud = normalize(strokes);
  if (!cloud) return null;
  const scored = {};
  TEMPLATES.forEach(t => {
    const score = Math.max(0, (2 - greedyMatch(cloud, t.cloud)) / 2);
    if (!(t.sym in scored) || score > scored[t.sym]) scored[t.sym] = score;
  });
  return { scored, features: features(strokes) };
}

// strokes: [[{x,y}…]…] in rink feet — one symbol cluster's worth of ink.
// Returns { sym, score, second } or null (→ keep as plain ink).
export function recognizeSymbol(strokes) {
  const cloud = normalize(strokes);
  if (!cloud) return null;
  const f = features(strokes);
  const scored = {};
  TEMPLATES.forEach(t => {
    const score = Math.max(0, (2 - greedyMatch(cloud, t.cloud)) / 2);
    if (!(t.sym in scored) || score > scored[t.sym]) scored[t.sym] = score;
  });
  const ranked = Object.entries(scored)
    .filter(([sym]) => !GUARDS[sym] || GUARDS[sym](f))
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < ACCEPT) return null;
  return { sym: ranked[0][0], score: ranked[0][1], second: ranked[1] ? ranked[1][0] : null };
}
