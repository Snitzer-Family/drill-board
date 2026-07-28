import { dirOf, dirAtWaypoint, spreadDir } from "../apps/board/src/route-dir.js";
import { parseDrill, serializeDrill } from "@coachvision/drill-core/drill-format.js";

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

// ---- "open up" survives the round-trip on every delivery form ----
{
  const src = `DSL 9
RINK full
PIECE N1 net 11 42.5
PIECE P1 player 20 20 #2ea043 P1
PATH P1 L 60,20
PIECE P2 player 80 40 #e5342b P2
PATH P2 L 120,40
PIECE P3 player 20 70 #1f4fa3 P3
PATH P3 L 60,70
PIECE P4 player 80 78 #d7263d P4
PATH P4 L 120,78
PIECE P5 player 150 20 #7a4fd6 P5
PATH P5 L 170,30
PIECE PK1 puck 18 20 #111 on=P1 pass=1:P2@1!+
PIECE PK2 puck 18 70 #111 on=P3 rim=1:P4@1~40+
PIECE PK3 puck 168 30 #111 pickup=P5@1*+`;
  const { pieces, errors } = parseDrill(src);
  T('open: parses', errors, []);
  const g = id => pieces.find(q => q.id === id);
  T('open: on a pass (with sauce)', [g('PK1').transfers[0].open, g('PK1').transfers[0].sauce], [true, true]);
  T('open: on a rim handoff (after the aim)', [g('PK2').transfers[0].open, g('PK2').transfers[0].aim], [true, 40]);
  T('open: on a nearest pickup', [g('PK3').pickup.open, g('PK3').pickup.nearest], [true, true]);
  const out = serializeDrill('full', pieces);
  T('open: serializes as a trailing +', [/pass=1:P2@1!\+/.test(out), /~40\+/.test(out), /pickup=P5@1\*\+/.test(out)], [true, true, true]);
  const again = parseDrill(out).pieces;
  const h = id => again.find(q => q.id === id);
  T('open: survives serialize', [h('PK1').transfers[0].open, h('PK2').transfers[0].open, h('PK3').pickup.open], [true, true, true]);
  // and a drill WITHOUT it must still round-trip byte-identically
  const plain = src.replace(/\+/g, '');
  T('open: absent stays absent', serializeDrill('full', parseDrill(plain).pieces).includes('+'), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
