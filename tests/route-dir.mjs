import { dirOf, dirAtWaypoint, spreadDir } from '../src/route-dir.js';
import { parseDrill, serializeDrill } from '../src/drill-format.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// a path of n legs, "ffbbf" style spec → segments
const P = spec => [...spec].map((c, i) => ({ type: 'L', x: i * 10, y: 0, dir: c === 'b' ? 'bwd' : 'fwd' }));
// segments → "ffbbf"
const S = segs => segs.map(s => dirOf(s)[0]).join('');

// ---- basics ----
T('dirOf defaults to fwd', [dirOf(undefined), dirOf({}), dirOf({ dir: 'bwd' })], ['fwd', 'fwd', 'bwd']);
T('dirAtWaypoint: origin is fwd', dirAtWaypoint(P('bb'), -1), 'fwd');
T('dirAtWaypoint: reads the leg', dirAtWaypoint(P('fb'), 1), 'bwd');
T('dirAtWaypoint: past the end is fwd', dirAtWaypoint(P('bb'), 9), 'fwd');

{ // out of range / empty → identity, untouched
  const segs = P('fff');
  const r = spreadDir(segs, [], 5, 'bwd');
  T('index past the end → identity', [r.changed, r.path === segs], [false, true]);
  T('empty path → identity', spreadDir([], [], 0, 'bwd').changed, false);
  T('missing path → identity', spreadDir(null, [], 0, 'bwd').changed, false);
  T('bogus dir → identity', spreadDir(segs, [], 0, 'sideways').changed, false);
}

{ // the core rule: the run carries to the end
  const r = spreadDir(P('fffff'), [], 2, 'bwd');
  T('run reaches the end', S(r.path), 'ffbbb');
  T('run reports changed', r.changed, true);
}

{ // a later explicit flip stops the run
  const r = spreadDir(P('fffbf'), [], 1, 'bwd');
  T('run stops at a later explicit flip', S(r.path), 'fbbbf');
}

{ // flipping back rewrites only from there on
  const first = spreadDir(P('fffff'), [], 1, 'bwd');
  const second = spreadDir(first.path, [], 3, 'fwd');
  T('flip back at a later point', [S(first.path), S(second.path)], ['fbbbb', 'fbbff']);
  // and the earlier boundary survives a re-flip of the head
  const third = spreadDir(second.path, [], 1, 'fwd');
  T('re-flipping the head keeps the later boundary', S(third.path), 'fffff');
}

{ // idempotent — same value, same arrays back
  const segs = P('fbbb'), forks = [];
  const r = spreadDir(segs, forks, 1, 'bwd');
  T('re-setting the same direction is a no-op', [r.changed, r.path === segs, r.forks === forks], [false, true, true]);
  const single = spreadDir(P('f'), [], 0, 'bwd');
  T('single-leg path', S(single.path), 'b');
}

// ---- branches ----
const F = (at, spec, kids = []) => ({ color: '#2ea043', action: 'skate', at, path: P(spec), forks: kids });

{ // a branch follows its SIBLING leg (at+1); rewritten only when that leg is in the run
  const forks = [F(0, 'ff'), F(3, 'ff'), F(4, 'ff')];
  const r = spreadDir(P('fffbf'), forks, 1, 'bwd');   // run covers legs 1..2 (leg 3 is an explicit flip)
  T('run + branch: legs', S(r.path), 'fbbbf');
  T('branch at 0 (sibling leg 1, in the run) rewritten', S(r.forks[0].path), 'bb');
  // its sibling is leg 4, which the run never reached — leg 3's own explicit flip owns that stretch
  T('branch at 3 (sibling leg 4, past the run) untouched', [S(r.forks[1].path), r.forks[1] === forks[1]], ['ff', true]);
  T('branch at 4 (past the run) untouched', [S(r.forks[2].path), r.forks[2] === forks[2]], ['ff', true]);
}

{ // a branch upstream of the flip is untouched
  const forks = [F(0, 'ff')];
  const r = spreadDir(P('ffff'), forks, 2, 'bwd');    // run covers legs 2..3, waypoints 1..3
  T('branch upstream of the flip untouched', [S(r.forks[0].path), r.forks[0] === forks[0]], ['ff', true]);
}

{ // `at == null` means the route end — only in when the run gets there
  const reach = spreadDir(P('fff'), [F(null, 'ff')], 1, 'bwd');
  T('branch off the end, run reaches it', S(reach.forks[0].path), 'bb');
  const stop = spreadDir(P('fffbf'), [F(null, 'ff')], 1, 'bwd');
  T('branch off the end, run stopped short', S(stop.forks[0].path), 'ff');
}

{ // a branch that was flipped on its own keeps its whole subtree
  const forks = [F(1, 'bb', [F(1, 'bb')])];
  const r = spreadDir(P('fff'), forks, 0, 'bwd');
  T('explicitly-flipped branch left alone', r.forks[0] === forks[0], true);
  // ...but the same branch DOES follow when it matches the old direction
  const forks2 = [F(1, 'ff', [F(1, 'ff')])];
  const r2 = spreadDir(P('fff'), forks2, 0, 'bwd');
  T('nested branch recursion', [S(r2.forks[0].path), S(r2.forks[0].forks[0].path)], ['bb', 'bb']);
}

{ // a nested branch whose `at` is outside its parent's run stays put
  const forks = [F(0, 'ffbf', [F(0, 'ff'), F(3, 'ff')])];
  const r = spreadDir(P('ff'), forks, 0, 'bwd');
  T('nested: parent run stops inside the branch', S(r.forks[0].path), 'bbbf');
  T('nested: child inside the run follows', S(r.forks[0].forks[0].path), 'bb');
  T('nested: child past the run stays', S(r.forks[0].forks[1].path), 'ff');
}

{ // degenerate branches must not crash
  const forks = [{ color: '#111', path: [], forks: [] }, F(99, 'ff'), null];
  const r = spreadDir(P('ff'), forks, 0, 'bwd');
  T('empty / stale-at / null branches survive', [S(r.path), S(r.forks[1].path), r.forks[2]], ['bb', 'bb', null]);
}

// ---- DSL round-trip: dense per-leg dir + the new TURN token survive ----
{
  const src = `DSL 9
RINK full
PIECE P1 player 20 20 #2ea043 P1
PATH P1 L 40,20 BWD TURN left L 60,20 BWD L 80,20 L 100,20
BRANCH P1 2ea043 at=2 BWD L 60,50 BWD L 80,50`;
  const { pieces, errors } = parseDrill(src);
  T('round-trip: parses', errors, []);
  const p = pieces.find(q => q.id === 'P1');
  T('round-trip: leg dirs', S(p.path), 'fbbf');
  T('round-trip: turn on the flip leg', [p.path[1].turn, p.path[0].turn], ['left', undefined]);
  T('round-trip: branch dirs', S(p.forks[0].path), 'bb');
  const again = parseDrill(serializeDrill('full', pieces)).pieces.find(q => q.id === 'P1');
  T('round-trip: survives serialize', [S(again.path), again.path[1].turn, S(again.forks[0].path)], ['fbbf', 'left', 'bb']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
