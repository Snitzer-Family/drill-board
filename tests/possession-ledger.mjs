import { buildLedger, mayHoldOn, mayHoldEntering, looseOn, branchCtx, mergeCond } from "@coachvision/drill-core/possession.js";
import { parseDrill } from "@coachvision/drill-core/drill-format.js";

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---- the user's drill, PRE-collect (chip is a terminal by P1) ----
const PRE = `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE N2 net 183 42.5 face=180
PIECE LT1 light 100 8 cues=2ea043:2;e5342b:2
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25
PIECE P2 player 60 55 #e5342b P2
PATH P2 L 120,60
BRANCH P2 2ea043 when=P1! C 127.6,54.8 130.6,49.8 134.1,46
BRANCH P2 e5342b has C 127.3,72 142.8,66 159.4,55.2
PIECE P3 player 45.4 45.4 #1f4fa3 P3
PATH P3 L 70,42
BRANCH P3 2ea043 L 95,32
BRANCH P3 e5342b L 95,55
PIECE PK1 puck 40 42 #111 on=P3 pass=2ea043.1:P1@1 pass=e5342b.1:P2@1 chip=1^P1~58*25 shoot=e5342b.1^P2`;
{
  const { pieces, errors } = parseDrill(PRE);
  T('pre: parses', errors, []);
  const L = buildLedger(pieces);
  // the load-bearing inference: P2's green branch implies P3 went green (via when=P1!
  // → P1's chip → P1's stint requires P3:green), so the red-pass hold is impossible
  T('pre: ctx(P2, green) knows P3:green', branchCtx(L, pieces, 'P2', '#2ea043'), { P2: '#2ea043', P3: '#2ea043' });
  T('pre: P2 does NOT hold on green', mayHoldOn(L, pieces, 'P2', '#2ea043'), false);
  // route-level "holds" means an UNSPENT puck — P2's authored shot spends the red
  // branch and P1's chip spends their base, matching the old termedByOnLineage menu
  T('pre: P2 spent on red (shot authored)', mayHoldOn(L, pieces, 'P2', '#e5342b'), false);
  T('pre: P1 spent on base (chip authored)', mayHoldOn(L, pieces, 'P1', ''), false);
  T('pre: P3 holds on base', mayHoldOn(L, pieces, 'P3', ''), true);
  // the chip sits loose under {P3:green} — collectable from P2's green branch, not red
  T('pre: chip collectable on P2 green', looseOn(L, pieces, 'P2', '#2ea043').map(l => l.kind), ['chip']);
  T('pre: only the shot carom loose on red', looseOn(L, pieces, 'P2', '#e5342b').map(l => l.kind), ['shot']);
  // strip the terminals: now both receivers hold, unspent, on their delivery branches
  const bare = pieces.map(q => q.kind === 'puck' ? { ...q, terminals: undefined } : q);
  const LB = buildLedger(bare);
  T('pre/bare: P2 holds on red', mayHoldOn(LB, bare, 'P2', '#e5342b'), true);
  T('pre/bare: P1 holds on base', mayHoldOn(LB, bare, 'P1', ''), true);
  // with NO release authored anywhere, when=P1! has zero candidate causes — the
  // single-candidate closure adds nothing and possession degrades safely to "maybe"
  T('pre/bare: green degrades to maybe (no causes yet)', mayHoldOn(LB, bare, 'P2', '#2ea043'), true);
}

// ---- POST-collect (chip converted to a handoff caught on P2's green branch) ----
const POST = PRE.replace('chip=1^P1~58*25', 'chip=1:P2@2ea043.1%P1~58');
{
  const { pieces, errors } = parseDrill(POST);
  T('post: parses', errors, []);
  const L = buildLedger(pieces);
  T('post: P2 NOW holds on green (via collect)', mayHoldOn(L, pieces, 'P2', '#2ea043'), true);
  T('post: P2 spent on red (shot authored)', mayHoldOn(L, pieces, 'P2', '#e5342b'), false);
  T('post: P1 spent after chip', mayHoldOn(L, pieces, 'P1', ''), false);
}

