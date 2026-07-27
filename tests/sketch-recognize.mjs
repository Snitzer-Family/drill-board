import { recognizeSymbol, puckGate, ACCEPT } from '../src/sketch-recognize.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---- deterministic fixture kit (no Math.random — LCG so runs reproduce) ----
const lcg = seed => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
// densely sampled polyline through unit-box waypoints (≈ hand-drawn point spacing)
const poly = (pts, per = 8) => {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    for (let j = i === 1 ? 0 : 1; j <= per; j++) {
      const t = j / per;
      out.push({ x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) });
    }
  }
  return out;
};
const p = (...xy) => { const o = []; for (let i = 0; i < xy.length; i += 2) o.push({ x: xy[i], y: xy[i + 1] }); return o; };
const arcPts = (cx, cy, r, a0, a1, n = 24) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
};
// unit-box strokes → rink feet at (cx,cy) with height `s` ft, then jitter
const place = (strokes, cx, cy, s) =>
  strokes.map(pts => pts.map(q => ({ x: cx + (q.x - 0.5) * s, y: cy + (q.y - 0.5) * s })));
const jitter = (strokes, amp, rnd) =>
  strokes.map(pts => pts.map(q => ({ x: q.x + (rnd() * 2 - 1) * amp, y: q.y + (rnd() * 2 - 1) * amp })));
const drawn = (unit, cx, cy, s, amp, seed) => jitter(place(unit, cx, cy, s), amp, lcg(seed));

// ---- hand-drawn glyph fixtures (unit box, y down) ----
const GLYPHS = {
  X: [poly(p(0, 0, 1, 1)), poly(p(1, 0, 0, 1))],
  O: [arcPts(0.5, 0.5, 0.5, -90, 270)],
  C: [arcPts(0.5, 0.5, 0.5, 60, 300, 20)],
  G: [arcPts(0.5, 0.5, 0.5, 60, 300, 20), poly(p(0.95, 0.7, 0.95, 0.55, 0.55, 0.55), 5)],
  D: [poly(p(0.15, 0, 0.15, 1)), poly(p(0.15, 0, 0.6, 0.04, 0.9, 0.3, 0.9, 0.7, 0.6, 0.96, 0.15, 1), 4)],
  F: [poly(p(0.2, 0, 0.2, 1)), poly(p(0.2, 0, 0.85, 0), 5), poly(p(0.2, 0.5, 0.7, 0.5), 5)],
  W: [poly(p(0, 0, 0.25, 1, 0.5, 0.3, 0.75, 1, 1, 0), 6)],
  L: [poly(p(0.2, 0, 0.2, 1, 0.85, 1), 6)],
  R: [poly(p(0.15, 0, 0.15, 1)), poly(p(0.15, 0, 0.7, 0.05, 0.8, 0.25, 0.7, 0.45, 0.15, 0.5), 4), poly(p(0.4, 0.5, 0.85, 1), 6)],
  '△': [poly(p(0.5, 0, 1, 1, 0, 1, 0.5, 0), 8)],
  '□': [poly(p(0, 0, 1, 0, 1, 1, 0, 1, 0, 0), 8)],
};

// ---- every glyph at 3 scales × 3 rink positions, jittered ----
{
  const spots = [[30, 20], [100, 42], [170, 65]];
  const scales = [3, 5, 7];
  let seed = 7;
  for (const [sym, unit] of Object.entries(GLYPHS)) {
    for (const s of scales) for (const [cx, cy] of spots) {
      const got = recognizeSymbol(drawn(unit, cx, cy, s, 0.04 * s, seed++));
      T(`${sym} @${s}ft (${cx},${cy})`, got && got.sym, sym);
    }
  }
}

