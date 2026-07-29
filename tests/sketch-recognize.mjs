import {
  recognizeSymbol, puckGate, classifyPenGroup, ACCEPT, explainSymbol, scoreAll,
  GUARDS, GUARD_BANDS, SYMBOL_MAX, SYMBOL_MAX_PX,
} from '../src/sketch-recognize.js';

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

/* ================ classifyPenGroup ================ */

const stroke = pts => ({ pts });
const strokesOf = unitOrPlaced => unitOrPlaced.map(stroke);
const kinds = ops => ops.map(o => o.op);

// ---- a lone X becomes a player; its trailing long stroke becomes its route ----
{
  const x = drawn(GLYPHS.X, 30, 30, 5, 0.2, 41);
  const route = poly(p(31, 32, 50, 40, 70, 35), 20);
  const ops = classifyPenGroup([...strokesOf(x), stroke(route)]);
  T('X+route kinds', kinds(ops), ['player', 'route']);
  T('X+route sym', ops[0].sym, 'X');
  T('X+route ref wiring', ops[1].to, { ref: 0 });
  T('X+route fwd', ops[1].bwd, false);
}

// ---- zigzag long stroke = backward skating; smooth long stroke is not ----
{
  const zig = [];
  for (let i = 0; i <= 6; i++) zig.push({ x: 40 + i * 5, y: 40 + (i % 2 ? 4 : -4) });
  const ops = classifyPenGroup([stroke(poly(zig, 6))], { players: [{ id: 'P1', x: 40, y: 40 }] });
  T('zigzag → bwd route', kinds(ops), ['route']);
  T('zigzag bwd flag', ops[0].bwd, true);
  const smooth = classifyPenGroup([stroke(poly(p(40, 40, 55, 34, 70, 44), 20))],
    { players: [{ id: 'P1', x: 40, y: 40 }] });
  T('smooth route not bwd', smooth[0] && smooth[0].bwd, false);
}

// ---- a stroke starting at a route's TIP extends that route ----
{
  const ctx = { players: [{ id: 'P1', x: 40, y: 40, end: { x: 70, y: 40 }, hasPath: true }] };
  const ops = classifyPenGroup([stroke(poly(p(71, 41, 95, 55, 120, 50), 20))], ctx);
  T('stroke from the tip → route', kinds(ops), ['route']);
  T('...marked as an extension', ops[0].extend, true);
  T('...bound to that player', ops[0].to, { id: 'P1' });
  // starting at the player's SPOT instead is not an extension — that player
  // already has a route, so there is nothing to start
  const atSpot = classifyPenGroup([stroke(poly(p(41, 41, 60, 70, 90, 75), 20))], ctx);
  T('stroke from an occupied spot stays ink', kinds(atSpot), ['mark']);
  // a free player nearer than the tip still wins the stroke
  const both = { players: [
    { id: 'P1', x: 40, y: 40, end: { x: 70, y: 40 }, hasPath: true },
    { id: 'P2', x: 72, y: 44, end: { x: 72, y: 44 }, hasPath: false }] };
  const near = classifyPenGroup([stroke(poly(p(72, 44, 100, 60, 130, 55), 20))], both);
  T('nearer free player beats the tip', near[0] && [near[0].to, !!near[0].extend], [{ id: 'P2' }, false]);
}

// ---- a route with no nearby skater stays ink ----
{
  const ops = classifyPenGroup([stroke(poly(p(100, 20, 120, 30, 140, 25), 20))]);
  T('orphan route → mark', kinds(ops), ['mark']);
}

// ---- dashed line between two players = a pass; direction follows draw order ----
{
  const dashes = [];
  for (let i = 0; i < 4; i++) dashes.push(stroke(poly(p(62 + i * 4, 41 + i, 64.5 + i * 4, 41.6 + i), 4)));
  const ctx = { players: [{ id: 'P1', x: 60, y: 40 }, { id: 'P2', x: 80, y: 46 }] };
  const ops = classifyPenGroup(dashes, ctx);
  T('dashes → pass', kinds(ops), ['pass']);
  T('pass from P1', ops[0] && ops[0].from, { id: 'P1' });
  T('pass to P2', ops[0] && ops[0].to, { id: 'P2' });
  // same dashes with nobody around stay ink
  T('orphan dashes → marks', kinds(classifyPenGroup(dashes)), ['mark', 'mark', 'mark', 'mark']);
}

// ---- a pass releases from the END of the passer's freshly drawn route ----
{
  const x = drawn(GLYPHS.X, 30, 30, 5, 0.2, 43);
  const route = poly(p(31, 32, 45, 40, 60, 40), 20);
  const dashes = [];
  for (let i = 0; i < 4; i++) dashes.push(stroke(poly(p(62 + i * 4, 41, 64.5 + i * 4, 41), 4)));
  const ctx = { players: [{ id: 'P9', x: 80, y: 42 }] };
  const ops = classifyPenGroup([...strokesOf(x), stroke(route), ...dashes], ctx);
  T('X+route+pass kinds', kinds(ops), ['player', 'route', 'pass']);
  T('pass from the drawn X', ops[2] && ops[2].from, { ref: 0 });
  T('pass to ctx receiver', ops[2] && ops[2].to, { id: 'P9' });
}

// ---- straight solo stroke into the net = shot; net-bound dashes too ----
{
  const ctx = { players: [{ id: 'P1', x: 150, y: 40 }], nets: [{ id: 'N1', x: 189, y: 42.5 }] };
  const ops = classifyPenGroup([stroke(poly(p(151, 40, 187, 42), 20))], ctx);
  T('stroke into net → shot', kinds(ops), ['shot']);
  T('shot by P1 at N1', ops[0] && [ops[0].by, ops[0].net], [{ id: 'P1' }, 'N1']);
  const dashes = [];
  for (let i = 0; i < 4; i++) dashes.push(stroke(poly(p(152 + i * 9, 40.5 + i * 0.5, 157 + i * 9, 40.8 + i * 0.5), 4)));
  T('dashed shot', kinds(classifyPenGroup(dashes, ctx)), ['shot']);
  // a curvy drive to the net is a route, not a shot
  const curvy = poly(p(151, 40, 160, 25, 175, 30, 186, 41), 24);
  T('curvy drive → route', kinds(classifyPenGroup([stroke(curvy)], ctx)), ['route']);
}

// ---- tiny scribble on a player = puck on their stick ----
{
  const rnd = lcg(47);
  const scr = [];
  for (let i = 0; i < 30; i++) scr.push({ x: 60.7 + (rnd() * 2 - 1) * 0.7, y: 40.5 + (rnd() * 2 - 1) * 0.7 });
  const ops = classifyPenGroup([stroke(scr)], { players: [{ id: 'P1', x: 60, y: 40 }] });
  T('scribble → puck', kinds(ops), ['puck']);
  T('puck on P1', ops[0] && ops[0].on, { id: 'P1' });
  const far = classifyPenGroup([stroke(scr.map(q => ({ x: q.x + 20, y: q.y })))],
    { players: [{ id: 'P1', x: 60, y: 40 }] });
  T('loose puck has no carrier', far[0] && far[0].on, null);
}

