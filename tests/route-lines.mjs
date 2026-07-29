import { QUEUE_GAP, queueOf, isMobile, headHeading, stackSpot, lowerRoutes } from '../src/route-lines.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// a route running due east from (60,40): head at 60,40 then two straight legs
const route = (over = {}) => ({
  id: 'R1', kind: 'route', x: 60, y: 40, color: '#2f9e57', gap: 5, forks: [],
  path: [{ type: 'L', x: 100, y: 40 }, { type: 'L', x: 140, y: 60 }],
  ...over,
});
const skater = (id, q, over = {}) => ({ id, kind: 'player', x: 0, y: 0, route: 'R1', q, path: [], forks: [], ...over });

// ---- queueOf ----
{
  const ps = [route(), skater('P3', 3), skater('P1', 1), skater('P2', 2)];
  T('queueOf sorts by q', queueOf(ps, 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
  T('queueOf ignores other routes', queueOf([...ps, { id: 'PX', kind: 'player', route: 'R9', q: 1 }], 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
  T('queueOf ignores non-players', queueOf([...ps, { id: 'PKX', kind: 'puck', route: 'R1', q: 0 }], 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
}
{ // a missing q falls to the back; ties break on id so the stack never jitters
  const ps = [route(), skater('PB', undefined), skater('PA', undefined), skater('P1', 1)];
  T('missing q sorts last, ties by id', queueOf(ps, 'R1').map(p => p.id), ['P1', 'PA', 'PB']);
}

// ---- isMobile ----
T('isMobile: bare player is not', isMobile({ kind: 'player', path: [] }), false);
T('isMobile: own path counts', isMobile({ kind: 'player', path: [{}] }), true);
T('isMobile: a route binding counts', isMobile({ kind: 'player', path: [], route: 'R1' }), true);
T('isMobile: forks count', isMobile({ kind: 'player', path: [], forks: [{}] }), true);
T('isMobile: null is not', isMobile(null), false);

// ---- headHeading ----
{
  const h = headHeading(route());
  T('headHeading points along leg 0', [near(h.x, 1), near(h.y, 0)], [true, true]);
  const north = headHeading(route({ path: [{ type: 'L', x: 60, y: 0 }] }));
  T('headHeading follows a turn', [near(north.x, 0), near(north.y, -1)], [true, true]);
  const bare = headHeading({ id: 'R', kind: 'route', x: 10, y: 10, path: [], facing: 180 });
  T('pathless route falls back to facing', [near(bare.x, -1), near(bare.y, 0)], [true, true]);
}

// ---- stackSpot ----
{
  const R = route();
  const spots = [0, 1, 2, 3].map(k => stackSpot(R, k, 5));
  T('head stands on the route start', [spots[0].x, spots[0].y], [60, 40]);
  T('the line stacks backwards, evenly', spots.map(s => Math.round(s.x)), [60, 55, 50, 45]);
  T('the line stays on one row', spots.every(s => near(s.y, 40)), true);
  T('gap defaults when absent', Math.round(stackSpot(R, 1).x), 60 - QUEUE_GAP);
  T('a zero gap falls back rather than piling up', Math.round(stackSpot(R, 2, 0).x), 60 - 2 * QUEUE_GAP);
}
{ // aimed into the end boards: spots clamp onto the ice instead of running off it
  const R = route({ x: 6, y: 40, path: [{ type: 'L', x: 40, y: 40 }] });
  const spots = [0, 1, 2, 3].map(k => stackSpot(R, k, 5));
  T('stack clamps inside the boards', spots.every(s => s.x >= 0 && s.x <= 200), true);
}

// ---- lowerRoutes ----
{ // the fast path every pre-route drill takes
  const ps = [{ id: 'P1', kind: 'player', x: 10, y: 10, path: [{ type: 'L', x: 20, y: 20 }] }];
  T('no route on the board → same array by identity', lowerRoutes(ps) === ps, true);
  T('undefined is tolerated', lowerRoutes(undefined), undefined);
}
{
  const R = route();
  const ps = [R, skater('P1', 1), skater('P2', 2), skater('P3', 3), { id: 'N1', kind: 'net', x: 189, y: 42 }];
  const out = lowerRoutes(ps);

  T('route pieces never reach the engine', out.some(p => p.kind === 'route'), false);
  T('non-players pass through untouched', out.find(p => p.id === 'N1') === ps[4], true);
  T('every member is lowered', out.filter(p => p.kind === 'player').length, 3);

  const [p1, p2, p3] = ['P1', 'P2', 'P3'].map(id => out.find(p => p.id === id));
  T('members get the route legs', p1.path.length, R.path.length);
  // the index-preservation invariant the whole design rests on
  T('waypoint i of the route is leg i of every member',
    out.filter(p => p.kind === 'player').every(p => p.path.every((s, i) => s.x === R.path[i].x && s.y === R.path[i].y)), true);
  T('the head departs from the route start', [p1.x, p1.y], [60, 40]);
  T('the rest stand back in order', [Math.round(p2.x), Math.round(p3.x)], [55, 50]);
  T('_line records the binding', [p1._line, p3._line], [{ route: 'R1', q: 0 }, { route: 'R1', q: 2 }]);
  T('legs are copies, not shared with the route', p1.path[0] !== R.path[0] && p1.path[0] !== p2.path[0], true);
}
{ // a binding that points at nothing leaves the player alone
  const ps = [route(), { id: 'PX', kind: 'player', x: 5, y: 5, route: 'R9', q: 1, path: [] }];
  const out = lowerRoutes(ps);
  T('dangling route binding is inert', [out.find(p => p.id === 'PX').x, out.find(p => p.id === 'PX')._line], [5, undefined]);
}
{ // a bound player's own path loses to the route — the binding is the source of truth
  const ps = [route(), skater('P1', 1, { path: [{ type: 'L', x: 1, y: 1 }] })];
  T('the route wins over a stale hand-drawn path', lowerRoutes(ps).find(p => p.id === 'P1').path.length, 2);
}
{ // a route with no line on it just disappears
  const ps = [route(), { id: 'P9', kind: 'player', x: 5, y: 5, path: [] }];
  const out = lowerRoutes(ps);
  T('an empty route drops, its neighbours survive', out.map(p => p.id), ['P9']);
}
{ // determinism — no Math.random, no Date
  const ps = [route(), skater('P1', 1), skater('P2', 2)];
  T('lowering is deterministic', JSON.stringify(lowerRoutes(ps)) === JSON.stringify(lowerRoutes(ps)), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
