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

import { segTangentAngle, clampX, clampY, rdp } from "./geometry.js";
import { netShapes, bumperShapes, detourRoute } from "./net-collide.js";
import { QUEUE_GAP, QUEUE_LEAD, ICON_SCALE, PLAYER_R, TRANSIT_RATE, HOPS_MAX, LINE_LEG_CAP } from "./constants.js";

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

// The static things a skater crossing the ice has to go around. Deliberately a
// SUBSET of the animator's per-player detour set: no goalie fusion and no
// jump-over exclusion, because both of those read displayPos, which needs the
// lowered pieces this pass is producing — and because a transit baked off the
// animation clock would change shape as the drill played. The display detour
// still runs over these legs afterward and handles the rest.
export function transitObstacles(pieces) {
  const out = [];
  for (const sh of netShapes(pieces)) out.push({ cx: sh.cx, cy: sh.cy, r: sh.r });
  for (const sh of bumperShapes(pieces)) out.push({ cx: sh.cx, cy: sh.cy, r: sh.r });
  for (const q of pieces || []) {
    if (q.kind === "passer" || q.kind === "deker") out.push({ cx: q.x, cy: q.y, r: 2.6 });
    else if (q.kind === "tire") out.push({ cx: q.x, cy: q.y, r: 2.6 * ICON_SCALE * (q.size || 1) + 0.6 });
    else if (q.kind === "player" && !isMobile(q) && !q.defense) out.push({ cx: q.x, cy: q.y, r: PLAYER_R });
  }
  return out;
}

// Skating from one route's end to the next route's head, as REAL legs.
//
// It has to be real legs, not the display detour: timing measures the authored
// segments (segLen reads the refs the raw path renders), while the detour only
// remaps animation progress onto a bent polyline. A transit that existed only as
// an overlay would be drawn but not timed — and over a cross-ice regroup that
// error is the length of the rink. It would also vanish whenever the coach
// switched avoidance off.
//
// Sample → arc around the obstacles → simplify back to a handful of points.
// Without the simplify a 100-point detour becomes 100 legs, each needing its own
// SVG ref and timing entry.
export function transitLegs(from, to, obstacles, rate = TRANSIT_RATE) {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span < 1) return [];
  const n = Math.max(2, Math.min(80, Math.round(span / 2)));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
  const det = detourRoute(pts, obstacles || []);
  // 1.5 ft of slack: tight enough to keep the arc, loose enough to stay a few legs
  const simple = (det === pts ? [pts[0], pts[pts.length - 1]] : rdp(det, 1.5)).slice(1);
  return simple.map(q => ({
    type: "L", x: clampX(q.x), y: clampY(q.y),
    mode: "carry", dir: "fwd", stop: 0, rate, transit: true,
  }));
}

// The drawn link between two routes: the same points the skater will bake into
// their path, as a polyline the board can render faintly. Shared so the line a
// coach sees and the legs the engine times can never be different geometry.
export function transitPoly(routeA, routeB, obstacles) {
  const legs = (routeA.path || []).length;
  if (!legs || !routeB) return null;
  const end = routeA.path[legs - 1];
  const pts = transitLegs({ x: end.x, y: end.y }, { x: routeB.x, y: routeB.y }, obstacles);
  return pts.length ? [{ x: end.x, y: end.y }, ...pts.map(s => ({ x: s.x, y: s.y }))] : null;
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
  // computed once for the whole pass, not per skater — it depends only on the
  // static furniture, which nothing in here moves
  const obstacles = transitObstacles(list);

  // Follow a route's `next` chain, skating across the ice between them, and
  // return the whole recirculation as ONE leg array. That is the payoff of the
  // "a lowered skater is an ordinary player" rule: a lap is just more legs, and
  // the timing engine needs to know nothing about recycling.
  //
  // Bounded three independent ways, none of them a fixpoint: `hops` is a counter
  // that strictly decreases each unfold, it is clamped to HOPS_MAX on entry, and
  // the leg count is capped. So this is primitive recursion with a decreasing
  // measure — it terminates even when next= points in a cycle (A -> B -> A),
  // which is exactly how a real full-ice drill is drawn.
  const unfold = R => {
    const legs = (R.path || []).map(s => ({ ...s }));
    let cur = R;
    let hops = Math.max(0, Math.min(HOPS_MAX, R.hops == null ? 1 : R.hops));
    while (hops > 0) {
      const nxt = routes.get(cur.next);
      if (!nxt || !legs.length || legs.length >= LINE_LEG_CAP) break;
      // Branching and recycling don't compose yet: a fork's `at` is an index into
      // the route it belongs to, and past the first lap those indices no longer
      // mean what they say. Stop at the last fork-free route rather than splice a
      // branch onto the wrong waypoint.
      if ((cur.forks || []).length || (nxt.forks || []).length) break;
      hops--;
      const end = legs[legs.length - 1];
      const rate = cur.regroup > 0 ? cur.regroup : TRANSIT_RATE;
      legs.push(...transitLegs({ x: end.x, y: end.y }, { x: nxt.x, y: nxt.y }, obstacles, rate));
      legs.push(...(nxt.path || []).map(s => ({ ...s })));
      cur = nxt;
    }
    return legs.slice(0, LINE_LEG_CAP);
  };

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
        // this route's legs verbatim — see the header on why nothing is prepended
        // — then, if it recycles, the transit and the next route's legs after them
        path: unfold(R),
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
