// Render a drill (DSL text) to a standalone SVG string: the rink markings,
// every piece, each route, and the whole puck chain (passes, shots, rims,
// chips) — using the real boards geometry so rim/chip banks are accurate.
// Colours use CSS custom properties (with fallbacks) so a host page can theme
// it; pieces use their own DSL colours.
import { parseDrill } from "./drill-format.js";
import * as boards from "./boards.js";

const NET_L = { x: 17, y: 42.5 }, NET_R = { x: 183, y: 42.5 };
const f = n => Math.round(n * 100) / 100;
const V = (name, fb) => `var(--${name},${fb})`;

const routePoint = (p, idx) => {
  if (!p.path.length || idx < 0) return { x: p.x, y: p.y };
  const s = p.path[Math.min(idx, p.path.length - 1)];
  return { x: s.x, y: s.y };
};
// outgoing heading at a route index (matches how a chip reads the facing)
function heading(p, idx) {
  const here = routePoint(p, idx);
  const nxt = p.path[idx + 1] ? routePoint(p, idx + 1) : null;
  const a = nxt || here, b = nxt ? here : (idx - 1 < 0 ? { x: p.x, y: p.y } : routePoint(p, idx - 1));
  const dx = a.x - b.x, dy = a.y - b.y, m = Math.hypot(dx, dy) || 1;
  return { x: dx / m, y: dy / m };
}
const aimVec = deg => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
const polyPts = pts => pts.map(p => `${f(p.x)},${f(p.y)}`).join(" ");

/* ------------------------------------------------------------------ */
/* rink markings (clipped to the rounded boards)                       */
function rink() {
  const mk = V("mark", "#cf3346"), mkb = V("mark-blue", "#2f5fb0");
  const dot = (x, y, r = 1, c = mk) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const fo = (x, y, c) => `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${c}" stroke-width="0.45" opacity="0.9"/>`;
  return `
    <rect x="0.6" y="0.6" width="198.8" height="83.8" rx="26" fill="${V("surface", "#f6fafd")}" stroke="${V("ink", "#14202b")}" stroke-width="1.1"/>
    <g clip-path="url(#ice)">
      <g stroke-linecap="round">
        <line x1="17" y1="0" x2="17" y2="85" stroke="${mk}" stroke-width="0.45"/>
        <line x1="183" y1="0" x2="183" y2="85" stroke="${mk}" stroke-width="0.45"/>
        <line x1="75" y1="0" x2="75" y2="85" stroke="${mkb}" stroke-width="1.1"/>
        <line x1="125" y1="0" x2="125" y2="85" stroke="${mkb}" stroke-width="1.1"/>
        <line x1="100" y1="0" x2="100" y2="85" stroke="${mk}" stroke-width="1.1"/>
        <path d="M 17 36.5 A 6 6 0 0 1 17 48.5" fill="#d3e9f7" stroke="${mk}" stroke-width="0.35" opacity="0.85"/>
        <path d="M 183 36.5 A 6 6 0 0 0 183 48.5" fill="#d3e9f7" stroke="${mk}" stroke-width="0.35" opacity="0.85"/>
      </g>
      ${fo(100, 42.5, mkb)}${fo(45, 20.5, mk)}${fo(45, 64.5, mk)}${fo(155, 20.5, mk)}${fo(155, 64.5, mk)}
      ${dot(100, 42.5, 0.9, mkb)}${dot(45, 20.5)}${dot(45, 64.5)}${dot(155, 20.5)}${dot(155, 64.5)}
      ${dot(80, 20.5)}${dot(80, 64.5)}${dot(120, 20.5)}${dot(120, 64.5)}
      <g fill="none" stroke="#c81e33" stroke-width="0.55" stroke-linejoin="round" opacity="0.9">
        <path d="M 17 39 L 12.6 39.7 L 12.6 45.3 L 17 46"/>
        <path d="M 183 39 L 187.4 39.7 L 187.4 45.3 L 183 46"/>
      </g>
    </g>`;
}

