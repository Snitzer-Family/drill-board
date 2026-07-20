// Render a drill (DSL text) to a standalone SVG string: the rink markings,
// every piece, each route, and the whole puck chain (passes, shots, rims,
// chips) — using the real boards geometry so rim/chip banks are accurate.
// Colours use CSS custom properties (with fallbacks) so a host page can theme
// it; pieces use their own DSL colours.
import { parseDrill } from "./drill-format.js";
import { evalSeg } from "./geometry.js";
import { netShapes, segCrossesNet } from "./net-collide.js";
import * as boards from "./boards.js";

// pull a polyline's end back by `d` ft along its final heading so an arrowhead
// points AT the target instead of landing on top of it
function trimEnd(pts, d) {
  if (!pts || pts.length < 2 || d <= 0) return pts;
  const out = pts.map(p => ({ x: p.x, y: p.y }));
  let rem = d;
  while (out.length >= 2) {
    const b = out[out.length - 1], a = out[out.length - 2];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg > rem) { const g = (seg - rem) / seg; out[out.length - 1] = { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g }; break; }
    rem -= seg; out.pop();
  }
  return out;
}

// de Casteljau: the sub-segment of `s` (starting at prev) covering [0, t]
function subSeg(prev, s, t) {
  const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (s.type === "L") { const e = L(prev, { x: s.x, y: s.y }); return { type: "L", x: e.x, y: e.y }; }
  if (s.type === "Q") {
    const a = L(prev, { x: s.cx, y: s.cy }), b = L({ x: s.cx, y: s.cy }, { x: s.x, y: s.y }), e = L(a, b);
    return { type: "Q", cx: a.x, cy: a.y, x: e.x, y: e.y };
  }
  const c1 = { x: s.c1x, y: s.c1y }, c2 = { x: s.c2x, y: s.c2y }, p1 = { x: s.x, y: s.y };
  const a = L(prev, c1), b = L(c1, c2), c = L(c2, p1), d = L(a, b), e = L(b, c), f = L(d, e);
  return { type: "C", c1x: a.x, c1y: a.y, c2x: d.x, c2y: d.y, x: f.x, y: f.y };
}

// shorten the final route segment so its arrowhead points at the last waypoint
function trimSeg(prev, s, d) {
  const N = 40; let len = 0, last = evalSeg(prev, s, 0); const arc = [{ t: 0, l: 0 }];
  for (let k = 1; k <= N; k++) { const t = k / N, q = evalSeg(prev, s, t); len += Math.hypot(q.x - last.x, q.y - last.y); arc.push({ t, l: len }); last = q; }
  const target = len - d;
  if (target <= 0.5) return s;                       // too short to trim — leave it
  let t = 1;
  for (let k = 1; k < arc.length; k++) if (arc[k].l >= target) { const a = arc[k - 1], b = arc[k]; t = a.t + (b.t - a.t) * (target - a.l) / ((b.l - a.l) || 1); break; }
  return subSeg(prev, s, t);
}

