import { useState, useRef, useEffect } from "react";

/* ============================================================
   HOCKEY DRILL ANIMATOR — v5 (full-screen ice)
   Coordinates: real feet. x 0..200 (goal line to goal line),
   y 0..85 (board to board).

   Text format (one command per line, # = comment):
     RINK full|half|quarter
     PIECE <id> <player|puck|cone> <x> <y> [#color] [label] [speed=1.2] [hand=L] [on=F1]
     PATH  <id> <segments...>
   Segments (rink feet):
     L x,y | Q cx,cy x,y | C c1x,c1y c2x,c2y x,y
   Modifier words BEFORE a segment apply to that segment only:
     PASS / SHOT / CARRY   puck speed class (3x / 6x / 1x)
     BWD / FWD             skating direction (BWD draws zigzag)
     STOP <sec>            hold at this leg's START point
     RATE <mult>           speed multiplier for this leg
   hand=L mirrors the player's stick. on=F1 puts a puck on that
   player's blade; it releases when the carrier reaches the
   puck's placed spot, then runs its own route.
   pass=<pt>:<player>[@<pt>] hands the puck off: it launches at
   the carrier's route point and flies to the named player. With
   @pt the receiver's pace auto-syncs to arrive at their point
   exactly as the puck does; without it the puck leads them.
   shoot=<pt> fires the puck at the nearest net when the final
   carrier reaches that route point.

   UI: the rink fills the screen. Corner controls: ☰ settings
   (text/export/load/pace), rink size, tools (+pieces / draw),
   play/reset. Tap pieces/points/lines for on-ice popouts;
   drag to move; touch drags show a magnifier loupe.
   ============================================================ */

const RINK = { W: 200, H: 85 };
const VIEWS = { full: [0, 0, 200, 85], half: [100, 0, 100, 85], quarter: [100, 0, 100, 42.5] };
const COLORS = ["#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#22262b", "#7a3fa8"];
const SPEED = { carry: 1, pass: 3, shot: 6 };
const vb = m => VIEWS[m].join(" ");

const DEFAULT_TEXT = `RINK full
`;

/* ---------------- text format ---------------- */

function parseDrill(text) {
  const pieces = [];
  const byId = {};
  let rink = "full";
  const errors = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#(?!([0-9a-fA-F]{3}){1,2}\b).*$/, "").trim();
    if (!line) return;
    const tok = line.split(/[\s,]+/);
    const cmd = tok[0].toUpperCase();
    try {
      if (cmd === "RINK") {
        const m = (tok[1] || "").toLowerCase();
        if (!VIEWS[m]) throw new Error(`unknown rink "${tok[1]}"`);
        rink = m;
      } else if (cmd === "PIECE") {
        const [, id, kind, xs, ys, ...rest] = tok;
        const x = parseFloat(xs), y = parseFloat(ys);
        if (!id || !["player", "puck", "cone"].includes(kind) || isNaN(x) || isNaN(y))
          throw new Error("PIECE needs: id kind x y");
        let color = kind === "cone" ? "#e0731d" : kind === "puck" ? "#14171a" : "#d7263d";
        let label = kind === "player" ? id : "";
        let speed = 1, hand = "R", carrier = null, facing = 0, shotAt = null;
        const transfers = [];
        rest.forEach(r => {
          if (r.startsWith("#")) color = r;
          else if (r.includes("=")) {
            const [k, v] = r.split("=");
            const key = k.toLowerCase();
            if (key === "speed") {
              const n = parseFloat(v);
              if (!isNaN(n) && n > 0) speed = n;
            } else if (key === "hand") hand = v.toUpperCase() === "L" ? "L" : "R";
            else if (key === "on") carrier = v;
            else if (key === "pass") {
              const m2 = /^(\d+):([^@\s]+)(?:@(\d+))?$/.exec(v);
              if (m2) transfers.push({ at: parseInt(m2[1], 10) - 1, to: m2[2],
                recvAt: m2[3] ? parseInt(m2[3], 10) - 1 : null });
            } else if (key === "shoot") {
              const n = parseInt(v, 10);
              if (!isNaN(n)) shotAt = n - 1;
            } else if (key === "face") {
              const n = parseFloat(v);
              if (!isNaN(n)) facing = n;
            }
          } else label = r;
        });
        const p = { id, kind, x, y, color, label, speed, hand, carrier, facing, transfers, shotAt, path: [] };
        pieces.push(p); byId[id] = p;
      } else if (cmd === "PATH") {
        const id = tok[1];
        const p = byId[id];
        if (!p) throw new Error(`PATH for unknown piece "${id}"`);
        let j = 2, mode = "carry", dir = "fwd", stop = 0, rate = 1;
        const num = () => { const v = parseFloat(tok[j++]); if (isNaN(v)) throw new Error("bad number in PATH"); return v; };
        const push = seg => {
          p.path.push({ ...seg, mode, dir, stop, rate });
          mode = "carry"; dir = "fwd"; stop = 0; rate = 1;
        };
        while (j < tok.length) {
          const t = tok[j++].toUpperCase();
          if (t === "CARRY" || t === "PASS" || t === "SHOT") { mode = t.toLowerCase(); continue; }
          if (t === "FWD" || t === "BWD") { dir = t.toLowerCase(); continue; }
          if (t === "STOP") { stop = num(); continue; }
          if (t === "RATE") { rate = Math.max(0.1, num()); continue; }
          if (t === "L") push({ type: "L", x: num(), y: num() });
          else if (t === "Q") push({ type: "Q", cx: num(), cy: num(), x: num(), y: num() });
          else if (t === "C") push({ type: "C", c1x: num(), c1y: num(), c2x: num(), c2y: num(), x: num(), y: num() });
          else throw new Error(`unknown token "${t}" (use L Q C, PASS SHOT CARRY, FWD BWD, STOP n, RATE n)`);
        }
      } else throw new Error(`unknown command "${tok[0]}"`);
    } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  return { rink, pieces, errors };
}

const f1 = n => (Math.round(n * 10) / 10).toString();
const f2 = n => (Math.round(n * 100) / 100).toString();

function segToStr(s) {
  let pre = "";
  if (s.stop > 0) pre += `STOP ${f1(s.stop)} `;
  if (s.rate && s.rate !== 1) pre += `RATE ${f2(s.rate)} `;
  if (s.dir === "bwd") pre += "BWD ";
  if (s.mode && s.mode !== "carry") pre += s.mode.toUpperCase() + " ";
  if (s.type === "L") return `${pre}L ${f1(s.x)},${f1(s.y)}`;
  if (s.type === "Q") return `${pre}Q ${f1(s.cx)},${f1(s.cy)} ${f1(s.x)},${f1(s.y)}`;
  return `${pre}C ${f1(s.c1x)},${f1(s.c1y)} ${f1(s.c2x)},${f1(s.c2y)} ${f1(s.x)},${f1(s.y)}`;
}

function serializeDrill(rink, pieces) {
  const out = [`RINK ${rink}`, ""];
  pieces.forEach(p => {
    const lbl = p.kind === "player" && p.label ? " " + p.label : "";
    const spd = p.speed && p.speed !== 1 ? ` speed=${f2(p.speed)}` : "";
    const hnd = p.kind === "player" && p.hand === "L" ? " hand=L" : "";
    const car = p.kind === "puck" && p.carrier ? ` on=${p.carrier}` : "";
    const pas = p.kind === "puck" && p.carrier && p.transfers && p.transfers.length
      ? p.transfers.map(t => ` pass=${t.at + 1}:${t.to}${t.recvAt != null ? "@" + (t.recvAt + 1) : ""}`).join("")
      : "";
    const sht = p.kind === "puck" && p.carrier && p.shotAt != null ? ` shoot=${p.shotAt + 1}` : "";
    const fac = p.kind === "player" && !p.path.length && p.facing ? ` face=${f1(p.facing)}` : "";
    out.push(`PIECE ${p.id} ${p.kind} ${f1(p.x)} ${f1(p.y)} ${p.color}${lbl}${hnd}${car}${pas}${sht}${fac}${spd}`);
    if (p.path.length) out.push(`PATH ${p.id} ${p.path.map(segToStr).join(" ")}`);
  });
  return out.join("\n") + "\n";
}

/* ---------------- geometry ---------------- */

const clampX = v => Math.max(0, Math.min(RINK.W, v));
const clampY = v => Math.max(0, Math.min(RINK.H, v));
const segEnd = (p, i) => (i < 0 ? { x: p.x, y: p.y } : { x: p.path[i].x, y: p.path[i].y });

function segD(prev, s) {
  if (s.type === "L") return `M ${prev.x} ${prev.y} L ${s.x} ${s.y}`;
  if (s.type === "Q") return `M ${prev.x} ${prev.y} Q ${s.cx} ${s.cy} ${s.x} ${s.y}`;
  return `M ${prev.x} ${prev.y} C ${s.c1x} ${s.c1y} ${s.c2x} ${s.c2y} ${s.x} ${s.y}`;
}

function evalSeg(prev, s, t) {
  const u = 1 - t;
  if (s.type === "L") return { x: prev.x + t * (s.x - prev.x), y: prev.y + t * (s.y - prev.y) };
  if (s.type === "Q") return {
    x: u * u * prev.x + 2 * u * t * s.cx + t * t * s.x,
    y: u * u * prev.y + 2 * u * t * s.cy + t * t * s.y,
  };
  return {
    x: u * u * u * prev.x + 3 * u * u * t * s.c1x + 3 * u * t * t * s.c2x + t * t * t * s.x,
    y: u * u * u * prev.y + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y,
  };
}

function segTangentAngle(prev, s, t) {
  const a = evalSeg(prev, s, Math.max(0, t - 0.02));
  const b = evalSeg(prev, s, Math.min(1, t + 0.02));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI || 0;
}

function nearestT(prev, s, pt) {
  let best = 0.5, bd = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const q = evalSeg(prev, s, t);
    const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return Math.min(0.92, Math.max(0.08, best));
}