// ---- X is stroke-order and stroke-direction invariant (left-handers) ----
{
  const rev = pts => pts.slice().reverse();
  const [a, b] = place(GLYPHS.X, 60, 40, 5);
  T('X order ab', recognizeSymbol([a, b])?.sym, 'X');
  T('X order ba', recognizeSymbol([b, a])?.sym, 'X');
  T('X reversed strokes', recognizeSymbol([rev(a), rev(b)])?.sym, 'X');
  T('X mixed direction', recognizeSymbol([rev(b), a])?.sym, 'X');
}

// ---- NO rotation invariance: a 90°-rotated F must not read as F ----
{
  const rot = strokes => strokes.map(pts => pts.map(q => ({ x: q.y, y: 1 - q.x })));
  const got = recognizeSymbol(drawn(rot(GLYPHS.F), 100, 42, 5, 0.2, 11));
  T('rotated F is not F', got?.sym === 'F', false);
}

// ---- O/C/G/D discrimination, incl. adversarial neighbours ----
{
  // nearly-closed C (30° gap): whatever it reads as, it must not read as C —
  // the closure gate hands the call to O territory
  const nearC = [arcPts(0.5, 0.5, 0.5, 15, 345, 24)];
  T('near-closed C is not C', recognizeSymbol(drawn(nearC, 80, 40, 5, 0.1, 13))?.sym === 'C', false);
  // a slightly bowed D spine is still a D (leftRMS tolerance)
  const bowD = [poly(p(0.15, 0, 0.18, 0.5, 0.15, 1), 6),
                poly(p(0.15, 0, 0.6, 0.04, 0.9, 0.3, 0.9, 0.7, 0.6, 0.96, 0.15, 1), 4)];
  T('bowed-spine D is D', recognizeSymbol(drawn(bowD, 80, 40, 5, 0.1, 17))?.sym, 'D');
  // G's tail is what separates it from C; C must not steal it
  T('G not C', recognizeSymbol(drawn(GLYPHS.G, 50, 30, 6, 0.12, 19))?.sym, 'G');
  // O must not read as D (no straight spine)
  T('O not D', recognizeSymbol(drawn(GLYPHS.O, 50, 30, 6, 0.12, 23))?.sym, 'O');
}

// ---- plain annotation ink must NOT read as a symbol (the negative band) ----
{
  T('horizontal line → null', recognizeSymbol([poly(p(60, 40, 66, 40.3))]), null);
  T('diagonal line → null', recognizeSymbol([poly(p(60, 40, 64, 44))]), null);
  T('vee → null', recognizeSymbol([poly(p(60, 40, 62.5, 44, 65, 40), 8)]), null);
  T('s-curve → null', recognizeSymbol([arcPts(61.5, 41.5, 1.5, 90, 270).concat(arcPts(61.5, 44.5, 1.5, -90, 90))]), null);
  T('hook → null', recognizeSymbol([arcPts(62, 42, 2, 180, 330)]), null);
}

// ---- garbage scribble → null (falls back to plain ink) ----
{
  const rnd = lcg(29);
  const pts = [];
  let x = 100, y = 42;
  for (let i = 0; i < 30; i++) {
    x += (rnd() * 2 - 1) * 2.5; y += (rnd() * 2 - 1) * 2.5;
    pts.push({ x, y });
  }
  T('scribble → null', recognizeSymbol([pts]), null);
}

// ---- puck pre-gate ----
{
  T('tiny dot is puck', puckGate(place(GLYPHS.O, 60, 40, 1)), true);
  const rnd = lcg(31);
  const scr = [];
  let x = 60, y = 40;
  for (let i = 0; i < 40; i++) { x = 60 + (rnd() * 2 - 1) * 1.4; y = 40 + (rnd() * 2 - 1) * 1.4; scr.push({ x, y }); }
  T('dense scribble is puck', puckGate([scr]), true);
  T('a 5ft F is not a puck', puckGate(place(GLYPHS.F, 60, 40, 5)), false);
  T('a 5ft O is not a puck', puckGate(place(GLYPHS.O, 60, 40, 5)), false);
}

console.log(`\n${pass} passed, ${fail} failed  (accept threshold ${ACCEPT})`);
process.exit(fail ? 1 : 0);