/* ------------------------------------------------------------------ */
/* piece icons                                                         */
function piece(p) {
  const rot = (a = p.facing || 0) => `translate(${f(p.x)} ${f(p.y)}) rotate(${f(a)})`;
  if (p.kind === "player")
    return `<g><circle cx="${f(p.x)}" cy="${f(p.y)}" r="3.4" fill="${p.color}" stroke="#fff" stroke-width="0.5"/>`
      + `<text x="${f(p.x)}" y="${f(p.y) + 1.05}" font-weight="800" font-size="3" text-anchor="middle" fill="#fff">${p.label || ""}</text></g>`;
  if (p.kind === "puck")
    return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="1.5" fill="${V("puck", "#14171a")}" stroke="${V("surface", "#fff")}" stroke-width="0.4"/>`;
  if (p.kind === "cone")
    return `<path transform="${rot()}" d="M 0 -2.4 L 2.2 1.8 L -2.2 1.8 Z" fill="${p.color}" stroke="#fff" stroke-width="0.35" stroke-linejoin="round"/>`;
  if (p.kind === "net")
    return `<g transform="${rot()}"><path d="M 0 -3.75 L -4.6 -3 L -4.6 3 L 0 3.75 Z" fill="rgba(210,225,240,0.16)" stroke="${p.color}" stroke-width="0.5" stroke-linejoin="round"/>`
      + `<circle cx="0" cy="-3.75" r="0.7" fill="${p.color}"/><circle cx="0" cy="3.75" r="0.7" fill="${p.color}"/>`
      + (p.goalie ? `<rect x="-1.6" y="-2.4" width="2.4" height="4.8" rx="1.1" fill="#2f9e57" stroke="#fff" stroke-width="0.3"/>` : "") + `</g>`;
  if (p.kind === "bumper")
    return `<g transform="${rot()}"><rect x="-7" y="-0.95" width="14" height="1.9" rx="0.95" fill="${p.color}" stroke="#fff" stroke-width="0.3"/>`
      + `<path d="M -3.5 -0.75 L -3.5 0.75 M 0 -0.75 L 0 0.75 M 3.5 -0.75 L 3.5 0.75" stroke="#fff" stroke-width="0.18" opacity="0.4"/></g>`;
  if (p.kind === "deker")
    return `<g transform="${rot()}"><line x1="-2.6" y1="0" x2="2.6" y2="0" stroke="#1d2126" stroke-width="0.22" opacity="0.32" stroke-dasharray="0.6 0.5"/>`
      + `<circle cx="0" cy="-1.6" r="0.55" fill="#e0731d" stroke="#fff" stroke-width="0.2"/><circle cx="0" cy="1.6" r="0.55" fill="#e0731d" stroke="#fff" stroke-width="0.2"/>`
      + `<rect x="-0.32" y="-2.6" width="0.64" height="5.2" rx="0.32" fill="${p.color}" stroke="#5a4420" stroke-width="0.2"/></g>`;
  if (p.kind === "passer")
    return `<g transform="${rot()}"><rect x="-1.6" y="-2.6" width="3.2" height="5.2" rx="0.5" fill="rgba(210,225,240,0.14)" stroke="${p.color}" stroke-width="0.5"/>`
      + `<rect x="0.85" y="-2.6" width="0.75" height="5.2" rx="0.3" fill="${p.color}"/></g>`;
  return "";
}

/* ------------------------------------------------------------------ */
/* routes + chain                                                      */
function routePath(p) {
  if (!p.path.length) return "";
  let d = `M ${f(p.x)} ${f(p.y)}`;
  p.path.forEach(s => {
    if (s.type === "L") d += ` L ${f(s.x)} ${f(s.y)}`;
    else if (s.type === "Q") d += ` Q ${f(s.cx)} ${f(s.cy)} ${f(s.x)} ${f(s.y)}`;
    else d += ` C ${f(s.c1x)} ${f(s.c1y)} ${f(s.c2x)} ${f(s.c2y)} ${f(s.x)} ${f(s.y)}`;
  });
  const dots = p.path.map((s, i) =>
    `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="2" fill="${V("panel", "#fff")}" stroke="${p.color}" stroke-width="0.5"/>`
    + `<text x="${f(s.x)}" y="${f(s.y) + 0.9}" font-size="2.6" font-weight="700" text-anchor="middle" fill="${p.color}">${i + 1}</text>`).join("");
  return `<path d="${d}" fill="none" stroke="${p.color}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" marker-end="url(#arrowR)"/>${dots}`;
}