const NET_L = { x: 17, y: 42.5 }, NET_R = { x: 183, y: 42.5 };
const f = n => Math.round(n * 100) / 100;
const V = (name, fb) => `var(--${name},${fb})`;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// a movable/resizable on-ice text label (standalone piece or a "label"-mode
// waypoint description). No stretch here, so it's drawn upright at (x, y).
function labelSvg(x, y, text, size, color) {
  const lines = String(text || " ").split("\n");
  const fs = 6.5 * (size || 1), lh = fs * 1.16;   // ~6.5 ft tall — matches the app
  const w = Math.max(1, ...lines.map(l => l.length)) * fs * 0.56 + fs * 0.7;
  const h = lines.length * lh + fs * 0.34;
  const tspans = lines.map((l, k) =>
    `<tspan x="${f(x)}" y="${f(y + (k - (lines.length - 1) / 2) * lh + fs * 0.34)}">${esc(l || " ")}</tspan>`).join("");
  // a label is a light "sticky note" in BOTH themes — the fill/text are fixed
  // (not themed), so dark ink never lands on a dark panel in dark mode
  return `<g><rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(fs * 0.28)}"`
    + ` fill="#f7fbfd" stroke="rgba(20,32,43,0.4)" stroke-width="0.4"/>`
    + `<text font-size="${f(fs)}" font-weight="800" text-anchor="middle" fill="${color || "#14202b"}"`
    + ` font-family="system-ui,sans-serif" paint-order="stroke" stroke="#f7fbfd" stroke-width="${f(fs * 0.06)}">${tspans}</text></g>`;
}

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
  if (p.kind === "net") {
    const CAGE = "M 0 -3.75 L -1.7 -3.75 Q -4.15 -3.75 -4.15 -1.5 L -4.15 1.5 Q -4.15 3.75 -1.7 3.75 L 0 3.75";
    return `<g transform="${rot()} scale(${p.size || 1})">`
      + `<path d="${CAGE} Z" fill="rgba(230,238,246,0.3)" stroke="none"/>`
      + `<g stroke="#9fb0c0" stroke-width="0.13" opacity="0.85" fill="none"><path d="M -0.4 -2.9 L -3.7 -1.7 M -0.4 -1.45 L -3.95 -0.85 M -0.4 1.45 L -3.95 0.85 M -0.4 2.9 L -3.7 1.7"/><path d="M -1.2 -3.3 L -1.2 3.3 M -2.4 -3.1 L -2.4 3.1 M -3.4 -2 L -3.4 2"/><path d="M -0.2 0 L -4.0 0"/></g>`
      + `<path d="${CAGE}" fill="none" stroke="${p.color}" stroke-width="0.55" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<line x1="0" y1="-4.05" x2="0" y2="4.05" stroke="${p.color}" stroke-width="0.8" stroke-linecap="round"/>`
      + `<circle cx="0" cy="-3.75" r="0.82" fill="${p.color}"/><circle cx="0" cy="3.75" r="0.82" fill="${p.color}"/>`
      + (p.goalie ? `<rect x="-1.6" y="-2.4" width="2.4" height="4.8" rx="1.1" fill="#2f9e57" stroke="#fff" stroke-width="0.3"/>` : "") + `</g>`;
  }
  if (p.kind === "tire") {
    let ticks = "";
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      ticks += `<line x1="${f(c * 1.45)}" y1="${f(s * 1.45)}" x2="${f(c * 2.55)}" y2="${f(s * 2.55)}" stroke="#3a3a3e" stroke-width="0.28" stroke-linecap="round"/>`; }
    return `<g transform="translate(${f(p.x)} ${f(p.y)}) scale(${p.size || 1})">`
      + `<circle cx="0" cy="0" r="2.0" fill="none" stroke="${p.color}" stroke-width="1.55"/>`
      + `<circle cx="0" cy="0" r="2.78" fill="none" stroke="#000" stroke-width="0.2" opacity="0.55"/>`
      + `<circle cx="0" cy="0" r="1.22" fill="none" stroke="#000" stroke-width="0.2" opacity="0.55"/>${ticks}</g>`;
  }
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
  // trim the final segment so the arrow points at the last waypoint, not onto it
  const last = p.path.length - 1;
  const prevOfLast = last === 0 ? { x: p.x, y: p.y } : { x: p.path[last - 1].x, y: p.path[last - 1].y };
  let d = `M ${f(p.x)} ${f(p.y)}`;
  p.path.forEach((s0, i) => {
    const s = i === last ? trimSeg(prevOfLast, s0, 2.7) : s0;
    if (s.type === "L") d += ` L ${f(s.x)} ${f(s.y)}`;
    else if (s.type === "Q") d += ` Q ${f(s.cx)} ${f(s.cy)} ${f(s.x)} ${f(s.y)}`;
    else d += ` C ${f(s.c1x)} ${f(s.c1y)} ${f(s.c2x)} ${f(s.c2y)} ${f(s.x)} ${f(s.y)}`;
  });
  const dots = p.path.map((s, i) =>
    `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="2" fill="${V("panel", "#fff")}" stroke="${p.color}" stroke-width="0.5"/>`
    + `<text x="${f(s.x)}" y="${f(s.y) + 0.9}" font-size="2.6" font-weight="700" text-anchor="middle" fill="${p.color}">${i + 1}</text>`).join("");
  return `<path d="${d}" fill="none" stroke="${p.color}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" marker-end="url(#arrowR)"/>${dots}`;
}

// puck flow lines. mode: "shot" solid dark · "rebound" dotted + distinct colour
// (so it reads apart from the shot it overlaps) · else dashed pass/rim/chip
const REBOUND_COLOR = "#e8892b";
const BLOCKED_COLOR = "#e01f2b";      // a rebound that can't reach its collector (thru a net)
// how far to hold the arrowhead off each kind of target (net vs player vs point)
const CHAIN_TRIM = { shot: 4.6, rebound: 3, "rebound-x": 3, pass: 4 };
const chainLine = (pts, mode) => {
  const rebound = mode === "rebound", blocked = mode === "rebound-x", shot = mode === "shot";
  const dotted = rebound || blocked;
  const color = blocked ? BLOCKED_COLOR : rebound ? REBOUND_COLOR : V("puck", "#14171a");
  const dash = shot ? "" : dotted ? ' stroke-dasharray="0.1 1.9"' : ' stroke-dasharray="2.4 2"';
  const marker = blocked ? "arrowRX" : rebound ? "arrowRB" : "arrowP";
  const line = trimEnd(pts, CHAIN_TRIM[mode] != null ? CHAIN_TRIM[mode] : 3.5);
  return `<polyline points="${polyPts(line)}" fill="none" stroke="${color}" stroke-width="${shot ? 1.1 : blocked ? 1.1 : 0.9}"`
    + `${dash} stroke-linecap="round" stroke-linejoin="round" opacity="0.9" marker-end="url(#${marker})"/>`;
};

