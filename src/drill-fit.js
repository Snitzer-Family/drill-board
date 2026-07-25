// Pixel → rink-feet mapping for photo import. The vision model reports rink
// landmarks and writes the drill in IMAGE PIXEL coordinates; this module fits
// the orientation + scale deterministically and rewrites the DSL text. Pure
// (no DOM, no fetch) so it's node-testable like possession.js.

// Known rink geometry (matches rink.jsx / docs/drill-dsl.md landmark table).
const GOAL_X = [11, 189], BLUE_X = [75, 125], CENTER_X = 100;
const EZ_DOT_X = [31, 169], NZ_DOT_X = [80, 120], DOT_Y = [20.5, 64.5], MID_Y = 42.5;
const RINK_W = 200, RINK_H = 85, CORNER_R = 28, EDGE_IN = 1; // boards rect rx=28 in rink.jsx

// Clamp a mapped point INTO the rounded-rink ice, inset EDGE_IN from the
// boards. The old box clamp pinned out-of-range points exactly onto the
// boards line — and near the corners that is outside the ice entirely, so a
// slightly-misjudged wall point rendered as skating out of the rink. Points
// that land in a corner's dead zone project back onto the corner arc.
function clampIce(x, y) {
  x = Math.min(RINK_W - EDGE_IN, Math.max(EDGE_IN, x));
  y = Math.min(RINK_H - EDGE_IN, Math.max(EDGE_IN, y));
  const cx = x < CORNER_R ? CORNER_R : x > RINK_W - CORNER_R ? RINK_W - CORNER_R : null;
  const cy = y < CORNER_R ? CORNER_R : y > RINK_H - CORNER_R ? RINK_H - CORNER_R : null;
  if (cx !== null && cy !== null) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), max = CORNER_R - EDGE_IN;
    if (d > max) { x = cx + (dx / d) * max; y = cy + (dy / d) * max; }
  }
  return { x, y };
}

// Rotate pixel coords (y-down) so the reported attack direction points +x.
// Both pixel and rink spaces are y-down, so a photographed overhead diagram
// only ever differs by one of these four rotations — never a reflection.
const ROTS = {
  right: (p) => ({ u: p.x, v: p.y }),
  down: (p) => ({ u: p.y, v: -p.x }),
  left: (p) => ({ u: -p.x, v: -p.y }),
  up: (p) => ({ u: -p.y, v: p.x }),
};

// 1D least squares y = s·x + t over [[x, y], …]; returns null when degenerate.
function fit1d(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of pairs) { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); }
  if (den < 1e-6) return null;
  const s = num / den;
  return { s, t: my - s * mx };
}

// Assign a feature with two candidate x values: by u-order when the class has
// multiple instances, else relative to a reference u (center line / mean).
function pickX(u, candidates, siblings, refU) {
  if (siblings.length > 1) {
    const rank = siblings.slice().sort((a, b) => a - b).indexOf(u);
    return rank >= siblings.length / 2 ? candidates[1] : candidates[0];
  }
  return u >= refU ? candidates[1] : candidates[0];
}

