// Routes are first-class. A `route` piece owns geometry and nothing else, and the
// players standing on it are a LINE that runs it in turn — the shape every real
// practice plan is built from, and the one thing the old model (a route IS a
// player's `path`) could not say without hand-maintained copies that drift.
//
// This module is the lowering pass that turns "P2 is third on route R1" back into
// an ordinary player with an ordinary path, so src/timing.js keeps seeing the one
// model it already knows. It is the sibling of resolveForks() in the animator:
//
//     pieces -> lowerRoutes -> resolveForks -> createTiming
//               (lines)        (branches)
//
// The load-bearing decision: a queue member's path is the route's legs VERBATIM,
// with no prepended approach leg — they simply depart from their stand spot a few
// feet behind the head, so leg 0 is a little longer. That keeps leg index i of
// every member equal to waypoint i of the route, which is what lets puck actions
// (`transfers[].at`, `recvAt`, `pickup.at`) and delay triggers keep addressing a
// flat index and still mean what the coach sees on the route line. Prepending an
// approach leg would shift every index by one and drag shiftActionWaypoints into
// the lowering pass.
//
// Kept pure — no DOM, no React, no segRefs — so it is node-testable on its own.
// See tests/route-lines.mjs. Precedent: route-dir.js, possession.js.

import { segTangentAngle, clampX, clampY } from "./geometry.js";
import { QUEUE_GAP, QUEUE_LEAD } from "./constants.js";

// feet between stacked skaters, measured back along the route's entry heading,
// and how far clear of you the skater ahead gets before you go
export { QUEUE_GAP, QUEUE_LEAD };

// A player sorts by queue index; one without a `q` falls to the back of the line,
// and ties break on id so the stack order is stable frame to frame.
const qOf = p => (typeof p.q === "number" && isFinite(p.q) ? p.q : Infinity);
const byQueue = (a, b) => (qOf(a) - qOf(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// everyone standing on `routeId`, in the order they will be sent
export function queueOf(pieces, routeId) {
  return (pieces || []).filter(p => p.kind === "player" && p.route === routeId).sort(byQueue);
}

// Take a player off whatever line they were on, dropping the keys rather than
// blanking them so nothing downstream has to tell "unbound" from "bound to
// undefined" — and so the serializer emits no line tokens at all.
export function unbindLine(p) {
  if (!p || (p.route === undefined && p.q === undefined)) return p;
  const { route, q, ...rest } = p;
  return rest;
}

// Does this piece move under its own steam? Route-bound players have no `path` of
// their own until lowering, so a `path.length` test alone would file them as
// scenery — and the animator uses exactly that test to decide which players are
// static obstacles other routes detour around.
export const isMobile = p =>
  !!(p && ((p.path && p.path.length) || p.route || (p.forks && p.forks.length)));

// The route's direction of travel as it leaves the head, in degrees. Also what
// the head marker points along, so the glyph and the stack can never disagree.
// A route with no path yet falls back to its `facing`.
export function headHeadingDeg(route) {
  const path = (route && route.path) || [];
  return path.length
    ? segTangentAngle({ x: route.x, y: route.y }, path[0], 0)
    : ((route && route.facing) || 0);
}

// ...the same thing as a unit vector. The line stacks backwards along it, so
// skaters queue behind the start rather than beside it.
export function headHeading(route) {
  const a = (headHeadingDeg(route) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

// Where the skater at queue index `k` (0 = head of the line) stands. Each spot is
// clamped onto the ice on its own: a line aimed into a corner will bunch up at the
// boards rather than stand off them, which is visibly wrong and so self-correcting
// — the coach moves the route. Sliding the whole stack instead would take the head
// skater off the route's start, which is worse.
export function stackSpot(route, k, gap = QUEUE_GAP) {
  const h = headHeading(route);
  const d = Math.max(0, k) * (gap > 0 ? gap : QUEUE_GAP);
  return { x: clampX(route.x - h.x * d), y: clampY(route.y - h.y * d) };
}

// How a line releases: what holds skater k on their mark until it is their turn.
// The rule is authored ONCE on the route and resolved per member here, because
// the trigger is positional — "the one ahead of me" — and only the line knows who
// that is. `prevId` is member k-1; the head of the line is never held.
//
//   { mode: "point", at }  → hold until they reach waypoint `at` of the route.
//                            Lowers to the waypoint trigger timing.js already has.
//   { mode: "lead", lead } → hold until they are `lead` FEET clear of me. The two
//                            already start `spacing` apart, so what the skater
//                            ahead has to TRAVEL is lead − spacing; converting it
//                            here keeps timing.js measuring distance and knowing
//                            nothing about why.
export function queueRelease(route, prevId) {
  const q = route && route.queue;
  if (!q || !prevId) return null;
  if (q.mode === "point") return { on: prevId, at: Math.max(0, q.at || 0), mode: "waypoint" };
  if (q.mode === "lead") {
    const spacing = route.gap > 0 ? route.gap : QUEUE_GAP;
    const lead = q.lead > 0 ? q.lead : QUEUE_LEAD;
    return { on: prevId, dist: Math.max(0, lead - spacing), mode: "span" };
  }
  return null;
}

// Materialize every line into plain players and drop the route pieces, which are
// authoring objects the engine must never see (they would otherwise land in
// drillTime as zero-length routes and in the timing plan as bogus skaters).
//
// Returns `pieces` BY IDENTITY when there is no route on the board, so the
// identity-keyed plan cache in timing.js stays warm for every drill authored
// before this feature existed. Mirrors resolveForks' fast path.
export function lowerRoutes(pieces) {
  const list = pieces || [];
  if (!list.some(p => p.kind === "route")) return pieces;

  const routes = new Map();
  for (const p of list) if (p.kind === "route") routes.set(p.id, p);

  const lowered = new Map();
  for (const [id, R] of routes) {
    const gap = R.gap > 0 ? R.gap : QUEUE_GAP;
    const line = queueOf(list, id);
    line.forEach((P, k) => {
      const spot = stackSpot(R, k, gap);
      // the head of the line goes on the whistle; everyone behind waits their turn.
      // A member's OWN wait= is overwritten, not merged: the line owns the release.
      const wait = k > 0 ? queueRelease(R, line[k - 1].id) : null;
      lowered.set(P.id, {
        ...P,
        x: spot.x,
        y: spot.y,
        wait,
        // the route's legs verbatim — see the header on why nothing is prepended
        path: (R.path || []).map(s => ({ ...s })),
        // shared by reference: forks are immutable here, and resolveForks picks a
        // branch per PLAYER, so three skaters on one reactive route read the light
        // independently — which is exactly what a read-and-react drill wants
        forks: R.forks || [],
        _line: { route: id, q: k },
      });
    });
  }
  if (!lowered.size) return list.filter(p => p.kind !== "route");
  return list.filter(p => p.kind !== "route").map(p => lowered.get(p.id) || p);
}
