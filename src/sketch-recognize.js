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
function isDash(pts, diag) {
  if (pts.length < 2 || diag >= 6) return false;
  const a = pts[0], b = pts[pts.length - 1];
  const chord = dist(a, b);
  if (chord < 1) return false;
  const dx = b.x - a.x, dy = b.y - a.y, len = chord;
  let dev = 0;
  pts.forEach(p => {
    const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
    if (d > dev) dev = d;
  });
  return chord / Math.max(dev, 0.15) > 3;
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
// ctx: { players:[{id,x,y,end?,hasPath?}], nets:[{id,x,y}] } — the board today.
// Returns the op list documented in the header; refs ({ref:i}) point at player
// ops created earlier in the same list.
export function classifyPenGroup(strokes, ctx = {}) {
  const players = ctx.players || [], nets = ctx.nets || [];
  const ops = [];
  const leftovers = [];   // strokes that fell through → mark ops, in draw order

  // roster = everything a route/pass/shot can bind to; grows as player ops land
  const roster = players.map(p => ({
    who: { id: p.id }, x: p.x, y: p.y,
    end: p.end || { x: p.x, y: p.y }, hasPath: !!p.hasPath,
  }));
  const addOp = op => { ops.push(op); return ops.length - 1; };
  const addPlayerOp = op => {
    const i = addOp(op);
    roster.push({ who: { ref: i }, x: op.x, y: op.y, end: { x: op.x, y: op.y }, hasPath: false });
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
  const sourceAt = pt => nearest(pt, PASS_R, roster, e => e.hasPath ? e.end : { x: e.x, y: e.y });
  const spotAt = (pt, r, skip) => nearest(pt, r, roster.filter(e => e !== skip), e => ({ x: e.x, y: e.y }));
  const netAt = pt => nearest(pt, NET_R, nets, n => ({ x: n.x, y: n.y }));

  const S = strokes.map(s => ({ pts: s.pts, diag: strokesDiag([s.pts]) }));
  const shorts = S.filter(s => s.diag < SYMBOL_MAX);
  const longs = S.filter(s => s.diag >= SYMBOL_MAX);

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
        if (rms < 1.5 && tMax - tMin > DASH_SPAN && marching) {
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
    shorts.forEach(s => { if (isDash(s.pts, s.diag)) run.push(s); else flush(); });
    flush();
  }

  // ---- symbol clusters from the remaining shorts (bbox union, 2ft slack) ----
  const pool = shorts.filter(s => !consumed.has(s));
  const clusters = [];
  pool.forEach(s => {
    const b = bboxOf(s.pts);
    const grown = { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 };
    const hit = clusters.filter(c => c.some(e =>
      grown.x < e.b.x + e.b.w && e.b.x < grown.x + grown.w &&
      grown.y < e.b.y + e.b.h && e.b.y < grown.y + grown.h));
    const merged = hit.length ? hit[0] : [];
    hit.slice(1).forEach(c => { merged.push(...c); clusters.splice(clusters.indexOf(c), 1); });
    if (!hit.length) clusters.push(merged);
    merged.push({ s, b });
  });

  const glyphOp = (rec, strokesOf) => {
    const c = centerOf(strokesOf.flatMap(s => s.pts));
    if (rec.sym === "△") return { op: "cone", x: c.x, y: c.y };
    return { op: "player", x: c.x, y: c.y, sym: rec.sym };
  };
  const puckOps = [];
  clusters.forEach(cl => {
    const cs = cl.map(e => e.s);
    const pts = cs.map(s => s.pts);
    if (puckGate(pts)) {
      const c = centerOf(pts.flat());
      puckOps.push({ op: "puck", x: c.x, y: c.y, on: null });
      return;
    }
    const glyphs = splitGlyphs(cs);
    if (glyphs.length > 1) {
      const recs = glyphs.map(g => recognizeSymbol(g.map(s => s.pts)));
      if (recs.every(Boolean)) {
        const join = recs.map(r => r.sym).join("");
        // two glyphs spelling a whiteboard token (LW, RD, CO…) are ONE player;
        // otherwise each glyph stands alone (two X's drawn near each other)
        if (glyphs.length === 2 && join.length > 1 && WB_SYMS.includes(join)) {
          const c = centerOf(pts.flat());
          addPlayerOp({ op: "player", x: c.x, y: c.y, sym: join });
        } else glyphs.forEach((g, i) => {
          const o = glyphOp(recs[i], g);
          o.op === "player" ? addPlayerOp(o) : addOp(o);
        });
        return;
      }
    }
    const rec = recognizeSymbol(pts);
    if (rec) {
      const o = glyphOp(rec, cs);
      o.op === "player" ? addPlayerOp(o) : addOp(o);
    } else leftovers.push(...cs);
  });

  // ---- long strokes: big closed shape → zigzag → shot → route → ink ----
  longs.forEach(s => {
    const pts = s.pts, last = pts[pts.length - 1];
    if (dist(pts[0], last) / s.diag < 0.3) {
      const rec = recognizeSymbol([pts]);
      if (rec && ["O", "□", "△"].includes(rec.sym)) {
        if (rec.sym === "△" && s.diag < CONE_MAX) {
          const c = centerOf(pts);
          addOp({ op: "cone", x: c.x, y: c.y });
        } else {
          const b = bboxOf(pts);
          const shape = rec.sym === "O" ? "circle" : rec.sym === "□" ? "square" : "triangle";
          addOp({ op: "shape", shape, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h });
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
        if (by) { addOp({ op: "shot", by: by.who, net: net.id }); return; }
      }
    }
    const skater = nearest(pts[0], ATTACH_R, roster.filter(e => !e.hasPath), e => ({ x: e.x, y: e.y }));
    if (skater) {
      const raw = mid || pts;
      addOp({ op: "route", to: skater.who, raw, bwd: !!mid });
      skater.hasPath = true;
      skater.end = raw[raw.length - 1];
      return;
    }
    leftovers.push(s);
  });

  // pucks bind to whoever is on their doorstep, now that every player has
  // landed — and they must precede pass/shot ops, whose materialization would
  // otherwise conjure a duplicate puck for the same carrier
  puckOps.forEach(o => {
    const on = spotAt({ x: o.x, y: o.y }, PUCK_ON_R, null);
    ops.push({ ...o, on: on ? on.who : null });
  });

  // ---- dashed lines resolve last, when every skater's end is known ----
  dashGroups.forEach(g => {
    const src = sourceAt(g.a);
    const net = netAt(g.b);
    if (src && net) { addOp({ op: "shot", by: src.who, net: net.id }); return; }
    const tgt = spotAt(g.b, PASS_R, src);
    if (src && tgt) { addOp({ op: "pass", from: src.who, to: tgt.who, recvAt: -1 }); return; }
    leftovers.push(...g.strokes);
  });

  leftovers.forEach(s => addOp({ op: "mark", pts: s.pts }));
  return ops;
}
