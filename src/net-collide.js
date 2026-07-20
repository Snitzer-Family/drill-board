// Nets as solid obstacles. A net's footprint (rink feet) is the cage polygon;
// the MOUTH (front) is open so pucks enter from the front, while the sides and
// back are solid — pucks bounce off them and players route around the whole net.
// Icon units → rink feet uses ICON_SCALE (0.8); coords match icons.jsx.

const ICON = 0.8;
// cage outline in icon units, mouth-top → around the back → mouth-bottom
const LOCAL = [
  [0, -3.75], [-1.7, -3.75], [-3.45, -3.1], [-4.15, -1.5],
  [-4.15, 1.5], [-3.45, 3.1], [-1.7, 3.75], [0, 3.75],
];

// world-space shape for one net piece (+ world↔local transforms)
export function netShape(n) {
  const s = (n.size || 1) * ICON;
  const a = ((n.facing || 0) * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const toWorld = (lx, ly) => ({ x: n.x + lx * s * c - ly * s * si, y: n.y + lx * s * si + ly * s * c });
  const toLocal = (x, y) => { const dx = x - n.x, dy = y - n.y; return { lx: (dx * c + dy * si) / s, ly: (-dx * si + dy * c) / s }; };
  const pts = LOCAL.map(([lx, ly]) => toWorld(lx, ly));
  // solid edges = consecutive pts[0..7]; the mouth edge pts[7]→pts[0] is open
  const solid = [];
  for (let i = 0; i < pts.length - 1; i++) solid.push([pts[i], pts[i + 1]]);
  // a keep-out disc (centroid + radius) that players arc smoothly around
  let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; } cx /= pts.length; cy /= pts.length;
  let r = 0; for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return { pts, solid, mouth: [pts[pts.length - 1], pts[0]], toWorld, toLocal, s, cx, cy, r };
}

export function netShapes(pieces) {
  return (pieces || []).filter(p => p.kind === "net").map(netShape);
}

// point-in-polygon (cage closed by the mouth)
export function inNet(sh, x, y) {
  const p = sh.pts; let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// nearest point on a segment to (x,y)
function nearestOnSeg(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t, dx, dy };
}

// Slide a point out the nearer SIDE of a net (in the net's local frame), with
// the clearance ramped smoothly over a buffer in front of and behind the cage so
// the detour rounds into an ARC (no sharp V) — and only the net footprint itself
// pushes hard, so a player placed behind the net isn't disturbed. margin (feet).
export function avoidNets(shapes, x, y, margin = 1.1) {
  for (const sh of shapes) {
    const { lx, ly } = sh.toLocal(x, y);       // lx: 0 mouth → -4.15 back
    const front = 0, back = -4.15, buf = 2.6;
    if (lx > front + buf || lx < back - buf) continue;
    // depth factor: 1 across the cage, easing to 0 over the front/back buffers
    let f = lx <= front && lx >= back ? 1 : lx > front ? 1 - (lx - front) / buf : 1 - (back - lx) / buf;
    f = Math.max(0, Math.min(1, f));
    f = f * f * (3 - 2 * f);                    // smoothstep → rounded shoulders
    const bound = (3.75 + margin / sh.s) * f;   // lateral clearance at this depth
    if (Math.abs(ly) >= bound) continue;
    const w = sh.toWorld(lx, (ly >= 0 ? 1 : -1) * bound);
    x = w.x; y = w.y;
  }
  return { x, y };
}

// Reroute a sampled polyline so it arcs smoothly AROUND each net's keep-out disc
// instead of cutting through it — a single tangent-in → boundary-arc → tangent-out
// per net, so there's no per-point jitter. Endpoints (incl. a start/end placed
// inside the disc, e.g. behind the net) are preserved.
export function detourRoute(points, shapes) {
  let pts = points, changed = false;
  for (const sh of shapes) { const np = aroundDisc(pts, sh.cx, sh.cy, sh.r + 1); if (np !== pts) { pts = np; changed = true; } }
  return changed ? chaikin(chaikin(pts)) : points;   // round the tangent/radial joins
}
// Chaikin corner-cutting (endpoints fixed) — rounds any residual joins
function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function segCircleHit(a, b, cx, cy, R) {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - cx, fy = a.y - cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R;
  let dis = B * B - 4 * A * C;
  if (dis < 0) return { x: b.x, y: b.y };
  dis = Math.sqrt(dis);
  const t = Math.max(0, Math.min(1, (-B - dis) / (2 * A)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}
// the two tangent points from an external point P to a circle
function tangents(P, cx, cy, R) {
  const dx = P.x - cx, dy = P.y - cy, d = Math.hypot(dx, dy);
  if (d <= R + 1e-6) return [];
  const base = Math.atan2(dy, dx), off = Math.acos(Math.max(-1, Math.min(1, R / d)));
  return [base + off, base - off].map(a => ({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, ang: a }));
}
function arcPts(cx, cy, R, a0, ccw, span) {
  const n = Math.max(4, Math.round(span / 0.12)), out = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (ccw ? 1 : -1) * span * k / n; out.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }); }
  return out;
}