// Fit the pixel→rink transform for ONE candidate attack direction.
function fitOne(landmarks, attack, rink) {
  const rot = ROTS[attack] || ROTS.right;
  const half = rink !== "full";
  const pts = (landmarks || [])
    .filter(l => l && isFinite(l.x) && isFinite(l.y))
    .map(l => ({ f: String(l.feature || "").toLowerCase(), ...rot(l) }));
  if (!pts.length) return { error: "no rink landmarks found" };

  const meanU = pts.reduce((a, p) => a + p.u, 0) / pts.length;
  const centers = pts.filter(p => /center_(line|dot|circle)/.test(p.f));
  const refU = centers.length ? centers.reduce((a, p) => a + p.u, 0) / centers.length : meanU;
  const us = cls => pts.filter(p => p.f.startsWith(cls)).map(p => p.u);

  // x correspondences — attack points +x, so single attack-end features map to
  // the right end; on full ice paired lines resolve by u-order vs the center.
  const xPairs = [], goalU = { L: [], R: [] }, boardU = { L: [], R: [] };
  for (const p of pts) {
    if (/^(goal_line|net|crease)/.test(p.f)) {
      const X = half ? GOAL_X[1] : pickX(p.u, GOAL_X, us("goal_line"), refU);
      xPairs.push([p.u, X]);
      if (p.f.startsWith("goal_line")) (X === GOAL_X[1] ? goalU.R : goalU.L).push(p.u);
    } else if (p.f.startsWith("blue_line")) {
      xPairs.push([p.u, half ? BLUE_X[1] : pickX(p.u, BLUE_X, us("blue_line"), refU)]);
    } else if (/^center_(line|dot|circle)/.test(p.f)) {
      xPairs.push([p.u, CENTER_X]);
    } else if (p.f.startsWith("endzone")) {
      xPairs.push([p.u, half ? EZ_DOT_X[1] : pickX(p.u, EZ_DOT_X, us("endzone"), refU)]);
    } else if (p.f.startsWith("neutral")) {
      xPairs.push([p.u, half ? NZ_DOT_X[1] : pickX(p.u, NZ_DOT_X, us("neutral"), refU)]);
    } else if (p.f.startsWith("end_boards")) {
      // the wall behind the net. NOT fed to the global least squares: stylized
      // pages draw the goal-line→boards strip oversized, and one boards pair
      // can't outvote the goal/dot cluster — the strip is handled piecewise
      // below instead (only a fallback pair when no goal line was reported).
      const X = half ? RINK_W : pickX(p.u, [0, RINK_W], us("end_boards"), refU);
      (X === RINK_W ? boardU.R : boardU.L).push(p.u);
      if (!pts.some(q => q.f.startsWith("goal_line"))) xPairs.push([p.u, X]);
    }
  }
  const fx = fit1d(xPairs);
  if (!fx || fx.s <= 0) return { error: "need two or more distinct rink landmarks (goal line, blue line, dots…) to orient the diagram" };

  // PIECEWISE STRIP behind each goal line: pixels between the drawn goal line
  // and the drawn wall map proportionally onto the real 11ft strip — anchored
  // at the fitted goal line (continuity) and exactly at the boards. Stylized
  // pages draw this strip far off scale, and linear extrapolation flattened
  // every wall puck/route onto the clamp.
  const avg = a => a.reduce((s, n) => s + n, 0) / a.length;
  const mkStrip = (gs, bs, XB) => {
    if (!gs.length || !bs.length) return null;
    const uG = avg(gs), uB = avg(bs);
    return Math.abs(uB - uG) < 1e-6 ? null : { uG, uB, XB };
  };
  const strips = [mkStrip(goalU.R, boardU.R, RINK_W), mkStrip(goalU.L, boardU.L, 0)].filter(Boolean);
  const mapX = u => {
    for (const st of strips) {
      const t = (u - st.uG) / (st.uB - st.uG);
      if (t > 0) { const xG = fx.s * st.uG + fx.t; return xG + t * (st.XB - xG); }
    }
    return fx.s * u + fx.t;
  };

  // y correspondences — mid-ice anchors are exact; dots resolve top/bottom
  // against the anchor (or their own pair mean when no anchor is visible).
  // Nets are NOT assumed mid-ice: drills park nets anywhere (e.g. on the goal
  // line over each faceoff circle), so they anchor y only as a last resort.
  const trueMidV = pts.filter(p => /^(crease|center_dot|center_circle)/.test(p.f)).map(p => p.v);
  const netV = pts.filter(p => p.f.startsWith("net")).map(p => p.v);
  const dotV = pts.filter(p => /^(endzone|neutral)/.test(p.f)).map(p => p.v);
  const midV = trueMidV.length || dotV.length ? trueMidV : netV;
  const anchorV = midV.length ? midV.reduce((a, b) => a + b, 0) / midV.length
    : dotV.length ? dotV.reduce((a, b) => a + b, 0) / dotV.length
    : pts.reduce((a, p) => a + p.v, 0) / pts.length;
  const yPairs = midV.map(v => [v, MID_Y]);
  for (const v of dotV) yPairs.push([v, v < anchorV ? DOT_Y[0] : DOT_Y[1]]);
  // side walls anchor y the way end_boards anchors x
  for (const p of pts) if (p.f.startsWith("side_boards")) yPairs.push([p.v, p.v < anchorV ? 0 : RINK_H]);
  let fy = fit1d(yPairs);
  // degenerate / implausible y-fit (all anchors mid-ice, single dot, wild
  // stretch from a misassigned dot) → assume the photo's aspect is honest.
  // Bounds are wide: stylized drill-book graphics legitimately compress one
  // axis ~3× (a squished half-ice PNG is sy/sx ≈ 0.35).
  if (!fy || fy.s <= 0 || fy.s / fx.s < 0.15 || fy.s / fx.s > 7) {
    fy = { s: fx.s, t: MID_Y - fx.s * anchorV };
  }

  const map = (x, y) => {
    const { u, v } = rot({ x, y });
    return clampIce(mapX(u), fy.s * v + fy.t);
  };
  let residual = 0;
  for (const [u, X] of xPairs) residual += Math.abs(fx.s * u + fx.t - X);
  for (const [v, Y] of yPairs) residual += Math.abs(fy.s * v + fy.t - Y);
  residual /= Math.max(1, xPairs.length + yPairs.length);
  return { map, residual };
}