// de Casteljau subdivision: split one segment into two at t without
// changing the curve's shape
function splitSeg(prev, s, t) {
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const meta = { mode: s.mode || "carry", dir: s.dir || "fwd", rate: s.rate || 1 };
  if (s.type === "L") {
    const B = evalSeg(prev, s, t);
    return [
      { type: "L", ...meta, stop: s.stop || 0, x: B.x, y: B.y },
      { type: "L", ...meta, stop: 0, x: s.x, y: s.y },
    ];
  }
  if (s.type === "Q") {
    const C = { x: s.cx, y: s.cy }, P1 = { x: s.x, y: s.y };
    const q0 = lerp(prev, C), q1 = lerp(C, P1), B = lerp(q0, q1);
    return [
      { type: "Q", ...meta, stop: s.stop || 0, cx: q0.x, cy: q0.y, x: B.x, y: B.y },
      { type: "Q", ...meta, stop: 0, cx: q1.x, cy: q1.y, x: s.x, y: s.y },
    ];
  }
  const c1 = { x: s.c1x, y: s.c1y }, c2 = { x: s.c2x, y: s.c2y }, P1 = { x: s.x, y: s.y };
  const p01 = lerp(prev, c1), p12 = lerp(c1, c2), p23 = lerp(c2, P1);
  const p012 = lerp(p01, p12), p123 = lerp(p12, p23), B = lerp(p012, p123);
  return [
    { type: "C", ...meta, stop: s.stop || 0, c1x: p01.x, c1y: p01.y, c2x: p012.x, c2y: p012.y, x: B.x, y: B.y },
    { type: "C", ...meta, stop: 0, c1x: p123.x, c1y: p123.y, c2x: p23.x, c2y: p23.y, x: s.x, y: s.y },
  ];
}

function zigzagPoints(prev, s) {
  const approx =
    s.type === "L" ? Math.hypot(s.x - prev.x, s.y - prev.y)
    : s.type === "Q" ? Math.hypot(s.cx - prev.x, s.cy - prev.y) + Math.hypot(s.x - s.cx, s.y - s.cy)
    : Math.hypot(s.c1x - prev.x, s.c1y - prev.y) + Math.hypot(s.c2x - s.c1x, s.c2y - s.c1y) + Math.hypot(s.x - s.c2x, s.y - s.c2y);
  const n = Math.max(6, Math.round(approx / 2.4));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const pt = evalSeg(prev, s, t);
    if (i === 0 || i === n) { pts.push(pt); continue; }
    const ahead = evalSeg(prev, s, Math.min(1, t + 0.01));
    let nx = -(ahead.y - pt.y), ny = ahead.x - pt.x;
    const l = Math.hypot(nx, ny) || 1;
    const a = i % 2 ? 0.9 : -0.9;
    pts.push({ x: pt.x + (nx / l) * a, y: pt.y + (ny / l) * a });
  }
  return pts.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ");
}

function convertSeg(seg, prev) {
  const { x, y, mode = "carry", dir = "fwd", stop = 0, rate = 1 } = seg;
  const nx = -(y - prev.y), ny = x - prev.x;
  const len = Math.hypot(nx, ny) || 1;
  const off = 12;
  if (seg.type === "L") return { type: "L", mode, dir, stop, rate, x, y };
  if (seg.type === "Q")
    return {
      type: "Q", mode, dir, stop, rate,
      cx: clampX((prev.x + x) / 2 + (nx / len) * off),
      cy: clampY((prev.y + y) / 2 + (ny / len) * off), x, y,
    };
  return {
    type: "C", mode, dir, stop, rate,
    c1x: clampX(prev.x + (x - prev.x) / 3 + (nx / len) * off),
    c1y: clampY(prev.y + (y - prev.y) / 3 + (ny / len) * off),
    c2x: clampX(prev.x + (2 * (x - prev.x)) / 3 - (nx / len) * off),
    c2y: clampY(prev.y + (2 * (y - prev.y)) / 3 - (ny / len) * off),
    x, y,
  };
}

/* ---- finger drawing ---- */

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

function catmullToBezier(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    segs.push({
      type: "C", mode: "carry", dir: "fwd", stop: 0, rate: 1,
      c1x: clampX(p1.x + (p2.x - p0.x) / 6), c1y: clampY(p1.y + (p2.y - p0.y) / 6),
      c2x: clampX(p2.x - (p3.x - p1.x) / 6), c2y: clampY(p2.y - (p3.y - p1.y) / 6),
      x: p2.x, y: p2.y,
    });
  }
  return segs;
}

function fitRoute(start, raw) {
  const pts = [start];
  raw.forEach(q => {
    const last = pts[pts.length - 1];
    if (Math.hypot(q.x - last.x, q.y - last.y) > 2.2) pts.push(q);
  });
  if (pts.length < 2) return [];
  const simp = pts.length > 3 ? [pts[0], ...rdp(pts.slice(1), 1.6)] : pts;
  const chain = simp.filter((q, i) => i === 0 || Math.hypot(q.x - simp[i - 1].x, q.y - simp[i - 1].y) > 1.5);
  if (chain.length < 2) return [];
  if (chain.length === 2)
    return [{ type: "L", mode: "carry", dir: "fwd", stop: 0, rate: 1, x: chain[1].x, y: chain[1].y }];
  return catmullToBezier(chain);
}

/* ---------------- rink markings ---------------- */

function RinkMarkings() {
  const dots = [];
  [[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]].forEach(([x, y]) =>
    dots.push(
      <g key={`fo${x}-${y}`}>
        <circle cx={x} cy={y} r={15} fill="none" stroke="#d7263d" strokeWidth={0.4} opacity={0.8} />
        <circle cx={x} cy={y} r={1} fill="#d7263d" />
      </g>
    ));
  [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]].forEach(([x, y]) =>
    dots.push(<circle key={`nz${x}-${y}`} cx={x} cy={y} r={1} fill="#d7263d" />));
  return (
    <g clipPath="url(#boards)">
      <rect x={0} y={0} width={200} height={85} fill="#f5fafd" />
      <path d="M 11 36.5 A 6 6 0 0 1 11 48.5 Z" fill="#d3e9f7" stroke="#d7263d" strokeWidth={0.3} />
      <path d="M 189 36.5 A 6 6 0 0 0 189 48.5 Z" fill="#d3e9f7" stroke="#d7263d" strokeWidth={0.3} />
      <line x1={11} y1={0} x2={11} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={189} y1={0} x2={189} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={75} y1={0} x2={75} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={125} y1={0} x2={125} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#d7263d" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#fff" strokeWidth={0.25} strokeDasharray="1.6 1.6" />
      <circle cx={100} cy={42.5} r={15} fill="none" stroke="#1f4fa3" strokeWidth={0.4} />
      <circle cx={100} cy={42.5} r={0.9} fill="#1f4fa3" />
      {dots}
      <rect x={7} y={39.5} width={4} height={6} fill="none" stroke="#d7263d" strokeWidth={0.35} />
      <rect x={189} y={39.5} width={4} height={6} fill="none" stroke="#d7263d" strokeWidth={0.35} />
      <rect x={0.5} y={0.5} width={199} height={84} rx={27.5} fill="none" stroke="#31404e" strokeWidth={1} />
    </g>
  );
}

/* ---------------- piece icon ---------------- */