function aroundDisc(pts, cx, cy, R) {
  const D = p => Math.hypot(p.x - cx, p.y - cy);
  let i0 = -1, i1 = -1;
  for (let i = 0; i < pts.length; i++) if (D(pts[i]) < R) { if (i0 < 0) i0 = i; i1 = i; }
  if (i0 < 0) return pts;                                    // never enters the disc
  // anchor the tangents well outside the disc (~2.4R) so the route eases in
  // gradually instead of turning hard right at the edge
  const AR = 2.4 * R;
  let ai = i0; while (ai > 0 && D(pts[ai - 1]) < AR) ai--;
  let bi = i1; while (bi < pts.length - 1 && D(pts[bi + 1]) < AR) bi++;
  ai = Math.max(0, ai - 1); bi = Math.min(pts.length - 1, bi + 1);
  const A = pts[ai], B = pts[bi];
  const startInside = D(A) < R, endInside = D(B) < R;
  const ang = p => Math.atan2(p.y - cy, p.x - cx);

  // Prefer a tangent-in → arc → tangent-out path (smooth, no kink at the joins).
  // If an endpoint is inside the disc, that side starts/ends radially instead.
  const TA = startInside ? null : tangents(A, cx, cy, R);
  const TB = endInside ? null : tangents(B, cx, cy, R);
  const startAngs = TA ? TA : [{ ...segCircleHitProj(pts[0], cx, cy, R), fromInside: true }];
  const endAngs = TB ? TB : [{ ...segCircleHitProj(pts[pts.length - 1], cx, cy, R), fromInside: true }];

  let best = null;
  for (const t1 of startAngs) for (const t2 of endAngs) {
    // arc direction follows the A→t1 tangent (radial-out if the start is inside)
    const inx = t1.x - A.x, iny = t1.y - A.y;
    const ccwTan1 = { x: -Math.sin(t1.ang), y: Math.cos(t1.ang) };
    const ccw = t1.fromInside
      ? (-Math.sin(t1.ang) * (B.x - A.x) + Math.cos(t1.ang) * (B.y - A.y)) >= 0
      : (inx * ccwTan1.x + iny * ccwTan1.y) >= 0;
    // require the arc to LEAVE at t2 heading toward B (tangency) unless B is inside
    const exitTan = ccw ? { x: -Math.sin(t2.ang), y: Math.cos(t2.ang) } : { x: Math.sin(t2.ang), y: -Math.cos(t2.ang) };
    const outx = B.x - t2.x, outy = B.y - t2.y;
    if (!t2.fromInside && exitTan.x * outx + exitTan.y * outy < 0) continue;
    let span = ccw ? t2.ang - t1.ang : t1.ang - t2.ang;
    while (span < 0) span += 2 * Math.PI;
    if (span > Math.PI * 1.7) continue;                     // reject wrong-way near-full loops
    const len = Math.hypot(inx, iny) + span * R + Math.hypot(outx, outy);
    if (!best || len < best.len) best = { t1, t2, ccw, span, len };
  }
  if (!best) return pts;
  const arc = arcPts(cx, cy, R, best.t1.ang, best.ccw, best.span);   // includes t1 & t2 as endpoints
  const pre = startInside ? [pts[0]] : pts.slice(0, ai + 1);
  const post = endInside ? [pts[pts.length - 1]] : pts.slice(bi);
  return [...pre, ...arc, ...post];
}
// project a point radially onto the circle (for an endpoint inside the disc)
function segCircleHitProj(p, cx, cy, R) {
  const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R, ang };
}

// segment a→b vs segment c→d intersection; returns { t, x, y } (t along a→b) or null
function segInt(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 1e-4 || t > 1 || u < 0 || u > 1) return null;
  return { t, x: a.x + r.x * t, y: a.y + r.y * t };
}

// Reflect a travelling polyline off the solid net edges so it bounces instead of
// passing through the sides/back. After a bounce it continues straight for the
// remaining arc length (approximate, but reads as a natural carom). Returns a new
// polyline of the same total length; unchanged if it never hits a net.
export function reflectPath(poly, shapes) {
  if (!shapes.length || poly.length < 2) return poly;
  const out = [poly[0]];
  let cur = poly[0];
  // remaining length still to travel along the original polyline
  let remain = 0;
  for (let k = 1; k < poly.length; k++) remain += Math.hypot(poly[k].x - poly[k - 1].x, poly[k].y - poly[k - 1].y);
  // direction of travel at the current point (from the source polyline)
  let idx = 1, next = poly[1];
  let dir = norm(next.x - cur.x, next.y - cur.y);
  let guard = 0;
  while (remain > 0.01 && guard++ < 200) {
    // step target: either the next source vertex (if we're still tracing it) or
    // a straight continuation after a bounce
    const step = Math.min(remain, Math.hypot(next.x - cur.x, next.y - cur.y) || remain);
    const tip = { x: cur.x + dir.x * step, y: cur.y + dir.y * step };
    // nearest solid-edge hit along cur→tip
    let hit = null;
    for (const sh of shapes) for (const [a, b] of sh.solid) {
      const h = segInt(cur, tip, a, b);
      if (h && (!hit || h.t < hit.t)) hit = { ...h, a, b };
    }
    if (hit) {
      out.push({ x: hit.x, y: hit.y });
      const trav = Math.hypot(hit.x - cur.x, hit.y - cur.y);
      remain -= trav;
      // reflect dir about the edge normal
      const ex = hit.b.x - hit.a.x, ey = hit.b.y - hit.a.y, el = Math.hypot(ex, ey) || 1;
      let nx = -ey / el, ny = ex / el;
      const dot = dir.x * nx + dir.y * ny;
      dir = norm(dir.x - 2 * dot * nx, dir.y - 2 * dot * ny);
      // nudge off the wall so we don't immediately re-hit it
      cur = { x: hit.x + dir.x * 0.05, y: hit.y + dir.y * 0.05 };
      next = { x: cur.x + dir.x * remain, y: cur.y + dir.y * remain };  // straight from here on
    } else {
      out.push(tip);
      remain -= step;
      cur = tip;
      if (Math.hypot(next.x - cur.x, next.y - cur.y) < 0.02) {
        // reached this source vertex — advance to the next one
        idx++;
        if (idx < poly.length) { next = poly[idx]; dir = norm(next.x - cur.x, next.y - cur.y); }
      }
    }
  }
  return out;
}

function norm(x, y) { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }
