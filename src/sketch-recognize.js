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
import { WB_SYMS } from "./constants.js";

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
  // finger rings rarely close — open-ring variants down to a 290° sweep (the
  // closure guard, not the template, is what keeps true 240° C's out of O)
  { sym: "O", strokes: [arc(0.5, 0.5, 0.5, -75, 255, 16)] },
  { sym: "O", strokes: [arc(0.5, 0.5, 0.5, -55, 235, 14)] },
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

// spread of the radius about the centroid — low means ring-like
function radialCV(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const rad = pts.map(p => Math.hypot(p.x - cx, p.y - cy));
  const m = rad.reduce((a, v) => a + v, 0) / rad.length || 1e-9;
  return Math.sqrt(rad.reduce((a, v) => a + (v - m) ** 2, 0) / rad.length) / m;
}

// isoperimetric circularity, 4πA/P² — 1.0 for a circle, 0.79 for a square,
// 0.60 for a triangle, ~0.3 for a D, 0 for a line. Unlike radial spread it
// doesn't care that a hand-drawn loop is lumpy, only that it encloses area
// efficiently — which is what makes a coach's blob read as a circle.
function circularity(pts) {
  let a2 = 0, per = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a2 += p.x * q.y - q.x * p.y;                       // shoelace (closes the ring)
    per += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return per > 0 ? (4 * Math.PI * (Math.abs(a2) / 2)) / (per * per) : 0;
}

// Coaches finish a circle by flicking the pen, and that tail wrecks the shape:
// it adds perimeter without area, dropping a clean O to unrecognized. So find
// the leading run that encloses area most efficiently and judge THAT. Their
// loops are also lumpy — squarish, 4- or 5-lobed — so circularity is the test
// rather than radial spread, which those blobs fail (0.15-0.25 vs a 0.11 bar).
// Letters stay safe: the caller still requires few corners and a closed shape,
// which excludes squares (4 corners), triangles (3) and an open C.
function ringOf(pts) {
  const n = pts.length;
  if (n < 8) return null;
  let best = null;
  for (let k = n; k >= Math.max(8, Math.floor(n * 0.55)); k--) {
    const c = circularity(pts.slice(0, k));
    if (!best || c > best.c) best = { c, k };
  }
  return best && best.c > 0.72 ? pts.slice(0, best.k) : null;
}

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
  // how ring-like: spread of the radius about the centroid. Hand circles sit
  // near 0.03-0.09, D at 0.14, C and triangles above 0.2 — the most reliable
  // way to know a circle, and it doesn't care where the pen closed the loop.
  const cv = radialCV(all);
  // sharpest bend along an evenly resampled outline. A square turns ~72° at
  // its corners and a triangle ~87°, while even a lumpy hand-drawn loop stays
  // under ~42° because its turning is spread out — this is what tells a
  // coach's blobby circle apart from a square, where counting RDP corners
  // can't (RDP degenerates on a closed outline).
  let maxTurn = 0;
  for (let i = 1; i < rs.length - 1; i++) {
    if (rs[i - 1].s !== rs[i].s || rs[i].s !== rs[i + 1].s) continue;   // not across a pen lift
    maxTurn = Math.max(maxTurn, turnDeg(rs[i - 1], rs[i], rs[i + 1]));
  }
  // D's real signature: a SPINE. Its leftmost edge sits at the same x at the
  // top, middle and bottom; a circle curves away at both ends (0.00 vs 0.91).
  // leftRMS alone let round ink win D over O.
  const leftAt = (a, z) => {
    const band = all.filter(p => p.y >= b.y + a * b.h && p.y <= b.y + z * b.h);
    return band.length ? Math.min(...band.map(p => p.x)) : null;
  };
  const lT = leftAt(0, 0.2), lM = leftAt(0.4, 0.6), lB = leftAt(0.8, 1);
  const spineDrift = lT == null || lM == null || lB == null ? 9
    : Math.max(Math.abs(lT - lM), Math.abs(lB - lM)) / (b.w || 1e-9);
  return { closure, corners, leftRMS, tail, radialCV: cv, spineDrift, maxTurn };
}

