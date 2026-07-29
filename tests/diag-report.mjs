// The judgement half of the diagnostics payload: when a plan/renderer
// disagreement is REAL rather than a catch frame, what a possession verdict
// means in words, whether the plan is even built on mounted geometry, and
// whether the thing survives a round trip through JSON.
//
// The sampling half lives in the app (every leg time comes off the mounted SVG)
// and is covered by the browser suite instead.

import {
  jsonSafe, bladeAgreement, agreementRows, viabilityFaults, planHealth, drillReport, FAULT_WHY,
  hashDiag, penVerdicts, toFixture,
} from '../src/diag-report.js';
import { classifyPenGroup } from '../src/sketch-recognize.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

/* ---------------- who has the puck ---------------- */
// The renderer re-attaches a puck to the nearest blade within 2.2ft, entirely
// independently of the plan's `ride` leg. Comparing them naively fires on every
// catch frame, so the noise guards ARE the feature — a widget that cries wolf
// through every handover is one nobody reads.
{
  const base = { puck: 'PK1', inFlight: false, approachId: null, legType: 'ride', legId: 'F1',
    blade: { id: 'F1', d: 0.7 } };
  T('plan and blade agree', bladeAgreement(base).agree, true);
  T('agreeing row still reports the gap', bladeAgreement(base).d, 0.7);
  T('wrong stick is flagged',
    bladeAgreement({ ...base, blade: { id: 'F5', d: 1.4 } }),
    { puck: 'PK1', legType: 'ride', planHolder: 'F1', bladeId: 'F5', d: 1.4, agree: false });

  // ...and the three ways a mismatch is legitimate
  T('in flight → no row', bladeAgreement({ ...base, inFlight: true, blade: null }), null);
  T('in flight beats a stray blade', bladeAgreement({ ...base, inFlight: true }), null);
  T('catch approach → no row', bladeAgreement({ ...base, approachId: 'F2', blade: null }), null);
  T('a fly leg claims nobody', bladeAgreement({ ...base, legType: 'fly', legId: null }), null);
  T('a skid leg claims nobody', bladeAgreement({ ...base, legType: 'skid' }), null);
  T('no active leg at all', bladeAgreement({ ...base, legType: null }), null);

  // a rest leg says the puck is loose: a blade under it IS the disagreement
  T('loose puck on a blade is wrong',
    bladeAgreement({ ...base, legType: 'rest', legId: undefined }).agree, false);
  T('loose puck with no blade is fine',
    bladeAgreement({ ...base, legType: 'rest', legId: undefined, blade: null }).agree, true);
  // the reverse: the plan says carried, the renderer found nothing in reach
  T('puck floated off the stick',
    bladeAgreement({ ...base, blade: null }),
    { puck: 'PK1', legType: 'ride', planHolder: 'F1', bladeId: null, d: null, agree: false });

  T('rows drop the nulls', agreementRows([
    base, { ...base, puck: 'PK2', inFlight: true }, { ...base, puck: 'PK3', legType: 'fly' },
  ]).map(r => r.puck), ['PK1']);
  T('no probes, no rows', agreementRows(undefined), []);
}

/* ---------------- why a puck will not move ---------------- */
{
  const pieces = [
    { id: 'F1', kind: 'player', label: 'F1' },
    { id: 'F2', kind: 'player', label: 'F2' },
    { id: 'PK1', kind: 'puck', transfers: [
      { kind: 'pass', by: 'F1', to: 'F2', atRef: 'red.1' },
      { kind: 'pass', to: 'F2' },              // releaser inferred, not authored
    ], terminals: [{ kind: 'shoot', by: 'F2', ref: '' }] },
  ];
  const v = { 't:PK1:0': 'no-catch', 't:PK1:1': 'self-pass', 'x:PK1:0': 'no-fire' };
  const out = viabilityFaults(pieces, v);
  T('every non-ok verdict surfaces', out.length, 3);
  // worst first: a release that cannot happen makes later verdicts on that
  // chain moot, so reading top-down reads causes before symptoms
  T('sorted worst first', out.map(f => f.verdict), ['no-fire', 'self-pass', 'no-catch']);
  T('prose names the actors', out.find(f => f.verdict === 'no-catch').label,
    'puck puck#PK1 hop 1 (pass F1#F1 → F2#F2@red.1)');
  T('terminal prose', out.find(f => f.verdict === 'no-fire').label,
    'puck puck#PK1 terminal 1 (shoot by F2#F2)');
  // an unpinned releaser is inferred from the chain, not authored — naming
  // nobody beats naming a dash
  T('uninferred releaser names nobody', out.find(f => f.verdict === 'self-pass').label,
    'puck puck#PK1 hop 2 (pass → F2#F2)');
  T('every verdict has a why', out.every(f => f.why && f.why !== 'unviable'), true);
  T('why matches the table', out.find(f => f.verdict === 'self-pass').why, FAULT_WHY['self-pass']);

  T('ok never appears', viabilityFaults(pieces, { 't:PK1:0': 'ok' }), []);
  T('no ledger, no faults', viabilityFaults(pieces, undefined), []);
  // a verdict on an action the board no longer has must not throw
  T('dangling key degrades', viabilityFaults(pieces, { 't:PK1:9': 'no-release' })[0].label,
    'puck puck#PK1 hop 10');
  T('unknown puck degrades', viabilityFaults(pieces, { 't:GONE:0': 'no-release' })[0].label,
    'puck #GONE hop 1');
}

