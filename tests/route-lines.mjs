import { QUEUE_GAP, QUEUE_LEAD, queueOf, isMobile, headHeading, stackSpot, queueRelease, transitObstacles, chainOf, lowerRoutes } from '../src/route-lines.js';
import { TRANSIT_RATE, REPS_MAX, LINE_LEG_CAP, CROSSING_DASH } from '../src/constants.js';
import { readFileSync } from 'node:fs';
const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// a path running due east from (60,40): head at 60,40 then two straight legs
const path = (over = {}) => ({
  id: 'R1', kind: 'path', x: 60, y: 40, color: '#2f9e57', gap: 5, forks: [],
  path: [{ type: 'L', x: 100, y: 40 }, { type: 'L', x: 140, y: 60 }],
  ...over,
});
const skater = (id, q, over = {}) => ({ id, kind: 'player', x: 0, y: 0, pathId: 'R1', q, path: [], forks: [], ...over });

// ---- queueOf ----
{
  const ps = [path(), skater('P3', 3), skater('P1', 1), skater('P2', 2)];
  T('queueOf sorts by q', queueOf(ps, 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
  T('queueOf ignores other routes', queueOf([...ps, { id: 'PX', kind: 'player', pathId: 'R9', q: 1 }], 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
  T('queueOf ignores non-players', queueOf([...ps, { id: 'PKX', kind: 'puck', pathId: 'R1', q: 0 }], 'R1').map(p => p.id), ['P1', 'P2', 'P3']);
}
{ // a missing q falls to the back; ties break on id so the stack never jitters
  const ps = [path(), skater('PB', undefined), skater('PA', undefined), skater('P1', 1)];
  T('missing q sorts last, ties by id', queueOf(ps, 'R1').map(p => p.id), ['P1', 'PA', 'PB']);
}

// ---- isMobile ----
T('isMobile: bare player is not', isMobile({ kind: 'player', path: [] }), false);
T('isMobile: own path counts', isMobile({ kind: 'player', path: [{}] }), true);
T('isMobile: a path binding counts', isMobile({ kind: 'player', path: [], pathId: 'R1' }), true);
T('isMobile: forks count', isMobile({ kind: 'player', path: [], forks: [{}] }), true);
T('isMobile: null is not', isMobile(null), false);

// ---- headHeading ----
{
  const h = headHeading(path());
  T('headHeading points along leg 0', [near(h.x, 1), near(h.y, 0)], [true, true]);
  const north = headHeading(path({ path: [{ type: 'L', x: 60, y: 0 }] }));
  T('headHeading follows a turn', [near(north.x, 0), near(north.y, -1)], [true, true]);
  const bare = headHeading({ id: 'R', kind: 'path', x: 10, y: 10, path: [], facing: 180 });
  T('pathless path falls back to facing', [near(bare.x, -1), near(bare.y, 0)], [true, true]);
}

// ---- stackSpot ----
{
  const R = path();
  const spots = [0, 1, 2, 3].map(k => stackSpot(R, k, 5));
  T('head stands on the path start', [spots[0].x, spots[0].y], [60, 40]);
  T('the line stacks backwards, evenly', spots.map(s => Math.round(s.x)), [60, 55, 50, 45]);
  T('the line stays on one row', spots.every(s => near(s.y, 40)), true);
  T('gap defaults when absent', Math.round(stackSpot(R, 1).x), 60 - QUEUE_GAP);
  T('a zero gap falls back rather than piling up', Math.round(stackSpot(R, 2, 0).x), 60 - 2 * QUEUE_GAP);
}
{ // aimed into the end boards: spots clamp onto the ice instead of running off it
  const R = path({ x: 6, y: 40, path: [{ type: 'L', x: 40, y: 40 }] });
  const spots = [0, 1, 2, 3].map(k => stackSpot(R, k, 5));
  T('stack clamps inside the boards', spots.every(s => s.x >= 0 && s.x <= 200), true);
}

// ---- lowerRoutes ----
{ // the fast path every pre-route drill takes
  const ps = [{ id: 'P1', kind: 'player', x: 10, y: 10, path: [{ type: 'L', x: 20, y: 20 }] }];
  T('no path on the board → same array by identity', lowerRoutes(ps) === ps, true);
  T('undefined is tolerated', lowerRoutes(undefined), undefined);
}
{
  const R = path();
  const ps = [R, skater('P1', 1), skater('P2', 2), skater('P3', 3), { id: 'N1', kind: 'net', x: 189, y: 42 }];
  const out = lowerRoutes(ps);

  T('route pieces never reach the engine', out.some(p => p.kind === 'path'), false);
  T('non-players pass through untouched', out.find(p => p.id === 'N1') === ps[4], true);
  T('every member is lowered', out.filter(p => p.kind === 'player').length, 3);

  const [p1, p2, p3] = ['P1', 'P2', 'P3'].map(id => out.find(p => p.id === id));
  T('members get the path legs', p1.path.length, R.path.length);
  // the index-preservation invariant the whole design rests on
  T('waypoint i of the path is leg i of every member',
    out.filter(p => p.kind === 'player').every(p => p.path.every((s, i) => s.x === R.path[i].x && s.y === R.path[i].y)), true);
  T('the head departs from the path start', [p1.x, p1.y], [60, 40]);
  T('the rest stand back in order', [Math.round(p2.x), Math.round(p3.x)], [55, 50]);
  T('_line records the binding', [p1._line, p3._line], [{ path: 'R1', q: 0 }, { path: 'R1', q: 2 }]);
  T('legs are copies, not shared with the route', p1.path[0] !== R.path[0] && p1.path[0] !== p2.path[0], true);
}
{ // a binding that points at nothing leaves the player alone
  const ps = [path(), { id: 'PX', kind: 'player', x: 5, y: 5, pathId: 'R9', q: 1, path: [] }];
  const out = lowerRoutes(ps);
  T('dangling path binding is inert', [out.find(p => p.id === 'PX').x, out.find(p => p.id === 'PX')._line], [5, undefined]);
}
{ // a bound player's own path loses to the path — the binding is the source of truth
  const ps = [path(), skater('P1', 1, { path: [{ type: 'L', x: 1, y: 1 }] })];
  T('the path wins over a stale hand-drawn path', lowerRoutes(ps).find(p => p.id === 'P1').path.length, 2);
}
{ // a path with no line on it just disappears
  const ps = [path(), { id: 'P9', kind: 'player', x: 5, y: 5, path: [] }];
  const out = lowerRoutes(ps);
  T('an empty path drops, its neighbours survive', out.map(p => p.id), ['P9']);
}
{ // determinism — no Math.random, no Date
  const ps = [path(), skater('P1', 1), skater('P2', 2)];
  T('lowering is deterministic', JSON.stringify(lowerRoutes(ps)) === JSON.stringify(lowerRoutes(ps)), true);
}

// ---- queueRelease: how the line takes its turns ----
{
  T('no rule → nobody is held', queueRelease(path(), 'P1'), null);
  T('the head is never held', queueRelease(path({ queue: { mode: 'lead', lead: 15 } }), null), null);
  T('a point rule lowers to the waypoint trigger timing.js already has',
    queueRelease(path({ queue: { mode: 'point', at: 1 } }), 'P1'), { on: 'P1', at: 1, mode: 'waypoint' });
  // the two already stand `gap` apart, so what the one ahead must TRAVEL to open a
  // 15 ft separation is 15 − 6. Getting this backwards is a silent 2× on the gap.
  T('a lead rule converts separation to travel',
    queueRelease(path({ gap: 6, queue: { mode: 'lead', lead: 15 } }), 'P1'), { on: 'P1', dist: 9, mode: 'span' });
  T('a lead already covered by the spacing releases at once',
    queueRelease(path({ gap: 6, queue: { mode: 'lead', lead: 4 } }), 'P1').dist, 0);
  T('a lead rule defaults its distance',
    queueRelease(path({ gap: 5, queue: { mode: 'lead' } }), 'P1').dist, QUEUE_LEAD - 5);
  T('an unknown rule holds nobody', queueRelease(path({ queue: { mode: 'wat' } }), 'P1'), null);
}
{ // lowering wires each member to the one directly ahead — a strict chain to the head
  const R = path({ queue: { mode: 'lead', lead: 15 } });
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
  const R = path({ queue: { mode: 'point', at: 0 } });
  const out = lowerRoutes([R, skater('P1', 1), skater('P2', 2, { wait: { on: 'PX', at: 3, mode: 'waypoint' } })]);
  T('the line owns the release, not the member', out.find(p => p.id === 'P2').wait, { on: 'P1', at: 0, mode: 'waypoint' });
}
{ // a line with no rule still lowers cleanly — everyone goes at once, as before
  const out = lowerRoutes([path(), skater('P1', 1), skater('P2', 2)]);
  T('no rule leaves every member unheld', out.filter(p => p.kind === 'player').every(p => p.wait === null), true);
}

// ---- recycling: next= / hops= ----
// one "lap" = one maximal run of transit legs, since a single crossing may be
// simplified into several
const laps = legs => legs.reduce((n, s, i) => n + (s.transit && !(legs[i - 1] || {}).transit ? 1 : 0), 0);
const pathB = (over = {}) => ({
  id: 'R2', kind: 'path', x: 160, y: 70, color: '#3f7f8c', forks: [],
  path: [{ type: 'L', x: 120, y: 70 }],
  ...over,
});
{
  const A = path({ next: 'R2' }), B = pathB();
  const out = lowerRoutes([A, B, skater('P1', 1)]);
  const legs = out.find(p => p.id === 'P1').path;
  T('a recycled skater gets more legs than one route', legs.length > A.path.length, true);
  T('the transit legs are marked', legs.some(s => s.transit), true);
  // a skater carries their speed across rather than dropping to a fixed glide
  T('the crossing is skated at the pace they came off at', legs.filter(s => s.transit).every(s => s.rate === 1), true);
  T('the last leg is the destination route\'s last waypoint',
    [legs[legs.length - 1].x, legs[legs.length - 1].y], [120, 70]);
  T('the destination legs are not marked transit',
    legs[legs.length - 1].transit, undefined);
  // the transit has to actually START where the first path ended
  const firstTransit = legs.findIndex(s => s.transit);
  T('transit departs from the end of path A', [legs[firstTransit - 1].x, legs[firstTransit - 1].y], [140, 60]);
}
{ // next= pointing at nothing is inert
  const out = lowerRoutes([path({ next: 'R9' }), skater('P1', 1)]);
  T('a dangling next= just ends the route', out.find(p => p.id === 'P1').path.length, 2);
}
{ // hops=0 draws the link but does not run it
  const out = lowerRoutes([path({ next: 'R2', reps: 0 }), pathB(), skater('P1', 1)]);
  T('reps below 1 still runs it once', out.find(p => p.id === 'P1').path.length >= 2, true);
}
{ // THE termination case: two routes pointing at each other is how a full-ice
  // drill is actually drawn, and it must not hang or grow without bound
  const A = path({ next: 'R2', reps: 4 }), B = pathB({ next: 'R1', reps: 4 });
  const out = lowerRoutes([A, B, skater('P1', 1)]);
  const legs = out.find(p => p.id === 'P1').path;
  T('a next= cycle terminates', legs.length > 0 && legs.length < LINE_LEG_CAP, true);
  T('it runs the reps asked for', laps(legs) >= 3, true);
  T('a cycle is still deterministic', JSON.stringify(lowerRoutes([A, B, skater('P1', 1)])) === JSON.stringify(out), true);
}
{ // hops is clamped, so a hand-written drill can't ask for a million laps
  const A = path({ next: 'R2', reps: 9999 }), B = pathB({ next: 'R1', reps: 9999 });
  const legs = lowerRoutes([A, B, skater('P1', 1)]).find(p => p.id === 'P1').path;
  T('reps clamp to REPS_MAX', laps(legs) <= REPS_MAX * 2, true);
  T('the leg cap is never exceeded', legs.length <= LINE_LEG_CAP, true);
}
{ // a net between the two routes must be skated around, not through
  const A = path({ x: 30, y: 42, path: [{ type: 'L', x: 60, y: 42 }], next: 'R2' });
  const B = pathB({ x: 160, y: 42, path: [{ type: 'L', x: 180, y: 42 }] });
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
  const A = path({ next: 'R2', forks: [{ color: '#2ea043', at: 1, path: [{ type: 'L', x: 150, y: 20 }], forks: [] }] });
  const legs = lowerRoutes([A, pathB(), skater('P1', 1)]).find(p => p.id === 'P1').path;
  T('a branching path does not recycle', legs.some(s => s.transit), false);
}

// ---- the line's puck work ----
// The rule: a skater does the route's puck work only if a puck is actually
// available to them. Otherwise they run the path empty-handed.
const puck = (id, x, y, over = {}) => ({ id, kind: 'puck', x, y, carrier: null, pickup: null, transfers: [], ...over });
// the head skater collects a puck at the start and shoots it at point 2
const tmpl = (id, x, y) => puck(id, x, y, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 1, ref: '' }] });
const chainSig = (out, id) => { const p = out.find(q => q.id === id); return [p.pickup && p.pickup.to, (p.terminals || []).map(t => t.kind + '@' + t.at).join()]; };

{ // a full pile: everyone on the line gets the same rep
  const ps = [path(), skater('P1', 1), skater('P2', 2), skater('P3', 3),
    tmpl('PK1', 59, 40), puck('PK2', 54, 41), puck('PK3', 49, 41)];
  const out = lowerRoutes(ps);
  T('the head keeps its own chain', chainSig(out, 'PK1'), ['P1', 'shot@1']);
  T('the second skater gets the same work', chainSig(out, 'PK2'), ['P2', 'shot@1']);
  T('the third too', chainSig(out, 'PK3'), ['P3', 'shot@1']);
  T('a shared puck keeps its own spot in the pile', [out.find(q => q.id === 'PK2').x, out.find(q => q.id === 'PK2').y], [54, 41]);
}
{ // the gate: not enough pucks, so the back of the line skates it empty-handed
  const ps = [path(), skater('P1', 1), skater('P2', 2), skater('P3', 3),
    tmpl('PK1', 59, 40), puck('PK2', 54, 41)];
  const out = lowerRoutes(ps);
  T('a skater with a puck gets the work', chainSig(out, 'PK2'), ['P2', 'shot@1']);
  T('a skater with no puck gets no chain, and just skates',
    out.filter(q => q.kind === 'puck' && q.pickup && q.pickup.to === 'P3').length, 0);
  T('the spare pool is never over-drawn', out.filter(q => q.kind === 'puck' && q.pickup).length, 2);
}
{ // no pile at all — the line runs, only the head does puck work
  const ps = [path(), skater('P1', 1), skater('P2', 2), tmpl('PK1', 59, 40)];
  const out = lowerRoutes(ps);
  T('with no spare pucks only the head has a chain', out.filter(q => q.kind === 'puck' && q.pickup).length, 1);
  T('the rest still skate the route', out.find(q => q.id === 'P2').path.length, 2);
}
{ // a puck already busy elsewhere is not in the pile
  const ps = [path(), skater('P1', 1), skater('P2', 2), tmpl('PK1', 59, 40),
    puck('PKX', 55, 41, { carrier: 'PZ' })];
  T('a carried puck is not spare', lowerRoutes(ps).filter(q => q.kind === 'puck' && q.pickup).length, 1);
  const ps2 = [path(), skater('P1', 1), skater('P2', 2), tmpl('PK1', 59, 40),
    puck('PKY', 55, 41, { transfers: [{ at: 0, to: 'PZ', kind: 'pass' }] })];
  T('a puck already in a chain is not spare', lowerRoutes(ps2).filter(q => q.kind === 'puck' && q.pickup).length, 1);
}
{ // passes to someone OFF the line are left alone — three skaters feeding one
  // net or one F4 is the drill, not a bug
  const ps = [path(), skater('P1', 1), skater('P2', 2),
    puck('PK1', 59, 40, { pickup: { to: 'P1', at: -1 }, transfers: [{ at: 0, to: 'F4', recvAt: null, kind: 'pass' }] }),
    puck('PK2', 54, 41)];
  const out = lowerRoutes(ps);
  T('the replicated chain still feeds the same target', out.find(q => q.id === 'PK2').transfers[0].to, 'F4');
  T('...but is collected by the new skater', out.find(q => q.id === 'PK2').pickup.to, 'P2');
}
{ // a chain that starts ON the blade replicates too
  const ps = [path(), skater('P1', 1), skater('P2', 2),
    puck('PK1', 60, 40, { carrier: 'P1', terminals: [{ kind: 'shot', at: 1, ref: '' }] }),
    puck('PK2', 54, 41)];
  T('a carried chain replicates to the next skater', lowerRoutes(ps).find(q => q.id === 'PK2').carrier, 'P2');
}
{ // nothing to share, nothing to do
  const ps = [path(), skater('P1', 1), puck('PK1', 54, 41)];
  const out = lowerRoutes(ps);
  T('a one-skater line shares nothing', out.find(q => q.id === 'PK1').pickup, null);
  T('sharing is deterministic', JSON.stringify(lowerRoutes(ps)) === JSON.stringify(out), true);
}

// ---- the work replays on every LAP, not just the first ----
// A recirculating skater comes back through the line and takes another rep. The
// authored chain only indexes lap 1, so without this they skate laps 2+ empty.
{
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }, { type: 'L', x: 140, y: 36 }], next: 'R2', reps: 3 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3 });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 1, ref: '' }] });
  const ps = [A, B, P, tpl, puck('PK2', 28, 26), puck('PK3', 25, 26)];
  const out = lowerRoutes(ps);
  const legs = out.find(p => p.id === 'P1').path;
  // reps=3 → three passes over the whole A->B chain. Laps of R1 begin at 0, 5, 10.
  T('the recirculation is laid out as expected', legs.map(s => (s.transit ? 't' : 'R')).join(''), 'RRtRtRRtRtRRtR');

  const chains = out.filter(p => p.kind === 'puck' && (p.pickup || (p.terminals || []).length))
    .map(p => [p.pickup && p.pickup.at, (p.terminals || [])[0] && p.terminals[0].at]);
  T('lap 1 keeps the authored indices', chains[0], [-1, 1]);
  T('lap 2 is the same work shifted onto its own legs', chains[1], [4, 6]);
  T('every pass consumes another puck', chains.length, 3);
  // the collect lands on the transit leg ARRIVING at the head — where the pile is
  T('the lap-2 collect happens as they rejoin the line', legs[4].transit, true);
  T('the lap-2 shot happens on the route, not in transit', legs[6].transit, undefined);
}
{ // laps of the path it recycles INTO must not replay this route's indices
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 1 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }] });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 0, ref: '' }] });
  const out = lowerRoutes([A, B, P, tpl, puck('PK2', 28, 26)]);
  T('a lap of the NEXT path does not replay this one\'s work',
    out.filter(p => p.kind === 'puck' && (p.pickup || (p.terminals || []).length)).length, 1);
}
{ // the pile still governs: no puck, no rep — laps don't conjure them
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 3 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3 });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 0, ref: '' }] });
  const out = lowerRoutes([A, B, P, tpl]);      // no spares at all
  T('with an empty pile only the authored rep happens',
    out.filter(p => p.kind === 'puck' && (p.pickup || (p.terminals || []).length)).length, 1);
}
{ // skaters before laps: everyone gets a first rep before anyone gets a second
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 3 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3 });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 0, ref: '' }] });
  const out = lowerRoutes([A, B, mk('P1', 1), mk('P2', 2), tpl, puck('PK2', 28, 26)]);
  const owners = out.filter(p => p.kind === 'puck' && p.pickup).map(p => p.pickup.to).sort();
  T('the one spare goes to the second SKATER, not the first skater\'s second lap', owners, ['P1', 'P2']);
}