// ---- a puck dot + a dashed pass in one burst: the puck op must precede the
//      pass op, so materialization threads ONE puck through the pass ----
{
  const rnd = lcg(71);
  const dot = [];
  for (let i = 0; i < 20; i++) dot.push({ x: 60.5 + (rnd() * 2 - 1) * 0.6, y: 40.4 + (rnd() * 2 - 1) * 0.6 });
  const dashes = [];
  for (let i = 0; i < 4; i++) dashes.push(stroke(poly(p(62 + i * 4, 41, 64.5 + i * 4, 41), 4)));
  const ctx = { players: [{ id: 'P1', x: 60, y: 40 }, { id: 'P2', x: 80, y: 42 }] };
  const ops = classifyPenGroup([stroke(dot), ...dashes], ctx);
  T('puck before pass', kinds(ops), ['puck', 'pass']);
  T('puck rides P1', ops[0] && ops[0].on, { id: 'P1' });
}

// ---- glyph split: L + W side by side is ONE player "LW"; X X is two ----
{
  const lw = [...place(GLYPHS.L, 60, 40, 5), ...place(GLYPHS.W, 66, 40, 5)];
  const ops = classifyPenGroup(strokesOf(jitter(lw, 0.15, lcg(53))));
  T('LW is one player', kinds(ops), ['player']);
  T('LW sym', ops[0] && ops[0].sym, 'LW');
  const xx = [...place(GLYPHS.X, 60, 40, 4), ...place(GLYPHS.X, 68, 40, 4)];
  const ops2 = classifyPenGroup(strokesOf(jitter(xx, 0.15, lcg(59))));
  T('XX is two players', kinds(ops2), ['player', 'player']);
}

// ---- arrowheads: an in-stroke flick is stripped off the route's tail, and a
//      separate tiny flick at a fresh route's end is consumed outright ----
{
  const x = drawn(GLYPHS.X, 30, 30, 5, 0.2, 73);
  const arrowRoute = poly(p(31, 32, 50, 40, 70, 35, 67.5, 33.2), 16);
  const ops = classifyPenGroup([...strokesOf(x), stroke(arrowRoute)]);
  T('arrow route kinds', kinds(ops), ['player', 'route']);
  const end = ops[1] && ops[1].raw[ops[1].raw.length - 1];
  T('arrowhead stripped from tail', end ? Math.hypot(end.x - 70, end.y - 35) < 1.8 : null, true);

  const route = poly(p(31, 32, 50, 40, 70, 35), 20);
  const flick = [stroke(poly(p(68, 33.5, 70, 35), 3)), stroke(poly(p(68.4, 36.6, 70, 35), 3))];
  const ops2 = classifyPenGroup([...strokesOf(x), stroke(route), ...flick]);
  // the flick strokes are consumed (as one drop or two — either is fine);
  // what matters is a player, its route, and NO leftover ink
  T('separate arrow flick consumed', kinds(ops2).filter(k => k !== 'drop'), ['player', 'route']);
  T('every flick stroke dropped',
    ops2.filter(o => o.op === 'drop').flatMap(o => o.srcs).sort(), [3, 4]);
  // the same flick with no route nearby is honest ink
  T('orphan flick stays ink', kinds(classifyPenGroup(flick)), ['mark', 'mark']);
}

// ---- small triangle = cone; big circle = zone overlay shape ----
{
  const ops = classifyPenGroup(strokesOf(drawn(GLYPHS['△'], 100, 42, 4, 0.15, 61)));
  T('small △ → cone', kinds(ops), ['cone']);
  const big = classifyPenGroup(strokesOf(drawn(GLYPHS.O, 100, 42, 18, 0.5, 67)));
  T('big ○ → shape', kinds(big), ['shape']);
  T('big ○ is a circle', big[0] && big[0].shape, 'circle');
}

// ---- …but the SAME big loop drawn off a player is a swing route, not an
//      overlay. The closed-shape test used to run before route attachment and
//      never looked at the board, so a circle-back got stolen. Identical ink
//      throughout — only the roster changes. ----
{
  const loop = strokesOf(drawn(GLYPHS.O, 100, 42, 18, 0.5, 67));   // starts at (100, 33)
  const at = players => classifyPenGroup(loop, { players });
  const onIt = at([{ id: 'P1', x: 100, y: 33 }]);
  T('loop off a player → route', kinds(onIt), ['route']);
  T('...bound to that player', onIt[0].to, { id: 'P1' });
  T('...a fresh route, not an extension', onIt[0].extend, false);
  // a loop drawn AROUND a player starts on its own rim, a full radius away
  T('loop around a player is still a shape', kinds(at([{ id: 'P1', x: 100, y: 42 }])), ['shape']);
  // and off a route's tip it continues that route
  const tip = at([{ id: 'P1', x: 60, y: 70, end: { x: 100, y: 33 }, hasPath: true }]);
  T('loop off a route tip → route', kinds(tip), ['route']);
  T('...marked as an extension', tip[0].extend, true);
}

// ---- the swing rule is size-gated: below overlayMin a ring is a player token,
//      and dropping an O beside an existing player must keep working ----
{
  const beside = classifyPenGroup(strokesOf(drawn(GLYPHS.O, 100, 42, 5, 0.15, 313)),
    { players: [{ id: 'P1', x: 100, y: 39.5 }] });   // player right on the ring's start
  T('small O beside a player is a player', kinds(beside), ['player']);
  // a 20ft ring at phone scale measures 120px — wide enough to be an overlay,
  // still under the 130px symbol cap, so it reaches the shape branch by the
  // SYMBOL path. The split has to send it down the route pipeline too.
  const CAP = { pxFt: 0.236 };
  const mid = strokesOf(drawn(GLYPHS.O, 100, 42, 20, 0.5, 317));   // starts at (100, 32)
  T('mid-size loop with nobody near → shape', kinds(classifyPenGroup(mid, CAP)), ['shape']);
  const off = classifyPenGroup(mid, { ...CAP, players: [{ id: 'P1', x: 100, y: 32 }] });
  T('mid-size loop off a player → route', kinds(off), ['route']);
  T('...bound to that player', off[0] && off[0].to, { id: 'P1' });
}

// ---- finger-sloppy rings: a 290° open loop (35-40% gap) is still an O ----
{
  const sloppy = [arcPts(0.5, 0.5, 0.5, -55, 235, 22)];
  T('open ring @5ft is O', recognizeSymbol(drawn(sloppy, 60, 40, 5, 0.15, 101))?.sym, 'O');
  const ops = classifyPenGroup(strokesOf(drawn(sloppy, 100, 42, 18, 0.6, 103)), { pxFt: 0.5 });
  T('phone open ring is a player O', kinds(ops), ['player']);
  // a true C (240° sweep) still reads C, not O
  T('C survives looser guards', recognizeSymbol(drawn(GLYPHS.C, 60, 40, 5, 0.15, 107))?.sym, 'C');
}

