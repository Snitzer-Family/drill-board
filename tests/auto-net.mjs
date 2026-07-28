// Auto-net injection: a drill with a shot but no net/passer gets an empty net
// in the crease nearest the shooter (one per end as needed). Run: node tests/auto-net.mjs
import { parseDrill, serializeDrill, ensureShotNet } from "@coachvision/drill-core/drill-format.js";

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const nets = pieces => pieces.filter(p => p.kind === 'net').map(p => ({ id: p.id, x: p.x, y: p.y, facing: p.facing, goalie: p.goalie }));

// ---- terminal shot toward the right end, no net → right-crease net ----
{
  const { pieces, errors } = parseDrill(`DSL 9
RINK full
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 120,40 L 160,42
PIECE PK1 puck 55 40 on=P1 shoot=2^P1`);
  T('right shot: parses', errors, []);
  T('right shot: right-crease net', nets(pieces), [{ id: 'N1', x: 189, y: 42.5, facing: 180, goalie: false }]);
}

// ---- shooter skating left → left-crease net; release point beats piece origin ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE P1 player 120 40 #d7263d P1
PATH P1 L 60,40 L 40,42
PIECE PK1 puck 125 40 on=P1 shoot=2^P1`);
  T('left shot: left-crease net', nets(pieces), [{ id: 'N1', x: 11, y: 42.5, facing: 0, goalie: false }]);
}

// ---- shots at BOTH ends → one net per side ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE P1 player 60 30 #d7263d P1
PATH P1 L 40,30
PIECE P2 player 140 55 #1f4fa3 P2
PATH P2 L 160,55
PIECE PK1 puck 55 30 on=P1 shoot=1^P1
PIECE PK2 puck 135 55 on=P2 shoot=1^P2`);
  T('both ends: two nets', nets(pieces),
    [{ id: 'N1', x: 11, y: 42.5, facing: 0, goalie: false }, { id: 'N2', x: 189, y: 42.5, facing: 180, goalie: false }]);
}

// ---- a net already present → untouched; a passer counts as a target too ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE N9 net 17 42.5
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 160,40
PIECE PK1 puck 55 40 on=P1 shoot=1^P1`);
  T('net present: no injection', nets(pieces).map(n => n.id), ['N9']);
  const { pieces: pp } = parseDrill(`DSL 9
RINK full
PIECE PS1 passer 160 40
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 150,40
PIECE PK1 puck 55 40 on=P1 shoot=1^P1`);
  T('passer present: no injection', nets(pp), []);
}

// ---- shot pinned to an existing bumper → explicit deflect, no injection ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE B1 bumper 150 40
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 120,40
PIECE PK1 puck 55 40 on=P1 shoot=1^P1>B1`);
  T('bumper pin: no injection', nets(pieces), []);
}

// ---- rebound= (shot handoff) and legacy net=left both trigger/pin ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE P1 player 120 40 #d7263d P1
PATH P1 L 160,40
PIECE P2 player 170 50 #1f4fa3 P2
PIECE PK1 puck 115 40 on=P1 rebound=1:P2`);
  T('rebound: right-crease net', nets(pieces).map(n => n.x), [189]);
  const { pieces: pl } = parseDrill(`DSL 9
RINK full
PIECE P1 player 150 40 #d7263d P1
PATH P1 L 170,40
PIECE PK1 puck 145 40 on=P1 net=left shoot=1^P1`);
  T('net=left pins the left crease', nets(pl).map(n => n.x), [11]);
}

// ---- no shot at all → nothing injected ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 120,40
PIECE PK1 puck 55 40 on=P1 pass=1:P1`);
  T('no shot: no injection', nets(pieces), []);
}

// ---- BRANCH shoot action triggers off the fork path's end ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE LT1 light 100 8 cues=2ea043:2
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 100,40
BRANCH P1 2ea043 shoot L 150,40
PIECE PK1 puck 55 40 on=P1`);
  T('fork shoot: right-crease net', nets(pieces).map(n => n.x), [189]);
}

// ---- round-trip stability: injected net serializes, re-parse injects nothing ----
{
  const r1 = parseDrill(`DSL 9
RINK full
PIECE P1 player 60 40 #d7263d P1
PATH P1 L 160,40
PIECE PK1 puck 55 40 on=P1 shoot=1^P1`);
  const text2 = serializeDrill(r1.rink, r1.pieces);
  const r2 = parseDrill(text2);
  T('round-trip: still one net', nets(r2.pieces).length, 1);
  T('round-trip: text stable', serializeDrill(r2.rink, r2.pieces), text2);
}

// ---- ensureShotNet same-reference contract (the React hook relies on it) ----
{
  const { pieces } = parseDrill(`DSL 9
RINK full
PIECE N1 net 17 42.5
PIECE P1 player 60 40 #d7263d P1
PIECE PK1 puck 55 40 on=P1 shoot=1^P1`);
  T('same ref when target present', ensureShotNet(pieces) === pieces, true);
  T('same ref when no shot', ensureShotNet([{ id: 'P1', kind: 'player', x: 5, y: 5 }].slice()) !== null, true);
  const bare = [{ id: 'P1', kind: 'player', x: 5, y: 5, path: [] }];
  T('same ref, no shot, exact', ensureShotNet(bare) === bare, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
