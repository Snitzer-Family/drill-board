// Release hand (`&f` / `&b`) on every form that puts the puck into play: shoot=,
// pass=, rebound=, rim= and chip=. The suffix sits last except for the open-up `+`.
// The guard that matters most is the NEGATIVE one — a drill with no hand suffix must
// round-trip byte-identical, because every saved drill is one of those.
// Run: node tests/release-hand.mjs
import { parseDrill, serializeDrill } from '../src/drill-format.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// A board with two skaters, a feeder and a net — enough for every form to be valid
// (an impossible step gets DROPPED by the serializer, which would mask a regression).
const board = tok => `DSL 9
RINK full
PIECE N1 net 189 42.5 #c81e33 face=180
PIECE PS1 passer 100 10 #8b99a8
PIECE P1 player 60 42.5 #2ea043 P1
PATH P1 L 120,42.5 L 160,42.5
PIECE P2 player 60 20 #1f4fa3 P2
PATH P2 L 120,20 L 160,20
PIECE PK1 puck 58 42.5 #14171a on=P1 ${tok}`;

const round = tok => {
  const { pieces, errors } = parseDrill(board(tok));
  if (errors.length) return { errors };
  const out = serializeDrill('full', pieces).split('\n').find(l => l.startsWith('PIECE PK1'));
  const k = out.indexOf('on=P1');
  return { tok: k < 0 ? null : out.slice(k + 5).trim() };   // '' when the token was dropped
};
// the puck's chain tokens survive a parse→serialize with the text unchanged
const trip = (name, tok) => T(name, round(tok), { tok });

const hand = pk => {
  const t = (pk.transfers || [])[0] || (pk.terminals || [])[0] || {};
  return t.shand === undefined ? 'auto' : t.shand;
};
const parsed = tok => {
  const { pieces, errors } = parseDrill(board(tok));
  return errors.length ? errors : hand(pieces.find(p => p.id === 'PK1'));
};

// ── the negative guard: no suffix → nothing written, nothing parsed ───────────
console.log('\n-- no hand: unchanged --');
for (const tok of [
  'shoot=2^P1', 'shoot=2^P1>N1', 'pass=2:P2', 'pass=2:P2@3', 'pass=2:P2@3!',
  'pass=2:P2@3!+', 'pass=2:P2^PS1', 'rebound=2:P2@3>N1', 'rebound=2:P2@3+',
  'rim=2^P1~90*80', 'chip=2^P1~-45*30', 'rim=2:P2@3~90', 'chip=2:P2@3~-45+',
]) trip(`${tok} round-trips`, tok);
T('no suffix parses as auto', parsed('pass=2:P2@3'), 'auto');

// ── each form takes both hands ───────────────────────────────────────────────
console.log('\n-- &f / &b on every form --');
for (const [name, tok] of [
  ['terminal shot', 'shoot=2^P1>N1'],
  ['plain pass', 'pass=2:P2@3'],
  ['sauce pass', 'pass=2:P2@3!'],
  ['give-and-go', 'pass=2:P2@3^PS1'],
  ['rebound', 'rebound=2:P2@3>N1'],
  ['terminal rim', 'rim=2^P1~90*80'],
  ['terminal chip', 'chip=2^P1~-45*30'],
  ['rim handoff', 'rim=2:P2@3~90'],
  ['chip handoff', 'chip=2:P2@3~-45'],
]) for (const [c, want] of [['&f', 'fore'], ['&b', 'back']]) {
  trip(`${name} ${c} round-trips`, tok + c);
  T(`${name} ${c} parses`, parsed(tok + c), want);
}

// ── the suffix sits before the open-up `+`, after everything else ────────────
console.log('\n-- ordering vs the trailing + --');
for (const [name, tok] of [
  ['pass', 'pass=2:P2@3!&b+'],
  ['rebound', 'rebound=2:P2@3>N1&f+'],
  ['rim handoff', 'rim=2:P2@3~90&b+'],
  ['chip handoff', 'chip=2:P2@3~-45&f+'],
]) {
  trip(`${name} hand + open round-trips`, tok);
  T(`${name} keeps its open flag`, (() => {
    const { pieces } = parseDrill(board(tok));
    return !!(pieces.find(p => p.id === 'PK1').transfers[0] || {}).open;
  })(), true);
}

// ── the neighbouring captures still stop at the `&` ─────────────────────────
console.log('\n-- neighbouring fields are not swallowed --');
{
  const { pieces } = parseDrill(board('pass=2:P2@3^PS1&b'));
  const tr = pieces.find(p => p.id === 'PK1').transfers[0];
  T('give-and-go via survives the suffix', [tr.via, tr.to, tr.shand], ['PS1', 'P2', 'back']);
}
{
  const { pieces } = parseDrill(board('rebound=2:P2@3>N1&b'));
  const tr = pieces.find(p => p.id === 'PK1').transfers[0];
  T('rebound net survives the suffix', [tr.net, tr.shand], ['N1', 'back']);
}
{
  const { pieces } = parseDrill(board('shoot=2^P1>N1&b'));
  const t = pieces.find(p => p.id === 'PK1').terminals[0];
  T('shot by + net survive the suffix', [t.by, t.net, t.shand], ['P1', 'N1', 'back']);
}
{
  const { pieces } = parseDrill(board('rim=2^P1~90*80&f'));
  const t = pieces.find(p => p.id === 'PK1').terminals[0];
  T('rim aim + dist survive the suffix', [t.by, t.aim, t.dist, t.shand], ['P1', 90, 80, 'fore']);
}

// ── a malformed hand is rejected, not half-parsed ───────────────────────────
console.log('\n-- garbage in --');
for (const tok of ['pass=2:P2@3&x', 'shoot=2^P1&', 'chip=2^P1~-45&fb'])
  T(`${tok} is dropped`, round(tok).tok, '');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
