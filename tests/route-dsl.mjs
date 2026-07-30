// DSL round-trip, with lines (route pieces + player bindings) as the motivating
// case. There was no round-trip suite before this; the CLAUDE.md rule that a model
// change touches parser AND serializer together had nothing mechanical enforcing
// it, so a half-landed field would round-trip to silent data loss.
import { readFileSync } from 'node:fs';
import { parseDrill, serializeDrill, extractDrill } from '../src/drill-format.js';
import { lowerRoutes } from '../src/route-lines.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ser = d => serializeDrill(d.rink, d.pieces, d.title, d.desc, d.steps, d.notes, d.items);
// parse → serialize → parse: the model on both sides must be identical
const trip = text => {
  const a = parseDrill(text), t1 = ser(a);
  const b = parseDrill(t1), t2 = ser(b);
  return { a, b, t1, t2 };
};

const LINE = [
  'RINK full',
  'PIECE R1 path 60 40 #3f7f8c Left_lane gap=6 queue=lead:18',
  'PATH R1 L 100,40 Q 130,25 150,40',
  'PIECE P1 player 60 40 #d7263d F1 path=R1 q=1',
  'PIECE P2 player 54 40 #2ea043 F2 path=R1 q=2',
  'PIECE P3 player 48 40 #1e6fd9 F3 path=R1 q=3',
  'PIECE N1 net 189 42 #c81e33 goalie',
].join('\n');

{ // the core guarantee
  const { a, b, t1, t2 } = trip(LINE);
  T('a line round-trips to an identical model', JSON.stringify(a) === JSON.stringify(b), true);
  T('serialization is a byte-stable fixed point', t1 === t2, true);
}
{ // every new field survives the trip with its value, not just its presence
  const { b } = trip(LINE);
  const R = b.pieces.find(p => p.id === 'R1');
  T('the path kind survives', [R.kind, R.gap, R.label], ['path', 6, 'Left_lane']);
  T('the path keeps its legs', R.path.map(s => s.type), ['L', 'Q']);
  T('bindings survive', b.pieces.filter(p => p.pathId).map(p => [p.id, p.pathId, p.q]),
    [['P1', 'R1', 0], ['P2', 'R1', 1], ['P3', 'R1', 2]]);
}
{ // q is 1-based on the wire and 0-based in memory, like every other index here
  T('q is 1-based on the wire', /\bq=1\b/.test(ser(parseDrill(LINE))), true);
  T('q is 0-based in memory', parseDrill(LINE).pieces.find(p => p.id === 'P1').q, 0);
}
{ // the default gap is never written, so a plain line stays terse
  const terse = 'RINK full\nPIECE R1 path 60 40 #3f7f8c\nPATH R1 L 100,40\nPIECE P1 player 60 40 #d7263d F1 path=R1 q=1';
  T('a default gap emits no token', /gap=/.test(ser(parseDrill(terse))), false);
  T('an absent gap parses as undefined, not 0', parseDrill(terse).pieces[0].gap, undefined);
}
{ // a pathless path still carries the heading its line stacks along
  const bare = 'RINK full\nPIECE R1 path 60 40 #3f7f8c face=180';
  T('a pathless path round-trips its facing', /face=180/.test(ser(parseDrill(bare))), true);
}
{ // garbage in the new fields must not throw — a drill from the future still loads
  const odd = 'RINK full\nPIECE R1 path 60 40 #3f7f8c gap=-2\nPIECE P1 player 10 10 #d7263d F1 path=R9 q=0';
  const d = parseDrill(odd);
  T('a negative gap is rejected, not stored', d.pieces.find(p => p.id === 'R1').gap, undefined);
  T('a zero q is rejected, not stored', d.pieces.find(p => p.id === 'P1').q, undefined);
  T('a dangling path= still loads', d.pieces.find(p => p.id === 'P1').pathId, 'R9');
}
{ // the line's turn-taking rule
  const R = trip(LINE).b.pieces.find(p => p.id === 'R1');
  T('a lead rule survives the trip', R.queue, { mode: 'lead', lead: 18 });
  const pt = parseDrill(LINE.replace('queue=lead:18', 'queue=point:3'));
  T('a point rule is 1-based on the wire, 0-based in memory', pt.pieces[0].queue, { mode: 'point', at: 2 });
  T('a point rule round-trips as written', /queue=point:3/.test(ser(pt)), true);
  // an absent rule means "all at once", so it must never be defaulted in
  const none = parseDrill(LINE.replace(' queue=lead:18', ''));
  T('no rule parses as no rule', none.pieces[0].queue, undefined);
  T('no rule emits no token', /queue=/.test(ser(none)), false);
  const bad = parseDrill(LINE.replace('queue=lead:18', 'queue=point:0'));
  T('a zero-point rule is rejected, not stored', bad.pieces[0].queue, undefined);
}
{ // feed: the path supplies its own pucks
  const f = LINE.replace('queue=lead:18', 'queue=lead:18 feed');
  const d = parseDrill(f);
  T('feed parses as a flag', d.pieces.find(p => p.id === 'R1').feed, true);
  T('feed round-trips', / feed\b/.test(ser(d)), true);
  T('feed is a fixed point', ser(parseDrill(ser(d))) === ser(d), true);
  T('no feed emits no token', / feed\b/.test(ser(parseDrill(LINE))), false);
  T('an unfed path has no feed field', parseDrill(LINE).pieces.find(p => p.id === 'R1').feed, undefined);
  // fed pucks are lowering-only and must never reach the drill text. Needs
  // authored puck work to repeat — feeding never invents a rep that wasn't asked for.
  const withWork = parseDrill(`${f}\nPIECE PK1 puck 61 44 #14171a pickup=P1@0 shoot=1`);
  const lowered = lowerRoutes(withWork.pieces);
  T('fed pucks exist in the lowered model', lowered.some(p => p.fed), true);
  T('...but the authored pieces are untouched', withWork.pieces.some(p => p.fed), false);
  T('...and never reach the drill text', / feed[0-9]|~feed/.test(ser(withWork)), false);
}
{ // the parser and the lowering pass agree on the model
  const out = lowerRoutes(parseDrill(LINE).pieces);
  T('a parsed line lowers to three skaters', out.filter(p => p.kind === 'player').length, 3);
  T('no path piece survives lowering', out.some(p => p.kind === 'path'), false);
  T('the parsed gap drives the stack', Math.round(out.find(p => p.id === 'P2').x), 54);
}