// ---- srcs: every op reports the input strokes it consumed, and a sparse
//      RDP'd leg (a reclaimed ink mark) still completes an X ----
{
  const x = drawn(GLYPHS.X, 30, 30, 5, 0.2, 109);
  const ops = classifyPenGroup(strokesOf(x));
  T('X srcs', ops[0] && ops[0].srcs.slice().sort(), [0, 1]);
  // leg 1 as a bare 2-point control-point line (what a committed mark keeps
  // after RDP), leg 2 freshly drawn
  const sparse = [{ x: 27.5, y: 27.5 }, { x: 32.5, y: 32.5 }];
  const ops2 = classifyPenGroup([stroke(sparse), ...strokesOf([x[1]])]);
  T('sparse mark + fresh stroke = X', kinds(ops2), ['player']);
  T('merge consumed both', ops2[0] && ops2[0].srcs.slice().sort(), [0, 1]);
}

// ---- REAL captured strokes, lifted verbatim off a portrait phone board
//      (window.__pen dump, pxFt 0.236 — the rink rotates, so 200ft spans the
//      844px height). These carry the app's true capture decimation: points
//      land ~1.1ft apart, which clips a small ring's tail and inflates its
//      closure. Synthetic fixtures are too dense to catch that class of bug,
//      so these stay as the ground truth. ----
// module scope, not block: the trace suites at the foot of this file re-use
// these as their ground truth, and a real capture is worth more there than
// another synthetic one
const P = a => a.map(([x, y]) => ({ x, y }));
const CAP = { pxFt: 0.236 };
const REAL = {
    X13: [[[38,25.9],[38.7,26.8],[39.7,27.7],[40.5,28.6],[41.3,29.4],[42.3,30.1],[43,30.9],[43.8,31.8],[44.6,32.7],[45.6,33.6],[46.3,34.4]],[[47.1,25.9],[46.1,26.8],[45.3,27.7],[44.6,28.6],[43.5,29.4],[42.8,30.3],[41.8,31.2],[41,32],[40.3,32.9],[39.2,33.6],[38.5,34.4]]],
    ring6: [[[61.8,57.5],[62.5,58.4],[63,59.5],[62.8,60.8],[62.3,61.9],[61.3,62.8],[60,63],[58.7,62.8],[57.7,62.1],[57.2,61],[57,59.9],[57.2,58.8],[58,58]]],
    ring12: [[[103.5,25.1],[104.3,25.9],[105.1,26.8],[105.6,27.9],[105.8,29],[106.1,30.1],[105.8,31.2],[105.6,32.3],[105.1,33.3],[104.3,34.2],[103.3,34.9],[102.3,35.5],[101.3,36],[100,36],[98.7,36],[97.7,35.5],[96.7,34.9],[95.7,34.2],[94.9,33.3],[94.4,32.3],[94.2,31.2],[93.9,30.1],[94.2,29],[94.4,27.9],[94.9,26.8],[95.7,25.9],[96.5,25.1]]],
    X26: [[[140,20.1],[140.8,20.9],[141.8,21.6],[142.5,22.4],[143.3,23.3],[144.1,24.2],[145.1,24.8],[145.8,25.7],[146.6,26.6],[147.3,27.5],[148.4,28.3],[149.4,29.2],[150.1,30.1],[150.9,30.9],[151.6,31.8],[152.7,32.5],[153.4,33.3],[154.2,34.2],[154.9,35.1],[155.9,36],[157,36.8],[157.7,37.7]],[[158,20.1],[157.2,20.9],[156.2,21.8],[155.4,22.7],[154.4,23.5],[153.4,24.4],[152.7,25.3],[151.9,26.2],[151.1,27],[150.1,27.7],[149.4,28.6],[148.6,29.4],[147.8,30.3],[146.8,31.2],[145.8,32],[145.1,32.9],[144.3,33.8],[143.3,34.7],[142.5,35.5],[141.8,36.4],[140.8,37.3]]],
};
const real = k => REAL[k].map(s => stroke(P(s)));
{
  T('real 13ft X → player', kinds(classifyPenGroup(real('X13'), CAP)), ['player']);
  T('real 26ft X → player', kinds(classifyPenGroup(real('X26'), CAP)), ['player']);
  T('real 6ft ring → player O', kinds(classifyPenGroup(real('ring6'), CAP)), ['player']);
  T('real 6ft ring sym', classifyPenGroup(real('ring6'), CAP)[0].sym, 'O');
  T('real 12ft ring → player O', kinds(classifyPenGroup(real('ring12'), CAP)), ['player']);
}

// ---- THE FILL-STRETCH CASE: a real Apple Pencil circle off an iPad, drawn
//      perfectly round on screen but captured as a 10.4ft × 6.4ft ellipse
//      because the rink is stretched to fill the viewport. Analyzed in raw
//      feet it scores O:0.365 (a reject — this shipped broken through v6.25);
//      in screen units it scores 0.792. ----
{
  const IPAD = { pxFtX: 0.168, pxFtY: 0.103 };
  const ring = [[100.6,63.1],[101.7,63.4],[102.3,64.4],[103.2,65.2],[103.1,66.3],[102.7,67.4],[101.9,68.3],[100.8,68.6],[99.8,69.2],[98.6,69.4],[97.5,69.3],[96.3,69.2],[95.1,68.9],[94.3,68.2],[93.3,67.5],[92.8,66.5],[93,65.3],[93.4,64.3],[94.4,63.7],[95.4,63]]
    .map(([x, y]) => ({ x, y }));
  T('stretched Pencil ring → player', kinds(classifyPenGroup([stroke(ring)], IPAD)), ['player']);
  T('stretched Pencil ring is an O', classifyPenGroup([stroke(ring)], IPAD)[0].sym, 'O');
  // the same ink WITHOUT aspect info stays unrecognized — proof the fix is the
  // screen-space analysis and not a loosened threshold
  T('same ink, no view scale → ink', kinds(classifyPenGroup([stroke(ring)])), ['mark']);
  // a player op still reports FEET, positioned on the drawn ink
  const o = classifyPenGroup([stroke(ring)], IPAD)[0];
  T('op position is in feet', Math.abs(o.x - 98) < 2 && Math.abs(o.y - 66.3) < 2, true);
}