// ---- linear-drill parity ----
const LIN = `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE P1 player 40 40 #2ea043 P1
PATH P1 L 80,40
PIECE P2 player 60 60 #e5342b P2
PATH P2 L 100,60
PIECE PK1 puck 40 40 #111 on=P1 pass=1:P2@1 shoot=1^P2`;
{
  const { pieces } = parseDrill(LIN);
  const L = buildLedger(pieces);
  T('lin: P1 spent after pass', mayHoldOn(L, pieces, 'P1', ''), false);
  T('lin: P2 spent after shot', mayHoldOn(L, pieces, 'P2', ''), false);
  T('lin: shot rebound loose for anyone', looseOn(L, pieces, 'P1', '').map(l => l.kind), ['shot']);
}
// carrier with no actions yet holds; placed puck is loose
const LIN2 = `DSL 9
RINK full
PIECE P1 player 40 40 #2ea043 P1
PATH P1 L 80,40
PIECE PK1 puck 40 40 #111 on=P1
PIECE PK2 puck 100 42 #111`;
{
  const { pieces } = parseDrill(LIN2);
  const L = buildLedger(pieces);
  T('lin2: bare carrier holds', mayHoldOn(L, pieces, 'P1', ''), true);
  T('lin2: placed puck loose', looseOn(L, pieces, 'P1', '').map(l => [l.puck, l.kind]), [['PK2', 'placed']]);
}
// give-and-go: release then re-receive → still holding at the end
const GG = `DSL 9
RINK full
PIECE PS1 passer 100 42.5
PIECE P1 player 40 40 #2ea043 P1
PATH P1 L 80,40 L 120,40
PIECE PK1 puck 40 40 #111 on=P1 pass=1:P1@2^PS1`;
{
  const { pieces } = parseDrill(GG);
  const L = buildLedger(pieces);
  T('gg: holds again after give-and-go', mayHoldOn(L, pieces, 'P1', ''), true);
}

// ---- viability proofs ----
// impossible pass: released under {P3:green} (P1 got it via the green pass), caught
// on P2's branch that REQUIRES {P3:red} (link=P3/e5342b) — never the same run
const IMP = `DSL 9
RINK full
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25
PIECE P2 player 60 55 #e5342b P2
PATH P2 L 120,60
BRANCH P2 7a3fa8 link=P3/e5342b L 150,50
PIECE P3 player 45 45 #1f4fa3 P3
PATH P3 L 70,42
BRANCH P3 2ea043 L 95,32
BRANCH P3 e5342b L 95,55
PIECE PK1 puck 45 45 #111 on=P3 pass=2ea043.1:P1@1 pass=1:P2@7a3fa8.1%P1`;
{
  const { pieces, errors } = parseDrill(IMP);
  T('imp: parses', errors, []);
  const L = buildLedger(pieces);
  T('imp: green pass ok', L.viability['t:PK1:0'], 'ok');
  T('imp: cross-branch pass proved dead', L.viability['t:PK1:1'], 'no-catch');
}
// the same pass caught on a COMPATIBLE branch (link=P3/2ea043) is fine
const OK2 = IMP.replace('link=P3/e5342b', 'link=P3/2ea043');
{
  const { pieces } = parseDrill(OK2);
  const L = buildLedger(pieces);
  T('imp2: compatible branch pass ok', L.viability['t:PK1:1'], 'ok');
}
// no-release: a pass by a player who never has the puck
const NR = `DSL 9
RINK full
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25
PIECE P2 player 60 55 #e5342b P2
PATH P2 L 120,60
PIECE PK1 puck 60 30 #111 on=P1 pass=1:P2@1%P9`;
{
  const { pieces } = parseDrill(NR);
  const L = buildLedger(pieces);
  T('nr: stranger release proved dead', L.viability['t:PK1:0'], 'no-release');
}
// no-fire terminal: a shot by a player who never receives (drill from the PRE case:
// P2's green shot when the puck only ever reaches them on red → checked there via
// mayHoldOn; here the direct verdict on a never-holder)
{
  const { pieces } = parseDrill(NR.replace('pass=1:P2@1%P9', 'shoot=1^P9'));
  const L = buildLedger(pieces);
  T('nf: stranger terminal proved dead', L.viability['x:PK1:0'], 'no-fire');
}