// ---- the legacy guard: a pre-route drill must be untouched by any of this ----
{
  const legacy = extractDrill(read('docs/example-drill.md'));
  T('the example drill still extracts', !!legacy && legacy.length > 0, true);
  const { a, b, t1, t2 } = trip(legacy);
  T('the example drill round-trips identically', JSON.stringify(a) === JSON.stringify(b), true);
  T('the example drill is a byte-stable fixed point', t1 === t2, true);
  T('no line tokens leak into a drill that has none', /\bpath=|\bq=\d|\bgap=/.test(t1), false);
  T('a drill with no path lowers by identity', lowerRoutes(a.pieces) === a.pieces, true);
}

{ // the ROUTE's name — the whole circuit, carried by every path in it
  const rn = LINE.replace('gap=6', 'gap=6 route=Full_ice_regroup');
  const d = parseDrill(rn);
  T('the route name parses, underscores as spaces', d.pieces[0].routeName, 'Full ice regroup');
  T('it round-trips', / route=Full_ice_regroup\b/.test(ser(d)), true);
  T('it is a fixed point', ser(parseDrill(ser(d))) === ser(d), true);
  T('an unnamed route writes no token', / route=/.test(ser(parseDrill(LINE))), false);
}
{ // recycling tokens
  const rc = 'RINK full\nPIECE R1 path 30 22 #3f7f8c A next=R2 reps=2 regroup=0.8\nPATH R1 L 90,22\nPIECE R2 path 170 66 #b06a2e B next=R1\nPATH R2 L 110,66\nPIECE P1 player 30 22 #d7263d F1 path=R1 q=1';
  const { a, b, t1, t2 } = trip(rc);
  T('recycling round-trips identically', JSON.stringify(a) === JSON.stringify(b), true);
  T('recycling is a byte-stable fixed point', t1 === t2, true);
  const R = b.pieces.find(p => p.id === 'R1');
  T('next/reps/regroup survive', [R.next, R.reps, R.regroup], ['R2', 2, 0.8]);
  T('a default reps emits no token', / reps=/.test(ser(parseDrill(rc.replace(' reps=2', '')))), false);
  // fresh start: `hops` is gone, not aliased
  T('the retired hops spelling is simply ignored', parseDrill(rc.replace('reps=2', 'hops=4')).pieces[0].reps, undefined);
  // the whole recirculation must become one path, bounded
  const legs = lowerRoutes(a.pieces).find(p => p.id === 'P1').path;
  T('a recirculating drill lowers to one bounded path', legs.length > 1 && legs.length < 200, true);
  T('the crossing is in there, marked', legs.some(s => s.transit), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