// Fit the pixel→rink transform from model-reported landmarks.
// landmarks: [{feature, x, y}] in pixels; feature ∈ goal_line | blue_line |
// center_line | center_dot | center_circle | net | crease | endzone_dot |
// endzone_circle | neutral_dot | end_boards | side_boards. Line features use
// the midpoint of the drawn line (for boards: of the straight wall section). attack: which way the model says the play attacks in the IMAGE —
// treated as a prior, not gospel: every orientation is fitted and the one the
// landmarks actually agree with wins; the stated attack only breaks near-ties.
// rink: half | full. Returns { map, residual, attack } or { error }.
export function fitTransform(landmarks, { attack = "right", rink = "half" } = {}) {
  const cands = [];
  for (const dir of Object.keys(ROTS)) {
    const f = fitOne(landmarks, dir, rink);
    if (!f.error) cands.push({ attack: dir, ...f });
  }
  if (!cands.length) return fitOne(landmarks, attack, rink); // surface its error
  cands.sort((a, b) => a.residual - b.residual);
  let best = cands[0];
  const stated = cands.find(c => c.attack === attack);
  if (stated && stated.residual <= best.residual * 1.5 + 0.5) best = stated;
  return best;
}

// NOTE: pieces are NOT snapped to dots/landmarks — the mapped pixel position
// is kept verbatim so the import reproduces the diagram exactly as drawn.
// (Nets are the one exception: they snap onto the goal line below.)

const round1 = n => Math.round(n * 10) / 10;
const COORD_RE = /^-?\d*\.?\d+,-?\d*\.?\d+$/;

// split a statement line into tokens, keeping quoted strings intact
function tokenize(line) {
  return line.match(/"[^"]*"|\S+/g) || [];
}