/* ---------------- is the plan built on real geometry ---------------- */
// sig is the sum of every route segment's getTotalLength: zero means the SVG
// isn't mounted and EVERY leg time is 0. But an unrouted board sums to zero
// legitimately, so the flag needs both halves or it cries wolf on an empty rink.
{
  T('unmounted paths are loud',
    planHealth({ sig: 0, routedPlayers: 2, segsMounted: 0, segsExpected: 4, faults: 0 }).level, 'bad');
  T('...and says why',
    /PATHS NOT MOUNTED/.test(planHealth({ sig: 0, routedPlayers: 2, segsMounted: 0, segsExpected: 4, faults: 0 }).msg), true);
  T('an unrouted board is not a fault',
    planHealth({ sig: 0, routedPlayers: 0, segsMounted: 0, segsExpected: 0, faults: 0 }).level, 'ok');
  T('partial mount warns',
    planHealth({ sig: 5, routedPlayers: 2, segsMounted: 3, segsExpected: 4, faults: 0 }).level, 'warn');
  T('faults warn',
    planHealth({ sig: 5, routedPlayers: 1, segsMounted: 2, segsExpected: 2, faults: 2 }).msg, '2 transfer faults');
  T('one fault reads singular',
    planHealth({ sig: 5, routedPlayers: 1, segsMounted: 2, segsExpected: 2, faults: 1 }).msg, '1 transfer fault');
  T('healthy says so',
    planHealth({ sig: 5, routedPlayers: 1, segsMounted: 2, segsExpected: 2, faults: 0 }).level, 'ok');
  T('bad outranks warn',
    planHealth({ sig: 0, routedPlayers: 1, segsMounted: 0, segsExpected: 2, faults: 3 }).level, 'bad');
}

/* ---------------- JSON safety ---------------- */
// Timing genuinely produces Infinity (an unreached release, a puck that never
// enters a zone) and `pivots` holds Maps. Either one silently becomes null or
// {} in a copied payload, so the report sanitizes on the way out.
{
  T('Infinity survives as null', jsonSafe({ rel: Infinity }), { rel: null });
  T('-Infinity too', jsonSafe({ t: -Infinity }), { t: null });
  T('NaN too', jsonSafe({ d: NaN }), { d: null });
  T('finite numbers untouched', jsonSafe({ d: 1.5, z: 0 }), { d: 1.5, z: 0 });
  const m = new Map([['3', { from: 1, to: 2 }]]);
  T('Maps become objects', jsonSafe({ byIdx: m }), { byIdx: { 3: { from: 1, to: 2 } } });
  T('Sets become arrays', jsonSafe({ routes: new Set(['red', 'blue']) }), { routes: ['red', 'blue'] });
  T('functions drop out', jsonSafe({ a: 1, f: () => 0 }), { a: 1 });
  const cyc = { a: 1 }; cyc.self = cyc;
  T('cycles are named, not thrown', jsonSafe(cyc), { a: 1, self: '[cycle]' });
  // a sibling reference is NOT a cycle — marking it one would gut the report
  const shared = { x: 1 };
  T('shared refs are not cycles', jsonSafe({ a: shared, b: shared }), { a: { x: 1 }, b: { x: 1 } });
  T('arrays keep their shape', jsonSafe([1, Infinity, [NaN]]), [1, null, [null]]);
}

