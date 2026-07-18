// "Let AI play" — an offline, systems-based 5v5 hockey brain.
//
// Design: a deterministic playbook, not an LLM. Every skater has a ROLE
// (LW/C/RW/LD/RD) and every game state maps to a SYSTEM (breakout, rush,
// attack, forecheck, neutral-zone D, D-zone coverage). Each system assigns
// structured target positions; the puck carrier reads pressure and lanes to
// carry / pass / shoot / chip, and the rulebook enforces offside and icing
// with proper faceoffs. This is the layer we'll keep teaching.
//
// Rink feet: x 0..200, y 0..85. Goal lines 17/183, blue lines 75/125,
// center 100. End-zone dots (45/155, 20.5/64.5), neutral dots (80/120, …).
import * as boards from "./boards.js";

/* ------------------------------------------------------------------ */
/* tunables                                                           */
const SKATE = 26;                 // max skater speed (ft/s)
const CARRY_SPEED = 23;           // carriers skate a touch slower
const ACC = 80;                   // steering responsiveness
const PASS_V = 74, SHOT_V = 108, DUMP_V = 80;
const RIM_V = 96, CHIP_V = 54;    // rim the boards / soft self-chip
const REACH = 2.9;                // puck pickup radius
const SHOT_RANGE = 46;
const LANE_BUF = 4.6;             // a passing/shooting lane is blocked within this
const GAP_LOOK = 14;              // carrier looks this far ahead for a defender
// contact & takeaways
const STEAL_RANGE = 3.7;          // poke / stick-check reach
const STEAL_RATE = 2.1;           // takeaways per second while a defender is in tight
const HIT_RANGE = 3.3;            // body-check contact range
const HIT_CLOSE = 11;             // min closing speed (ft/s) to land a check
const HIT_RATE = 3.0;             // checks per second once lined up
const STUN = 0.9;                 // seconds a checked player is down
const KNOCK = 15;                 // body-check knockback impulse

/* ------------------------------------------------------------------ */
/* geometry                                                           */
const OWN_BLUE = 58, CENTER_F = 83, ATT_BLUE = 108, ATT_GOAL = 166;
const NETS = [{ x: 17, y: 42.5 }, { x: 183, y: 42.5 }];

const dir = t => (t === 0 ? 1 : -1);           // team 0 attacks +x
const ownGoalX = t => (t === 0 ? 17 : 183);
const attNet = t => (t === 0 ? NETS[1] : NETS[0]);
const ax = (t, feet) => ownGoalX(t) + dir(t) * feet;      // x at `feet` up-ice from own goal
const feetOf = (t, x) => (t === 0 ? x - 17 : 183 - x);    // up-ice distance for team t
const zoneT = (t, x) => { const f = feetOf(t, x); return f < OWN_BLUE ? "dz" : f < ATT_BLUE ? "nz" : "oz"; };

const R = () => Math.random();
const cX = x => Math.max(3, Math.min(197, x));
const cY = y => Math.max(3, Math.min(82, y));
const cFeetY = y => Math.max(6, Math.min(79, y));
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isD = role => role[1] === "D";

// perpendicular distance from point p to segment a→b, plus whether p projects onto it
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  let s = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  s = Math.max(0, Math.min(1, s));
  return Math.hypot(p.x - (a.x + vx * s), p.y - (a.y + vy * s));
}
// is the straight line from `a` to `b` clear of the given players?
function laneOpen(a, b, blockers, buf = LANE_BUF) {
  return !blockers.some(q => segDist(q, a, b) < buf);
}

/* ------------------------------------------------------------------ */
/* game construction & faceoffs                                        */
export function newGame() {
  const players = [];
  const cols = ["#d7263d", "#1f4fa3"];
  const roles = ["LW", "C", "RW", "LD", "RD"];
  for (let t = 0; t < 2; t++)
    for (let i = 0; i < 5; i++)
      players.push({ id: `${t}${roles[i]}`, team: t, color: cols[t], role: roles[i],
        x: 100, y: 42.5, vx: 0, vy: 0, a: t === 0 ? 0 : 180, tx: 100, ty: 42.5, stun: 0 });
  const g = {
    players,
    puck: { x: 100, y: 42.5, vx: 0, vy: 0, carrier: null, flying: false, shot: null,
      lastTeam: 0, releaseFeet: 0, pf: 83 },
    goalies: [{ x: 17, y: 42.5, a: 0 }, { x: 183, y: 42.5, a: 180 }],
    score: [0, 0], faceoff: 1, msg: "Face-off", flashT: 0,
  };
  faceoff(g, 100, 42.5, "Face-off");
  return g;
}