function PieceIcon({ p, pos, onDown, selected, dim, screenRot = 0, onStickDown }) {
  const hit = <circle cx={pos.x} cy={pos.y} r={5.5} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />;
  // grabbable stick blade (only wired for rotatable stationary players)
  const stickHit = onStickDown && p.kind === "player" && (
    <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.a || 0})`}>
      <circle cx={4.7} cy={p.hand === "L" ? -2.55 : 2.55} r={2.7} fill="transparent"
        style={{ cursor: "grab" }} onPointerDown={onStickDown} />
    </g>
  );
  let body;
  if (p.kind === "puck")
    body = <circle cx={pos.x} cy={pos.y} r={1.5} fill="#14171a" stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.4} pointerEvents="none" />;
  else if (p.kind === "cone")
    body = (
      <path d={`M ${pos.x} ${pos.y - 2.4} L ${pos.x + 2.2} ${pos.y + 1.8} L ${pos.x - 2.2} ${pos.y + 1.8} Z`}
        fill={p.color} stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.35} strokeLinejoin="round" pointerEvents="none" />
    );
  else {
    const dark = "#1d2126";
    const rad = ((pos.a || 0) * Math.PI) / 180;
    body = (
      <g pointerEvents="none">
        {selected && <circle cx={pos.x} cy={pos.y} r={4.6} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <g transform={`translate(${pos.x} ${pos.y}) rotate(${pos.a || 0})`}>
          <path d="M -0.7 -1.5 L -3.1 -3.0" stroke={dark} strokeWidth={1.0} strokeLinecap="round" />
          <path d="M -0.7 1.5 L -3.1 3.0" stroke={dark} strokeWidth={1.0} strokeLinecap="round" />
          <path d="M -2.7 -2.75 L -3.7 -3.35" stroke="#dfe7ee" strokeWidth={0.28} strokeLinecap="round" />
          <path d="M -2.7 2.75 L -3.7 3.35" stroke="#dfe7ee" strokeWidth={0.28} strokeLinecap="round" />
          <path d="M 1.3 0 C 1.3 -2.2 0.6 -3.2 -0.5 -3.3 C -2.0 -3.4 -2.8 -2.2 -2.8 -1.1 L -2.8 1.1 C -2.8 2.2 -2.0 3.4 -0.5 3.3 C 0.6 3.2 1.3 2.2 1.3 0 Z"
            fill={p.color} stroke="#fff" strokeWidth={0.32} />
          <path d="M -1.5 -3.15 Q -0.55 0 -1.5 3.15" fill="none" stroke="#fff" strokeWidth={0.42} opacity={0.75} />
          <g transform={p.hand === "L" ? "scale(1 -1)" : undefined}>
            <path d="M -0.3 -2.5 C 0.7 -2.3 1.4 -1.4 1.7 -0.5" fill="none" stroke={p.color} strokeWidth={1.05} strokeLinecap="round" />
            <path d="M -0.3 2.5 C 0.9 2.4 1.9 2.0 2.6 1.5" fill="none" stroke={p.color} strokeWidth={1.05} strokeLinecap="round" />
            <path d="M 1.75 -0.35 L 4.35 2.75" stroke={dark} strokeWidth={0.4} strokeLinecap="round" />
            <path d="M 4.2 2.6 L 5.6 2.45" stroke={dark} strokeWidth={0.8} strokeLinecap="round" />
            <circle cx={1.8} cy={-0.3} r={0.75} fill={dark} />
            <circle cx={2.7} cy={1.55} r={0.75} fill={dark} />
          </g>
          <circle cx={0.85} cy={0} r={1.55} fill={p.color} />
          <circle cx={0.85} cy={0} r={1.55} fill="#000" opacity={0.45} />
          <path d="M 0.1 -1.0 Q 0.9 -1.5 1.7 -1.0" fill="none" stroke="#fff" strokeWidth={0.22} opacity={0.35} />
        </g>
        <text x={pos.x - 1.7 * Math.cos(rad)} y={pos.y - 1.7 * Math.sin(rad) + 0.92}
          transform={screenRot ? `rotate(${-screenRot} ${pos.x - 1.7 * Math.cos(rad)} ${pos.y - 1.7 * Math.sin(rad)})` : undefined}
          textAnchor="middle" fontSize={2.5} fontWeight={800} fill="#fff"
          style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
            paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 0.3 }}>
          {p.label}
        </text>
      </g>
    );
  }
  return <g opacity={dim ? 0.92 : 1}>{body}{hit}{stickHit}</g>;
}

/* ---------------- stepper ---------------- */

function Stepper({ value, onChange, step = 0.5, min = 0, suffix = "s" }) {
  return (
    <span className="hd-stepper">
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <span>{value}{suffix}</span>
      <button onClick={() => onChange(+(value + step).toFixed(2))}>+</button>
    </span>
  );
}

/* ============================================================ */

export default function DrillAnimator() {
  const init = parseDrill(DEFAULT_TEXT);
  const [rink, setRink] = useState(init.rink);
  const [pieces, setPieces] = useState(init.pieces);
  const [selectedId, setSelectedId] = useState(null);
  const [popup, setPopup] = useState(null);
  const [tool, setTool] = useState("select");
  const [openMenu, setOpenMenu] = useState(null); // settings | rinkmenu | tools | text
  const [textDraft, setTextDraft] = useState(DEFAULT_TEXT);
  const [textError, setTextError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [animT, setAnimT] = useState(0);
  const [pace, setPace] = useState(15);
  const [drawPreview, setDrawPreview] = useState(null);
  const [loupe, setLoupe] = useState(null);
  const [popOff, setPopOff] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ w: 800, h: 500 });

  const svgRef = useRef(null);
  const sceneRef = useRef(null);
  const stageRef = useRef(null);
  const segRefs = useRef({});
  const drag = useRef(null);
  const drawRaw = useRef([]);
  const drawTarget = useRef(null);
  const fileRef = useRef(null);
  const animRef = useRef(0);
  const totalRef = useRef(1);
  const popDrag = useRef(null);
  const lastLineTap = useRef(null);
  const lastIceTap = useRef(null); // double-click/tap on empty ice → add menu

  const selected = pieces.find(p => p.id === selectedId) || null;
  const editing = animT === 0 && !playing;

  useEffect(() => { setPopOff({ x: 0, y: 0 }); },
    [popup?.type, popup?.id, popup?.seg, popup?.pt?.x, popup?.pt?.y]);

  function popDragStart(e) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    popDrag.current = { sx: e.clientX, sy: e.clientY, ox: popOff.x, oy: popOff.y };
  }
  function popDragMove(e) {
    const d = popDrag.current;
    if (!d) return;
    setPopOff({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy });
  }
  function popDragEnd() { popDrag.current = null; }

  /* ----- full-screen fit: size the canvas to the rink's aspect ----- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [mxF, myF, vwF, vhF] = VIEWS[rink];
  // Fill mode: the rink stretches to occupy the entire stage, both axes —
  // no letterbox bands. Orientation is chosen to minimize distortion by
  // comparing the stage aspect to the rink's aspect both ways (log scale
  // so "2x too wide" and "2x too tall" weigh equally).
  const sa = stageSize.w / Math.max(1, stageSize.h);
  const rotated =
    Math.abs(Math.log(sa / (vhF / vwF))) < Math.abs(Math.log(sa / (vwF / vhF)));
  const canvasW = Math.max(50, stageSize.w);
  const canvasH = Math.max(20, stageSize.h);
  // maps rink coords into the rotated viewBox: (x,y) -> (my+vh-y, x-mx)
  const sceneTransform = rotated ? `rotate(90) translate(${-mxF} ${-(myF + vhF)})` : undefined;
  const screenRot = rotated ? 90 : 0;

  /* ----- timing ----- */
  function segLen(id, i) {
    const el = segRefs.current[`${id}/${i}`];
    try { return el ? el.getTotalLength() : 0; } catch { return 0; }
  }
  function segMoveTime(p, s, i) {
    const v = pace * SPEED[s.mode || "carry"] * (p.speed || 1) * (s.rate || 1);
    return v > 0 ? segLen(p.id, i) / v : 0;
  }
  const lenSig = pieces.reduce((a, p) => a + p.path.reduce((b, _, i) => b + segLen(p.id, i), 0), 0);

  /* ---- pass planning ----
     Pucks can be handed between players: each transfer launches at a
     point on the current carrier's route and flies (at PASS speed) to
     the receiver. If the transfer names a reception point (recvAt), the
     receiver's legs up to that point are time-warped so they arrive
     exactly as the puck does; otherwise the puck leads the receiver to
     wherever they will be when it lands. After the last transfer the
     puck's own route (if any) releases by the usual proximity rule. */
  const planCache = useRef({ key: null, pace: 0, sig: -1, warp: {}, plans: {}, rel: {} });

  function effMove(p, s, i, warp) {
    const base = segMoveTime(p, s, i);
    const w = warp[p.id];
    return w && i <= w.upto ? base / w.f : base;
  }

  function routeTimeW(p, warp, upto = Infinity) {
    let t = 0;
    for (let i = 0; i < p.path.length; i++) {
      if (i > upto) break;
      t += (p.path[i].stop || 0) + effMove(p, p.path[i], i, warp);
    }
    return t;
  }

  function bladeAt(pl, e, warp) {
    const cp = routePosAt(pl, e, warp);
    const rad = ((cp.a || 0) * Math.PI) / 180;
    const side = pl.hand === "L" ? -1 : 1;
    const lx = 4.9, ly = 2.55 * side;
    return {
      x: clampX(cp.x + Math.cos(rad) * lx - Math.sin(rad) * ly),
      y: clampY(cp.y + Math.sin(rad) * lx + Math.cos(rad) * ly),
      a: 0,
    };
  }

  function getPlan() {
    const pc = planCache.current;
    if (pc.key === pieces && pc.pace === pace && pc.sig === lenSig) return pc;
    const warp = {};
    const plans = {};
    const rel = {};
    pieces.forEach(pk => {
      if (pk.kind !== "puck" || !pk.carrier) return;
      let cur = pieces.find(q => q.id === pk.carrier && q.kind === "player");
      if (!cur) return;
      const vPass = () => pace * SPEED.pass * (pk.speed || 1);
      const legs = [{ type: "ride", id: cur.id, t0: 0 }];
      let tBase = 0;
      (pk.transfers || []).forEach(tr => {
        const rec = pieces.find(q => q.id === tr.to && q.kind === "player");
        if (!rec || rec.id === cur.id || !cur.path.length) return;
        const atIdx = Math.max(0, Math.min(tr.at, cur.path.length - 1));
        const launchT = Math.max(tBase, routeTimeW(cur, warp, atIdx));
        const launch = bladeAt(cur, launchT, warp);
        let target, tArr;
        if (tr.recvAt != null && rec.path.length) {
          const rj = Math.max(0, Math.min(tr.recvAt, rec.path.length - 1));
          const anchor = { x: rec.path[rj].x, y: rec.path[rj].y };
          tArr = launchT + Math.hypot(anchor.x - launch.x, anchor.y - launch.y) / vPass();
          if (!warp[rec.id]) {
            let stops = 0, moving = 0;
            for (let i = 0; i <= rj; i++) {
              stops += rec.path[i].stop || 0;
              moving += segMoveTime(rec, rec.path[i], i);
            }
            const avail = tArr - stops;
            if (moving > 0 && avail > 0.05)
              warp[rec.id] = { upto: rj, f: Math.min(4, Math.max(0.25, moving / avail)) };
          }
          target = bladeAt(rec, routeTimeW(rec, warp, rj), warp);
          tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
        } else {
          tArr = launchT;
          for (let k = 0; k < 3; k++) {
            target = bladeAt(rec, tArr, warp);
            tArr = launchT + Math.hypot(target.x - launch.x, target.y - launch.y) / vPass();
          }
          target = bladeAt(rec, tArr, warp);
        }
        legs.push({ type: "fly", x0: launch.x, y0: launch.y, x1: target.x, y1: target.y, t0: launchT, t1: tArr });
        legs.push({ type: "ride", id: rec.id, t0: tArr });
        cur = rec;
        tBase = tArr;
      });
      if (pk.shotAt != null && cur.path.length) {
        const atIdx = Math.max(0, Math.min(pk.shotAt, cur.path.length - 1));
        const launchT = Math.max(tBase, routeTimeW(cur, warp, atIdx));
        const launch = bladeAt(cur, launchT, warp);
        const net = launch.x < 100 ? { x: 9, y: 42.5 } : { x: 191, y: 42.5 };
        const vShot = pace * SPEED.shot * (pk.speed || 1);
        const tArr = launchT + Math.hypot(net.x - launch.x, net.y - launch.y) / vShot;
        legs.push({ type: "fly", shot: true, x0: launch.x, y0: launch.y, x1: net.x, y1: net.y, t0: launchT, t1: tArr });
        legs.push({ type: "rest", x: net.x, y: net.y, t0: tArr });
        tBase = tArr;
      }
      let relT = Infinity;
      if (pk.path.length && pk.shotAt == null) {
        const finish = Math.max(tBase + 0.01, routeTimeW(cur, warp));
        relT = finish;
        const step = Math.max(0.03, (finish - tBase) / 200);
        for (let t = tBase; t <= finish + 1e-6; t += step) {
          const b = bladeAt(cur, t, warp);
          if (Math.hypot(b.x - pk.x, b.y - pk.y) < 3) { relT = t; break; }
        }
      }
      plans[pk.id] = { legs, final: cur.id };
      rel[pk.id] = relT;
    });
    planCache.current = { key: pieces, pace, sig: lenSig, warp, plans, rel };
    return planCache.current;
  }

  function pieceTime(p) {
    const { warp, plans, rel } = getPlan();
    if (p.kind === "puck") {
      const pl = plans[p.id];
      if (pl) {
        if (p.path.length && p.shotAt == null) return rel[p.id] + routeTimeW(p, warp);
        const fin = pieces.find(q => q.id === pl.final);
        const lastT = pl.legs[pl.legs.length - 1].t0;
        return fin ? Math.max(lastT, routeTimeW(fin, warp)) : lastT;
      }
    }
    return routeTimeW(p, warp);
  }
  const totalTime = Math.max(0.1, ...pieces.map(pieceTime));
  totalRef.current = totalTime;

  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const step = now => {
      const dt = (now - last) / 1000;
      last = now;
      let t = animRef.current + dt / Math.max(0.1, totalRef.current);
      if (t >= 1) { animRef.current = 1; setAnimT(1); setPlaying(false); return; }
      animRef.current = t;
      setAnimT(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line

  function resetAnim() { animRef.current = 0; setAnimT(0); }

  // one re-render after mount so hidden path lengths are measured
  const [, bumpTick] = useState(0);
  useEffect(() => { bumpTick(t => t + 1); }, []);

  // Block page scroll/zoom for touches that start on the rink.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const block = e => e.preventDefault();
    svg.addEventListener("touchstart", block, { passive: false });
    svg.addEventListener("touchmove", block, { passive: false });
    return () => {
      svg.removeEventListener("touchstart", block);
      svg.removeEventListener("touchmove", block);
    };
  }, []);

  // position/heading along a piece's own route at elapsed e (warp-aware)
  function routePosAt(p, e, warp) {
    const flip = s => (s.dir === "bwd" ? 180 : 0);
    if (!p.path.length) return { x: p.x, y: p.y, a: p.facing || 0 };
    if (e <= 0) {
      const s0 = p.path[0];
      return { x: p.x, y: p.y, a: segTangentAngle({ x: p.x, y: p.y }, s0, 0.02) + flip(s0) };
    }
    let prev = { x: p.x, y: p.y };
    for (let i = 0; i < p.path.length; i++) {
      const s = p.path[i];
      const hold = s.stop || 0;
      if (e < hold) return { ...prev, a: segTangentAngle(prev, s, 0.02) + flip(s) };
      e -= hold;
      const mt = effMove(p, s, i, warp);
      if (mt > 0 && e < mt) {
        const el = segRefs.current[`${p.id}/${i}`];
        try {
          const L = el.getTotalLength();
          const l = L * (e / mt);
          const pt = el.getPointAtLength(l);
          const q = el.getPointAtLength(Math.min(L, l + 0.6));
          let a;
          if (Math.hypot(q.x - pt.x, q.y - pt.y) < 0.05) {
            const b = el.getPointAtLength(Math.max(0, l - 0.6));
            a = (Math.atan2(pt.y - b.y, pt.x - b.x) * 180) / Math.PI;
          } else {
            a = (Math.atan2(q.y - pt.y, q.x - pt.x) * 180) / Math.PI;
          }
          return { x: pt.x, y: pt.y, a: a + flip(s) };
        } catch { return { ...prev, a: 0 }; }
      }
      e -= mt;
      prev = { x: s.x, y: s.y };
    }
    const last = p.path[p.path.length - 1];
    const lp = segEnd(p, p.path.length - 2);
    return { x: last.x, y: last.y, a: segTangentAngle(lp, last, 0.98) + flip(last) };
  }

  function displayPosAt(p, e) {
    const { warp, plans, rel } = getPlan();
    if (p.kind === "puck") {
      const pl = plans[p.id];
      if (pl) {
        const relT = rel[p.id];
        if (p.path.length && e >= relT) return routePosAt(p, e - relT, warp);
        let leg = pl.legs[0];
        for (const L of pl.legs) { if (e >= L.t0) leg = L; else break; }
        if (leg.type === "fly" && e < leg.t1) {
          const k = Math.max(0, Math.min(1, (e - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)));
          return { x: leg.x0 + (leg.x1 - leg.x0) * k, y: leg.y0 + (leg.y1 - leg.y0) * k, a: 0 };
        }
        if (leg.type === "fly") return { x: leg.x1, y: leg.y1, a: 0 };
        if (leg.type === "rest") return { x: leg.x, y: leg.y, a: 0 };
        const car = pieces.find(q => q.id === leg.id);
        if (car) return bladeAt(car, Math.min(e, routeTimeW(car, warp)), warp);
        return { x: p.x, y: p.y, a: 0 };
      }
      return routePosAt(p, e, warp);
    }
    return routePosAt(p, e, warp);
  }

  function displayPos(p) {
    return displayPosAt(p, animT <= 0 ? 0 : animT * totalTime);
  }

  /* ----- coords ----- */
  function svgPt(evt) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    // the scene <g> carries the orientation transform, so its CTM
    // maps client pixels straight into rink feet either way
    const m = (sceneRef.current || svg).getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const q = pt.matrixTransform(m.inverse());
    return { x: clampX(q.x), y: clampY(q.y) };
  }

  /* ----- edits ----- */
  const update = fn => setPieces(ps => ps.map(fn));
  const updateById = (id, patch) => update(p => (p.id === id ? { ...p, ...patch } : p));
  const updateSeg = (id, i, patch) =>
    update(p => {
      if (p.id !== id) return p;
      const path = p.path.slice();
      path[i] = { ...path[i], ...patch };
      return { ...p, path };
    });

  function nextId(kind) {
    const prefix = kind === "player" ? "P" : kind === "puck" ? "PK" : "C";
    let n = 1;
    while (pieces.some(p => p.id === prefix + n)) n++;
    return prefix + n;
  }

  function makePiece(kind, pt) {
    const id = nextId(kind);
    const colorIdx = pieces.filter(p => p.kind === "player").length % COLORS.length;
    return {
      id, kind, x: pt.x, y: pt.y, speed: 1, hand: "R", carrier: null, facing: 0, transfers: [], shotAt: null,
      color: kind === "player" ? COLORS[colorIdx] : kind === "cone" ? "#e0731d" : "#14171a",
      label: kind === "player" ? id : "", path: [],
    };
  }

  function addSegment(id, type) {
    update(p => {
      if (p.id !== id) return p;
      const prev = segEnd(p, p.path.length - 1);
      const seg = convertSeg({ type, x: clampX(prev.x + 22), y: prev.y }, prev);
      return { ...p, path: [...p.path, seg] };
    });
  }
  function changeSegType(id, i, type) {
    update(p => {
      if (p.id !== id) return p;
      const path = p.path.slice();
      path[i] = convertSeg({ ...path[i], type }, segEnd(p, i - 1));
      return { ...p, path };
    });
  }
  function deleteSeg(id, i) {
    update(p => (p.id === id ? { ...p, path: p.path.filter((_, j) => j !== i) } : p));
    setPopup(null);
  }

  /* ----- puck handoffs ----- */
  function puckChain(pk) {
    return [pk.carrier, ...(pk.transfers || []).map(t => t.to)].filter(Boolean);
  }
  function setTransfer(pkId, stage, tr) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).slice(0, stage);
      if (tr) ts[stage] = tr;
      return { ...q, transfers: ts, shotAt: null };
    });
  }
  function setRecvAt(pkId, toId, idx) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).map(t => (t.to === toId ? { ...t, recvAt: idx } : t));
      return { ...q, transfers: ts };
    });
  }

  function addPointAt(id, segIdx, pt) {
    update(p => {
      if (p.id !== id) return p;
      const s = p.path[segIdx];
      if (!s) return p;
      const prev = segEnd(p, segIdx - 1);
      const parts = splitSeg(prev, s, nearestT(prev, s, pt));
      return { ...p, path: [...p.path.slice(0, segIdx), ...parts, ...p.path.slice(segIdx + 1)] };
    });
    setSelectedId(id);
    setPopup({ type: "point", id, seg: segIdx });
  }

  /* ----- drawing ----- */
  function beginDraw(e, existingId) {
    const pt = svgPt(e);
    let id = existingId || selectedId;
    if (!id) {
      const np = makePiece("player", pt);
      setPieces(ps => [...ps, np]);
      id = np.id;
      setSelectedId(id);
    }
    drawTarget.current = id;
    drawRaw.current = [pt];
    setDrawPreview([pt]);
    drag.current = { kind: "drawing", touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function finishDraw() {
    const id = drawTarget.current;
    const raw = drawRaw.current;
    drawTarget.current = null;
    drawRaw.current = [];
    setDrawPreview(null);
    setTool("select");
    if (!id || raw.length < 3) return;
    setPieces(ps => ps.map(p => {
      if (p.id !== id) return p;
      const route = fitRoute({ x: p.x, y: p.y }, raw);
      return route.length ? { ...p, path: route } : p;
    }));
  }

  /* ----- pointer handling ----- */
  const TAP_DIST = 1.4;

  function onSvgDown(e) {
    if (playing) return;
    setOpenMenu(null);
    const pt = svgPt(e);
    if (tool === "draw") { setPopup(null); beginDraw(e); return; }
    if (tool === "playerpuck") {
      addPlayerWithPuck(pt, false);
      setTool("select");
      return;
    }
    if (tool !== "select") {
      const np = makePiece(tool, pt);
      setPieces(ps => [...ps, np]);
      setSelectedId(np.id);
      setPopup(null);
      setTool("select");
      return;
    }
    setSelectedId(null);
    setPopup(null);
    // double-click / double-tap on empty ice → "add here" menu
    if (editing) {
      const now = performance.now();
      const it = lastIceTap.current;
      if (it && now - it.t < 350 && Math.hypot(it.pt.x - pt.x, it.pt.y - pt.y) < 3) {
        lastIceTap.current = null;
        setPopup({ type: "add", pt });
        return;
      }
      lastIceTap.current = { t: now, pt };
    }
  }

  function addPieceAt(kind, pt) {
    const np = makePiece(kind, pt);
    setPieces(ps => [...ps, np]);
    setSelectedId(np.id);
    setPopup({ type: "piece", id: np.id });
  }

  function addPlayerWithPuck(pt, showPopup) {
    const pl = makePiece("player", pt);
    const pk = makePiece("puck", pt);
    pk.carrier = pl.id;
    setPieces(ps => [...ps, pl, pk]);
    setSelectedId(pl.id);
    setPopup(showPopup ? { type: "piece", id: pl.id } : null);
  }

  function pieceDown(e, id) {
    if (playing) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw") { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    if (animT > 0) return;
    setSelectedId(id);
    const pt = svgPt(e);
    drag.current = { kind: "piece", id, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function lineDown(e, id, segIdx) {
    if (playing) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw") { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    if (animT > 0) return;
    setSelectedId(id);
    const pt = svgPt(e);
    drag.current = { kind: "piece", id, line: segIdx, tapPt: pt, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function handleDown(e, payload) {
    if (!editing) return;
    e.stopPropagation();
    setOpenMenu(null);
    const pt = svgPt(e);
    drag.current = { ...payload, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // grab the stick of a stationary player to rotate them; the blade's
  // own angular offset from the body is subtracted so the blade tracks
  // the pointer exactly instead of jumping on grab
  function stickDown(e, p) {
    if (playing || animT > 0) return;
    e.stopPropagation();
    setOpenMenu(null);
    setSelectedId(p.id);
    const side = p.hand === "L" ? -1 : 1;
    const offset = (Math.atan2(2.55 * side, 4.7) * 180) / Math.PI;
    const pt = svgPt(e);
    drag.current = { kind: "rotate", id: p.id, offset, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function onSvgMove(e) {
    const d = drag.current;
    if (!d) return;
    const pt = svgPt(e);
    if (d.kind === "drawing") {
      const last = drawRaw.current[drawRaw.current.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > 1.1) {
        drawRaw.current.push(pt);
        setDrawPreview(drawRaw.current.slice());
      }
      if (d.touch) setLoupe(pt);
      return;
    }
    if (!d.moved) {
      if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) < TAP_DIST) return;
      d.moved = true;
      d.last = d.start;
      setPopup(null);
    }
    if (d.touch) setLoupe(pt);
    if (d.kind === "rotate") {
      update(p => {
        if (p.id !== d.id) return p;
        const ang = (Math.atan2(pt.y - p.y, pt.x - p.x) * 180) / Math.PI;
        return { ...p, facing: ang - (d.offset || 0) };
      });
      return;
    }
    if (d.kind === "piece") {
      const dx = pt.x - d.last.x, dy = pt.y - d.last.y;
      d.last = pt;
      update(p => {
        if (p.id !== d.id) return p;
        const mv = s => {
          const s2 = { ...s, x: clampX(s.x + dx), y: clampY(s.y + dy) };
          if (s.type === "Q") { s2.cx = clampX(s.cx + dx); s2.cy = clampY(s.cy + dy); }
          if (s.type === "C") {
            s2.c1x = clampX(s.c1x + dx); s2.c1y = clampY(s.c1y + dy);
            s2.c2x = clampX(s.c2x + dx); s2.c2y = clampY(s.c2y + dy);
          }
          return s2;
        };
        return { ...p, x: clampX(p.x + dx), y: clampY(p.y + dy), path: p.path.map(mv) };
      });
      return;
    }
    update(p => {
      if (p.id !== d.id) return p;
      const path = p.path.slice();
      const s = { ...path[d.seg] };
      if (d.kind === "anchor") { s.x = pt.x; s.y = pt.y; }
      if (d.kind === "q") { s.cx = pt.x; s.cy = pt.y; }
      if (d.kind === "c1") { s.c1x = pt.x; s.c1y = pt.y; }
      if (d.kind === "c2") { s.c2x = pt.x; s.c2y = pt.y; }
      path[d.seg] = s;
      return { ...p, path };
    });
  }

  function onSvgUp() {
    const d = drag.current;
    drag.current = null;
    setLoupe(null);
    if (!d) return;
    if (d.kind === "drawing") { finishDraw(); return; }
    if (d.moved) return;
    if (d.kind === "rotate") { setPopup({ type: "piece", id: d.id }); return; }
    if (d.kind === "piece") {
      if (d.line != null) {
        const now = performance.now();
        const lt = lastLineTap.current;
        if (lt && now - lt.t < 350 && lt.id === d.id &&
            Math.hypot(lt.pt.x - d.tapPt.x, lt.pt.y - d.tapPt.y) < 3) {
          lastLineTap.current = null;
          addPointAt(d.id, d.line, d.tapPt);
          return;
        }
        lastLineTap.current = { t: now, id: d.id, pt: d.tapPt };
        setPopup({ type: "line", id: d.id, seg: d.line, pt: d.tapPt });
        return;
      }
      setPopup({ type: "piece", id: d.id });
    }
    if (d.kind === "anchor") { setSelectedId(d.id); setPopup({ type: "point", id: d.id, seg: d.seg }); }
  }

  /* ----- text / files ----- */
  function openText() {
    setTextDraft(serializeDrill(rink, pieces));
    setTextError("");
    setOpenMenu("text");
  }
  function applyText() {
    const r = parseDrill(textDraft);
    if (r.errors.length) { setTextError(r.errors.join("\n")); return; }
    setRink(r.rink); setPieces(r.pieces); setSelectedId(null); setPopup(null);
    resetAnim(); setTextError(""); setOpenMenu(null);
  }
  function exportTxt() {
    const blob = new Blob([serializeDrill(rink, pieces)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "drill.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importTxt(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result);
      const r = parseDrill(txt);
      if (r.errors.length) { setTextDraft(txt); setTextError(r.errors.join("\n")); setOpenMenu("text"); return; }
      setRink(r.rink); setPieces(r.pieces); setSelectedId(null); setPopup(null);
      resetAnim(); setTextError(""); setOpenMenu(null);
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  /* ----- render helpers ----- */
  function segStroke(p, s, isLast) {
    const base = {
      stroke: p.color, fill: "none", strokeLinecap: "round", opacity: 0.78,
      markerEnd: isLast ? `url(#arr-${p.id})` : undefined,
    };
    if (p.kind !== "puck") return { ...base, strokeWidth: 0.7 };
    if (s.mode === "pass") return { ...base, strokeWidth: 0.7, strokeDasharray: "2.4 1.8" };
    if (s.mode === "shot") return { ...base, strokeWidth: 1.25 };
    return { ...base, strokeWidth: 0.75, strokeDasharray: "0.2 1.5" };
  }

  function renderHandles(p) {
    if (!editing || p.id !== selectedId || tool === "draw") return null;
    const els = [];
    const ctrlPt = (key, cx, cy, kind, i) => {
      els.push(<circle key={key} cx={cx} cy={cy} r={1.5} fill="#fff" stroke="#5b7d9e" strokeWidth={0.4} pointerEvents="none" />);
      els.push(<circle key={key + "h"} cx={cx} cy={cy} r={4} fill="transparent" style={{ cursor: "grab" }}
        onPointerDown={e => handleDown(e, { kind, id: p.id, seg: i })} />);
    };
    p.path.forEach((s, i) => {
      const prev = segEnd(p, i - 1);
      if (s.type === "Q") {
        els.push(<line key={`ql1${i}`} x1={prev.x} y1={prev.y} x2={s.cx} y2={s.cy} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
        els.push(<line key={`ql2${i}`} x1={s.x} y1={s.y} x2={s.cx} y2={s.cy} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
        ctrlPt(`qc${i}`, s.cx, s.cy, "q", i);
      }
      if (s.type === "C") {
        els.push(<line key={`cl1${i}`} x1={prev.x} y1={prev.y} x2={s.c1x} y2={s.c1y} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
        els.push(<line key={`cl2${i}`} x1={s.x} y1={s.y} x2={s.c2x} y2={s.c2y} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
        ctrlPt(`cc1${i}`, s.c1x, s.c1y, "c1", i);
        ctrlPt(`cc2${i}`, s.c2x, s.c2y, "c2", i);
      }
      els.push(<rect key={`a${i}`} x={s.x - 1.4} y={s.y - 1.4} width={2.8} height={2.8}
        fill="#ffd447" stroke="#7a5c00" strokeWidth={0.35} pointerEvents="none" />);
      els.push(<circle key={`ah${i}`} cx={s.x} cy={s.y} r={4} fill="transparent" style={{ cursor: "grab" }}
        onPointerDown={e => handleDown(e, { kind: "anchor", id: p.id, seg: i })} />);
    });
    return <g>{els}</g>;
  }

  // rotation ring + knob for a selected stationary player (touch-friendly);
  // the knob sits at the current facing angle, radius 7 ft
  function renderRotateHandle(p) {
    if (!editing || tool === "draw" || p.kind !== "player" || p.path.length) return null;
    const a = ((p.facing || 0) * Math.PI) / 180;
    const R = 7;
    const kx = p.x + Math.cos(a) * R, ky = p.y + Math.sin(a) * R;
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={R} fill="none" stroke="#ffd447" strokeWidth={0.25}
          strokeDasharray="1 1" opacity={0.75} pointerEvents="none" />
        <circle cx={kx} cy={ky} r={1.6} fill="#ffd447" stroke="#7a5c00" strokeWidth={0.35} pointerEvents="none" />
        <circle cx={kx} cy={ky} r={4.2} fill="transparent" style={{ cursor: "grab" }}
          onPointerDown={e => handleDown(e, { kind: "rotate", id: p.id, offset: 0 })} />
      </g>
    );
  }

  function renderStops(p) {
    const els = [];
    p.path.forEach((s, i) => {
      if (!(s.stop > 0)) return;
      const pt = segEnd(p, i - 1);
      els.push(
        <g key={`st${p.id}${i}`} opacity={0.9} pointerEvents="none">
          <circle cx={pt.x} cy={pt.y} r={2} fill="#fff" stroke={p.color} strokeWidth={0.35} />
          <line x1={pt.x - 0.6} y1={pt.y - 1} x2={pt.x - 0.6} y2={pt.y + 1} stroke={p.color} strokeWidth={0.5} />
          <line x1={pt.x + 0.6} y1={pt.y - 1} x2={pt.x + 0.6} y2={pt.y + 1} stroke={p.color} strokeWidth={0.5} />
        </g>
      );
    });
    return els;
  }

  /* ----- popout ----- */
  function popoutAnchor(pt) {
    const [mx, my, vw, vh] = VIEWS[rink];
    const lx = rotated ? ((my + vh - pt.y) / vh) * 100 : ((pt.x - mx) / vw) * 100;
    const ty = rotated ? ((pt.x - mx) / vw) * 100 : ((pt.y - my) / vh) * 100;
    if (lx < -2 || lx > 102 || ty < -2 || ty > 102) return null;
    return { lx: Math.max(0, Math.min(100, lx)), ty: Math.max(0, Math.min(100, ty)) };
  }

  function renderPopout() {
    if (!popup || !editing || tool === "draw") return null;
    const p = pieces.find(q => q.id === popup.id);
    if (!p && popup.type !== "add") return null;

    let anchorPt, body, title;
    if (popup.type === "add") {
      if (!popup.pt) return null;
      anchorPt = popup.pt;
      title = "Add here";
      body = (
        <div className="hd-poprow">
          <button className="hd-mini" onClick={() => addPieceAt("player", popup.pt)}>⛹ Player</button>
          <button className="hd-mini" onClick={() => addPlayerWithPuck(popup.pt, true)}>⛹● Carrier</button>
          <button className="hd-mini" onClick={() => addPieceAt("puck", popup.pt)}>● Puck</button>
          <button className="hd-mini" onClick={() => addPieceAt("cone", popup.pt)}>▲ Cone</button>
        </div>
      );
    } else if (popup.type === "piece") {
      anchorPt = { x: p.x, y: p.y };
      title = p.kind === "player" ? `Player ${p.id}` : p.kind === "puck" ? `Puck ${p.id}` : `Cone ${p.id}`;
      body = (
        <>
          {p.kind === "player" && (
            <>
              <div className="hd-poprow">
                <span>Name</span>
                <input className="hd-input" style={{ width: 56 }} value={p.label} maxLength={3}
                  onChange={e => updateById(p.id, { label: e.target.value })} />
              </div>
              <div className="hd-poprow">
                {COLORS.map(c => (
                  <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                    onClick={() => updateById(p.id, { color: c })} />
                ))}
              </div>
              <div className="hd-poprow">
                <span>Shoots</span>
                <button className={`hd-mini${(p.hand || "R") === "R" ? " on" : ""}`}
                  onClick={() => updateById(p.id, { hand: "R" })}>R</button>
                <button className={`hd-mini${p.hand === "L" ? " on" : ""}`}
                  onClick={() => updateById(p.id, { hand: "L" })}>L</button>
                {!pieces.some(q => q.kind === "puck" && q.carrier === p.id) && (
                  <button className="hd-mini" onClick={() => {
                    const pk = makePiece("puck", { x: p.x, y: p.y });
                    pk.carrier = p.id;
                    setPieces(ps => [...ps, pk]);
                  }}>● Give puck</button>
                )}
              </div>
            </>
          )}
          {p.kind === "puck" && pieces.some(q => q.kind === "player") && (
            <>
              <div className="hd-poprow">
                <span>On stick of</span>
                {pieces.filter(q => q.kind === "player").map(pl => (
                  <button key={pl.id} className={`hd-mini${p.carrier === pl.id ? " on" : ""}`}
                    onClick={() => updateById(p.id, { carrier: p.carrier === pl.id ? null : pl.id })}>
                    {pl.id}
                  </button>
                ))}
              </div>
              {p.carrier && p.path.length > 0 && (
                <div className="hd-poprow" style={{ fontSize: 11.5, color: "#8b99a8" }}>
                  Rides the blade, releases when the carrier reaches the puck's
                  spot (dashed ring), then runs its own route.
                </div>
              )}
            </>
          )}
          {p.kind !== "cone" && (
            <div className="hd-poprow">
              <span>Speed ×{(p.speed || 1).toFixed(2)}</span>
              <input type="range" min={0.5} max={2} step={0.05} value={p.speed || 1} style={{ flex: 1, minWidth: 80 }}
                onChange={e => updateById(p.id, { speed: parseFloat(e.target.value) })} />
            </div>
          )}
          {p.path.length > 0 && (
            <div className="hd-poprow">
              <span>Start delay</span>
              <Stepper value={p.path[0].stop || 0} onChange={v => updateSeg(p.id, 0, { stop: v })} />
            </div>
          )}
          <div className="hd-poprow">
            <span>Add leg</span>
            <button className="hd-mini" onClick={() => addSegment(p.id, "L")}>⎯</button>
            <button className="hd-mini" onClick={() => addSegment(p.id, "Q")}>⌒</button>
            <button className="hd-mini" onClick={() => addSegment(p.id, "C")}>∿</button>
          </div>
          <div className="hd-poprow">
            {p.path.length > 0 && (
              <button className="hd-mini" onClick={() => { updateById(p.id, { path: [] }); setPopup(null); }}>Clear route</button>
            )}
            <button className="hd-mini danger"
              onClick={() => {
                setPieces(ps => ps.filter(q => q.id !== p.id)
                  .map(q => (q.carrier === p.id ? { ...q, carrier: null } : q)));
                setSelectedId(null); setPopup(null);
              }}>
              Delete
            </button>
          </div>
        </>
      );
    } else if (popup.type === "line") {
      const s = p.path[popup.seg];
      if (!s || !popup.pt) return null;
      anchorPt = popup.pt;
      title = `${p.id} · leg ${popup.seg + 1}`;
      body = (
        <div className="hd-poprow">
          <button className="hd-mini" onClick={() => addPointAt(p.id, popup.seg, popup.pt)}>
            ＋ Add point here
          </button>
        </div>
      );
    } else {
      const i = popup.seg;
      const s = p.path[i];
      if (!s) return null;
      anchorPt = { x: s.x, y: s.y };
      const next = p.path[i + 1];
      title = `Point ${i + 1} of ${p.path.length}`;
      body = (
        <>
          {next ? (
            <>
              <div className="hd-poprow">
                <span>Pause here</span>
                <Stepper value={next.stop || 0} onChange={v => updateSeg(p.id, i + 1, { stop: v })} />
              </div>
              <div className="hd-poprow">
                <span>Speed after ×{(next.rate || 1).toFixed(2)}</span>
                <input type="range" min={0.5} max={2} step={0.05} value={next.rate || 1} style={{ flex: 1, minWidth: 70 }}
                  onChange={e => updateSeg(p.id, i + 1, { rate: parseFloat(e.target.value) })} />
              </div>
              <div className="hd-poprow">
                <span>Next leg</span>
                {[["L", "⎯"], ["Q", "⌒"], ["C", "∿"]].map(([t, g]) => (
                  <button key={t} className={`hd-mini${next.type === t ? " on" : ""}`}
                    onClick={() => changeSegType(p.id, i + 1, t)}>{g}</button>
                ))}
              </div>
              {p.kind === "player" && (
                <div className="hd-poprow">
                  <span>Then skate</span>
                  <button className={`hd-mini${(next.dir || "fwd") === "fwd" ? " on" : ""}`}
                    onClick={() => updateSeg(p.id, i + 1, { dir: "fwd" })}>Fwd</button>
                  <button className={`hd-mini${next.dir === "bwd" ? " on" : ""}`}
                    onClick={() => updateSeg(p.id, i + 1, { dir: "bwd" })}>Bwd</button>
                </div>
              )}
              {p.kind === "puck" && (
                <div className="hd-poprow">
                  <span>Then</span>
                  {["carry", "pass", "shot"].map(m => (
                    <button key={m} className={`hd-mini${(next.mode || "carry") === m ? " on" : ""}`}
                      onClick={() => updateSeg(p.id, i + 1, { mode: m })}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="hd-poprow" style={{ color: "#8b99a8", fontSize: 12 }}>End of route</div>
          )}
          {p.kind === "player" && (() => {
            const pk = pieces.find(q => q.kind === "puck" && puckChain(q).includes(p.id));
            if (!pk) return null;
            const chain = puckChain(pk);
            const stage = chain.indexOf(p.id);
            const from = (pk.transfers || [])[stage];
            const incoming = (pk.transfers || []).find(t => t.to === p.id);
            const others = pieces.filter(q => q.kind === "player" && q.id !== p.id);
            return (
              <>
                {stage >= 0 && others.length > 0 && (!from || from.at === i) && (
                  <div className="hd-poprow">
                    <span>Pass {pk.id} to</span>
                    {others.map(o => (
                      <button key={o.id}
                        className={`hd-mini${from && from.at === i && from.to === o.id ? " on" : ""}`}
                        onClick={() =>
                          setTransfer(pk.id, stage,
                            from && from.at === i && from.to === o.id
                              ? null
                              : { at: i, to: o.id, recvAt: null })}>
                        {o.id}
                      </button>
                    ))}
                  </div>
                )}
                {stage === (pk.transfers || []).length && (
                  <div className="hd-poprow">
                    <button className={`hd-mini${pk.shotAt === i ? " on" : ""}`}
                      onClick={() => updateById(pk.id, { shotAt: pk.shotAt === i ? null : i })}>
                      {pk.shotAt === i ? "✓ Shooting at net" : "🥅 Shoot at net"}
                    </button>
                  </div>
                )}
                {incoming && p.path.length > 0 && (
                  <div className="hd-poprow">
                    <button className={`hd-mini${incoming.recvAt === i ? " on" : ""}`}
                      onClick={() => setRecvAt(pk.id, p.id, incoming.recvAt === i ? null : i)}>
                      {incoming.recvAt === i ? "✓ Receiving here" : "Receive pass here"}
                    </button>
                    {incoming.recvAt === i && (
                      <span style={{ fontSize: 11, color: "#8b99a8" }}>
                        {pk.shotAt === i ? "one-timer — pace auto-syncs" : "pace auto-syncs"}
                      </span>
                    )}
                  </div>
                )}
              </>
            );
          })()}
          <div className="hd-poprow">
            <button className="hd-mini danger" onClick={() => deleteSeg(p.id, i)}>Delete point</button>
          </div>
        </>
      );
    }

    const a = popoutAnchor(anchorPt);
    if (!a) return null;
    const up = a.ty > 58;
    const shift = a.lx < 22 ? "-12%" : a.lx > 78 ? "-88%" : "-50%";
    const style = {
      left: `${a.lx}%`,
      transform: `translateX(${shift}) translate(${popOff.x}px, ${popOff.y}px)`,
      ...(up ? { bottom: `${100 - a.ty + 4}%` } : { top: `${a.ty + 4}%` }),
    };
    return (
      <div className={`hd-pop${up ? " up" : ""}`} style={style}
        onPointerDown={e => e.stopPropagation()}>
        <div className="hd-pophead"
          onPointerDown={popDragStart} onPointerMove={popDragMove}
          onPointerUp={popDragEnd} onPointerCancel={popDragEnd}>
          <span className="hd-grip">⠿</span>
          <span>{title}</span>
          <button className="hd-x" onPointerDown={e => e.stopPropagation()}
            onClick={() => setPopup(null)}>✕</button>
        </div>
        {body}
      </div>
    );
  }

  /* ----- touch loupe ----- */
  function renderLoupe() {
    if (!loupe) return null;
    const a = popoutAnchor(loupe);
    if (!a) return null;
    const { lx, ty } = a;
    const R = 9;
    // the loupe floats centered ABOVE the finger so the hand never covers
    // it; it drops below only when the touch is close enough to the top
    // edge that it would clip, and hugs inward near the side edges
    const LOUPE = 118, GAP = 30;
    const fx = (lx / 100) * canvasW;
    const fy = (ty / 100) * canvasH;
    const below = fy < LOUPE + GAP + 6;
    const xShift = fx < LOUPE / 2 + 8 ? "0%" : canvasW - fx < LOUPE / 2 + 8 ? "-100%" : "-50%";
    // the loupe's scene rotates the same way as the main ice, so the
    // magnified view matches what's under the finger
    const loupeXf = rotated
      ? `rotate(90) translate(${R - loupe.x} ${-loupe.y - R})`
      : `translate(${R - loupe.x} ${R - loupe.y})`;
    return (
      <div className="hd-loupe" style={{
        left: `${lx}%`, top: `${ty}%`,
        transform: `translate(${xShift}, ${below ? `${GAP}px` : `calc(-100% - ${GAP}px)`})`,
      }}>
        <svg viewBox={`0 0 ${2 * R} ${2 * R}`}>
          <g transform={loupeXf}>
          <RinkMarkings />
          {pieces.map(p => {
            let prev = { x: p.x, y: p.y };
            return p.path.map((s, i) => {
              const d = segD(prev, s);
              const from = prev;
              prev = { x: s.x, y: s.y };
              const style = segStroke(p, s, i === p.path.length - 1);
              return p.kind === "player" && s.dir === "bwd"
                ? <polyline key={`${p.id}${i}`} points={zigzagPoints(from, s)} {...style} strokeLinejoin="round" />
                : <path key={`${p.id}${i}`} d={d} {...style} />;
            });
          })}
          {pieces.map(p => <g key={`ls${p.id}`}>{renderStops(p)}</g>)}
          {drawPreview && drawPreview.length > 1 && (
            <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")}
              fill="none" stroke="#ffd447" strokeWidth={0.6} strokeDasharray="1.4 1" opacity={0.9} />
          )}
          {selected && renderHandles(selected)}
          {selected && renderRotateHandle(selected)}
          {pieces.map(p => (
            <PieceIcon key={`lp${p.id}`} p={p} pos={displayPos(p)} selected={p.id === selectedId}
              dim={animT > 0} screenRot={screenRot} onDown={() => {}} />
          ))}
          <circle cx={loupe.x} cy={loupe.y} r={1.1} fill="none" stroke="#d7263d" strokeWidth={0.25} />
          <line x1={loupe.x - 2} y1={loupe.y} x2={loupe.x + 2} y2={loupe.y} stroke="#d7263d" strokeWidth={0.18} />
          <line x1={loupe.x} y1={loupe.y - 2} x2={loupe.x} y2={loupe.y + 2} stroke="#d7263d" strokeWidth={0.18} />
          </g>
        </svg>
      </div>
    );
  }

  const toolHint =
    tool === "draw"
      ? (selected ? `Drawing ${selected.id}'s route — drag across the ice` : "Drag on the ice — creates a player")
      : tool !== "select" ? "Tap the ice to place" : null;

  return (
    <div className="hd-root">
      <style>{`
        .hd-root { position:fixed; inset:0; background:#0c1014; color:#e8edf2; overflow:hidden;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
        /* the ice starts below the Dynamic Island / status bar and ends
           above the home-indicator band — iOS 26 standalone composites an
           opaque system bar there that web content cannot render under */
        .hd-stage { position:absolute; top:env(safe-area-inset-top, 0px);
          left:env(safe-area-inset-left, 0px); right:env(safe-area-inset-right, 0px);
          bottom:env(safe-area-inset-bottom, 0px); display:flex; align-items:center; justify-content:center; }
        .hd-canvas { position:relative; }
        .hd-canvas svg.hd-ice { width:100%; height:100%; display:block; }
        .hd-stage, .hd-canvas, .hd-canvas svg, .hd-canvas svg * { touch-action:none;
          -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
        /* floating controls */
        .hd-fab { position:absolute; z-index:40; width:46px; height:46px; border-radius:50%;
          background:rgba(23,29,37,.88); border:1px solid #33404f; color:#dbe4ec;
          font-size:18px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.45); backdrop-filter:blur(4px); }
        .hd-fab.on { background:#1f4fa3; border-color:#1f4fa3; }
        .hd-fab.draw-on { background:#b58900; border-color:#b58900; }
        .hd-fab.play { background:#d7263d; border-color:#d7263d; color:#fff; }
        .hd-fab small { font-size:10px; font-weight:800; letter-spacing:.05em; }
        /* top controls clear the Dynamic Island / status bar entirely:
           safe-area-inset-top pushes them below it in standalone mode,
           with a 10px floor when the browser manages the status bar */
        .hd-tl { top:max(10px, env(safe-area-inset-top)); left:calc(10px + env(safe-area-inset-left)); }
        .hd-tr { top:max(10px, env(safe-area-inset-top)); right:calc(10px + env(safe-area-inset-right)); }
        .hd-tr2 { top:max(10px, env(safe-area-inset-top)); right:calc(64px + env(safe-area-inset-right)); }
        .hd-bl { bottom:calc(10px + env(safe-area-inset-bottom)); left:calc(10px + env(safe-area-inset-left)); }
        .hd-br { bottom:calc(10px + env(safe-area-inset-bottom)); right:calc(10px + env(safe-area-inset-right)); }
        /* corner menus */
        .hd-menu { position:absolute; z-index:45; background:#1a222c; border:1px solid #33404f;
          border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5);
          display:flex; flex-direction:column; gap:8px; width:230px; max-height:70vh; overflow-y:auto; }
        .hd-menu.tl { top:calc(max(10px, env(safe-area-inset-top)) + 52px); left:calc(10px + env(safe-area-inset-left)); }
        .hd-menu.bl { bottom:calc(62px + env(safe-area-inset-bottom)); left:calc(10px + env(safe-area-inset-left)); }
        .hd-menu.br { bottom:calc(62px + env(safe-area-inset-bottom)); right:calc(10px + env(safe-area-inset-right)); }
        .hd-mh { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#8b99a8; }
        .hd-item { display:flex; align-items:center; gap:8px; padding:9px 10px; font-size:14px;
          border:1px solid #2c3846; background:#212b36; color:#dbe4ec; border-radius:8px;
          cursor:pointer; text-align:left; }
        .hd-item.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-note { font-size:11.5px; color:#7d8b99; line-height:1.5; }
        .hd-note code { color:#a8c3da; }
        /* hint pill */
        .hd-pill { position:absolute; z-index:35; left:50%; transform:translateX(-50%);
          bottom:calc(14px + env(safe-area-inset-bottom)); background:rgba(23,29,37,.9);
          border:1px solid #33404f; color:#dbe4ec; font-size:12.5px; padding:8px 14px;
          border-radius:999px; pointer-events:none; white-space:nowrap; }
        /* text sheet */
        .hd-sheet { position:absolute; inset:0; z-index:50; background:rgba(10,13,17,.96);
          display:flex; flex-direction:column; gap:10px; padding:16px;
          padding-top:calc(16px + env(safe-area-inset-top)); }
        .hd-ta { flex:1; min-height:120px; background:#0f141a; color:#cfe0ee; border:1px solid #2c3846;
          border-radius:8px; font-family:ui-monospace, monospace; font-size:12.5px; padding:8px; resize:none; }
        .hd-err { color:#ff8d9c; font-size:12px; white-space:pre-wrap; }
        .hd-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .hd-btn { padding:9px 16px; font-size:13.5px; font-weight:600; border:1px solid #2c3846;
          background:#1b232c; color:#e8edf2; border-radius:8px; cursor:pointer; min-height:40px; }
        .hd-btn.primary { background:#d7263d; border-color:#d7263d; }
        /* shared bits */
        .hd-swatch { width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
        .hd-swatch.on { border-color:#ffd447; }
        .hd-input { background:#0f141a; border:1px solid #2c3846; color:#e8edf2; border-radius:8px;
          padding:7px 9px; font-size:14px; }
        .hd-x { margin-left:auto; background:none; border:none; color:#8b99a8; cursor:pointer;
          font-size:16px; padding:2px 6px; }
        input[type=range] { accent-color:#d7263d; height:30px; }
        .hd-pop { position:absolute; z-index:20; width:220px; background:#1a222c; border:1px solid #33404f;
          border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5);
          display:flex; flex-direction:column; gap:8px; }
        .hd-pophead { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700;
          letter-spacing:.06em; text-transform:uppercase; color:#aab7c4;
          cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
          margin:-10px -12px 0; padding:10px 12px 6px; }
        .hd-pophead:active { cursor:grabbing; }
        .hd-grip { color:#5b6c7d; font-size:13px; letter-spacing:0; }
        .hd-poprow { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:12.5px; color:#cdd8e2; }
        .hd-mini { padding:6px 10px; font-size:12.5px; border:1px solid #2c3846; background:#212b36;
          color:#dbe4ec; border-radius:7px; cursor:pointer; min-height:34px; }
        .hd-mini.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-mini.danger { color:#ff8d9c; border-color:#4a2a30; }
        .hd-stepper { display:inline-flex; align-items:center; gap:2px;
          background:#0f141a; border:1px solid #2c3846; border-radius:7px; overflow:hidden; }
        .hd-stepper button { width:32px; min-height:32px; border:none; background:#212b36; color:#e8edf2;
          font-size:16px; cursor:pointer; }
        .hd-stepper span { min-width:44px; text-align:center; font-size:13px; font-variant-numeric:tabular-nums; }
        .hd-loupe { position:absolute; z-index:30; width:118px; height:118px; border-radius:50%;
          border:2px solid #3b4a5a; box-shadow:0 6px 18px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.6);
          overflow:hidden; pointer-events:none; background:#f5fafd; }
        .hd-loupe svg { width:100%; height:100%; display:block; }
      `}</style>

      {/* ---------- the ice, filling the screen ---------- */}
      <div className="hd-stage" ref={stageRef}>
        <div className="hd-canvas" style={{ width: canvasW, height: canvasH }}>
          <svg ref={svgRef} className="hd-ice"
            viewBox={rotated ? `0 0 ${vhF} ${vwF}` : vb(rink)}
            preserveAspectRatio="none"
            onPointerDown={onSvgDown} onPointerMove={onSvgMove}
            onPointerUp={onSvgUp} onPointerCancel={onSvgUp}>
            <defs>
              <clipPath id="boards"><rect x={0.5} y={0.5} width={199} height={84} rx={27.5} /></clipPath>
              {pieces.map(p => (
                <marker key={p.id} id={`arr-${p.id}`} viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={p.color} />
                </marker>
              ))}
            </defs>

            <g ref={sceneRef} transform={sceneTransform}>
            <RinkMarkings />

            {pieces.map(p => {
              let prev = { x: p.x, y: p.y };
              return p.path.map((s, i) => {
                const d = segD(prev, s);
                const from = prev;
                prev = { x: s.x, y: s.y };
                const isLast = i === p.path.length - 1;
                const style = segStroke(p, s, isLast);
                return (
                  <g key={`${p.id}/${i}`}>
                    <path d={d} fill="none" stroke="none"
                      ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />
                    {p.kind === "player" && s.dir === "bwd"
                      ? <polyline points={zigzagPoints(from, s)} {...style} strokeLinejoin="round" pointerEvents="none" />
                      : <path d={d} {...style} pointerEvents="none" />}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                      onPointerDown={e => lineDown(e, p.id, i)} style={{ cursor: "pointer" }} />
                  </g>
                );
              });
            })}

            {pieces.map(p => <g key={`s-${p.id}`}>{renderStops(p)}</g>)}

            {editing && pieces.map(p =>
              p.kind === "puck" && p.carrier && p.path.length > 0 ? (
                <circle key={`rel-${p.id}`} cx={p.x} cy={p.y} r={2.1} fill="none"
                  stroke="#14171a" strokeWidth={0.35} strokeDasharray="0.9 0.7"
                  opacity={0.6} pointerEvents="none" />
              ) : null
            )}

            {editing && (() => {
              const { plans } = getPlan();
              return pieces
                .filter(q => q.kind === "puck" && plans[q.id])
                .map(q => plans[q.id].legs
                  .filter(L => L.type === "fly")
                  .map((L, k) => (
                    <g key={`pf-${q.id}-${k}`} pointerEvents="none" opacity={0.6}>
                      <line x1={L.x0} y1={L.y0} x2={L.x1} y2={L.y1}
                        stroke="#14171a" strokeWidth={L.shot ? 1.1 : 0.55}
                        strokeDasharray={L.shot ? undefined : "2.4 1.8"} />
                      <circle cx={L.x1} cy={L.y1} r={1.1} fill="none"
                        stroke="#14171a" strokeWidth={0.3} />
                    </g>
                  )));
            })()}

            {drawPreview && drawPreview.length > 1 && (
              <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")}
                fill="none" stroke="#ffd447" strokeWidth={0.6} strokeDasharray="1.4 1" opacity={0.9} />
            )}

            {pieces.map(p => <g key={`h-${p.id}`}>{renderHandles(p)}</g>)}
            {selected && renderRotateHandle(selected)}

            {pieces.map(p => (
              <PieceIcon key={p.id} p={p} pos={displayPos(p)} selected={p.id === selectedId}
                dim={animT > 0} screenRot={screenRot} onDown={e => pieceDown(e, p.id)}
                onStickDown={editing && tool !== "draw" && p.kind === "player" && !p.path.length
                  ? e => stickDown(e, p) : undefined} />
            ))}
            </g>
          </svg>
          {renderPopout()}
          {renderLoupe()}
        </div>
      </div>

      {/* ---------- floating controls ---------- */}
      <button className={`hd-fab hd-tl${openMenu === "settings" ? " on" : ""}`}
        onClick={() => setOpenMenu(m => (m === "settings" ? null : "settings"))}>☰</button>

      <button className="hd-fab hd-tr play"
        onClick={() => { if (animT >= 1) resetAnim(); setPopup(null); setOpenMenu(null); setPlaying(p => !p); }}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button className="hd-fab hd-tr2" onClick={() => { setPlaying(false); resetAnim(); }}>⟲</button>

      <button className={`hd-fab hd-bl${openMenu === "rinkmenu" ? " on" : ""}`}
        onClick={() => setOpenMenu(m => (m === "rinkmenu" ? null : "rinkmenu"))}>
        <small>{rink === "full" ? "FULL" : rink === "half" ? "½" : "¼"}</small>
      </button>

      <button className={`hd-fab hd-br${tool === "draw" ? " draw-on" : openMenu === "tools" ? " on" : ""}`}
        onClick={() => setOpenMenu(m => (m === "tools" ? null : "tools"))}>✎</button>

      {toolHint && <div className="hd-pill">{toolHint}</div>}

      {/* ---------- menus ---------- */}
      {openMenu === "settings" && (
        <div className="hd-menu tl">
          <div className="hd-mh">Drill</div>
          <button className="hd-item" onClick={openText}>⌨ Text editor</button>
          <button className="hd-item" onClick={() => { exportTxt(); setOpenMenu(null); }}>⇩ Export .txt</button>
          <button className="hd-item" onClick={() => fileRef.current?.click()}>⇧ Load .txt</button>
          <div className="hd-mh" style={{ marginTop: 4 }}>Pace</div>
          <div style={{ fontSize: 12, color: "#8b99a8" }}>
            {pace} ft/s · run {totalTime.toFixed(1)}s
            <input type="range" min={6} max={30} step={1} value={pace} style={{ width: "100%" }}
              onChange={e => setPace(parseFloat(e.target.value))} />
          </div>
          <div className="hd-note">
            Tap a piece, route point, or line for its settings.
            Double-tap a line to add a point. Drag to move; touch drags show a magnifier.
          </div>
        </div>
      )}

      {openMenu === "rinkmenu" && (
        <div className="hd-menu bl">
          <div className="hd-mh">Ice surface</div>
          {["full", "half", "quarter"].map(m => (
            <button key={m} className={`hd-item${rink === m ? " on" : ""}`}
              onClick={() => { setRink(m); setOpenMenu(null); }}>
              {m === "full" ? "Full ice" : m === "half" ? "Half ice" : "Quarter sheet"}
            </button>
          ))}
        </div>
      )}

      {openMenu === "tools" && (
        <div className="hd-menu br">
          <div className="hd-mh">Add to the ice</div>
          <button className="hd-item" onClick={() => { setTool("player"); setOpenMenu(null); }}>⛹ Player</button>
          <button className="hd-item" onClick={() => { setTool("playerpuck"); setOpenMenu(null); }}>⛹● Player with puck</button>
          <button className="hd-item" onClick={() => { setTool("puck"); setOpenMenu(null); }}>● Puck</button>
          <button className="hd-item" onClick={() => { setTool("cone"); setOpenMenu(null); }}>▲ Cone</button>
          <button className="hd-item" onClick={() => { resetAnim(); setPlaying(false); setPopup(null); setTool("draw"); setOpenMenu(null); }}>
            ✎ Draw a route
          </button>
          {tool !== "select" && (
            <button className="hd-item" onClick={() => { setTool("select"); setOpenMenu(null); }}>✕ Cancel tool</button>
          )}
        </div>
      )}

      {openMenu === "text" && (
        <div className="hd-sheet">
          <div className="hd-mh">Drill text</div>
          <textarea className="hd-ta" value={textDraft} onChange={e => setTextDraft(e.target.value)} spellCheck={false} />
          {textError && <div className="hd-err">{textError}</div>}
          <div className="hd-row">
            <button className="hd-btn primary" onClick={applyText}>Apply</button>
            <button className="hd-btn" onClick={() => setOpenMenu(null)}>Close</button>
            <button className="hd-btn" onClick={exportTxt}>Export</button>
            <button className="hd-btn" onClick={() => fileRef.current?.click()}>Load</button>
          </div>
          <div className="hd-note">
            Feet: x 0–200, y 0–85. <b>RINK</b> full|half|quarter ·
            <b> PIECE</b> id player|puck|cone x y [#color] [label] [speed=1.2] [hand=L] [on=F1] ·
            <b> PATH</b> id segments (<b>L</b> x,y · <b>Q</b> cx,cy x,y · <b>C</b> c1x,c1y c2x,c2y x,y).
            Modifiers before a segment: <b>PASS</b>/<b>SHOT</b>, <b>BWD</b>, <b>STOP n</b>, <b>RATE n</b>.
            <code> on=F1</code> rides that player's blade until the carrier reaches the puck's spot.
            <code> pass=2:F2@3</code> passes at the carrier's point 2 to F2, received at F2's
            point 3 — the receiver's pace auto-syncs (omit <code>@3</code> to lead them instead).
            <code> shoot=4</code> fires at the nearest net when the final carrier reaches point 4.
            <code> face=45</code> sets a stationary player's heading (degrees).
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={importTxt} />
    </div>
  );
}