// ---- A DENSELY FILLED BOARD, the way a coach actually loads the ice: small
//      symbols (~30px) packed with ~12px gaps. Every one must convert. Before
//      the grouping rewrite this scored 6 players and 92 ink marks out of 72
//      symbols — neighbours merged into blobs that failed as a unit, and a
//      word-size cap could even orphan one leg of an X from the other. ----
{
  const IPAD = { pxFtX: 0.168, pxFtY: 0.108 };            // landscape, fill-stretched
  const toFt = ([x, y]) => ({ x: x * IPAD.pxFtX, y: y * IPAD.pxFtY });   // px → rink feet
  const dense = (px, n = 20) => {                          // px polyline → captured stroke
    const out = [];
    for (let i = 1; i < px.length; i++)
      for (let k = i === 1 ? 0 : 1; k <= n; k++)
        out.push([px[i - 1][0] + ((px[i][0] - px[i - 1][0]) * k) / n,
                  px[i - 1][1] + ((px[i][1] - px[i - 1][1]) * k) / n]);
    return stroke(out.map(toFt));
  };
  const R = 15, PITCH = 42;                                // 30px symbols, 12px gaps
  const xAt = (cx, cy) => [dense([[cx - R, cy - R], [cx + R, cy + R]]),
                           dense([[cx + R, cy - R], [cx - R, cy + R]])];
  const oAt = (cx, cy) => {
    const p = [];
    for (let i = 0; i <= 22; i++) {
      const a = ((-58 + (296 * i) / 22) * Math.PI) / 180;
      p.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    return [dense(p, 2)];
  };
  const grid = (make, x0, y0) => {
    const out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(...make(x0 + c * PITCH, y0 + r * PITCH));
    return out;
  };
  const xs = classifyPenGroup(grid(xAt, 300, 200), IPAD);
  T('9 packed X\'s → 9 players', kinds(xs), Array(9).fill('player'));
  T('every packed X reads as X', xs.every(o => o.sym === 'X'), true);
  const os = classifyPenGroup(grid(oAt, 300, 200), IPAD);
  T('9 packed O\'s → 9 players', kinds(os), Array(9).fill('player'));
  T('every packed O reads as O', os.every(o => o.sym === 'O'), true);
  // mixed, drawn in one burst — and no stray becomes a route on a neighbour
  const mixed = classifyPenGroup([...grid(xAt, 300, 200), ...grid(oAt, 560, 200)], IPAD);
  T('18 packed symbols, none lost', kinds(mixed).filter(k => k === 'player').length, 18);
  T('no ink, no bogus routes', kinds(mixed).every(k => k === 'player'), true);
}

// ---- A REAL finger-drawn circle off a ZOOMED iPhone (2.8x). $P scored it
//      O:0.436 but D:0.561 — a round loop losing to the letter D, because the
//      only thing guarding D was "the left edge is straightish", which is true
//      of a circle over a short span. It now needs a real SPINE (same leftmost
//      x at top, middle and bottom), and rings are decided geometrically. ----
{
  const ZOOM = { pxFtX: 0.0871, pxFtY: 0.0750 };
  const ring = [[106.53,44.68],[106.8,44.45],[107.06,44.23],[107.32,44.08],[107.58,44],[107.84,43.93],[108.1,43.85],[108.36,43.85],[108.63,43.85],[108.89,43.93],[109.15,44],[109.41,44.15],[109.67,44.3],[109.85,44.53],[110.02,44.75],[110.19,45.05],[110.28,45.35],[110.28,45.65],[110.19,45.95],[110.11,46.25],[109.93,46.55],[109.76,46.78],[109.5,46.93],[109.24,47.08],[108.97,47.23],[108.71,47.23],[108.45,47.3],[108.19,47.3],[107.93,47.23],[107.67,47.23],[107.41,47.15],[107.14,47],[106.88,46.78],[106.62,46.55],[106.45,46.33]]
    .map(([x, y]) => ({ x: x / ZOOM.pxFtX, y: y / ZOOM.pxFtY }));   // → screen units
  T('zoomed finger circle is an O', recognizeSymbol([ring])?.sym, 'O');
  T('...and not a D', recognizeSymbol([ring])?.sym === 'D', false);
  T('zoomed circle → player', kinds(classifyPenGroup([stroke(ring.map(p => ({
    x: p.x * ZOOM.pxFtX, y: p.y * ZOOM.pxFtY })))], ZOOM)), ['player']);
  // the letter D must still be a D — the new spine test is what separates them
  T('D survives the spine test', recognizeSymbol(drawn(GLYPHS.D, 60, 40, 6, 0.12, 211))?.sym, 'D');
  T('bowed D still reads D', recognizeSymbol(drawn(GLYPHS.D, 60, 40, 9, 0.25, 223))?.sym, 'D');
}

// ---- THE PEN FLICK: coaches finish a circle by flicking outward, and that
//      little tail sits far off the ring — it dropped a clean O from 0.899 to
//      0.199 (unrecognized). Every circle on Nate's board had one. ----
{
  const hooked = (r, sweep, tail) => {
    const o = [], n = 26;
    for (let i = 0; i <= n; i++) {
      const a = ((-60 + (sweep * i) / n) * Math.PI) / 180;
      o.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
    }
    const l = o[o.length - 1];
    for (let k = 1; k <= 6; k++) o.push({ x: l.x + k * tail * 1.2, y: l.y + k * tail });
    return o;
  };
  [['small', 1.5], ['medium', 2.5], ['long', 4], ['huge', 6]].forEach(([lbl, t]) =>
    T(`circle with a ${lbl} flick is an O`, recognizeSymbol([hooked(15, 300, t)])?.sym, 'O'));
  T('nearly-closed ring + flick is an O', recognizeSymbol([hooked(15, 340, 2.5)])?.sym, 'O');
  // the letters that a too-eager tail-trim would swallow must survive: a C is
  // a 240° arc whether or not you trim it, and G keeps its bar
  T('C not swallowed by tail-trim', recognizeSymbol(drawn(GLYPHS.C, 60, 40, 6, 0.12, 307))?.sym, 'C');
  T('G not swallowed by tail-trim', recognizeSymbol(drawn(GLYPHS.G, 60, 40, 7, 0.12, 311))?.sym, 'G');
}

// ---- BLOBBY circles: a coach's "circle" is often a squarish 4- or 5-lobed
//      loop finished with a hook that curls back inward. Radial spread rejects
//      those (0.15-0.25 against a 0.11 bar), so ring-ness is judged by enclosed
//      area (isoperimetric circularity) after trimming the tail, and squares /
//      triangles are held out by the sharpest bend rather than corner counts. ----
{
  const blob = (lobes, wobble, tailLen, inward) => {
    const pts = [], R = 20;
    for (let i = 0; i <= lobes * 6; i++) {
      const t = (i / (lobes * 6)) * Math.PI * 2 * 0.92 - 1.0;
      const k = 1 + wobble * Math.cos(lobes * t);
      pts.push({ x: 100 + R * k * Math.cos(t), y: 100 + R * k * Math.sin(t) * 0.95 });
    }
    const l = pts[pts.length - 1], pv = pts[pts.length - 3];
    const dx = l.x - pv.x, dy = l.y - pv.y, m = Math.hypot(dx, dy) || 1;
    for (let k = 1; k <= tailLen; k++)
      pts.push({ x: l.x + (dx / m) * k * 2 * (inward ? -0.4 : 1) + (inward ? -k * 1.6 : 0),
                 y: l.y + (dy / m) * k * 2 + (inward ? -k * 0.6 : 0) });
    return pts;
  };
  // NB the 5-lobe case is deliberately mild. Cranked up it grows five sharp
  // corners and is honestly a pentagon, not a circle — real phone circles
  // measure 1-2 corners (see the captured-strokes block below), so an
  // exaggerated fixture was testing a shape nobody draws.
  [['round loop + tail', blob(20, 0.02, 6, false)],
   ['4-lobe blob + tail', blob(4, 0.10, 6, false)],
   ['4-lobe blob + inward hook', blob(4, 0.10, 7, true)],
   ['5-lobe blob + inward hook', blob(5, 0.06, 7, true)],
   ['squarish blob + inward hook', blob(4, 0.16, 8, true)],
  ].forEach(([lbl, pts]) => T(`${lbl} is an O`, recognizeSymbol([pts])?.sym, 'O'));

  // …and the shapes that must NOT be swept up by a looser circle test
  T('square is not an O', recognizeSymbol(drawn(GLYPHS['□'], 60, 40, 6, 0.1, 401))?.sym, '□');
  T('triangle is not an O', recognizeSymbol(drawn(GLYPHS['△'], 60, 40, 6, 0.1, 409))?.sym, '△');
  T('C is not an O', recognizeSymbol(drawn(GLYPHS.C, 60, 40, 6, 0.1, 419))?.sym, 'C');
  T('D is not an O', recognizeSymbol(drawn(GLYPHS.D, 60, 40, 6, 0.1, 421))?.sym, 'D');
}

// ---- REAL X's off Nate's phone (pasted from the pen's Copy-diagnostics
//      button). Three X's drawn one at a time at 3x zoom on a 1.60-aspect
//      view; $P scored them 0.213 / 0.617 / 0.293 against a 0.55 bar, so two
//      of three were thrown away — one leg even became a route on a
//      neighbouring player. Hand-drawn X's have unequal legs, curved starts
//      and an off-centre crossing, which template matching punishes; crossing
//      geometry is what a person actually reads. ----
{
  const CTX = { pxFtX: 0.11554, pxFtY: 0.072095 };
  const S = [
    [[143.21,74.67],[143.91,75.44],[144.95,76.2],[146.22,76.97],[147.33,77.67],[148.18,78.18],[148.53,78.39]],
    [[142.94,78.22],[142.63,77.55],[142.63,77],[142.9,76.47],[143.64,75.92],[144.68,75.32],[146.02,74.71],[147.45,74.14],[148.57,73.61]],
    [[133.2,74.79],[133.85,75.12],[134.78,75.65],[135.93,76.3],[137.24,77],[138.32,77.62],[139.09,78.15],[139.28,78.34]],
    [[134.08,78.46],[134.12,77.45],[134.55,77.02],[135.28,76.56],[136.28,76.11],[137.4,75.65],[138.44,75.27],[138.82,75.1]],
    [[135.86,68.23],[135.93,68.49],[136.51,69.12],[137.59,69.98],[138.82,70.99],[139.98,72],[140.67,72.67]],
    [[135.97,73.1],[136.01,72.46],[136.36,71.85],[137.36,70.92],[138.67,69.91],[140.13,68.99],[141.56,68.25],[142.75,67.72],[143.17,67.58]],
  ].map(s => s.map(([x, y]) => ({ x, y })));
  const ops = classifyPenGroup(S.map(pts => stroke(pts)), CTX);
  T('all 3 real phone X\'s convert', kinds(ops), ['player', 'player', 'player']);
  T('...and every one reads X', ops.every(o => o.sym === 'X'), true);
  // the joins that must NOT be read as a crossing: V and L meet at an END,
  // F's bar starts ON the spine, D's spine and bowl never cross
  const line = (a, b, n = 12) => stroke(Array.from({ length: n + 1 }, (_, i) =>
    ({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n })));
  T('V is not an X', kinds(classifyPenGroup([line([0, 0], [10, 20]), line([10, 20], [20, 0])])).includes('player'), false);
  T('L is not an X', kinds(classifyPenGroup([line([0, 0], [0, 20]), line([0, 20], [15, 20])])).includes('player'), false);
  T('T-join is not an X', kinds(classifyPenGroup([line([10, 0], [10, 20]), line([10, 10], [25, 10])])).includes('player'), false);
  T('D still reads D', recognizeSymbol(drawn(GLYPHS.D, 60, 40, 6, 0.12, 503))?.sym, 'D');
}

// ---- NINE REAL CIRCLES off Nate's board (pasted from Copy diagnostics),
//      drawn small and quick: 16-26px across, captured with only 10-17 points.
//      Four of nine converted before. They fell to the sharpest-turn gate,
//      which is meaningless at this sampling — resampling 10 points up to 28
//      puts several samples along each chord and reports every bend as 95-140°.
//      A polygon-vs-curve test replaced it: a square collapses to 5 vertices
//      under fine simplification and a triangle to 4, while these keep 6-11;
//      corners then separate them outright (square 4, triangle 3, these 1-2). ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.144804 };
  const S = [
    [[123.74,14.48],[125.72,13.9],[125.9,12.74],[125.36,11.87],[124.82,11.73],[123.38,11.73],[122.3,12.45],[121.76,13.32],[121.58,13.76],[121.76,14.91],[122.48,15.64],[123.38,15.78],[124.82,14.91],[125.36,14.19],[125.72,13.76]],
    [[124.1,20.56],[125.36,18.97],[124.82,18.68],[124.1,18.53],[123.56,18.53],[122.84,18.82],[121.94,19.69],[121.76,20.71],[122.3,21.58],[122.84,22.01],[124.1,22.3],[124.82,22.16],[125.54,21.58],[125.9,20.85],[126.26,20.13],[126.44,19.69]],
    [[125.18,28.82],[126.08,28.09],[123.92,27.37],[123.38,27.37],[122.84,27.51],[122.66,28.09],[123.02,28.67],[123.74,29.11],[124.82,29.11],[125.54,28.38],[125.72,27.66]],
    [[123.38,36.06],[124.64,35.91],[125,34.61],[124.28,33.74],[123.74,33.59],[123.02,33.59],[121.4,34.75],[121.22,35.33],[121.22,35.77],[121.22,36.2],[121.58,36.64],[121.94,36.93],[123.02,37.07],[124.28,36.35],[124.82,35.48]],
    [[123.56,41.41],[124.82,40.55],[124.1,40.11],[122.84,39.68],[121.58,39.82],[121.22,40.11],[121.04,40.55],[121.04,40.98],[121.04,41.41],[121.4,41.85],[122.3,42.43],[123.56,42.57],[123.92,42.28],[124.46,41.85],[124.64,41.27]],
    [[123.38,48.36],[124.1,47.79],[123.2,46.48],[122.48,46.19],[121.94,46.19],[121.22,46.34],[120.86,46.63],[120.5,47.06],[120.32,47.93],[121.04,48.8],[121.94,49.38],[123.02,49.23],[123.92,48.22],[124.28,47.64]],
    [[122.48,56.47],[123.56,54.88],[122.84,54.01],[122.48,53.72],[121.76,53.72],[120.86,54.01],[120.5,55.03],[120.68,55.89],[121.22,56.47],[121.76,56.62],[122.3,56.62],[123.38,55.89],[123.92,55.46]],
    [[121.76,63.28],[122.66,62.99],[122.48,61.4],[121.76,60.82],[121.04,60.82],[120.5,60.82],[119.96,60.96],[119.6,61.4],[119.42,61.83],[119.24,62.27],[119.6,63.13],[120.68,63.71],[121.94,63.71],[122.48,63.42],[122.84,62.99],[123.02,62.41],[123.02,61.98]],
    [[120.5,71.1],[121.22,71.1],[121.94,70.81],[122.12,70.09],[121.94,69.65],[120.86,68.93],[120.32,68.93],[119.78,68.93],[119.24,68.93],[121.58,70.09]],
  ].map(s => s.map(([x, y]) => ({ x, y })));
  const ops = classifyPenGroup(S.map(pts => stroke(pts)), CTX);
  const players = ops.filter(o => o.op === "player");
  T('8 of the 9 real circles convert', players.length, 8);
  T('...every one of them an O', players.every(o => o.sym === "O"), true);
  // the ninth is a 10-point scrap that ends by cutting back across itself; it
  // stays honest ink rather than being forced through
  T('the scrappiest stays ink', ops.filter(o => o.op === "mark").length, 1);
}