/* ---------------- the whole report ---------------- */
{
  const pieces = [
    { id: 'F1', kind: 'player', label: 'F1', path: [{ x: 1, y: 1 }] },
    { id: 'PK1', kind: 'puck', transfers: [{ kind: 'pass', by: 'F1', to: 'F2' }] },
  ];
  const rep = drillReport({
    t: 1.23456, animT: 0.5, drillTime: 2, totalTime: 2.8, playing: true, mode: 'play',
    pace: 15, seed: 3,
    plan: { sig: 0, warp: {}, holds: {}, startWait: {}, trigPause: {},
      pivots: { F1: { byIdx: new Map([[0, { from: 'fwd', to: 'bwd', t0: Infinity }]]) } },
      opens: {}, real: true, det: true, odds: { save: 0.5 } },
    cacheHit: false, segs: { mounted: 0, expected: 1 },
    pieces, ledger: { stints: [], loose: [], viability: { 't:PK1:0': 'no-catch' } },
    solved: { routes: {} },
    probes: [{ puck: 'PK1', inFlight: false, approachId: null, legType: 'ride', legId: 'F1', blade: null }],
    players: [], pucks: [], board: { counts: { player: 1 } },
    resolved: { nearestRebound: false, forkPlayers: 0, branchesTaken: 0 },
    dsl: 'RINK full\n',
  });
  T('report survives a JSON round trip',
    JSON.stringify(JSON.parse(JSON.stringify(rep))), JSON.stringify(rep));
  T('unmounted geometry outranks the fault', rep.health.level, 'bad');
  T('the fault is still listed', rep.faults.map(f => f.verdict), ['no-catch']);
  T('a floated puck is flagged', rep.agreement[0].agree, false);
  T('clock is rounded for reading', rep.clock.t, 1.235);
  T('end hold is derived, not passed', rep.clock.hold, 0.8);
  T('cache miss is reported', rep.plan.cache, 'rebuilt');
  T('the Map in pivots survived', rep.pivots.F1.byIdx['0'].from, 'fwd');
  T('...with its Infinity nulled', rep.pivots.F1.byIdx['0'].t0, null);
  T('the DSL rides along', rep.dsl, 'RINK full\n');
}

/* ---------------- pen verdicts ---------------- */
// One line per decision, matched to the ink that produced it. The match is on
// the exact stroke SET, not on order — a dense board reads the same strokes
// several times over, and pairing by position would attribute a rejection to
// the wrong mark.
{
  const trace = {
    syms: [
      { srcs: [0, 1], why: 'whole-group', path: 'crossesAsX', result: { sym: 'X', score: 0.95, second: null } },
      { srcs: [3], why: 'whole-group', reject: 'guard', blockedTop: 'D', scored: { D: 0.71, O: 0.4 } },
      { srcs: [4], why: 'whole-group', reject: 'threshold', accept: 0.55, rankedAllowed: [['O', 0.42]] },
    ],
    longs: [{ idx: 5, skater: null, net: null, straight: 0.93 }],
  };
  const ops = [
    { op: 'player', sym: 'X', srcs: [0, 1] },
    { op: 'mark', srcs: [3] },
    { op: 'mark', srcs: [4] },
    { op: 'mark', srcs: [5] },
  ];
  const v = penVerdicts(ops, trace);
  T('a conversion names its branch', v[0].detail, 'crossesAsX 0.95');
  // the two rejections look identical from outside — the ink just stays ink —
  // but they need opposite fixes, so they must never read the same
  T('a guard block says so', v[1].detail, 'top D 0.71, blocked by its guard');
  T('a near miss shows the gap', v[2].detail, 'best O 0.42 < accept 0.55');
  T('...and they differ', v[1].detail === v[2].detail, false);
  T('a long stroke explains itself', v[3].detail,
    'long stroke: no skater in reach, straightness 0.93');
  T('stroke labels are readable', v.map(x => x.label), ['s0,s1', 's3', 's4', 's5']);
  // out-of-order srcs must still match their record
  T('matching ignores order',
    penVerdicts([{ op: 'player', sym: 'X', srcs: [1, 0] }], trace)[0].detail, 'crossesAsX 0.95');
  T('no trace degrades quietly', penVerdicts(ops, null).every(x => x.detail === ''), true);
}