// Closure bounds are finger-loose: coaches leave big gaps, and capture
// decimation clips the tail of a small ring on top of that (a real 6ft phone
// ring measured 0.47). Measured bands: sloppy O 0.40-0.50, true C 0.61-0.69 —
// so O accepts < 0.52, C needs > 0.50, and the overlap is ranked by $P score.
const GUARDS = {
  O: f => f.closure < 0.52,
  C: f => f.closure > 0.5 && f.tail <= 1,
  G: f => f.tail >= 2,
  D: f => f.leftRMS < 0.07 && f.spineDrift < 0.09,
  "△": f => f.closure < 0.52 && f.corners === 3,
  "□": f => f.closure < 0.52 && f.corners === 4,
};

/* ---------------- public API ---------------- */

// Pre-recognizer gate: tiny ink (a dot) or a small dense scribble is a puck,
// whatever its nominal shape. Thresholds are in the caller's analysis units.
export function puckGate(strokes, dot = 1.8, dense = 4) {
  const dg = strokesDiag(strokes);
  if (dg < dot) return true;
  return dg < dense && pathLen(strokes) / (dg || 1e-9) > 4;
}

// ---- screen space vs rink feet ----
// A gesture's size in FEET depends on zoom, and its SHAPE in feet depends on
// the rink's cosmetic fill-stretch: the ice is scaled unevenly to fill the
// viewport, so a screen-round O arrives as a squashed ellipse in feet (a real
// iPad capture measured 10.4ft × 6.4ft for a round Pencil circle, scoring
// 0.365 — a reject — until the aspect was undone, which lifted it to 0.792).
// So the classifier does ALL of its geometry in SCREEN units: strokes are
// divided by the per-axis feet-per-pixel before anything is measured, and
// positions convert back to feet on the way out. Rink markings solve the same
// stretch with yFix and icons with iconXf — this is the pen's version.
// Every threshold below is therefore a plain pixel count when the view scale
// is known, falling back to a rink-feet floor when it isn't (node tests).
export const SYMBOL_MAX_PX = 130;
export const symbolMaxFor = pxFt => Math.max(SYMBOL_MAX, SYMBOL_MAX_PX * (pxFt || 0));

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
  // A ring is the one symbol worth deciding geometrically. $P scores an open
  // hand-drawn loop poorly (a 310° circle managed only 0.436, losing to D at
  // 0.561) because the template's points spread over the missing arc — but
  // "every point the same distance from the middle" is unambiguous, and it
  // holds however far round the pen got.
  if (strokes.length === 1) {
    const ring = ringOf(strokes[0]);        // ignores a trailing pen flick
    if (ring) {
      const rf = ring.length === strokes[0].length ? f : features([ring]);
      // the turn gate keeps squares/triangles out; closure keeps an open C out
      if (rf.maxTurn < 55 && rf.closure < 0.52 && rf.tail <= 1)
        return { sym: "O", score: Math.min(1, circularity(ring)), second: null };
    }
  }
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

/* ================ pen-group classification ================ */
// A settled burst of pen strokes → drill ops. Association radii in rink feet:

const ATTACH_R = 6;  // a route's start must be this close to its skater
const PASS_R = 8;    // dash/shot endpoints resolve to players within this
const NET_R = 6;     // ink ending this close to a net is aimed at it
const CONE_MAX = 12; // a triangle bigger than this is a zone overlay, not a cone
const DASH_SPAN = 10;   // a dashed line spans at least this end to end
const PUCK_ON_R = 3; // a puck this close to a player starts on their stick

const centerOf = pts => {
  const b = bboxOf(pts);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

// dash-likeness: an elongated flick — long chord, little sideways wander
function isDash(pts, diag, maxDiag = 6, minChord = 1) {
  if (pts.length < 2 || diag >= maxDiag) return false;
  const a = pts[0], b = pts[pts.length - 1];
  const chord = dist(a, b);
  if (chord < minChord) return false;
  const dx = b.x - a.x, dy = b.y - a.y, len = chord;
  let dev = 0;
  pts.forEach(p => {
    const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > dev) dev = d;
  });
  return chord / Math.max(dev, 0.15) > 3;
}