// ---- A REAL dashed pass off Nate's board (Copy diagnostics). Five short
//      dashes marching between two players became five ink marks. The dash
//      detection was fine — the endpoints just had to land within 55px of a
//      player, and nobody draws the dashes right up to the icons, so a normal
//      gap put them out of reach. Endpoints now search much further. ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.121429 };
  const S = [
    [[153.42,38.49],[153.06,38.86],[152.88,39.34],[152.7,39.71]],
    [[151.62,41.04],[151.26,41.53],[151.08,42.01]],
    [[150,43.47],[150,43.84],[149.82,44.2],[149.64,44.56],[149.46,44.93]],
    [[148.74,45.9],[148.74,46.26],[148.38,46.39],[148.2,46.87],[147.84,47.24]],
    [[146.94,49.06],[146.58,49.54],[146.4,49.91],[146.22,50.27],[145.86,50.64],[145.68,51]],
  ].map(s => stroke(s.map(([x, y]) => ({ x, y }))));
  const A = { x: 153.42, y: 38.49 }, B = { x: 145.68, y: 51 };
  // players sat this many screen px beyond each end of the drawn line
  const withGap = g => {
    const ux = (B.x - A.x) / CTX.pxFtX, uy = (B.y - A.y) / CTX.pxFtY;
    const L = Math.hypot(ux, uy);
    const p1 = { x: A.x - (ux / L) * g * CTX.pxFtX, y: A.y - (uy / L) * g * CTX.pxFtY };
    const p2 = { x: B.x + (ux / L) * g * CTX.pxFtX, y: B.y + (uy / L) * g * CTX.pxFtY };
    return classifyPenGroup(S, { ...CTX, players: [
      { id: 'P1', x: p1.x, y: p1.y, end: p1, hasPath: false },
      { id: 'P2', x: p2.x, y: p2.y, end: p2, hasPath: false }] });
  };
  [0, 40, 80, 120].forEach(g =>
    T(`real dashes reach players ${g}px past the ends`, kinds(withGap(g)), ['pass']));
  T('real dashes point the right way', withGap(40)[0].from, { id: 'P1' });
  // with nobody in reach it must stay honest ink, not invent a pass
  T('dashes with no players stay ink', kinds(classifyPenGroup(S, CTX)), Array(5).fill('mark'));
}