// drop the puck at a dot and line both teams up on their own side of it
function faceoff(g, dotX, dotY, msg) {
  const p = g.puck;
  p.x = dotX; p.y = dotY; p.vx = 0; p.vy = 0;
  p.carrier = null; p.flying = false; p.shot = null; p.pf = 83;
  const back = { C: 2, LW: 7, RW: 7, LD: 17, RD: 17 };
  const yoff = { C: 0, LW: -9, RW: 9, LD: -12, RD: 12 };
  g.players.forEach(pl => {
    pl.x = cX(dotX - dir(pl.team) * back[pl.role]);
    pl.y = cY(dotY + yoff[pl.role]);
    pl.vx = 0; pl.vy = 0; pl.a = pl.team === 0 ? 0 : 180; pl.stun = 0;
  });
  g.faceoff = 1; g.msg = msg; g.flashT = 0;
}

/* ------------------------------------------------------------------ */
/* the playbook — assign a target position to every skater             */
function assignTargets(g) {
  const { players, puck } = g;
  const carrier = puck.carrier && players.find(p => p.id === puck.carrier);
  const possTeam = carrier ? carrier.team : puck.lastTeam;   // the attacking team
  const loose = !puck.carrier && !puck.flying;
  const wallY = puck.y < 42.5 ? 15 : 70;                     // strong-side wall
  const weakY = puck.y < 42.5 ? 70 : 15;

  for (let t = 0; t < 2; t++) {
    const mates = players.filter(p => p.team === t);
    const weAttack = possTeam === t;
    const pz = zoneT(t, puck.x);
    const puckInOz = zoneT(t, puck.x) === "oz";
    // keep attacking support onside: never target past the blue line before the puck is in
    const onside = tx => (puckInOz ? tx : (feetOf(t, tx) > 104 ? ax(t, 104) : tx));

    // the strong-side winger (nearer the puck's wall) vs the weak-side one
    const lw = mates.find(p => p.role === "LW"), rw = mates.find(p => p.role === "RW");
    const strongW = puck.y < 42.5 ? lw : rw, weakW = puck.y < 42.5 ? rw : lw;

    // dynamic pressure man: nearest skater to the puck presses; nearest D contains
    const nearestFwd = mates.filter(p => !isD(p.role)).reduce((a, b) => (D(b, puck) < D(a, puck) ? b : a));
    const nearestD = mates.filter(p => isD(p.role)).reduce((a, b) => (D(b, puck) < D(a, puck) ? b : a));

    mates.forEach(p => {
      let tx, ty;
      const strong = p === strongW, forward = !isD(p.role);

      if (loose) {
        // race the nearest man to the puck; everyone else holds a soft home
        if (p === nearestFwd || (isD(p.role) && p === nearestD && D(p, puck) < 30)) { tx = puck.x; ty = puck.y; }
        else if (isD(p.role)) { tx = ax(t, OWN_BLUE - 8); ty = p.role === "LD" ? 30 : 55; }
        else { tx = ax(t, CENTER_F - 6); ty = p.role === "C" ? 42.5 : (p.role === "LW" ? 24 : 61); }
      } else if (weAttack && pz === "dz") {
        // BREAKOUT: move the puck out of our end with structure
        if (isD(p.role)) { tx = ax(t, 12); ty = p.role === "LD" ? 27 : 58; }          // D-to-D outlets, low
        else if (p.role === "C") { tx = ax(t, 40); ty = 42.5; }                        // center swings low
        else if (strong) { tx = ax(t, OWN_BLUE); ty = wallY; }                         // strong wall outlet
        else { tx = ax(t, CENTER_F + 10); ty = weakY; }                                // weak-side stretch
      } else if (weAttack && pz === "nz") {
        // RUSH: gain the line with speed, wide lanes, D trailing as points
        if (isD(p.role)) { tx = ax(t, CENTER_F - 6); ty = p.role === "LD" ? 30 : 55; }
        else if (p.role === "C") { tx = onside(ax(t, ATT_BLUE - 4)); ty = 42.5; }      // drive the middle
        else { tx = onside(ax(t, ATT_BLUE - 3)); ty = p.role === "LW" ? 18 : 67; }     // wide drives
      } else if (weAttack && pz === "oz") {
        // ATTACK: net-front, slot support, points hold the line, cycle low
        if (isD(p.role)) { tx = ax(t, ATT_BLUE - 2); ty = p.role === "LD" ? 30 : 55; } // points, keep it in
        else if (p.role === "C") { tx = ax(t, 150); ty = 42.5; }                       // net-front screen
        else if (strong) { tx = ax(t, 132); ty = wallY; }                              // wall / cycle
        else { tx = ax(t, 142); ty = weakY < 42.5 ? 34 : 51; }                         // backdoor
      } else if (!weAttack && pz === "oz") {
        // FORECHECK (puck deep in our attacking zone): pressure + hold the line
        if (isD(p.role)) { tx = ax(t, ATT_BLUE - 2); ty = p.role === "LD" ? 30 : 55; } // hold blue, keep in
        else if (p === nearestFwd) { tx = puck.x; ty = puck.y; }                       // F1 pressures
        else if (strong) { tx = ax(t, 128); ty = wallY; }                              // F2 strong support
        else { tx = ax(t, 116); ty = 42.5; }                                           // F3 high middle
      } else if (!weAttack && pz === "nz") {
        // NEUTRAL-ZONE D: stand up at our blue, gap the carrier, backcheck
        if (isD(p.role)) { tx = ax(t, OWN_BLUE - 2); ty = p.role === "LD" ? 28 : 57; }
        else if (p.role === "C") { tx = ax(t, 70); ty = 42.5; }
        else { tx = ax(t, 64); ty = p.role === "LW" ? 24 : 61; }
      } else {
        // D-ZONE COVERAGE (puck in our end): collapse and protect the house
        if (p === nearestD && D(p, puck) < 34) { tx = puck.x; ty = puck.y; }           // strong D contains
        else if (isD(p.role)) { tx = ax(t, 12); ty = 42.5; }                           // net-front D
        else if (p.role === "C") { tx = ax(t, 24); ty = 42.5; }                        // low slot support
        else { tx = ax(t, OWN_BLUE - 4); ty = p.role === "LW" ? 24 : 61; }             // cover the points
      }
      p.tx = cX(tx); p.ty = cFeetY(ty);
    });
  }
}