/* ---------------- the fixture emitter ---------------- */
// The one place a bug is silently expensive: a fixture that parses and passes
// for the wrong reason is worse than no fixture. So it is checked for being
// runnable JS, for round-tripping the ink, and for matching the shape of the
// REAL blocks already in tests/sketch-recognize.mjs.
{
  const d = {
    strokes: [{ pts: [{ x: 38.04, y: 25.94 }, { x: 46.31, y: 34.42 }] },
      { pts: [{ x: 47.06, y: 25.91 }, { x: 38.51, y: 34.44 }] }],
    ctx: { pxFtX: 0.236, pxFtY: 0.236, players: [{ id: 'P1', x: 40.02, y: 30.06 }], nets: [] },
    ops: [{ op: 'player', sym: 'X', srcs: [0, 1] }],
  };
  const out = toFixture(d, 'phone X', '6.99');
  T('points round to the capture resolution', /\[38,25\.9\]/.test(out), true);
  T('...and nothing keeps false precision', /\d\.\d\d/.test(out.split('const S')[1]), false);
  // equal axes collapse to the single-key form the existing fixtures use
  T('square scale writes pxFt', /\{ pxFt: 0\.236/.test(out), true);
  T('unequal writes both axes',
    /pxFtX: 0\.168, pxFtY: 0\.103/.test(toFixture({ ...d, ctx: { pxFtX: 0.168, pxFtY: 0.103 } })), true);
  T('an empty net list is omitted', /nets:/.test(out), false);
  T('players ride along', /players: \[\{"id":"P1","x":40,"y":30\.1\}\]/.test(out), true);
  T('the assertion pins observed behaviour', /kinds\(classifyPenGroup\(S, CTX\)\), \["player"\]/.test(out), true);
  T('the name reaches the test title', /T\('phone X'/.test(out), true);
  T('a quote in the name cannot break the string', /T\('its X'/.test(toFixture(d, "it's X")), true);
  T('no ink, no fixture', toFixture({ strokes: [] }), '');
  T('no burst at all', toFixture(null), '');

  // it has to be JS. Compiled, not eval'd against the app.
  const body = `const P=a=>a.map(([x,y])=>({x,y}));const stroke=p=>({pts:p});`
    + `const kinds=o=>o.map(x=>x.op);const T=(n,g,w)=>[n,g,w];const classifyPenGroup=()=>[];`
    + out;
  let parsed = true;
  try { new Function(body); } catch { parsed = false; }
  T('the emitted case is valid JS', parsed, true);

  // ...and the ink survives the round trip: 1dp rounding must not change what
  // the classifier decides, or the fixture would pass for a different reason
  const back = /const S = \[\n([\s\S]*?)\n  \]/.exec(out)[1]
    .trim().split('\n').map(l => JSON.parse(l.trim().replace(/,$/, '')))
    .map(a => ({ pts: a.map(([x, y]) => ({ x, y })) }));
  T('the rounded ink reads the same',
    classifyPenGroup(back, { pxFt: 0.236, players: [{ id: 'P1', x: 40, y: 30.1 }] }).map(o => o.op),
    ['player']);
}

/* ---------------- the two hash keys ---------------- */
// #diag and #d= are independent keys on one hash. Neither may capture the
// other: base64url excludes # and &, and #d='s capture stops at a &. This table
// is what keeps a future edit to either regex from silently breaking share
// links — the failure mode is a recipient seeing the wrong drill.
{
  const LINK = /[#&]d=([^&]+)/;
  const cases = [
    ['#d=QUJD', 'QUJD', null],
    ['#diag', null, 'drill'],
    ['#diag=pen', null, 'pen'],
    ['#diag=layout', null, 'layout'],
    ['#diag&d=QUJD', 'QUJD', 'drill'],
    ['#d=QUJD&diag', 'QUJD', 'drill'],
    ['#d=QUJD&diag=pen', 'QUJD', 'pen'],
    ['#diagnostics', null, null],          // the lookahead earns its keep
    ['#diagram', null, null],
    ['#d=ZGlhZw', 'ZGlhZw', null],         // a payload that spells "diag"
    ['#diag=nope', null, 'drill'],         // unknown tab falls back
    ['', null, null],
  ];
  for (const [hash, drill, tab] of cases) {
    const m = LINK.exec(hash);
    T(`link ${hash || '(empty)'}`, m ? m[1] : null, drill);
    const d = hashDiag(hash);
    T(`diag ${hash || '(empty)'}`, d ? d.tab : null, tab);
  }
  T('the drill tab opens as a drawer', hashDiag('#diag').dock, 'half');
  T('reading tabs open full', hashDiag('#diag=pen').dock, 'full');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
