// node tests/drill-fit.mjs — exercises the pixel→rink landmark fit and the
// DSL coordinate rewrite (drill-fit.js is pure, so it imports straight in).
import assert from "node:assert/strict";
import { fitTransform, transformDsl } from "../src/drill-fit.js";

let passed = 0;
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); };
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

// --- portrait half-ice page, net at the bottom (attack=down) ---------------
// synthetic ground truth: page rotated so rink +x points image-down;
// py = (rinkX-100)*8 + 50, px = (85-rinkY)*8 + 40
const toPx = (x, y) => ({ x: (85 - y) * 8 + 40, y: (x - 100) * 8 + 50 });
check("portrait half-ice (attack=down)", () => {
  const lm = [
    { feature: "goal_line", ...toPx(189, 42.5) },
    { feature: "blue_line", ...toPx(125, 42.5) },
    { feature: "net", ...toPx(189, 42.5) },
    { feature: "endzone_dot", ...toPx(169, 20.5) },
    { feature: "endzone_dot", ...toPx(169, 64.5) },
  ];
  const { map, residual, error } = fitTransform(lm, { attack: "down", rink: "half" });
  assert.equal(error, undefined);
  near(residual, 0, 0.5, "residual");
  const p = toPx(150, 30), m = map(p.x, p.y);
  near(m.x, 150, 0.5, "player x"); near(m.y, 30, 0.5, "player y");
  const n = toPx(189, 42.5), mn = map(n.x, n.y);
  near(mn.x, 189, 0.5, "net x"); near(mn.y, 42.5, 0.5, "net y");
});

// --- landscape full ice: paired lines resolve by order (attack=right) ------
check("full ice paired goal/blue lines", () => {
  const px = (x, y) => ({ x: x * 5 + 30, y: y * 5 + 20 }); // identity orientation, s=5
  const lm = [
    { feature: "goal_line", ...px(11, 42.5) },
    { feature: "goal_line", ...px(189, 42.5) },
    { feature: "blue_line", ...px(75, 42.5) },
    { feature: "blue_line", ...px(125, 42.5) },
    { feature: "center_dot", ...px(100, 42.5) },
    { feature: "endzone_dot", ...px(31, 20.5) },
    { feature: "endzone_dot", ...px(169, 64.5) },
  ];
  const { map, residual, error } = fitTransform(lm, { attack: "right", rink: "full" });
  assert.equal(error, undefined);
  near(residual, 0, 0.5, "residual");
  const m = map(px(60, 70).x, px(60, 70).y);
  near(m.x, 60, 0.5, "x"); near(m.y, 70, 0.5, "y");
});

// --- degenerate y-evidence falls back to uniform scale ---------------------
check("y fallback: lines only", () => {
  const lm = [
    { feature: "goal_line", x: 500, y: 300 },
    { feature: "blue_line", x: 200, y: 300 },
    { feature: "net", x: 505, y: 300 },
  ];
  const { map, error } = fitTransform(lm, { attack: "right", rink: "half" });
  assert.equal(error, undefined);
  const m = map(505, 300);
  near(m.x, 189, 2, "net x"); near(m.y, 42.5, 2, "net y (anchored)");
});

// --- wrong stated attack: the landmark fit overrides it ---------------------
check("orientation search overrides a wrong attack call", () => {
  const lm = [
    { feature: "goal_line", ...toPx(189, 42.5) },
    { feature: "blue_line", ...toPx(125, 42.5) },
    { feature: "net", ...toPx(189, 42.5) },
    { feature: "endzone_dot", ...toPx(169, 20.5) },
    { feature: "endzone_dot", ...toPx(169, 64.5) },
  ];
  // truth is attack=down (portrait); the model claims "right"
  const { map, attack, error } = fitTransform(lm, { attack: "right", rink: "half" });
  assert.equal(error, undefined);
  assert.equal(attack, "down", "search picked the true orientation");
  const p = toPx(150, 30), m = map(p.x, p.y);
  near(m.x, 150, 0.5, "player x"); near(m.y, 30, 0.5, "player y");
});

// --- pieces keep their mapped positions verbatim (no snapping) --------------
check("no piece snapping — faithful positions", () => {
  const map = (x, y) => ({ x: x / 10, y: y / 10 });
  const src = [
    "PIECE F1 player 1680 195 F1",     // → (168, 19.5): near dot (169, 20.5) — stays put
    "PIECE C1 cone 1300 300",          // → (130, 30)
    "PIECE L1 label 1685 200 \"hi\"",
    "PIECE K1 puck 1700 210",          // → (170, 21)
  ].join("\n");
  const out = transformDsl(src, map).split("\n");
  assert.equal(out[0], "PIECE F1 player 168 19.5 F1", "player position verbatim");
  assert.equal(out[1], "PIECE C1 cone 130 30", "cone verbatim");
  assert.ok(out[2].includes("168.5 20"), "label verbatim");
  assert.equal(out[3], "PIECE K1 puck 170 21", "puck verbatim");
});