function chain(pk, byId, pieces) {
  let cur = pk.carrier ? byId(pk.carrier) : (pk.pickup && byId(pk.pickup.to));
  if (!cur) return "";
  const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
  const netSh = netShapes(pieces);
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
    if (tr.kind === "shot") {
      const net = shotNet(launch);
      // if the carom to the collector would pass through a net, it can't get
      // there — flag that rebound red instead of drawing it as a clean carom
      const rbMode = segCrossesNet(net, anchor, netSh) ? "rebound-x" : "rebound";
      out.push(chainLine([launch, net], "shot"), chainLine([net, anchor], rbMode));
    }
    else if (tr.kind === "rim") out.push(chainLine(rimPoly(launch, tr.aim, anchor), "pass"));
    else if (tr.kind === "chip") { const h = tr.aim != null ? aimVec(tr.aim) : heading(cur, tr.at); out.push(chainLine(boards.slideTo(launch.x, launch.y, h.x, h.y, anchor), "pass")); }
    else out.push(chainLine([launch, anchor], "pass"));   // pass
    cur = rec;
  });
  if (pk.shotAt != null) { const l = routePoint(cur, pk.shotAt); out.push(chainLine([l, shotNet(l)], "shot")); }
  else if (pk.rimAt != null) { const l = routePoint(cur, pk.rimAt); out.push(chainLine(boards.rimAround(l, pk.rimDist != null ? pk.rimDist : 65, pk.rimAim), "pass")); }
  else if (pk.chipAt != null) { const l = routePoint(cur, pk.chipAt); const h = pk.chipAim != null ? aimVec(pk.chipAim) : heading(cur, pk.chipAt); out.push(chainLine(boards.slide(l.x, l.y, h.x, h.y, pk.chipDist != null ? pk.chipDist : 26), "pass")); }
  return out.join("");
}

/* ------------------------------------------------------------------ */
// rink view boxes (rink feet): the DSL RINK mode crops the diagram to half /
// quarter ice, matching the editor's views
const VIEWS = { full: [0, 0, 200, 85], half: [100, 0, 100, 85], quarter: [100, 0, 100, 42.5] };

export function drillSvg(dsl, opts = {}) {
  const { pieces, rink: rinkMode } = parseDrill(dsl);
  const byId = id => pieces.find(p => p.id === id);
  const rank = k => (k === "net" || k === "bumper" || k === "deker" || k === "passer" || k === "tire" ? 0 : k === "player" ? 2 : 1);
  const defs = `<defs>
      <clipPath id="ice"><rect x="0.6" y="0.6" width="198.8" height="83.8" rx="26"/></clipPath>
      <marker id="arrowR" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${V("mark", "#cf3346")}"/></marker>
      <marker id="arrowP" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${V("puck", "#14171a")}"/></marker>
      <marker id="arrowRB" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${REBOUND_COLOR}"/></marker>
      <marker id="arrowRX" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto"><path d="M0.4 0.6 L5 3 L0.4 5.4 Z" fill="${BLOCKED_COLOR}"/></marker>
    </defs>`;
  const routes = pieces.map(routePath).join("");
  const chains = pieces.filter(p => p.kind === "puck").map(pk => chain(pk, byId, pieces)).join("");
  // a carried puck draws close to its player, not at its loose stored spot
  const drawPos = p => {
    if (p.kind !== "puck" || !p.carrier) return p;
    const c = byId(p.carrier); if (!c) return p;
    const dx = p.x - c.x, dy = p.y - c.y, dd = Math.hypot(dx, dy) || 1, off = 4.2;
    return { ...p, x: c.x + dx / dd * off, y: c.y + dy / dd * off };
  };
  const icons = [...pieces].sort((a, b) => rank(a.kind) - rank(b.kind)).map(p => piece(drawPos(p))).join("");
  // text labels paint on top: standalone label pieces + "label"-mode waypoints
  const labels = pieces.filter(p => p.kind === "label").map(p => labelSvg(p.x, p.y, p.text, p.size, p.color)).join("")
    + pieces.flatMap(p => (p.path || []).filter(s => s.dmode === "label" && s.desc)
        .map(s => labelSvg(s.x + (s.dox || 0), s.y + (s.doy != null ? s.doy : -5), s.desc, s.dsize, "#14202b"))).join("");
  const wattr = opts.width ? ` width="${opts.width}"` : "";
  // crop to the drill's rink mode (full / half / quarter) with a 7 ft margin
  const [vx, vy, vw, vh] = VIEWS[rinkMode] || VIEWS.full, PAD = 7;
  const viewBox = `${vx - PAD} ${vy - PAD} ${vw + 2 * PAD} ${vh + 2 * PAD}`;
  // icons paint over the chain lines; arrowheads are trimmed back so they point
  // at their target instead of vanishing under a circle. Labels stay on top.
  return `<svg class="rink" viewBox="${viewBox}"${wattr} xmlns="http://www.w3.org/2000/svg" role="img">${defs}${rink()}${routes}${chains}${icons}${labels}</svg>`;
}