// distance from point p to segment ab
function ptSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  if (L < 1e-12) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// distance between segments ab and cd (0 when they cross)
function segSegDist(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) > 1e-12) {
    const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;   // they intersect
  }
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b));
}

// total-least-squares line through points: mean + principal direction
function tlsLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(p => { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; });
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const along = p => (p.x - mx) * dir.x + (p.y - my) * dir.y;
  const perp = p => Math.abs(-(p.x - mx) * dir.y + (p.y - my) * dir.x);
  return { mx, my, dir, along, perp };
}

// zigzag = backward-skating shorthand: ≥4 sharp apexes with (near-)alternating
// turn directions that still make real headway. Returns the apex-midpoint
// midline (the skater's actual lane) or null.
function zigzagMidline(pts) {
  const r = rdp(pts, 1.6);
  if (r.length < 6) return null;
  const apexes = [];
  for (let i = 1; i < r.length - 1; i++) {
    if (turnDeg(r[i - 1], r[i], r[i + 1]) < 55) continue;
    const cross = (r[i].x - r[i - 1].x) * (r[i + 1].y - r[i].y) - (r[i].y - r[i - 1].y) * (r[i + 1].x - r[i].x);
    apexes.push({ i, sign: Math.sign(cross) });
  }
  let flips = 0;
  for (let i = 1; i < apexes.length; i++) if (apexes[i].sign !== apexes[i - 1].sign) flips++;
  const plen = pathLen([r]);
  if (apexes.length < 4 || flips < 3 || flips < apexes.length - 2 ||
      dist(r[0], r[r.length - 1]) < 0.5 * plen) return null;
  const apexAt = new Set(apexes.map(a => a.i));
  return r.map((p, i) => apexAt.has(i)
    ? { x: (r[i - 1].x + r[i + 1].x) / 2, y: (r[i - 1].y + r[i + 1].y) / 2 } : p);
}

// coaches habitually finish a route with an arrowhead flick; the doubled-back
// tail would hook the fitted route, so strip up to two short terminal legs
// that reverse hard. Routes render their own carats — the drawn arrowhead is
// redundant the moment the ink materializes.
function stripArrowhead(pts, legMax = 3.5) {
  let r = rdp(pts, 1.6);
  let cut = null;
  for (let k = 0; k < 2 && r.length > 2; k++) {
    const a = r[r.length - 3], b = r[r.length - 2], c = r[r.length - 1];
    if (dist(b, c) < legMax && turnDeg(a, b, c) > 100) { r = r.slice(0, -1); cut = b; }
    else break;
  }
  if (!cut) return pts;
  const i = pts.findIndex(p => p.x === cut.x && p.y === cut.y);  // rdp keeps original points
  return i > 1 ? pts.slice(0, i + 1) : pts;
}

// split a cluster into side-by-side glyphs at a clear vertical gap (LW, RD, …)
function splitGlyphs(cluster) {
  const boxed = cluster.map(s => ({ s, b: bboxOf(s.pts) })).sort((a, b) => a.b.x - b.b.x);
  const whole = bboxOf(cluster.flatMap(s => s.pts));
  const gapMin = Math.max(0.15 * whole.w, 0.8);
  const glyphs = [[boxed[0]]];
  let maxX = boxed[0].b.x + boxed[0].b.w;
  for (let i = 1; i < boxed.length; i++) {
    if (boxed[i].b.x - maxX > gapMin) glyphs.push([boxed[i]]);
    else glyphs[glyphs.length - 1].push(boxed[i]);
    maxX = Math.max(maxX, boxed[i].b.x + boxed[i].b.w);
  }
  return glyphs.map(g => g.map(e => e.s));
}

