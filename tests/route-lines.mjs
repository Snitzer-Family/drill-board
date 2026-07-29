import { QUEUE_GAP, QUEUE_LEAD, queueOf, isMobile, headHeading, stackSpot, queueRelease, transitObstacles, lowerRoutes } from '../src/route-lines.js';
import { TRANSIT_RATE, HOPS_MAX, LINE_LEG_CAP } from '../src/constants.js';

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

// ---- queueRelease: how the line takes its turns ----
{
  T('no rule → nobody is held', queueRelease(route(), 'P1'), null);
  T('the head is never held', queueRelease(route({ queue: { mode: 'lead', lead: 15 } }), null), null);
  T('a point rule lowers to the waypoint trigger timing.js already has',
    queueRelease(route({ queue: { mode: 'point', at: 1 } }), 'P1'), { on: 'P1', at: 1, mode: 'waypoint' });
  // the two already stand `gap` apart, so what the one ahead must TRAVEL to open a
  // 15 ft separation is 15 − 6. Getting this backwards is a silent 2× on the gap.
  T('a lead rule converts separation to travel',
    queueRelease(route({ gap: 6, queue: { mode: 'lead', lead: 15 } }), 'P1'), { on: 'P1', dist: 9, mode: 'span' });
  T('a lead already covered by the spacing releases at once',
    queueRelease(route({ gap: 6, queue: { mode: 'lead', lead: 4 } }), 'P1').dist, 0);
  T('a lead rule defaults its distance',
    queueRelease(route({ gap: 5, queue: { mode: 'lead' } }), 'P1').dist, QUEUE_LEAD - 5);
  T('an unknown rule holds nobody', queueRelease(route({ queue: { mode: 'wat' } }), 'P1'), null);
}
{ // lowering wires each member to the one directly ahead — a strict chain to the head
  const R = route({ queue: { mode: 'lead', lead: 15 } });
  const out = lowerRoutes([R, skater('P1', 1), skater('P2', 2), skater('P3', 3)]);
  const w = id => out.find(p => p.id === id).wait;
  T('the head of the line waits for nobody', w('P1'), null);
  T('each skater waits on the one ahead', [w('P2').on, w('P3').on], ['P1', 'P2']);
  T('the chain is acyclic (it terminates at the head)', (() => {
    const by = Object.fromEntries(out.filter(p => p.kind === 'player').map(p => [p.id, p.wait && p.wait.on]));
    let id = 'P3', hops = 0;
    while (by[id] && hops < 10) { id = by[id]; hops++; }
    return !by[id] && hops === 2;
  })(), true);
  T('every member gets the same travel distance', [w('P2').dist, w('P3').dist], [10, 10]);
}
{ // a member's own hand-authored wait= loses to the line's rule
  const R = route({ queue: { mode: 'point', at: 0 } });
  const out = lowerRoutes([R, skater('P1', 1), skater('P2', 2, { wait: { on: 'PX', at: 3, mode: 'waypoint' } })]);
  T('the line owns the release, not the member', out.find(p => p.id === 'P2').wait, { on: 'P1', at: 0, mode: 'waypoint' });
}
{ // a line with no rule still lowers cleanly — everyone goes at once, as before
  const out = lowerRoutes([route(), skater('P1', 1), skater('P2', 2)]);
  T('no rule leaves every member unheld', out.filter(p => p.kind === 'player').every(p => p.wait === null), true);
}

