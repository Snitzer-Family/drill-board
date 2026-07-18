// "Let AI play" — a lightweight real-time 5v5 sim: possession, passing,
// shooting, defending, goalies, and face-offs. All positions in rink feet
// (x 0..200, y 0..85). This is a loose behaviour model, not a real game engine.

const SKATE = 27;                 // max skater speed (ft/s)
const ACC = 90;                   // steering responsiveness
const PASS_V = 62, SHOT_V = 100;  // puck speeds
const REACH = 2.8;                // puck pickup radius
const SHOT_RANGE = 44;

const LNET = { x: 17, y: 42.5 };  // team 1 attacks here / team 0 defends
const RNET = { x: 183, y: 42.5 }; // team 0 attacks here / team 1 defends
const offNet = t => (t === 0 ? RNET : LNET);
const defNet = t => (t === 0 ? LNET : RNET);

const R = () => Math.random();
const cX = x => Math.max(3, Math.min(197, x));
const cY = y => Math.max(3, Math.min(82, y));
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function newGame() {
  const players = [];
  const cols = ["#d7263d", "#1f4fa3"];
  for (let team = 0; team < 2; team++)
    for (let i = 0; i < 5; i++) {
      const role = i < 3 ? "F" : "D";
      players.push({ id: `${team}${i}`, team, color: cols[team], role, lane: i,
        x: 0, y: 0, vx: 0, vy: 0, a: team === 0 ? 0 : 180 });
    }
  const g = { players, puck: { x: 100, y: 42.5, vx: 0, vy: 0, carrier: null, flying: false, shot: null },
    goalies: [{ x: LNET.x, y: LNET.y, a: 0 }, { x: RNET.x, y: RNET.y, a: 180 }],
    score: [0, 0], faceoff: 0.8, msg: "Face-off" };
  resetFaceoff(g);
  g.faceoff = 0.8; g.msg = "Face-off";
  return g;
}

function resetFaceoff(g) {
  const p = g.puck;
  p.x = 100; p.y = 42.5; p.vx = 0; p.vy = 0; p.carrier = null; p.flying = false; p.shot = null;
  g.players.forEach(pl => {
    const sign = pl.team === 0 ? -1 : 1;
    pl.x = 100 + sign * (pl.role === "F" ? 12 + (pl.lane % 3) * 4 : 34);
    pl.y = 18 + (pl.lane % 5) * 12; pl.vx = 0; pl.vy = 0;
  });
}

function steer(p, tx, ty, dt, speed = SKATE) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, (ACC * dt) / speed);
  p.vx += ((dx / d) * speed - p.vx) * k;
  p.vy += ((dy / d) * speed - p.vy) * k;
}

function updateGoalies(g) {
  const { puck } = g;
  [[LNET, 0], [RNET, 1]].forEach(([net, idx]) => {
    const base = net.x < 100 ? 0 : Math.PI;
    let rel = Math.atan2(puck.y - net.y, puck.x - net.x) - base;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const MR = (72 * Math.PI) / 180;
    rel = Math.max(-MR, Math.min(MR, rel));
    const d = D(puck, net);
    const depth = Math.max(0.6, Math.min(6, 0.6 + ((Math.min(45, d) - 9) / 36) * 5.4));
    const a = base + rel;
    g.goalies[idx] = { x: net.x + Math.cos(a) * depth, y: net.y + Math.sin(a) * depth, a: (a * 180) / Math.PI };
  });
}

