// The rotary action menu's pure core: which wedges a spot offers and which
// on-ice pieces light up as targets once a wedge is chosen. Pulled out of the
// app shell so the wedge tables and candidate pools are node-testable, and so
// the rotary and the inspector panel enumerate targets through the SAME code.
//
// Plain ESM with NO imports (like theme.js) — `node tests/action-menu.mjs`
// loads it directly. Anything that needs the app's closures (the possession
// ledger, puckChain) takes them as parameters instead.

// Wedges at a spot, outermost decision first: holding the puck offers the
// releases, empty hands offer the gains. "more" (⋯) opens the full inspector
// and is always last.
export function wedgesFor(holding) {
  return holding
    ? ["pass", "shoot", "chip", "rim", "more"]
    : ["receive", "collect", "more"];
}

// Players a pass can go to (anyone but the passer).
export function passPlayers(pieces, playerId) {
  return pieces.filter(q => q.kind === "player" && q.id !== playerId);
}

// Give-and-go bounce targets: the puck rebounds off these back to the passer.
export function viaTargets(pieces) {
  return pieces.filter(q => q.kind === "passer" || q.kind === "tire" || q.kind === "bumper");
}

// What a shot can be aimed at (the inspector's shootTargets2 list).
export function shootTargets(pieces) {
  return pieces.filter(q => q.kind === "net" || q.kind === "passer" || q.kind === "bumper" || q.kind === "tire");
}

// Pucks `playerId` could collect at a spot — a released chip / hard rim / shot,
// or a puck placed loose. `puckChain` is the app's chain reader (head +
// transfer receivers), passed in so this stays import-free.
export function collectCandidates(pieces, playerId, puckChain) {
  const player = pieces.find(q => q.id === playerId);
  if (!player) return [];
  return pieces.filter(q => {
    if (q.kind !== "puck") return false;
    const released = (q.terminals || []).length > 0;
    const loose = !q.carrier && !q.pickup && !(q.transfers || []).length && !released;
    if (!(released || loose)) return false;
    const ch = puckChain(q);
    // you can chip/rim your own puck and skate to retrieve it — allow a self
    // collect when the collector has a route to go get it; forbid only the
    // nonsensical stationary "collect the puck I'm still holding" case
    return !(released && ch[ch.length - 1] === playerId && !(player.path || []).length);
  });
}

// A receiver's routes with BRANCH-LOCAL indices — the recvAt/recvRef space a
// pass's catch point is stored in. Base ("") first, then each reaction branch
// by its colour-path ref. NOT enumerateRoutes: that returns concatenated flat
// indices for the animation, and a catch stored flat lands on the wrong point.
export function receiverRoutes(rec) {
  const routes = [];
  if (!rec) return routes;
  routes.push({ ref: "", path: rec.path || [] });
  const walk = (forks, prefix) => (forks || []).forEach(f => {
    if (!f.path || !f.path.length) return;
    const r = prefix ? prefix + "/" + f.color : f.color;
    routes.push({ ref: r, path: f.path });
    walk(f.forks, r);
  });
  walk(rec.forks, "");
  return routes;
}

// Is piece `id` a live target for the armed pick? Mirrors what
// renderPickTargets lights up, so a tap can never complete on an unlit piece.
export function isPickCandidate(pick, pieces, id, puckChain) {
  if (!pick || id === pick.pieceId) return false;
  const q = pieces.find(x => x.id === id);
  if (!q) return false;
  if (pick.kind === "pass")
    return q.kind === "player" || q.kind === "passer" || q.kind === "tire" || q.kind === "bumper";
  if (pick.kind === "shoot")
    return q.kind === "net" || q.kind === "passer" || q.kind === "bumper" || q.kind === "tire";
  if (pick.kind === "receive") return q.kind === "player";
  if (pick.kind === "collect")
    return collectCandidates(pieces, pick.pieceId, puckChain).some(c => c.id === id);
  return false;
}