// ---- self-collection is valid for shot/chip/rim; only a bare self-PASS is not ----
const SELF = t => `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE PS1 passer 100 42.5
PIECE P1 player 40 40 #2ea043 P1
PATH P1 L 80,40 L 120,40
PIECE PK1 puck 40 40 #111 ${t}`;
for (const [name, tok, want] of [
  ['self chip-and-chase ok',   'on=P1 chip=1:P1@2~40',   'ok'],
  ['self rim-and-retrieve ok', 'on=P1 rim=1:P1@2~15',    'ok'],
  ['collect own rebound ok',   'on=P1 rebound=1:P1@2',   'ok'],
  ['give-and-go via ok',       'on=P1 pass=1:P1@2^PS1',  'ok'],
  ['bare self-pass flagged',   'on=P1 pass=1:P1@2',      'self-pass'],
]) {
  const { pieces } = parseDrill(SELF(tok));
  const L = buildLedger(pieces);
  T(name, L.viability['t:PK1:0'], want);
}

// ---- carry-wiggle at branch entry: the user's chip-pickup drill ----
// P2 branches: green (when=P1!1) collects P1's chip AT green.1; red (has) carries in.
// Entering green, P2 provably does NOT hold (the red-run pass can't co-occur);
// entering red, they do.
const WIG = `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE N2 net 183 42.5 face=180
PIECE LT1 light 100 8 cues=2ea043:2;e5342b:2
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25
PIECE P2 player 53.3 57.2 #e5342b P2
PATH P2 L 113.3,62.2
BRANCH P2 2ea043 when=P1!1 C 122.3,56.1 128.3,49.2 136.9,43.7
BRANCH P2 e5342b has C 125,67.8 131.5,69.2 145.4,65.7
PIECE P3 player 43.5 42.1 #1f4fa3 P3
PATH P3 L 70,42
BRANCH P3 2ea043 L 95,32
BRANCH P3 e5342b L 95,55
PIECE PK1 puck 40 42 #111 on=P3 pass=2ea043.1:P1@1 pass=e5342b.1:P2@1 chip=1:P2@2ea043.1%P1~61`;
{
  const { pieces, errors } = parseDrill(WIG);
  T('wig: parses', errors, []);
  const L = buildLedger(pieces);
  T('wig: NOT holding entering green (pickup route)', mayHoldEntering(L, pieces, 'P2', '#2ea043'), false);
  T('wig: holding entering red (carry route)', mayHoldEntering(L, pieces, 'P2', '#e5342b'), true);
  T('wig: P1 not holding entering base (n/a, base=mayHoldOn)', mayHoldEntering(L, pieces, 'P1', ''), false);
  T('wig: chip transfer viable', L.viability['t:PK1:2'], 'ok');
}

// ---- v2 of the drill: red branch now ENDS in a shot — carrying IN must still wiggle
// (the on-branch loss happens after entry; it's what makes the branch reachable)
const WIG2 = WIG.replace('chip=1:P2@2ea043.1%P1~61', 'chip=1:P2@2ea043.1%P1~45 shoot=e5342b.1^P2');
{
  const { pieces, errors } = parseDrill(WIG2);
  T('wig2: parses', errors, []);
  const L = buildLedger(pieces);
  T('wig2: still NOT holding entering green', mayHoldEntering(L, pieces, 'P2', '#2ea043'), false);
  T('wig2: STILL holding entering red despite its shot', mayHoldEntering(L, pieces, 'P2', '#e5342b'), true);
  T('wig2: red shot viable', L.viability['x:PK1:0'], 'ok');
}

