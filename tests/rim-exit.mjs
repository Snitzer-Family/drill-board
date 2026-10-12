// A rimmed puck leaves the boards on a shallow diagonal toward its collector —
// never a 90° pop off the rail at the nearest point. The entry has always been
// led shallow (leadOf); these pin the EXIT to the mirrored rule, for both the
// unaimed rim (rimPath) and the aimed one (rimTo).
import * as boards from '../src/boards.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const angDeg = (p, q) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
// angle between the final leg (boards → collector) and the last rim leg
const exitAngle = pts => {
  const n = pts.length;
  let d = Math.abs(angDeg(pts[n - 2], pts[n - 1]) - angDeg(pts[n - 3], pts[n - 2])) % 360;
  return d > 180 ? 360 - d : d;
};
const last = pts => pts[pts.length - 1];

{ // unaimed rim to collectors at several offsets from several boards
  const cases = [
    ['top boards → mid collector', { x: 30, y: 6 }, { x: 120, y: 12 }],
    ['bottom boards → slot collector', { x: 170, y: 80 }, { x: 140, y: 68 }],
    ['left boards → wing collector', { x: 6, y: 20 }, { x: 15, y: 60 }],
  ];
  for (const [name, from, to] of cases) {
    const pts = boards.rimPath(from, to);
    T(`rimPath ${name}: shallow exit`, exitAngle(pts) < 55, true);
    T(`rimPath ${name}: ends at the collector`, last(pts), { x: to.x, y: to.y });
    T(`rimPath ${name}: starts at the release`, pts[0], { x: from.x, y: from.y });
  }
}

{ // a collector standing ON the boards still gets a direct path (lead → 0)
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 120, y: 2.6 });
  T('rimPath on-boards collector still ends there', last(pts), { x: 120, y: 2.6 });
}

{ // aimed rim: stops early and exits diagonally, still landing on the target
  const pts = boards.rimTo({ x: 150, y: 80 }, 0, { x: 185, y: 40 });
  T('rimTo: shallow-ish exit (never the 90° pop)', exitAngle(pts) < 55, true);
  T('rimTo: ends at the collector', last(pts), { x: 185, y: 40 });
  // the exit leg has real length — it peeled off before the closest approach
  const n = pts.length;
  T('rimTo: peels off before the nearest point',
    Math.hypot(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y) > 14, true);
}

{ // a very short rim (release and collector close together) must not go negative
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 44, y: 8 });
  T('short rim: still a valid path to the collector', last(pts), { x: 44, y: 8 });
  T('short rim: at least release → boards → collector', pts.length >= 3, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