// ---- feed: the path supplies its own pucks ----
{
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 3, feed: true });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3 });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 0, ref: '' }] });
  const out = lowerRoutes([A, B, mk('P1', 1), mk('P2', 2), mk('P3', 3), tpl]);   // NO spares placed
  const chains = out.filter(p => p.kind === 'puck' && p.pickup);
  T('feeding supplies a puck for every rep', chains.length, 9);   // 3 skaters x 3 passes over R1
  T('every skater gets one', [...new Set(chains.map(c => c.pickup.to))].sort(), ['P1', 'P2', 'P3']);
  const madeUp = out.filter(p => p.fed);
  T('the fed pucks are new pieces, marked as such', madeUp.length, 8);
  T('they get unique ids', new Set(madeUp.map(p => p.id)).size, 8);
  T('their ids are namespaced to the route', madeUp.every(p => p.id.startsWith('R1~')), true);
  T('they sit near the head they are fed at, on the ice',
    madeUp.every(p => p.x >= 0 && p.x <= 200 && p.y >= 0 && p.y <= 85), true);
  T('feeding is deterministic', JSON.stringify(lowerRoutes([A, B, mk('P1', 1), mk('P2', 2), mk('P3', 3), tpl])) === JSON.stringify(out), true);
}
{ // feed only ever fires where there is authored puck work to repeat
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], feed: true });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const out = lowerRoutes([A, mk('P1', 1), mk('P2', 2), mk('P3', 3)]);
  T('a line with no puck work is never fed', out.some(p => p.fed), false);
  T('...and no stray pucks appear', out.filter(p => p.kind === 'puck').length, 0);
}
{ // placed pucks are used before any are conjured
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], feed: true });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 } });
  const out = lowerRoutes([A, mk('P1', 1), mk('P2', 2), mk('P3', 3), tpl, puck('PK2', 28, 26)]);
  T('the placed spare is used first', out.find(p => p.id === 'PK2').pickup.to, 'P2');
  T('only the shortfall is fed', out.filter(p => p.fed).length, 1);
}
{ // feed off is the old behaviour, unchanged
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }] });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 } });
  const out = lowerRoutes([A, mk('P1', 1), mk('P2', 2), tpl]);
  T('without feed, a short pile just means skating empty', out.some(p => p.fed), false);
  T('...and only the authored rep has a chain', out.filter(p => p.kind === 'puck' && p.pickup).length, 1);
}