// ---- v3: pickup → return pass → P1 shoots. P1 now has TWO releases; the closure
// must take their conditions' INTERSECTION ({P3:green} is common), keeping the
// pickup branch provably possession-free at entry.
const WIG3 = `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE N2 net 183 42.5 face=180
PIECE LT1 light 100 8 cues=2ea043:2;e5342b:2
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25 C 128.3,36.3 133.6,11.8 164,24.9
PIECE P2 player 60 55 #e5342b P2
PATH P2 L 120,60
BRANCH P2 2ea043 when=P1! C 129.5,58.2 134.7,48 135.1,41.2
BRANCH P2 e5342b has C 127.3,72 134.7,48 162.7,45.6
PIECE P3 player 34.9 43.2 #1f4fa3 P3
PATH P3 L 70,42
BRANCH P3 2ea043 L 95,32
BRANCH P3 e5342b L 95,55
PIECE PK1 puck 40 42 #111 on=P3 pass=2ea043.1:P1@1 pass=e5342b.1:P2@1 chip=1:P2@2ea043.1%P1~45 pass=2ea043.1:P1@2 shoot=e5342b.1^P2 shoot=2^P1`;
{
  const { pieces, errors } = parseDrill(WIG3);
  T('wig3: parses', errors, []);
  const L = buildLedger(pieces);
  T('wig3: NOT holding entering green (pickup, despite 2 P1 releases)', mayHoldEntering(L, pieces, 'P2', '#2ea043'), false);
  T('wig3: holding entering red', mayHoldEntering(L, pieces, 'P2', '#e5342b'), true);
  T('wig3: return pass viable', L.viability['t:PK1:3'], 'ok');
  T('wig3: P1 final shot viable', L.viability['x:PK1:1'], 'ok');
}

