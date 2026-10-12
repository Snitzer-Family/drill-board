// A rimmed puck leaves the boards toward its collector by peeling off early
// and CURLING — tangent-continuously, spread over several vertices — instead
// of riding to the nearest point and turning a 90° corner. These pin the exit
// for the unaimed rim (rimPath) and the aimed one (rimTo), including the
// corner-pocket drill that caught the arc-length version overshooting.
import * as boards from '../src/boards.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const last = pts => pts[pts.length - 1];
// the sharpest single-vertex turn across the path's tail — the "90° pop" is a
// ~90° turn at one vertex, a healthy curl spreads it in small steps
const maxTurn = (pts, tail = 7) => {
  let worst = 0;
  for (let k = Math.max(1, pts.length - tail); k < pts.length - 1; k++) {
    const a = Math.atan2(pts[k].y - pts[k - 1].y, pts[k].x - pts[k - 1].x);
    const b = Math.atan2(pts[k + 1].y - pts[k].y, pts[k + 1].x - pts[k].x);
    let d = Math.abs((b - a) * 180 / Math.PI) % 360;
    if (d > 180) d = 360 - d;
    worst = Math.max(worst, d);
  }
  return worst;
};

{ // unaimed rim to collectors at several offsets from several boards
  const cases = [
    ['top boards → mid collector', { x: 30, y: 6 }, { x: 120, y: 12 }],
    ['bottom boards → slot collector', { x: 170, y: 80 }, { x: 140, y: 68 }],
    ['left boards → wing collector', { x: 6, y: 20 }, { x: 15, y: 60 }],
  ];
  for (const [name, from, to] of cases) {
    const pts = boards.rimPath(from, to);
    T(`rimPath ${name}: no sharp pop off the rail`, maxTurn(pts) < 45, true);
    T(`rimPath ${name}: ends at the collector`, last(pts), { x: to.x, y: to.y });
    T(`rimPath ${name}: starts at the release`, pts[0], { x: from.x, y: from.y });
  }
}

{ // a collector standing ON the boards still gets a direct path
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 120, y: 2.6 });
  T('rimPath on-boards collector still ends there', last(pts), { x: 120, y: 2.6 });
  T('rimPath on-boards collector stays smooth', maxTurn(pts) < 45, true);
}

{ // aimed rim on a straight wall: peels early, curls off, lands on the target
  const pts = boards.rimTo({ x: 150, y: 80 }, 0, { x: 185, y: 40 });
  T('rimTo: no sharp pop off the rail', maxTurn(pts) < 45, true);
  T('rimTo: ends at the collector', last(pts), { x: 185, y: 40 });
}

{ // THE drill that reported 90°: rim=0:P2@3~-18 — collect point deep in the
  // top-right corner pocket (inside the corner arc's own circle), where no
  // genuinely shallow wall chord exists. The curl must still spread the turn.
  const pts = boards.rimTo({ x: 122.7, y: 20.1 }, -18, { x: 168.8, y: 34.7 });
  T('corner-pocket collect: ends at the collector', last(pts), { x: 168.8, y: 34.7 });
  T('corner-pocket collect: no 90° vertex', maxTurn(pts) < 45, true);
}

{ // a very short rim (release and collector close together) must not go negative
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 44, y: 8 });
  T('short rim: still a valid path to the collector', last(pts), { x: 44, y: 8 });
  T('short rim: at least release → boards → collector', pts.length >= 3, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