/* ------------------------------------------------------------------ */
/* the puck carrier's read — carry past pressure, pass, shoot, or chip */
function decideCarrier(g, car, dt) {
  const { players, puck } = g;
  const t = car.team;
  const net = attNet(t);
  const zone = zoneT(t, car.x);
  const opp = players.filter(p => p.team !== t);
  const mates = players.filter(p => p.team === t && p.id !== car.id);
  const nearD = opp.reduce((a, b) => (D(b, car) < D(a, car) ? b : a));
  const pressure = D(nearD, car);
  const puckInOz = zone === "oz";

  const release = () => { puck.carrier = null; puck.flying = true; puck.lastTeam = t;
    puck.releaseFeet = feetOf(t, car.x); };

  // 1) SHOOT — in the offensive zone, in range, with a lane to the net
  const distNet = D(car, net);
  if (puckInOz && distNet < SHOT_RANGE && laneOpen(car, net, opp, 3.4)) {
    const q = Math.max(0, (SHOT_RANGE - distNet) / SHOT_RANGE);
    const slot = Math.max(0, 1 - Math.abs(car.y - 42.5) / 26);
    const wantShoot = 0.9 + q * 3 + (pressure < 7 ? 1.6 : 0);   // per-second rate
    if (R() < wantShoot * dt) {
      const goal = R() < 0.06 + 0.34 * q * slot;                // beats the goalie?
      const aimY = 37 + R() * 11 + (R() - 0.5) * 4;
      const ang = Math.atan2(aimY - car.y, net.x - car.x);
      release(); puck.shot = { net, team: t, goal };
      puck.vx = Math.cos(ang) * SHOT_V; puck.vy = Math.sin(ang) * SHOT_V;
      car.a = (ang * 180) / Math.PI;
      return;
    }
  }

  // 1b) RIM — near our own boards under pressure (breakout / clear): rim it up
  // the wall so it follows the boards to a winger instead of forcing a play
  const edge = boards.edgeDist(car.x, car.y);
  if (!puckInOz && edge < 10 && pressure < 8.5 && R() < 2.2 * dt) {
    const dv = boards.tangentToward({ x: car.x, y: car.y }, net);   // along the boards, up-ice
    release(); puck.shot = null;
    puck.vx = dv.x * RIM_V; puck.vy = dv.y * RIM_V;
    car.a = (Math.atan2(dv.y, dv.x) * 180) / Math.PI;
    return;
  }

  // 1c) SELF-CHIP — a defender is square in the lane; chip past him to open ice
  // and chase it (beat the check off the boards / into space)
  if (zone !== "dz" && pressure < 6.5) {
    const toNet = Math.atan2(net.y - car.y, net.x - car.x);
    const toD = Math.atan2(nearD.y - car.y, nearD.x - car.x);
    const blocking = Math.abs(Math.atan2(Math.sin(toD - toNet), Math.cos(toD - toNet))) < 0.55;
    if (blocking && R() < 2.6 * dt) {
      const side = car.y <= nearD.y ? -1 : 1;                        // toward the open side
      const ang = toNet + side * 0.5;
      release(); puck.shot = null;
      puck.vx = Math.cos(ang) * CHIP_V; puck.vy = Math.sin(ang) * CHIP_V;
      return;
    }
  }

  // 2) PASS — when pressured, hit the best open, onside, more-advanced teammate
  if (pressure < 9) {
    let best = null, bestScore = -1e9;
    mates.forEach(m => {
      const mFeet = feetOf(t, m.x);
      if (!puckInOz && mFeet > ATT_BLUE) return;               // don't spring an offside
      if (!laneOpen(car, m, opp)) return;                       // lane must be clean
      const nearestToM = opp.reduce((mn, o) => Math.min(mn, D(o, m)), 99);
      const advance = mFeet - feetOf(t, car.x);
      const score = advance * 0.8 + nearestToM * 1.3 - D(car, m) * 0.15;
      if (score > bestScore) { bestScore = score; best = m; }
    });
    const wantPass = (pressure < 6 ? 3.2 : 1.4);
    if (best && bestScore > 4 && R() < wantPass * dt) {
      const lead = { x: best.x + best.vx * 0.28, y: best.y + best.vy * 0.28 };
      const ang = Math.atan2(lead.y - car.y, lead.x - car.x);
      release(); puck.shot = null;
      puck.vx = Math.cos(ang) * PASS_V; puck.vy = Math.sin(ang) * PASS_V;
      car.a = (ang * 180) / Math.PI;
      return;
    }
  }

  // 3) CHIP-AND-CHASE — pinned at the blue line with no entry and no pass
  const atLine = zone === "nz" && feetOf(t, car.x) > ATT_BLUE - 14;
  if (atLine && pressure < 6 && R() < 2.4 * dt) {
    const cornerY = car.y < 42.5 ? 16 : 69;
    const ang = Math.atan2(cornerY - car.y, ax(t, 150) - car.x);
    release(); puck.shot = null;
    puck.vx = Math.cos(ang) * DUMP_V; puck.vy = Math.sin(ang) * DUMP_V;
    return;
  }
  // else: keep the puck — carry logic in movement steers around the defender
}

