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

// world-space shape for one net piece
export function netShape(n) {
  const s = (n.size || 1) * ICON;
  const a = ((n.facing || 0) * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  const pts = LOCAL.map(([lx, ly]) => {
    const X = lx * s, Y = ly * s;
    return { x: n.x + X * c - Y * si, y: n.y + X * si + Y * c };
  });
  // solid edges = consecutive pts[0..7]; the mouth edge pts[7]→pts[0] is open
  const solid = [];
  for (let i = 0; i < pts.length - 1; i++) solid.push([pts[i], pts[i + 1]]);
  return { pts, solid, mouth: [pts[pts.length - 1], pts[0]] };
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

// If (x,y) is inside a net, push it just outside the nearest boundary edge
// (mouth included, so players pop out whichever side is closest). margin in feet.
export function avoidNets(shapes, x, y, margin = 1.4) {
  for (const sh of shapes) {
    if (!inNet(sh, x, y)) continue;
    const edges = [...sh.solid, sh.mouth];
    let best = null;
    for (const [a, b] of edges) {
      const q = nearestOnSeg(a, b, x, y);
      const d = Math.hypot(q.x - x, q.y - y);
      if (!best || d < best.d) best = { d, q };
    }
    if (best) {
      // outward normal = from the interior point toward the nearest edge point
      const nx = best.q.x - x, ny = best.q.y - y, m = Math.hypot(nx, ny) || 1;
      x = best.q.x + (nx / m) * margin;
      y = best.q.y + (ny / m) * margin;
    }
  }
  return { x, y };
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