// ---- phone scale (pxFt ≈ 0.5: the full 200ft rink spans ~390px, so a finger
//      X is 20-40 FEET) — the view-scaled gates must keep everything working ----
{
  const PHONE = { pxFt: 0.5 };
  // a 25ft X converts (this exact case shipped broken in v6.19-6.22)
  const bigX = drawn(GLYPHS.X, 60, 40, 25, 0.8, 83);
  const ops = classifyPenGroup(strokesOf(bigX), PHONE);
  T('phone: 25ft X is a player', kinds(ops), ['player']);
  T('phone: 25ft X sym', ops[0] && ops[0].sym, 'X');
  // X + a 70ft route off it, one burst
  const route = poly(p(65, 45, 100, 60, 140, 50), 30);
  const ops2 = classifyPenGroup([...strokesOf(bigX), stroke(route)], PHONE);
  T('phone: X + route', kinds(ops2), ['player', 'route']);
  T('phone: route ref', ops2[1] && ops2[1].to, { ref: 0 });
  // a phone-sized dashed pass (7ft dashes spanning ~38ft)
  const dashes = [];
  for (let i = 0; i < 4; i++) dashes.push(stroke(poly(p(65 + i * 10, 41, 72 + i * 10, 41.5), 5)));
  const ctx = { ...PHONE, players: [{ id: 'P1', x: 60, y: 40 }, { id: 'P2', x: 108, y: 44 }] };
  T('phone: dashed pass', kinds(classifyPenGroup(dashes, ctx)), ['pass']);
  // a 15ft ring is still a player O; a 40ft ring is a zone overlay
  T('phone: 15ft O is a player', kinds(classifyPenGroup(strokesOf(drawn(GLYPHS.O, 100, 42, 15, 0.5, 89)), PHONE)), ['player']);
  const big = classifyPenGroup(strokesOf(drawn(GLYPHS.O, 100, 42, 40, 1, 97)), PHONE);
  T('phone: 40ft O is an overlay', kinds(big), ['shape']);
  // desktop behavior is untouched when pxFt is absent (whole suite above)
}

// ---- A REAL X off Nate's board (Copy diagnostics) that stayed ink. The two
//      legs cross cleanly at 78%, but the second one starts with three points
//      travelling straight UP — the pen setting down and ticking back before
//      the diagonal gets going. That 0.7ft of backtrack scored the leg 0.730
//      against the 0.82 straightness gate. Endpoint flicks are now trimmed
//      before the legs are measured. ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.121429 };
  const S = [
    [[42.09,39.95],[41.55,40.19],[41.19,40.56],[40.47,41.04],[39.93,41.53],[39.21,42.01],[38.85,42.38],[38.49,42.62],[38.13,42.86],[37.77,42.74]],
    [[38.31,40.31],[38.31,39.95],[38.31,39.59],[38.67,39.71],[39.03,40.31],[39.21,40.68],[39.57,41.04],[39.93,41.53],[40.47,42.01],[40.83,42.5],[41.01,42.86],[41.37,43.11],[41.73,43.35]],
  ].map(s => s.map(([x, y]) => ({ x, y })));
  const ops = classifyPenGroup(S.map(pts => stroke(pts)), CTX);
  T('real set-down-tick X converts', kinds(ops), ['player']);
  T('...as an X', ops[0] && ops[0].sym, 'X');
  // trimming must not straighten curves: every step of an arc still advances
  // along the chord, so a C has no flick to take and stays out of the X path
  const c = classifyPenGroup(strokesOf(drawn(GLYPHS.C, 100, 42, 18, 0.6, 71)), { pxFt: 0.5 });
  T('trimming leaves a C alone', c.every(o => o.sym !== 'X'), true);
}