// --- off-center nets must not corrupt the y-fit ------------------------------
// Two nets parked on the goal line above each faceoff circle (nets are NOT
// mid-ice): only the crease/dots may anchor y, or the whole drill squashes
// toward the centerline.
check("off-center nets don't anchor y", () => {
  const lm = [
    { feature: "goal_line", ...toPx(189, 42.5) },
    { feature: "crease", ...toPx(186, 42.5) },
    { feature: "net", ...toPx(191, 20.5) },
    { feature: "net", ...toPx(191, 64.5) },
    { feature: "endzone_dot", ...toPx(169, 20.5) },
    { feature: "endzone_dot", ...toPx(169, 64.5) },
  ];
  const { map, residual, error } = fitTransform(lm, { attack: "down", rink: "half" });
  assert.equal(error, undefined);
  near(residual, 0, 1, "residual");
  const n = toPx(191, 20.5), mn = map(n.x, n.y);
  near(mn.y, 20.5, 0.6, "net keeps its off-center y");
  const d = toPx(169, 64.5), md = map(d.x, d.y);
  near(md.y, 64.5, 0.6, "dot y");
});

// --- too little evidence errors instead of guessing ------------------------
check("single landmark → error", () => {
  const { error } = fitTransform([{ feature: "net", x: 10, y: 10 }], { attack: "right", rink: "half" });
  assert.ok(error, "expected an error");
});

// --- DSL rewrite: PIECE snap, PATH tokens, OFF/quotes/aim, STEP pos --------
check("transformDsl rewrite", () => {
  const map = (x, y) => ({ x: x / 10, y: y / 10 }); // trivial scale for inspection
  const src = [
    "TITLE Corner 2,2 game",
    "PIECE F1 player 1500 300 F1",
    "PIECE N1 net 1886 421 goalie",
    'PATH F1 L 1600,400 Q 1700,450 1800,420 DESC "cut 1,2 hard" OFF 3,-5 SHOT L 1826,425 ~45',
    "STEP at=2 pos=1500:300 \"go\"",
    "PIECE N2 net 108 424 face=90",    // left end: snaps to 11, face= stripped, no 180
    "PIECE N3 net 1888 660",           // net over the bottom circle: y snaps to the dot lane
  ].join("\n");
  const out = transformDsl(src, map).split("\n");
  assert.equal(out[0], "TITLE Corner 2,2 game", "TITLE untouched");
  assert.equal(out[1], "PIECE F1 player 150 30 F1");
  assert.equal(out[2], "PIECE N1 net 189 42.5 goalie face=180", "net snapped + faces center ice");
  assert.ok(out[3].includes('DESC "cut 1,2 hard"'), "quoted text untouched");
  assert.ok(out[3].includes("OFF 3,-5"), "OFF offset untouched");
  assert.ok(!out[3].includes("~45"), "aim angle dropped");
  assert.ok(out[3].includes("L 160,40"), "L point transformed");
  assert.ok(out[3].includes("Q 170,45 180,42"), "Q points transformed");
  assert.ok(out[4].includes("pos=150:30"), "STEP pos transformed");
  assert.equal(out[5], "PIECE N2 net 11 42.5", "left net: default facing (mouth toward center), face= stripped");
  assert.equal(out[6], "PIECE N3 net 189 64.5 face=180", "off-crease net snaps to the dot lane");
});

// --- MARK overlays densify so smoothed rendering keeps sides straight -------
check("MARK densified for straight sides", () => {
  const map = (x, y) => ({ x: x / 10, y: y / 10 });
  const out = transformDsl("MARK Z1 #e8c547 0.6 dashed 100,100 400,100 400,300 100,300 100,100", map).split(/\s+/);
  const coords = out.filter(t => /^-?[\d.]+,-?[\d.]+$/.test(t));
  assert.ok(coords.length >= 20, `expected ≥20 dense points, got ${coords.length}`);
  assert.equal(coords[0], "10,10", "first corner exact");
  assert.equal(coords[coords.length - 1], "10,10", "closes the loop");
  // interpolated points along the top edge stay collinear (y = 10)
  const topEdge = coords.slice(0, 8).every(c => c.split(",")[1] === "10");
  assert.ok(topEdge, "top edge points collinear");
});

// --- a round MARK trace snaps to the parametric preset circle ---------------
check("MARK circle trace snaps to a clean ellipse", () => {
  const map = (x, y) => ({ x: x / 10, y: y / 10 });
  // 14 hand-wobbly points around (1690, 425) r≈140 px → (169, 42.5) r≈14 ft
  const trace = Array.from({ length: 15 }, (_, i) => {
    const t = (i / 14) * 2 * Math.PI, r = 140 + (i % 3 === 0 ? 8 : -6);
    return `${Math.round(1690 + r * Math.cos(t))},${Math.round(425 + r * Math.sin(t))}`;
  }).join(" ");
  const out = transformDsl(`MARK Z1 #e8c547 0.6 fill=e8c547:0.25 ${trace}`, map);
  assert.ok(!out.includes("corners="), "no spurious corners on a circle");
  const coords = out.split(/\s+/).filter(t => /^-?[\d.]+,-?[\d.]+$/.test(t)).map(t => t.split(",").map(Number));
  assert.equal(coords.length, 25, "parametric 24-segment circle");
  const cx = 169, cy = 42.5;
  for (const [x, y] of coords) {
    const r = Math.hypot(x - cx, y - cy);
    near(r, 14, 1.5, "point on one clean radius");
  }
  assert.ok(out.includes("fill=e8c547:0.25"), "fill preserved");
});

// --- a straight-sided MARK is NOT mistaken for a circle ----------------------
check("MARK square keeps corners (not circle-snapped)", () => {
  const map = (x, y) => ({ x: x / 10, y: y / 10 });
  const out = transformDsl("MARK Z1 #e8c547 0.6 dashed 100,100 400,100 400,400 100,400 100,100", map);
  assert.ok(out.includes("corners="), "square corners flagged sharp");
});

console.log(`\n${passed} checks passed`);