// Rewrite every coordinate in a pixel-space DSL through `map`. Handles PIECE
// (x y as separate tokens), PATH/BRANCH/MARK "x,y" tokens (skipping the value
// after OFF — a label offset, not a position), and STEP pos=x:y. face= and aim
// (~deg) modifiers are dropped: they're image-frame angles the fit can't fix,
// and auto-facing covers them. Net pieces snap to the goal lines.
export function transformDsl(text, map) {
  return text.split(/\r?\n/).map(line => {
    const kw = (line.trim().split(/\s+/)[0] || "").toUpperCase();
    if (kw === "PIECE") {
      const tok = tokenize(line.trim());
      const x = parseFloat(tok[3]), y = parseFloat(tok[4]);
      if (!isFinite(x) || !isFinite(y)) return line;
      let p = map(x, y);
      const kind = (tok[2] || "").toLowerCase();
      if (kind === "net") {
        const gx = Math.abs(p.x - GOAL_X[1]) <= Math.abs(p.x - GOAL_X[0]) ? GOAL_X[1] : GOAL_X[0];
        if (Math.abs(p.x - gx) < 14) {
          // y snaps to the crease, or — for nets parked over a faceoff circle —
          // to that circle's dot lane; anywhere else the drawn y is kept.
          const lane = [[MID_Y, 10], [DOT_Y[0], 6], [DOT_Y[1], 6]].find(([Y, tol]) => Math.abs(p.y - Y) <= tol);
          p = { x: gx, y: lane ? lane[0] : p.y };
        }
      }
      tok[3] = String(round1(p.x)); tok[4] = String(round1(p.y));
      const out = tok.filter(t => !/^face=/i.test(t));
      // nets always open toward center ice: default facing (mouth +x) is right
      // for the left half; a net in the right half needs face=180 or its mouth
      // points at the backboard
      if (kind === "net" && p.x > 100) out.push("face=180");
      return out.join(" ");
    }
    if (kw === "MARK") {
      // transform the ink points, then DENSIFY: the app renders marks as a
      // Catmull-Rom curve through the points, so sparse corner points balloon
      // a straight-sided zone into a blob. Interpolated points every ~3.5ft
      // keep straight sides straight (curved traces are dense already).
      const tok = tokenize(line.trim());
      const head = [], pts = [];
      for (const t of tok) {
        if (COORD_RE.test(t)) {
          const [x, y] = t.split(",").map(parseFloat);
          pts.push(map(x, y));
        } else head.push(t);
      }
      // PRESET-SHAPE RECOGNITION: a closed trace whose points sit evenly on
      // one ellipse is a shaded circle overlay (a highlighted faceoff circle,
      // a drawn ring). Replace the wobbly hand trace with the same parametric
      // circle the app's preset circle-shape tool draws, so imports get clean
      // geometry instead of a squiggle. Straight-sided presets (square/
      // triangle) already come out crisp below via densify + corners=.
      if (pts.length >= 9 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 3) {
        const core = pts.slice(0, -1);
        const xs = core.map(p => p.x), ys = core.map(p => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2;
        const round = rx > 2 && ry > 2 &&
          core.every(p => Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) <= 0.15);
        if (round) {
          const N = 24, ell = [];
          for (let i = 0; i <= N; i++) {
            const t = (i / N) * 2 * Math.PI;
            ell.push(`${round1(cx + Math.cos(t) * rx)},${round1(cy + Math.sin(t) * ry)}`);
          }
          return [...head, ...ell].join(" ");
        }
      }
      // sharp bends (≥30° turn) in the traced overlay become CORNER points so
      // the renderer breaks the curve there instead of rounding the corner
      const sharp = pts.map((p, i) => {
        if (i === 0 || i === pts.length - 1) return false;
        const a = pts[i - 1], b = pts[i + 1];
        const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y;
        const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
        return (v1x * v2x + v1y * v2y) / (l1 * l2) < Math.cos((30 * Math.PI) / 180);
      });
      const dense = [], cornerIdx = [];
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) {
          const a = pts[i - 1], b = pts[i];
          const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 3.5);
          for (let k = 1; k <= n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / (n + 1), y: a.y + ((b.y - a.y) * k) / (n + 1) });
        }
        if (sharp[i]) cornerIdx.push(dense.length);
        dense.push(pts[i]);
      }
      if (cornerIdx.length) head.push(`corners=${cornerIdx.join(";")}`);
      return [...head, ...dense.map(p => `${round1(p.x)},${round1(p.y)}`)].join(" ");
    }
    if (kw === "PATH" || kw === "BRANCH") {
      const tok = tokenize(line.trim());
      const out = [];
      for (let i = 0; i < tok.length; i++) {
        let t = tok[i];
        if (t.toUpperCase() === "OFF") { out.push(t, tok[++i]); continue; }
        if (/^~-?\d/.test(t)) continue;                       // image-frame aim angle
        if (COORD_RE.test(t)) {
          const [x, y] = t.split(",").map(parseFloat);
          const p = map(x, y);
          t = `${round1(p.x)},${round1(p.y)}`;
        }
        out.push(t);
      }
      return out.join(" ");
    }
    if (kw === "STEP") {
      return line.replace(/pos=(-?\d*\.?\d+):(-?\d*\.?\d+)/i, (_, x, y) => {
        const p = map(parseFloat(x), parseFloat(y));
        return `pos=${round1(p.x)}:${round1(p.y)}`;
      });
    }
    return line;
  }).join("\n");
}
