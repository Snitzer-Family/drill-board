// Pixel → rink-feet mapping for photo import. The vision model reports rink
// landmarks and writes the drill in IMAGE PIXEL coordinates; this module fits
// the orientation + scale deterministically and rewrites the DSL text. Pure
// (no DOM, no fetch) so it's node-testable like possession.js.

// Known rink geometry (matches rink.jsx / docs/drill-dsl.md landmark table).
const GOAL_X = [11, 189], BLUE_X = [75, 125], CENTER_X = 100;
const EZ_DOT_X = [45, 155], NZ_DOT_X = [80, 120], DOT_Y = [20.5, 64.5], MID_Y = 42.5;

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
  const xPairs = [];
  for (const p of pts) {
    if (/^(goal_line|net|crease)/.test(p.f)) {
      xPairs.push([p.u, half ? GOAL_X[1] : pickX(p.u, GOAL_X, us("goal_line"), refU)]);
    } else if (p.f.startsWith("blue_line")) {
      xPairs.push([p.u, half ? BLUE_X[1] : pickX(p.u, BLUE_X, us("blue_line"), refU)]);
    } else if (/^center_(line|dot|circle)/.test(p.f)) {
      xPairs.push([p.u, CENTER_X]);
    } else if (p.f.startsWith("endzone")) {
      xPairs.push([p.u, half ? EZ_DOT_X[1] : pickX(p.u, EZ_DOT_X, us("endzone"), refU)]);
    } else if (p.f.startsWith("neutral")) {
      xPairs.push([p.u, half ? NZ_DOT_X[1] : pickX(p.u, NZ_DOT_X, us("neutral"), refU)]);
    }
  }
  const fx = fit1d(xPairs);
  if (!fx || fx.s <= 0) return { error: "need two or more distinct rink landmarks (goal line, blue line, dots…) to orient the diagram" };

  // y correspondences — mid-ice anchors are exact; dots resolve top/bottom
  // against the anchor (or their own pair mean when no anchor is visible).
  const midV = pts.filter(p => /^(net|crease|center_dot|center_circle)/.test(p.f)).map(p => p.v);
  const dotV = pts.filter(p => /^(endzone|neutral)/.test(p.f)).map(p => p.v);
  const anchorV = midV.length ? midV.reduce((a, b) => a + b, 0) / midV.length
    : dotV.length ? dotV.reduce((a, b) => a + b, 0) / dotV.length
    : pts.reduce((a, p) => a + p.v, 0) / pts.length;
  const yPairs = midV.map(v => [v, MID_Y]);
  for (const v of dotV) yPairs.push([v, v < anchorV ? DOT_Y[0] : DOT_Y[1]]);
  let fy = fit1d(yPairs);
  // degenerate / implausible y-fit (all anchors mid-ice, single dot, wild
  // stretch from a misassigned dot) → assume the photo's aspect is honest
  if (!fy || fy.s <= 0 || fy.s / fx.s < 0.4 || fy.s / fx.s > 2.5) {
    fy = { s: fx.s, t: MID_Y - fx.s * anchorV };
  }

  const map = (x, y) => {
    const { u, v } = rot({ x, y });
    return { x: Math.min(200, Math.max(0, fx.s * u + fx.t)), y: Math.min(85, Math.max(0, fy.s * v + fy.t)) };
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
// endzone_circle | neutral_dot. Line features use the midpoint of the drawn
// line. attack: which way the model says the play attacks in the IMAGE —
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

// Landmark snap points (dots + center): a piece the model placed within
// `SNAP_R` feet of one was almost certainly drawn ON it — use the landmark as
// the accurate position rather than the eyeballed pixel.
const SNAP_PTS = [
  [EZ_DOT_X[0], DOT_Y[0]], [EZ_DOT_X[0], DOT_Y[1]], [EZ_DOT_X[1], DOT_Y[0]], [EZ_DOT_X[1], DOT_Y[1]],
  [NZ_DOT_X[0], DOT_Y[0]], [NZ_DOT_X[0], DOT_Y[1]], [NZ_DOT_X[1], DOT_Y[0]], [NZ_DOT_X[1], DOT_Y[1]],
  [CENTER_X, MID_Y],
];
const SNAP_R = 3;
const SNAP_KINDS = /^(player|puck|cone|tire)$/;
function snapPoint(p) {
  for (const [x, y] of SNAP_PTS) {
    if (Math.hypot(p.x - x, p.y - y) <= SNAP_R) return { x, y };
  }
  return p;
}

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
        if (Math.abs(p.x - gx) < 14) p = { x: gx, y: Math.abs(p.y - MID_Y) < 10 ? MID_Y : p.y };
      } else if (SNAP_KINDS.test(kind)) {
        p = snapPoint(p);
      }
      tok[3] = String(round1(p.x)); tok[4] = String(round1(p.y));
      return tok.filter(t => !/^face=/i.test(t)).join(" ");
    }
    if (kw === "PATH" || kw === "BRANCH" || kw === "MARK") {
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