// strokes: [{ pts:[{x,y}…], t0?, t1? }] in draw order, rink feet.
// ctx: { players:[{id,x,y,end?,hasPath?}], nets:[{id,x,y}], pxFt? } — the board today.
// Returns the op list documented in the header; refs ({ref:i}) point at player
// ops created earlier in the same list. Every op carries srcs: the indexes of
// the input strokes it consumed (the app uses this to reclaim previously
// committed ink that a later stroke completes into a symbol). An op:"drop"
// consumes strokes without materializing anything (arrowhead flicks).
export function classifyPenGroup(strokes, ctx = {}) {
  const players = ctx.players || [], nets = ctx.nets || [];
  // Work in SCREEN units whenever the view scale is known (see the note above
  // SYMBOL_MAX_PX): feet ÷ per-axis feet-per-pixel undoes both zoom AND the
  // rink's fill-stretch, so a screen-round O is round here too.
  const fx = ctx.pxFtX || ctx.pxFt || 0, fy = ctx.pxFtY || ctx.pxFt || 0;
  const scaled = fx > 0 && fy > 0;
  const toU = p => (scaled ? { x: p.x / fx, y: p.y / fy } : p);
  const toFt = p => (scaled ? { x: p.x * fx, y: p.y * fy } : p);
  // threshold selector: a true pixel count when scaled, else the feet floor
  const U = (ft, px) => (scaled ? px : ft);
  const symMax = U(SYMBOL_MAX, SYMBOL_MAX_PX);   // symbol / cluster size cap
  const overlayMin = U(8, 110);            // ring bigger than this is a zone overlay, not a player O
  const coneMax = U(CONE_MAX, 60);
  // association radii get generous px targets — fingertip starts land 40-50px
  // off the icon they mean (nearest-wins and the free-player filter keep the
  // looseness safe)
  const attachR = U(ATTACH_R, 52), passR = U(PASS_R, 55), netR = U(NET_R, 45);
  const dashSpan = U(DASH_SPAN, 60), dashMax = U(6, 45), dashChord = U(1, 6);
  // linkR: how close two strokes must come to be read as one symbol. A letter's
  // strokes touch or cross; separate symbols keep a visible gap.
  const dashRms = U(1.5, 8), linkR = U(2, 10);
  const flickMax = U(4, 20), flickR = U(3.5, 18), arrowLeg = U(3.5, 18);
  const puckDot = U(1.8, 11), puckDense = U(4, 26), puckOnR = U(PUCK_ON_R, 15);
  const ops = [];
  const leftovers = [];   // strokes that fell through → mark ops, in draw order

  // roster = everything a route/pass/shot can bind to; grows as player ops land
  const roster = players.map(p => ({
    who: { id: p.id }, ...toU(p),
    end: toU(p.end || { x: p.x, y: p.y }), hasPath: !!p.hasPath,
  }));
  const addOp = op => { ops.push(op); return ops.length - 1; };
  const addPlayerOp = op => {
    const i = addOp(op);
    // the op carries FEET (it's drill data); the roster is screen units
    const u = toU({ x: op.x, y: op.y });
    roster.push({ who: { ref: i }, x: u.x, y: u.y, end: { x: u.x, y: u.y }, hasPath: false });
    return i;
  };
  const nearest = (pt, r, list, at) => {
    let best = null, bd = r;
    list.forEach(e => {
      const q = at(e), d = dist(pt, q);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  };
  // a pass/shot releases from wherever its player ends up; a receiver/skater
  // binds at their spot
  const sourceAt = pt => nearest(pt, passR, roster, e => e.hasPath ? e.end : { x: e.x, y: e.y });
  const spotAt = (pt, r, skip) => nearest(pt, r, roster.filter(e => e !== skip), e => ({ x: e.x, y: e.y }));
  const netAt = pt => nearest(pt, netR, nets, n => toU(n));

  // pts = screen units (all geometry); ptsFt = the original feet, kept for the
  // things that must stay in drill space: route fitting and fallback ink
  const S = strokes.map((s, idx) => {
    const pts = s.pts.map(toU);
    return { pts, ptsFt: s.pts, idx, diag: strokesDiag([pts]) };
  });
  const shorts = S.filter(s => s.diag < symMax);
  const longs = S.filter(s => s.diag >= symMax);

  // ---- dash-groups out of the shorts first: a dashed line's dashes sit close
  // together and would otherwise cluster into a bogus "symbol"; collinearity
  // is the disambiguator ----
  const dashGroups = [];
  const consumed = new Set();
  {
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        const mids = run.map(s => centerOf(s.pts));
        const L = tlsLine(mids);
        const rms = Math.sqrt(mids.reduce((s, p) => s + L.perp(p) ** 2, 0) / mids.length);
        const all = run.flatMap(s => s.pts);
        let tMin = Infinity, tMax = -Infinity;
        all.forEach(p => { const t = L.along(p); if (t < tMin) tMin = t; if (t > tMax) tMax = t; });
        // real dashes march along the line one after another; the strokes of a
        // small X (or letter) are just as elongated and collinear-of-midpoint,
        // but their projections pile on top of each other — reject those
        const iv = run.map(s => {
          let lo = Infinity, hi = -Infinity;
          s.pts.forEach(p => { const t = L.along(p); if (t < lo) lo = t; if (t > hi) hi = t; });
          return { lo, hi, c: (lo + hi) / 2 };
        });
        const dirSign = Math.sign(iv[iv.length - 1].c - iv[0].c) || 1;
        const marching = iv.every((b, i) => {
          if (!i) return true;
          const a = iv[i - 1];
          if ((b.c - a.c) * dirSign <= 0) return false;
          const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
          return overlap <= 0.4 * Math.min(a.hi - a.lo, b.hi - b.lo);
        });
        if (rms < dashRms && tMax - tMin > dashSpan && marching) {
          let a = { x: L.mx + L.dir.x * tMin, y: L.my + L.dir.y * tMin };
          let b = { x: L.mx + L.dir.x * tMax, y: L.my + L.dir.y * tMax };
          // drawing order sets direction: the first dash sits at the start
          if (Math.abs(L.along(mids[0]) - tMax) < Math.abs(L.along(mids[0]) - tMin)) [a, b] = [b, a];
          dashGroups.push({ a, b, strokes: run });
          run.forEach(s => consumed.add(s));
        }
      }
      run = [];
    };
    shorts.forEach(s => { if (isDash(s.pts, s.diag, dashMax, dashChord)) run.push(s); else flush(); });
    flush();
  }

  // ---- group the remaining shorts into candidate symbols ----
  // Proximity is measured between the STROKES, not their padded boxes. A
  // letter's strokes touch or cross (an X's legs intersect at gap 0), while
  // neighbouring symbols keep a real gap. Box padding merged whole rows of a
  // densely drawn board into one blob that then failed as a unit and fell out
  // as ink — 36 O's and 36 X's yielded 6 players and 92 marks.
  const pool = shorts.filter(s => !consumed.has(s));
  // segment-to-segment, not point-to-point: a reclaimed ink mark keeps only
  // its RDP control points, so an X's legs can cross with no two POINTS near
  // each other — measured as segments they intersect at gap 0
  const strokeGap = (a, b, r) => {
    const ba = bboxOf(a), bb = bboxOf(b);
    if (ba.x - r > bb.x + bb.w || bb.x - r > ba.x + ba.w ||
        ba.y - r > bb.y + bb.h || bb.y - r > ba.y + ba.h) return Infinity;
    let m = Infinity;
    for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
      const d = segSegDist(a[i - 1], a[i], b[j - 1], b[j]);
      if (d < m) { m = d; if (m < r) return m; }
    }
    return m;
  };
  // single-linkage at gap `r`, with a hard cap: a group can never be bigger
  // than a symbol, so merging can't run away across the ice
  const groupStrokes = (list, r, cap = symMax) => {
    const out = [];
    list.forEach(s => {
      const hits = out.filter(c => c.some(e => strokeGap(e.pts, s.pts, r) < r));
      const union = [...hits.flat(), s].map(e => e.pts);
      if (!hits.length || strokesDiag(union) > cap) { out.push([s]); return; }
      hits.slice(1).forEach(c => { out.splice(out.indexOf(c), 1); hits[0].push(...c); });
      hits[0].push(s);
    });
    return out;
  };

  // positions emit in FEET; sizes scale per axis (a shape overlay is drawn
  // parametrically from its feet bbox, so it must match the ink on screen)
  const glyphOp = (rec, strokesOf) => {
    const allFt = strokesOf.flatMap(s => s.ptsFt);
    const all = strokesOf.flatMap(s => s.pts);
    const c = centerOf(allFt);
    const dg = strokesDiag([all]);
    const asShape = shape => {
      const b = bboxOf(allFt);
      return { op: "shape", shape, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h };
    };
    if (rec.sym === "△") return dg <= coneMax ? { op: "cone", x: c.x, y: c.y } : asShape("triangle");
    if ((rec.sym === "O" || rec.sym === "□") && dg >= overlayMin)
      return asShape(rec.sym === "O" ? "circle" : "square");
    return { op: "player", x: c.x, y: c.y, sym: rec.sym };
  };
  const puckOps = [];
  const unrec = [];       // unrecognized clusters, resolved after routes
  const fallThrough = []; // big strokes out of failed clusters → the long pipeline
  // Only a genuinely LONG stray becomes a route. At 40px an unrecognized X leg
  // (42px) turned into a route on whichever player was nearest — silently
  // wrong, and worse than ink, which the next stroke can still complete.
  const clusterFail = cs => {
    const bigs = cs.filter(s => s.diag >= U(SYMBOL_MAX, 85));
    fallThrough.push(...bigs);
    const rest = cs.filter(s => !bigs.includes(s));
    if (rest.length) unrec.push(rest);
  };
  const idxOf = cs => cs.map(s => s.idx);
  const emitGlyph = (rec, cs) => {
    const o = { ...glyphOp(rec, cs), srcs: idxOf(cs) };
    o.op === "player" ? addPlayerOp(o) : addOp(o);
  };
  // How does this exact set of strokes read? Returns the symbols found (a
  // side-by-side whiteboard token like LW counts as one) or null. Pure — the
  // caller decides which reading wins before anything is emitted.
  // memoized: weighing readings re-asks about the same stroke sets (a parent
  // scores each sub-group, then each child re-scores itself), and $P is the
  // expensive part — this took a 72-stroke burst from 390ms to well under 100
  const readCache = new Map();
  const readGroup = cs => {
    const key = cs.map(s => s.idx).sort((a, b) => a - b).join(",");
    if (readCache.has(key)) return readCache.get(key);
    const v = readGroupUncached(cs);
    readCache.set(key, v);
    return v;
  };
  const readGroupUncached = cs => {
    const glyphs = splitGlyphs(cs);
    if (glyphs.length > 1) {
      const recs = glyphs.map(g => recognizeSymbol(g.map(s => s.pts)));
      if (recs.every(Boolean)) {
        const join = recs.map(r => r.sym).join("");
        if (glyphs.length === 2 && join.length > 1 && WB_SYMS.includes(join))
          return [{ token: join, cs }];
        return glyphs.map((g, i) => ({ rec: recs[i], cs: g }));
      }
    }
    const rec = recognizeSymbol(cs.map(s => s.pts));
    return rec ? [{ rec, cs }] : null;
  };
  const emitRead = r => {
    if (r.token) {
      const c = centerOf(r.cs.flatMap(s => s.ptsFt));
      addPlayerOp({ op: "player", x: c.x, y: c.y, sym: r.token, srcs: idxOf(r.cs) });
    } else emitGlyph(r.rec, r.cs);
  };
  // Symbols are drawn ONE AT A TIME, so a symbol's strokes are consecutive in
  // draw order — an X's two legs, then the next X's. When proximity grouping
  // gets it wrong (dense boards put a neighbour's leg closer than your own),
  // re-segment the group along that time order instead. Runs are capped at 3
  // strokes: every symbol fits (F and R are the widest at 3), while two
  // adjacent X's — 4 legs that would happily score as one big X — cannot.
  const MAX_RUN = 3;
  const readByTime = cs => {
    const seq = cs.slice().sort((a, b) => a.idx - b.idx);
    const out = [];
    let i = 0, found = 0;
    while (i < seq.length) {
      let hit = null, len = 0;
      for (let n = Math.min(MAX_RUN, seq.length - i); n >= 1; n--) {
        const rd = readGroup(seq.slice(i, i + n));
        if (rd) { hit = rd; len = n; break; }
      }
      if (hit) { out.push(...hit); found += hit.length; i += len; }
      else { out.push({ fail: seq[i] }); i++; }
    }
    return found ? { reads: out, count: found } : null;
  };
  // Three ways to read a group: as one symbol, split tighter by proximity, or
  // segmented by draw order. Whichever recovers the most symbols wins; only
  // ink that survives all three is written off.
  const takeCluster = (cs, r, depth) => {
    if (puckGate(cs.map(s => s.pts), puckDot, puckDense)) {
      const c = centerOf(cs.flatMap(s => s.ptsFt));
      puckOps.push({ op: "puck", x: c.x, y: c.y, on: null, srcs: idxOf(cs) });
      return;
    }
    const whole = readGroup(cs);
    const wholeN = whole ? whole.length : 0;
    if (cs.length > 1 && depth < 4) {
      const subs = groupStrokes(cs, r / 2);
      const subN = subs.length > 1
        ? subs.reduce((n, sub) => n + ((readGroup(sub) || []).length), 0) : -1;
      const timed = readByTime(cs);
      const timedN = timed ? timed.count : 0;
      if (subN >= timedN && subN > wholeN) {
        subs.forEach(sub => takeCluster(sub, r / 2, depth + 1));
        return;
      }
      if (timed && timedN > wholeN) {
        timed.reads.forEach(t => (t.fail ? clusterFail([t.fail]) : emitRead(t)));
        return;
      }
      if (!whole) {
        if (subs.length > 1) { subs.forEach(sub => takeCluster(sub, r / 2, depth + 1)); return; }
        cs.forEach(s => takeCluster([s], 0, depth + 1));
        return;
      }
    }
    if (whole) { whole.forEach(emitRead); return; }
    clusterFail(cs);   // held back: routes, or an arrowhead flick
  };
  // Two-level grouping, like reading handwriting: a loose "word" pass catches
  // side-by-side tokens (LW, RD, CO), then a tight pass inside it separates the
  // individual glyphs. The size cap keeps a word from spanning the ice.
  const sideBySide = (g1, g2) => {
    const b1 = bboxOf(g1.flatMap(s => s.pts)), b2 = bboxOf(g2.flatMap(s => s.pts));
    const [l, r2] = b1.x <= b2.x ? [b1, b2] : [b2, b1];
    if (l.x + l.w > r2.x + r2.w * 0.5) return false;              // must be beside, not stacked
    const ov = Math.min(b1.y + b1.h, b2.y + b2.h) - Math.max(b1.y, b2.y);
    return ov > 0.5 * Math.min(b1.h, b2.h);                       // and share a line
  };
  // No size cap on the WORD pass: a cap can fall between a symbol's own
  // strokes, orphaning a leg that nothing downstream can reunite with its
  // partner (it cost whole rows of a dense grid). takeCluster re-splits big
  // groups safely, so letting them form is free; the tight pass inside still
  // caps each glyph at symbol size.
  groupStrokes(pool, linkR * 3, Infinity).forEach(word => {
    const glyphs = groupStrokes(word, linkR);
    if (glyphs.length === 2 && sideBySide(glyphs[0], glyphs[1])) {
      const recs = glyphs.map(g => recognizeSymbol(g.map(s => s.pts)));
      const join = recs.every(Boolean) ? recs.map(r => r.sym).join("") : "";
      if (join.length > 1 && WB_SYMS.includes(join)) {
        const cs = glyphs.flat();
        const c = centerOf(cs.flatMap(s => s.ptsFt));
        addPlayerOp({ op: "player", x: c.x, y: c.y, sym: join, srcs: idxOf(cs) });
        return;
      }
    }
    // hand the WHOLE word down, not the pre-split glyphs: takeCluster can then
    // weigh a proximity split against draw-order segmentation. Splitting first
    // would lock in a bad grouping — on a dense board a neighbour's stroke can
    // sit closer than your own, and nothing downstream can recombine them.
    takeCluster(word, linkR * 2, 0);
  });

  // ---- long strokes (plus failed-cluster strays, in draw order):
  //      big closed shape → zigzag → shot → route → ink ----
  const routeEnds = [];
  [...longs, ...fallThrough].sort((a, b) => a.idx - b.idx).forEach(s => {
    const pts = s.pts, last = pts[pts.length - 1];
    if (dist(pts[0], last) / s.diag < 0.3) {
      const rec = recognizeSymbol([pts]);
      if (rec && ["O", "□", "△"].includes(rec.sym)) {
        if (rec.sym === "△" && s.diag < coneMax) {
          const c = centerOf(s.ptsFt);
          addOp({ op: "cone", x: c.x, y: c.y, srcs: [s.idx] });
        } else {
          const b = bboxOf(s.ptsFt);
          const shape = rec.sym === "O" ? "circle" : rec.sym === "□" ? "square" : "triangle";
          addOp({ op: "shape", shape, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, srcs: [s.idx] });
        }
        return;
      }
    }
    const mid = zigzagMidline(pts);
    if (!mid) {
      // a near-straight solo stroke into the net is a shot, not a skate
      const net = netAt(last);
      if (net && dist(pts[0], last) / pathLen([pts]) > 0.85) {
        const by = sourceAt(pts[0]);
        if (by) { addOp({ op: "shot", by: by.who, net: net.id, srcs: [s.idx] }); return; }
      }
    }
    const skater = nearest(pts[0], attachR, roster.filter(e => !e.hasPath), e => ({ x: e.x, y: e.y }));
    if (skater) {
      const shaped = mid || stripArrowhead(pts, arrowLeg);   // screen units
      const raw = shaped.map(toFt);                          // fitRoute works in feet
      addOp({ op: "route", to: skater.who, raw, bwd: !!mid, srcs: [s.idx] });
      skater.hasPath = true;
      skater.end = shaped[shaped.length - 1];
      routeEnds.push(skater.end);
      return;
    }
    leftovers.push(s);
  });

  // an unrecognized tiny cluster sitting on a fresh route's end is an
  // arrowhead flick drawn as its own strokes — consume it (the one deliberate
  // exception to ink-is-never-lost; routes draw their own carats)
  unrec.forEach(cs => {
    const all = cs.flatMap(s => s.pts);
    const c = centerOf(all);
    const tiny = strokesDiag([all]) < flickMax;
    if (tiny && routeEnds.some(e => dist(c, e) < flickR)) {
      addOp({ op: "drop", srcs: idxOf(cs) });   // consumed, nothing materializes
      return;
    }
    leftovers.push(...cs);
  });

  // pucks bind to whoever is on their doorstep, now that every player has
  // landed — and they must precede pass/shot ops, whose materialization would
  // otherwise conjure a duplicate puck for the same carrier
  puckOps.forEach(o => {
    const on = spotAt(toU(o), puckOnR, null);
    ops.push({ ...o, on: on ? on.who : null });
  });

  // ---- dashed lines resolve last, when every skater's end is known ----
  dashGroups.forEach(g => {
    const src = sourceAt(g.a);
    const net = netAt(g.b);
    if (src && net) { addOp({ op: "shot", by: src.who, net: net.id, srcs: idxOf(g.strokes) }); return; }
    const tgt = spotAt(g.b, passR, src);
    if (src && tgt) { addOp({ op: "pass", from: src.who, to: tgt.who, recvAt: -1, srcs: idxOf(g.strokes) }); return; }
    leftovers.push(...g.strokes);
  });

  leftovers.forEach(s => addOp({ op: "mark", pts: s.ptsFt, srcs: [s.idx] }));
  return ops;
}
