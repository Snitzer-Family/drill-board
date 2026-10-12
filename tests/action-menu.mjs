import {
  wedgesFor, passPlayers, viaTargets, shootTargets,
  collectCandidates, receiverRoutes, isPickCandidate,
} from '../src/action-menu.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// the app's puckChain, reproduced for the fixtures (action-menu takes it as a
// parameter precisely so the real one stays single-sourced in the app)
const puckChain = pk => [pk.carrier || (pk.pickup && pk.pickup.to) || null,
  ...(pk.transfers || []).map(t => t.to)].filter(Boolean);

const pt = (x, y) => ({ type: 'L', x, y });

// ---- wedge tables ----
T('holding → releases then more', wedgesFor(true), ['pass', 'shoot', 'chip', 'rim', 'more']);
T('empty hands → gains then more', wedgesFor(false), ['receive', 'collect', 'more']);

// ---- candidate pools ----
{
  const pieces = [
    { id: 'P1', kind: 'player', path: [] },
    { id: 'P2', kind: 'player', path: [pt(10, 0)] },
    { id: 'P3', kind: 'player', path: [] },
    { id: 'N1', kind: 'net' },
    { id: 'PS1', kind: 'passer' },
    { id: 'T1', kind: 'tire' },
    { id: 'B1', kind: 'bumper' },
    { id: 'C1', kind: 'cone' },
  ];
  T('passPlayers excludes self', passPlayers(pieces, 'P1').map(q => q.id), ['P2', 'P3']);
  T('viaTargets = passer|tire|bumper', viaTargets(pieces).map(q => q.id), ['PS1', 'T1', 'B1']);
  T('shootTargets = net|passer|bumper|tire', shootTargets(pieces).map(q => q.id), ['N1', 'PS1', 'T1', 'B1']);
}

// ---- collectCandidates (parity with collectPuckAt's filter) ----
{
  const routed = { id: 'P1', kind: 'player', path: [pt(10, 0)] };
  const parked = { id: 'P2', kind: 'player', path: [] };
  const loose = { id: 'K1', kind: 'puck' };
  const carried = { id: 'K2', kind: 'puck', carrier: 'P2' };
  const released = { id: 'K3', kind: 'puck', carrier: 'P2', terminals: [{ kind: 'chip', at: -1 }] };
  const selfRel = { id: 'K4', kind: 'puck', carrier: 'P1', terminals: [{ kind: 'rim', at: 0 }] };
  const pickedUp = { id: 'K5', kind: 'puck', pickup: { to: 'P2', at: -1 } };
  const pieces = [routed, parked, loose, carried, released, selfRel, pickedUp];
  T('loose + released are collectable; held/claimed are not',
    collectCandidates(pieces, 'P2', puckChain).map(q => q.id).filter(id => id !== 'K3'), ['K1', 'K4']);
  // K3 was released BY P2 — a parked P2 cannot "collect the puck I'm still holding"
  T('self-release needs a route to go get it',
    collectCandidates(pieces, 'P2', puckChain).some(q => q.id === 'K3'), false);
  // P1 has a route, so collecting its own rimmed K4 is a real retrieve
  T('self-release with a route is collectable',
    collectCandidates(pieces, 'P1', puckChain).some(q => q.id === 'K4'), true);
  T('unknown collector → no candidates', collectCandidates(pieces, 'P9', puckChain), []);
}

// ---- receiverRoutes: branch-LOCAL indices, colour-path refs ----
{
  const rec = {
    id: 'P2', kind: 'player',
    path: [pt(10, 0), pt(20, 0), pt(30, 0)],
    forks: [
      { color: '#d7263d', path: [pt(40, 5), pt(50, 5)],
        forks: [{ color: '#1f8a4c', path: [pt(60, 10)] }] },
      { color: '#1f4fa3', path: [] },                    // empty branch: skipped
    ],
  };
  const rs = receiverRoutes(rec);
  T('base first, then branches depth-first',
    rs.map(r => r.ref), ['', '#d7263d', '#d7263d/#1f8a4c']);
  T('indices are branch-local (fork path lengths, not concatenated)',
    rs.map(r => r.path.length), [3, 2, 1]);
  T('no receiver → no routes', receiverRoutes(null), []);
  T('routeless receiver → base only, empty', receiverRoutes({ id: 'P3' }).map(r => r.path.length), [0]);
}

// ---- isPickCandidate mirrors the lit pools ----
{
  const pieces = [
    { id: 'P1', kind: 'player', path: [] },
    { id: 'P2', kind: 'player', path: [] },
    { id: 'N1', kind: 'net' },
    { id: 'T1', kind: 'tire' },
    { id: 'C1', kind: 'cone' },
    { id: 'K1', kind: 'puck' },
    { id: 'K2', kind: 'puck', carrier: 'P2' },
  ];
  const at = (kind) => ({ kind, pieceId: 'P1', at: -1, fork: null });
  T('pass: players and bounce targets, never self or cones',
    ['P1', 'P2', 'T1', 'N1', 'C1'].map(id => isPickCandidate(at('pass'), pieces, id, puckChain)),
    [false, true, true, false, false]);
  T('shoot: nets and bounce targets only',
    ['N1', 'T1', 'P2', 'C1'].map(id => isPickCandidate(at('shoot'), pieces, id, puckChain)),
    [true, true, false, false]);
  T('receive: players only',
    ['P2', 'T1', 'K1'].map(id => isPickCandidate(at('receive'), pieces, id, puckChain)),
    [true, false, false]);
  T('collect: only collectable pucks',
    ['K1', 'K2', 'P2'].map(id => isPickCandidate(at('collect'), pieces, id, puckChain)),
    [true, false, false]);
  T('no pick armed → nothing is a candidate', isPickCandidate(null, pieces, 'P2', puckChain), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
