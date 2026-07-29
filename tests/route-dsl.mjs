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
  'PIECE R1 route 60 40 #3f7f8c Left_lane gap=6',
  'PATH R1 L 100,40 Q 130,25 150,40',
  'PIECE P1 player 60 40 #d7263d F1 route=R1 q=1',
  'PIECE P2 player 54 40 #2ea043 F2 route=R1 q=2',
  'PIECE P3 player 48 40 #1e6fd9 F3 route=R1 q=3',
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
  T('the route kind survives', [R.kind, R.gap, R.label], ['route', 6, 'Left_lane']);
  T('the route keeps its legs', R.path.map(s => s.type), ['L', 'Q']);
  T('bindings survive', b.pieces.filter(p => p.route).map(p => [p.id, p.route, p.q]),
    [['P1', 'R1', 0], ['P2', 'R1', 1], ['P3', 'R1', 2]]);
}
{ // q is 1-based on the wire and 0-based in memory, like every other index here
  T('q is 1-based on the wire', /\bq=1\b/.test(ser(parseDrill(LINE))), true);
  T('q is 0-based in memory', parseDrill(LINE).pieces.find(p => p.id === 'P1').q, 0);
}
{ // the default gap is never written, so a plain line stays terse
  const terse = 'RINK full\nPIECE R1 route 60 40 #3f7f8c\nPATH R1 L 100,40\nPIECE P1 player 60 40 #d7263d F1 route=R1 q=1';
  T('a default gap emits no token', /gap=/.test(ser(parseDrill(terse))), false);
  T('an absent gap parses as undefined, not 0', parseDrill(terse).pieces[0].gap, undefined);
}
{ // a pathless route still carries the heading its line stacks along
  const bare = 'RINK full\nPIECE R1 route 60 40 #3f7f8c face=180';
  T('a pathless route round-trips its facing', /face=180/.test(ser(parseDrill(bare))), true);
}
{ // garbage in the new fields must not throw — a drill from the future still loads
  const odd = 'RINK full\nPIECE R1 route 60 40 #3f7f8c gap=-2\nPIECE P1 player 10 10 #d7263d F1 route=R9 q=0';
  const d = parseDrill(odd);
  T('a negative gap is rejected, not stored', d.pieces.find(p => p.id === 'R1').gap, undefined);
  T('a zero q is rejected, not stored', d.pieces.find(p => p.id === 'P1').q, undefined);
  T('a dangling route= still loads', d.pieces.find(p => p.id === 'P1').route, 'R9');
}
{ // the parser and the lowering pass agree on the model
  const out = lowerRoutes(parseDrill(LINE).pieces);
  T('a parsed line lowers to three skaters', out.filter(p => p.kind === 'player').length, 3);
  T('no route piece survives lowering', out.some(p => p.kind === 'route'), false);
  T('the parsed gap drives the stack', Math.round(out.find(p => p.id === 'P2').x), 54);
}

// ---- the legacy guard: a pre-route drill must be untouched by any of this ----
{
  const legacy = extractDrill(read('docs/example-drill.md'));
  T('the example drill still extracts', !!legacy && legacy.length > 0, true);
  const { a, b, t1, t2 } = trip(legacy);
  T('the example drill round-trips identically', JSON.stringify(a) === JSON.stringify(b), true);
  T('the example drill is a byte-stable fixed point', t1 === t2, true);
  T('no line tokens leak into a drill that has none', /\broute=|\bq=\d|\bgap=/.test(t1), false);
  T('a drill with no route lowers by identity', lowerRoutes(a.pieces) === a.pieces, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