// where should the carrier skate to beat the nearest defender?
function carrierAim(car, net, opp) {
  const base = { x: net.x, y: net.y };
  // the closest defender roughly between carrier and net
  let block = null, bd = GAP_LOOK;
  const toNet = Math.atan2(net.y - car.y, net.x - car.x);
  opp.forEach(o => {
    const d = D(car, o);
    if (d > bd) return;
    const toO = Math.atan2(o.y - car.y, o.x - car.x);
    let da = Math.abs(Math.atan2(Math.sin(toO - toNet), Math.cos(toO - toNet)));
    if (da < 0.9) { bd = d; block = o; }
  });
  if (!block) return base;
  // cut to the more open side of the defender (deke)
  const perp = toNet + Math.PI / 2;
  const side = ((car.x - block.x) * Math.cos(perp) + (car.y - block.y) * Math.sin(perp)) >= 0 ? 1 : -1;
  const cutToCenter = car.y < 20 ? 1 : car.y > 65 ? -1 : side;   // avoid pinning to the wall
  const s = Math.sign(cutToCenter) || 1;
  return { x: net.x, y: car.y + s * (car.y < 42.5 ? 16 : -16) };
}

/* ------------------------------------------------------------------ */
/* contact — body checks and stick/poke takeaways strip the carrier    */
function resolveContact(g, dt) {
  const { players, puck } = g;
  const car = puck.carrier && players.find(p => p.id === puck.carrier);
  if (!car || car.stun > 0) return;
  const opp = players.filter(p => p.team !== car.team && p.stun <= 0);
  if (!opp.length) return;
  const near = opp.reduce((a, b) => (D(b, car) < D(a, car) ? b : a));
  const nd = D(near, car) || 1;
  const ux = (car.x - near.x) / nd, uy = (car.y - near.y) / nd;
  const closing = near.vx * ux + near.vy * uy;      // how fast the checker is bearing in

  const drop = (ang, v) => {                          // knock the puck loose
    puck.carrier = null; puck.flying = true; puck.shot = null;
    puck.vx = Math.cos(ang) * v; puck.vy = Math.sin(ang) * v;
    puck.lastTeam = car.team; puck.releaseFeet = feetOf(car.team, car.x);
    puck.pf = feetOf(car.team, puck.x);
  };

  // BODY CHECK — a defender closing hard within contact range levels the carrier
  if (nd < HIT_RANGE && closing > HIT_CLOSE && R() < HIT_RATE * dt) {
    car.stun = STUN;
    car.vx = ux * KNOCK; car.vy = uy * KNOCK;         // knocked off the puck
    drop(Math.atan2(uy, ux) + (R() - 0.5) * 1.3, 26 + R() * 20);  // puck squirts past the hit
    near.vx *= 0.45; near.vy *= 0.45;                 // checker follows through
    g.msg = "Big hit!"; g.flashT = 1.1;
    return;
  }
  // STICK / POKE CHECK — strip the puck when in tight, no hit
  if (nd < STEAL_RANGE && R() < STEAL_RATE * dt) {
    drop(Math.atan2(near.y - car.y, near.x - car.x) + (R() - 0.5) * 0.7, 10 + R() * 14);
  }
}