const chainLine = (pts, solid) =>
  `<polyline points="${polyPts(pts)}" fill="none" stroke="${V("puck", "#14171a")}" stroke-width="${solid ? 1.1 : 0.9}"`
  + `${solid ? "" : ' stroke-dasharray="2.4 2"'} stroke-linecap="round" stroke-linejoin="round" opacity="0.85" marker-end="url(#arrowP)"/>`;

function chain(pk, byId, pieces) {
  let cur = pk.carrier ? byId(pk.carrier) : (pk.pickup && byId(pk.pickup.to));
  if (!cur) return "";
  const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
  const shotNet = launch => {
    if (pk.net) { const n = nets.find(x => x.id === pk.net); if (n) return { x: n.x, y: n.y }; }
    if (nets.length) return nets.reduce((a, b) => (Math.hypot(b.x - launch.x, b.y - launch.y) < Math.hypot(a.x - launch.x, a.y - launch.y) ? b : a));
    return launch.x < 100 ? NET_L : NET_R;
  };
  const out = [];
  const rimPoly = (launch, aim, anchor) => (aim != null ? boards.rimTo(launch, aim, anchor) : boards.rimPath(launch, anchor));
  (pk.transfers || []).forEach(tr => {
    const rec = byId(tr.to); if (!rec) return;
    const launch = routePoint(cur, tr.at);
    const anchor = routePoint(rec, tr.recvAt == null ? rec.path.length - 1 : tr.recvAt);
    if (tr.kind === "shot") out.push(chainLine([launch, shotNet(launch)], true), chainLine([shotNet(launch), anchor], false));
    else if (tr.kind === "rim") out.push(chainLine(rimPoly(launch, tr.aim, anchor), false));
    else if (tr.kind === "chip") { const h = tr.aim != null ? aimVec(tr.aim) : heading(cur, tr.at); out.push(chainLine(boards.slideTo(launch.x, launch.y, h.x, h.y, anchor), false)); }
    else out.push(chainLine([launch, anchor], false));   // pass
    cur = rec;
  });
  if (pk.shotAt != null) { const l = routePoint(cur, pk.shotAt); out.push(chainLine([l, shotNet(l)], true)); }
  else if (pk.rimAt != null) { const l = routePoint(cur, pk.rimAt); out.push(chainLine(boards.rimAround(l, 65, pk.rimAim), false)); }
  else if (pk.chipAt != null) { const l = routePoint(cur, pk.chipAt); const h = pk.chipAim != null ? aimVec(pk.chipAim) : heading(cur, pk.chipAt); out.push(chainLine(boards.slide(l.x, l.y, h.x, h.y, 16), false)); }
  return out.join("");
}

/* ------------------------------------------------------------------ */
export function drillSvg(dsl, opts = {}) {
  const { pieces } = parseDrill(dsl);
  const byId = id => pieces.find(p => p.id === id);
  const rank = k => (k === "net" || k === "bumper" || k === "deker" || k === "passer" ? 0 : k === "player" ? 2 : 1);
  const defs = `<defs>
      <clipPath id="ice"><rect x="0.6" y="0.6" width="198.8" height="83.8" rx="26"/></clipPath>
      <marker id="arrowR" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${V("mark", "#cf3346")}"/></marker>
      <marker id="arrowP" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${V("puck", "#14171a")}"/></marker>
    </defs>`;
  const routes = pieces.map(routePath).join("");
  const chains = pieces.filter(p => p.kind === "puck").map(pk => chain(pk, byId, pieces)).join("");
  const icons = [...pieces].sort((a, b) => rank(a.kind) - rank(b.kind)).map(piece).join("");
  const wattr = opts.width ? ` width="${opts.width}"` : "";
  return `<svg class="rink" viewBox="-7 -7 214 99"${wattr} xmlns="http://www.w3.org/2000/svg" role="img">${defs}${rink()}${routes}${chains}${icons}</svg>`;
}