// ---- a crossing inherits the pace off the path before it ----
{
  const fast = path({ id: 'R1', x: 30, y: 22, next: 'R2',
    path: [{ type: 'L', x: 90, y: 22, rate: 1 }, { type: 'L', x: 140, y: 36, rate: 1.6 }] });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }] });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const t = lowerRoutes([fast, B, P]).find(p => p.id === 'P1').path.filter(s => s.transit);
  T('the crossing takes the last leg\'s pace', t.length && t.every(s => s.rate === 1.6), true);
  // ...unless the path says otherwise
  const slow = lowerRoutes([{ ...fast, regroup: 0.4 }, B, P]).find(p => p.id === 'P1').path.filter(s => s.transit);
  T('an explicit regroup still wins', slow.every(s => s.rate === 0.4), true);
}

// ---- reps: a pass through the WHOLE chain, not a link ----
{
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }] });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1' });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const shape = over => lowerRoutes([{ ...A, ...over }, B, P]).find(p => p.id === 'P1').path
    .map(s => (s.transit ? 't' : 'R')).join('');
  // A -> B and back is ONE rep: the thing a coach counts is the lap, not the links
  T('one rep is one pass through the chain', shape({ next: 'R2' }), 'RtR');
  T('two reps run the chain twice', shape({ next: 'R2', reps: 2 }), 'RtRtRtR');
  T('three reps run it three times', shape({ next: 'R2', reps: 3 }), 'RtRtRtRtRtR');
}
{ // a path joined to nothing still repeats — "again" means back to its own head
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }] });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const shape = n => lowerRoutes([{ ...A, reps: n }, P]).find(p => p.id === 'P1').path
    .map(s => (s.transit ? 't' : 'R')).join('');
  T('a lone path runs once by default', shape(undefined), 'R');
  T('a lone path with 2 reps loops back to its own start', shape(2), 'RtR');
  T('...and again for 3', shape(3), 'RtRtR');
}
{ // the count belongs to the CHAIN, so every path in it reports the same one
  const ps = [
    { id: 'R1', kind: 'path', x: 30, y: 22, forks: [], next: 'R2' },
    { id: 'R2', kind: 'path', x: 90, y: 22, forks: [], next: 'R1' },
    { id: 'R9', kind: 'path', x: 10, y: 70, forks: [] },
  ];
  T('a loop is one chain', [...chainOf(ps, 'R1')].sort(), ['R1', 'R2']);
  T('...reachable from either end', [...chainOf(ps, 'R2')].sort(), ['R1', 'R2']);
  T('an unconnected path is its own chain', [...chainOf(ps, 'R9')], ['R9']);
  T('a missing id yields nothing', [...chainOf(ps, 'NOPE')], []);
}

// ---- connector: the crossing, made editable ----
{
  // A -> C(connector, shaped by hand) -> B, with A asking for a single hop
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'RC', reps: 1 });
  const C = { id: 'RC', kind: 'path', x: 90, y: 22, color: '#3f7f8c', forks: [], connector: true, next: 'R2',
    // seeded the way shapeCrossing does: starts on A's end, finishes on B's head
    path: [{ type: 'L', x: 95, y: 60 }, { type: 'L', x: 120, y: 66 }, { type: 'L', x: 150, y: 66 }] };
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 190, y: 70 }] });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const legs = lowerRoutes([A, C, B, P]).find(p => p.id === 'P1').path;
  const at = (x, y) => legs.some(s => Math.abs(s.x - x) < 0.01 && Math.abs(s.y - y) < 0.01);
  T('the shaped crossing is skated, waypoint by waypoint', [at(95, 60), at(120, 66)], [true, true]);
  T('...and it still reaches the far route', at(190, 70), true);
  // the whole point: a connector must not eat the hop that gets you to B
  T('a connector is just part of the chain', legs[legs.length - 1].x, 190);
  T('sitting on both ends, it needs no auto-crossing of its own',
    legs.filter(s => s.transit).length, 0);
}
{ // without the connector flag it WOULD eat the hop — this is what the flag buys
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'RC', reps: 1 });
  const C = { id: 'RC', kind: 'path', x: 90, y: 22, color: '#3f7f8c', forks: [], next: 'R2',
    path: [{ type: 'L', x: 95, y: 60 }] };
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 190, y: 70 }] });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const legs = lowerRoutes([A, C, B, P]).find(p => p.id === 'P1').path;
  T('a plain path in the middle is walked like any other', legs.some(s => s.x === 190), true);
}
{ // a ring of connectors spends no hops at all, so the link counter is what ends it
  const mk = (id, next) => ({ id, kind: 'path', x: 30, y: 22, color: '#3f7f8c', forks: [], connector: true, next,
    path: [{ type: 'L', x: 60, y: 40 }] });
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'C1', reps: 2 });
  const P = { id: 'P1', kind: 'player', x: 30, y: 22, pathId: 'R1', q: 1, path: [], forks: [] };
  const legs = lowerRoutes([A, mk('C1', 'C2'), mk('C2', 'C1'), P]).find(p => p.id === 'P1').path;
  T('an all-connector cycle still terminates', legs.length > 0 && legs.length < LINE_LEG_CAP, true);
}