/* ------------------------------------------------------------------ */
/* goalies track the puck on the crease arc                            */
function updateGoalies(g) {
  const { puck } = g;
  NETS.forEach((net, idx) => {
    const b = net.x < 100 ? 0 : Math.PI;
    let rel = Math.atan2(puck.y - net.y, puck.x - net.x) - b;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const MR = (72 * Math.PI) / 180;
    rel = Math.max(-MR, Math.min(MR, rel));
    const d = D(puck, net);
    const depth = Math.max(0.6, Math.min(6, 0.6 + ((Math.min(45, d) - 9) / 36) * 5.4));
    const a = b + rel;
    g.goalies[idx] = { x: net.x + Math.cos(a) * depth, y: net.y + Math.sin(a) * depth, a: (a * 180) / Math.PI };
  });
}

/* ------------------------------------------------------------------ */
/* main step                                                           */
export function stepGame(g, dt) {
  dt = Math.min(dt, 0.05);
  const { players, puck } = g;

  if (g.faceoff > 0) {                        // settle after a whistle
    g.faceoff -= dt;
    if (g.faceoff <= 0) g.msg = "";
    updateGoalies(g);
    return g;
  }
  if (g.flashT > 0) { g.flashT -= dt; if (g.flashT <= 0) g.msg = ""; }  // clear "Big hit!"

  // ---- puck motion + rules ----
  const carrier = puck.carrier && players.find(p => p.id === puck.carrier);
  if (carrier) {
    const on = attNet(carrier.team);
    const ang = Math.atan2(on.y - carrier.y, on.x - carrier.x);
    const cc = boards.clampInside(carrier.x + Math.cos(ang) * 2.2, carrier.y + Math.sin(ang) * 2.2);
    puck.x = cc.x; puck.y = cc.y;
    puck.lastTeam = carrier.team;
  } else if (puck.flying) {
    puck.x += puck.vx * dt; puck.y += puck.vy * dt;
    puck.vx *= 0.987; puck.vy *= 0.987;
    const c = boards.contain(puck.x, puck.y, puck.vx, puck.vy, 0.75);  // rim / bounce off the boards
    puck.x = c.x; puck.y = c.y; puck.vx = c.vx; puck.vy = c.vy;
    // a shot arriving at the net → goal or save (rebound)
    if (puck.shot && D(puck, puck.shot.net) < 4.5) {
      if (puck.shot.goal) { g.score[puck.shot.team]++; faceoff(g, 100, 42.5, "GOAL!"); updateGoalies(g); return g; }
      puck.vx = (R() - 0.5) * 42; puck.vy = (R() - 0.5) * 42; puck.shot = null;
    }
    if (Math.hypot(puck.vx, puck.vy) < 8) { puck.flying = false; puck.vx = 0; puck.vy = 0; }
  }

  // ICING — puck dumped from behind center, across the far goal line, untouched
  if (puck.flying && !puck.shot && puck.releaseFeet < CENTER_F) {
    const lt = puck.lastTeam;
    if (feetOf(lt, puck.x) >= ATT_GOAL) {
      const dotX = lt === 0 ? 45 : 155, dotY = puck.y < 42.5 ? 20.5 : 64.5;
      faceoff(g, dotX, dotY, "Icing"); updateGoalies(g); return g;
    }
  }
  // OFFSIDE — puck enters the attacking zone with a teammate already in
  {
    const lt = puck.lastTeam;
    const f = feetOf(lt, puck.x);
    if (puck.pf <= ATT_BLUE && f > ATT_BLUE) {                 // just crossed the blue line
      const early = players.some(p => p.team === lt && p.id !== puck.carrier && feetOf(lt, p.x) > ATT_BLUE + 1);
      if (early) {
        const dotX = lt === 0 ? 120 : 80, dotY = puck.y < 42.5 ? 20.5 : 64.5;
        faceoff(g, dotX, dotY, "Offside"); updateGoalies(g); return g;
      }
    }
    puck.pf = f;
  }

  // ---- possession: nearest man within reach gains the puck (not if down) ----
  if (!puck.carrier) {
    let best = null, bd = REACH;
    players.forEach(p => {
      if (p.stun > 0) return;
      const d = D(p, puck);
      if (d < bd && (!puck.flying || Math.hypot(puck.vx, puck.vy) < 52)) { bd = d; best = p; }
    });
    if (best) { puck.carrier = best.id; puck.flying = false; puck.vx = puck.vy = 0;
      puck.shot = null; puck.lastTeam = best.team; puck.pf = feetOf(best.team, puck.x); }
  }

  // ---- contact: check / strip the carrier, then re-read possession ----
  resolveContact(g, dt);

  // ---- decisions & structure ----
  const car = puck.carrier && players.find(p => p.id === puck.carrier);
  if (car) decideCarrier(g, car, dt);
  assignTargets(g);

  // ---- movement ----
  const carNow = puck.carrier && players.find(p => p.id === puck.carrier);
  players.forEach(p => {
    if (p.stun > 0) {                          // knocked down — slide, then get up
      p.stun -= dt; p.vx *= 0.85; p.vy *= 0.85;
      p.x = cX(p.x + p.vx * dt); p.y = cY(p.y + p.vy * dt);
      return;
    }
    if (carNow && p.id === carNow.id) {
      const aim = carrierAim(p, attNet(p.team), players.filter(q => q.team !== p.team));
      steer(p, aim.x, aim.y, dt, CARRY_SPEED);
    } else {
      steer(p, p.tx, p.ty, dt);
    }
    // soft separation so teammates don't stack
    players.forEach(q => { if (q !== p) { const d = D(p, q); if (d < 4 && d > 0.01) {
      p.vx += ((p.x - q.x) / d) * 9 * dt; p.vy += ((p.y - q.y) / d) * 9 * dt; } } });
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > SKATE) { p.vx = (p.vx / sp) * SKATE; p.vy = (p.vy / sp) * SKATE; }
    const pc = boards.clampInside(p.x + p.vx * dt, p.y + p.vy * dt);   // skaters ride the boards
    p.x = pc.x; p.y = pc.y;
    if (sp > 3 && !(carNow && p.id === carNow.id)) p.a = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
    else if (carNow && p.id === carNow.id) { const n = attNet(p.team); p.a = (Math.atan2(n.y - p.y, n.x - p.x) * 180) / Math.PI; }
  });

  updateGoalies(g);
  return g;
}

function steer(p, tx, ty, dt, speed = SKATE) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, (ACC * dt) / speed);
  p.vx += ((dx / d) * speed - p.vx) * k;
  p.vy += ((dy / d) * speed - p.vy) * k;
}