// ---- v4: everything converges on P1 catching a return pass and shooting. P1's
// second release (the shot) is CONDITIONED on P2's own branch choice, so the
// causality filter must exclude it when resolving P2's when=P1! — the chip alone
// implies {P3:green} and the pickup branch stays provably clean at entry.
const WIG4 = `DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE N2 net 183 42.5 face=180
PIECE LT1 light 100 8 cues=2ea043:2;e5342b:2
PIECE P1 player 60 30 #2ea043 P1
PATH P1 L 120,25
BRANCH P1 2ea043 has=P2 C 127.3,37 134.7,13 167.1,32.8
PIECE P2 player 60 55 #e5342b P2
PATH P2 L 120,60
BRANCH P2 2ea043 when=P1! C 129.5,58.2 134.7,48 135.1,41.2
BRANCH P2 e5342b has C 127.3,72 134.7,48 162.7,45.6
PIECE P3 player 34.9 43.2 #1f4fa3 P3
PATH P3 L 70,42
BRANCH P3 2ea043 L 95,32
BRANCH P3 e5342b L 95,55
PIECE PK1 puck 40 42 #111 on=P3 pass=2ea043.1:P1@1 pass=e5342b.1:P2@1 chip=1:P2@2ea043.1%P1~45 pass=2ea043.1:P1@2ea043.1 pass=e5342b.1:P1@2ea043.1 shoot=2ea043.1^P1`;
{
  const { pieces, errors } = parseDrill(WIG4);
  T('wig4: parses', errors, []);
  const L = buildLedger(pieces);
  T('wig4: NOT holding entering green pickup', mayHoldEntering(L, pieces, 'P2', '#2ea043'), false);
  T('wig4: holding entering red', mayHoldEntering(L, pieces, 'P2', '#e5342b'), true);
  T('wig4: green return pass viable', L.viability['t:PK1:3'], 'ok');
  T('wig4: red feed pass viable', L.viability['t:PK1:4'], 'ok');
  T('wig4: P1 shot viable', L.viability['x:PK1:0'], 'ok');
}
/* ---- chain ORDER: actions are authored per waypoint, stored as an ordered chain ---- */
{
  const { orderTransfers } = await import("@coachvision/drill-core/possession.js");
  const ord = pk => orderTransfers(pk).map(t => `${t.by || '-'}>${t.to}@${t.recvAt}`).join(' ');

  // the reported break: P2 passes to P1 (caught late), then the user inserts an
  // EARLIER pass to P1 and completes it with a give-and-go back — the new hops are
  // appended, so the stored order no longer resolves and the shot loses its holder
  const broken = { carrier: 'P2', transfers: [
    { at: -1, to: 'P1', recvAt: 5, kind: 'pass' },
    { at: -1, to: 'P1', recvAt: 0, kind: 'pass', by: 'P2' },
    { at: 1, to: 'P2', recvAt: null, kind: 'pass' }] };
  T('chain: reorders a give-and-go authored out of sequence',
    ord(broken), 'P2>P1@0 ->P2@null ->P1@5');

  // an order that already resolves is returned untouched, same array identity
  const fine = { carrier: 'P1', transfers: [
    { at: 0, to: 'P2', recvAt: 0, kind: 'pass' },
    { at: 1, to: 'P3', recvAt: 1, kind: 'pass' }] };
  T('chain: a working order is left exactly alone', orderTransfers(fine) === fine.transfers, true);

  // two hops released from the same spot order by where they are CAUGHT
  const sameSpot = { carrier: 'P1', transfers: [
    { at: 2, to: 'P2', recvAt: 4, kind: 'pass' },
    { at: 2, to: 'P2', recvAt: 1, kind: 'pass' },
    { at: 0, to: 'P1', recvAt: 0, kind: 'pass', by: 'P2' }] };
  T('chain: same release point orders by the catch', ord(sameSpot), '->P2@1 P2>P1@0 ->P2@4');

  // conservative: nothing to do, nothing that resolves, branch-tagged chains
  T('chain: a single hop is untouched', orderTransfers({ carrier: 'P1', transfers: [{ at: 0, to: 'P2' }] }).length, 1);
  T('chain: no head → untouched', orderTransfers({ transfers: [{ at: 0, to: 'P2' }, { at: 1, to: 'P3' }] }).length, 2);
  const unresolvable = { carrier: 'P1', transfers: [
    { at: 0, to: 'P2', kind: 'pass' }, { at: 0, to: 'P3', kind: 'pass', by: 'P9' }] };
  T('chain: an unresolvable chain keeps the author\'s order',
    orderTransfers(unresolvable) === unresolvable.transfers, true);
  const branchy = { carrier: 'P1', transfers: [
    { at: 1, to: 'P2', recvAt: 3, kind: 'pass' },
    { at: 0, to: 'P3', recvAt: 0, kind: 'pass', atRef: '#2ea043' }] };
  T('chain: branch-tagged chains are left to the author',
    orderTransfers(branchy) === branchy.transfers, true);
  // a give-and-go off a passer is a legal self-directed hop and must stay releasable
  // a give-and-go off a passer is a legal self-directed hop: pinning both to P1
  // makes the stored order unresolvable, and the fix must still be willing to put
  // the self-hop first rather than rejecting it as a self-pass
  const viaGo = { carrier: 'P1', transfers: [
    { at: 3, to: 'P2', recvAt: 2, kind: 'pass', by: 'P1' },
    { at: 1, to: 'P1', recvAt: 1, kind: 'pass', via: 'PS1', by: 'P1' }] };
  T('chain: a give-and-go via a passer stays releasable', ord(viaGo), 'P1>P1@1 P1>P2@2');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