export function stepGame(g, dt) {
  dt = Math.min(dt, 0.05);
  const { players, puck } = g;

  if (g.faceoff > 0) {                       // brief settle after a whistle/goal
    g.faceoff -= dt;
    if (g.faceoff <= 0) g.msg = "";
    updateGoalies(g);
    return g;
  }

  // ----- puck motion -----
  const carrier = puck.carrier && players.find(p => p.id === puck.carrier);
  if (carrier) {
    const on = offNet(carrier.team);
    const ang = Math.atan2(on.y - carrier.y, on.x - carrier.x);
    puck.x = carrier.x + Math.cos(ang) * 2.2;
    puck.y = carrier.y + Math.sin(ang) * 2.2;
    carrier.a = (ang * 180) / Math.PI;
  } else if (puck.flying) {
    puck.x += puck.vx * dt; puck.y += puck.vy * dt;
    puck.vx *= 0.987; puck.vy *= 0.987;
    if (puck.x < 4 || puck.x > 196) puck.vx *= -0.6;
    if (puck.y < 4 || puck.y > 81) puck.vy *= -0.6;
    puck.x = cX(puck.x); puck.y = cY(puck.y);
    if (puck.shot && D(puck, puck.shot.net) < 4.5) {
      if (puck.shot.goal) { g.score[puck.shot.team]++; g.msg = "GOAL!"; resetFaceoff(g); g.faceoff = 1.4; updateGoalies(g); return g; }
      puck.vx = (R() - 0.5) * 44; puck.vy = (R() - 0.5) * 44; puck.shot = null; // save → rebound
    }
    if (Math.hypot(puck.vx, puck.vy) < 8) { puck.flying = false; puck.vx = 0; puck.vy = 0; }
  }

  // ----- possession -----
  if (!puck.carrier) {
    let best = null, bd = REACH;
    players.forEach(p => { const d = D(p, puck); if (d < bd && (!puck.flying || Math.hypot(puck.vx, puck.vy) < 48)) { bd = d; best = p; } });
    if (best) { puck.carrier = best.id; puck.flying = false; puck.vx = puck.vy = 0; puck.shot = null; }
  }

  // ----- carrier decision -----
  const car = puck.carrier && players.find(p => p.id === puck.carrier);
  if (car) {
    const on = offNet(car.team);
    const dNet = D(car, on);
    const opp = players.filter(p => p.team !== car.team);
    const nearD = opp.reduce((a, b) => (D(b, car) < D(a, car) ? b : a), opp[0]);
    const pressured = nearD && D(nearD, car) < 9;
    if (dNet < SHOT_RANGE && (R() < 0.03 || (pressured && R() < 0.55))) {
      const goal = R() < 0.4;
      const ang = Math.atan2(on.y - car.y + (R() - 0.5) * 5, on.x - car.x);
      puck.carrier = null; puck.flying = true; puck.shot = { net: on, team: car.team, goal };
      puck.vx = Math.cos(ang) * SHOT_V; puck.vy = Math.sin(ang) * SHOT_V;
      car.a = (ang * 180) / Math.PI;
    } else if (pressured && R() < 0.6) {
      const mates = players.filter(p => p.team === car.team && p.id !== car.id);
      const pick = mates.map(m => ({ m, s: (car.team === 0 ? m.x : -m.x) - opp.reduce((mn, o) => Math.min(mn, D(o, m)), 99) * 0.6 }))
        .sort((a, b) => b.s - a.s)[0];
      if (pick) {
        const ang = Math.atan2(pick.m.y - car.y, pick.m.x - car.x);
        puck.carrier = null; puck.flying = true; puck.shot = null;
        puck.vx = Math.cos(ang) * PASS_V; puck.vy = Math.sin(ang) * PASS_V;
        car.a = (ang * 180) / Math.PI;
      }
    }
  }

  // ----- skater movement -----
  const carNow = puck.carrier && players.find(p => p.id === puck.carrier);
  const puckTeam = carNow ? carNow.team : (puck.shot ? puck.shot.team : null);
  // loose puck → the nearest player on each team races for it
  const loose = !puck.carrier && !(puck.flying && puck.shot);
  const chasers = new Set();
  if (loose) [0, 1].forEach(team => {
    const mates = players.filter(p => p.team === team);
    if (mates.length) chasers.add(mates.reduce((a, b) => (D(b, puck) < D(a, puck) ? b : a)).id);
  });
  players.forEach(p => {
    if (carNow && p.id === carNow.id) {
      const on = offNet(p.team);
      steer(p, on.x, on.y + (p.y - 42.5) * 0.35, dt);
    } else if (chasers.has(p.id)) {
      steer(p, puck.x, puck.y, dt);
    } else if (puckTeam != null && p.team === puckTeam) {
      const on = offNet(p.team);
      const laneY = [22, 42.5, 63][p.lane % 3];
      const depth = on.x + (p.team === 0 ? -1 : 1) * (p.role === "F" ? 22 : 48);
      steer(p, depth, laneY, dt);
    } else {
      const dn = defNet(p.team);
      const dx = puck.x - dn.x, dy = puck.y - dn.y, dd = Math.hypot(dx, dy) || 1;
      const gap = Math.max(8, Math.min(42, dd * 0.5));
      let tx = dn.x + (dx / dd) * gap, ty = dn.y + (dy / dd) * gap;
      ty += (42.5 - ty) * 0.25;
      steer(p, tx, ty + (p.lane - 2) * 4, dt);
    }
    players.forEach(q => { if (q !== p) { const d = D(p, q); if (d < 4 && d > 0.01) { p.vx += ((p.x - q.x) / d) * 10 * dt; p.vy += ((p.y - q.y) / d) * 10 * dt; } } });
    const sp = Math.hypot(p.vx, p.vy); if (sp > SKATE) { p.vx = (p.vx / sp) * SKATE; p.vy = (p.vy / sp) * SKATE; }
    p.x = cX(p.x + p.vx * dt); p.y = cY(p.y + p.vy * dt);
    if (sp > 3 && !(carNow && p.id === carNow.id)) p.a = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
  });

  updateGoalies(g);
  return g;
}