// ---- A REAL O off Nate's board (Copy diagnostics) that stayed ink — the
//      mirror of the X above. Six leading points scribble sideways before the
//      loop starts, and ringOf only ever trimmed the TRAILING flick: whole
//      stroke 0.677, best leading run 0.699, both under the 0.72 bar, while
//      the ring itself scores 0.902. Both ends are trimmed now. ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.121429 };
  const S = [[[54.32,38.01],[54.68,38.01],[55.04,38.01],[54.86,37.64],[54.32,37.64],[53.96,37.64],[53.6,37.76],[53.06,38.01],[52.7,38.37],[52.52,38.74],[52.34,39.22],[52.34,39.83],[52.7,40.31],[53.06,40.31],[53.42,40.31],[53.96,40.31],[54.32,39.95],[54.86,39.59],[55.22,39.22],[55.4,38.86],[55.4,38.49],[55.22,38.13],[54.86,37.89],[54.32,37.89]]]
    .map(s => s.map(([x, y]) => ({ x, y })));
  const ops = classifyPenGroup(S.map(pts => stroke(pts)), CTX);
  T('real lead-flick O converts', kinds(ops), ['player']);
  T('...as an O', ops[0] && ops[0].sym, 'O');
  // trimming both ends must not turn open letters into rings
  T('two-end trim leaves C alone', recognizeSymbol(drawn(GLYPHS.C, 80, 40, 6, 0.12, 61))?.sym, 'C');
  T('two-end trim leaves G alone', recognizeSymbol(drawn(GLYPHS.G, 80, 40, 6, 0.12, 63))?.sym, 'G');
  T('two-end trim leaves □ alone', recognizeSymbol(drawn(GLYPHS['□'], 80, 40, 6, 0.12, 67))?.sym, '□');
  T('two-end trim leaves △ alone', recognizeSymbol(drawn(GLYPHS['△'], 80, 40, 6, 0.12, 69))?.sym, '△');
}

// ---- A REAL X off Nate's board drawn WITHOUT lifting the pen: down the
//      first leg, back up the left side, down the second. One stroke, so the
//      two-stroke crossing test never saw it. The legs do cross mid-span
//      (t=0.53, u=0.46 at 78%), with the return travel as the middle run. ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.121429 };
  const S = [[[47.12,74.68],[46.4,75.29],[45.86,75.77],[45.14,76.26],[44.6,76.74],[44.06,77.23],[43.53,77.47],[43.17,77.71],[42.81,77.84],[42.45,77.35],[42.45,76.86],[42.45,76.5],[42.45,76.01],[42.63,75.65],[42.63,75.29],[42.99,75.04],[43.53,75.04],[43.88,75.29],[44.42,75.65],[44.96,76.01],[45.32,76.38],[45.86,76.86],[46.22,77.11],[46.76,77.59],[47.12,77.71],[47.48,77.59]]]
    .map(s => s.map(([x, y]) => ({ x, y })));
  const ops = classifyPenGroup(S.map(pts => stroke(pts)), CTX);
  T('real one-stroke X converts', kinds(ops), ['player']);
  T('...as an X', ops[0] && ops[0].sym, 'X');
  // the split must not manufacture X's out of other single-stroke glyphs
  for (const sym of ['O', 'C', 'W', 'L', '△', '□']) {
    const got = recognizeSymbol(drawn(GLYPHS[sym], 90, 40, 6, 0.12, 73));
    T(`one-stroke split leaves ${sym} alone`, got && got.sym, sym);
  }
  // and plain annotation ink must still stay ink
  T('vee still → null', recognizeSymbol([poly(p(60, 40, 62.5, 44, 65, 40), 8)]), null);
  T('s-curve still → null', recognizeSymbol([arcPts(61.5, 41.5, 1.5, 90, 270).concat(arcPts(61.5, 44.5, 1.5, -90, 90))]), null);
}

// ---- A REAL shot off Nate's board that stayed ink. The line ends 22px from
//      the net, but it spans only 82px — under the 85px bar that stops an
//      unrecognized letter leg becoming a spurious route — so it never reached
//      the shot test at all. A stroke ending AT A NET is now let through
//      however short, provided it's near-straight and a shooter resolves. ----
{
  const CTX = { pxFtX: 0.179856, pxFtY: 0.121429, nets: [{ id: 'N1', x: 11, y: 42.5 }, { id: 'N2', x: 189, y: 42.5 }] };
  const line = [[28.78,40.8],[29.14,40.8],[28.42,40.8],[28.06,40.8],[27.7,40.92],[27.16,40.92],[26.62,40.92],[26.08,41.04],[25.54,41.04],[24.82,41.04],[24.28,41.16],[23.56,41.16],[22.66,41.16],[22.12,41.29],[21.58,41.29],[20.86,41.29],[20.32,41.41],[19.42,41.41],[19.06,41.53],[18.53,41.53],[18.17,41.53],[17.63,41.65],[17.09,41.65],[16.55,41.77],[16.19,41.77],[15.65,41.77],[15.29,41.89],[14.93,41.89],[14.57,41.89],[14.93,41.89]]
    .map(([x, y]) => ({ x, y }));
  const go = players => classifyPenGroup([stroke(line)], { ...CTX, players });
  // a shooter standing there, and one who SKATES there first (binds to the
  // route end, which is why the diagnostics now dump it)
  T('short shot from a standing player', kinds(go([{ id: 'P1', x: 28.5, y: 41 }])), ['shot']);
  const skated = go([{ id: 'P1', x: 45.5, y: 55.61, hasPath: true, end: { x: 28.5, y: 41 } }]);
  T('short shot off a route end', kinds(skated), ['shot']);
  T('...credited to that player', skated[0] && skated[0].by, { id: 'P1' });
  T('...aimed at the near net', skated[0] && skated[0].net, 'N1');
  // no shooter in reach → still honest ink, not a guessed shot
  T('no shooter → stays ink', kinds(go([{ id: 'P1', x: 45.5, y: 55.61, hasPath: true, end: { x: 60, y: 70 } }])), ['mark']);
  T('empty board → stays ink', kinds(go([])), ['mark']);
  // and the bar it relaxes still holds: a short stray NOT at a net stays ink
  const away = line.map(q => ({ x: q.x + 60, y: q.y }));      // same line, mid-ice
  T('short stray away from net stays ink', kinds(classifyPenGroup([stroke(away)],
    { ...CTX, players: [{ id: 'P1', x: 88.5, y: 41 }] })), ['mark']);
}

// ---- THE OBSERVATION PARAMS ARE OBSERVATIONAL ----
// recognizeSymbol(s, out) and classifyPenGroup(s, ctx, trace) fill a trace when
// given one and are otherwise byte-identical. That claim is the entire reason
// it was safe to instrument shipping recogniser code, so it gets proved rather
// than asserted — over the REAL captures, which is where the branches that only
// fire on decimated phone ink actually live.
{
  const TRACED = [
    ['X13', real('X13'), CAP], ['X26', real('X26'), CAP],
    ['ring6', real('ring6'), CAP], ['ring12', real('ring12'), CAP],
    ['synthetic O', strokesOf(drawn(GLYPHS.O, 40, 30, 5, 0.15, 601)), {}],
    ['synthetic D', strokesOf(drawn(GLYPHS.D, 40, 30, 5, 0.15, 602)), {}],
    ['synthetic G', strokesOf(drawn(GLYPHS.G, 40, 30, 5, 0.15, 603)), {}],
    ['synthetic C', strokesOf(drawn(GLYPHS.C, 40, 30, 5, 0.15, 604)), {}],
    ['synthetic W', strokesOf(drawn(GLYPHS.W, 40, 30, 5, 0.15, 605)), {}],
    ['scribble', [stroke(poly(p(0, 0, 3, 1, 1, 3, 4, 2), 6))], {}],
  ];
  for (const [name, ss, ctx] of TRACED) {
    const pts = ss.map(s => s.pts);
    T(`${name}: explain matches recognize`, explainSymbol(pts).result, recognizeSymbol(pts));
    T(`${name}: trace changes no op`, classifyPenGroup(ss, ctx, {}), classifyPenGroup(ss, ctx));
  }
  // degenerate ink names its rejection instead of returning a bare null
  T('zero-length ink is named', explainSymbol([[{ x: 5, y: 5 }]]).reject, 'no-cloud');
}

