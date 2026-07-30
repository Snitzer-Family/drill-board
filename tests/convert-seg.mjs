// convertSeg changes a leg's SHAPE. It must not change anything else about it.
//
// It used to rebuild the segment from scratch and keep only mode/dir/stop/rate,
// so every other thing authored on that waypoint — its name, its label, its
// delay trigger, its lock, and the connector it hands off on — vanished the
// moment the leg was curved or straightened. The visible symptom was a
// connector that stopped feeding the path it was drawn to reach as soon as you
// smoothed its corner: `goTo` was on the last leg, and smoothing converted it.
//
// Nothing else pins this. The board still renders, the build still passes, and
// the drill just quietly stops working.
import { convertSeg } from '../src/geometry.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const prev = { x: 20, y: 20 };
// one leg carrying every kind of non-geometry fact a waypoint can hold
const rich = {
  type: 'L', x: 60, y: 40,
  mode: 'pass', dir: 'bwd', stop: 2, rate: 0.75,
  goTo: 'R2', name: 'Top of the circle', desc: 'wait for the whistle',
  waitOn: { on: 'P1', at: 2, mode: 'waypoint' },
  lock: true, jump: true, endStop: true, turn: 'open',
  dmode: 'label', dsize: 1.4, dox: 3, doy: -2, join: 'smooth',
};

for (const [type, label] of [['C', 'to a curve'], ['Q', 'to an S-curve'], ['L', 'to straight']]) {
  const out = convertSeg({ ...rich, type }, prev);
  T(`${label}: the connector survives`, out.goTo, 'R2');
  T(`${label}: the name and description survive`, [out.name, out.desc], [rich.name, rich.desc]);
  T(`${label}: the delay trigger survives`, out.waitOn, rich.waitOn);
  T(`${label}: lock/jump/endStop survive`, [out.lock, out.jump, out.endStop], [true, true, true]);
  T(`${label}: the label settings survive`, [out.dmode, out.dsize, out.dox, out.doy], ['label', 1.4, 3, -2]);
  T(`${label}: the scalars survive`, [out.mode, out.dir, out.stop, out.rate], ['pass', 'bwd', 2, 0.75]);
  T(`${label}: the endpoint is untouched`, [out.x, out.y], [60, 40]);
  T(`${label}: the type is what was asked for`, out.type, type);
}

// ...and the shape really does change: stale control points must not linger,
// or a leg turned straight would still carry the handles of the curve it was.
{
  const curved = convertSeg({ ...rich, type: 'C' }, prev);
  T('a curve gains its handles', [curved.c1x != null, curved.c2x != null], [true, true]);
  const straightened = convertSeg({ ...curved, type: 'L' }, prev);
  T('straightening drops the handles',
    ['c1x', 'c1y', 'c2x', 'c2y', 'cx', 'cy'].filter(k => straightened[k] != null), []);
  const s = convertSeg({ ...curved, type: 'Q' }, prev);
  T('an S-curve drops the cubic handles', ['c1x', 'c2x'].filter(k => s[k] != null), []);
  T('...and gains its own', s.cx != null, true);
}

// the callers that pass a bare {type,x,y} must still get a plain segment
{
  const bare = convertSeg({ type: 'C', x: 60, y: 40 }, prev);
  T('a bare segment gets the defaults', [bare.mode, bare.dir, bare.stop, bare.rate], ['carry', 'fwd', 0, 1]);
  T('...and invents nothing else',
    Object.keys(bare).filter(k => !['type', 'mode', 'dir', 'stop', 'rate', 'x', 'y', 'c1x', 'c1y', 'c2x', 'c2y'].includes(k)), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
