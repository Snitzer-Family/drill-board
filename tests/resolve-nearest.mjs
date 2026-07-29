// resolveNearest re-binds a "collect the NEAREST loose puck" intent onto whichever
// puck is actually closest at play time. It runs BEFORE resolveForks, so the puck's
// action list is still in its authoring form (`terminals`) and NOT yet lowered into
// the scalar shotAt/rimAt/chipAt fields — which is exactly what it used to forget to
// carry across, silently turning "collect it and shoot" into "collect it and skate
// around with it forever".
import { resolveNearest } from '../src/timing.js';
import { parseDrill } from '../src/drill-format.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const by = (ps, id) => ps.find(p => p.id === id);
const puck = (id, x, y, over = {}) => ({ id, kind: 'puck', x, y, carrier: null, pickup: null, transfers: [], ...over });

// F1 stands at (35,22); PK_FAR carries the intent, PK_NEAR is closer to F1
const scene = (over = {}) => [
  { id: 'F1', kind: 'player', x: 35, y: 22, path: [] },
  puck('PK_NEAR', 31, 26),
  puck('PK_FAR', 25, 26, { pickup: { to: 'F1', at: -1, nearest: true }, ...over }),
];

{ // nothing to resolve → the same array back
  const ps = [puck('PK1', 10, 10)];
  T('no nearest intent → identity', resolveNearest(ps) === ps, true);
}
{ // the plain migration that already worked
  const out = resolveNearest(scene());
  T('the intent moves to the nearer puck', by(out, 'PK_NEAR').pickup.to, 'F1');
  T('the authored puck is emptied', by(out, 'PK_FAR').pickup, null);
  T('ids and positions never move', [by(out, 'PK_NEAR').x, by(out, 'PK_FAR').x], [31, 25]);
}
{ // THE BUG: a terminal authored alongside the collect must travel with it
  const out = resolveNearest(scene({ terminals: [{ kind: 'shot', at: 1, ref: '', by: 'F1', net: 'N1' }] }));
  T('the shot travels with the intent', (by(out, 'PK_NEAR').terminals || []).map(t => t.kind), ['shot']);
  T('...keeping its target and shooter', [by(out, 'PK_NEAR').terminals[0].net, by(out, 'PK_NEAR').terminals[0].by], ['N1', 'F1']);
  T('...and does not stay behind on the emptied puck', (by(out, 'PK_FAR').terminals || []).length, 0);
}
{ // a chip/rim terminal is the same story
  const out = resolveNearest(scene({ terminals: [{ kind: 'rim', at: 0, ref: '', aim: 90 }] }));
  T('a rim terminal travels too', (by(out, 'PK_NEAR').terminals || []).map(t => t.kind), ['rim']);
}
{ // transfers already travelled; make sure that still holds alongside terminals
  const out = resolveNearest(scene({
    transfers: [{ at: 0, to: 'F2', recvAt: null, kind: 'pass' }],
    terminals: [{ kind: 'shot', at: 2, ref: '' }],
  }));
  T('passes and terminals travel together',
    [by(out, 'PK_NEAR').transfers.length, by(out, 'PK_NEAR').terminals.length], [1, 1]);
  T('both are cleared from the emptied puck',
    [by(out, 'PK_FAR').transfers.length, (by(out, 'PK_FAR').terminals || []).length], [0, 0]);
}
{ // a puck with a terminal of its own is NOT free to be stolen by a nearest-collect
  const ps = [
    { id: 'F1', kind: 'player', x: 35, y: 22, path: [] },
    puck('PK_BUSY', 31, 26, { terminals: [{ kind: 'shot', at: 0, ref: '' }] }),
    puck('PK_FAR', 25, 26, { pickup: { to: 'F1', at: -1, nearest: true } }),
  ];
  const out = resolveNearest(ps);
  T('a puck already due to be shot is not stolen', by(out, 'PK_BUSY').pickup, null);
  T('the intent stays where it was authored', by(out, 'PK_FAR').pickup.to, 'F1');
}

// ---- end to end, through the parser, on the shape that broke ----
{
  const d = parseDrill([
    'RINK full',
    'PIECE F1 player 35 22 #d7263d F1',
    'PIECE PK1 puck 31 26 #14171a',
    'PIECE PK2 puck 25 26 #14171a pickup=F1@0* shoot=2^F1>N1',
    'PIECE N1 net 189 42 #c81e33 goalie',
  ].join('\n'));
  const out = resolveNearest(d.pieces);
  const holder = out.find(p => p.kind === 'puck' && p.pickup);
  T('the collected puck is the nearer one', holder.id, 'PK1');
  T('it carries the shot the drill authored', (holder.terminals || []).map(t => `${t.kind}@${t.at}`), ['shot@1']);
  T('every puck action lives on exactly one puck',
    out.filter(p => p.kind === 'puck' && (p.terminals || []).length).length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