// ---- recycling: next= / hops= ----
// one "lap" = one maximal run of transit legs, since a single crossing may be
// simplified into several
const laps = legs => legs.reduce((n, s, i) => n + (s.transit && !(legs[i - 1] || {}).transit ? 1 : 0), 0);
const routeB = (over = {}) => ({
  id: 'R2', kind: 'route', x: 160, y: 70, color: '#3f7f8c', forks: [],
  path: [{ type: 'L', x: 120, y: 70 }],
  ...over,
});
{
  const A = route({ next: 'R2' }), B = routeB();
  const out = lowerRoutes([A, B, skater('P1', 1)]);
  const legs = out.find(p => p.id === 'P1').path;
  T('a recycled skater gets more legs than one route', legs.length > A.path.length, true);
  T('the transit legs are marked', legs.some(s => s.transit), true);
  T('transit is a regroup glide, not another rep', legs.filter(s => s.transit).every(s => s.rate === TRANSIT_RATE), true);
  T('the last leg is the destination route\'s last waypoint',
    [legs[legs.length - 1].x, legs[legs.length - 1].y], [120, 70]);
  T('the destination legs are not marked transit',
    legs[legs.length - 1].transit, undefined);
  // the transit has to actually START where the first route ended
  const firstTransit = legs.findIndex(s => s.transit);
  T('transit departs from the end of route A', [legs[firstTransit - 1].x, legs[firstTransit - 1].y], [140, 60]);
}
{ // next= pointing at nothing is inert
  const out = lowerRoutes([route({ next: 'R9' }), skater('P1', 1)]);
  T('a dangling next= just ends the route', out.find(p => p.id === 'P1').path.length, 2);
}
{ // hops=0 draws the link but does not run it
  const out = lowerRoutes([route({ next: 'R2', hops: 0 }), routeB(), skater('P1', 1)]);
  T('hops=0 stops at the first route', out.find(p => p.id === 'P1').path.length, 2);
}
{ // THE termination case: two routes pointing at each other is how a full-ice
  // drill is actually drawn, and it must not hang or grow without bound
  const A = route({ next: 'R2', hops: 4 }), B = routeB({ next: 'R1', hops: 4 });
  const out = lowerRoutes([A, B, skater('P1', 1)]);
  const legs = out.find(p => p.id === 'P1').path;
  T('a next= cycle terminates', legs.length > 0 && legs.length < LINE_LEG_CAP, true);
  T('it runs the laps asked for', laps(legs), 4);
  T('a cycle is still deterministic', JSON.stringify(lowerRoutes([A, B, skater('P1', 1)])) === JSON.stringify(out), true);
}
{ // hops is clamped, so a hand-written drill can't ask for a million laps
  const A = route({ next: 'R2', hops: 9999 }), B = routeB({ next: 'R1', hops: 9999 });
  const legs = lowerRoutes([A, B, skater('P1', 1)]).find(p => p.id === 'P1').path;
  T('hops clamps to HOPS_MAX', laps(legs), HOPS_MAX);
  T('the leg cap is never exceeded', legs.length <= LINE_LEG_CAP, true);
}
{ // a net between the two routes must be skated around, not through
  const A = route({ x: 30, y: 42, path: [{ type: 'L', x: 60, y: 42 }], next: 'R2' });
  const B = routeB({ x: 160, y: 42, path: [{ type: 'L', x: 180, y: 42 }] });
  const net = { id: 'N1', kind: 'net', x: 110, y: 42, facing: 0, size: 1 };
  const legs = lowerRoutes([A, B, net, skater('P1', 1)]).find(p => p.id === 'P1').path;
  const discs = transitObstacles([A, B, net, skater('P1', 1)]);
  const d = discs[0];
  T('an obstacle disc was found for the net', !!d && d.r > 0, true);
  T('no transit waypoint sits inside the net',
    legs.filter(s => s.transit).every(s => Math.hypot(s.x - d.cx, s.y - d.cy) >= d.r), true);
  T('the detour did not collapse to a straight line', legs.filter(s => s.transit).length >= 2, true);
}
{ // branches and recycling don't compose yet — stop rather than splice wrongly
  const A = route({ next: 'R2', forks: [{ color: '#2ea043', at: 1, path: [{ type: 'L', x: 150, y: 20 }], forks: [] }] });
  const legs = lowerRoutes([A, routeB(), skater('P1', 1)]).find(p => p.id === 'P1').path;
  T('a branching route does not recycle', legs.some(s => s.transit), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