// ---- WHICH BRANCH DECIDED ----
// recognizeSymbol has three geometric overrides that bypass $P entirely, and a
// score of 0.95 from crossesAsX is not the same kind of number as 0.61 from the
// template sweep. Until now nothing could tell them apart.
{
  T('a real X is decided by the crossing', explainSymbol(real('X13').map(s => s.pts)).path, 'crossesAsX');
  T('a real ring is decided geometrically', explainSymbol(real('ring6').map(s => s.pts)).path, 'ring');
  T('a bigger ring too', explainSymbol(real('ring12').map(s => s.pts)).path, 'ring');
  T('a D goes through $P', explainSymbol(strokesOf(drawn(GLYPHS.D, 40, 30, 5, 0.12, 611)).map(s => s.pts)).path, '$P');
  // ...and the sweep the override skipped past is still recorded, so "what
  // would $P have said" is answerable. It matters because a reported `score` is
  // NOT one scale: 0.95 and 0.9 are constants from the two X paths, the ring
  // path returns circularity, and only the fallback is a template score. A
  // diagnostic printing all of those in one column without saying which is
  // which would be lying, so the trace names the provenance.
  const x = explainSymbol(real('X13').map(s => s.pts));
  T('the overridden sweep is kept', typeof x.scored.X, 'number');
  T('the crossing reports a constant, not the sweep', x.result.score, 0.95);
  T('...and the sweep does not agree with it', Math.abs(x.scored.X - x.result.score) > 0.2, true);
  const rg = explainSymbol(real('ring6').map(s => s.pts));
  T('the ring reports circularity, not the sweep', rg.result.score > rg.scored.O + 0.15, true);
  T('scoreAll still answers on an override path', !!scoreAll(real('X13').map(s => s.pts)), true);
  T('scoreAll shape is unchanged',
    Object.keys(scoreAll(real('ring6').map(s => s.pts))).sort(), ['features', 'scored']);
}

// ---- WHY IT DIDN'T CONVERT ----
// The two rejections look identical from outside — the ink just stays ink — but
// they need opposite fixes: a guard says "it isn't shaped like that", a
// threshold says "it is, but not clearly enough".
{
  const o = explainSymbol([stroke(poly(p(0, 0, 3, 1, 1, 3, 4, 2), 6)).pts]);
  T('a scribble is rejected', o.result, null);
  T('...on the score, not a guard', o.reject, 'threshold');
  T('every guard is reported, pass and fail', Object.keys(o.guards).sort().join(','),
    Object.keys(o.scored).sort().join(','));
  // an open C: the O guard blocks it even when O scores well
  const c = explainSymbol(strokesOf(drawn(GLYPHS.C, 40, 30, 5, 0.1, 621)).map(s => s.pts));
  T('C fails the O guard', c.guards.O, false);
  T('...and the closure that did it is on the record', c.features.closure > 0.5, true);
  T('the runner-up scores are kept, not just its name', Array.isArray(c.ranked[1]), true);
}

// ---- THE GUARD BANDS ARE THE COMMENTS, ENFORCED ----
// Every number here was measured by hand and written into a comment. A comment
// can't fail, so the bands are exercised at their stated boundaries: move one
// and this says so.
{
  const F = o => ({ closure: 0, corners: 0, leftRMS: 0, tail: 0, radialCV: 0, spineDrift: 0, curveVerts: 0, ...o });
  T('O accepts under 0.52 closure', GUARDS.O(F({ closure: 0.519 })), true);
  T('O rejects at 0.52', GUARDS.O(F({ closure: 0.52 })), false);
  T('C needs over 0.50 closure', GUARDS.C(F({ closure: 0.501, tail: 1 })), true);
  T('C rejects at 0.50', GUARDS.C(F({ closure: 0.5, tail: 1 })), false);
  T('C rejects a filled middle', GUARDS.C(F({ closure: 0.7, tail: 2 })), false);
  T('G needs the tail', GUARDS.G(F({ tail: 2 })), true);
  T('G rejects one stray point', GUARDS.G(F({ tail: 1 })), false);
  T('D needs a straight spine', GUARDS.D(F({ leftRMS: 0.069, spineDrift: 0.089 })), true);
  T('D rejects a wobbly band', GUARDS.D(F({ leftRMS: 0.07, spineDrift: 0.0 })), false);
  T('D rejects a drifting spine', GUARDS.D(F({ leftRMS: 0, spineDrift: 0.09 })), false);
  T('triangle wants exactly 3 corners', GUARDS['△'](F({ closure: 0.3, corners: 3 })), true);
  T('...not 4', GUARDS['△'](F({ closure: 0.3, corners: 4 })), false);
  T('square wants exactly 4', GUARDS['□'](F({ closure: 0.3, corners: 4 })), true);
  T('...not 3', GUARDS['□'](F({ closure: 0.3, corners: 3 })), false);
  // the prose the diagnostic prints must cover the predicates it describes
  T('every guard has a stated band',
    Object.keys(GUARDS).sort().join(','), Object.keys(GUARD_BANDS).sort().join(','));
}

// ---- THE UNIT TABLE ----
// Half of "it converts in the test but not on my phone" is that the classifier
// fell back to rink feet because it had no view scale. That was invisible; the
// trace states it outright. This assertion is the one that would have caught the
// fill-stretch bug that shipped broken through v6.25.
{
  const t1 = {};
  classifyPenGroup(real('ring6'), CAP, t1);
  T('with a view scale, thresholds are pixels', [t1.units.scaled, t1.units.symMax], [true, SYMBOL_MAX_PX]);
  const t2 = {};
  classifyPenGroup(real('ring6'), {}, t2);
  T('without one, they fall back to feet', [t2.units.scaled, t2.units.symMax], [false, SYMBOL_MAX]);
  T('the per-axis scale is recorded', t1.units.fx, CAP.pxFt);
  // every threshold the classifier resolved is on the record, not just the two
  T('the whole table is reported', ['attachR', 'passR', 'netR', 'dashSpan', 'linkR', 'puckOnR', 'dashEndR']
    .every(k => typeof t1.units[k] === 'number'), true);
  // per-stroke fate, so each captured stroke can be coloured by what became of it
  T('every stroke is accounted for', t1.strokes.length, real('ring6').length);
  T('a symbol read is traced', t1.syms.length > 0, true);
}

console.log(`\n${pass} passed, ${fail} failed  (accept threshold ${ACCEPT})`);
process.exit(fail ? 1 : 0);