// ---- feed on a path the line only VISITS ----
// A leg of a recirculating drill has no line standing on it, so there is nobody to
// hand a puck to — but skaters do arrive there, and `feed` plainly means "pucks
// here". Everyone starting that lap collects one.
{
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 3 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3, feed: true });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 }, terminals: [{ kind: 'shot', at: 0, ref: '' }] });
  const out = lowerRoutes([A, B, mk('P1', 1), mk('P2', 2), tpl]);   // one spare short on purpose
  const fedAt = out.filter(p => p.fed && p.pickup).map(p => p.pickup.to).sort();
  T('a visited path feeds every skater who runs it', fedAt.length >= 2, true);
  T('...including ones the source line could not supply', new Set(fedAt).size, 2);
  // the exact regression: R1's pile ran dry first, and bailing out of the whole
  // pass there meant R2's feed never got a chance
  T('a dry pile upstream does not cancel a feed downstream', out.some(p => p.fed), true);
  // an action lives on a WAYPOINT: running through it holding a puck performs it,
  // so a puck collected at the regroup must still carry the shot when it comes
  // back round to the shooting point
  const withWork = out.filter(p => p.fed && (p.terminals || []).length);
  T('a fed puck carries the action it will run through', withWork.length >= 1, true);
  T('...aimed at the NEXT pass over the authored route, not this one',
    withWork.every(p => p.terminals[0].at > p.pickup.at), true);
}
{ // no feed anywhere → a visited path hands out nothing
  const A = path({ id: 'R1', x: 30, y: 22, path: [{ type: 'L', x: 90, y: 22 }], next: 'R2', reps: 3 });
  const B = pathB({ id: 'R2', x: 150, y: 66, path: [{ type: 'L', x: 90, y: 66 }], next: 'R1', reps: 3 });
  const mk = (id, q) => ({ id, kind: 'player', x: 30, y: 22, pathId: 'R1', q, path: [], forks: [] });
  const tpl = puck('PK1', 31, 26, { pickup: { to: 'P1', at: -1 } });
  T('an unfed visited path stays dry', lowerRoutes([A, B, mk('P1', 1), mk('P2', 2), tpl]).some(p => p.fed), false);
}

// ---- the crossing's own line style ----
// Dotted, so it reads as travel between reps rather than as a path (solid) or a
// pass (dashed). The board and the exported sheet draw it from ONE constant —
// this is the drift guard, in the spirit of tests/rink-views.mjs.
{
  T('the dash pattern is a dot: a near-zero mark on a long gap', /^0?\.\d+ \d/.test(CROSSING_DASH), true);
  T('it is not the pass dash', CROSSING_DASH !== '2.4 1.8', true);
  T('the board reads it from the constant', /CROSSING_DASH/.test(src('hockey-drill-animator.jsx')), true);
  T('the exported sheet reads the same constant', /CROSSING_DASH/.test(src('drill-svg.js')), true);
  T('neither hardcodes a crossing dash of its own',
    !/strokeDasharray="[\d.]+ [\d.]+"/.test(src('hockey-drill-animator.jsx').split('transitPoly')[1] || ''), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
