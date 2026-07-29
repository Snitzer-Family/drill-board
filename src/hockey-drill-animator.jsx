import { useState, useRef, useEffect, useLayoutEffect, useMemo, Fragment } from "react";
import { VIEWS, isQuarter, COLORS, vb, APP_VERSION, ICON_SCALE, PLAYER_SCALE, ROUTE_START_GAP, BUILD_STAMP, DEFAULT_TEXT, SPEED,
  SAVE_PROB, MISS_POST, MISS_WIDE, MISS_OVER, SHOT_AIR_PROB, BOUNCE_REST, WB_SYMS, symOf,
  DSL_VERSION, TYPEFACES, TYPEFACE_KEY, READ_PACES, READ_PACE_DEFAULT, captionHold, ACT_GAP, ACT_R } from "./constants.js";
import { parseDrill, serializeDrill, extractDrill, deriveInventory, ensureShotNet } from "./drill-format.js";
import { prepareImage, drillFromImage, ANTHROPIC_KEY_STORE } from "./drill-vision.js";
import { drillSvg } from "./drill-svg.js";
import { mdEscape, mdInline, mdBlock } from "./md.js";
import { clampX, clampY, fitInside, segEnd, segD, nearestT, splitSeg, zigzagPoints, wigglePoints, wigglePoly, zigzagPoly, convertSeg, fitRoute, evalSeg, rdp, catmullToBezier, alignJoint, mirrorJoint, translateJointHandles, trimSegStart, trimSegEnd, trimPolyStart, trimPolyEnd, gapPolyAt } from "./geometry.js";
import { dirOf, dirAtWaypoint, spreadDir } from "./route-dir.js";
import * as boards from "./boards.js";
import { netShapes, bumperShapes, solidShapes, detourRoute, segCrossesNet } from "./net-collide.js";
import { RinkMarkings } from "./rink.jsx";
import { ZONES, zoneAt } from "./zones.js";
import { PieceIcon, Stepper, DiagPanel, Icon, ICONS } from "./icons.jsx";
import { createTiming, resolveNearest } from "./timing.js";
import { buildLedger, mayHoldOn, mayHoldEntering, orderTransfers } from "./possession.js";
import { classifyPenGroup, SYMBOL_MAX, SYMBOL_MAX_PX } from "./sketch-recognize.js";
import { newGame, stepGame } from "./ai-game.js";
import { STYLES } from "./styles.js";
import { THEME_KEY, THEME_ATTR, THEME_ORDER, THEME_LABEL, resolveTheme, tokens, teamInk } from "./theme.js";
import { ThemeCtx, InkCtx } from "./theme-react.jsx";
import { PrefPick, PrefSample } from "./pref-preview.jsx";
import { SAVE_KEY, peekBackup, clearBackup } from "./storage.js";

// Pen inks. These double as PIECE colours — a symbol you draw becomes a player
// in the ink you drew it with — so they're the team colours plus the classic
// yellow whiteboard marker. No white: it vanishes on the ice.
const PEN_INKS = ["#ffd447", "#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#7a3fa8", "#111318"];
// the line kinds a mark can be drawn in. One list — the pen palette and the
// marker's settings both offer them, and they used to be written out twice.
const PEN_STYLES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]];

// the add-tool buttons show the SAME vector sprite the piece uses on the ice.
// Each kind renders a mini PieceIcon in a viewBox tight to its body (raw icon
// units, since we pass a scale-1 frame) so it fills the tile.
const TOOL_GLYPH = {
  player: { vb: "-4.4 -4 10.6 8", color: "#d7263d" },
  puck: { vb: "-2 -2 4 4", color: "#14171a" },
  cone: { vb: "-2.7 -2.9 5.4 5.2", color: "#e0731d" },
  net: { vb: "-4.7 -4.3 5.7 8.6", color: "#c81e33" },
  bumper: { vb: "-8.4 -2.4 16.8 4.8", color: "#1b1e22" },
  deker: { vb: "-4.1 -1.9 8.4 4.6", color: "#c79a4e" },
  passer: { vb: "-2.3 -3.2 4.6 6.4", color: "#57636f" },
  tire: { vb: "-3.3 -3.3 6.6 6.6", color: "#1c1c1e" },
  stick: { vb: "-6.4 -2.4 13.4 4.8", color: "#8a929c" },
  light: { vb: "-3.7 -3.7 7.4 7.4", color: "#2ea043" },
};
// What stays drawn on the ice once the drill is running. Two independent
// things — the skaters' routes and the puck's passes/shots — so the four modes
// are just their combinations. The stored names are the original three plus
// "puck"; keeping them means a session that already chose one still resolves.
const ROUTE_VIS = [
  ["hide", "None", "nothing — just the skaters moving"],
  ["puck", "Puck", "the puck's passes and shots only"],
  ["player", "Skaters", "the skating routes only"],
  ["all", "Both", "skating routes and the puck's path"],
];
const routeVis = m => ({ skaters: m === "player" || m === "all", puck: m === "puck" || m === "all" });

// What the Smart pen does with a stroke. One row per state: the stored value,
// the bar's label, its glyph, and — the point of the table — a plain sentence
// about the NEXT stroke. That sentence is the tooltip, the hint over the ice
// and the line on the bar, so those three can never drift apart.
const PEN_READ = [
  ["sketch", "Sketch", "pencil", "Ink stays exactly as you drew it."],
  ["manual", "Manual", "wand", "Ink waits until you tap Convert."],
  ["auto", "Auto", "brain", "Every stroke is read as you draw."],
];
const penReadRow = v => PEN_READ.find(([k]) => k === v) || PEN_READ[2];

// How fast the whole drill runs, as a multiple of the base skating pace. This
// is the SAME value the old "Drill pace" slider set in ft/s — it just belongs
// on the transport, because slowing a drill down is something you do WHILE
// showing it ("watch the give-and-go again, half speed"), not something you set
// once in a menu. Expressed as a multiple rather than ft/s: at the bench you
// think "slower", not "eleven feet per second".
const BASE_PACE = 15;                      // ft/s at 1× — the long-standing default
const PLAY_SPEEDS = [
  [0.5, "½×", "half speed — for walking through a pattern"],
  [1, "1×", "normal drill pace"],
  [1.5, "1½×", "quick — shows the flow"],
  [2, "2×", "double speed"],
];

/* ---- settings rows -------------------------------------------------------
   Every preference reads the same way: what it's called, a line saying what it
   actually does (and what OFF means, which is the part that was missing), then
   the control. Most of these are things you set once and forget, several change
   how the SIMULATION behaves rather than how it looks, and the old panel gave
   them a bare toggle label and a fragment of a hint — you had to already know
   what "Tidy arrowheads" or "Preview all branches" meant to use them.

   A toggle is the whole row, not just the switch: a 44px-tall target beats a
   30px one on a bench phone, and the description is part of what you're
   pressing. Rows with a stepper, slider or pills can't be one button (a button
   can't contain buttons), so those put the control beside the title or under
   the description.

   A third shape now sits alongside these: the rows whose effect is a PICTURE
   render each option as a small live board and make the board the control
   (PrefPick, in pref-preview.jsx). Those give up the whole-row target for the
   same buttons-in-buttons reason — but each tile is its own target and larger
   than the switch it replaced, so nothing got harder to hit. What is left here
   is the settings a picture cannot show: timings, odds, and the ones that
   change how the SIMULATION behaves rather than how it looks. */
const PrefToggle = ({ title, desc, on, set, dim }) => (
  <button className={`hd-pref toggle${dim ? " dim" : ""}`} role="switch" aria-checked={on}
    onClick={() => set(v => !v)}>
    <span className="hd-prefhead">
      <span className="hd-preftitle">{title}</span>
      <span className={`hd-sw${on ? " on" : ""}`} />
    </span>
    <span className="hd-prefdesc">{desc}</span>
  </button>
);
const PrefRow = ({ title, desc, control, children, dim }) => (
  <div className={`hd-pref${dim ? " dim" : ""}`}>
    <div className="hd-prefhead">
      <span className="hd-preftitle">{title}</span>
      {control}
    </div>
    {desc && <div className="hd-prefdesc">{desc}</div>}
    {children && <div className="hd-prefctl">{children}</div>}
  </div>
);
const Pills = ({ value, opts, set }) => (
  <div className="hd-pills">
    {opts.map(([v, lab]) => (
      <button key={v} className={`hd-mini${value === v ? " on" : ""}`}
        aria-pressed={value === v} onClick={() => set(v)}>{lab}</button>
    ))}
  </div>
);

// the interchangeable on-ice training tools: any one can be swapped for
// another from its popup ("Change to" row) without re-placing it
const TOOL_KINDS = ["cone", "tire", "bumper", "deker", "passer", "stick", "light"];
// Everything you can put on the ice, in three groups. ONE table, because the
// same set is offered from three places — the Edit bar, its group popovers, and
// the double-tap "Add here" popup — and it used to be written out twice, which
// is how the quick-add popup and the Add sheet drifted apart.
//   main  — what a drill is made of; earns a permanent slot on the bar
//   props — training gear; a group popover unless the screen is wide
//   marks — annotation, not equipment
// `k` is the tool/kind name; a `glyph` renders an Icon instead of a piece sprite.
const ADD_GROUPS = [
  { key: "main", label: "Players", tip: "Players, pucks and nets", icon: "player", kinds: [
    ["player", "Player"], ["playerpuck", "+ Puck"], ["puck", "Puck"], ["net", "Net"]] },
  { key: "props", label: "Props", tip: "Cones, tires and training gear", icon: "grid", kinds: [
    ["cone", "Cone"], ["tire", "Tire"], ["bumper", "Bumper"], ["deker", "Deker"],
    ["passer", "Passer"], ["stick", "Stick"], ["light", "Light"]] },
  { key: "marks", label: "Shapes", tip: "Zone shapes, freehand marker and text labels", icon: "shapes", kinds: [
    ["marker", "Marker", "marker"], ["square", "Square", "□"], ["circle", "Circle", "○"],
    ["triangle", "Triangle", "△"], ["label", "Label", "label"]] },
];
// the shapes are added straight to the board rather than arming a tool
const SHAPE_KINDS = new Set(["square", "circle", "triangle"]);
// the creation-time default colour for each piece kind (players cycle COLORS,
// so their pick is passed in); also re-applied when a tool is swapped kinds
const defaultColor = (kind, playerColor) =>
  kind === "player" ? playerColor : kind === "cone" ? "#e0731d" : kind === "net" ? "#c81e33"
    : kind === "bumper" ? "#1b1e22" : kind === "deker" ? "#c79a4e" : kind === "passer" ? "#57636f"
    : kind === "label" ? "#14202b" : kind === "tire" ? "#1c1c1e" : kind === "light" ? "#2ea043"
    // stick is spelled out rather than left to the fallback: drill-format.js has
    // its own copy of this table and defaults a stick to #20242a, so the two
    // silently disagreed depending on whether a board was placed or loaded.
    // tests/theme-contrast.mjs now pins the two tables together.
    : kind === "stick" ? "#20242a" : "#14171a";
const toolImg = (kind, wb = false, wbCircle = false) => {
  const k = kind === "playerpuck" ? "player" : kind;
  const g = TOOL_GLYPH[k];
  if (!g) return null;
  const p = { kind: k, color: g.color, label: "", facing: 0, hand: "R", size: 1, path: [] };
  // whiteboard players draw as the X/O symbol, which is centred — swap the viewBox
  const vb = wb && k === "player" ? "-4 -4 8 8" : g.vb;
  return (
    <svg className="hd-toolimg" viewBox={vb} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <PieceIcon p={p} pos={{ x: 0, y: 0, a: 0 }} xf="translate(0 0)" thDeg={0}
        wb={wb} wbCircle={wbCircle} onDown={() => {}} />
    </svg>
  );
};

// Split a detoured route polyline into per-leg spans, cutting at each waypoint's
// nearest point on the line, so every leg keeps its OWN zigzag/wiggle/plain
// styling when a detour collapses the route into one polyline (a mixed
// fwd/bwd route must not flatten to a single plain line).
function polyLegSpans(poly, path) {
  if (poly.length < 2 || path.length < 2) return [{ pts: poly, leg: Math.max(0, path.length - 1) }];
  const paramOf = pt => {          // fractional vertex index of the closest point
    let best = 0, bd = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const ax = poly[i].x, ay = poly[i].y, vx = poly[i + 1].x - ax, vy = poly[i + 1].y - ay;
      const L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - ax) * vx + (pt.y - ay) * vy) / L2));
      const dxq = pt.x - (ax + vx * t), dyq = pt.y - (ay + vy * t);
      const d = dxq * dxq + dyq * dyq;
      if (d < bd) { bd = d; best = i + t; }
    }
    return best;
  };
  const pointAt = u => {
    const i = Math.min(poly.length - 2, Math.floor(u)), t = u - i;
    return { x: poly[i].x + (poly[i + 1].x - poly[i].x) * t, y: poly[i].y + (poly[i + 1].y - poly[i].y) * t };
  };
  const cuts = path.slice(0, -1).map(s => paramOf({ x: s.x, y: s.y }));
  for (let i = 1; i < cuts.length; i++) cuts[i] = Math.max(cuts[i], cuts[i - 1]);   // a detour can fold back — keep cuts monotone
  const spans = [];
  let u0 = 0;
  for (let leg = 0; leg < path.length; leg++) {
    const u1 = leg < cuts.length ? cuts[leg] : poly.length - 1;
    if (u1 - u0 > 1e-6) {
      const pts = [pointAt(u0)];
      for (let i = Math.floor(u0) + 1; i <= Math.floor(u1) && i < poly.length; i++)
        if (i - u0 > 1e-6) pts.push(poly[i]);
      const pe = pointAt(u1), lp = pts[pts.length - 1];
      if (Math.hypot(pe.x - lp.x, pe.y - lp.y) > 1e-6) pts.push(pe);
      if (pts.length > 1) spans.push({ pts, leg });
    }
    u0 = u1;
  }
  return spans.length ? spans : [{ pts: poly, leg: path.length - 1 }];
}

// swatch palette for on-ice text labels (dark ink first — labels sit on light ice)
const LABEL_COLORS = ["#14202b", "#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#7a3fa8"];
// label background / border palettes (default first: paper for bg, faint ink for border)
const LABEL_BG_COLORS = ["#f6fbfd", "#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#14202b"];
const LABEL_BORDER_COLORS = ["#14202b", "#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#f6fbfd"];

// cue colours a cognitive-training light can show (its screen fills with one)
const LIGHT_COLORS = ["#2ea043", "#e5342b", "#2f6df6", "#f5c518", "#8a3ffc", "#f2f5f8"];

// small deterministic string hash → int (for per-run cue seeding)
const hashInt = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
// avalanche finalizer — hashInt alone is near-monotonic for CONSECUTIVE inputs (so
// bumping playSeed by 1 each run barely changes the low bits), which makes a "random"
// pick ramp slowly instead of scatter. Mix the bits so successive seeds land far apart.
const mix32 = h => { h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; };
// a deterministic shuffle of [0..n) from a seed (seeded Fisher-Yates). The seed is
// avalanched first: callers key on hashInt(...playSeed) which is near-monotonic for
// consecutive runs, and the raw LCG barely diverges from adjacent seeds — without
// mix32 a 2-cue light would show the SAME first colour on almost every replay.
function shuffleOrder(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = (mix32(seed | 0) | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// the colour a cue timeline is showing at absolute time t (seconds).
//  seed === null → the authored sequence, played once, holding the last colour.
//  seed a number → REACTIVE mode: the cue order is shuffled each cycle and looped
//    forever (seeded per run), so a "read the light" reaction stays unpredictable.
function cueColorAt(cues, t, seed = null) {
  if (!cues || !cues.length) return null;
  const n = cues.length, dur = k => Math.max(0.1, cues[k].dur || 0);
  if (seed === null) {
    let acc = 0;
    for (let k = 0; k < n; k++) { acc += dur(k); if (t < acc) return cues[k].color; }
    return cues[n - 1].color;
  }
  const total = cues.reduce((a, _, k) => a + dur(k), 0);
  const tt = Math.max(0, t), cyc = Math.floor(tt / total), local = tt - cyc * total;
  const order = shuffleOrder(n, (seed | 0) + cyc * 2654435761);   // reshuffle each cycle
  let acc = 0;
  for (let k = 0; k < n; k++) { acc += dur(order[k]); if (local < acc) return cues[order[k]].color; }
  return cues[order[n - 1]].color;
}
const sameColor = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
// the empty resolved trigger→effect state (routes/reach/possession/releases). Module
// scope so resolveForks — a hoisted fn called high in the render (effPieces) — can read
// it without hitting a const temporal-dead-zone. Never mutated in place, only replaced.
const EMPTY_SOLVED = { routes: {}, reach: {}, reachT: {}, poss: {}, released: {}, heldWin: {}, releasedT: {} };

// chip / hard-rim release handle sits this many times CLOSER than the puck's
// actual travel, so a small drag near the player controls a long release
const REL_MULT = 2.5;

// player ids that RELEASE a puck somewhere (pass / chip / rim / shot) — the
// candidates an Action delay trigger can fire on. A holder releases if it passes
// the chain onward, or is the last holder and does the terminal action.
function puckActors(pieces) {
  const players = new Set(pieces.filter(p => p.kind === "player").map(p => p.id));
  const out = new Set();
  pieces.forEach(pk => {
    if (pk.kind !== "puck") return;
    const head = pk.carrier || (pk.pickup && pk.pickup.to);
    const seq = head ? [head, ...(pk.transfers || []).map(t => t.to)] : (pk.transfers || []).map(t => t.to);
    const nTrans = (pk.transfers || []).length;
    const hasTerm = (pk.terminals || []).length > 0;
    seq.forEach((id, k) => { if ((k < nTrans || (k === nTrans && hasTerm)) && players.has(id)) out.add(id); });
  });
  return out;
}

// A reusable "Delay trigger" control shown under both players (delay the whole
// route) and waypoints (pause mid-route). Three trigger types:
//   timer    — wait a fixed number of seconds
//   waypoint — wait until another player REACHES a chosen waypoint (arrival)
//   action   — wait until another player RELEASES the puck (pass/chip/rim/shot)
// `value` is normalized { mode, secs, on, at }; `onChange` gets the same shape.
// `players` = every eligible trigger player (self excluded); `actorIds` = the
// subset that release a puck (for Action mode).
function DelayTrigger({ value, onChange, sub, players, actorIds, nameOf }) {
  // mode is UI-local so switching to a type with no candidates still shows its
  // hint; storage (via onChange) follows once a real trigger is chosen. Default
  // is "None" (no delay): the parent passes {mode:"timer", secs:0} when nothing
  // is set, so infer None from an empty trigger + zero timer.
  const [uiMode, setUiMode] = useState(value.on ? (value.mode || "waypoint") : (value.secs ? "timer" : "none"));
  const mode = uiMode;
  const wpPlayers = players.filter(q => q.path && q.path.length > 0);
  const actPlayers = players.filter(q => actorIds.has(q.id));
  const trig = value.on ? players.find(q => q.id === value.on) : null;

  const pickMode = m => {
    setUiMode(m);
    if (m === "none") { onChange({ mode: "none" }); return; }
    if (m === "timer") { onChange({ mode: "timer", secs: value.secs || 0 }); return; }
    const pool = m === "action" ? actPlayers : wpPlayers;
    const on = (value.on && pool.some(q => q.id === value.on)) ? value.on : (pool[0] && pool[0].id) || null;
    if (!on) return;                                     // empty pool → show the hint, leave storage
    const tp = pool.find(q => q.id === on);
    const at = m === "action" ? null : (tp ? Math.max(0, tp.path.length - 1) : -1);
    onChange({ mode: m, on, at });
  };
  const setOn = id => {
    const tp = players.find(q => q.id === id);
    const at = mode === "action" ? null : Math.max(0, ((tp && tp.path.length) || 1) - 1);
    onChange({ ...value, mode, on: id, at });
  };
  const hint = t => <div className="hd-poprow"><span className="hd-sechint">{t}</span></div>;
  const wpSelect = () => (
    <select className="hd-select on" value={value.at == null ? -1 : value.at}
      onChange={e => onChange({ ...value, at: parseInt(e.target.value, 10) })} disabled={!trig}>
      <option value={-1}>start</option>
      {trig && trig.path.map((s, wi) => <option key={wi} value={wi}>{wi + 1}</option>)}
    </select>
  );

  return (
    <div className="hd-field">
      <div className="hd-sectitle">Delay trigger</div>
      <div className="hd-sechint">{sub} until a timer, a teammate’s arrival, or their puck action.</div>
      <div className="hd-poprow">
        {[["none", "None"], ["timer", "Timer"], ["waypoint", "Point"], ["action", "Action"]].map(([m, lab]) => (
          <button key={m} className={`hd-mini${mode === m ? " on" : ""}`} onClick={() => pickMode(m)}>{lab}</button>
        ))}
      </div>
      {mode === "timer" && (
        <div className="hd-poprow">
          <span>{sub} for</span>
          <Stepper value={value.secs || 0} onChange={v => onChange({ mode: "timer", secs: v })} />
          <span className="hd-sechint">seconds</span>
        </div>
      )}
      {mode === "waypoint" && (wpPlayers.length ? (
        <div className="hd-poprow">
          <span>until</span>
          <select className="hd-select on" value={value.on || ""} onChange={e => setOn(e.target.value)}>
            {!value.on && <option value="" disabled>— player —</option>}
            {wpPlayers.map(o => <option key={o.id} value={o.id}>{nameOf(o.id)}</option>)}
          </select>
          <span>reaches</span>
          {wpSelect()}
        </div>
      ) : hint("Add another player with a route to trigger off."))}
      {mode === "action" && (actPlayers.length ? (
        <div className="hd-poprow">
          <span>until</span>
          <select className="hd-select on" value={value.on || ""} onChange={e => setOn(e.target.value)}>
            {!value.on && <option value="" disabled>— player —</option>}
            {actPlayers.map(o => <option key={o.id} value={o.id}>{nameOf(o.id)}</option>)}
          </select>
          <span>releases at</span>
          <select className="hd-select on" value={value.at == null ? "any" : value.at}
            onChange={e => onChange({ ...value, at: e.target.value === "any" ? null : parseInt(e.target.value, 10) })}>
            <option value="any">Any action</option>
            {trig && trig.path.map((s, wi) => <option key={wi} value={wi}>{wi + 1}</option>)}
          </select>
        </div>
      ) : hint("No player releases a puck yet (add a pass, shot, rim, or chip)."))}
    </div>
  );
}

/* ============================================================
   HOCKEY DRILL ANIMATOR — v5 (full-screen ice)
   Coordinates: real feet. x 0..200 (goal line to goal line),
   y 0..85 (board to board).

   Text format (one command per line, # = comment):
     RINK full|half|quarter-tl|quarter-tr|quarter-bl|quarter-br
     PIECE <id> <player|puck|cone> <x> <y> [#color] [label] [speed=1.2] [hand=L] [on=F1]
     PATH  <id> <segments...>
   Segments (rink feet):
     L x,y | Q cx,cy x,y | C c1x,c1y c2x,c2y x,y
   Modifier words BEFORE a segment apply to that segment only:
     PASS / SHOT / CARRY   puck speed class (3x / 6x / 1x)
     BWD / FWD             skating direction (BWD draws zigzag)
     TURN left|right|player|puck   which way they pivot when the direction reverses
     STOP <sec>            hold at this leg's START point
     WAIT <player> <pt>    hold until that player REACHES <pt>
     WACT <player> <pt>    hold until that player RELEASES the puck at <pt> (0 = any action)
     RATE <mult>           speed multiplier for this leg
     JOIN smooth|sym       link this waypoint's curve handles
     ENDSTOP               end the route in a ‖ stop mark (player)
   JOIN links the two bézier handles meeting at a waypoint so
   editing keeps them collinear (smooth) or collinear + equal
   length (sym); omitted = a corner with independent handles.
   hand=L mirrors the player's stick. on=F1 puts a puck on that
   player's blade; it releases when the carrier reaches the
   puck's placed spot, then runs its own route.
   pass=<pt>:<player>[@<pt>] hands the puck off: it launches at
   the carrier's route point and flies to the named player. With
   @pt the receiver's pace auto-syncs to arrive at their point
   exactly as the puck does; without it the puck leads them.
   shoot=<pt> fires a terminal shot at the net when the carrier
   reaches that route point; it caroms off and glides to rest in
   the slot. net=left|right forces which net (else nearest).
   rebound=<pt>:<player>[@<pt>] is a shot handed off: the carrier
   shoots at their <pt>, the carom rolls to <player> who collects
   it (at their @<pt>, else route end / where they stand) and
   carries on — so pass=/rebound=/shoot= all resume normally from
   the collector. pass= and rebound= apply in the order written.
   A trailing &f/&b on any release (pass=/rebound=/shoot=/rim=/
   chip=) forces the forehand or the backhand; absent = whichever
   side the target is already on.
   pickup=<player>@<pt> starts a loose puck: it sits (or runs
   its own route) until that player reaches the waypoint, then
   hops onto their blade. A player with no route picks up when the
   loose puck's own path reaches them (or at once).
   STEP at=<sec> "text"  or  STEP on=<id>:<pt> "text" — a
   presentation caption anchored to an absolute time or a
   player's waypoint activation; play pauses on each in
   Presentation mode. Authored via scrub → pause → ＋ note,
   then dragged clear of the action (optional pos=x:y).

   UI: the rink fills the screen. Corner controls: ☰ settings
   (text/export/load/pace), rink size, tools (+pieces / draw),
   play/reset. Tap pieces/points/lines for on-ice popouts;
   drag to move; touch drags show a magnifier loupe.
   ============================================================ */

// SAVE_KEY lives in storage.js: main.jsx's crash boundary needs the same key,
// and it renders outside this component so it can't reach a const in here.
const WB_KEY = "drillboard:whiteboard";   // whiteboard-mode view pref, persisted on its own
const WBC_KEY = "drillboard:whiteboard-circle";   // circled X/O symbols sub-pref
const WBN_KEY = "drillboard:whiteboard-names";    // always-on player name tags sub-pref
const HALFNS_KEY = "drillboard:half-ns";  // half-ice shown north-south (vertical)
const HALFFLIP_KEY = "drillboard:half-flip";  // half-ice net at the far end (left / top)
const STRETCH_KEY = "drillboard:stretch-fill";  // full ice stretches to fill the screen
const PRESS_KEY = "drillboard:pencil-pressure";  // Apple Pencil pressure → line weight
const HAND_KEY = "drillboard:hand";  // which side the chrome's controls sit on
const LINE_KEY = "drillboard:line-scale";    // route/arrow/mark thickness multiplier
const MARK_KEY = "drillboard:mark-opacity";  // how solid the drawn markings are
const RINKDIM_KEY = "drillboard:rink-dim";   // how strongly the rink markings are drawn
// The icon discs at a pass / shoot / pickup. Whiteboard mode has always dropped
// them; this is the same look without going full whiteboard. Key name and flag
// match the unmerged commit on the sibling worktree branch that first added it,
// so the two converge instead of colliding.
const ACTC_KEY = "drillboard:action-circles";
// ...and the range each is allowed, declared ONCE because it is read twice: the
// control clamps to it and the stored value is validated against it. Two copies
// and raising a stepper's max would leave the new top of the range unloadable —
// stored fine, silently reset to the default on the next launch.
// ...the rink floor is 0.2 rather than 0.1: the markings are what tell you WHICH
// rink you are looking at, and past about a fifth they stop being faint and
// start being gone.
const LINE_RANGE = [0.5, 3], MARK_RANGE = [0.1, 1], RINKDIM_RANGE = [0.2, 1];
// A stored NUMBER pref. The boolean prefs can treat any junk as false, but junk
// here is worse than wrong: NaN in the line scale multiplies every route width
// to nothing and blanks the board. So anything unparseable, or outside the range
// the control itself offers, falls back to the default rather than being trusted.
const numPref = (key, dflt, [min, max]) => {
  try {
    const n = parseFloat(localStorage.getItem(key));
    return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
  } catch { return dflt; }   // private mode throws on access
};
// The ONE width breakpoint in the app. Above it the action bar lays its groups
// out inline and the corner menus centre on the button that opened them; below,
// the bar collapses groups into popovers and the stylesheet stretches the menus
// to the screen edges instead. Keeping both on the same number means a device
// changes personality exactly once as it rotates, which is the whole reason the
// pen palette and the menus already shared 700.
const DENSE_MIN = 700;
// ...and one tier above it, for the Edit palette only. At DENSE_MIN the props
// come out onto the bar; the five shape tools need ~204px more than the popover
// button they replace, and the standing hint has to survive that. The hint
// measures 130px at 768 today, so that is the floor worth keeping: 980 would
// leave it 116px — narrower than what already ships — and 1000 leaves 136px.
// It lands where it should either way: every iPad in LANDSCAPE (1024-1194)
// opens the shapes out, while a portrait iPad (768-834) keeps them grouped,
// because there genuinely isn't room. Measured, not guessed.
const ROOMY_MIN = 1000;
// Corner-menu anchoring. MENU_W must equal --hd-menu-w in styles.js (asserted by
// tests/theme-contrast.mjs) — the panel is sized by CSS but centred by JS, so a
// mismatch silently offsets every menu by half the difference. Below
// MENU_ANCHOR_MIN the stylesheet stretches the panel instead and JS stands down.
const MENU_W = 230, MENU_PAD = 10, MENU_ANCHOR_MIN = DENSE_MIN;
// The four quarter sheets, in reading order — which is also the order the 2x2
// pad lays them out, so the grid mirrors the rink. [rink token, pad label, bar
// label]. One table: the pad and the bar's label both read it.
const QUARTERS = [
  ["quarter-tl", "Top left", "¼ TL"],
  ["quarter-tr", "Top right", "¼ TR"],
  ["quarter-bl", "Bottom left", "¼ BL"],
  ["quarter-br", "Bottom right", "¼ BR"],
];
// THEME_KEY ("drillboard:theme") lives in theme.js — the pre-paint boot script
// in index.html reads the same constant, and they must not drift.

export default function DrillAnimator() {
  // a shared drill link (#d=<url-safe base64 DSL> — the preview-link format from
  // previewLink()) boots straight into that drill. It wins over the autosave, and
  // (see the auto-save effect) doesn't overwrite the saved board until you edit.
  // a malformed link falls through to autosave/demo, but the recipient is TOLD
  // (linkBad → boot toast) instead of silently seeing the wrong drill
  let linkBad = false;
  const linkDrill = (() => {
    try {
      const h = typeof window !== "undefined" ? window.location.hash : "";
      const m = /[#&]d=([^&]+)/.exec(h || "");
      if (!m) return null;
      const dsl = decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))));
      const r = parseDrill(dsl);
      if (r.errors.length) { linkBad = true; return null; }
      return r;
    } catch { linkBad = true; return null; }
  })();
  // boot from a link, else the last auto-saved board, else the built-in demo
  const init = linkDrill || (() => {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) { const r = parseDrill(saved); if (!r.errors.length) return r; }
    } catch { /* private mode / disabled storage → fall back to the demo */ }
    return parseDrill(DEFAULT_TEXT);
  })();
  const [rink, setRink] = useState(init.rink);
  const [pieces, setPieces] = useState(init.pieces);
  const [selectedId, setSelectedId] = useState(null);
  const [multiSel, setMultiSel] = useState(null);  // Set<id> from a box-select, or null
  const [marquee, setMarquee] = useState(null);    // {x0,y0,x1,y1} while dragging a box
  const [groupInput, setGroupInput] = useState(null);   // pending group-name text while naming, or null
  const [popup, setPopup] = useState(null);
  // what the Edit bar should offer after a DRAG that didn't (re)open the popup —
  // {type:"point", id, seg, fork?} for a moved waypoint. The bar reads this only
  // when popup is absent, so a dragged point loads its own actions (Delete hits
  // just that point) even though no inspector panel appeared. Guarded by id, so a
  // stale descriptor from one piece never leaks onto another's strip.
  const [dragSel, setDragSel] = useState(null);
  const [tool, setTool] = useState("select");
  // freehand marker (annotation) settings, remembered between strokes
  const [markColor, setMarkColor] = useState("#111318");   // black ink by default
  const [markWidth, setMarkWidth] = useState(1.1);   // rink feet
  const [markStyle, setMarkStyle] = useState("solid"); // solid | dashed | dotted | wavy
  const [markEdit, setMarkEdit] = useState(false);   // show draggable control points on the selected mark
  useEffect(() => { setMarkEdit(false); }, [selectedId]);   // leaving a mark exits point-edit mode
  const markerDraw = useRef(false);
  // smart pen: strokes buffer until a settle pause, then the burst is
  // recognized locally (sketch-recognize.js) and materialized as real pieces
  const PEN_SETTLE = 1000;            // ms of stillness before a burst commits
                                      // (a finger takes a beat between an X's strokes)
  const penDraw = useRef(false);      // {t0} while a pen stroke is in flight
  const penBuf = useRef([]);          // settled strokes awaiting commit [{pts,t0,t1}]
  const penTimer = useRef(0);
  const penScale = useRef({ x: 0, y: 0 });   // rink ft per screen px per axis, per burst
  // where the nib is, so a reticle can sit under the finger/Pencil showing the
  // exact footprint about to be laid down (a fingertip hides its own contact
  // point, and a Pencil tip is finer than the line it draws)
  const [penTip, setPenTip] = useState(null);
  // ink fidelity in SCREEN terms: capture spacing and the control-point
  // simplifier were fixed rink-feet, so on a big iPad 1.3ft ≈ 12px crushed a
  // drawn circle into a 4-point blob (which then smoothed into a lumpy shape —
  // the "mangling"). Both now track the view, with a feet floor for safety.
  // Note ink is handwriting: it keeps far more of what was drawn. The sampling
  // and simplification that suit a swooping route destroy small letters — a 4px
  // tolerance is wider than the strokes of the letters themselves.
  const inkStepFt = sketch => Math.max(sketch ? 0.1 : 0.25,
    (sketch ? 1 : 2.5) * Math.min(penScale.current.x || 1.1, penScale.current.y || 1.1));
  const inkEpsFt = sketch => Math.max(sketch ? 0.12 : 0.3,
    (sketch ? 0.8 : 4) * Math.min(penScale.current.x || 1.3, penScale.current.y || 1.3));
  const symbolMaxPx = () => (penScale.current.x > 0 ? SYMBOL_MAX_PX : SYMBOL_MAX);
  // erase everything an eraser stroke passes through: ink by its drawn points,
  // pieces by their spot. Runs through scrubRefs so deleting a player also
  // unpicks any puck chain that referenced it.
  // a route as a polyline, so the eraser can hit the LINE and not just the icon
  const routePolyline = p => {
    const out = [{ x: p.x, y: p.y }];
    let prev = { x: p.x, y: p.y };
    (p.path || []).forEach(s => {
      for (let k = 1; k <= 8; k++) out.push(evalSeg(prev, s, k / 8));
      prev = { x: s.x, y: s.y };
    });
    return out;
  };
  function eraseAlong(raw) {
    const R = Math.max(2.5, 16 * Math.min(penScale.current.x || 0.2, penScale.current.y || 0.2));
    const near = (x, y) => raw.some(q => Math.hypot(q.x - x, q.y - y) < R);
    const live = piecesRef.current.filter(p => !p.lock);
    // cross a piece → the piece goes; cross only its route line → just the route
    const hit = live.filter(p => p.kind === "mark" ? (p.pts || []).some(q => near(q.x, q.y)) : near(p.x, p.y));
    const ids = new Set(hit.map(p => p.id));
    const routed = live.filter(p => p.kind === "player" && p.path.length && !ids.has(p.id)
      && routePolyline(p).some(q => near(q.x, q.y)));
    if (!ids.size && !routed.length) return false;
    // dropping every waypoint re-pins each pass/shot back to the player's spot,
    // exactly as deleting them one at a time from the popup would
    routed.forEach(p => { for (let i = p.path.length - 1; i >= 0; i--) stepsOnDelete(p.id, i); });
    setPieces(ps => {
      let list = ps.filter(q => !ids.has(q.id));
      for (const id of ids) list = scrubRefs(list, id);
      routed.forEach(p => {
        for (let i = p.path.length - 1; i >= 0; i--) list = shiftActionWaypoints(list, p.id, i + 1, -1);
        list = list.map(q => (q.id === p.id ? { ...q, path: [] } : q));
      });
      return list;
    });
    const bits = [];
    if (ids.size) bits.push(`${ids.size} item${ids.size > 1 ? "s" : ""}`);
    if (routed.length) bits.push(`${routed.length} route${routed.length > 1 ? "s" : ""}`);
    flash(`Erased ${bits.join(" + ")}`);
    return true;
  }
  // Ink the pen would own in the given state. The two inks are separate
  // everywhere else — convertInk won't touch sketch ink — so Clear shouldn't
  // either: sketching and then wiping the board took your smart-pen work with
  // it. Manual and Auto share one bucket, because their ink IS the same thing,
  // unread convertible ink, with nothing in the model or the DSL to tell them
  // apart. Locked ink (imported overlays) is nobody's.
  const inkMine = (p, sketch) => p.kind === "mark" && !p.lock && !!p.sketch === sketch;
  const clearInk = () => {
    const sketch = penReadRef.current === "sketch";
    // buffered strokes count as mine: setPen flushes, so everything still in
    // the settle window was drawn under the state that's active now
    const n = piecesRef.current.filter(p => inkMine(p, sketch)).length + penInk.length;
    if (!n) { flash(`No ${sketch ? "sketch" : "smart-pen"} ink to clear`); return; }
    // and drop them, or they land a second later on a board you just emptied
    penBuf.current = [];
    clearTimeout(penTimer.current);
    setPenInk([]);
    setPieces(ps => ps.filter(p => !inkMine(p, sketch)));
    flash(`Cleared ${n} ${sketch ? "sketch" : "ink"} mark${n > 1 ? "s" : ""} — Undo restores them`);
  };

  // what the classifier needs to know about the board it's reading into
  const penCtx = board => ({
    players: board.filter(p => p.kind === "player").map(p => ({
      id: p.id, x: p.x, y: p.y, end: segEnd(p, p.path.length - 1), hasPath: p.path.length > 0,
    })),
    nets: board.filter(p => p.kind === "net").map(n => ({ id: n.id, x: n.x, y: n.y })),
    pxFtX: penScale.current.x, pxFtY: penScale.current.y,
  });

  // Read the WHOLE drawing in one pass: every ink mark on the board goes in
  // together, so symbols spread over many strokes and passes between things
  // drawn minutes apart are all seen at once. Ink the classifier can't place
  // is simply left alone, so this is safe to hit repeatedly.
  function convertInk() {
    penScale.current = ftPerPx();          // read at the CURRENT zoom
    // Fold any still-buffered strokes in FIRST, in the same pass. Flushing via
    // setPieces and then sweeping would read the board as it was a moment ago —
    // the ink lands but the sweep can't see it, so the first tap looked like it
    // only "smoothed" the strokes and the second did the work.
    const pending = penBuf.current.slice();
    penBuf.current = [];
    clearTimeout(penTimer.current);
    if (pending.length) setPenInk([]);
    // ...but fold them in as whatever the pen is currently laying down. This
    // used to hardcode ordinary ink, so tapping Convert inside the 1s settle
    // window while sketching re-laid the buffered strokes at route fidelity —
    // losing their per-point pressure — and then fed them to the classifier,
    // which could turn handwriting into a player. commitPen honours the pen
    // state; this path has to as well.
    const buffered = penReadRef.current === "sketch";
    const board = pending.length
      ? materializePenOps(piecesRef.current, pending.map(s => ({ op: "mark", pts: s.pts, press: s.press, ...(buffered ? { sketch: true } : {}) })))
      : piecesRef.current;
    // sketch ink and locked ink are deliberately off-limits to the sweep
    const marks = board.filter(p => p.kind === "mark" && !p.lock && !p.sketch && (p.pts || []).length >= 2);
    if (!marks.length) { if (pending.length) setPieces(board); flash("No ink to convert"); return; }
    const ops = classifyPenGroup(marks.map(m => ({ pts: m.pts })), penCtx(board));
    const consumed = new Set();
    ops.forEach(o => {
      if (o.op === "mark") return;         // stayed ink — the mark is already on the board
      (o.srcs || []).forEach(i => marks[i] && consumed.add(marks[i].id));
    });
    const made = ops.filter(o => o.op !== "mark" && o.op !== "drop");
    if (!made.length && !consumed.size) {
      if (pending.length) setPieces(board);
      flash("Nothing recognised in the ink");
      return;
    }
    setPieces(materializePenOps(board.filter(p => !consumed.has(p.id)), made));
    const counts = {};
    made.forEach(o => { counts[o.op] = (counts[o.op] || 0) + 1; });
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${n > 1 ? (k === "pass" ? "passes" : k + "s") : k}`);
    const left = marks.length - consumed.size;
    flash(parts.length
      ? `Converted ${parts.join(", ")}${left ? ` · ${left} left as ink` : ""}`
      : "Nothing recognised in the ink");
  }

  // the last pen burst, kept so it can be copied off-device when a symbol
  // won't convert — a screenshot can't show stroke data
  const penLast = useRef(null);
  function copyPenDiag() {
    const d = penLast.current;
    if (!d) { flash("Draw something with the pen first"); return; }
    const round = v => Math.round(v * 100) / 100;
    const txt = JSON.stringify({
      v: APP_VERSION, pxFtX: round(d.ctx.pxFtX * 10000) / 10000, pxFtY: round(d.ctx.pxFtY * 10000) / 10000,
      screen: [Math.round(window.innerWidth), Math.round(window.innerHeight)],
      // the board the strokes were read against: without it, "why didn't this
      // become a pass" can't be answered — the answer is usually how far the
      // nearest player was
      // …including where a route ENDS, not just that there is one: a pass or
      // shot binds to the route end, so "is there a shooter in reach" can't be
      // read off the player's own position once they have a path
      players: (d.ctx.players || []).map(p => [p.id, round(p.x), round(p.y),
        p.hasPath ? 1 : 0, ...(p.hasPath && p.end ? [round(p.end.x), round(p.end.y)] : [])]),
      nets: (d.ctx.nets || []).map(n => [n.id, round(n.x), round(n.y)]),
      ops: d.ops.map(o => ({ op: o.op, sym: o.sym, srcs: o.srcs })),
      strokes: d.strokes.map(s => s.pts.map(p => [round(p.x), round(p.y)])),
    });
    // best-effort on BOTH paths: the async clipboard API can hang forever when
    // the document isn't focused, so never gate the feedback on its promise
    let ok = false;
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, txt.length);      // iOS needs the explicit range
    try { ok = document.execCommand("copy"); } catch { /* fall through */ }
    ta.remove();
    try { navigator.clipboard?.writeText?.(txt); } catch { /* best effort */ }
    flash(ok ? "Pen diagnostics copied — paste them to Claude"
      : "Copied (if the paste is empty, screenshot this instead)");
  }
  const penMarkAge = useRef(new Map());   // pen-fallback mark id → committed-at ms
  // Apple Pencil: once a stylus draws, the ice stops listening to skin —
  // a hand resting on the iPad while sketching is the whole problem. Sticky
  // (a coach doesn't re-prove the Pencil between strokes) but not permanent,
  // so putting the Pencil down and using a finger works again after a while.
  const STYLUS_STICKY = 300000;       // 5 min of no Pencil → fingers draw again
  const stylusAt = useRef(0);
  const [palmReject, setPalmReject] = useState(true);
  // Apple Pencil pressure → line weight. A standing preference (persisted like
  // the other view prefs) because it's a matter of taste, and it governs
  // RENDERING as well as capture: switching it off flattens ink already drawn
  // rather than only future strokes. The stored pressure is left untouched, so
  // turning it back on restores the weighting.
  const [pencilPress, setPencilPress] = useState(() => {
    try { return localStorage.getItem(PRESS_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(PRESS_KEY, pencilPress ? "1" : "0"); } catch { /* private mode */ } }, [pencilPress]);
  const pressRef = useRef(true);
  pressRef.current = pencilPress;
  // Interface typeface. A view preference like the theme — stored per device,
  // never in the drill. Applied as a CSS var on .hd-root so every panel and
  // popup inherits it in one place.
  const [typeface, setTypeface] = useState(() => {
    try { return localStorage.getItem(TYPEFACE_KEY) || "system"; } catch { return "system"; }
  });
  useEffect(() => { try { localStorage.setItem(TYPEFACE_KEY, typeface); } catch { /* private mode */ } }, [typeface]);
  const fontStack = (TYPEFACES.find(f => f[0] === typeface) || TYPEFACES[0])[2];
  // Which of the three editor flows is live. This is the app's top-level mode
  // and the bottom bar's segmented control writes it:
  //   draw — sketch with the smart pen; ink becomes real pieces
  //   edit — add and modify pieces, routes and their properties
  //   play — animate, scrub, present, write captions
  // It replaces a pile of implicit modes (a penMode boolean, a Draw|Edit knob
  // inside the pen palette, "is the animation running") that between them meant
  // the chrome never said which of the three you were in.
  //
  // Deliberately NOT persisted and NOT derived from a loaded drill: the DSL has
  // no concept of a mode, and giving it one would break the round-trip.
  const [mode, setModeRaw] = useState("edit");
  // Kept as a derived name because ~7 sites read it and they all mean the same
  // thing — the pen is the active tool.
  const penMode = mode === "draw";
  const [eraser, setEraser] = useState(false);
  const eraserRef = useRef(false);          // finishDraw reads it from a stale closure
  eraserRef.current = eraser;
  // auto: every settled burst is read straight away. Off: strokes stay ink
  // until Convert reads the whole drawing at once.
  // What the pen does with what you draw — ONE setting with three states, not
  // two toggles. As two (note × auto) it implied four combinations, and the
  // fourth is meaningless: sketch ink is never read, so "auto" had nothing to
  // act on and the lit Auto button did nothing at all. Three states, and the
  // impossible one can't be expressed.
  //   sketch — never read. Also a different pen: finer capture, gentler
  //            simplification, per-point pressure kept, drawn through its own
  //            points instead of a fitted curve (see inkStepFt/inkEpsFt).
  //   manual — ordinary ink; it waits on the board until Convert is tapped.
  //   auto   — every stroke is read once the burst settles.
  // Not persisted (neither half was), and deliberately NOT reset by setMode or
  // by arming the eraser: it's a pen setting like colour, width and style.
  const [penRead, setPenRead] = useState("auto");
  const penReadRef = useRef("auto");
  penReadRef.current = penRead;
  const isSketch = penRead === "sketch";
  const [penPop, setPenPop] = useState(null);   // "size" | "style" popover, or null
  const [stylusOn, setStylusOn] = useState(false);   // drives the hint text only
  // NB the `> 0` guard: performance.now() starts near zero, so without it a
  // never-touched-by-a-Pencil session would reject fingers for its first 5 min
  const stylusMode = () =>
    palmReject && stylusAt.current > 0 && performance.now() - stylusAt.current < STYLUS_STICKY;
  // true when this pointer is skin that must be ignored on the ice
  const palmBlocked = e => e.pointerType === "touch" && stylusMode();
  // a Pencil touching down takes over from anything skin already started
  function noteStylus(e) {
    if (e.pointerType !== "pen") return;
    stylusAt.current = performance.now();
    if (!stylusOn) setStylusOn(true);
    const d = drag.current;
    if (d && d.kind === "drawing" && d.touch) {   // palm landed first — discard it
      drawRaw.current = [];
      setDrawPreview(null);
      markerDraw.current = false;
      penDraw.current = false;
      drag.current = null;
    }
  }
  const [penInk, setPenInk] = useState([]);   // buffered strokes, rendered like the live one
  const penW = markWidth * 0.55;      // pen ink runs thinner than marker ink
  // the settle timer fires from a stale closure — commitPen reads the board
  // through this ref so the classifier context is always current
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const [openMenu, setOpenMenu] = useState(null); // settings | rinkmenu | prefs | notes | inventory | steps | text
  // Every corner menu hangs off the button that opens it, rather than off a
  // screen corner. Corner-pinning reads fine on a phone, where the bar spans the
  // whole width, but in landscape or on desktop the buttons sit well left of the
  // corner and the panel opens nowhere near what was tapped — Tune's used to
  // open under Menu. (Must live below openMenu — reading it from higher up is a
  // temporal-dead-zone crash the build can't see.)
  // Only the buttons that still exist in the bar get a ref — these are the
  // corner menus, which the JS centres on whatever opened them. Panels reached
  // from INSIDE another panel are full-screen sheets and don't anchor at all.
  const barBtnRefs = {
    settings: useRef(null), rinkmenu: useRef(null),
  };
  const [menuLeft, setMenuLeft] = useState(null);
  useLayoutEffect(() => {
    // Below the breakpoint we write NO inline left: the stylesheet stretches the
    // panel to the bar's insets instead. Inline styles would outrank that rule.
    const place = () => {
      const r = barBtnRefs[openMenu]?.current?.getBoundingClientRect();
      if (!r || window.innerWidth < MENU_ANCHOR_MIN) { setMenuLeft(null); return; }
      setMenuLeft(Math.round(Math.max(MENU_PAD,
        Math.min(window.innerWidth - MENU_W - MENU_PAD, r.left + r.width / 2 - MENU_W / 2))));
    };
    place();
    if (!openMenu) return;
    // a rotation with a menu open crosses the breakpoint in both directions
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
    };
  }, [openMenu]);
  const menuAnchor = menuLeft != null ? { left: menuLeft, right: "auto" } : undefined;
  // A board stashed by the crash boundary's "Reset drill & reload", if any.
  // Read once at mount: it can only be written by a crash, which reloads the
  // page anyway, so there is nothing to react to mid-session.
  const [crashBackup, setCrashBackup] = useState(() => peekBackup());
  const [textDraft, setTextDraft] = useState(DEFAULT_TEXT);
  const [textError, setTextError] = useState("");
  const [textCloseAsk, setTextCloseAsk] = useState(false);  // "unapplied edits" guard on Done
  const [genAsk, setGenAsk] = useState(false);       // inline "replace steps?" confirm
  const [keyEdit, setKeyEdit] = useState(null);      // API-key inline editor draft, or null
  const [cuePick, setCuePick] = useState(null);      // light-cue index with its colour palette open
  const [addHover, setAddHover] = useState(null);    // tool kind hovered in the "Add here" popup → ghost preview
  const [playing, setPlaying] = useState(false);
  const [animT, setAnimT] = useState(0);
  const [restFade, setRestFade] = useState(1);         // extra splash fade-out that runs while paused/stopped
  // Playback speed lives as the MULTIPLE, with pace derived — so the transport
  // button and the timing engine can't disagree about what "1×" means.
  const [speedMul, setSpeedMul] = useState(1);
  const pace = BASE_PACE * speedMul;
  // routes shown during playback: "player" (routes only), "hide", "all" (+puck/shots)
  const [playRoutes, setPlayRoutes] = useState("player");
  // presentation mode: pause at each described step so viewers can read along
  const [presentation, setPresentation] = useState(false);
  const [presoDelay, setPresoDelay] = useState(2.5);   // MINIMUM seconds held at each step
  const [readPace, setReadPace] = useState(READ_PACE_DEFAULT); // index into READ_PACES: how far past the minimum a long caption stretches
  const [holdStep, setHoldStep] = useState(null);      // step currently being read
  const [placingStep, setPlacingStep] = useState(null); // idx of the step whose caption is being placed on the ice
  const [editAnchor, setEditAnchor] = useState(null);  // idx of the step whose time/waypoint anchor is being edited inline
  const [minorDesc, setMinorDesc] = useState(false);   // describe zones skated through
  const [showResult, setShowResult] = useState(true);  // Save!/Goal! splash on shots
  const [collisions, setCollisions] = useState(true);  // route avoidance (nets/goalie/players)
  const [avoidanceVisuals, setAvoidanceVisuals] = useState(true); // DRAW the detour bend + ghost (animation still avoids either way)
  const [previewAllBranches, setPreviewAllBranches] = useState(false); // ghost a player down EVERY candidate branch at once
  const [arrowStagger, setArrowStagger] = useState(true); // tidy arrowheads: stagger converging heads + recess off crossing lines (off = marks land exactly where drawn)
  const [realisticShots, setRealisticShots] = useState(true); // random goal/post/wide/over + air; off = always bury flat
  const [detailAnim, setDetailAnim] = useState(true);  // skater stride sway, stick swing, dribble cradle
  // the icon discs at each pass/shoot/pickup. Persisted, because it is a standing
  // view preference like whiteboard rather than something you set per drill.
  const [actionCircles, setActionCircles] = useState(() => {
    try { return localStorage.getItem(ACTC_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(ACTC_KEY, actionCircles ? "1" : "0"); } catch { /* private mode */ } }, [actionCircles]);
  // whiteboard mode: players draw as classic X/O/letter symbols, action badges
  // collapse to arrow-into-gap, and detail animations shut off. A standing view
  // preference, so unlike the other prefs toggles it persists across refreshes.
  const [whiteboard, setWhiteboard] = useState(() => {
    try { return localStorage.getItem(WB_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(WB_KEY, whiteboard ? "1" : "0"); } catch { /* private mode */ } }, [whiteboard]);
  // circled symbols: draw each X/O on an opaque white disc, like the action circles
  const [wbCircle, setWbCircle] = useState(() => {
    try { return localStorage.getItem(WBC_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(WBC_KEY, wbCircle ? "1" : "0"); } catch { /* private mode */ } }, [wbCircle]);
  // player name tags under the X/O symbols: always-on when the pref is set;
  // otherwise they still flash up while a player's popup is open (pass-target
  // picking needs findable names) and hide again with it
  const [wbNames, setWbNames] = useState(() => {
    try { return localStorage.getItem(WBN_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(WBN_KEY, wbNames ? "1" : "0"); } catch { /* private mode */ } }, [wbNames]);
  // half-ice screen orientation: east-west (net right, default) or north-south
  // (net at the bottom, drill-book portrait style). A device view pref.
  const [halfNS, setHalfNS] = useState(() => {
    try { return localStorage.getItem(HALFNS_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(HALFNS_KEY, halfNS ? "1" : "0"); } catch { /* private mode */ } }, [halfNS]);
  // flipped ends: E-W with the net at the LEFT, or N-S with the net at the TOP
  const [halfFlip, setHalfFlip] = useState(() => {
    try { return localStorage.getItem(HALFFLIP_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(HALFFLIP_KEY, halfFlip ? "1" : "0"); } catch { /* private mode */ } }, [halfFlip]);
  // full ice: stretch to fill the screen (default, the app's signature look) or
  // letterbox to true 200'×85' proportions so every marking is geometrically exact
  const [stretchFill, setStretchFill] = useState(() => {
    try { return localStorage.getItem(STRETCH_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(STRETCH_KEY, stretchFill ? "1" : "0"); } catch { /* private mode */ } }, [stretchFill]);
  // Which hand the board is laid out for: "right" (default) | "left". A coach
  // holds the phone in the off hand and taps with the dominant one, so "left"
  // mirrors BOTH bars and puts Menu, Rink and the palette under the left thumb.
  // Chrome only — the ice and everything on it never move. Stored as a word
  // rather than the "1"/"0" convention its neighbours use because it is a side,
  // not a switch, and "hand=left" reads right in the debugger.
  const [hand, setHand] = useState(() => {
    try { return localStorage.getItem(HAND_KEY) === "left" ? "left" : "right"; }
    catch { return "right"; }
  });
  useEffect(() => { try { localStorage.setItem(HAND_KEY, hand); } catch { /* private mode */ } }, [hand]);
  // Theme: "auto" (follow the phone) | "light" | "dark". The inline boot script
  // in index.html has already applied a saved override before first paint —
  // this just keeps the attribute in sync once React owns the state.
  const [themePref, setThemePref] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; }
  });
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, themePref); } catch { /* private mode */ }
    const el = document.documentElement;
    // no attribute at all in auto: that's what lets the prefers-color-scheme
    // media block in the emitted CSS take over
    if (themePref === "auto") el.removeAttribute(THEME_ATTR);
    else el.setAttribute(THEME_ATTR, themePref);
  }, [themePref]);
  // the OS preference has to be tracked LIVE, not just read once: in auto the
  // SVG token object below must follow the phone flipping to dark at sunset
  // while the app is open.
  const [prefersDark, setPrefersDark] = useState(() => {
    try { return matchMedia("(prefers-color-scheme: dark)").matches; } catch { return true; }
  });
  useEffect(() => {
    let mq;
    try { mq = matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const on = e => setPrefersDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const themeName = resolveTheme(themePref, prefersDark);
  const T = tokens(themeName);
  // stored piece colour -> what this theme paints. Identity for every theme that
  // declares no lift table, so this is inert unless a scheme opts in.
  const ink = useMemo(() => (c => teamInk(themeName, c)), [themeName]);
  // Keep the address-bar / task-switcher colour on the resolved theme. iOS only
  // consults theme-color at LAUNCH, so this is for Safari tabs, Android, and the
  // next standalone launch; the media-scoped metas in index.html cover the
  // pre-JS paint and are replaced here once JS has an authoritative answer.
  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"][media]').forEach(m => m.remove());
    let m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
    m.content = T["surface-app"];
  }, [T]);
  const effDetail = detailAnim && !whiteboard;
  // whiteboard also drops the shot theatrics: no random miss/post/air rolls
  // (shots bury flat) and no GOAL!/SAVE! splashes — a diagram, not a broadcast
  const effRealistic = realisticShots && !whiteboard;
  // whiteboard draws the PLANNER's routes only: authored lines, no animation-time
  // detour bends/ghosts (the skater still avoids obstacles either way)
  const effAvoidVis = avoidanceVisuals && !whiteboard;
  // whiteboard has never drawn the action discs, so it wins over the pref rather
  // than fighting it — same shape as the three flags above
  const effActCircles = actionCircles && !whiteboard;
  // Both persist. They are the two display prefs you set for a ROOM — thicker
  // lines to project, lighter ink to annotate over — and a coach who set one at
  // the rink was made to set it again at the next practice.
  const [lineScale, setLineScale] = useState(() => numPref(LINE_KEY, 1, LINE_RANGE));  // route line-thickness multiplier
  useEffect(() => { try { localStorage.setItem(LINE_KEY, String(lineScale)); } catch { /* private mode */ } }, [lineScale]);
  const [markOpacity, setMarkOpacity] = useState(() => numPref(MARK_KEY, 1, MARK_RANGE));   // opacity of the drawn drill markings only (routes/forks/stops/ink/aim); players, implements + rink stay opaque
  useEffect(() => { try { localStorage.setItem(MARK_KEY, String(markOpacity)); } catch { /* private mode */ } }, [markOpacity]);
  // ...and the mirror of it for the SHEET: how strongly the rink's own lines are
  // drawn. Deliberately a separate knob from Mark opacity — that one quiets what
  // you drew so the rink reads through it, this one quiets the rink so what you
  // drew reads over it. Turning both down just fades everything.
  const [rinkDim, setRinkDim] = useState(() => numPref(RINKDIM_KEY, 1, RINKDIM_RANGE));
  useEffect(() => { try { localStorage.setItem(RINKDIM_KEY, String(rinkDim)); } catch { /* private mode */ } }, [rinkDim]);
  // What the settings sheet's preview tiles draw with. Everything a scene can
  // need, in one object, so a new scene never has to thread another prop through
  // PrefPick. prefersDark is in here because the Theme row's "Auto" tile has to
  // resolve the same way the app does.
  const pvCtx = useMemo(() => ({ T, ink, prefersDark, lineScale, markOpacity, rinkDim }),
    [T, ink, prefersDark, lineScale, markOpacity, rinkDim]);
  const [defaultSpeed, setDefaultSpeed] = useState(1.5); // speed given to newly-added players
  // tunable shot odds (0..1): goalie save chance; empty-net miss split into
  // post/wide/over (the remainder is a goal); and how often a shot goes airborne
  const [shotOdds, setShotOdds] = useState({ save: SAVE_PROB, post: MISS_POST, wide: MISS_WIDE, over: MISS_OVER, air: SHOT_AIR_PROB, bounce: BOUNCE_REST });
  const [showAdvanced, setShowAdvanced] = useState(false); // reveal the shot-odds sliders
  const [showZones, setShowZones] = useState(false);   // named ice-area overlay
  // when false (default), locked pieces/waypoints are click-through so taps land
  // on nearby UNLOCKED items instead of a locked one stealing the grab; turn on
  // to make locked items tappable again (to select + unlock them)
  const [lockedSelectable, setLockedSelectable] = useState(false);
  const [playSeed, setPlaySeed] = useState(0);         // bumps each play → new save/goal rolls
  const [loopMode, setLoopMode] = useState(false);     // replay the routine continuously
  const [loopPause, setLoopPause] = useState(1);       // seconds held on the finished drill
  const [drillTitle, setDrillTitle] = useState(init.title || "");
  const [drillDesc, setDrillDesc] = useState(init.desc || "");
  // authored presentation steps: [{ text, at } | { text, on:{piece,wp} }] — the
  // narration the coach drops while scrubbing; persisted via the STEP DSL statement
  const [drillSteps, setDrillSteps] = useState(init.steps || []);
  // a markdown coaching writeup (headings, numbered steps, bold) shown on the
  // preview/print sheet; persisted via the NOTES DSL block
  const [drillNotes, setDrillNotes] = useState(init.notes || "");
  // inventory overrides / custom gear rows; auto counts derive from the pieces.
  // Persisted via ITEM lines — see deriveInventory()
  const [drillItems, setDrillItems] = useState(init.items || []);
  // the DSL schema version the loaded drill declared (for future version-aware
  // rendering; not gated yet). Re-stamped to the current DSL_VERSION on save.
  const [drillVersion, setDrillVersion] = useState(init.dslVersion);
  const [toast, setToast] = useState("");
  const [aiPlay, setAiPlay] = useState(false);         // "Let AI play" 5v5 mode
  const [aiMins, setAiMins] = useState(2);             // duration in minutes
  const [, aiTick] = useState(0);                      // force re-render each sim frame
  const aiRef = useRef(null);
  const aiClockRef = useRef(0);
  const [drawPreview, setDrawPreview] = useState(null);
  const [loupe, setLoupe] = useState(null);
  const [popOff, setPopOff] = useState({ x: 0, y: 0 });
  const [popState, setPopState] = useState("mid");   // pinned popup size: "min" (header) | "mid" (small) | "max" (full)
  // popup position + size are decoupled (both px, relative to .hd-canvas):
  //   popPos {top,left} | null  → null follows the auto edge-anchor
  //   popDim {w, h|null} | null → null is the default width + auto height; set
  //     when the user resizes, and preserved across Prev/Next so their sizing sticks
  const [popPos, setPopPos] = useState(null);
  const [popDim, setPopDim] = useState(null);
  const [placeToken, setPlaceToken] = useState(0);   // bumped to run clear-space placement after a fresh open renders
  // pinned panel: keep the editor open and re-target it to whatever's tapped next.
  //   null | "float" (mobile-style floating, any screen) | "dock" (right sidebar, wide only)
  const [pinMode, setPinMode] = useState(null);
  const [isWide, setIsWide] = useState(() =>
    typeof matchMedia === "function" &&
    matchMedia("(pointer: fine) and (min-width: 760px)").matches);
  // The action bar's layout tier. It decides what REACT RENDERS, not just how
  // it's styled — below DENSE_MIN the pen's ink/size/style trio collapses into
  // one popover so the bar still fits on its single line — so it has to be a JS
  // flag, not a media query. It's also written onto .hd-root as `.dense`, which
  // is what the compact CSS keys off: one source of truth, so the stylesheet and
  // the render tree can't disagree about which layout is live.
  const [dense, setDense] = useState(() =>
    typeof matchMedia === "function" && matchMedia(`(min-width: ${DENSE_MIN}px)`).matches);
  const [roomy, setRoomy] = useState(() =>
    typeof matchMedia === "function" && matchMedia(`(min-width: ${ROOMY_MIN}px)`).matches);
  // a coarse (touch) primary pointer needs fatter grab targets than a mouse.
  // Stable for a session, so compute once (no listener like isWide needs).
  const coarsePtr = useMemo(
    () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches, []);
  const [stageSize, setStageSize] = useState({ w: 800, h: 500 });

  const svgRef = useRef(null);
  const sceneRef = useRef(null);
  const stageRef = useRef(null);
  // pinch-zoom view: scale + pan in the SVG's root-viewBox units (applied as an
  // outer <g> transform, so svgPt — which uses the inner scene CTM — stays right)
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef({ s: 1, tx: 0, ty: 0 });
  const geomRef = useRef({ ox: 0, oy: 0, rootW: 200, rootH: 85 });
  const pinchRef = useRef(null);
  const segRefs = useRef({});
  const drag = useRef(null);
  // undo history: coalesced snapshots of the whole drill document (a drag = one entry)
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const prevDocRef = useRef();
  const lastSnapRef = useRef(0);
  const undoingRef = useRef(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const drawRaw = useRef([]);
  const drawTarget = useRef(null);
  // when set to {id, color}, the draw tool authors a light-reaction FORK for that
  // player+colour (continuing from its branch point) instead of a base route
  const forkTarget = useRef(null);
  const [forkDrawColor, setForkDrawColor] = useState(null);   // mirrors forkTarget for UI/status
  // {id, color} when a reaction fork's route is open for point-editing (its
  // handles show, its line is tappable, its waypoints get the point popup)
  const [editingFork, setEditingFork] = useState(null);
  // leave fork-edit mode when another piece is selected
  useEffect(() => { if (editingFork && selectedId !== editingFork.id) setEditingFork(null); }, [selectedId, editingFork]);
  const fileRef = useRef(null);
  // photo → DSL import (Claude vision): hidden image input, busy status text,
  // pre-import board snapshot (non-null = Keep/Discard bar showing), abort
  const photoRef = useRef(null);
  const photoAbort = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(null);
  const [photoUndo, setPhotoUndo] = useState(null);
  const animRef = useRef(0);
  const totalRef = useRef(1);
  const holdRef = useRef(0);        // seconds remaining in the current step hold
  const nextStepRef = useRef(0);    // index of the next step to pause at
  const stepsRef = useRef([]);      // presentation steps, mirrored for the raf loop
  const presoDelayRef = useRef(2.5);
  const readCpsRef = useRef(READ_PACES[READ_PACE_DEFAULT].cps);
  const presoRef = useRef(false);
  const loopRef = useRef(false);
  const loopPendingRef = useRef(false); // holding on the finished drill before a loop restart
  const loopPauseRef = useRef(1);
  const popDrag = useRef(null);
  const lastLineTap = useRef(null);
  const lastIceTap = useRef(null); // double-click/tap on empty ice → add menu

  const selected = pieces.find(p => p.id === selectedId) || null;
  const editing = animT === 0 && !playing && !aiPlay;
  // whiteboard player name tags: on with the pref, or while a player's popup is open
  const wbTags = whiteboard && (wbNames ||
    (popup?.type === "piece" && pieces.some(q => q.id === popup.id && q.kind === "player")));
  // obstacle segments for tag placement (route polylines + puck plan lines),
  // built once per render on first use
  let wbTagObs = null;
  const tagObstacles = () => {
    if (wbTagObs) return wbTagObs;
    const segs = [];
    pieces.forEach(q => {
      if (q.kind !== "player" || !(q.path || []).length) return;
      const poly = pathPolyline({ x: q.x, y: q.y }, q.path);
      for (let i = 1; i < poly.length; i++) segs.push([poly[i - 1], poly[i]]);
    });
    try {
      // shots/chips/rims: the drawn lines follow the plan's fly legs
      const { plans } = getIntentPlan();
      pieces.forEach(q => {
        if (q.kind !== "puck" || !plans[q.id]) return;
        plans[q.id].legs.forEach(L => { if (L.type === "fly") segs.push([{ x: L.x0, y: L.y0 }, { x: L.x1, y: L.y1 }]); });
      });
      // passes: drawn from the AUTHORED chain (release waypoint → receiver), NOT
      // the plan's blade-warped fly legs — those drift a few feet off the drawn
      // line, enough to let a tag sit right on it. Mirror passArrows' geometry.
      pieces.forEach(q => {
        if (q.kind !== "puck") return;
        (q.transfers || []).forEach((t, s) => {
          if (t.kind !== "pass") return;
          const actor = t.by || releaserOf(q, s);
          const wp = releasePos(actor, t);
          const rec0 = pieces.find(x => x.id === t.to);
          if (!wp || !rec0) return;
          const rec = t.recvRef ? routePiece(rec0, t.recvRef) : rec0;
          const rw = t.recvAt != null ? t.recvAt : -1;
          const tgt = rw >= 0 && (rec.path || [])[Math.min(rw, rec.path.length - 1)]
            ? rec.path[Math.min(rw, rec.path.length - 1)] : { x: rec0.x, y: rec0.y };
          const via = t.via ? pieces.find(x => x.id === t.via) : null;
          const pts = via ? [wp, { x: via.x, y: via.y }, tgt] : [wp, tgt];
          for (let j = 1; j < pts.length; j++) segs.push([pts[j - 1], pts[j]]);
        });
      });
    } catch { /* plan unavailable mid-edit — route lines alone still steer the tag */ }
    return (wbTagObs = segs);
  };
  const distToSeg = (x, y, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / L2));
    return Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t));
  };
  // rotate a player's name tag to the clearest spot around them: below first,
  // then the diagonals, sides, and above — first comfortably clear spot wins,
  // else the one farthest from any route/plan line. The tag is a BOX, not a
  // point: clearance is scored from its corners, and side placements stand
  // further out so the box clears the symbol and nearby carats, not just its
  // own centre.
  const tagSpotFor = (p, off) => {
    const len = Math.max(1, String(p.label || "").length);
    // empirical half-extents of the rendered tag at size 0.62, in geometric-mean
    // feet — converted per-axis, because the tag is screen-true while the ice is
    // fill-stretched (on a stretched device its rink-ft footprint grows on the
    // squeezed axis; calibrating on one aspect under-measures on another)
    const hw = (0.62 * (1.8 + 1.26 * len)) / gmSar;
    const hh = 1.7 * gmSar;
    const angles = [90, 135, 45, 180, 0, 225, 315, 270];
    let best = null;
    for (const deg of angles) {
      const a = (deg * Math.PI) / 180;
      const reach = off + Math.max(0, Math.abs(Math.cos(a)) * (hw - 1.4))
        + Math.max(0, Math.abs(Math.sin(a)) * (hh - 1.4));
      const c = boards.clampInside(p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach);
      const pts = [c, { x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh },
        { x: c.x - hw, y: c.y + hh }, { x: c.x + hw, y: c.y + hh }];
      let d = Infinity;
      for (const [s1, s2] of tagObstacles()) {
        if (Math.min(s1.x, s2.x) - 14 > c.x || Math.max(s1.x, s2.x) + 14 < c.x ||
            Math.min(s1.y, s2.y) - 14 > c.y || Math.max(s1.y, s2.y) + 14 < c.y) continue;
        for (const t of pts) d = Math.min(d, distToSeg(t.x, t.y, s1, s2));
        if (d < 0.4) break;
      }
      if (d >= 1.6) return c;
      if (!best || d > best.d) best = { x: c.x, y: c.y, d };
    }
    return best || { x: p.x, y: p.y + off };
  };
  // a pinned panel stays open + re-targets on the next tap (empty-tap keeps the
  // last item); "dock" renders as a right sidebar but only on a wide/fine-pointer
  // screen — a "dock" panel on a narrow screen falls back to the float render
  const pinned = pinMode !== null;
  const docked = pinMode === "dock" && isWide;
  // keep isWide current so the sidebar/dock affordance appears/vanishes and a
  // docked panel re-flows to floating when an iPad rotates across the breakpoint
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(pointer: fine) and (min-width: 760px)");
    const on = () => setIsWide(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  // …and the action bar's layout tier, same shape. A popover only exists at one
  // density, so a rotation across the breakpoint has to close it — otherwise the
  // open panel outlives the button it sprang from.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(`(min-width: ${DENSE_MIN}px)`);
    const rq = matchMedia(`(min-width: ${ROOMY_MIN}px)`);
    // both tiers in one effect, and both close any open popover: a group that
    // inlines at the wider tier must not leave its popover floating over a bar
    // that no longer has the button it sprang from
    const on = () => { setDense(mq.matches); setRoomy(rq.matches); setPenPop(null); };
    const add = q => (q.addEventListener ? q.addEventListener("change", on) : q.addListener(on));
    const del = q => (q.removeEventListener ? q.removeEventListener("change", on) : q.removeListener(on));
    add(mq); add(rq);
    return () => { del(mq); del(rq); };
  }, []);

  // stepping Prev/Next through a piece's waypoints keeps the popup put when it
  // isn't covering the route (see navPopup); this ref tells the reset effects to
  // preserve the current position/size for that one navigation
  const preservePopPos = useRef(false);
  // a player or waypoint popup opens pinned + compact ("mid") — open and
  // scrollable but small and out of the way; minimize to the header or
  // maximize to fill the height from the popup's own controls. (layout effect
  // runs first, so it checks the flag but leaves it for the passive effect to
  // clear last — both must see it on a preserved Prev/Next step)
  useLayoutEffect(() => {
    if (preservePopPos.current || pinned) return;       // Prev/Next, or a pinned panel, keeps its spot + size
    // fresh open: reset to the auto edge-anchor at default size, then (next
    // render) run clear-space placement now that the real content is measurable
    setPopState("mid"); setPopPos(null); setPopDim(null);
    if (popup) setPlaceToken(t => t + 1);
  }, [popup?.type, popup?.id, popup?.seg]);
  useEffect(() => {
    if (preservePopPos.current) { preservePopPos.current = false; return; }
    setPopOff({ x: 0, y: 0 });
    setCuePick(null);
    setAddHover(null);
  }, [popup?.type, popup?.id, popup?.seg, popup?.pt?.x, popup?.pt?.y]);
  // one working surface at a time: a corner menu opening takes over from an
  // unpinned editor popout instead of stacking on top of it
  useEffect(() => {
    if (openMenu && !pinned) setPopup(null);
    if (openMenu !== "steps") setGenAsk(false);      // stale inline confirms don't survive
    if (openMenu !== "prefs") setKeyEdit(null);      // a menu switch
  }, [openMenu]);
  // clear-space placement: after a fresh open renders at its anchor (default
  // size), measure it and, if it covers routes/players, move it to open space —
  // preferring a fully clear spot, else one that avoids the working chain
  useLayoutEffect(() => {
    if (!placeToken) return;
    const pos = computePlacement();
    if (pos) setPopPos(pos);
  }, [placeToken]);

  // keep popouts fully inside the ice box: after every render, measure the
  // card against its container and pull it back in with a corrective margin
  // (margins compose with the anchor transform without fighting it)
  const popRef = useRef(null);
  const sbThumbRef = useRef(null);
  // draw a real, always-visible scrollbar thumb (iOS ignores ::-webkit-scrollbar
  // for touch overflow, so this is the only reliable "it scrolls" cue there).
  // Imperative like the margin correction — no re-render, no loop.
  function syncPopScroll() {
    const el = popRef.current, th = sbThumbRef.current;
    if (!el || !th) return;
    const ch = el.clientHeight, sh = el.scrollHeight, st = el.scrollTop;
    if (sh <= ch + 2) { th.style.opacity = "0"; return; }   // nothing to scroll → hide
    const railTop = 6, railBot = 6, track = ch - railTop - railBot;
    const h = Math.max(28, track * ch / sh);
    const top = railTop + (track - h) * (st / (sh - ch));
    th.style.opacity = "1";
    th.style.height = h + "px";
    th.style.transform = `translateY(${top}px)`;   // rail is sticky at the viewport top, so no scroll offset
  }
  useLayoutEffect(() => {
    const el = popRef.current;
    const box = el && el.parentElement;
    if (!el || !box) return;
    el.style.marginLeft = "0px";
    el.style.marginTop = "0px";
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const M = 4;
    let dx = 0, dy = 0;
    if (r.left < b.left + M) dx = b.left + M - r.left;
    else if (r.right > b.right - M) dx = b.right - M - r.right;
    if (r.top < b.top + M) dy = b.top + M - r.top;
    else if (r.bottom > b.bottom - M) dy = b.bottom - M - r.bottom;
    if (dx) el.style.marginLeft = dx + "px";
    if (dy) el.style.marginTop = dy + "px";
    syncPopScroll();
  });

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
  function popDragEnd() { popDrag.current = null; if (pinned) freezePopSpot(); }

  // freeze the panel's current on-screen rect into an explicit popPos so a pinned
  // (float) panel keeps its spot as it re-targets to each next item tapped (the
  // reset-on-target effect is skipped while pinned, so popPos/popDim then stick)
  function freezePopSpot() {
    const el = popRef.current;
    if (!el) return;
    const par = el.offsetParent || el.parentElement;
    const pr = par.getBoundingClientRect();
    const r = el.getBoundingClientRect();               // includes the current popOff translate
    setPopOff({ x: 0, y: 0 });                          // popOff folded into popPos
    setPopPos({ top: r.top - pr.top, left: r.left - pr.left });
  }
  function togglePin() {
    if (pinMode === "float") { setPinMode(null); flash("Un-pinned — panel closes on the next ice tap"); return; }
    if (pinMode !== "dock") freezePopSpot();            // hold the current floating spot across re-targets
    setPinMode("float");
    flash("Pinned — panel stays open and follows what you tap");
  }
  function toggleDock() { setPinMode(m => m === "dock" ? null : "dock"); }

  // resize handles: "h" (bottom bar → height only) or "wh" (corner → both). The
  // first grab detaches the popup from its auto edge-anchor into an explicit
  // top/left box that grows down/right, so the bottom + corner handles are
  // always on a free edge no matter which edge the popup opened against.
  const popResize = useRef(null);
  function popResizeStart(e, mode) {
    e.stopPropagation();
    e.preventDefault();
    const el = popRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);   // capture on the handle so moves keep firing
    const par = el.offsetParent || el.parentElement;
    const pr = par.getBoundingClientRect();
    const r = el.getBoundingClientRect();               // includes the current popOff translate
    const box = { top: r.top - pr.top, left: r.left - pr.left, w: r.width, h: r.height };
    popResize.current = { sx: e.clientX, sy: e.clientY, box, mode };
    setPopOff({ x: 0, y: 0 });                          // popOff is folded into box.top/left
    setPopPos({ top: box.top, left: box.left });        // detach position
    setPopDim({ w: box.w, h: box.h });                  // explicit size the user now owns
  }
  function popResizeMove(e) {
    const d = popResize.current;
    if (!d) return;
    const b = d.box;
    const w = d.mode === "wh"
      ? Math.max(190, Math.min(b.w + (e.clientX - d.sx), canvasW - 16))
      : b.w;
    const h = Math.max(56, Math.min(b.h + (e.clientY - d.sy), canvasH - 16));
    setPopDim({ w, h });                                 // position stays put; only size changes
  }
  function popResizeEnd() { popResize.current = null; }

  // map a rink-feet point to client px via the scene's live CTM (accounts for
  // orientation + pinch zoom), so we can test the route against the popup rect
  function rinkToClient(x, y) {
    const svg = svgRef.current;
    const m = (sceneRef.current || svg)?.getScreenCTM?.();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    const q = pt.matrixTransform(m);
    return { x: q.x, y: q.y };
  }
  // sample points along a piece's whole route (its standing spot + every leg) in
  // client px — the "route chain" we don't want the popup to sit on top of
  function routeClientPoints(p) {
    const out = [];
    const add = (x, y) => { const c = rinkToClient(x, y); if (c) out.push(c); };
    add(p.x, p.y);
    (p.path || []).forEach((s, i) => {
      const el = segRefs.current[`${p.id}/${i}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      if (el && L > 0) {
        const n = Math.max(2, Math.ceil(L / 6));
        for (let k = 0; k <= n; k++) { try { const q = el.getPointAtLength((L * k) / n); add(q.x, q.y); } catch { /* skip */ } }
      } else add(s.x, s.y);
    });
    return out;
  }
  // does the popup's current on-screen rect sit over any of that route?
  function popupCoversRoute(id) {
    const el = popRef.current;
    const p = pieces.find(q => q.id === id);
    if (!el || !p) return false;
    const r = el.getBoundingClientRect();
    const pad = 10;
    return routeClientPoints(p).some(c =>
      c.x >= r.left - pad && c.x <= r.right + pad && c.y >= r.top - pad && c.y <= r.bottom + pad);
  }
  // the piece ids of the "chain" the popup is working on — the piece itself plus
  // any puck that involves it and every player that puck touches
  function workingChainIds(id) {
    const set = new Set([id]);
    pieces.forEach(pk => {
      if (pk.kind !== "puck") return;
      const players = [pk.carrier, pk.pickup && pk.pickup.to, ...(pk.transfers || []).map(t => t.to)].filter(Boolean);
      if (pk.id === id || players.includes(id)) { set.add(pk.id); players.forEach(x => set.add(x)); }
    });
    return set;
  }
  // the drag handles the popup's target currently EXPOSES (waypoint anchor + its
  // tangent controls, a piece's departure/rotate handles) in client px. A floating
  // popup must not cover these — they're exactly what the user reaches for next.
  // These stick out beyond the sampled route, so route samples alone miss them.
  function targetHandlePoints(pop) {
    const out = [];
    if (!pop) return out;
    if (pop.type === "add") {
      // the "add here" popup's self-obstacle is the tap spot: the target reticle
      // and hover ghost render there, so the popup must not sit on top of it
      const c = pop.pt && rinkToClient(pop.pt.x, pop.pt.y);
      if (c) out.push(c);
      return out;
    }
    const p = pieces.find(q => q.id === pop.id);
    if (!p) return out;
    const add = (x, y) => { if (x == null || y == null) return; const c = rinkToClient(x, y); if (c) out.push(c); };
    const fork = pop.fork || null;
    const rp = routePiece(p, fork);
    const route = (rp && rp.path) || [];
    if (pop.type === "point" || pop.type === "line") {
      // the point popup edits route[seg]; the line popup opens near seg's leg. Cover
      // the endpoint waypoint plus the tangent controls that fan out from it.
      const i = pop.seg;
      const s = route[i];
      if (s) {
        add(s.x, s.y);
        if (s.type === "C") add(s.c2x, s.c2y); else if (s.type === "Q") add(s.cx, s.cy);
        const nx = route[i + 1];
        if (nx && nx.type === "C") add(nx.c1x, nx.c1y); else if (nx && nx.type === "Q") add(nx.cx, nx.cy);
        if (i === 0) { add(rp.x, rp.y); if (s.type === "C") add(s.c1x, s.c1y); }
      }
      if (pop.type === "line" && pop.pt) add(pop.pt.x, pop.pt.y);
    } else if (pop.type === "piece") {
      add(p.x, p.y);
      const s0 = route[0];
      if (s0 && s0.type === "C") add(s0.c1x, s0.c1y); else if (s0 && s0.type === "Q") add(s0.cx, s0.cy);
      // a stationary player exposes a rotate ring (radius ~7 ft) — keep clear of it
      if (p.kind === "player" && !(p.path && p.path.length))
        for (let a = 0; a < 360; a += 45) add(p.x + 7 * Math.cos(a * Math.PI / 180), p.y + 7 * Math.sin(a * Math.PI / 180));
    }
    return out;
  }
  // obstacle points (client px) for placement — route samples + icon centres of
  // every piece, split into the working chain vs everything else
  function obstaclePoints(chain) {
    const chainPts = [], otherPts = [];
    pieces.forEach(p => {
      if (p.kind === "mark" || p.kind === "label") return;
      const bucket = chain.has(p.id) ? chainPts : otherPts;
      const c = rinkToClient(p.x, p.y);
      if (c) bucket.push(c);
      if (p.path && p.path.length) routeClientPoints(p).forEach(q => bucket.push(q));
    });
    return { chainPts, otherPts };
  }
  // choose a clear-space position for the popup at its just-measured size. Prefer
  // a fully clear spot; failing that, one that covers other pieces but NOT the
  // chain being edited. Returns {top,left} in offsetParent px, or null to keep
  // the responsive edge-anchor (when the natural spot is already clear).
  function computePlacement() {
    const el = popRef.current;
    if (!el || !popup) return null;
    const par = el.offsetParent || el.parentElement;
    if (!par) return null;
    const cr = par.getBoundingClientRect();
    const r0 = el.getBoundingClientRect();               // the popup as rendered at its anchor
    const w = r0.width, h = r0.height, pad = 8;
    // three obstacle tiers, worst-to-cover first: the SELECTED item itself (its
    // icon + the drag handles you're about to reach for), then the rest of its
    // working chain, then every other piece. Covering the item you clicked is the
    // cardinal sin — rank it strictly worse so the popup never lands on it while a
    // spot that only clips a distant route leg exists. SELF_M keeps a comfortable
    // margin around the item (a point sample alone doesn't cover the icon's body).
    const selfPts = targetHandlePoints(popup);
    const { chainPts, otherPts } = obstaclePoints(workingChainIds(popup.id));
    const allPts = selfPts.concat(chainPts, otherPts);
    const SELF_M = 24;
    const coversPts = (left, top, pts, m) => pts.some(c =>
      c.x >= left - m && c.x <= left + w + m && c.y >= top - m && c.y <= top + h + m);
    const rankAt = (left, top) =>
      coversPts(left, top, selfPts, SELF_M) ? 3
      : coversPts(left, top, chainPts, pad) ? 2
      : coversPts(left, top, otherPts, pad) ? 1 : 0;
    // the responsive edge-anchor already opens on the side OPPOSITE the item, so
    // it usually clears the item on its own. Keep it unless the search can find a
    // STRICTLY better tier — that stops the search from dragging the popup back
    // onto the item just to chase a marginally larger open gap.
    const anchorRank = rankAt(r0.left, r0.top);
    if (anchorRank === 0) return null;
    // search open space. INSET keeps a placed popup off the boards (sitting in
    // from the edge) rather than flush against them.
    const INSET = 20;
    const TOP = cr.top + 74 + INSET, BOT = cr.bottom - 66 - INSET, LEFT = cr.left + 8 + INSET, RIGHT = cr.right - 8 - INSET;
    const clampL = x => Math.max(LEFT, Math.min(x, RIGHT - w));
    const clampT = y => Math.max(TOP, Math.min(y, Math.max(TOP, BOT - h)));
    // clearance = distance from the candidate rect to the NEAREST obstacle point;
    // bigger = more open space, so we bias toward the largest open area
    const distToRect = (c, left, top) =>
      Math.hypot(Math.max(left - c.x, 0, c.x - (left + w)), Math.max(top - c.y, 0, c.y - (top + h)));
    const clearance = (left, top) => allPts.reduce((m, c) => Math.min(m, distToRect(c, left, top)), Infinity);
    const NX = 6, NY = 4, lefts = [], tops = [];
    for (let k = 0; k < NX; k++) lefts.push(clampL(LEFT + (RIGHT - w - LEFT) * (NX > 1 ? k / (NX - 1) : 0)));
    for (let k = 0; k < NY; k++) tops.push(clampT(TOP + (BOT - h - TOP) * (NY > 1 ? k / (NY - 1) : 0)));
    let best = null;
    tops.forEach(top => lefts.forEach(left => {
      const rank = rankAt(left, top);
      const score = rank * 1e7 - clearance(left, top);   // low rank first, then most open
      if (!best || score < best.score) best = { left, top, rank, score };
    }));
    // only move when we strictly beat the responsive anchor's tier; otherwise keep
    // the anchor (its opposite-edge spot already clears the clicked item)
    if (!best || best.rank >= anchorRank) return null;
    return { top: best.top - cr.top, left: best.left - cr.left };
  }
  // Prev/Next through a piece's waypoints: keep the user's size, and keep the
  // popup put when it isn't covering its own route; otherwise re-place it into
  // open space (preferring not to cover the chain it's editing).
  function navPopup(target) {
    setSelectedId(target.id);
    const el = popRef.current;
    if (el) {
      preservePopPos.current = true;                     // preserve size + our chosen position this step
      const par = el.offsetParent || el.parentElement;
      const cr = par.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!popupCoversRoute(target.id)) setPopPos({ top: r.top - cr.top, left: r.left - cr.left });
      else setPopPos(computePlacement());                // null → responsive anchor
      setPopOff({ x: 0, y: 0 });
      // popDim is left untouched, so a user's resize carries to the next step
    }
    setPopup(target);
  }

  // Safari (non-standalone): for a non-scrolling page the layout viewport
  // stays at the toolbar-visible size even in full-screen mode, leaving a
  // dead band where the toolbar was. The visual viewport tracks toolbar
  // state live, so pin the root's height to it. Standalone home-screen
  // mode is excluded — its layout is handled purely in CSS.
  const rootRef = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    const standalone = navigator.standalone === true ||
      (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (!vv || standalone) return;
    const el = rootRef.current;
    if (!el) return;
    const apply = () => {
      el.style.height = Math.round(vv.height + vv.offsetTop) + "px";
      el.style.bottom = "auto";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
      el.style.height = "";
      el.style.bottom = "";
    };
  }, []);

  const [showDiag, setShowDiag] = useState(false);

  // iOS 26 standalone bug: the viewport is sized as if the status bar were
  // opaque (screen − safeTop) but positioned as if translucent (at y=0),
  // leaving an unrenderable dead band at the bottom exactly safeTop tall.
  // When that signature is present, our own home-indicator inset is
  // pointless (the viewport never reaches the indicator) — zero it and
  // reclaim the space. Signature: standalone + translucent inset active +
  // physical height − innerHeight ≈ safeTop.
  useEffect(() => {
    const standalone = navigator.standalone === true ||
      (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (!standalone) return;
    const el = rootRef.current;
    if (!el) return;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)";
    document.body.appendChild(probe);
    const apply = () => {
      const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
      const portrait = matchMedia("(orientation: portrait)").matches;
      const phys = portrait
        ? Math.max(screen.width, screen.height)
        : Math.min(screen.width, screen.height);
      const deficit = phys - window.innerHeight - safeTop;
      const stolen = safeTop > 20 && Math.abs(deficit) <= 4;
      if (stolen) el.style.setProperty("--hd-safe-b", "0px");
      else el.style.removeProperty("--hd-safe-b");
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      probe.remove();
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

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
  const autoRotated =
    Math.abs(Math.log(sa / (vhF / vwF))) < Math.abs(Math.log(sa / (vwF / vhF)));
  // half ice: orientation is the user's choice (rink menu) — four compass
  // orientations: 0 = net right, 180 = net left, 90 = net bottom, 270 = net
  // top; full/quarter keep the fill-mode auto orientation (0 or 90).
  const screenRot = rink === "half"
    ? (halfNS ? (halfFlip ? 270 : 90) : (halfFlip ? 180 : 0))
    : (autoRotated ? 90 : 0);
  const swapAxes = screenRot === 90 || screenRot === 270; // view turned vertical
  let canvasW = Math.max(50, stageSize.w);
  let canvasH = Math.max(20, stageSize.h);
  // Full and half ice fill the stage. Quarter is constrained to its true
  // proportions up to a small over-stretch (the canvas letterboxes).
  if (isQuarter(rink)) {
    const vbW = swapAxes ? vhF : vwF, vbH = swapAxes ? vwF : vhF; // effective viewBox dims
    const CAP = 1.12;                                             // max stretch past true aspect
    canvasH = Math.min(canvasH, Math.round((canvasW * vbH) / vbW * CAP));
    canvasW = Math.min(canvasW, Math.round((canvasH * vbW) / vbH * CAP));
  }
  // Full ice with "Stretch to fill" OFF — and half ice always (it keeps true
  // 100'×85' proportions) — letterbox inside the viewBox instead of shrinking
  // the canvas: the rink sits amid padded off-ice space, so zooming can expand
  // it to fill the whole stage rather than staying boxed between letterbox
  // bands. (Half ice additionally clips the scene to its viewBox rect so the
  // padding never reveals the other half of the rink.)
  let padX = 0, padY = 0;
  if ((rink === "full" && !stretchFill) || rink === "half") {
    const baseW = swapAxes ? vhF : vwF, baseH = swapAxes ? vwF : vhF;
    const want = canvasW / Math.max(1, canvasH);                  // stage aspect
    if (want > baseW / baseH) padX = (baseH * want - baseW) / 2;
    else padY = (baseW / want - baseH) / 2;
  }
  // maps rink coords into the rotated viewBox: 90° -> (my+vh-y, x-mx),
  // 180° -> (mx+vw-x, my+vh-y), 270° -> (y-my, mx+vw-x)
  const sceneTransform =
    screenRot === 90 ? `rotate(90) translate(${-mxF} ${-(myF + vhF)})`
    : screenRot === 180 ? `rotate(180) translate(${-(mxF + vwF)} ${-(myF + vhF)})`
    : screenRot === 270 ? `rotate(-90) translate(${-(mxF + vwF)} ${-myF})`
    : undefined;
  // the root viewBox the pinch-zoom transform operates in (vertical swaps
  // axes; any rotation re-origins the root at 0,0 via the scene transform;
  // letterbox padding widens it symmetrically)
  geomRef.current = swapAxes
    ? { ox: -padX, oy: -padY, rootW: vhF + 2 * padX, rootH: vwF + 2 * padY }
    : screenRot === 180
      ? { ox: -padX, oy: -padY, rootW: vwF + 2 * padX, rootH: vhF + 2 * padY }
      : { ox: mxF - padX, oy: myF - padY, rootW: vwF + 2 * padX, rootH: vhF + 2 * padY };
  const rootGeom = geomRef.current;
  const zoomXf = view.s !== 1 || view.tx || view.ty ? `translate(${view.tx} ${view.ty}) scale(${view.s})` : undefined;
  // "Mark opacity" fades only the drawn drill markings (routes, forks, stops,
  // freehand ink, shot-aim). Players/pucks/cones/nets and editing UI stay opaque.
  const markMO = markOpacity < 1 ? markOpacity : undefined;
  // roundness correction: the fill-mode stretch scales the two rink axes
  // differently; circles are drawn as ellipses with ry scaled by yFix so
  // they render perfectly round on screen after the stretch. Expressed in
  // root-viewBox scales so viewBox letterbox padding is accounted for.
  const yFix = (() => {
    const sx = swapAxes ? canvasH / rootGeom.rootH : canvasW / rootGeom.rootW;
    const sy = swapAxes ? canvasW / rootGeom.rootW : canvasH / rootGeom.rootH;
    return sy > 0 ? Math.max(0.2, Math.min(5, sx / sy)) : 1;
  })();
  // a handle dot that stays a true circle on screen despite the fill-mode
  // stretch: an ellipse whose y-radius is pre-compensated by yFix
  // yf defaults to the main-scene stretch; the loupe (its own square viewBox is
  // NOT stretched) passes yf=1 so its handles stay true circles too
  const hdot = (cx, cy, r, { key, ...props } = {}, yf = yFix) => <ellipse key={key} cx={cx} cy={cy} rx={r} ry={r * yf} {...props} />;
  // screen-true icon frames: the fill-mode stretch (and scene rotation)
  // squish icons and shear them at diagonal headings. Each icon is drawn
  // inside a matrix that cancels the local stretch and re-applies its
  // heading as a pure screen rotation at a uniform scale (geometric mean
  // of the two axis scales, so sizes stay consistent in any orientation).
  const iconGeom = (() => {
    const Sx = Math.max(1e-6, swapAxes ? canvasH / rootGeom.rootH : canvasW / rootGeom.rootW);
    const Sy = Math.max(1e-6, swapAxes ? canvasW / rootGeom.rootW : canvasH / rootGeom.rootH);
    return { Sx, Sy, k: ICON_SCALE * Math.sqrt(Sx * Sy) };
  })();
  // exact rotation terms for screenRot ∈ {0, 90, 180, 270} (avoids fp drift)
  const rotCf = screenRot === 0 ? 1 : screenRot === 180 ? -1 : 0;
  const rotSf = screenRot === 90 ? 1 : screenRot === 270 ? -1 : 0;
  function iconXf(pos) {
    const { Sx, Sy, k } = iconGeom;
    const a = ((pos.a || 0) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    // root-axis scales: the rink-axis scales re-labelled when the view is vertical
    const sW = swapAxes ? Sy : Sx, sH = swapAxes ? Sx : Sy;
    // on-screen direction of the piece's rink heading: rotate, then stretch
    const th = Math.atan2(sH * (rotSf * c + rotCf * s), sW * (rotCf * c - rotSf * s));
    const ct = Math.cos(th), st = Math.sin(th);
    // M = R(-rot)·diag(1/sW,1/sH)·k·R(th): cancels the scene rotation and the
    // stretch, re-applies the heading as a pure screen rotation at uniform k
    const m00 = (rotCf * (k * ct)) / sW + (rotSf * (k * st)) / sH;
    const m01 = (rotCf * (-k * st)) / sW + (rotSf * (k * ct)) / sH;
    const m10 = (-rotSf * (k * ct)) / sW + (rotCf * (k * st)) / sH;
    const m11 = (rotSf * (k * st)) / sW + (rotCf * (k * ct)) / sH;
    return {
      t: `translate(${pos.x} ${pos.y}) matrix(${m00} ${m10} ${m01} ${m11} 0 0)`,
      th: (th * 180) / Math.PI,
    };
  }
  // rink→screen anisotropy: `strokeAR` un-skews the backward-skating zigzag;
  // `strokeK` is the isotropic screen scale so strokes drawn with
  // vector-effect:non-scaling-stroke keep their intended on-ice weight
  const strokeAR = iconGeom.Sx / iconGeom.Sy;
  const strokeK = Math.sqrt(iconGeom.Sx * iconGeom.Sy);
  // move `g` geometric-mean feet from (cx,cy) along raw unit dir (ux,uy) — so a gap
  // clears the round (stretch-compensated) badge/icon by the same amount in every
  // direction, regardless of the fill-mode stretch (badges vs raw-rink offsets)
  const gmSar = Math.sqrt(strokeAR);
  const gmMove = (cx, cy, ux, uy, g) => {
    const gl = Math.hypot(ux * gmSar, uy / gmSar) || 1;
    return { x: cx + ux * (g / gl), y: cy + uy * (g / gl) };
  };
  // scale a stroke width (rink feet) to non-scaling-stroke screen px
  const sw = w => +(w * strokeK).toFixed(2);
  // scale a dash pattern string ("2.4 1.8") the same way
  const sdash = d => d.split(/\s+/).map(n => +(parseFloat(n) * strokeK).toFixed(2)).join(" ");

  /* ----- timing & pass planning (see timing.js) ----- */
  const planCache = useRef({ key: null, pace: 0, sig: -1, warp: {}, plans: {}, rel: {} });
  // a second plan used ONLY for the grey puck-route preview: it shows INTENT
  // (every shot on net), so it's timed with realistic misses forced off. The
  // animation still uses the main plan above, which may ring the post / sail
  // wide / go over — but the planning view always draws the shot going to the net.
  const intentPlanCache = useRef({ key: null, pace: 0, sig: -1, warp: {}, plans: {}, rel: {} });
  // the resolved trigger→effect state from the LAST resolveForks pass (routes taken,
  // per-player possession, reach, and release facts). resolveForks runs first each
  // render and commits it here, so the other resolveRoute callers (lightReactionEvents,
  // chosenForkRefs) read the same answers a possession/link/event branch was chosen by.
  const solvedRef = useRef({ routes: {}, reach: {}, reachT: {}, poss: {}, released: {} });
  // fork-free drills still lower puck terminals; the result depends only on rpieces,
  // so cache by identity to keep timing's identity-keyed plan cache warm
  const lowerCacheRef = useRef({ key: null, out: null });
  // timing runs on the nearest-resolved model: any "Collect nearest puck" intent
  // re-binds to whichever loose puck is actually closest right now. Rendering &
  // editing stay on raw `pieces` (displayPosAt keys plans by id, so it lines up).
  const rpieces = useMemo(() => resolveNearest(pieces), [pieces]);
  // the condition-aware possession ledger (stints / loose pucks / per-action
  // viability proofs) — pure over the raw authoring model, shared by the action
  // menu and the step warnings
  const posLedger = useMemo(() => buildLedger(pieces), [pieces]);
  // ARRIVAL REGISTRY — every renderer that lands an arrowhead/carat registers its
  // natural TIP position (the landing point pulled back by its base stand-off along
  // its own incoming direction) and steps back 3.2 ft for each earlier tip within
  // ~3.6 ft. Keying on the TIP — not the landing point — is what makes it read
  // right: two passes into the SAME catch waypoint from clearly different angles
  // have tips on different sides of the badge ring and don't stagger, while
  // same-direction arrivals queue. Swing a route so the approach angle changes and
  // the stagger dissolves the moment the tips clear. Recreated every render →
  // claims follow the fixed layer order, deterministic frame to frame.
  const arrivalReg = new Map();
  const arrivalBack = (scene, x, y, step = 3.2, radius = 2.4) => {
    if (!arrowStagger) return 0;   // "Tidy arrowheads" off → every mark lands exactly where drawn
    let list = arrivalReg.get(scene);
    if (!list) arrivalReg.set(scene, (list = []));
    const n = list.reduce((a, p) => a + (Math.hypot(p.x - x, p.y - y) < radius ? 1 : 0), 0);
    list.push({ x, y });
    return n * step;
  };
  // Stage-2 light reactions: a branching player skates a base route to its end
  // (the "branch"), then continues on the colour-tagged fork matching the light's
  // cue at the instant they arrive. The branch arrival time depends only on the
  // BASE route, so we can pick the fork and splice it onto the path here — before
  // timing runs — leaving the timing engine unchanged (it just sees a longer path).
  const effPieces = resolveForks(rpieces);
  // branching players are animated along their spliced (base+fork) path — map id
  // → effective piece so position sampling follows the reaction, not the base end
  const effById = new Map(effPieces.map(p => [p.id, p]));
  const effOf = p => p && p.kind === "player" && (p.forks || []).length ? (effById.get(p.id) || p) : p;
  const { getPlan, pieceTime, displayPosAt, stickSwing, stickSpot, catchApproach, releaseDepart, puckInFlight, waypointTime, puckInGoal } = createTiming({ pieces: effPieces, pace, segRefs, planCache, seed: playSeed, realisticShots: effRealistic, detail: effDetail, odds: shotOdds });
  // intent plan for the route preview (identical to the main plan but with misses
  // off, so shots always route on net). Only built when realistic shots are on and
  // the puck-path overlay is actually shown; otherwise the main plan already IS the
  // intent, so reuse it.
  const wantPuckPaths = !aiPlay && (editing || whiteboard || routeVis(playRoutes).puck);
  const getIntentPlan = (!effRealistic || !wantPuckPaths) ? getPlan
    : createTiming({ pieces: effPieces, pace, segRefs, planCache: intentPlanCache, seed: playSeed, realisticShots: false, detail: effDetail, odds: shotOdds }).getPlan;

  // a light's cue timeline can outlast every route — keep the drill running long
  // enough to show every cue (so a "read the light" reaction has time to resolve)
  const cueSpan = p => p.kind === "light" && p.cues ? p.cues.reduce((a, c) => a + Math.max(0.1, c.dur || 0), 0) : 0;
  // How long the DRILL is — what a coach reads off the panel.
  const drillTime = Math.max(0.1, ...effPieces.map(pieceTime), ...effPieces.map(cueSpan));
  // ...and how long the ANIMATION runs. The last thing to happen in most drills is a
  // skater stopping, and a stop is not instant: the hockey-stop plant settles back
  // square and the snow it throws drifts out and fades. With the clock ending on the
  // same frame the last leg does, none of that ever played — it was cut off mid-bite
  // and the loop snapped straight back to the start. A short tail lets it finish.
  // Idle time only: every leg time is absolute, so nothing in the drill moves.
  const END_HOLD = 0.8;
  const totalTime = drillTime + END_HOLD;
  const hasTimeline = totalTime > 0.1001; // static board (no routes/cues) → no player bar
  totalRef.current = totalTime;

  // natural phrase for an area name mid-sentence ("Dot lane" -> "the dot lane")
  const areaPhrase = z => {
    const l = z.toLowerCase();
    return l.startsWith("the ") || l.startsWith("behind") ? l : "the " + l;
  };
  const joinAreas = a => a.length <= 1 ? (a[0] || "")
    : a.length === 2 ? `${a[0]} and ${a[1]}`
    : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
  // distinct ice areas a leg threads through, excluding its start and end zones
  function legZones(p, i) {
    const el = segRefs.current[`${p.id}/${i}`];
    if (!el) return [];
    let L = 0; try { L = el.getTotalLength(); } catch { return []; }
    if (!L) return [];
    const start = i === 0 ? { x: p.x, y: p.y } : { x: p.path[i - 1].x, y: p.path[i - 1].y };
    // "The point" is only meaningful as a destination (shoot/pass/hold there),
    // never as a space skated through — exclude it from the traversed list
    const seen = new Set([zoneAt(start.x, start.y), zoneAt(p.path[i].x, p.path[i].y), "The point"]);
    const out = [];
    const steps = Math.max(4, Math.ceil(L / 4));
    for (let k = 0; k <= steps; k++) {
      let pt; try { pt = el.getPointAtLength((L * k) / steps); } catch { continue; }
      const z = zoneAt(pt.x, pt.y);
      if (z && !seen.has(z)) { seen.add(z); out.push(z); }
    }
    return out;
  }

  // Auto-describe the play's major beats (puck events) as timed steps. Used as the
  // presentation fallback when no steps are authored, and as the seed for the
  // "Generate from play" button (which converts these into editable authored steps).
  function buildSteps() {
    const { plans } = getPlan();
    const nameOf = id => { const q = pieces.find(x => x.id === id); return (q && q.label) || id; };
    const evs = [];
    pieces.forEach(pk => {
      if (pk.kind !== "puck") return;
      const plan = plans[pk.id];
      if (!plan) return;
      plan.legs.forEach((leg, i) => {
        if (leg.type === "ride" && leg.catch) {
          const prev = plan.legs[i - 1];
          const who = nameOf(leg.id);
          if (prev && prev.type === "free") evs.push({ t: leg.t0, key: `${pk.id}:pickup:${i}`, auto: `${who} picks up the puck` });
          else if (prev && (prev.type === "rest" || prev.type === "skid")) evs.push({ t: leg.t0, key: `${pk.id}:collect:${i}`, auto: `${who} collects the rebound` });
          // a normal pass reception (prev is a pass fly) is covered by its pass step
        } else if (leg.type === "fly") {
          if (leg.shot) {
            const out = leg.goal ? " — scores!" : leg.save ? " — save!" : leg.post ? " — off the post!"
              : leg.wide ? " — wide!" : leg.over ? " — over the net!" : "";
            evs.push({ t: leg.t0, key: `${pk.id}:shot:${i}`, auto: `${nameOf(leg.by)} shoots on net${out}` });
          }
          else if (leg.by) {   // a real pass leg names its passer; loose roll legs (a
                               // miss gliding to rest) have none — don't caption those
            const next = plan.legs[i + 1];
            const to = next && next.id ? ` to ${nameOf(next.id)}` : "";
            evs.push({ t: leg.t0, key: `${pk.id}:pass:${i}`, auto: `${nameOf(leg.by)} passes${to}` });
          }
        }
      });
    });
    // player movement beats: named waypoints and each route's finish, named by
    // the waypoint's own name, else the ice area it lands in, else "point N".
    // With minor descriptions on, every leg that threads a distinct area gets a
    // beat too, worded "…skates through the dot lane to the slot". Each caption
    // fires at the START of the leg (arrival at the previous point, or t=0) so
    // it reads before the player actually skates there.
    pieces.forEach(p => {
      if (p.kind !== "player" || !p.path.length) return;
      p.path.forEach((s, i) => {
        const isLast = i === p.path.length - 1;
        const through = minorDesc ? legZones(p, i) : [];
        const dm = s.dmode || (s.desc ? "auto" : null);
        // a "presentation" description reads as its own caption, verbatim
        if (s.desc && dm === "preso") {
          evs.push({ t: waypointTime(p, i - 1), key: `${p.id}:say:${i}`, auto: s.desc });
          return;
        }
        // an "auto" description names the waypoint; a "label" one is on-ice only
        const cap = s.desc && dm === "auto" ? s.desc : s.name;
        if (!cap && !isLast && through.length === 0) return;
        const zn = zoneAt(s.x, s.y);
        const where = cap ? cap : zn ? areaPhrase(zn) : `point ${i + 1}`;
        const via = through.length ? ` through ${joinAreas(through.map(areaPhrase))}` : "";
        evs.push({ t: waypointTime(p, i - 1), key: `${p.id}:move:${i}`, auto: `${nameOf(p.id)} skates${via} to ${where}` });
      });
    });
    evs.sort((a, b) => a.t - b.t);
    const steps = [{ t: 0, key: "start", auto: "The play begins" }, ...evs];
    return steps.map(s => ({ ...s, text: s.auto }));
  }

  // Resolve the authored `drillSteps` into playable/displayable rows. A waypoint
  // anchor (on=) resolves its time live via waypointTime — so it tracks edits and
  // retiming; an absolute (at=) anchor is clamped into the drill's length. An
  // anchor whose piece/waypoint no longer exists is kept (resolved:false) so the
  // editor can flag it and undo can restore it, but it's dropped from the timeline.
  function resolveSteps() {
    const T = Math.max(0.1, totalTime);
    return (drillSteps || []).map((s, idx) => {
      if (s.on) {
        const pc = effById.get(s.on.piece) || pieces.find(p => p.id === s.on.piece);
        if (pc && pc.kind === "player" && (pc.path || []).length > s.on.wp && s.on.wp >= 0) {
          return { ...s, idx, key: `step:${idx}`, resolved: true,
            t: waypointTime(effOf(pc), s.on.wp), label: `${pc.label || pc.id} · pt ${s.on.wp + 1}` };
        }
        return { ...s, idx, key: `step:${idx}`, resolved: false, t: 0, label: "point missing" };
      }
      const t = Math.min(s.at || 0, T);
      return { ...s, idx, key: `step:${idx}`, resolved: true, t, label: `${(s.at || 0).toFixed(1)}s` };
    });
  }
  // every authored row (incl. unresolved), for the editor; the resolved subset for
  // the scrubber ticks; and the non-empty subset that actually pauses playback.
  const allSteps = (presentation || openMenu === "steps") ? resolveSteps() : [];
  const timelineSteps = allSteps.filter(s => s.resolved).slice().sort((a, b) => a.t - b.t);
  const playSteps = timelineSteps.filter(s => (s.text || "").trim());
  // editor rows: resolved first (by time), unresolved (waypoint gone) last
  const editRows = allSteps.slice().sort((a, b) => a.resolved === b.resolved ? a.t - b.t : (a.resolved ? -1 : 1));
  // feed the RAF loop: authored steps win once any exist; otherwise fall back to
  // the legacy auto-derivation so pre-existing drills still narrate in presentation.
  stepsRef.current = presentation
    ? (drillSteps.length ? playSteps : buildSteps())
    : playSteps;
  presoDelayRef.current = presoDelay;
  readCpsRef.current = (READ_PACES[readPace] || READ_PACES[READ_PACE_DEFAULT]).cps;
  presoRef.current = presentation;
  loopRef.current = loopMode;
  loopPauseRef.current = loopPause;

  // ----- presentation-step authoring (scrub → pause → describe) -----
  // seek the paused animation to a normalized position (keeps ref + state in step)
  function scrubTo(v) { const t = Math.max(0, Math.min(1, v)); animRef.current = t; setAnimT(t); }
  // nearest player BASE-route waypoint activation to a time (seconds), within a
  // small window. Base waypoints are stable under edits (we reindex them) and
  // independent of which light-reaction fork resolves; fork points aren't anchored.
  function nearestWaypoint(nowSec) {
    const eps = Math.max(0.12, totalTime * 0.01);
    let best = null;
    pieces.forEach(p => {
      if (p.kind !== "player" || !(p.path || []).length) return;
      const ep = effOf(p);
      p.path.forEach((_, i) => {
        const dt = Math.abs(waypointTime(ep, i) - nowSec);
        if (dt <= eps && (!best || dt < best.dt)) best = { piece: p.id, wp: i, dt };
      });
    });
    return best;
  }
  // keep step waypoint-anchors valid when a player's route gains/loses a point
  // (mirrors shiftActionWaypoints for puck actions). Insert at segIdx bumps later
  // anchors up; delete of point i pulls later ones down and pins an anchor ON i to
  // its (pre-delete) absolute time so the note survives.
  const stepsOnInsert = (playerId, segIdx) => setDrillSteps(prev => prev.map(s =>
    s.on && s.on.piece === playerId && s.on.wp >= segIdx ? { ...s, on: { ...s.on, wp: s.on.wp + 1 } } : s));
  const stepsOnDelete = (playerId, i) => setDrillSteps(prev => prev.map(s => {
    if (!s.on || s.on.piece !== playerId) return s;
    if (s.on.wp === i) { const ep = effById.get(playerId); return { text: s.text, at: ep ? waypointTime(ep, i) : 0 }; }
    return s.on.wp > i ? { ...s, on: { ...s.on, wp: s.on.wp - 1 } } : s;
  }));
  // drop a new step at the current paused position: prefer a nearby waypoint anchor
  // (robust to edits), else pin the absolute time. The caption then appears ON the
  // ice for the coach to type + drag into place (its spot saves with the step).
  function addStepHere() {
    const nowSec = animT * totalTime;
    const wp = nowSec > Math.max(0.12, totalTime * 0.01) ? nearestWaypoint(nowSec) : null;
    const idx = drillSteps.length;
    setDrillSteps(s => [...s, wp ? { text: "", on: { piece: wp.piece, wp: wp.wp } } : { text: "", at: nowSec }]);
    setPlaying(false); setHoldStep(null); holdRef.current = 0;
    setOpenMenu(null); setPopup(null); setEditAnchor(null);
    setPlacingStep(idx);
  }
  // re-open an existing step for on-ice placement: seek to its beat, pause, show it
  function enterPlacing(idx) {
    const r = resolveSteps()[idx];
    if (r && r.resolved) scrubTo(Math.min(1, r.t / Math.max(0.1, totalTime)));
    setPlaying(false); setHoldStep(null); holdRef.current = 0;
    setOpenMenu(null); setPopup(null); setEditAnchor(null);
    setPlacingStep(idx);
  }
  const setStepText = (idx, text) => setDrillSteps(s => s.map((x, k) => k === idx ? { ...x, text } : x));
  const setStepPos = (idx, pos) => setDrillSteps(s => s.map((x, k) => k === idx ? { ...x, pos } : x));
  const deleteStep = idx => { setDrillSteps(s => s.filter((_, k) => k !== idx)); setEditAnchor(null); };
  // pin a step to an absolute time (seconds); drops any waypoint anchor, keeps text + pos
  const setStepTime = (idx, sec) => setDrillSteps(s => s.map((x, k) => {
    if (k !== idx) return x;
    const { on, ...rest } = x; return { ...rest, at: Math.max(0, sec) };
  }));
  // anchor a step to a player's waypoint; drops any time anchor, keeps text + pos
  const setStepWaypoint = (idx, piece, wp) => setDrillSteps(s => s.map((x, k) => {
    if (k !== idx) return x;
    const { at, ...rest } = x; return { ...rest, on: { piece, wp } };
  }));
  // players that carry a route, for the waypoint-anchor picker
  const stepPlayers = pieces.filter(p => p.kind === "player" && (p.path || []).length);
  const stepWpCount = pid => { const p = pieces.find(x => x.id === pid); return p ? (p.path || []).length : 0; };
  // drag the placing caption around the app rect; its centre saves as pos (0..1),
  // clamped to stay over the ice (above the scrubber band / away from the edges).
  const capDrag = useRef(false);
  function capDragStart(e) {
    if (placingStep == null) return;
    capDrag.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  }
  function capDragMove(e) {
    if (!capDrag.current) return;
    // store the caption anchor in RINK FEET (svgPt maps client px → feet through the
    // scene CTM, so it's correct in either orientation and clamps to the ice)
    const rk = svgPt(e);
    setStepPos(placingStep, { x: +rk.x.toFixed(1), y: +rk.y.toFixed(1) });
  }
  const capDragEnd = () => { capDrag.current = false; };
  // project a rink point (feet) to a fraction of the app rect, so the caption holds
  // the same ice area across portrait/landscape (rinkToClient goes through the scene
  // CTM). null until the SVG has laid out.
  function rinkToRootFrac(rx, ry) {
    const root = rootRef.current, c = rinkToClient(rx, ry);
    if (!root || !c) return null;
    const r = root.getBoundingClientRect();
    return { x: (c.x - r.left) / r.width, y: (c.y - r.top) / r.height };
  }
  // place the caption's centre at its (projected) spot; clamp() keeps the box fully
  // on screen (--cap-hw = its max half-width) and clear of the top dock / scrubber
  // band. When placing, the top gets extra room for the control tabs above the box.
  // No pos → the CSS default (bottom-centre). Arg is a 0..1 app-rect fraction.
  const captionStyle = (pos, placing) => pos ? {
    left: `clamp(calc(var(--cap-hw) + 6px), ${(pos.x * 100).toFixed(2)}%, calc(100% - var(--cap-hw) - 6px))`,
    top: `clamp(calc(env(safe-area-inset-top, 0px) + ${placing ? 96 : 58}px), ${(pos.y * 100).toFixed(2)}%, calc(100% - 54px - var(--hd-b) - var(--hd-act) - 58px))`,
    right: "auto", bottom: "auto", transform: "translate(-50%, -50%)",
  } : undefined;
  // seed the editable caption + focus it when a step's placement begins (kept out of
  // React's control so typing doesn't reset the box or jump the cursor)
  const edRef = useRef(null);
  useEffect(() => {
    const el = edRef.current;
    if (placingStep == null || !el) return;
    el.textContent = drillSteps[placingStep]?.text || "";
    el.focus();
    const sel = window.getSelection && window.getSelection();
    if (sel) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  }, [placingStep]); // eslint-disable-line
  // switch a step to an absolute-time anchor, seeding it with the step's current
  // resolved time (so a waypoint→time flip lands where the note already fired).
  function anchorToTime(idx) {
    const r = resolveSteps()[idx];
    setStepTime(idx, r ? +r.t.toFixed(1) : 0);
  }
  // switch a step to a waypoint anchor: snap to the nearest activation to its
  // current time, else fall back to the first player's first waypoint.
  function anchorToWaypoint(idx) {
    const r = resolveSteps()[idx];
    const wp = nearestWaypoint(r ? r.t : 0) || (stepPlayers[0] ? { piece: stepPlayers[0].id, wp: 0 } : null);
    if (wp) setStepWaypoint(idx, wp.piece, wp.wp);
  }
  // materialize the legacy auto-derivation into editable authored steps: movement
  // beats become waypoint anchors (wp = i-1, where buildSteps fires them), puck
  // events (pass/shot/pickup/collect) stay time-anchored.
  function generateSteps(force = false) {
    if (drillSteps.length && !force) { setGenAsk(true); return; }
    setGenAsk(false);
    const raw = buildSteps().filter(s => s.key !== "start");
    setDrillSteps(raw.map(s => {
      const m = /^([^:]+):(?:move|say):(\d+)$/.exec(s.key);
      if (m) {
        const pid = m[1], wp = parseInt(m[2], 10) - 1;
        if (wp >= 0 && pieces.some(p => p.id === pid && p.kind === "player")) return { text: s.text, on: { piece: pid, wp } };
      }
      return { text: s.text, at: s.t };
    }));
    flash("Steps generated from the play");
  }
  // Scrubber tick positions (fractions 0..1): player waypoint activations and
  // steps. Wide screens only — a phone's track is ~70px, and a drill with a few
  // players puts a tick every couple of pixels, which reads as one thick smear
  // rather than as marks you could aim at. Skipped, not hidden: this is a
  // waypointTime() per waypoint plus a resolveSteps() every render, and there's
  // no reason a phone should pay for marks it will never draw.
  const scrubDur = Math.max(0.1, totalTime);
  const wpTicks = [];
  if (dense && !aiPlay) effPieces.forEach(p => { if (p.kind === "player") (p.path || []).forEach((_, i) => wpTicks.push(Math.min(1, waypointTime(p, i) / scrubDur))); });
  const stepTicks = (dense && !aiPlay && drillSteps.length)
    ? resolveSteps().filter(s => s.resolved).map(s => Math.min(1, s.t / scrubDur)) : [];

  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    // skip steps already behind the current position when (re)starting
    const nowT = animRef.current * Math.max(0.1, totalRef.current);
    nextStepRef.current = stepsRef.current.filter(s => s.t < nowT - 1e-3).length;
    holdRef.current = 0; loopPendingRef.current = false;
    const step = now => {
      const dt = (now - last) / 1000;
      last = now;
      const T = Math.max(0.1, totalRef.current);
      if (holdRef.current > 0) {                       // paused, reading a step
        holdRef.current -= dt;
        if (holdRef.current <= 0) {
          holdRef.current = 0; setHoldStep(null);
          if (loopPendingRef.current) {                // end-of-drill pause done → restart
            loopPendingRef.current = false;
            animRef.current = 0; setAnimT(0); nextStepRef.current = 0; setPlaySeed(s => s + 1);
          }
        }
        raf = requestAnimationFrame(step);
        return;
      }
      let t = animRef.current + dt / T;
      const steps = presoRef.current ? stepsRef.current : null;
      if (steps && nextStepRef.current < steps.length) {
        const st = steps[nextStepRef.current];
        const stF = Math.min(1, st.t / T);
        if (t >= stF) {                                // reached a step → hold here
          animRef.current = stF; setAnimT(stF);
          nextStepRef.current += 1;
          if (presoDelayRef.current > 0) {
            // the delay is a floor; a caption too long to read in it holds longer
            holdRef.current = captionHold(st.text, presoDelayRef.current, readCpsRef.current);
            setHoldStep(st);
            raf = requestAnimationFrame(step);
            return;
          }
        }
      }
      if (t >= 1) {
        if (loopRef.current) {                         // hold on the finished drill, then replay
          if (loopPauseRef.current > 0) {
            animRef.current = 1; setAnimT(1);
            holdRef.current = loopPauseRef.current; loopPendingRef.current = true;
          } else {
            animRef.current = 0; setAnimT(0); nextStepRef.current = 0; setPlaySeed(s => s + 1);
          }
          raf = requestAnimationFrame(step);
          return;
        }
        animRef.current = 1; setAnimT(1); setPlaying(false); setHoldStep(null); return;
      }
      animRef.current = t;
      setAnimT(t);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line

  // while playing, the sim's own clock fades the result splash; once paused or
  // stopped that clock freezes, so drive a real-time fade here so the splash
  // always fades out completely instead of hanging on screen.
  useEffect(() => {
    if (playing) { setRestFade(1); return; }
    let raf, start = null;
    const tick = now => {
      if (start == null) start = now;
      const f = Math.max(0, 1 - (now - start) / 450);   // fade over ~0.45s of real time
      setRestFade(f);
      if (f > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function resetAnim() { animRef.current = 0; setAnimT(0); holdRef.current = 0; loopPendingRef.current = false; nextStepRef.current = 0; setHoldStep(null); }
  // editing while the animation is paused/finished snaps the pieces back to their
  // start positions first — returns true if it consumed the interaction
  function wakeEdit() {
    if (!playing && animT > 0) { resetAnim(); flash("Back to start — editing"); return true; }
    return false;
  }
  function skipHold() { holdRef.current = 0; setHoldStep(null); }

  // "Let AI play" — a self-contained 5v5 sim loop, independent of the scripted timeline
  useEffect(() => {
    if (!aiPlay) return;
    if (!aiRef.current) aiRef.current = newGame();
    let raf, last = performance.now();
    const step = now => {
      const dt = (now - last) / 1000; last = now;
      aiClockRef.current += dt;
      stepGame(aiRef.current, dt);
      if (aiClockRef.current >= aiMins * 60) { setAiPlay(false); return; }
      aiTick(t => t + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [aiPlay]); // eslint-disable-line
  const startAiPlay = () => {
    setPlaying(false); resetAnim();
    aiRef.current = newGame(); aiClockRef.current = 0;
    setOpenMenu(null); setPopup(null); setSelectedId(null);
    setAiPlay(true);
  };

  // one re-render after mount so hidden path lengths are measured
  const [, bumpTick] = useState(0);
  useEffect(() => { bumpTick(t => t + 1); }, []);

  // keep the pan/scale within bounds so the ice always fills the view
  const MAX_ZOOM = 3;
  const clampS = s => Math.max(1, Math.min(MAX_ZOOM, s));
  function clampView(s, tx, ty) {
    const g = geomRef.current;
    s = clampS(s);
    const clamp = (t, o, size) => Math.max((o + size) * (1 - s), Math.min(o * (1 - s), t));
    return { s, tx: clamp(tx, g.ox, g.rootW), ty: clamp(ty, g.oy, g.rootH) };
  }
  const resetView = () => { const v = { s: 1, tx: 0, ty: 0 }; viewRef.current = v; setView(v); };
  // screen px → root-viewBox units (the space the zoom transform lives in)
  function rootPt(cx, cy) {
    const svg = svgRef.current; if (!svg) return null;
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const m = svg.getScreenCTM(); if (!m) return null;
    return p.matrixTransform(m.inverse());
  }
  useEffect(() => { viewRef.current = view; }, [view]);

  // Block page scroll/zoom for touches on the rink; two fingers pinch-zoom + pan.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const start = e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        const d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = rootPt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        if (mid) { pinchRef.current = { d0, mid0: mid, view0: { ...viewRef.current } };
          drag.current = null; setDrawPreview(null); setLoupe(null); }
      }
    };
    const move = e => {
      e.preventDefault();
      const pin = pinchRef.current;
      if (!pin || e.touches.length !== 2) return;
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = rootPt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      if (!mid) return;
      const { d0, mid0, view0 } = pin;
      // clamp the scale BEFORE deriving the translation — otherwise past the
      // zoom limit the pan keeps drifting toward the focal point every event
      const s = clampS(view0.s * (d / (d0 || 1)));
      // keep the pinch focal point pinned, then pan by the midpoint drift
      const pcx = (mid0.x - view0.tx) / view0.s, pcy = (mid0.y - view0.ty) / view0.s;
      const nv = clampView(s, mid.x - s * pcx, mid.y - s * pcy);
      viewRef.current = nv; setView(nv);
    };
    const end = e => { if (e.touches.length < 2) pinchRef.current = null; };
    // Desktop: scroll wheel (and trackpad pinch, which arrives as ctrl+wheel)
    // zooms about the cursor — same focal-pinning math as the touch pinch.
    const onWheel = e => {
      e.preventDefault();
      const v = viewRef.current;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const k = e.ctrlKey ? 0.01 : 0.002;
      const s = clampS(v.s * Math.exp(-dy * k));
      const pt = rootPt(e.clientX, e.clientY);
      if (!pt) return;
      const pcx = (pt.x - v.tx) / v.s, pcy = (pt.y - v.ty) / v.s;
      const nv = clampView(s, pt.x - s * pcx, pt.y - s * pcy);
      viewRef.current = nv; setView(nv);
    };
    svg.addEventListener("touchstart", start, { passive: false });
    svg.addEventListener("touchmove", move, { passive: false });
    svg.addEventListener("touchend", end);
    svg.addEventListener("touchcancel", end);
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("touchstart", start);
      svg.removeEventListener("touchmove", move);
      svg.removeEventListener("touchend", end);
      svg.removeEventListener("touchcancel", end);
      svg.removeEventListener("wheel", onWheel);
    };
  }, []);


  // skater stride: a lateral weight-shift sway (+ slight edge lean) phased by
  // distance travelled, scaled by speed so it settles into stops. Display-only
  // — never fed back into timing or the puck's blade position.
  // stride vs glide keyed to the skater's speed multiple r = speed ÷ base pace
  // (so the piece Speed setting and RATE legs actually drive it): r≤1 glides,
  // r≈1.5 is a normal stride, r≈2 is a hard, wide, aggressive stride. The
  // side-to-side sway eases off faster than the lean as the skater slows.
  const STRIDE_LAMBDA = 11; // ft per full left-right stride cycle
  const STRIDE_AMP = 0.6;   // ft of lateral sway at a full aggressive (2×) stride
  const STRIDE_LEAN = 4.5;  // deg of body lean at a full aggressive stride
  const GLIDE_AT = 1.0;     // ×base pace: at/below this the skater just glides
  const HARD_AT = 2.0;      // ×base pace: full-out aggressive stride
  const PLANT_DEG = 55;     // deg the body pivots sideways in a hockey stop
  // idle fidget: a standing skater shifts weight instead of freezing solid.
  // Same display-only rule as the stride — never fed back into timing.
  const FIDGET_AMP = 0.18;  // ft of lateral weight-shift while standing
  const FIDGET_BOB = 0.07;  // ft of fore-aft drift while standing
  const FIDGET_LEAN = 2.2;  // deg of body wobble while standing
  const FIDGET_FADE = 0.35; // ×base pace at which the fidget has fully faded out
  // Ice spray: a skater who bites the ice hard throws a little puff of shavings off
  // their edges. Only worth drawing when they actually arrive with speed — a glide
  // into a stop shaves nothing. Display-only and, like everything else in playback, a
  // pure function of t: the specks are placed off a hash of the piece id, never a
  // live random, so scrubbing back retraces the same puff.
  // Painted in ice-ink (the puck's colour) rather than white: light ice is #f5fafd,
  // so white shavings on it are invisible. ice-ink is the one colour the theme
  // guarantees against the ice in BOTH modes — dark scuff on a white sheet, bright
  // spray on a dark one.
  const SPRAY_AT = 1.15;    // ×base pace: below this the stop is a glide, no snow
  const SPRAY_FULL = 2.0;   // ×base pace: a full-blooded hockey stop
  const SPRAY_N = 16;       // specks
  function snowSpray(p, dp) {
    if (p.kind !== "player" || !effDetail || animT <= 0 || whiteboard) return null;
    const amt = dp.brake || 0;
    if (amt <= 0.02) return null;
    const hard = Math.max(0, Math.min(1, ((dp.brakeSpd || 0) - SPRAY_AT) / (SPRAY_FULL - SPRAY_AT)));
    if (hard <= 0.02) return null;
    // the puff keeps expanding as it fades — it is thrown, not breathed in again.
    // `brakeUp` says which half of the bite we are in, so the throw grows straight
    // through the stop instead of tracking `amt` back down.
    const grow = dp.brakeUp ? 0.45 * amt : 0.45 + 0.55 * (1 - amt);
    // ...off the edge they planted on, and forward along the way they were going
    const side = Math.sin((2 * Math.PI * (dp.brakeAt || 0)) / STRIDE_LAMBDA) >= 0 ? 1 : -1;
    const hd = ((dp.a || 0) - PLANT_DEG * amt * side) * Math.PI / 180;   // travel, before the plant turned them
    const fx0 = Math.cos(hd), fy0 = Math.sin(hd), lx0 = -Math.sin(hd), ly0 = Math.cos(hd);
    let h = 0;
    for (let i = 0; i < String(p.id).length; i++) h = (h * 31 + String(p.id).charCodeAt(i)) | 0;
    const els = [];
    for (let i = 0; i < SPRAY_N; i++) {
      const r1 = ((Math.sin((h + i * 97) * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const r2 = ((Math.sin((h + i * 313) * 78.233) * 43758.5453) % 1 + 1) % 1;
      const reach = (0.7 + 5.4 * ((i + r1) / SPRAY_N)) * grow * (0.6 + 0.4 * hard);
      const fan = (r2 - 0.5) * 2.4 * reach * 0.5;             // widens as it flies out
      const cx = dp.x + (fx0 * reach + lx0 * (fan + 1.5 * side)) ;
      const cy = dp.y + (fy0 * reach + ly0 * (fan + 1.5 * side));
      els.push(<circle key={i} cx={cx} cy={cy} r={(0.42 + 0.66 * r1) * (0.55 + 0.7 * grow)}
        fill={T["ice-ink"]} opacity={0.92 * amt * hard * (1 - 0.45 * grow)} />);
    }
    return <g pointerEvents="none">{els}</g>;
  }
  function displaySwing(p) {
    return p.kind === "player" && animT > 0 ? stickSwing(p.id, animT * totalTime) : 0;
  }
  // an auto-reacting defenseman: hold the middle / front of the defended net,
  // stay goal-side of the puck (keep the attacker in front), gap up toward it.
  function dmanPos(p) {
    const home = { x: p.x, y: p.y };
    // net this D defends: nearest net piece, else the goal line on its side
    const nets = pieces.filter(q => q.kind === "net");
    let net = home.x < 100 ? { x: 11, y: 42.5 } : { x: 189, y: 42.5 };
    if (nets.length) {
      const n = nets.reduce((a, b) => (Math.hypot(b.x - home.x, b.y - home.y) < Math.hypot(a.x - home.x, a.y - home.y) ? b : a));
      net = { x: n.x, y: n.y };
    }
    const fwd = net.x < 100 ? 1 : -1;                     // toward center ice (up the slot)
    // threat = the nearest puck's live position (carried puck ≈ the puck carrier)
    const pucks = pieces.filter(q => q.kind === "puck");
    let threat = null, best = Infinity;
    // use the raw puck spot (not displayPos) so the D↔puck↔carrier chain can't recurse
    pucks.forEach(pk => { const d = displayPosRaw(pk); const dist = Math.hypot(d.x - net.x, d.y - net.y); if (dist < best) { best = dist; threat = d; } });
    if (!threat) return { x: home.x, y: home.y, a: p.facing || 0 };
    const cx = threat.x, cy = threat.y;                   // puck carrier
    const behind = (cx - net.x) * fwd <= 0;               // carrier is behind the net
    let tx, ty;
    if (behind) {
      // contain from the net front, shading toward the carrier's side
      tx = net.x + fwd * 12;
      ty = net.y + Math.max(-9, Math.min(9, cy - net.y)) * 0.55;
    } else {
      // stay goal-side of the carrier on the line to the net, holding a gap that
      // tightens as the carrier drives in — but never collapse onto the net (≥5 ft
      // off) so the D plays the man, not a second goalie
      const toNet = { x: net.x - cx, y: net.y - cy };
      const dN = Math.hypot(toNet.x, toNet.y) || 1;
      const gap = Math.max(6, Math.min(16, dN * 0.45));   // gap up; close it near the net
      const along = Math.min(gap, Math.max(0, dN - 5));
      tx = cx + (toNet.x / dN) * along;
      ty = cy + (toNet.y / dN) * along;
    }
    return { x: clampX(tx), y: clampY(ty), a: (Math.atan2(cy - ty, cx - tx) * 180) / Math.PI };
  }

  // solid net footprints — players and pucks are kept out (routed around) so a
  // route or a loose puck never sits inside the sides/back of a net
  const netObstacles = netShapes(pieces);
  // players are solid too: keep-out radius (feet) around each skater
  const PLAYER_R = 2.9;
  // stationary players (no route) act like static obstacles — routes arc around
  // them just like nets. Moving players are handled per-frame in displayPos.
  const stationaryDiscs = pieces
    .filter(q => q.kind === "player" && !q.path.length && !q.defense)
    .map(q => ({ cx: q.x, cy: q.y, r: PLAYER_R }));
  // the goalie is solid too — a keep-out disc at its current crease position.
  // Uses displayPosRaw for puck tracking so it never recurses back into a
  // carrier's displayPos. Cached for the render pass.
  const GOALIE_R = 2.7;
  let _goalieDiscs = null;
  const goalieDiscs = () => {
    if (_goalieDiscs) return _goalieDiscs;
    _goalieDiscs = pieces.filter(q => (q.kind === "net" || q.kind === "tire") && q.goalie)
      .map(net => { const g = goaliePos(net, displayPosRaw); return { cx: g.x, cy: g.y, r: GOALIE_R }; });
    return _goalieDiscs;
  };
  // smallest disc enclosing two discs — used to fuse a net's keep-out with its
  // goalie into ONE region so the route arcs around both as a single obstacle
  const mergeDiscs = (a, b) => {
    const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    if (d + b.r <= a.r) return a;
    if (d + a.r <= b.r) return b;
    const r = (d + a.r + b.r) / 2, t = (r - a.r) / (d || 1);
    return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, r };
  };
  const netPieces = pieces.filter(q => q.kind === "net");
  // net keep-out discs for routing: a goalie net is FUSED with its goalie disc
  // into one bigger disc, so the skater curves smoothly around the whole net +
  // crease. (Two overlapping discs made the tangent-arc solve cut through the
  // cage; one merged disc solves cleanly.)
  const detourNetDiscs = () => netObstacles.map((sh, i) => {
    const net = netPieces[i];
    if (!net || !net.goalie) return sh;
    const g = goaliePos(net, displayPosRaw);
    return mergeDiscs({ cx: sh.cx, cy: sh.cy, r: sh.r }, { cx: g.x, cy: g.y, r: GOALIE_R });
  });
  // the round props (roughly circular footprints): passers, tires, dekers
  const roundPropDiscs = () => [
    ...pieces.filter(q => q.kind === "passer").map(q => ({ cx: q.x, cy: q.y, r: 2.6 })),
    ...pieces.filter(q => q.kind === "tire").map(q => ({ cx: q.x, cy: q.y, r: 2.6 * ICON_SCALE * (q.size || 1) + 0.6 })),
    ...pieces.filter(q => q.kind === "deker").map(q => ({ cx: q.x, cy: q.y, r: 2.6 })),
  ];
  // solid props routes curve around: bumpers (a long bar enclosed by a disc),
  // passers, tires, and dekers. A jump over one lets it sit on the path instead.
  const propDiscs = () => [
    ...bumperShapes(pieces).map(sh => ({ cx: sh.cx, cy: sh.cy, r: sh.r })),
    ...roundPropDiscs(),
  ];
  // closest point on segment A→B to p
  const nearOnSeg = (A, B, p) => {
    const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / l2));
    return { x: A.x + dx * t, y: A.y + dy * t };
  };
  // prop discs for puck-shielding, measured from a reference point `ref` (the
  // carrier's blade tip): a bumper is a long bar, so it TRIGGERS off the nearest
  // point on its spine (tight — engages only near the bar, over the whole arc the
  // carrier routes around), but opens AWAY FROM ITS CENTRE (`dcx`/`dcy`) so the
  // body swings smoothly and never snaps 180° when rounding the bar's end. The
  // reach uses the bar's own avoidance radius (`sh.r`, same as the route detour).
  const shieldPropDiscs = ref => [
    ...bumperShapes(pieces).map(sh => { const c = nearOnSeg(sh.spine[0], sh.spine[1], ref); return { cx: c.x, cy: c.y, r: sh.r, dcx: sh.cx, dcy: sh.cy }; }),
    ...roundPropDiscs(),
  ];
  // where a player's route jumps (the waypoint at the start of a `jump` leg)
  const jumpPointsOf = p => (p && p.kind === "player" ? p.path : [])
    .map((s, i) => (s.jump ? (i === 0 ? { x: p.x, y: p.y } : { x: p.path[i - 1].x, y: p.path[i - 1].y }) : null))
    .filter(Boolean);
  const detourObstaclesFor = id => {
    const self = pieces.find(q => q.id === id);
    const mine = self && !self.path.length ? [{ cx: self.x, cy: self.y }] : [];
    const discs = stationaryDiscs.filter(d => !mine.some(m => m.cx === d.cx && m.cy === d.cy));
    const nets = detourNetDiscs();
    // a prop the player jumps over (a jump point sits within it) is skipped, so
    // it stays on the path and the hop carries them over it — resolved path, so a
    // jump authored on a branch waypoint skips its prop too
    const jps = jumpPointsOf(effOf(self));
    const props = propDiscs().filter(d => !jps.some(j => Math.hypot(j.x - d.cx, j.y - d.cy) < d.r + 3));
    const all = [...nets, ...props, ...discs];
    return all.length ? all : [];
  };
  // A route sampled then re-routed to arc smoothly around any net it crosses.
  // Returns { pts, origLen } (origLen = the straight-sampled length, for mapping
  // animation progress onto the detour) or null if no net is in the way. Cached
  // per render so the line and the animation share one detour.
  const detourCache = new Map();
  // core: sample (startPt then pathArr) into a dense polyline and arc it around the
  // obstacles. Cached per render under `key` so the drawn line and the animation share
  // one detour. Shared by base routes and branch routes so both bend identically.
  function detourOf(startPt, pathArr, obstacles, key) {
    if (detourCache.has(key)) return detourCache.get(key);
    if (!obstacles.length || !pathArr.length) { detourCache.set(key, null); return null; }
    const pts = [{ x: startPt.x, y: startPt.y }];
    let prev = { x: startPt.x, y: startPt.y }, origLen = 0;
    for (const s of pathArr) {
      const n = Math.max(2, Math.min(48, Math.round((Math.hypot(s.x - prev.x, s.y - prev.y) + 4) / 2)));
      for (let k = 1; k <= n; k++) { const q = evalSeg(prev, s, k / n); const last = pts[pts.length - 1]; origLen += Math.hypot(q.x - last.x, q.y - last.y); pts.push(q); }
      prev = { x: s.x, y: s.y };
    }
    const det = detourRoute(pts, obstacles);
    const out = det !== pts ? { pts: det, origLen } : null;
    detourCache.set(key, out);
    return out;
  }
  function routeDetour(p) {
    if (!collisions) return null;                    // avoidance off — draw routes exactly as authored
    if (!p.path.length || (p.kind !== "player" && p.kind !== "puck")) return null;
    // Key by path LENGTH too: the drawn line passes the base piece while the
    // animation passes the fork-inclusive `effOf` piece (longer path). Sharing by
    // id alone let a base-only detour (ending at the branch point) drive the
    // animation, freezing the skater there instead of continuing onto the fork.
    return detourOf({ x: p.x, y: p.y }, p.path, detourObstaclesFor(p.id), `${p.id}:${p.path.length}`);
  }
  // point + heading at fraction f (0..1 by arc length) along a polyline
  function samplePoly(poly, f) {
    let total = 0; const cum = [0];
    for (let i = 1; i < poly.length; i++) { total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y); cum.push(total); }
    const target = Math.max(0, Math.min(1, f)) * total;
    let i = 1; while (i < poly.length && cum[i] < target) i++;
    const a = poly[i - 1], b = poly[Math.min(i, poly.length - 1)];
    const seg = cum[Math.min(i, poly.length - 1)] - cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  }
  // where a carried puck sits: the drawn blade tip, forward + strong side (icon
  // units × ICON_SCALE), and the timing blade the puck rides in the plan
  // ...in RINK FEET. PLAYER_SCALE is the glyph's own draw scale: without it these
  // levers describe a stick 7% longer than the one on screen, and the puck hangs
  // about four inches off the end of the blade.
  const TIP_FWD = 5.6 * ICON_SCALE * PLAYER_SCALE, TIP_LAT = 2.45 * ICON_SCALE * PLAYER_SCALE;
  const BLADE_FWD = 4.9 * ICON_SCALE * PLAYER_SCALE, BLADE_LAT = 2.55 * ICON_SCALE * PLAYER_SCALE;
  const bladeAtWorld = (x, y, aDeg, fwd, lat, side) => {
    const a = (aDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: x + c * fwd - s * lat * side, y: y + s * fwd + c * lat * side };
  };
  // how much (deg) a puck-carrier opens their body to shield the puck when its
  // strong-side blade would run into a net's keep-out (whole icon rotates, so
  // nothing detaches; 0 when clear). `side` = strong side (R:+1 / L:-1)
  function shieldDelta(x, y, aDeg, side, obstacles) {
    if (!obstacles.length) return 0;
    const b = bladeAtWorld(x, y, aDeg, TIP_FWD, TIP_LAT, side);
    let w = 0, near = null, bd = Infinity;
    for (const sh of obstacles) {
      const d = Math.hypot(b.x - sh.cx, b.y - sh.cy), R = sh.r + 3;
      if (d < R) { const t = Math.min(1, (R - d) / 4.5); w = Math.max(w, t * t * (3 - 2 * t)); }
      if (d < bd) { bd = d; near = sh; }
    }
    if (w <= 0 || !near) return 0;
    // rotate the blade (whole icon) so it points further AWAY from the obstacle.
    // A disc may carry a separate direction anchor (dcx/dcy): a bumper triggers
    // off its nearest edge point but opens AWAY FROM ITS CENTRE, so the body
    // doesn't snap 180° as the carrier rounds the bar's end.
    const a = (aDeg * Math.PI) / 180;
    const dcx = near.dcx ?? near.cx, dcy = near.dcy ?? near.cy;
    const bladeAng = Math.atan2(Math.sin(a) * TIP_FWD + Math.cos(a) * TIP_LAT * side, Math.cos(a) * TIP_FWD - Math.sin(a) * TIP_LAT * side);
    let diff = bladeAng - Math.atan2(dcy - y, dcx - x);
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return (diff >= 0 ? 1 : -1) * w * 60;   // degrees, tunable
  }
  // a light's route mode: how a "read the light" fork chooses its route.
  //   reactive — cue order shuffled + looped, different every run (timing-based)
  //   sequence — cues in authored order, once → consistent every run (timing-based)
  //   random   — a random route each run, independent of timing (screen still flashes)
  //   always   — one designated cue colour's route, always (alwaysColor)
  // Normalises legacy boards (pre-mode `rand` flag). Function declarations (hoisted)
  // since resolveForks runs during render, above.
  function lightMode(l) { return l && l.mode ? l.mode : (l && l.rand === false ? "sequence" : "reactive"); }
  // per-run cue seed for a light's SCREEN: shuffle + loop for reactive/random (so it
  // flashes unpredictably), else null (authored order / steady). Keyed by playSeed.
  function cueSeed(light) {
    const m = lightMode(light);
    return ((m === "reactive" || m === "random") && (light.cues || []).length) ? hashInt(light.id + "|" + playSeed) : null;
  }
  // the cue colour that decides a fork at a branch, per the light's mode. `forks` is
  // the branch's fork list (random picks uniformly among the drawn ones); `depth` is
  // the branch index down a chain so nested "read again" branches pick independently.
  function chosenForkColor(light, forks, arrivalT, depth) {
    const m = lightMode(light);
    if (m === "random") {
      const avail = (forks || []).filter(f => f.path && f.path.length);
      if (!avail.length) return null;
      return avail[mix32(hashInt(light.id + "|" + playSeed + "|" + depth)) % avail.length].color;
    }
    if (m === "always") return light.alwaysColor || null;
    const cues = light.cues || [];
    if (!cues.length) return null;
    return cueColorAt(cues, arrivalT, m === "reactive" ? cueSeed(light) : null);
  }
  // A branch's selection CONDITION (how it's chosen at its waypoint). Legacy branches
  // carry only a colour → an implicit reaction-light condition matching that colour.
  // Open registry: add a cue type (player stick direction, numbered light, …) as a new
  // `type` with a picker case below + a DSL token in drill-format — nothing else changes.
  // hoisted (resolveForks runs during the render pass at effPieces, above this line)
  function condOf(f) { return f.cond || { type: "light", color: f.color }; }
  // does an event condition {on, at, mode} SELECT its branch? waypoint = the watched
  // player will reach (base) waypoint `at` on this run at all; action = they release the
  // puck this run. The reactor then WAITS at the branch for the trigger (via the injected
  // waitOn in resolveRoute), so timing is handled there — this is just the pick.
  function eventHolds(c, solved) {
    if (!c || !c.on) return false;
    if (c.mode === "action") return !!(solved.released || {})[c.on];
    return (solved.reach || {})[c.on] != null && solved.reach[c.on] >= (c.at ?? 0);
  }
  // pick ONE branch from an outgoing group, honouring each branch's condition. Returns
  // { fork, light } — `light` = the governing cue-light when a light condition decided.
  // An `always` branch overrides everything. Otherwise every conditional branch that
  // SUCCEEDS is collected with the TIME its trigger fires, and the EARLIEST-firing one
  // wins ("first successful condition wins", not a fixed type order); ties break to
  // authored order. If none succeed, sequence+random split the run. Deterministic
  // (geometry + playSeed + resolved routes/possession), so every piece agrees on the run.
  function pickBranch(p, group, ctx) {
    // an `always` branch is an unconditional OVERRIDE: if one leaves this waypoint it wins.
    const always = (group || []).find(f => condOf(f).type === "always");
    if (always) return { fork: always, light: null };
    const solved = ctx.solved || solvedRef.current;
    const reachT = solved.reachT || {};
    const reachTime = (id, at) => { const rt = reachT[id]; return rt && rt[at] != null ? rt[at] : Infinity; };
    const at0 = ctx.arrivalT ?? 0;                          // the reactor reads a cue / holds the puck at ITS own arrival
    // each On-cue branch reads its OWN cue device (cond.lightId); a branch with no lightId
    // falls back to the player's governing (designated-or-nearest) light.
    const lightFor = f => {
      const c = condOf(f);
      return c.lightId ? ctx.ps.find(q => q.id === c.lightId && q.kind === "light" && (q.cues || []).length)
        : governingLightFor(ctx.ps, p, ctx.pt);
    };
    const lightBs = (group || []).filter(f => condOf(f).type === "light");
    const cands = [];                                       // { fork, t (fire time), light }
    for (const f of lightBs) {
      const lt = lightFor(f); if (!lt) continue;
      const peers = lightBs.filter(g => lightFor(g)?.id === lt.id);
      const color = chosenForkColor(lt, peers, ctx.arrivalT, ctx.depth);
      if (sameColor(condOf(f).color || f.color, color)) cands.push({ fork: f, t: at0, light: lt });
    }
    for (const f of (group || []).filter(f => condOf(f).type === "possession")) {
      const who = condOf(f).player || p.id;
      if (who === p.id) {
        // MY possession is read AT THE BRANCH MOMENT: a hold window (flat gain→release
        // indices on this run) covering the departure index. Final-state possession is
        // wrong here — a later shot ends the run "not holding" yet the player plainly
        // carried the puck INTO the branch (and made it oscillate the fixpoint).
        const bp = ctx.bp != null ? ctx.bp : ((p.path || []).length - 1);
        const ws = (solved.heldWin || {})[who] || [];
        if (ws.some(w => w.g <= bp && (bp < w.l || w.l === w.g))) cands.push({ fork: f, t: at0, light: null });
      } else if (((solved.heldWin || {})[who] || []).length) {
        // ANOTHER player's possession reads as "they get the puck this run" — an
        // event-like trigger (their exact hold instant vs my arrival isn't comparable
        // across two different routes' clocks)
        cands.push({ fork: f, t: at0, light: null });
      }
    }
    for (const f of (group || []).filter(f => condOf(f).type === "link")) {
      const c = condOf(f), rs = (solved.routes || {})[c.player];
      if (rs && [...rs].some(r => isAncestorRef((c.route || "").toLowerCase(), r))) {
        const tgt = ctx.ps.find(q => q.id === c.player);
        const dep = tgt ? (forkAt(tgt, c.route)?.at ?? ((tgt.path || []).length - 1)) : 0;   // when they commit to that route
        cands.push({ fork: f, t: reachTime(c.player, dep), light: null });
      }
    }
    for (const f of (group || []).filter(f => condOf(f).type === "event")) {
      const c = condOf(f);
      // an ACTION trigger races at the watched player's actual release time on this
      // run's assignment — not "when they reach a waypoint". A release far downstream
      // of this decision (e.g. a shot my own chosen route eventually feeds) then loses
      // the race to an immediate condition instead of hijacking the branch.
      if (eventHolds(c, solved)) cands.push({ fork: f, light: null,
        t: c.mode === "action" ? ((solved.releasedT || {})[c.on] ?? reachTime(c.on, c.at ?? 0)) : reachTime(c.on, c.at ?? 0) });
    }
    if (cands.length) {
      const gi = f => (group || []).indexOf(f);
      // earliest trigger wins; at an exact tie, holding-the-puck-NOW beats waiting on
      // an event (physical immediacy), then authored order
      const prio = f => (condOf(f).type === "possession" && !condOf(f).player ? 0 : 1);
      cands.sort((a, b) => (a.t - b.t) || (prio(a.fork) - prio(b.fork)) || (gi(a.fork) - gi(b.fork)));
      return { fork: cands[0].fork, light: cands[0].light };
    }
    // SEQUENCE + RANDOM split the runs as one distribution over N = (#sequence +
    // #random) routes: the rotation slot for this run is playSeed % N. Sequence branches
    // (ordered by `seq=`) claim the first slots — so each runs exactly 1 of every N runs,
    // in order — and the remaining slots are RANDOM slots, where a weighted-random branch
    // is chosen. This is why a lone sequence among 3 routes runs 1/3, and two sequences
    // among 4 run 1/4 each in order, without a random sibling stealing every run.
    const seqBs = (group || []).filter(f => condOf(f).type === "sequence")
      .sort((a, b) => (condOf(a).ord ?? 0) - (condOf(b).ord ?? 0));
    const randBs = (group || []).filter(f => condOf(f).type === "random");
    const N = seqBs.length + randBs.length;
    if (N) {
      const slot = (playSeed >>> 0) % N;
      if (slot < seqBs.length) return { fork: seqBs[slot], light: null };          // a sequence slot
      if (randBs.length) {                                                          // a random slot
        const w = randBs.map(f => Math.max(0, condOf(f).weight ?? 1));
        const total = w.reduce((a, b) => a + b, 0) || randBs.length;
        let r = ((mix32(hashInt(p.id + "|rand|" + playSeed + "|" + ctx.depth))) % 100000) / 100000 * total;
        for (let i = 0; i < randBs.length; i++) { r -= (w[i] || 1); if (r < 0) return { fork: randBs[i], light: null }; }
        return { fork: randBs[randBs.length - 1], light: null };
      }
    }
    return { fork: null, light: null };                     // nothing fired → stay on the trunk
  }
  // the reaction moments a light drives in `random` mode: for every branch this light
  // governs (across all branching players, chains included), the player's branch-arrival
  // time and the chosen route colour — so the screen can show that colour AS the player
  // hits the branch (a real reaction, not an out-of-sync flash). Reads the one shared
  // resolveRoute walk, so it always agrees with the spliced animation path.
  function lightReactionEvents(light) {
    const evs = [];
    for (const p of pieces) {
      if (p.kind !== "player" || !(p.forks || []).length) continue;
      for (const node of resolveRoute(p).chain) {
        if (node.light && node.light.id === light.id) evs.push({ t: node.arrivalT, color: node.fork.color });
      }
    }
    return evs.sort((a, b) => a.t - b.t);
  }
  // the colour a cognitive-training light is showing right now: steady designated
  // colour in `always` mode, else its cue timeline resolved at the current animation
  // time, else (no cues / before play) its idle base colour.
  function lightColor(p) {
    if (!(p.cues || []).length) return p.color;
    const m = lightMode(p);
    if (m === "always") return p.alwaysColor || p.color;
    const e = animT <= 0 ? 0 : animT * totalTime;
    if (m === "random" && e > 0) {
      // random routes still read as a REACTION: flash through the cues, then snap to
      // the chosen route's colour a beat before the player reaches the branch and hold
      // it through the reaction leg, so the cut looks cued by the light.
      const LEAD = 0.4;                                  // show the cue just before arrival
      let held = null;
      for (const ev of lightReactionEvents(p)) { if (e >= ev.t - LEAD) held = ev.color; else break; }
      if (held) return held;
    }
    return cueColorAt(p.cues, e, cueSeed(p)) ?? p.color;
  }

  /* ----- light reactions (branch forks) ----- */
  // the branch point of a player's route: where the base route ends (the decision
  // point), or the player's start if they have no base route.
  function branchPoint(p) {
    return p.path && p.path.length ? { x: p.path[p.path.length - 1].x, y: p.path[p.path.length - 1].y } : { x: p.x, y: p.y };
  }
  /* ----- fork tree (reactions can nest: a "skate" reaction chains another) -----
     A fork is addressed by a colour-PATH ref like "#green" or "#green/#red" (the
     red reaction nested under the green one), since the same cue colour can recur
     at different depths. */
  // NOTE: the lineage helpers below are function DECLARATIONS (not const arrows) so
  // they hoist — resolveForks runs eagerly during render (effPieces, far above their
  // textual position) and calls into them; a const would be in its temporal dead zone.
  function forkParts(ref) { return String(ref).split("/"); }
  const forkEq = (a, b) => (!a && !b) || (!!a && !!b && String(a).toLowerCase() === String(b).toLowerCase());
  // walk the tree by a ref → the leaf fork node (or null)
  function forkAt(p, ref) {
    if (!ref) return null;
    let list = p.forks || [], node = null;
    for (const c of forkParts(ref)) { node = (list || []).find(f => sameColor(f.color, c)); if (!node) return null; list = node.forks; }
    return node;
  }
  const forkOf = forkAt;   // single-colour refs are just a 1-part path
  // ref A is on the route lineage of ref B (base "" or an ancestor-or-self branch), so
  // an action tagged A is in effect for a waypoint on branch B. SIBLING-branch actions
  // belong to other runs — they don't touch B's possession. Lets each route off a split
  // keep the puck independently: a shot on the red branch doesn't "use up" the puck on
  // the blue/green branches.
  function isAncestorRef(a, b) {
    a = String(a || "").toLowerCase(); b = String(b || "").toLowerCase();
    return a === "" || a === b || b.startsWith(a + "/");
  }
  // who holds puck pk along route lineage `fork` (only base + ancestor/self actions
  // apply); the terminal (shot/rim/chip) that ends it on that lineage, if any
  function holderOnLineage(pk, fork) {
    let holder = pk.carrier || (pk.pickup && isAncestorRef(pk.pickup.atRef, fork) ? pk.pickup.to : null);
    for (const t of (pk.transfers || [])) if (isAncestorRef(t.atRef, fork)) holder = t.to;
    return holder;
  }
  // the ordered puck-chain member ids: the head (carrier or pickup collector) then
  // each transfer's receiver — chainIds[s] is who releases transfer s (unless t.by).
  function chainIdsOf(pk) { return [pk.carrier || (pk.pickup && pk.pickup.to), ...(pk.transfers || []).map(t => t.to)]; }
  // who RELEASES transfer index s: the holder on THAT transfer's own atRef lineage just
  // before it — SIBLING-branch transfers (whose atRef isn't an ancestor of this one's)
  // don't count, so a pass authored on one branch isn't mis-credited to whoever passed on
  // a mutually-exclusive sibling branch. Ignores t.by so callers can compare against it.
  function releaserOf(pk, s) {
    const ts = pk.transfers || [], t = ts[s];
    if (!t) return null;
    let holder = pk.carrier || (pk.pickup && isAncestorRef(pk.pickup.atRef, t.atRef) ? pk.pickup.to : null);
    for (let k = 0; k < s; k++) if (isAncestorRef(ts[k].atRef, t.atRef)) holder = ts[k].to;
    return holder;
  }
  // does player `pid` hold puck `pk` while standing on THEIR OWN lineage `fork`?
  // Unlike holderOnLineage (single-namespace), each ref is compared against the
  // lineage of the player it belongs to — the RECEIVER's recvRef for a gain, the
  // RELEASER's atRef for a loss — so a CROSS-player pass (whose atRef names the
  // passer's branch, not the receiver's) still credits the receiver. Possibility-
  // based for authoring: it credits a receiver whenever the pass COULD deliver on
  // their lineage (like authoring a shot on a branch the current seed didn't pick);
  // resolveForks makes the action FIRE only on runs that actually deliver.
  const holdsOnLineage = (pk, pid, fork) => {
    let held = pk.carrier === pid;
    if (pk.pickup && pk.pickup.to === pid && isAncestorRef(pk.pickup.atRef, fork)) held = true;
    (pk.transfers || []).forEach((t, s) => {
      if (t.to === pid && isAncestorRef(t.recvRef, fork)) held = true;                          // received on my lineage
      else if ((t.by || releaserOf(pk, s)) === pid && isAncestorRef(t.atRef, fork)) held = false; // released on my lineage
    });
    return held;
  };
  function terminatedOnLineage(pk, fork) {
    return (pk.terminals || []).some(t => isAncestorRef(t.ref || "", fork));
  }
  // the player a terminal (shot/rim/chip) belongs to, inferred from its ref (no
  // stored field, no DSL): a branch-ref terminal is owned by the chain member whose
  // fork tree contains that ref; a base ("") terminal by the chain's natural final
  // holder. Lets resolveForks fire a cross-player conditional terminal only on runs
  // whose resolved final holder is that actor.
  function terminalActor(pk, ps, ref) {
    const ids = chainIdsOf(pk);
    if (ref) { for (const id of ids) { const q = ps.find(x => x.id === id); if (q && forkAt(q, ref)) return id; } }
    const ts = pk.transfers || [];
    return ts.length ? ts[ts.length - 1].to : ids[0];
  }
  // did THIS player (`pid`) end the puck on `fork`'s lineage? Unlike terminatedOnLineage
  // (true for ANY terminal on the lineage), this ignores a cross-run terminal by someone
  // else — e.g. a base-ref shot by a conditional receiver (`by`) that only fires on a
  // sibling run — so it doesn't wrongly "spend" the puck for other players on this branch.
  function termedByOnLineage(pk, pid, fork) {
    return (pk.terminals || []).some(t => isAncestorRef(t.ref || "", fork) && (t.by || terminalActor(pk, pieces, t.ref || "")) === pid);
  }
  // a patch that removes THIS player's prior terminal on `fork`'s lineage — a branch
  // ends exactly one way PER PLAYER, so authoring a new end replaces that player's
  // old one. Other players' terminals are untouched even on the same ref (two
  // conditional receivers each shoot on their OWN base route — ref "" for both —
  // and must not steal each other's shot).
  const stripLineageTerms = (pk, fork, pid) => {
    const kept = (pk.terminals || []).filter(t => {
      const overlap = isAncestorRef(t.ref || "", fork) || isAncestorRef(fork, t.ref || "");
      if (!overlap) return true;
      const actor = t.by || terminalActor(pk, pieces, t.ref || "");
      return pid != null && actor !== pid;
    });
    return kept.length !== (pk.terminals || []).length ? { terminals: kept.length ? kept : undefined } : {};
  };
  // a branch "ends open" — no legacy terminal action and no puck action authored on
  // its last waypoint — so it can chain another reaction or take a ‖ stop mark
  function branchEndsOpen(p, ref) {
    const f = forkAt(p, ref);
    if (!f) return true;
    if (f.action && f.action !== "skate") return false;      // legacy terminal branch
    return !stepsAt(p, (f.path || []).length - 1, ref).some(s => s.role === "terminal" || s.role === "release");
  }
  // the point a branch departs FROM: the `at` waypoint of its parent route (base for a
  // top-level branch, else the parent branch), defaulting to that route's end.
  function forkOriginPoint(p, ref) {
    const parts = forkParts(ref);
    const self = forkAt(p, ref);
    const parentSegs = parts.length <= 1 ? p.path
      : (forkAt(p, parts.slice(0, -1).join("/"))?.path || []);
    if (parentSegs && parentSegs.length) {
      const at = self && self.at != null ? Math.min(self.at, parentSegs.length - 1) : parentSegs.length - 1;
      const s = parentSegs[at]; if (s) return { x: s.x, y: s.y };
    }
    return branchPoint(p);
  }
  // the skate direction a branch inherits: a branch runs in parallel with the leg
  // after its departure waypoint, so it picks that sibling leg up (or, off the very
  // end of a route, the last leg the player skated)
  function forkEntryDir(p, ref) {
    const parts = forkParts(ref);
    const self = forkAt(p, ref);
    const parentSegs = parts.length <= 1 ? p.path
      : (forkAt(p, parts.slice(0, -1).join("/"))?.path || []);
    if (!parentSegs || !parentSegs.length) return "fwd";
    const at = self && self.at != null ? Math.min(self.at, parentSegs.length - 1) : parentSegs.length - 1;
    return dirAtWaypoint(parentSegs, Math.min(at + 1, parentSegs.length - 1));
  }
  // a synthetic "route piece" whose path is a fork and whose origin is where it
  // forks from, so the base-route editing math (segEnd/convertSeg/splitSeg) is reused
  function forkPiece(p, ref) {
    const f = forkAt(p, ref), o = forkOriginPoint(p, ref);
    return { ...p, x: o.x, y: o.y, path: f ? f.path : [] };
  }
  const routeSegs = (p, fork) => fork ? (forkAt(p, fork)?.path || []) : p.path;
  const routePiece = (p, fork) => fork ? forkPiece(p, fork) : p;
  // immutable tree edits by ref: map the leaf through fn / remove it / ensure it exists
  function mapForkAt(forks, ref, fn) {
    const parts = forkParts(ref);
    const go = (list, d) => (list || []).map(f => !sameColor(f.color, parts[d]) ? f
      : (d === parts.length - 1 ? fn(f) : { ...f, forks: go(f.forks, d + 1) }));
    return go(forks, 0);
  }
  function removeForkAt(forks, ref) {
    const parts = forkParts(ref);
    const go = (list, d) => d === parts.length - 1
      ? (list || []).filter(f => !sameColor(f.color, parts[d]))
      : (list || []).map(f => sameColor(f.color, parts[d]) ? { ...f, forks: go(f.forks, d + 1) } : f);
    return go(forks, 0);
  }
  function ensureForkAt(forks, ref, make) {
    const parts = forkParts(ref);
    const go = (list, d) => {
      list = list || [];
      const c = parts[d], idx = list.findIndex(f => sameColor(f.color, c));
      if (d === parts.length - 1) return idx >= 0 ? list : [...list, make(c)];
      if (idx < 0) return [...list, { color: c, action: "skate", forks: go([], d + 1), path: [] }];
      return list.map((f, k) => k === idx ? { ...f, forks: go(f.forks, d + 1) } : f);
    };
    return go(forks, 0);
  }
  // seconds to skate authored segment `i` of a player's route `ref` ("" = the base
  // path; a colour-path ref = a branch), measured off its STABLE AUTHORING ref
  // (`seg:id:ref:i`) — rendered for every authored segment, chosen or not — so branch
  // arrival times exist BEFORE the light picks a branch (no chicken/egg for choosing).
  // Same arc-length ÷ pace formula the timing engine uses.
  function authoredSegTime(p, ref, i, s) {
    const el = segRefs.current[`seg:${p.id}:${ref}:${i}`];
    let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
    const v = pace * SPEED[s.mode || "carry"] * (p.speed || 1) * (s.rate || 1);
    return (s.stop || 0) + (v > 0 ? L / v : 0);
  }
  // the light that governs a player's reaction: the nearest one that has a cue
  // timeline (to its branch point). null if there are no cue lights.
  function governingLightNear(ps, pt) {
    const lights = ps.filter(q => q.kind === "light" && (q.cues || []).length);
    if (!lights.length) return null;
    const d = q => Math.hypot(q.x - pt.x, q.y - pt.y);
    return lights.reduce((a, q) => (d(q) < d(a) ? q : a));
  }
  function governingLight(ps, p) { return governingLightFor(ps, p, branchPoint(p)); }
  // the light a branching player reads: its explicitly designated `lightId` (so it can
  // opt out of the nearest one when several lights exist), else the nearest cue-light.
  // Designation covers all of that player's branches, base and chained.
  function governingLightFor(ps, p, pt) {
    if (p && p.lightId) {
      const desig = ps.find(q => q.id === p.lightId && q.kind === "light" && (q.cues || []).length);
      if (desig) return desig;
    }
    return governingLightNear(ps, pt);
  }
  // the puck a player carries into a reaction: one they hold at the branch with no
  // action of its own yet (so the reaction's action decides what happens to it).
  // A function declaration (hoisted) since resolveForks runs during render, above.
  function reactionPuck(ps, playerId) {
    return ps.find(q => q.kind === "puck" && q.carrier === playerId
      && !(q.terminals || []).length && q.shotAt == null && q.rimAt == null && q.chipAt == null   // terminals[] on the raw form, scalars on a lowered one
      && !(q.transfers || []).length) || null;
  }
  // THE single reaction-chain walk. Walks a branching player's CHOSEN chain of
  // branches and returns everything the three consumers need, so they can't drift:
  //   effPath  — the base path with the chosen chain spliced on (= p.path if none fired)
  //   chain    — the ordered chosen branches, each { ref, prefix, fork, forks (siblings),
  //              arrivalT (time the player reaches that branch), light, depth }
  //   terminal — { fork, idx } of the ending non-skate branch (idx into effPath), or null
  // At each branch (base end, then each skate branch's end) the governing light's cue
  // at the arrival time picks the next branch; a non-skate action ends the chain. Keyed
  // by geometry + playSeed only, so playback is deterministic. Hoisted (runs during the
  // render pass at effPieces, above this line).
  function resolveRoute(p, ps = pieces, ctx = {}) {
    if (p.kind !== "player" || !(p.forks || []).length) return { effPath: p.path, chain: [], terminal: null, idxMap: {} };
    const solved = ctx.solved || solvedRef.current;               // resolved trigger state (from this or the prior pass)
    const effPath = [], chain = [], idxMap = {};             // idxMap: route ref (lc, ""=base) → { localIdx → flat effPath idx }
    let terminal = null, arrivalT = 0, depth = 0, guard = 0;
    // the route currently being skated: its segment list, its branch list, its ref
    // ("" = base), its origin point, and whether it ends in a non-skate action.
    let curPath = p.path, curForks = p.forks, curRef = "", curOrigin = { x: p.x, y: p.y };
    let curTerminalFork = null, waitInject = null;          // pending event-wait for a branch's first segment
    while (guard++ < 64) {
      const segs = curPath || [], endIdx = segs.length - 1;
      const atOf = f => (f.at != null ? f.at : endIdx);       // undefined `at` = this route's end
      let fired = null;
      // positions -1 (route origin, for start/route-less branches) then each waypoint
      for (let i = -1; i <= endIdx; i++) {
        if (i >= 0) {
          // an event-conditioned branch WAITS at its start until the trigger fires: stamp
          // the timing-engine waitOn onto the branch's FIRST segment so the reactor pauses
          // at the reaction point (like WAIT/WACT) rather than skating straight through.
          let seg = segs[i];
          if (i === 0 && waitInject) { seg = { ...seg, waitOn: waitInject }; waitInject = null; }
          effPath.push(seg);
          const rk = curRef.toLowerCase();
          (idxMap[rk] || (idxMap[rk] = {}))[i] = effPath.length - 1;   // (ref, local) → flat, for lowering puck actions
          arrivalT += authoredSegTime(p, curRef, i, seg);
        }
        const outgoing = (curForks || []).filter(f => atOf(f) === i && f.path && f.path.length);
        if (!outgoing.length) continue;
        const pt = i >= 0 ? { x: segs[i].x, y: segs[i].y } : curOrigin;
        const d = depth++;
        const { fork, light } = pickBranch(p, outgoing, { ps, pt, arrivalT, depth: d, solved, bp: effPath.length - 1 });
        if (!fork) continue;                                  // nothing fired here → trunk continues
        const ref = curRef ? curRef + "/" + fork.color : fork.color;
        chain.push({ ref, prefix: curRef, fork, forks: outgoing, arrivalT, light, depth: d, at: i });
        fired = { fork, ref, pt };
        break;                                                // a branch fired here → truncate the trunk, take it
      }
      if (!fired) {                                           // reached this route's end with no branch firing
        if (curTerminalFork) terminal = { fork: curTerminalFork, idx: effPath.length - 1 };
        break;
      }
      // descend into the fired branch (its own path becomes the route being skated)
      curPath = fired.fork.path; curForks = fired.fork.forks; curRef = fired.ref; curOrigin = fired.pt;
      curTerminalFork = (fired.fork.action || "skate") !== "skate" ? fired.fork : null;
      // an event/link branch WAITS at its start until its trigger fires (event = the
      // watched player reaches a wp / releases; link = the named player commits to a route
      // by reaching its departure wp). A cue/possession branch needs no wait (read on arrival).
      const fc = condOf(fired.fork);
      if (fc.type === "event" && fc.on) waitInject = { on: fc.on, at: fc.at ?? 0, mode: fc.mode === "waypoint" ? "waypoint" : "action" };
      else if (fc.type === "link" && fc.player) {
        const tgt = ps.find(q => q.id === fc.player);
        const dep = tgt ? (forkAt(tgt, fc.route)?.at ?? ((tgt.path || []).length - 1)) : 0;
        waitInject = { on: fc.player, at: dep, mode: "waypoint" };
      } else waitInject = null;
    }
    return { effPath, chain, terminal, idxMap };
  }
  // EVERY candidate root-to-leaf route through a player's branch tree (each a flat
  // segment array), for the preview-all-branches ghosts. At a branch waypoint each
  // outgoing branch is its own route; capped so a deep tree can't explode.
  // stable ROUTE NUMBERS for a player's branches: pre-order over the fork tree, i.e.
  // exactly the order their BRANCH lines appear in the DSL — R1, R2, … Used by the
  // route-condition picker and the faint on-ice labels so a route can be chosen by
  // number instead of decoding colour hexes.
  function forkNumbers(p) {
    const map = new Map(); let n = 0;
    const walk = (forks, prefix) => (forks || []).forEach(f => {
      if (!f.path || !f.path.length) return;
      const ref = prefix ? prefix + "/" + f.color : f.color;
      map.set(ref.toLowerCase(), ++n);
      walk(f.forks, ref);
    });
    walk(p.forks, "");
    return map;
  }
  function enumerateRoutes(p) {
    if (!(p.forks || []).length) return [{ path: p.path || [], ref: "" }];
    const CAP = 12, out = [];
    const dfs = (segs, forks, prefix, ref) => {
      if (out.length >= CAP) return;
      const endIdx = (segs || []).length - 1, atOf = f => (f.at != null ? f.at : endIdx);
      const acc = prefix.slice();
      for (let i = 0; i < (segs || []).length; i++) {
        acc.push(segs[i]);
        const outgoing = (forks || []).filter(f => atOf(f) === i && f.path && f.path.length);
        if (outgoing.length) { outgoing.forEach(f => dfs(f.path, f.forks, acc, ref ? ref + "/" + f.color : f.color)); return; }
      }
      out.push({ path: acc, ref });                           // reached an end with no branch → a full candidate route
    };
    dfs(p.path, p.forks, [], "");
    return out.slice(0, CAP);
  }
  // dense polyline of (start + a segment array), for ghost sampling when no detour
  const pathPolyline = (start, segs) => {
    const pts = [{ x: start.x, y: start.y }]; let prev = { x: start.x, y: start.y };
    for (const s of segs || []) {
      const n = Math.max(2, Math.min(48, Math.round((Math.hypot(s.x - prev.x, s.y - prev.y) + 4) / 2)));
      for (let k = 1; k <= n; k++) pts.push(evalSeg(prev, s, k / n));
      prev = { x: s.x, y: s.y };
    }
    return pts;
  };
  // Splice each branching player's chosen chain onto their path (→ effPieces), then
  // lower every puck action authored against a route — base OR a branch waypoint — to a
  // flat index on the resolved path. Actions on a branch the run didn't take are dropped
  // (and the puck chain truncates there). A legacy branch-`action` still lowers too.
  // does any branch in a fork tree select on RESOLVED state (possession/link/event)?
  // Only such drills need the dependency-aware fixpoint; all others resolve in one pass.
  function forksNeedSolve(forks) {
    return (forks || []).some(f => (f.cond && (f.cond.type === "possession" || f.cond.type === "link" || f.cond.type === "event")) || forksNeedSolve(f.forks));
  }
  function resolveForks(ps) {
    const branching = ps.filter(p => p.kind === "player" && (p.forks || []).length);
    // terminals are ALWAYS stored as an authoring list, so even a fork-free drill
    // needs the lowering pass when a puck carries one (or a stale branch ref)
    const puckNeedsLower = q => q.kind === "puck" && (
      (q.terminals || []).length ||
      (q.transfers || []).some(t => t.atRef || t.recvRef) ||
      (q.pickup && q.pickup.atRef));
    if (!branching.length && !ps.some(puckNeedsLower)) { solvedRef.current = EMPTY_SOLVED; return ps; }
    // resolve every branching player's route under the current solved trigger state
    const buildR = solved => {
      const R = new Map();                                   // playerId → resolved { effPath, chain, terminal, idxMap }
      for (const p of branching) { const r = resolveRoute(p, ps, { solved }); if (r.chain.length) R.set(p.id, r); }
      return R;
    };
    // lower every puck's actions onto the routes chosen in R → the effPieces array
    const lowerForks = R => {
    // even if no branch fired, pucks carrying branch-tagged actions must have those
    // dropped (they belong to a branch this run didn't take)
    if (!R.size && !ps.some(puckNeedsLower)) return ps;
    let out = ps.slice();
    for (const [id, r] of R) { const i = out.findIndex(q => q.id === id); out[i] = { ...out[i], path: r.effPath }; }
    // (playerId, route ref, local index) → resolved flat index, or null when that branch
    // wasn't taken (or a mid-route-dropped base waypoint). Non-branching player = base identity.
    const flatOf = (pid, ref, local) => {
      if (local == null) return null;
      const r = R.get(pid), rk = (ref || "").toLowerCase();
      if (!r) return rk === "" ? local : null;
      const m = r.idxMap[rk];
      return m && m[local] != null ? m[local] : null;
    };
    // translate a puck's action indices; drop actions whose branch wasn't taken
    out = out.map(pk => {
      if (pk.kind !== "puck") return pk;
      const head = pk.carrier || (pk.pickup && pk.pickup.to);
      const chainIds = [head, ...(pk.transfers || []).map(t => t.to)];
      const hasRef = (pk.transfers || []).some(t => t.atRef || t.recvRef) || (pk.terminals || []).some(t => t.ref) || (pk.pickup && pk.pickup.atRef);
      const touches = (pk.pickup && R.has(pk.pickup.to))
        || (pk.transfers || []).some((t, s) => R.has(t.by || chainIds[s]) || R.has(t.to))
        || (pk.terminals || []).some(t => R.has(t.by || chainIds[chainIds.length - 1]));
      // terminals are STORED as an authoring list — every puck that carries one must be
      // lowered to the scalar shot/rim/chip fields timing reads, even if no branch fired.
      if (!hasRef && !touches && !(pk.terminals || []).length) return pk;
      let np = pk, changed = false;
      const set = patch => { np = { ...np, ...patch }; changed = true; };
      // pickup
      if (pk.pickup && (pk.pickup.atRef || R.has(pk.pickup.to))) {
        const a = flatOf(pk.pickup.to, pk.pickup.atRef, pk.pickup.at);
        if (a == null) set({ pickup: null });
        else if (a !== pk.pickup.at || pk.pickup.atRef) { const { atRef, ...rest } = pk.pickup; set({ pickup: { ...rest, at: a } }); }
      }
      // transfers: keep those whose route WAS taken and whose releaser actually holds the
      // puck on this run. A transfer on a SIBLING branch that wasn't taken is simply
      // SKIPPED — it must not truncate a transfer on a DIFFERENT branch (siblings are
      // mutually-exclusive parallel runs, not one linear chain). The `holds` set tracks who
      // has the puck so a transfer whose releaser never got it is dropped too.
      const dropRel = [];   // releases that HAPPEN this run but whose delivery branch wasn't taken
      if ((pk.transfers || []).length) {
        const nt = []; let tchanged = false;
        const holds = new Set([head]);
        pk.transfers.forEach((t, s) => {
          const releaser = t.by || releaserOf(pk, s);
          const at2 = (t.atRef || R.has(releaser)) ? flatOf(releaser, t.atRef, t.at) : t.at;
          const rc2 = t.recvAt == null ? null : ((t.recvRef || R.has(t.to)) ? flatOf(t.to, t.recvRef, t.recvAt) : t.recvAt);
          if (at2 == null || !holds.has(releaser)) { tchanged = true; return; }
          if (t.recvAt != null && rc2 == null) {
            // the RELEASE still happens — only the catch's branch wasn't taken this run
            // (e.g. a chip toward a pickup route the receiver didn't choose). Remember it
            // so `when=<releaser>!` triggers still fire (else a reaction that CAUSES the
            // catch could never bootstrap), and so a chip/rim can fall back to a plain
            // release into space.
            tchanged = true;
            dropRel.push({ by: releaser, at: at2, kind: t.kind, aim: t.aim ?? null, shand: t.shand ?? null });
            return;
          }
          if (at2 !== t.at || rc2 !== t.recvAt || t.atRef || t.recvRef) tchanged = true;
          const { atRef, recvRef, ...rest } = t;
          nt.push({ ...rest, at: at2, recvAt: rc2, _src: t });   // _src: the AUTHORING transfer this lowered one came from (ghost pass skips its duplicate)
          holds.add(t.to);
        });
        if (tchanged) set({ transfers: nt, ...(dropRel.length ? { _dropRel: dropRel } : {}) });
      }
      // terminals — each is an INDEPENDENT chain END (own ref + actor). For the chosen
      // run at most one applies: the first whose actor is this run's final holder and
      // whose branch was taken (flatOf ≠ null). Lower it to the scalar shot/rim/chip
      // fields the timing engine reads; siblings simply don't fire.
      const cand = pk.terminals || [];
      if (cand.length || dropRel.length) {
        const lastTo = (np.transfers && np.transfers.length) ? np.transfers[np.transfers.length - 1].to : head;
        let win = null, winAt = null;
        for (const t of cand) {
          // who performs this terminal. Its explicit `by` wins; else a BRANCH-ref terminal
          // belongs to whoever ends up holding the puck (lastTo) — the ref only picks which
          // of THEIR branches — and a BASE ("") ref is attributed to the puck's natural
          // author (last authored receiver), so a conditional receiver's shot is dropped on
          // runs they never got the puck.
          const actor = t.by || (t.ref ? lastTo : terminalActor(pk, ps, ""));
          if (actor !== lastTo) continue;
          const a = flatOf(lastTo, t.ref, t.at);
          if (a != null) { win = t; winAt = a; break; }
        }
        const tp = { shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null, rimDist: null, chipDist: null, shand: null };
        if (win) {
          tp.shand = win.shand ?? null;   // forehand/backhand call — every terminal kind carries one
          if (win.kind === "shot") { tp.shotAt = winAt; tp.net = win.net ?? null; }   // the terminal's OWN net (absent = nearest)
          else if (win.kind === "rim") { tp.rimAt = winAt; tp.rimAim = win.aim ?? null; tp.rimDist = win.dist ?? null; }
          else { tp.chipAt = winAt; tp.chipAim = win.aim ?? null; tp.chipDist = win.dist ?? null; }
          tp._winTerm = win;   // the AUTHORING terminal that fired this run (ghost pass skips its duplicate)
        } else {
          // no terminal fired, but a chip/rim handoff lost its catcher this run (their
          // pickup branch wasn't taken) → the puck is still physically released into
          // space, so lower it as a plain terminal release
          const fr = dropRel.find(r => r.kind === "chip" || r.kind === "rim");
          if (fr) {
            tp.shand = fr.shand ?? null;
            if (fr.kind === "chip") { tp.chipAt = fr.at; tp.chipAim = fr.aim; }
            else { tp.rimAt = fr.at; tp.rimAim = fr.aim; }
          }
        }
        set(tp);
      }
      if (changed) { const c = { ...np }; delete c.terminals; np = c; }
      return changed ? np : pk;
    });
    // legacy: an old branch node's terminal `action` → the carried puck (kept for
    // drills authored before per-waypoint branch actions; the reactionPuck must still
    // be empty, so it never conflicts with a translated waypoint action above)
    for (const [id, r] of R) {
      if (!r.terminal || !r.terminal.fork.action || r.terminal.fork.action === "skate") continue;
      const pk = reactionPuck(out, id);
      if (!pk) continue;
      const pi = out.findIndex(q => q.id === pk.id), act = r.terminal.fork.action, at = r.terminal.idx;
      const patch = { shotAt: null, rimAt: null, chipAt: null };
      if (act === "shoot") { patch.shotAt = at; patch.net = r.terminal.fork.net || null; }
      else if (act === "chip") { patch.chipAt = at; patch.chipAim = r.terminal.fork.aim ?? null; patch.chipDist = r.terminal.fork.dist ?? null; }
      else if (act === "rim") { patch.rimAt = at; patch.rimAim = r.terminal.fork.aim ?? null; patch.rimDist = r.terminal.fork.dist ?? null; }
      else if (act === "pass" && r.terminal.fork.to) { patch.transfers = [...(pk.transfers || []), { at, to: r.terminal.fork.to, recvAt: null, kind: "pass" }]; }
      out[pi] = { ...out[pi], ...patch };
    }
    return out;
    };   // end lowerForks
    // the trigger→effect state a possession/link/event branch selects on, read off a
    // lowered run: which routes each player took, how far along the base they got, who
    // finally holds an un-terminated puck, and who released one this run.
    const deriveSolved = (R, out) => {
      const routes = {}, reach = {}, reachT = {}, poss = {}, released = {}, heldWin = {}, releasedT = {};
      // cumulative time at each FLAT index of every player's CHOSEN path (base +
      // spliced branches, via idxMap inversion so branch segments read their own
      // rendered lengths) — release times for the event race come from this
      const pathT = {};
      for (const q of ps) {
        if (q.kind !== "player") continue;
        const r = R.get(q.id);
        const segsF = r ? r.effPath : (q.path || []);
        const inv = [];
        if (r) for (const [ref, m] of Object.entries(r.idxMap || {})) for (const [loc, fl] of Object.entries(m)) inv[fl] = { ref, local: +loc };
        const tArr = []; let acc = 0;
        for (let i = 0; i < segsF.length; i++) {
          const k = inv[i] || { ref: "", local: i };
          acc += authoredSegTime(q, k.ref, k.local, segsF[i]);
          tArr[i] = acc;
        }
        pathT[q.id] = tArr;
      }
      const relAt = (id, idx) => {
        const t = idx == null ? 0 : (pathT[id] || [])[Math.max(0, idx)] ?? 0;
        if (releasedT[id] == null || t < releasedT[id]) releasedT[id] = t;
      };
      for (const [id, r] of R) routes[id] = new Set(r.chain.map(c => (c.ref || "").toLowerCase()));
      // for EVERY player (so any target can be watched): reach = the last BASE waypoint
      // index they get to (where they branch off, else their whole base route); reachT[i] =
      // cumulative TIME (arc-length ÷ pace) to reach base waypoint i — used to RACE
      // conditions so the earliest-firing one wins.
      for (const q of ps) {
        if (q.kind !== "player") continue;
        const r = R.get(q.id);
        const last = r && r.chain.length ? r.chain[0].at : (q.path || []).length - 1;
        reach[q.id] = last;
        const rt = []; let acc = 0; const segs = q.path || [];
        for (let i = 0; i <= last && i < segs.length; i++) { acc += authoredSegTime(q, "", i, segs[i]); rt[i] = acc; }
        reachT[q.id] = rt;
      }
      for (const pk of out) {
        if (pk.kind !== "puck") continue;
        const holder = holderOnLineage(pk, "");                 // lowered → the final holder
        // pk is LOWERED: its terminal is the scalar shot/rim/chip (terminals[] is the
        // authoring form and was consumed by the lowering)
        const ended = pk.shotAt != null || pk.rimAt != null || pk.chipAt != null;
        if (holder && !ended) poss[holder] = true;
        chainIdsOf(pk).forEach(id => { if (id && id !== holder) released[id] = true; });
        if (ended) { const ta = terminalActor(pk, out, ""); if (ta) released[ta] = true; }
        // a release whose DELIVERY branch wasn't taken still happened — without this a
        // `when=<releaser>!` branch that enables the catch could never bootstrap
        for (const r of (pk._dropRel || [])) released[r.by] = true;
        // hold WINDOWS in flat route-index space [gain, release): who has this puck WHEN
        // along the run — lets a possession branch check "holding AT the branch point"
        // instead of the oscillation-prone final state
        {
          const ids = chainIdsOf(pk), tsL = pk.transfers || [];
          let cur = ids[0], g = pk.carrier ? -1 : (pk.pickup ? pk.pickup.at : null);
          const push = (id, gi, li) => { if (id != null && gi != null) (heldWin[id] = heldWin[id] || []).push({ g: gi, l: li }); };
          tsL.forEach(t => { push(cur, g, t.at); relAt(cur, t.at); cur = t.to; g = t.recvAt != null ? t.recvAt : 0; });
          const endAt = pk.shotAt != null ? pk.shotAt : pk.rimAt != null ? pk.rimAt : pk.chipAt;
          const dropAt = (pk._dropRel || []).find(r => r.by === cur);
          push(cur, g, endAt != null ? endAt : dropAt ? dropAt.at : Infinity);
          if (endAt != null) relAt(cur, endAt);
          for (const r of (pk._dropRel || [])) relAt(r.by, r.at);
        }
      }
      return { routes, reach, reachT, poss, released, heldWin, releasedT };
    };
    const solvedSig = s => JSON.stringify([
      Object.fromEntries(Object.entries(s.routes).map(([k, v]) => [k, [...v].sort()])), s.reach, s.reachT, s.poss, s.released, s.releasedT,
      Object.fromEntries(Object.entries(s.heldWin || {}).map(([k, v]) => [k, v.map(w => [w.g, w.l === Infinity ? "inf" : w.l])]))]);
    // no player branches at all: R is empty and lowering is PURE over ps (no seed,
    // no solved input) → cache on ps identity so timing's plan cache (keyed on
    // array identity) still hits frame to frame instead of replanning
    if (!branching.length) {
      solvedRef.current = EMPTY_SOLVED;
      if (lowerCacheRef.current.key !== ps)
        lowerCacheRef.current = { key: ps, out: lowerForks(buildR(EMPTY_SOLVED)) };
      return lowerCacheRef.current.out;
    }
    // no resolved-state condition anywhere → selection is pure geometry+seed, so one pass
    // reproduces the historical behaviour exactly (and can't loop).
    if (!branching.some(p => forksNeedSolve(p.forks))) { solvedRef.current = EMPTY_SOLVED; return lowerForks(buildR(EMPTY_SOLVED)); }
    // bounded, seed-deterministic fixpoint (mirrors timing.js's action-trigger loop):
    // routes depend on possession, possession on the lowered chain, which depends on
    // routes. Seed empty → an unmet condition falls to its default; a cycle terminates at
    // MAX with the last stable assignment (the safe "didn't happen" branch).
    let solved = EMPTY_SOLVED, out = ps, sig = "";
    for (let it = 0; it < 8; it++) {
      const R = buildR(solved);
      out = lowerForks(R);
      solved = deriveSolved(R, out);
      const ns = solvedSig(solved);
      if (ns === sig) break;
      sig = ns;
    }
    solvedRef.current = solved;
    return out;
  }
  // enter route-drawing to author a reaction fork for player `id` under `color`.
  // Reachable from a PINNED panel, which stays up through playback, so it has to
  // put the app back in Edit rather than assume it is already there. setMode
  // does the reset/stop/clear work, then the selection is re-established.
  function beginForkDraw(id, color) {
    setMode("edit");
    resetAnim(); setPlaying(false); setPopup(null); setSelectedId(id); setEditingFork(null);
    forkTarget.current = { id, color }; setForkDrawColor(color); setTool("draw");
  }
  function clearFork(id, ref) {
    updateById(id, { forks: removeForkAt(pieces.find(p => p.id === id)?.forks || [], ref) });
  }
  // create-or-extend a reaction fork with a segment of the given type, continuing
  // from its current end (or the branch), then open the new waypoint for editing.
  // The icon-based counterpart to freehand beginForkDraw.
  function addForkSegment(id, ref, type) {
    const piece = pieces.find(q => q.id === id); if (!piece) return;
    const newIdx = (forkAt(piece, ref)?.path.length) || 0;   // where the new point lands
    update(p => {
      if (p.id !== id) return p;
      const forks = ensureForkAt(p.forks, ref, c => ({ color: c, action: "skate", forks: [], path: [] }));
      const o = forkOriginPoint({ ...p, forks }, ref);
      // a branch's first leg picks up the direction the player was already skating
      const entry = forkEntryDir({ ...p, forks }, ref);
      return { ...p, forks: mapForkAt(forks, ref, f => {
        const rp = { ...p, x: o.x, y: o.y, path: f.path };
        const n = rp.path.length;
        const prev = n ? segEnd(rp, n - 1) : { x: rp.x, y: rp.y };
        const before = n >= 2 ? segEnd(rp, n - 2) : { x: rp.x, y: rp.y };
        let dx = prev.x - before.x, dy = prev.y - before.y;
        const m = Math.hypot(dx, dy);
        if (m < 0.5) { dx = 22; dy = 0; } else { dx = (dx / m) * 22; dy = (dy / m) * 22; }
        const seg = { ...convertSeg({ type, x: clampX(prev.x + dx), y: clampY(prev.y + dy) }, prev),
          dir: n ? dirAtWaypoint(rp.path, n - 1) : entry };
        return { ...f, path: [...f.path, seg] };
      }) };
    });
    setSelectedId(id); setEditingFork({ id, color: ref });
    setPopup({ type: "point", id, seg: newIdx, fork: ref });
  }
  // a fresh cond object for a condition type (null = implicit light-cue-of-colour).
  // Shared by the type dropdown (setForkCond) and the ＋ Add creator (addForkCond).
  function defaultCond(type, id) {
    if (type === "random") return { type: "random" };
    if (type === "sequence") return { type: "sequence", ord: 0 };
    if (type === "always") return { type: "always" };
    if (type === "possession") return { type: "possession" };
    if (type === "link") {
      const tgt = pieces.find(q => q.kind === "player" && q.id !== id && (q.forks || []).length)
        || pieces.find(q => q.kind === "player" && q.id !== id);
      const rt = tgt ? (enumerateRoutes(tgt).find(r => r.ref)?.ref || "") : "";
      return { type: "link", player: tgt ? tgt.id : "", route: rt };
    }
    if (type === "event") {
      const tgt = pieces.find(q => q.kind === "player" && q.id !== id);
      return { type: "event", on: tgt ? tgt.id : "", mode: "action" };
    }
    return null;                                             // light → implicit cue-of-colour
  }
  // set how a branch is CHOSEN at its waypoint. Changing to "On cue" drops the explicit
  // condition when the fork's own colour is a cue of the light (implicit match); else it
  // pins the first cue colour so the branch can still fire.
  function setForkCond(id, ref, type) {
    const pl = pieces.find(p => p.id === id); if (!pl) return;
    updateById(id, { forks: mapForkAt(pl.forks, ref, f => {
      const nf = { ...f };
      if (type === "light") {
        const lt = governingLightFor(pieces, pl, branchPoint(pl));
        const cues = lt ? [...new Set((lt.cues || []).map(c => c.color))] : [];
        if (!cues.length || cues.some(c => sameColor(c, f.color))) delete nf.cond;
        else nf.cond = { type: "light", color: cues[0] };
      } else nf.cond = defaultCond(type, id);
      return nf;
    }) });
  }
  // an unused branch-identity colour: the palette first, then deterministic unique
  // hex once it's exhausted — so NON-cue conditions aren't capped by the palette (or a
  // light's cue count). The colour is only an internal ref key for these (their route
  // draws in the player's colour), so any distinct hex works.
  function freeForkColor(used) {
    const pal = LIGHT_COLORS.find(c => !used.has(String(c).toLowerCase()));
    if (pal) return pal;
    for (let n = 1; n < 1e5; n++) {
      const c = "#" + (((n * 0x9e3779b1) >>> 0) & 0xffffff).toString(16).padStart(6, "0");
      if (!used.has(c)) return c;
    }
    return LIGHT_COLORS[0];
  }
  // create a NEW reaction branch of a chosen condition type at this level (base route
  // end, or under `parentRef` for a chained reaction), then open it for route drawing.
  // On-cue branches take the next unused CUE colour of the governing light (they're the
  // only type tied to a light); every other condition takes a free identity colour, so
  // the number of general conditions is independent of any light.
  function addForkCond(id, parentRef, type) {
    const pl = pieces.find(p => p.id === id); if (!pl) return;
    const sibs = parentRef ? (forkAt(pl, parentRef)?.forks || []) : (pl.forks || []);
    const used = new Set(sibs.map(f => String(f.color).toLowerCase()));
    const light = governingLightFor(pieces, pl, branchPoint(pl));
    const cueCols = light ? [...new Set((light.cues || []).map(c => c.color))] : [];
    const color = (type === "light" && cueCols.length)
      ? (cueCols.find(c => !used.has(c.toLowerCase())) || cueCols[0])
      : freeForkColor(used);
    const ref = parentRef ? parentRef + "/" + color : color;
    const cond = defaultCond(type, id);
    update(p => p.id === id ? { ...p, forks: ensureForkAt(p.forks, ref, c => ({ color: c, action: "skate", forks: [], path: [], ...(cond ? { cond } : {}) })) } : p);
    setSelectedId(id); setEditingFork({ id, color: ref });
  }
  // merge a patch into a branch's existing cond (the link/event secondary pickers)
  function updateForkCond(id, ref, patch) {
    const pl = pieces.find(p => p.id === id); if (!pl) return;
    updateById(id, { forks: mapForkAt(pl.forks, ref, f => ({ ...f, cond: { ...(f.cond || {}), ...patch } })) });
  }
  // set the waypoint a TOP-LEVEL branch departs from (0-based; route end = default, so
  // stored only when earlier). Enables "multiple routes off one waypoint" from the UI.
  function setForkAt(id, ref, at) {
    const pl = pieces.find(p => p.id === id); if (!pl) return;
    updateById(id, { forks: mapForkAt(pl.forks, ref, f => {
      const nf = { ...f };
      if (at == null || at >= pl.path.length - 1) delete nf.at; else nf.at = Math.max(0, at);
      return nf;
    }) });
  }
  // the shared "curve set" of route buttons: straight / curve / S-curve, plus a
  // 4th freehand-draw button. onType(t) adds a segment of that type; onDraw()
  // enters freehand mode. Used anywhere a route is built or extended.
  const curveButtons = (onType, onDraw, activeType = null) => (
    <>
      {[["L", "segLine", "Straight"], ["Q", "segQuad", "Curve"], ["C", "segCubic", "S-curve"]].map(([t, ic, lbl]) => (
        <button key={t} className={`hd-mini iconlbl${activeType === t ? " on" : ""}`} title={lbl} onClick={() => onType(t)}>
          <Icon name={ic} /><small>{lbl}</small></button>
      ))}
      <button className="hd-mini iconlbl" title="Freehand draw" onClick={onDraw}><Icon name="pencil" /><small>Draw</small></button>
    </>
  );
  // enter freehand draw mode for a route: a reaction fork, else the base route
  function drawRouteMode(id, fork) {
    if (fork) { beginForkDraw(id, fork); return; }
    setMode("edit");   // route drawing is a sub-state of Edit, never its own flow
    resetAnim(); setPlaying(false); setPopup(null); setSelectedId(id); setEditingFork(null); setTool("draw");
  }
  // the reaction-authoring controls (curve buttons + action + Edit/Clear per cue
  // colour). `parentRef` null = the base branch (route end); a fork ref = a chained
  // reaction off that (skate) reaction's end. Null if no governing cue-light.
  // The Reactions box (styled like the Action box): each condition is a card with a
  // type dropdown + type-specific options + its route, and a ＋ Add dropdown creates a
  // new condition of any type. `parentRef` null = branches off the base route end; a
  // fork ref = chained reactions off that (skate) reaction's end.
  function renderLightReactions(p, parentRef = null) {
    const branchPt = parentRef
      ? (() => { const f = forkAt(p, parentRef); return f && f.path.length ? { x: f.path[f.path.length - 1].x, y: f.path[f.path.length - 1].y } : branchPoint(p); })()
      : branchPoint(p);
    const light = governingLightFor(pieces, p, branchPt);
    const cueLights = pieces.filter(q => q.kind === "light" && (q.cues || []).length);
    const cueCols = light ? [...new Set((light.cues || []).map(c => c.color))] : [];
    const others = pieces.filter(q => q.kind === "player" && q.id !== p.id);
    // (the reaction dropdowns wear .hd-select like every other select. They used
    // to carry a hardcoded dark inline style, which rendered them as black boxes
    // on a light theme — inline styles skip the token layer, and the no-raw-hex
    // guard only reads styles.js, so nothing caught it.)
    const COND_LABEL = { light: "On cue", random: "Random", sequence: "Sequence", always: "Always",
      possession: "If holding…", link: "If route…", event: "When player…" };
    const sibs = parentRef ? (forkAt(p, parentRef)?.forks || []) : (p.forks || []);
    const addTypes = Object.keys(COND_LABEL).filter(t => t !== "light" || cueCols.length);   // On cue needs a cue-light
    // one condition card: swatch + type dropdown + type options, then its route row
    const card = fk => {
      const ref = parentRef ? parentRef + "/" + fk.color : fk.color;
      const ct = condOf(fk).type;
      const isEditing = editingFork && editingFork.id === p.id && forkEq(editingFork.color, ref);
      return (
        // same card as a puck action step; the stripe is the CUE COLOUR here, so
        // it stays a literal — it's drill data, not chrome, and must match the
        // light on the ice exactly
        <div key={ref} className="hd-step" style={{ borderLeftColor: fk.color }}>
          <div className="hd-poprow">
            <div className="hd-swatch on" style={{ background: fk.color, cursor: "default" }} />
            <select value={ct} className="hd-select" title="condition — how this route is chosen"
              onChange={e => setForkCond(p.id, ref, e.target.value)}>
              {Object.entries(COND_LABEL).map(([t, lbl]) => <option key={t} value={t}>{lbl}</option>)}
            </select>
            {ct === "light" && (() => {
              const cd = condOf(fk);
              // this route's own cue device (cond.lightId) — else the player's governing
              // light. Each On-cue card can read a DIFFERENT device.
              const lt = cd.lightId ? pieces.find(q => q.id === cd.lightId && q.kind === "light" && (q.cues || []).length)
                : governingLightFor(pieces, p, branchPt);
              const cols = lt ? [...new Set((lt.cues || []).map(c => c.color))] : [];
              const sel = (cd.color || fk.color).toLowerCase();
              return (<>
                {cueLights.length > 1 && (
                  <select value={cd.lightId || ""} className="hd-select" title="cue device this route reads"
                    onChange={e => updateForkCond(p.id, ref, { type: "light", color: cd.color || fk.color, lightId: e.target.value || undefined })}>
                    <option value="">Auto ({governingLightNear(pieces, branchPt)?.id || "—"})</option>
                    {cueLights.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
                  </select>
                )}
                {cols.map(c => (
                  <div key={c} title={`fires on the ${c} cue`} className={`hd-swatch${sel === c.toLowerCase() ? " on" : ""}`}
                    style={{ background: c }} onClick={() => updateForkCond(p.id, ref, { type: "light", color: c, ...(cd.lightId ? { lightId: cd.lightId } : {}) })} />
                ))}
              </>);
            })()}
            {ct === "link" && (() => {
              const tgt = pieces.find(q => q.id === condOf(fk).player);
              const routes = tgt ? enumerateRoutes(tgt).filter(r => r.ref) : [];
              const nums = tgt ? forkNumbers(tgt) : new Map();   // matches the faint R-numbers on the ice
              return (<>
                <select value={condOf(fk).player || ""} className="hd-select" title="react to this player"
                  onChange={e => { const t2 = pieces.find(q => q.id === e.target.value); updateForkCond(p.id, ref, { player: e.target.value, route: t2 ? (enumerateRoutes(t2).find(r => r.ref)?.ref || "") : "" }); }}>
                  {others.map(o => <option key={o.id} value={o.id}>{o.id}</option>)}
                </select>
                <select value={(condOf(fk).route || "").toLowerCase()} className="hd-select" title="…taking this route (numbers match the labels on the ice)"
                  onChange={e => updateForkCond(p.id, ref, { route: e.target.value })}>
                  {routes.map(r => <option key={r.ref} value={r.ref.toLowerCase()}>{`R${nums.get(r.ref.toLowerCase()) ?? "?"} · ${r.ref.replace(/#/g, "")}`}</option>)}
                  {!routes.length && <option value="">(no branches)</option>}
                </select>
              </>);
            })()}
            {ct === "event" && (() => {
              const c = condOf(fk);
              const tgt = pieces.find(q => q.id === c.on);
              const wps = tgt ? (tgt.path || []) : [];
              return (<>
                <select value={c.on || ""} className="hd-select" title="watch this player"
                  onChange={e => { const t2 = pieces.find(q => q.id === e.target.value); updateForkCond(p.id, ref, { on: e.target.value, ...(c.mode === "waypoint" ? { at: Math.max(0, ((t2?.path || []).length) - 1) } : {}) }); }}>
                  {others.map(o => <option key={o.id} value={o.id}>{o.id}</option>)}
                </select>
                <select value={c.mode || "action"} className="hd-select" title="trigger"
                  onChange={e => { const m = e.target.value; updateForkCond(p.id, ref, { mode: m, ...(m === "waypoint" && c.at == null ? { at: Math.max(0, (wps.length) - 1) } : {}) }); }}>
                  <option value="action">releases puck</option>
                  <option value="waypoint">reaches point</option>
                </select>
                {c.mode === "waypoint" && (
                  <select value={c.at != null ? c.at : Math.max(0, wps.length - 1)} className="hd-select" title="…reaches this waypoint"
                    onChange={e => updateForkCond(p.id, ref, { at: parseInt(e.target.value, 10) })}>
                    {wps.length ? wps.map((_, wi) => <option key={wi} value={wi}>@{wi + 1}</option>) : <option value="0">@1</option>}
                  </select>
                )}
              </>);
            })()}
            {ct === "possession" && (
              // whose possession fires this route: mine (default) or another player's —
              // e.g. a defender collapses while the attacker still has the puck
              <select value={condOf(fk).player || ""} className="hd-select" title="whose possession fires this route"
                onChange={e => updateForkCond(p.id, ref, { player: e.target.value || undefined })}>
                <option value="">I&apos;m holding</option>
                {others.map(o => <option key={o.id} value={o.id}>{nameOf(o.id)} holding</option>)}
              </select>
            )}
            <button className="hd-mini danger" title="Remove condition" style={{ marginLeft: "auto", padding: "3px 8px", minHeight: 0 }}
              onClick={() => { if (isEditing) setEditingFork(null); clearFork(p.id, ref); }}>✕</button>
          </div>
          <div className="hd-poprow">
            <span className="hd-steplbl">Route</span>
            {curveButtons(t => addForkSegment(p.id, ref, t), () => beginForkDraw(p.id, ref))}
            <button className={`hd-mini${isEditing ? " on" : ""}`}
              onClick={() => setEditingFork(isEditing ? null : { id: p.id, color: ref })}>{isEditing ? "✓ Editing" : "Edit"}</button>
            {!parentRef && p.path.length > 1 && (
              <select value={fk.at != null ? fk.at : p.path.length - 1} className="hd-select" title="departs from this waypoint"
                onChange={e => setForkAt(p.id, ref, parseInt(e.target.value, 10))}>
                {p.path.map((_, wi) => <option key={wi} value={wi}>@{wi + 1}</option>)}
              </select>
            )}
          </div>
        </div>
      );
    };
    return (
      <div style={{ margin: "6px 0", padding: "7px 8px", background: "rgba(120,140,160,0.12)", borderRadius: 8 }}>
        <div className="hd-mh" style={{ marginBottom: 5 }}>
          {parentRef ? "Chained reactions" : "Reactions"}
        </div>
        {sibs.map(card)}
        <div className="hd-poprow">
          <span className="hd-steplbl">＋ Add</span>
          <select value="none" className="hd-select" title="add a condition"
            onChange={e => { if (e.target.value !== "none") addForkCond(p.id, parentRef, e.target.value); }}>
            <option value="none">condition…</option>
            {addTypes.map(t => <option key={t} value={t}>{COND_LABEL[t]}</option>)}
          </select>
        </div>
      </div>
    );
  }
  // the set of fork refs (lower-cased) to draw SOLID (the others dashed) — the
  // player's chosen reaction path. Walks the same chain resolveForks does. In
  // REACTIVE mode during playback it's time-aware: at the branch the player is still
  // skating toward, the solid fork tracks the light's LIVE colour (so it rotates as
  // the light cycles), then locks to the committed fork once the player passes the
  // branch — the "read the light and react on the fly" look. Other modes / not
  // playing → the committed chain throughout.
  function chosenForkRefs(p) {
    const set = new Set();
    if (!(p.forks || []).length) return set;
    const E = animT <= 0 ? 0 : animT * totalTime;
    for (const node of resolveRoute(p).chain) {
      // branch not yet reached, reactive, mid-play → highlight the live-colour fork and
      // stop (downstream branches aren't in play until this one is committed)
      if (playing && node.light && lightMode(node.light) === "reactive" && E < node.arrivalT) {
        const live = cueColorAt(node.light.cues, E, cueSeed(node.light));
        const lf = (node.forks || []).find(f => sameColor(f.color, live) && f.path && f.path.length);
        if (lf) set.add(String(node.prefix ? node.prefix + "/" + lf.color : lf.color).toLowerCase());
        return set;
      }
      set.add(String(node.ref).toLowerCase());
    }
    return set;
  }

  function displayPos(p) {
    p = effOf(p);
    const res = displayPosRaw(p);
    if (animT <= 0) return res;
    // players arc around nets/parked players (via the route detour) and deviate
    // around other MOVING players per-frame so skaters never pass through each other
    if (p.kind === "player") {
      const rd = routeDetour(p);
      let x = res.x, y = res.y, a = res.a;
      if (rd) {
        const f = rd.origLen > 0 ? (res.dist || 0) / rd.origLen : 0;
        const s = samplePoly(rd.pts, f);
        // follow the detour's own tangent, but keep whatever the route says the body
        // is doing — backwards, or partway through a pivot (a per-route "any leg is
        // bwd" boolean can't express the middle of a turn)
        x = s.x; y = s.y; a = s.a + (res.flip || 0);
      }
      const side = p.hand === "L" ? -1 : 1;
      const others = [];                                   // other skaters (for shield + push)
      for (const q of pieces) {
        if (q.kind !== "player" || q.id === p.id) continue;
        const rq = displayPosRaw(q);
        others.push({ cx: rq.x, cy: rq.y, r: PLAYER_R });
        // deviate around a moving/reactive player (parked ones are in the detour)
        if (collisions && p.path.length && (q.path.length || q.defense)) {
          const dx = x - rq.x, dy = y - rq.y, d = Math.hypot(dx, dy), MIN = PLAYER_R * 2;
          if (d < MIN && d > 1e-3) { const push = (MIN - d) * 0.5; x += (dx / d) * push; y += (dy / d) * push; }
        }
      }
      // the goalie is fused into the net's route detour (see detourNetDiscs) so
      // the skater curves smoothly around it; a soft radial nudge only catches
      // residual overlap as the goalie slides frame-to-frame.
      const gDiscs = goalieDiscs();
      if (collisions && p.path.length) for (const gd of gDiscs) {
        const dx = x - gd.cx, dy = y - gd.cy, d = Math.hypot(dx, dy), MIN = PLAYER_R + gd.r;
        if (d < MIN && d > 1e-3) { const push = (MIN - d) * 0.3; x += (dx / d) * push; y += (dy / d) * push; }
      }
      // open the body to shield a carried puck from a net, goalie, another
      // player, or an obstacle tool (bumper/tire/passer/deker) it routes around.
      // Test the puck against my RAW blade (authored frame, matching the puck
      // branch below) — NOT the detoured centre (x,y), which diverges from the
      // puck by several feet at a detour's apex and would cut the shield off
      // exactly when the carrier is rounding the obstacle.
      const spSelf = stickSpot(p.id, animT <= 0 ? 0 : animT * totalTime);
      const rawBlade = bladeAtWorld(res.x, res.y, res.a || 0, spSelf.fwd * ICON_SCALE * PLAYER_SCALE, spSelf.lat * ICON_SCALE * PLAYER_SCALE, side);
      const carries = collisions && pieces.some(q => q.kind === "puck"
        && Math.hypot(displayPosRaw(q).x - rawBlade.x, displayPosRaw(q).y - rawBlade.y) < 2.2);
      if (carries) {
        // skip props the carrier jumps over (hopped, not routed around)
        const jps = jumpPointsOf(p);
        const bTip = bladeAtWorld(x, y, a, TIP_FWD, TIP_LAT, side);   // reach off the strong-side blade
        const props = shieldPropDiscs(bTip).filter(d => !jps.some(j => Math.hypot(j.x - d.cx, j.y - d.cy) < d.r + 3));
        a += shieldDelta(x, y, a, side, [...netObstacles, ...others, ...gDiscs, ...props]);
      }
      return { ...res, x, y, a };
    }
    // a carried puck sits on its carrier's blade tip (so it stays on the stick
    // through the detour + shield, instead of clipping the net). The carrier is
    // the CLOSEST blade within reach — never the first player in piece order,
    // whose raw (undetoured) route may sweep right through another carrier's
    // spot and steal the puck for a few frames as they pass by.
    if (p.kind === "puck") {
      let cq = null, cSide = 1, cd = 2.2;
      // A puck the plan says is in the air is NOT on anyone's stick, however close it
      // still is to the one that fired it — only the catch approach below may claim
      // it. Without this the proximity match holds a just-released puck on the blade
      // for a frame or two and then hands over the whole gap at once.
      const inAir = puckInFlight(p.id, animT <= 0 ? 0 : animT * totalTime);
      for (const q of inAir ? [] : pieces) {
        if (q.kind !== "player" || q.defense) continue;   // (defense never carries; avoids recursion)
        // Match against the ROUTE pose, not displayPosRaw: the puck's own position
        // comes off that same pose (carriedPuckAt), while displayPosRaw adds the
        // stride/plant lean. A deep hockey-stop plant swings a leaned blade several
        // feet, which used to push the carrier past this 2.2ft gate and drop the puck
        // off the stick for as long as the lean lasted.
        const e = animT <= 0 ? 0 : animT * totalTime;
        const raw = displayPosAt(q, e);
        const side = q.hand === "L" ? -1 : 1;
        // ...and against the SAME lever the puck is sitting on: through a shot/pass
        // wind-up that lever swings out to the release spot, which would otherwise
        // carry the puck straight out of this gate's reach mid-wind-up
        const sp = stickSpot(q.id, e);
        const bladeRaw = bladeAtWorld(raw.x, raw.y, raw.a || 0, sp.fwd * ICON_SCALE * PLAYER_SCALE, sp.lat * ICON_SCALE * PLAYER_SCALE, side);
        const d = Math.hypot(res.x - bladeRaw.x, res.y - bladeRaw.y);
        if (d < cd) { cd = d; cq = q; cSide = side; }
      }
      // ...or it is the last stretch of a pass on its way to them. The plan already
      // steers the flight onto the receiver's route-pose blade; only here do we know
      // where that blade really is once the body lean, plant and shield are on it, so
      // ease the rest of the way in. `w` is 1 by the time it lands, which is what
      // makes the catch continuous instead of a hop onto the stick.
      let approachW = 1;
      if (!cq) {
        const eNow = animT <= 0 ? 0 : animT * totalTime;
        const ap = catchApproach(p.id, eNow);
        const rec = ap && pieces.find(x => x.id === ap.id && x.kind === "player" && !x.defense);
        if (rec) { cq = rec; cSide = rec.hand === "L" ? -1 : 1; approachW = ap.w; }
        else {
          // ...and the same at the LAUNCH end. A carried puck is drawn on the real blade
          // (lean, plant, shield); the plan's launch point comes off the route pose and
          // knows none of it, so cutting straight there pops the puck several feet in one
          // frame — worst at a route end, where the hockey-stop plant swings the blade
          // furthest. Apply the difference as a FROZEN offset that decays linearly:
          // frozen so it doesn't chase the still-planting body, linear so it only moves
          // where the flight starts instead of bending it. displayPosAt has already
          // nudged `res` onto dp.rx/ry, so this is the remainder on top of that.
          const dp = releaseDepart(p.id, eNow);
          const sh = dp && pieces.find(x => x.id === dp.id && x.kind === "player" && !x.defense);
          if (sh) {
            const q0 = displayPosRaw(sh, dp.t0);
            const side0 = sh.hand === "L" ? -1 : 1;
            const tip0 = whiteboard
              ? bladeAtWorld(q0.x, q0.y, q0.a || 0, 2.4, 0, side0)
              : bladeAtWorld(q0.x, q0.y, q0.a || 0, dp.lever.fwd * ICON_SCALE * PLAYER_SCALE,
                  dp.lever.lat * ICON_SCALE * PLAYER_SCALE, side0);
            return { ...res, x: res.x + (tip0.x - dp.rx) * dp.w, y: res.y + (tip0.y - dp.ry) * dp.w };
          }
        }
      }
      {
        const q = cq, side = cSide;
        if (q) {   // this puck is on q's blade
          const qd = displayPos(q);                                       // shielded carrier
          // the blade tip, swinging out to the release spot beside the near foot
          // through a shot/pass wind-up — the same lever the plan launches from, so
          // the puck travels there with the stick instead of jumping at the release.
          // Whiteboard: no stick to ride, so tuck the puck right up against the
          // symbol (just clear of the glyph) instead of out at the blade tip.
          const sp = stickSpot(q.id, animT <= 0 ? 0 : animT * totalTime);
          const tip = whiteboard
            ? bladeAtWorld(qd.x, qd.y, qd.a || 0, 2.4, 0, side)
            : bladeAtWorld(qd.x, qd.y, qd.a || 0, sp.fwd * ICON_SCALE * PLAYER_SCALE, sp.lat * ICON_SCALE * PLAYER_SCALE, side);
          // the stickhandle is already in `sp` — it swings the lever with the stick,
          // so the puck rides the blade instead of orbiting it on a separate cradle
          return { ...res, x: res.x + (tip.x - res.x) * approachW,
            y: res.y + (tip.y - res.y) * approachW };
        }
      }
    }
    return res;
  }
  // `eAt` samples the drawn pose at a GIVEN time instead of the current frame — the
  // release nudge needs the shooter's pose at the instant the puck left, frozen, or it
  // chases a still-planting body and bends the flight.
  function displayPosRaw(p, eAt) {
    p = effOf(p);
    if (p.kind === "player" && p.defense) return animT > 0 ? dmanPos(p) : { x: p.x, y: p.y, a: p.facing || 0 };
    const eFix = eAt != null ? eAt : (animT <= 0 ? 0 : animT * totalTime);
    const dp = displayPosAt(p, eFix);
    if (!effDetail || p.kind !== "player" || animT <= 0) return dp; // detail off / editing board: still frame
    const r = dp.smul || 0;                               // effective speed multiple
    let lat = 0, fore = 0, lean = 0;                      // lateral / fore-aft ft, deg — vs facing
    const kIdle = 1 - Math.min(1, r / FIDGET_FADE);       // fades out as a route spools up
    if (kIdle > 0) {
      // standing (or near enough): shift weight instead of freezing solid.
      // Two incommensurate slow sines per axis so the motion never loops
      // visibly; phase hashed from the id so players fidget out of sync.
      const e = eFix;
      let ph = 0;
      for (let i = 0; i < String(p.id).length; i++) ph += String(p.id).charCodeAt(i) * 0.618;
      ph = (ph % 1) * 2 * Math.PI;
      lat += ((Math.sin(e * 1.7 + ph) + 0.5 * Math.sin(e * 2.9 + ph * 2)) / 1.5) * FIDGET_AMP * kIdle;
      fore += Math.sin(e * 1.1 + ph * 3) * FIDGET_BOB * kIdle;
      lean += FIDGET_LEAN * Math.sin(e * 2.3 + ph) * kIdle;
    }
    if (r > 0.02) {
      const g = Math.max(0, Math.min(1, (r - GLIDE_AT) / (HARD_AT - GLIDE_AT)));
      const strength = g * g * (3 - 2 * g);               // 0 glide → 1 aggressive
      const phase = (2 * Math.PI * (dp.dist || 0)) / STRIDE_LAMBDA;
      lat += Math.sin(phase) * STRIDE_AMP * strength;
      lean += STRIDE_LEAN * strength * Math.cos(phase);
    }
    // Hockey stop: the body turns sideways into the bite, deepest at the moment they
    // come to rest, then settles back square — so it has to keep relaxing AFTER the
    // route stops (dp.brake outlives the speed) and it has to stay on ONE edge the
    // whole time (dp.brakeAt is the arrival distance, frozen, so the stride phase
    // can't advance the plant onto the other foot part-way through).
    if (dp.brake > 0)
      lean += PLANT_DEG * dp.brake
        * (Math.sin((2 * Math.PI * (dp.brakeAt || 0)) / STRIDE_LAMBDA) >= 0 ? 1 : -1);
    if (!lat && !fore && !lean) return dp;
    const hd = ((dp.a || 0) * Math.PI) / 180;             // lateral = facing+90
    return {
      ...dp,
      x: clampX(dp.x - Math.sin(hd) * lat + Math.cos(hd) * fore),
      y: clampY(dp.y + Math.cos(hd) * lat + Math.sin(hd) * fore),
      a: (dp.a || 0) + lean,
    };
  }

  // goalie plays the angle: it slides across the front to cover the puck, comes
  // out to challenge when the puck is far, and backs to the goal line as the
  // play nears. Clamped to the net's front hemisphere so it stays in the crease.
  function goaliePos(net, posFn = displayPos) {
    // a tire keeper works the FULL circle (no front hemisphere), riding just
    // outside the rubber wherever the puck is; a net keeper is post-to-post
    const isTire = net.kind === "tire";
    const R_TIRE = 2.6 * ICON_SCALE * (net.size || 1) + 1.3;
    const f = ((net.facing || 0) * Math.PI) / 180;    // net mouth opens this way
    const e = eFix;
    const MAXREL = isTire ? Math.PI : (82 * Math.PI) / 180; // net: post-to-post; tire: all the way round
    const onArc = (ang, R) => {                         // clamp an aim angle to the front hemisphere
      let rel = ang - f; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      rel = Math.max(-MAXREL, Math.min(MAXREL, rel));
      const a = f + rel;
      const rr = isTire ? R_TIRE : R;                   // a tire keeper always rides just off the rubber
      return { x: net.x + Math.cos(a) * rr, y: net.y + Math.sin(a) * rr, a: (a * 180) / Math.PI };
    };
    // freeze on a shot: once a shot at this net is released, the goalie sets and
    // holds — on a save the puck stops right at it, a corner goal beats it clean
    const { plans } = getPlan();
    let shot = null;
    for (const pid in plans) for (const leg of plans[pid].legs) {
      if (leg.type === "fly" && leg.shot && e >= leg.t0
        && Math.hypot(leg.x1 - net.x, leg.y1 - net.y) < 12
        && (!shot || leg.t0 > shot.t0)) shot = leg;
    }
    if (shot) {
      // slide across the crease toward the shot's origin, but stay in front of
      // the net (post-to-post) — a wrap-around shooter must not drag the goalie
      // around behind or through the cage
      const R = shot.save ? 2.5 : 2;                   // save depth matches the puck's stop point
      return onArc(Math.atan2(shot.y0 - net.y, shot.x0 - net.x), R);
    }
    const pucks = pieces.filter(q => q.kind === "puck");
    let aim = { x: net.x + Math.cos(f) * 20, y: net.y + Math.sin(f) * 20 }, best = Infinity;
    pucks.forEach(pk => {
      const dp = posFn(pk);
      const d = Math.hypot(dp.x - net.x, dp.y - net.y);
      if (d < best) { best = d; aim = dp; }
    });
    const dist = best === Infinity ? 30 : best;
    // depth: deep on the line when close, out to the top of the crease when far
    const D_NEAR = 9, D_FAR = 45, R_MIN = 0.6, R_MAX = 6;
    const u = Math.max(0, Math.min(1, (dist - D_NEAR) / (D_FAR - D_NEAR)));
    const R = R_MIN + (R_MAX - R_MIN) * (u * u * (3 - 2 * u)); // smoothstep
    // track the puck aggressively, clamped to the front hemisphere (never behind)
    return onArc(Math.atan2(aim.y - net.y, aim.x - net.x), R);
  }

  // airborne height (0..1) of a lofted puck this frame — for the fake-3D lift +
  // shadow. A `sauce` leg arcs up and back down to land (pass); a `rise` leg is a
  // shot climbing all the way to the net — it keeps rising to a peak AT the net,
  // then drops in over a beat.
  function sauceLift(pk) {
    if (animT <= 0 || pk.kind !== "puck") return 0;
    const e = animT * totalTime;
    const plan = getPlan().plans[pk.id];
    if (!plan) return 0;
    for (const leg of plan.legs) {
      if (leg.type !== "fly" || (!leg.sauce && !leg.rise)) continue;
      const span = (leg.t1 - leg.t0) || 1;
      if (leg.rise) {
        // Climb, then drop back ONTO the contact point. Height is faked by offsetting
        // the puck away from its ground shadow, and a top-down rink has no spare axis
        // for it — so a puck still lifted when it reaches the net is drawn feet to the
        // SIDE of where it actually hit. That read as posts struck wide of the mesh and
        // goals hanging in mid-air beside the net. Peaked late (u^1.5) so it still
        // reads as rising, but it is back on the ice by the time it arrives.
        // ...and down BEFORE it gets there, not just at the instant of impact: the
        // last stretch of the approach has to be at ice level or the puck is still
        // drawn a foot or two to the side of the post it is about to hit.
        const uu = ((e - leg.t0) / span) / 0.82;
        if (e >= leg.t0 && e <= leg.t1) return uu >= 1 ? 0 : Math.sin(Math.PI * Math.pow(uu, 1.2));
      } else {
        if (e >= leg.t0 && e <= leg.t1) return Math.sin(Math.PI * ((e - leg.t0) / span));           // sauce arc up and down
        if (e > leg.t1 && e < leg.t1 + 0.22) return Math.sin(Math.PI * ((e - leg.t1) / 0.22)) * 0.22; // landing bounce
      }
    }
    return 0;
  }
  const LIFT_MAX = 4.6;                         // peak visual height, feet
  const liftDir = () => { const r = (screenRot * Math.PI) / 180; return { x: -Math.sin(r), y: -Math.cos(r) }; };
  // a player's jump hop (0..1..0) at the current frame: a waypoint marked `jump`
  // makes them leap as they pass it — they grow over a sticky ground shadow, then
  // shrink back. Centred on the arrival time at that waypoint.
  const JUMP_DUR = 0.62;
  function jumpLift(p) {
    p = effOf(p);                                 // hop on jumps authored on branch waypoints too (resolved path)
    if (animT <= 0 || p.kind !== "player" || !p.path.length) return 0;
    const e = animT * totalTime;
    for (let i = 0; i < p.path.length; i++) {
      if (!p.path[i].jump) continue;
      const tw = waypointTime(p, i - 1);        // the jump sits at the start of segment i
      if (e >= tw - JUMP_DUR / 2 && e <= tw + JUMP_DUR / 2) return Math.sin(Math.PI * ((e - (tw - JUMP_DUR / 2)) / JUMP_DUR));
    }
    return 0;
  }

  /* ----- coords ----- */
  function svgPtXY(cx, cy) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    // the scene <g> carries the orientation transform, so its CTM
    // maps client pixels straight into rink feet either way
    const m = (sceneRef.current || svg).getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const q = pt.matrixTransform(m.inverse());
    return { x: clampX(q.x), y: clampY(q.y) };
  }
  const svgPt = evt => svgPtXY(evt.clientX, evt.clientY);
  // Rink feet per screen pixel, PER RINK AXIS — the pen interprets ink in
  // screen space, so it needs both: zoom sets the magnitude and the cosmetic
  // fill-stretch makes x and y differ (that difference is what turned a round
  // Pencil circle into an unrecognizable ellipse before v6.26). Probing 100px
  // along each SCREEN axis and taking the per-rink-axis spans covers portrait
  // too, where the rink is rotated and screen-x moves rink-y.
  function ftPerPx() {
    const r = svgRef.current?.getBoundingClientRect?.();
    if (!r || !r.width) return { x: 0, y: 0 };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const [a, b, c, d] = [svgPtXY(cx - 50, cy), svgPtXY(cx + 50, cy), svgPtXY(cx, cy - 50), svgPtXY(cx, cy + 50)];
    // each rink axis moves under exactly one screen axis (0° or 90° rotation)
    const fxx = Math.abs(b.x - a.x) / 100, fxy = Math.abs(d.x - c.x) / 100;
    const fyx = Math.abs(b.y - a.y) / 100, fyy = Math.abs(d.y - c.y) / 100;
    return { x: Math.max(fxx, fxy), y: Math.max(fyx, fyy) };
  }

  /* ----- edits ----- */
  const update = fn => setPieces(ps => ps.map(fn));
  const updateById = (id, patch) => update(p => (p.id === id ? { ...p, ...patch } : p));
  const looseFields = { carrier: null, pickup: null, transfers: [], terminals: undefined };
  // when a player is removed, auto-delete every chain action it influenced: if it
  // starts the chain (carrier/pickup) the whole chain goes; if it's a transfer
  // target, that action and everything downstream (incl. the terminal) is dropped
  const scrubRefs = (list, goneId) => list.map(q => {
    // a player whose start-trigger / pause-trigger was the removed player loses it
    if (q.kind === "player") {
      let nq = q;
      if (q.wait && q.wait.on === goneId) nq = { ...nq, wait: null };
      if ((q.path || []).some(s => s.waitOn && s.waitOn.on === goneId))
        nq = { ...nq, path: q.path.map(s => (s.waitOn && s.waitOn.on === goneId ? { ...s, waitOn: null } : s)) };
      if (nq !== q) return nq;
    }
    if (q.kind !== "puck") return q;
    if (q.carrier === goneId || (q.pickup && q.pickup.to === goneId)) return { ...q, ...looseFields };
    // drop only the chain entries INVOLVING the removed player — sibling branches'
    // actions are independent and must survive (a stint the removed player enabled
    // downstream just shows its "won't happen" flag)
    const ts = (q.transfers || []).filter(t => t.to !== goneId && t.by !== goneId && t.via !== goneId);
    const terms = (q.terminals || []).filter(t => t.by !== goneId);
    if (ts.length !== (q.transfers || []).length || terms.length !== (q.terminals || []).length)
      return { ...q, transfers: ts, terminals: terms.length ? terms : undefined };
    return q;
  });
  // remove a piece and clean up any references to it
  const deletePiece = id => {
    setPieces(ps => scrubRefs(ps.filter(q => q.id !== id), id));
    setSelectedId(null); setPopup(null);
    flash(`Deleted ${id} — Undo restores it`);
  };

  // record a coalesced undo snapshot whenever the drill DOCUMENT changes —
  // pieces, rink, title/description, steps, notes, inventory — so text-editor
  // Apply, file Load and Clear all are as undoable as a piece drag. Rapid
  // changes (a drag's frames, typing) fold into one entry, and an undo doesn't
  // re-record.
  const DOC_KEYS = ["pieces", "rink", "drillTitle", "drillDesc", "drillSteps", "drillNotes", "drillItems"];
  const curDoc = { pieces, rink, drillTitle, drillDesc, drillSteps, drillNotes, drillItems };
  useEffect(() => {
    const prev = prevDocRef.current;
    prevDocRef.current = curDoc;
    if (undoingRef.current) { undoingRef.current = false; return; }
    if (prev === undefined || DOC_KEYS.every(k => prev[k] === curDoc[k])) return;
    // a fresh edit invalidates the redo history
    if (redoStack.current.length) { redoStack.current = []; setRedoCount(0); }
    const now = performance.now();
    if (now - lastSnapRef.current > 130) {
      undoStack.current.push(prev);
      if (undoStack.current.length > 60) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
    }
    lastSnapRef.current = now;
  }, [pieces, rink, drillTitle, drillDesc, drillSteps, drillNotes, drillItems]);

  // auto-save the whole board to localStorage so it survives a refresh / the
  // app being killed. Debounced so a drag's frames coalesce into one write.
  // Skipped during AI play (that mutates pieces transiently, not real edits).
  const saveTimer = useRef(0);
  // when booted from a shared #d= link, skip the first (mount) save so the user's
  // existing autosave survives until they actually edit the linked drill
  const skipFirstSave = useRef(!!linkDrill);
  useEffect(() => {
    if (aiPlay) return;
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems)); }
      catch { /* storage full / disabled — nothing we can do, keep running */ }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems, aiPlay]);

  function applyDoc(d) {
    undoingRef.current = true;
    setPieces(d.pieces); setRink(d.rink); setDrillTitle(d.drillTitle); setDrillDesc(d.drillDesc);
    setDrillSteps(d.drillSteps); setDrillNotes(d.drillNotes); setDrillItems(d.drillItems);
    setSelectedId(null); setMultiSel(null); setPopup(null); setOpenMenu(null);
  }
  function undoLast() {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop();
    redoStack.current.push(curDoc);            // current state → redo
    if (redoStack.current.length > 60) redoStack.current.shift();
    setRedoCount(redoStack.current.length);
    applyDoc(prev);
    setUndoCount(undoStack.current.length);
  }
  function redoLast() {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    undoStack.current.push(curDoc);            // current state → undo
    if (undoStack.current.length > 60) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
    applyDoc(next);
    setRedoCount(redoStack.current.length);
  }
  const updateSeg = (id, i, patch, fork = null) =>
    update(p => {
      if (p.id !== id) return p;
      const edit = arr => { const path = arr.slice(); path[i] = { ...path[i], ...patch }; return path; };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: edit(f.path) })) };
      return { ...p, path: edit(p.path) };
    });

  // Skate direction is sticky: setting a leg carries the change through every
  // following leg that still reads the old direction — and into the branches that
  // continue from those waypoints — stopping wherever the user flipped it back.
  // spreadDir returns a whole rewritten subtree, so the fork case only needs
  // mapForkAt to graft it back onto the spine.
  const setSegDir = (id, i, dir, fork = null) =>
    update(p => {
      if (p.id !== id) return p;
      if (!fork) {
        const r = spreadDir(p.path, p.forks, i, dir);
        return r.changed ? { ...p, path: r.path, forks: r.forks } : p;
      }
      return { ...p, forks: mapForkAt(p.forks, fork, f => {
        const r = spreadDir(f.path, f.forks, i, dir);
        return r.changed ? { ...f, path: r.path, forks: r.forks } : f;
      }) };
    });

  // `arr` lets the pen materializer allocate against its working array inside
  // a setPieces reducer, where `pieces` is stale
  function nextId(kind, arr = pieces) {
    const prefix = kind === "player" ? "P" : kind === "puck" ? "PK" : kind === "net" ? "N"
      : kind === "bumper" ? "B" : kind === "deker" ? "DK" : kind === "passer" ? "PS"
      : kind === "label" ? "L" : kind === "tire" ? "T" : kind === "stick" ? "ST" : kind === "light" ? "LT" : kind === "mark" ? "MK" : "C";
    let n = 1;
    while (arr.some(p => p.id === prefix + n)) n++;
    return prefix + n;
  }

  function makePiece(kind, pt, arr = pieces) {
    const id = nextId(kind, arr);
    const colorIdx = arr.filter(p => p.kind === "player").length % COLORS.length;
    return {
      id, kind, x: pt.x, y: pt.y, speed: kind === "player" ? defaultSpeed : 1, hand: "R", sym: "", carrier: null,
      facing: kind === "net" && pt.x >= 100 ? 180 : 0, transfers: [], pickup: null, net: null, holdLine: false, goalie: false, defense: false,
      color: defaultColor(kind, COLORS[colorIdx]),
      label: kind === "player" ? id : "", text: kind === "label" ? "Label" : "", size: 1, path: [],
    };
  }

  // a shot authored on a netless board conjures its target: an empty net in
  // the shooter's nearest crease (drill loads get the same via parseDrill).
  // ensureShotNet returns the same array when nothing's needed, so this is
  // a free no-op whenever a net or passer is already on the ice.
  const ensureNet = () => {
    if (!pieces.some(q => q.kind === "net" || q.kind === "passer")) flash("Added a net to shoot at");
    setPieces(ps => ensureShotNet(ps));
  };

  // append a new waypoint after the route's end, continuing in its heading, and
  // open the new point so it can be dragged/edited right away
  function addSegment(id, type, fork = null) {
    const piece = pieces.find(q => q.id === id);
    if (!piece) return;
    const newIdx = routeSegs(piece, fork).length;
    update(p => {
      if (p.id !== id) return p;
      const rp = routePiece(p, fork);
      const n = rp.path.length;
      const prev = n ? segEnd(rp, n - 1) : { x: rp.x, y: rp.y };
      const before = n >= 2 ? segEnd(rp, n - 2) : { x: rp.x, y: rp.y };
      let dx = prev.x - before.x, dy = prev.y - before.y;
      const m = Math.hypot(dx, dy);
      if (m < 0.5) { dx = 22; dy = 0; } else { dx = (dx / m) * 22; dy = (dy / m) * 22; }
      // a new leg keeps skating the way the one before it did (direction is sticky)
      const seg = { ...convertSeg({ type, x: clampX(prev.x + dx), y: clampY(prev.y + dy) }, prev),
        dir: dirAtWaypoint(rp.path, n - 1) };
      // extending curve → curve: make the shared waypoint a smooth join so the new
      // leg continues the heading instead of kinking off with wild split handles
      const build = arr => {
        let path = [...arr, seg];
        const j = n - 1;   // the waypoint the new leg grows from (the old route end)
        if (j >= 0 && path[j].endStop) path[j] = { ...path[j], endStop: undefined };   // no longer the end
        if (j >= 0 && (type === "C" || type === "Q") && (path[j].type === "C" || path[j].type === "Q"))
          path = alignJoint(path, j, "smooth", { x: rp.x, y: rp.y });
        return path;
      };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: build(f.path) })) };
      return { ...p, path: build(p.path) };
    });
    setSelectedId(id);
    setPopup({ type: "point", id, seg: newIdx, ...(fork ? { fork } : {}) });
  }
  // change a waypoint's point type (corner / smooth / sym), re-flowing its handles
  function setJoint(id, i, join, fork = null) {
    update(p => {
      if (p.id !== id) return p;
      const org = fork ? forkOriginPoint(p, fork) : { x: p.x, y: p.y };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: alignJoint(f.path, i, join, org) })) };
      return { ...p, path: alignJoint(p.path, i, join, org) };
    });
  }
  function changeSegType(id, i, type, fork = null) {
    update(p => {
      if (p.id !== id) return p;
      const rp = routePiece(p, fork);
      const org = fork ? forkOriginPoint(p, fork) : { x: p.x, y: p.y };
      const conv = arr => {
        let path = arr.slice();
        path[i] = convertSeg({ ...path[i], type }, segEnd(rp, i - 1));
        // re-flow the joins at the leg's two end waypoints: curve meeting curve
        // links onto a shared tangent so the new shape blends into its neighbours
        // (instead of kinking off the fresh default handles); a straight side
        // breaks the pair, so any stale join flag comes off
        for (const w of [i - 1, i]) {
          const s = path[w], nx = path[w + 1];
          if (!s || !nx) continue;
          if (s.type !== "L" && nx.type !== "L") path = alignJoint(path, w, s.join || "smooth", org);
          else if (s.join) { const c = { ...s }; delete c.join; path[w] = c; }
        }
        return path;
      };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: conv(f.path) })) };
      return { ...p, path: conv(p.path) };
    });
  }
  function deleteSeg(id, i, fork = null) {
    if (fork) {
      setPieces(ps => shiftActionWaypoints(ps, id, i + 1, -1, fork).map(p => p.id === id
        ? { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: f.path.filter((_, j) => j !== i) })) } : p));
      setPopup(null);
      return;
    }
    stepsOnDelete(id, i);
    setPieces(ps => {
      // removing waypoint i pulls this player's later waypoints down by one
      const shifted = shiftActionWaypoints(ps, id, i + 1, -1);
      return shifted.map(p => (p.id === id ? { ...p, path: p.path.filter((_, j) => j !== i) } : p));
    });
    setPopup(null);
  }

  /* ----- puck handoffs ----- */
  function puckChain(pk) {
    const head = pk.carrier || (pk.pickup && pk.pickup.to) || null;
    return [head, ...(pk.transfers || []).map(t => t.to)].filter(Boolean);
  }
  // When a player's path gains/loses a waypoint, re-pin every puck-action index
  // that points at THAT player's waypoints so the action follows its physical
  // waypoint (instead of sliding onto an inserted point or duplicating). `bump`
  // shifts any index >= fromIdx by delta. Actions are: the head's pickup, each
  // transfer's release (by its carrier) and reception (recvAt), and the terminal.
  function shiftActionWaypoints(list, playerId, fromIdx, delta, ref = "") {
    const rf = ref || "", refEq = a => (a || "") === rf;      // only re-pin actions on the SAME route (base or a specific branch)
    const bump = v => (v != null && v >= fromIdx ? v + delta : v);
    return list.map(pk => {
      if (pk.kind !== "puck") return pk;
      const chain = puckChain(pk);
      let np = pk;
      if (pk.pickup && pk.pickup.to === playerId && refEq(pk.pickup.atRef) && bump(pk.pickup.at) !== pk.pickup.at)
        np = { ...np, pickup: { ...pk.pickup, at: bump(pk.pickup.at) } };
      if ((pk.transfers || []).length) {
        let touched = false;
        const ts = pk.transfers.map((t, s) => {
          let nt = t;
          const actor = t.by || releaserOf(pk, s);              // who releases at t.at (lineage-aware)
          if (actor === playerId && refEq(t.atRef) && bump(t.at) !== t.at) { nt = { ...nt, at: bump(t.at) }; touched = true; }
          if (t.to === playerId && t.recvAt != null && refEq(t.recvRef) && bump(t.recvAt) !== t.recvAt) { nt = { ...nt, recvAt: bump(t.recvAt) }; touched = true; }
          return nt;
        });
        if (touched) np = { ...np, transfers: ts };
      }
      // shift each terminal this player performs (its own actor + lineage) past the insert
      const bumpT = t => {
        const actor = t.by || chain[chain.length - 1];
        return (actor === playerId && refEq(t.ref || "") && bump(t.at) !== t.at) ? { ...t, at: bump(t.at) } : t;
      };
      if ((pk.terminals || []).some(t => bumpT(t) !== t)) np = { ...np, terminals: pk.terminals.map(bumpT) };
      return np;
    });
  }
  // Which puck does player p actually hold at waypoint i? A player can be in
  // several puck chains at once (shoot one, then pick up another). Resolve the
  // one whose possession window [gained, released] contains i, preferring the
  // possession that started latest — so acting on p at a spot targets the puck
  // in their hands there, not just the first chain that mentions them.
  function heldPuckAt(p, i) {
    const pucks = pieces.filter(q => q.kind === "puck" && puckChain(q).includes(p.id));
    let best = null, bestStart = -Infinity;
    for (const pk of pucks) {
      const chain = puckChain(pk);
      const ts = pk.transfers || [];
      for (let s = 0; s < chain.length; s++) {
        if (chain[s] !== p.id) continue;
        // when p gains it at stage s
        const inAt = s === 0 ? (pk.pickup ? pk.pickup.at : -1)
          : (ts[s - 1].recvAt != null ? ts[s - 1].recvAt : ts[s - 1].at);
        // when p releases it (a pass/shot out, else the terminal, else never)
        let outAt = Infinity;
        if (s < ts.length) outAt = ts[s].at;
        else {
          // released at the terminal this player performs — BASE-ref only: a branch
          // terminal's `at` is branch-LOCAL and must not close the base-route window
          // (the branch's own window is handled by branchCarrySegs/stepsAt)
          const mine = (pk.terminals || []).find(t => !t.ref && (t.by || chain[chain.length - 1]) === p.id);
          if (mine) outAt = mine.at;
        }
        if (i >= inAt && i <= outAt && inAt >= bestStart) { bestStart = inAt; best = pk; }
      }
    }
    return best;
  }
  const nameOf = id => { const q = pieces.find(x => x.id === id); return (q && q.label) || id; };
  // which of player p's route segments are skated WITH the puck (→ wiggle line).
  // A carrier holds it from where they get it (reception waypoint, or the start
  // if they're the head) to where they release it (their pass/shot waypoint).
  // BASE-route carry: p wiggles from where it gains the puck ON THE BASE lineage (head
  // from the start, a pickup, or a base reception step) to where it releases on the base
  // (a base pass/terminal) — else it carries the whole base to its branch point. Uses the
  // stepsAt roles (base ref) so a release on a SIBLING branch doesn't cut it short.
  function carrySegs(p) {
    const set = new Set();
    const N = p.path ? p.path.length : 0;
    if (!N) return set;
    for (const pk of pieces) {
      if (pk.kind !== "puck" || !puckChain(pk).includes(p.id)) continue;
      let R = null;                                          // start of the current holding stint
      if (pk.carrier === p.id) R = -1;                       // head carries from the start
      else if (pk.pickup && pk.pickup.to === p.id && isAncestorRef(pk.pickup.atRef, "")) R = Math.max(-1, pk.pickup.at);
      // walk the base waypoints; each gain→release stint wiggles, the leg between a
      // give-and-go pass and its return stays straight, and holding to the end (no base
      // release — e.g. p passes on a branch instead) wiggles the whole way there.
      for (let i = -1; i < N; i++) {
        const st = stepsAt(p, i, null);
        if (R == null && st.some(s => s.role === "receive" || s.role === "collect" || s.role === "pickup")) R = i;
        if (R != null && st.some(s => s.role === "release" || s.role === "terminal")) {
          for (let k = Math.max(0, R + 1); k <= i; k++) set.add(k);
          R = null;                                          // released → next stint starts at its own reception
        }
      }
      if (R != null) for (let k = Math.max(0, R + 1); k < N; k++) set.add(k);   // still holding at the end
    }
    return set;
  }
  // which segments of a BRANCH route (`ref`) are skated with the puck (→ wiggle). The
  // player carries it from the branch start (if holding it entering the branch) or a
  // mid-branch reception, until they release it (a pass/terminal on this branch).
  function branchCarrySegs(p, ref, segs) {
    const set = new Set();
    if (!(segs || []).length) return set;
    // condition-aware "holds entering this branch": a delivery whose conditions can't
    // co-occur with taking the branch (e.g. the red-run pass vs a when=<player>! green
    // pickup route) doesn't wiggle the branch start — possession starts at the catch
    const holdsIn = mayHoldEntering(posLedger, pieces, p.id, ref);
    let R = holdsIn ? -1 : null, L = segs.length - 1;
    for (let i = 0; i < segs.length; i++) {
      const st = stepsAt(p, i, ref);
      if (R == null && st.some(s => s.role === "receive" || s.role === "collect" || s.role === "pickup")) R = i;
      if (st.some(s => s.role === "release" || s.role === "terminal")) { L = i; break; }
    }
    if (R == null) return set;
    for (let i = R + 1; i <= L; i++) set.add(i);
    return set;
  }
  const makeLoose = pkId => updateById(pkId, { ...looseFields });
  // remove one terminal (matched by kind + point + ref + actor) — so deleting a shot on
  // one branch keeps a chip on another; passing no `term` clears them all
  const clearTerminal = (pkId, term) => {
    const pk = pieces.find(q => q.id === pkId); if (!pk) return;
    const kept = term
      ? (pk.terminals || []).filter(t => !(t.kind === term.kind && t.at === term.at && (t.ref || "") === (term.ref || "") && (t.by || "") === (term.by || "")))
      : [];
    updateById(pkId, { terminals: kept.length ? kept : undefined });
  };
  // the ordered, human-readable list of actions in a puck's chain. Each carries a
  // `del` that removes it — a transfer drops itself + everything downstream (the
  // chain is sequential), the head clears the whole chain, a terminal clears it.
  function chainEvents(pk) {
    const chain = puckChain(pk), ts = pk.transfers || [], evs = [];
    // `actor` is the player id performing the action; `desc` is the full-chain
    // wording, `self` the wording for that actor's own per-player list
    if (pk.pickup) evs.push({ actor: pk.pickup.to, desc: `${nameOf(pk.pickup.to)} collects ${pk.id}`, self: `Collect ${pk.id}`, del: () => makeLoose(pk.id) });
    else if (pk.carrier) evs.push({ actor: pk.carrier, desc: `${nameOf(pk.carrier)} carries ${pk.id}`, self: `Start with ${pk.id}`, del: () => makeLoose(pk.id) });
    ts.forEach((t, s) => {
      const actor = chain[s] || pk.carrier, to = nameOf(t.to);
      const verb = t.via ? `gives to ${nameOf(t.via)} and takes the return`
        : t.kind === "pass" ? `passes to ${to}`
        : t.kind === "shot" ? `shoots — ${to} takes the rebound`
        : t.kind === "rim" ? `rims to ${to}`
        : t.kind === "chip" ? `chips to ${to}` : `→ ${to}`;
      const self = t.via ? `Give-and-go off ${nameOf(t.via)}`
        : t.kind === "pass" ? `Pass to ${to}`
        : t.kind === "shot" ? `Shoot (rebound to ${to})`
        : t.kind === "rim" ? `Rim to ${to}` : t.kind === "chip" ? `Chip to ${to}` : `→ ${to}`;
      evs.push({ actor, desc: `${nameOf(actor)} ${verb}`, self, del: () => setTransfer(pk.id, s, null) });
    });
    // one row per terminal — each independent, attributed to its own actor (`by`, else
    // the chain member whose branch owns the ref / the natural final holder)
    (pk.terminals || []).forEach(t => {
      const actor = t.by || terminalActor(pk, pieces, t.ref || "");
      const net = t.net || "nearest net";
      const desc = t.kind === "shot" ? `shoots at ${net}` : t.kind === "rim" ? "hard rims" : "chips";
      const self = t.kind === "shot" ? `Shoot at ${net}` : t.kind === "rim" ? "Hard rim" : "Chip";
      evs.push({ actor, desc: `${nameOf(actor)} ${desc}`, self, del: () => clearTerminal(pk.id, t) });
    });
    return evs;
  }
  // small numbered event list used by both the puck popup (full chain, `desc`)
  // and each player popup (only that player's own actions, `self`)
  function chainList(pk, forPlayer) {
    let evs = chainEvents(pk);
    if (forPlayer) evs = evs.filter(ev => ev.actor === forPlayer);
    if (!evs.length) return null;
    return (
      <div key={`chain-${pk.id}`} style={{ margin: "4px 0", padding: "6px 8px", background: "rgba(120,140,160,0.1)", borderRadius: 8 }}>
        <div className="hd-mh" style={{ marginBottom: 4 }}>
          {forPlayer ? `${nameOf(forPlayer)} — actions on ${pk.id}` : `${pk.id} — chain of events`}
        </div>
        {evs.map((ev, n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
            <span style={{ minWidth: 16, textAlign: "right", fontWeight: 700, color: "var(--db-text-muted)", fontVariantNumeric: "tabular-nums" }}>{n + 1}</span>
            <span style={{ flex: 1, fontSize: 12.5 }}>{forPlayer ? ev.self : ev.desc}</span>
            <button className="hd-mini danger" style={{ padding: "2px 7px", minHeight: 0 }}
              title="Delete this action (and any that follow it)" onClick={ev.del}>✕</button>
          </div>
        ))}
      </div>
    );
  }
  // the point a pass/handoff is RELEASED from — the actor's position at its release
  // waypoint, on the branch it was authored on (so a branch release lands on the branch).
  function releasePos(actorId, t) {
    const a = pieces.find(q => q.id === actorId);
    if (!a) return null;
    const rp = t.atRef ? routePiece(a, t.atRef) : a;
    const segs = rp.path || [];
    if (t.at == null || t.at < 0 || !segs.length) return { x: rp.x, y: rp.y };
    return segEnd(rp, Math.min(t.at, segs.length - 1));
  }
  // the waypoint of `recP` closest to `pt` (-1 = its start). Where a no-recvAt (led) pass
  // is caught: the receiver takes it nearest the release point — so an early receiver who
  // then carries catches it near their START, and one skating to meet it, near their END.
  function closestWp(recP, pt) {
    if (!recP || !pt) return -1;
    let best = -1, bd = Math.hypot(recP.x - pt.x, recP.y - pt.y);
    (recP.path || []).forEach((s, i) => { const d = Math.hypot(s.x - pt.x, s.y - pt.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  // the ordered actions happening at ONE spot (player p at waypoint i; i=-1 = the
  // start / standing spot) as numbered steps. Anything the chain can't actually
  // pull off — a rebound that must pass through a net, or a step downstream of one
  // — is flagged "won't complete" so the user sees it plainly.
  function stepsAt(p, i, fork = null) {
    const rf = fork || "";                                   // the route this spot is on ("" = base); actions carry a matching ref
    const refEq = a => (a || "") === rf;
    const shapes = solidShapes(pieces);
    const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
    const steps = [];
    for (const pk of pieces) {
      if (pk.kind !== "puck") continue;
      const chain = puckChain(pk);
      if (!chain.includes(p.id)) continue;
      const ts = pk.transfers || [];
      // which shot transfer (if any) is blocked — a rebound whose carom to the
      // collector crosses a net can't get there; everything after it is dead too
      let blockStage = Infinity;
      ts.forEach((t, s) => {
        if (t.kind !== "shot") return;
        const carrier = pieces.find(q => q.id === (t.by || releaserOf(pk, s))), rec = pieces.find(q => q.id === t.to);
        if (!carrier || !rec) return;
        const launch = t.at < 0 || !carrier.path.length ? { x: carrier.x, y: carrier.y } : segEnd(carrier, Math.min(t.at, carrier.path.length - 1));
        const shotNetId = t.net != null ? t.net : null;   // this rebound's own target
        const net = shotNetId ? (nets.find(x => x.id === shotNetId) || null) : (nets.length ? nets.reduce((a, b) => Math.hypot(b.x - launch.x, b.y - launch.y) < Math.hypot(a.x - launch.x, a.y - launch.y) ? b : a) : null);
        const nPt = net ? { x: net.x, y: net.y } : (launch.x < 100 ? { x: 11, y: 42.5 } : { x: 189, y: 42.5 });
        const anchor = t.recvAt != null && rec.path.length ? segEnd(rec, Math.min(t.recvAt, rec.path.length - 1)) : { x: rec.x, y: rec.y };
        if (segCrossesNet(nPt, anchor, shapes)) blockStage = Math.min(blockStage, s);
      });
      // an impossible step, PROVED by the possession ledger's per-action viability:
      // "no-release" = the actor never has the puck under any satisfiable conditions;
      // "no-catch" = the release happens but the catch point's route can never occur
      // on the same run (a pass dies; a chip/rim lands loose instead). The old
      // possibility holds-walk stays as a fallback for anything the proofs don't cover.
      const badStages = new Set();
      { const held = new Set([chain[0]]);
        ts.forEach((t, s) => { const rel = t.by || releaserOf(pk, s); if (!held.has(rel)) badStages.add(s); held.add(t.to); }); }
      const deadFrom = blockStage;
      const viaOf = s => (posLedger.viability || {})[`t:${pk.id}:${s}`];
      const flag = s => {
        const v = viaOf(s);
        if (v === "no-release") return `${nameOf(ts[s].by || releaserOf(pk, s))} never has the puck here — won't happen`;
        if (v === "no-catch") return ts[s].kind === "pass"
          ? "never completes — the catch point's route can't happen on the same run as this pass"
          : "the collector's route can't happen on the same run — lands loose instead";
        if (v === "self-pass") return "a pass needs another target — chip or rim to play it to yourself, or bounce off a passer (give-and-go)";
        return badStages.has(s) ? `${nameOf(ts[s].by || releaserOf(pk, s))} isn't holding the puck here — won't happen`
          : s === blockStage ? "rebound can't reach the collector — a net is in the way"
          : s > deadFrom ? "won't happen — an earlier step is blocked" : null;
      };
      ts.forEach((t, s) => {
        const actor = t.by || releaserOf(pk, s);
        // the receiver shows their side of the action too — at the designated receive
        // waypoint, else the waypoint nearest the RELEASE point (an early carrier catches
        // it near their start; one skating to meet it, near their end), else standing spot.
        const recP = pieces.find(q => q.id === t.to);
        const rSpot = t.recvAt != null ? t.recvAt : closestWp(recP, releasePos(actor, t));
        const self = t.to === p.id && actor === p.id;   // chip/rim and go retrieve it, or a give-and-go via a passer
        if (t.to === p.id && (actor !== p.id || (self && (t.kind !== "pass" || t.via))) && rSpot === i && refEq(t.recvRef)) {
          const rtext = t.via ? `Take the return from ${nameOf(t.via)}`
            : self ? (t.kind === "rim" ? "Collect your own rim" : "Collect your own chip")
            : t.kind === "shot" ? `Collect rebound from ${nameOf(actor)}`
            : t.kind === "rim" ? `Collect ${nameOf(actor)}'s rim`
            : t.kind === "chip" ? `Collect ${nameOf(actor)}'s chip`
            : `Receive pass from ${nameOf(actor)}`;
          steps.push({ ord: s + 0.5, text: rtext, warn: flag(s), del: () => setTransfer(pk.id, s, null),
            role: t.kind === "pass" ? "receive" : "collect", kind: t.kind, pk, stage: s, src: actor, via: t.via });
        }
        if (actor === p.id && t.at === i && refEq(t.atRef)) {
          const to = nameOf(t.to);
          const txt = t.via ? `Give-and-go off ${nameOf(t.via)}`
            : self && t.kind === "chip" ? "Chip and skate to retrieve" : self && t.kind === "rim" ? "Rim and skate to retrieve"
            : t.kind === "pass" ? `Pass ${pk.id} to ${to}` : t.kind === "shot" ? `Shoot ${pk.id} — rebound to ${to}` : t.kind === "rim" ? `Hard rim to ${to}` : `Chip to ${to}`;
          steps.push({ ord: s + 1, text: txt, warn: flag(s), del: () => setTransfer(pk.id, s, null),
            role: "release", kind: t.kind, pk, stage: s });
        }
      });
      // each terminal belongs to ONE player: its explicit `by`, else its inferred owner
      // (terminalActor). Using terminalActor (not "does p hold here") disambiguates when
      // several conditional receivers could each be the final holder on their own run —
      // a base-ref shot then shows for exactly one of them, not all.
      const held = holdsOnLineage(pk, p.id, fork);
      (pk.terminals || []).forEach((t, ti) => {
        if (t.at !== i || !refEq(t.ref || "")) return;
        const actor = t.by || terminalActor(pk, pieces, t.ref || "");
        if (actor !== p.id) return;
        const tv = (posLedger.viability || {})[`x:${pk.id}:${ti}`];
        const wt = tv === "no-fire" ? `${nameOf(actor)} never has the puck here — won't happen`
          : (t.by && !held) ? `${nameOf(t.by)} isn't holding the puck here — won't happen`
          : deadFrom < Infinity ? "won't happen — an earlier step is blocked" : null;
        const txt = t.kind === "shot" ? `Shoot ${pk.id} at ${t.net || "nearest net"}` : t.kind === "rim" ? `Hard rim ${pk.id}` : `Chip ${pk.id}`;
        steps.push({ ord: 900, text: txt, warn: wt, del: () => clearTerminal(pk.id, t), role: "terminal", kind: t.kind, pk, term: t });
      });
      // waypoint 0 = the start (i=-1); a stationary collector shows there too. A
      // routed collect at path index k shows only at that waypoint (i=k) — no
      // more duplicating a waypoint-0 collect onto the standing spot.
      const pickI = !p.path.length || !pk.pickup || pk.pickup.at < 0 ? -1 : pk.pickup.at;
      if (pk.pickup && pk.pickup.to === p.id && pickI === i && refEq(pk.pickup.atRef))
        steps.push({ ord: -1, text: pk.pickup.nearest ? "Collect nearest puck" : `Collect ${pk.id}`, warn: null, del: () => updateById(pk.id, { pickup: null }), role: "pickup", kind: null, pk });
    }
    // order by puck first (each puck's collect→…→shoot stays together and
    // interleaves with the next puck's), then by chain order within a puck — so
    // collect→shoot→collect→shoot reads in sequence instead of all the collects
    // bunching ahead of all the shots
    steps.sort((a, b) => (pieces.indexOf(a.pk) - pieces.indexOf(b.pk)) || (a.ord - b.ord));
    return steps;
  }
  // replace (tr) or remove (null) ONE transfer in place. Sibling-branch actions are
  // independent parallel runs, so editing one must NOT truncate the ones authored
  // after it, and terminals stay — an entry orphaned by the edit shows its
  // "won't happen" flag instead of silently vanishing.
  function setTransfer(pkId, stage, tr) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).slice();
      if (tr) ts[stage] = tr; else ts.splice(stage, 1);
      return chained({ ...q, transfers: ts });
    });
  }
  // Actions are authored per waypoint but stored as an ORDERED chain, so a hop added
  // for an earlier moment lands at the end of the array and the chain stops resolving
  // (downstream releases read as "isn't holding the puck", and a shot loses its final
  // holder). Re-derive a working order after any transfer edit — a no-op when the
  // stored order already resolves, and when none does.
  const chained = q => { const ts = orderTransfers(q); return ts === q.transfers ? q : { ...q, transfers: ts }; };
  // append an action for a player who doesn't actually hold the puck here — it's
  // recorded (with its intended `by` actor) and flagged "won't complete", not
  // silently dropped, so the user sees their intent
  const appendTransfer = (pkId, tr) =>
    update(q => (q.id === pkId ? chained({ ...q, transfers: [...(q.transfers || []), tr] }) : q));
  // default travel distance (feet) for a fresh terminal release
  const REL_DEFAULT = { rimAt: 65, chipAt: 26 };
  // does terminal `t` match matcher `m` (kind + point + lineage + actor)? — used to
  // locate the one terminal an edit/handle refers to inside the uniform terminals[]
  const sameTerm = (t, m) => t.kind === m.kind && t.at === m.at && (t.ref || "") === (m.ref || "") && (t.by || "") === (m.by || "");
  // a puck with CONDITIONAL structure — branch-tagged transfers, a branch-ref terminal,
  // or several independent terminals. Its arrows draw from the plan geometry
  // (renderBranchGhostArrows), NOT the animation plan (puckPathNodes), so the firing
  // action and its sibling ghosts read identically apart from opacity.
  const condPuck = pk => (pk.transfers || []).some(t => t.atRef) || (pk.terminals || []).some(t => t.ref) || (pk.terminals || []).length > 1;
  // aim override for a chip or a hard rim (deg, or null to follow facing / auto).
  // target = { term } for a terminal (matcher), or { stage } for a chip transfer.
  function setAim(pkId, target, deg) {
    update(q => {
      if (q.id !== pkId) return q;
      if (target.term) return { ...q, terminals: (q.terminals || []).map(t => sameTerm(t, target.term) ? { ...t, aim: deg } : t) };
      const ts = (q.transfers || []).map((t, k) => (k === target.stage ? { ...t, aim: deg == null ? undefined : deg } : t));
      return { ...q, transfers: ts };
    });
  }
  // a terminal release handle sets BOTH direction (deg) and travel distance (ft) on
  // the matched terminal
  function setRelease(pkId, term, deg, dist) {
    update(q => (q.id === pkId ? { ...q, terminals: (q.terminals || []).map(t => sameTerm(t, term) ? { ...t, aim: deg, dist } : t) } : q));
  }

  // Unified "Collect puck": the player grabs the nearest available loose puck at
  // this spot (waypoint index `at`, or -1 = their standing position). A loose
  // puck is a released chip / hard rim / shot, or a puck placed loose. Wires it
  // with the existing chain (release → collector) / pickup machinery.
  function collectPuckAt(playerId, at, targetId, fork = null) {
    const player = pieces.find(q => q.id === playerId);
    if (!player) return;
    // a standing collect (at = -1) pins to waypoint 0 — the player's start — so
    // they gather the puck before moving and carry it (the timing engine grabs it
    // at t0; a "nearest" collect placed at a route waypoint still auto-resolves)
    const cAt = at;
    const spot = cAt < 0 || !player.path.length ? { x: player.x, y: player.y }
      : segEnd(player, Math.min(cAt, player.path.length - 1));
    const relPoint = pk => {
      const ch = puckChain(pk);
      const who = pieces.find(x => x.id === ch[ch.length - 1]);
      const term = (pk.terminals || [])[0];
      const a = term ? term.at : null;
      if (!who) return { x: pk.x, y: pk.y };
      return (a == null || a < 0 || !who.path.length) ? { x: who.x, y: who.y } : segEnd(who, Math.min(a, who.path.length - 1));
    };
    const landing = pk => {
      const rp = relPoint(pk);
      const term = (pk.terminals || [])[0];
      try {
        if (term && term.kind === "chip") { const ang = term.aim != null ? (term.aim * Math.PI) / 180 : 0; const path = boards.slide(rp.x, rp.y, Math.cos(ang), Math.sin(ang), term.dist || REL_DEFAULT.chipAt); return path[path.length - 1] || rp; }
        if (term && term.kind === "rim") { const path = boards.rimAround(rp, term.dist || REL_DEFAULT.rimAt, term.aim); return path[path.length - 1] || rp; }
      } catch { /* fall through */ }
      return rp;
    };
    const cands = pieces.filter(q => {
      if (q.kind !== "puck") return false;
      const released = (q.terminals || []).length > 0;
      const loose = !q.carrier && !q.pickup && !(q.transfers || []).length && !released;
      if (!(released || loose)) return false;
      const ch = puckChain(q);
      // you can chip/rim your own puck and skate to retrieve it — allow a self
      // collect when the collector has a route to go get it; forbid only the
      // nonsensical stationary "collect the puck I'm still holding" case
      return !(released && ch[ch.length - 1] === playerId && !player.path.length);
    });
    if (!cands.length) { setToast("No loose puck to collect"); setTimeout(() => setToast(""), 1500); return; }
    // an explicit puck id designates that puck (if collectable), else nearest wins
    const pick = targetId && cands.find(q => q.id === targetId);
    const near = q => { const L = landing(q); return Math.hypot(L.x - spot.x, L.y - spot.y); };
    const target = pick || cands.reduce((b, q) => (near(q) < near(b) ? q : b));
    // convert the collected release into a handoff transfer. Prefer the terminal on
    // the collect's own lineage (a puck can end differently per branch); the handoff
    // keeps the terminal's branch ref so the release stays on its route.
    const term0 = (target.terminals || []).find(t => isAncestorRef(t.ref || "", fork || "") || isAncestorRef(fork || "", t.ref || ""))
      || (target.terminals || [])[0];
    if (term0) {
      const kind = term0.kind;
      const aim = (kind === "rim" || kind === "chip") ? term0.aim : null;
      setTransfer(target.id, (target.transfers || []).length,
        { at: term0.at, to: playerId, recvAt: cAt < 0 ? null : cAt, kind, ...(term0.ref ? { atRef: term0.ref } : {}),
          ...(term0.by ? { by: term0.by } : {}),   // keep the release pinned to its actor — inference after sibling receivers is ambiguous
          ...(aim != null ? { aim } : {}), ...(fork ? { recvRef: fork } : {}) });
      update(q => {
        if (q.id !== target.id) return q;
        const kept = (q.terminals || []).filter(x => !sameTerm(x, term0));
        return { ...q, terminals: kept.length ? kept : undefined };
      });
    } else {
      // no explicit id → a live "nearest" collect: re-resolves to the closest
      // loose puck at play time (see resolveNearest). A chosen id stays fixed.
      updateById(target.id, { pickup: { to: playerId, at: cAt, ...(targetId ? {} : { nearest: true }), ...(fork ? { atRef: fork } : {}) } });
    }
    // steps are ordered by puck array position, so move the just-collected puck
    // to the end — its collect (and any release) then sits at the END of the
    // action chain, in build order, instead of bunching behind an earlier action
    setPieces(ps => { const k = ps.findIndex(q => q.id === target.id); if (k < 0) return ps; const c = ps.slice(); const [t] = c.splice(k, 1); c.push(t); return c; });
    setSelectedId(playerId);
  }
  // manual "Receive Pass": the chosen source player passes to `receiverId` at
  // waypoint `at`. Appends the pass onto a puck the source holds; if they hold
  // none, hand them a fresh one so the feed still happens.
  function doReceiveFrom(receiverId, at, srcId, fork = null) {
    const src = pieces.find(q => q.id === srcId && q.kind === "player");
    if (!src) return;
    const passAt = src.path.length ? src.path.length - 1 : -1;   // source releases from their route end / spot
    const pk = heldPuckAt(src, passAt) || pieces.find(q => q.kind === "puck" && puckChain(q).includes(src.id));
    const tr = { at: passAt, to: receiverId, recvAt: at < 0 ? null : at, kind: "pass", by: src.id, ...(fork ? { recvRef: fork } : {}) };
    if (pk) appendTransfer(pk.id, tr);
    else {
      const np = makePiece("puck", { x: src.x, y: src.y });
      np.carrier = src.id;
      np.transfers = [{ ...tr, by: undefined }];
      setPieces(ps => [...ps, np]);
    }
    setSelectedId(receiverId);
  }

  function addPointAt(id, segIdx, pt, fork = null) {
    if (!fork) stepsOnInsert(id, segIdx);
    setPieces(ps => {
      // inserting a waypoint at segIdx pushes this route's later waypoints up by one
      // — shift their actions first so each stays on its own waypoint (on the base
      // route, or on the specific branch being edited)
      const list = shiftActionWaypoints(ps, id, segIdx, +1, fork || "");
      return list.map(p => {
        if (p.id !== id) return p;
        const rp = routePiece(p, fork);
        const s = rp.path[segIdx];
        if (!s) return p;
        const prev = segEnd(rp, segIdx - 1);
        const parts = splitSeg(prev, s, nearestT(prev, s, pt));
        const next = [...rp.path.slice(0, segIdx), ...parts, ...rp.path.slice(segIdx + 1)];
        if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: next })) };
        return { ...p, path: next };
      });
    });
    setSelectedId(id);
    setPopup({ type: "point", id, seg: segIdx, ...(fork ? { fork } : {}) });
  }

  /* ----- drawing ----- */
  function beginDraw(e, existingId) {
    const pt = svgPt(e);
    // drawing a light-reaction fork: target the chosen player, no new piece
    if (forkTarget.current) {
      drawTarget.current = forkTarget.current.id;
      drawRaw.current = [pt];
      setDrawPreview([pt]);
      drag.current = { kind: "drawing", pid: e.pointerId, touch: e.pointerType === "touch" };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    let id = existingId || selectedId;
    const t = id && pieces.find(q => q.id === id);
    if (t && t.kind !== "player" && t.kind !== "puck") {
      if (existingId) return;                 // cones/nets can't be routed
      id = null;                              // one was just selected — draw a fresh player
    }
    if (!id) {
      const np = makePiece("player", pt);
      setPieces(ps => [...ps, np]);
      id = np.id;
      setSelectedId(id);
    }
    drawTarget.current = id;
    drawRaw.current = [pt];
    setDrawPreview([pt]);
    drag.current = { kind: "drawing", pid: e.pointerId, touch: e.pointerType === "touch" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // start a freehand marker stroke (an ink annotation, not a route)
  function beginMark(e) {
    const pt = svgPt(e);
    drawRaw.current = [pt];
    setDrawPreview([pt]);
    markerDraw.current = true;
    drag.current = { kind: "drawing", marker: true, pid: e.pointerId, touch: e.pointerType === "touch" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // start a smart-pen stroke: captured exactly like marker ink, but strokes
  // buffer until a settle pause, then the burst is recognized into pieces
  function beginPen(e) {
    clearTimeout(penTimer.current);   // drawing again keeps the burst open
    setPenPop(null);                          // drawing dismisses any open popover
    if (!penBuf.current.length) penScale.current = ftPerPx();   // per-burst view scale
    const pt = svgPt(e);
    // pressure rides ON the point so it survives thinning and RDP — those keep
    // the original objects, so whatever is left still knows how hard it was
    // pressed. Note ink uses it to vary weight along the stroke.
    if (e.pointerType === "pen" && e.pressure > 0) pt.p = e.pressure;
    drawRaw.current = [pt];
    setDrawPreview([pt]);
    // Apple Pencil reports 0..1 barrel pressure; a finger reports a constant
    // (0 or 1) and a mouse 0.5, so only a real stylus varies the weight
    penDraw.current = { t0: performance.now(), press: [], stylus: e.pointerType === "pen" };
    if (e.pointerType === "pen" && e.pressure > 0) penDraw.current.press.push(e.pressure);
    setPenTip(pt);
    // pid locks the stroke to THIS pointer: a palm landing mid-stroke can't
    // feed it. `touch` (the loupe) is for fingertips only, never a Pencil.
    drag.current = { kind: "drawing", pen: true, pid: e.pointerId, touch: e.pointerType === "touch" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // In draw mode the ice is a canvas: players, routes, handles and ink are not
  // selectable or draggable, so a stroke that starts on one just draws. Flip to
  // Edit on the pen palette to grab things again. Also the single place skin is
  // turned away while an Apple Pencil is in use, whatever it lands on.
  function penPassThrough(e) {
    noteStylus(e);
    if (palmBlocked(e)) { e.stopPropagation(); return true; }
    if (tool !== "pen") return false;
    e.stopPropagation();
    setPopup(null);
    beginPen(e);
    return true;
  }

  function finishDraw() {
    const raw = drawRaw.current;
    drawRaw.current = [];
    setDrawPreview(null);
    setPenTip(null);
    if (penDraw.current) {            // smart pen: buffer, don't leave the tool
      const { t0, press: samples, stylus } = penDraw.current;
      // one weight per stroke from how hard the Pencil was pressed. Marks carry
      // a single width, so a within-stroke taper would mean rebuilding ink as
      // filled outlines — this gives light and heavy strokes without that.
      const press = stylus && samples.length
        ? samples.reduce((a, v) => a + v, 0) / samples.length : null;
      penDraw.current = false;
      if (eraserRef.current) {        // eraser: the stroke rubs out, never draws
        if (raw.length) eraseAlong(raw);
        return;
      }
      if (raw.length) {               // a bare tap is a dot — the puck gesture
        // keep each point's own pressure — rebuilding as bare {x,y} here was
        // silently throwing away what note ink needs to vary its weight
        penBuf.current.push({ t0, t1: performance.now(), press,
          pts: raw.map(q => (q.p != null ? { x: q.x, y: q.y, p: q.p } : { x: q.x, y: q.y })) });
        setPenInk(penBuf.current.map(s => s.pts));
      }
      clearTimeout(penTimer.current);
      if (penBuf.current.length) {
        // a long stroke is a route/shot/shape gesture — snap the burst in
        // right away (any symbols it follows are in the same buffer; players
        // from earlier bursts are already on the board). Short strokes wait
        // out the settle pause so multi-stroke letters and dashes can finish.
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        raw.forEach(q => {
          if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y;
          if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y;
        });
        // "is this a long stroke?" in SCREEN pixels, like the classifier
        const sx = penScale.current.x || 1, sy = penScale.current.y || 1;
        if (Math.hypot((x1 - x0) / sx, (y1 - y0) / sy) >= symbolMaxPx()) commitPen();
        else penTimer.current = setTimeout(commitPen, PEN_SETTLE);
      }
      return;
    }
    // a light-reaction fork: fit a route from the player's branch point through the
    // drawn trail, and store it (replacing any existing fork of the same colour)
    if (forkTarget.current) {
      const { id, color: ref } = forkTarget.current;
      forkTarget.current = null; setForkDrawColor(null); setTool("select");
      if (raw.length < 3) return;
      setPieces(ps => ps.map(p => {
        if (p.id !== id) return p;
        const fit = fitRoute(forkOriginPoint(p, ref), raw);
        if (!fit.length) return p;
        // the branch keeps skating whichever way the player arrived at the split
        const entry = forkEntryDir(p, ref);
        const route = entry === "fwd" ? fit : fit.map(s => ({ ...s, dir: entry }));
        const prev = forkAt(p, ref);   // redraw keeps the action + nested reactions
        const forks = ensureForkAt(p.forks, ref, c => ({ color: c, action: "skate", forks: [], path: [] }));
        return { ...p, forks: mapForkAt(forks, ref, f => ({
          ...f, path: route, action: prev?.action || f.action || "skate",
          ...(prev?.net ? { net: prev.net } : {}), ...(prev?.to ? { to: prev.to } : {}), forks: prev?.forks || f.forks || [],
        })) };
      }));
      return;
    }
    if (markerDraw.current) {                       // freehand ink annotation
      markerDraw.current = false;
      setTool("select");
      if (raw.length < 2) return;
      // thin the freehand trail, then RDP-simplify to a handful of control points
      // so the stroke renders as a smooth curve you can later re-shape by its points
      const trail = raw.map(q => ({ x: q.x, y: q.y }))
        .filter((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.y - a[i - 1].y) > 1.2);
      const pts = trail.length > 3 ? rdp(trail, 1.3) : trail;
      if (pts.length < 2) return;
      const id = nextId("mark");
      // the Marker is the annotation tool by definition — its ink is never
      // something the pen's converter should reinterpret
      setPieces(ps => [...ps, { id, kind: "mark", pts, x: pts[0].x, y: pts[0].y, sketch: true,
        color: markColor, width: markWidth, style: markStyle, path: [] }]);
      return;
    }
    const id = drawTarget.current;
    drawTarget.current = null;
    setTool("select");
    if (!id || raw.length < 3) return;
    /* (route drawing continues below) */
    setPieces(ps => ps.map(p => {
      if (p.id !== id) return p;
      const route = fitRoute({ x: p.x, y: p.y }, raw);
      return route.length ? { ...p, path: route } : p;
    }));
  }

  // Preset shape markers (square / circle / triangle) — placed parametrically
  // instead of freehanded, then moved/scaled/stretched from the mark popup.
  // Straight edges carry dense collinear points so the ink smoothing keeps
  // them straight (same trick as imported zone overlays).
  function shapeMarkPts(shape, cx, cy, w, h) {
    const P = [];
    if (shape === "circle") {
      const n = 24;
      for (let i = 0; i <= n; i++) { const t = (i / n) * 2 * Math.PI; P.push({ x: cx + (Math.cos(t) * w) / 2, y: cy + (Math.sin(t) * h) / 2 }); }
      return P;
    }
    const cs = shape === "triangle"
      ? [{ x: cx, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }]
      : [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      // the vertex itself is a sharp corner (break handle); interior points smooth
      for (let k = 0; k < n; k++) P.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, ...(k === 0 ? { c: true } : {}) });
    }
    P.push({ ...cs[0], c: true });
    return P;
  }
  function addShapeMark(shape) {
    const [mx, my, vw, vh] = VIEWS[rink];
    const pts = shapeMarkPts(shape, mx + vw / 2, my + vh / 2, 20, shape === "triangle" ? 17 : 20);
    const id = nextId("mark");
    setPieces(ps => [...ps, { id, kind: "mark", pts, x: pts[0].x, y: pts[0].y,
      color: markColor, width: markWidth, style: markStyle, path: [] }]);
    setTool("select"); setOpenMenu(null);
    setSelectedId(id);
    setPopup({ type: "piece", id });
  }
  /* ----- smart pen: settle-commit and materialization ----- */

  // classify the settled burst of pen strokes and materialize the ops as real
  // pieces — a single setPieces call, so the whole burst is one undo entry
  // (the 130ms snapshot coalescer sees one document change)
  function commitPen() {
    clearTimeout(penTimer.current);
    const fresh = penBuf.current;
    penBuf.current = [];
    setPenInk([]);
    if (!fresh.length) return;
    const board = piecesRef.current;
    // Sketch: never read, now or later — the ink is the point.
    if (penReadRef.current === "sketch") {
      setPieces(ps => materializePenOps(ps, fresh.map(s => ({ op: "mark", pts: s.pts, press: s.press, sketch: true }))));
      return;
    }
    // Manual mode: strokes just lay down as ink. Nothing is read until you hit
    // Convert, which looks at the whole drawing at once.
    if (penReadRef.current === "manual") {
      setPieces(ps => materializePenOps(ps, fresh.map(s => ({ op: "mark", pts: s.pts, press: s.press }))));
      return;
    }
    // recent pen ink the new strokes touch rejoins the burst: a finger takes
    // its time between an X's two strokes, so the first may already have
    // committed as a mark — the crossing stroke completes it. Ops that consume
    // an old mark delete it; ink that stays ink stays untouched on the board.
    const now = performance.now();
    const pad = Math.max(3, 15 * Math.min(penScale.current.x || 0.2, penScale.current.y || 0.2));
    const bb = pts => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      pts.forEach(q => {
        if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y;
        if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y;
      });
      return { x0, y0, x1, y1 };
    };
    const freshBoxes = fresh.map(s => bb(s.pts));
    const extras = board.filter(p => p.kind === "mark"
      && now - (penMarkAge.current.get(p.id) ?? Infinity) < 30000
      && (() => {
        const b = bb(p.pts);
        return freshBoxes.some(n =>
          b.x0 - pad < n.x1 && n.x0 - pad < b.x1 && b.y0 - pad < n.y1 && n.y0 - pad < b.y1);
      })());
    const strokes = [...extras.map(m => ({ pts: m.pts })), ...fresh];
    const ctx = penCtx(board);
    const ops = classifyPenGroup(strokes, ctx);
    // on-device diagnostic: the last burst's real captured strokes + verdict.
    // Gesture data can't be reproduced from a screenshot — this is how phone
    // strokes get lifted into tests/sketch-recognize.mjs as fixtures, either
    // by the headless harness (window.__pen) or by the user, via the pen
    // popout's "Copy diagnostics" button.
    penLast.current = { strokes, ctx, ops };
    if (typeof window !== "undefined") window.__pen = { strokes, ctx, ops };
    const consumed = new Set();
    const finalOps = ops.filter(o => {
      const fromOld = (o.srcs || []).filter(i => i < extras.length);
      if (o.op === "mark" && fromOld.length) return false;   // still ink — already on the board
      fromOld.forEach(i => consumed.add(extras[i].id));
      return o.op !== "drop";
    });
    setPieces(ps => materializePenOps(ps.filter(p => !consumed.has(p.id)), finalOps));
    const counts = {};
    finalOps.forEach(o => { counts[o.op] = (counts[o.op] || 0) + 1; });
    const parts = Object.entries(counts).filter(([k]) => k !== "mark")
      .map(([k, n]) => `${n} ${n > 1 ? (k === "pass" ? "passes" : k + "s") : k}`);
    flash(parts.length ? `Pen: ${parts.join(", ")}` : "Pen: kept as ink");
  }
  // force-commit buffered pen ink before the board changes under it (tool
  // switch, play, menus, a tap with another tool)
  function flushPen() {
    if (penBuf.current.length) commitPen();
  }
  useEffect(() => { if (tool !== "pen") flushPen(); }, [tool]);
  useEffect(() => { if (openMenu) flushPen(); }, [openMenu]);

  // turn classifyPenGroup ops into pieces. Runs inside a setPieces reducer:
  // pure over `out`, ids allocated against the working array, same-burst refs
  // ({ref:opIdx}) resolved through madeId. The classifier orders ops so every
  // player lands before the route/pass/shot that references them.
  function materializePenOps(ps, ops) {
    const out = ps.slice();
    const madeId = {};                                    // op index → piece id
    const idFor = ref => (ref ? (ref.id != null ? ref.id : madeId[ref.ref]) : null);
    const playerAt = ref => {
      const id = idFor(ref);
      return out.findIndex(q => q.id === id && q.kind === "player");
    };
    // the puck this player currently ends the drill holding (chain tail, not
    // yet spent) — same resolution doReceiveFrom uses, pure over `out`; a
    // holder without one gets a fresh puck conjured on their stick
    const heldOrConjured = pid => {
      const src = out.find(q => q.id === pid);
      let pi = out.findIndex(q => {
        if (q.kind !== "puck" || (q.terminals || []).length) return false;
        const chain = puckChain(q);
        return chain.length && chain[chain.length - 1] === pid;
      });
      if (pi < 0) {
        const np = makePiece("puck", { x: src.x, y: src.y }, out);
        np.carrier = pid;
        out.push(np);
        pi = out.length - 1;
      }
      return pi;
    };
    // Pencil pressure scales the weight around the chosen width: a feather
    // touch lands ~60%, a hard press ~150%. Clamped so ink stays ink.
    const pressW = press => (press == null || !pressRef.current ? penW
      : Math.max(0.25, Math.min(3.5, penW * (0.6 + 1.1 * Math.min(1, press * 1.6)))));
    const inkMark = (pts, press, sketch) => {
      // thin the trail, then RDP to control points — both view-scaled so the
      // stored ink keeps the shape that was actually drawn
      const trail = pts.filter((q, i) => i === 0 || Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) > inkStepFt(sketch));
      const cps = trail.length > 3 ? rdp(trail, inkEpsFt(sketch)) : trail;
      if (cps.length < 2) return;
      // pen fallback ink lands at the pen's thin width, not the marker's;
      // its age makes it reclaimable by a later completing stroke
      const id = nextId("mark", out);
      penMarkAge.current.set(id, performance.now());
      // sketch ink keeps the per-point pressure so the line can thicken and thin
      // along its length the way a pencil does; other ink takes one weight
      const pp = sketch ? cps.map(q => (q.p != null ? Math.round(q.p * 100) / 100 : null)) : null;
      out.push({ id, kind: "mark", pts: cps, x: cps[0].x, y: cps[0].y, ...(sketch ? { sketch: true } : {}),
        ...(pp && pp.some(v => v != null) ? { press: pp } : {}),
        color: markColor, width: pressW(press), style: markStyle, path: [] });
    };
    ops.forEach((o, i) => {
      if (o.op === "player") {
        const np = makePiece("player", { x: o.x, y: o.y }, out);
        np.color = markColor;         // you drew it in this ink; it IS this colour
        // same convention as picking a whiteboard icon: the symbol names the
        // (auto-named) player, so the tag isn't redundantly repeated — and a
        // drawn X stays the clean default glyph
        if (o.sym && o.sym !== "X") np.label = o.sym;
        madeId[i] = np.id;
        out.push(np);
      } else if (o.op === "cone") {
        const nc = makePiece("cone", { x: o.x, y: o.y }, out);
        nc.color = markColor;
        out.push(nc);
      } else if (o.op === "puck") {
        const np = makePiece("puck", { x: o.x, y: o.y }, out);
        np.carrier = idFor(o.on);
        out.push(np);
      } else if (o.op === "shape") {
        const pts = shapeMarkPts(o.shape, o.cx, o.cy, o.w, o.h);
        out.push({ id: nextId("mark", out), kind: "mark", pts, x: pts[0].x, y: pts[0].y,
          color: markColor, width: markWidth, style: markStyle, path: [] });
      } else if (o.op === "route") {
        const pi = playerAt(o.to);
        if (pi < 0) { inkMark(o.raw); return; }
        const cur = out[pi];
        const extending = o.extend && cur.path.length > 0;
        if (!extending && cur.path.length) { inkMark(o.raw); return; }
        // extending starts from the route's END, so the new legs continue it
        const from = extending ? segEnd(cur, cur.path.length - 1) : { x: cur.x, y: cur.y };
        let raw = o.raw;
        if (extending) {
          // Drop the dwell right on the tip. Catmull-Rom overshoots when one
          // leg is far shorter than its neighbour, so a 2ft first step in front
          // of a 30ft second one bows the seam backwards into a visible hook.
          // Scaling the trim to the stroke's own reach keeps the legs the same
          // order of size, which is what actually removes the kink.
          const last = raw[raw.length - 1];
          const span = Math.hypot(last.x - from.x, last.y - from.y);
          const nearTip = Math.min(Math.max(2.4, 0.18 * span), 0.35 * span);
          let k = 0;
          while (k < raw.length - 2 && Math.hypot(raw[k].x - from.x, raw[k].y - from.y) < nearTip) k++;
          raw = raw.slice(k);
        }
        const route = fitRoute(from, raw);
        if (!route.length) { inkMark(o.raw); return; }
        // the zigzag gesture says backwards outright; without it an EXTENSION keeps
        // skating the way the route already was (direction is sticky downstream)
        const dir = o.bwd ? "bwd" : (extending ? dirAtWaypoint(cur.path, cur.path.length - 1) : "fwd");
        const legs = dir === "fwd" ? route : route.map(s => ({ ...s, dir }));
        if (!extending) { out[pi] = { ...cur, path: legs }; return; }
        // the old last leg is no longer the end, so its stop mark comes off
        const kept = cur.path.map((s, i) =>
          (i === cur.path.length - 1 && s.endStop ? { ...s, endStop: undefined } : s));
        let path = [...kept, ...legs];
        // curve meeting curve at the junction gets a shared tangent, the same
        // smooth join "add a leg" builds — otherwise the seam reads as a kink
        const j = kept.length - 1;
        if (j >= 0 && (path[j].type === "C" || path[j].type === "Q")
          && (path[j + 1].type === "C" || path[j + 1].type === "Q"))
          path = alignJoint(path, j, "smooth", { x: cur.x, y: cur.y });
        out[pi] = { ...cur, path };
      } else if (o.op === "pass") {
        const si = playerAt(o.from), ri = playerAt(o.to);
        if (si < 0 || ri < 0) return;
        const src = out[si];
        const pi = heldOrConjured(src.id);
        // recvAt -1 = caught at the receiver's spot (doReceiveFrom's `null`)
        out[pi] = { ...out[pi], transfers: [...(out[pi].transfers || []), {
          at: src.path.length ? src.path.length - 1 : -1, to: out[ri].id,
          recvAt: o.recvAt != null && o.recvAt >= 0 ? o.recvAt : null, kind: "pass", by: src.id,
        }] };
      } else if (o.op === "shot") {
        const si = playerAt(o.by);
        if (si < 0) return;
        const sh = out[si];
        const pi = heldOrConjured(sh.id);
        // shooter pinned like addTerminal does — the actor must not drift
        out[pi] = { ...out[pi], terminals: [...(out[pi].terminals || []), {
          kind: "shot", at: sh.path.length ? sh.path.length - 1 : -1, ref: "", by: sh.id,
          ...(o.net ? { net: o.net } : {}),
        }] };
      } else if (o.op === "mark") {
        inkMark(o.pts, o.press, o.sketch);
      }
    });
    return out;
  }

  // rotate a mark's points about its centroid (degrees; rink feet are square
  // units, so data-space rotation is geometrically true)
  function rotateMark(id, deg) {
    const m = pieces.find(q => q.id === id);
    if (!m || !m.pts || m.pts.length < 2) return;
    const cx = m.pts.reduce((a, q) => a + q.x, 0) / m.pts.length;
    const cy = m.pts.reduce((a, q) => a + q.y, 0) / m.pts.length;
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const pts = fitInside(m.pts.map(q => ({
      ...q,
      x: cx + (q.x - cx) * c - (q.y - cy) * s,
      y: cy + (q.x - cx) * s + (q.y - cy) * c,
    })));
    updateById(id, { pts, x: pts[0].x, y: pts[0].y });
  }
  // scale a mark's points about its centroid — sx/sy per axis (size & proportion)
  function scaleMark(id, sx, sy) {
    const m = pieces.find(q => q.id === id);
    if (!m || !m.pts || m.pts.length < 2) return;
    const cx = m.pts.reduce((a, q) => a + q.x, 0) / m.pts.length;
    const cy = m.pts.reduce((a, q) => a + q.y, 0) / m.pts.length;
    const pts = fitInside(m.pts.map(q => ({ ...q, x: cx + (q.x - cx) * sx, y: cy + (q.y - cy) * sy })));
    updateById(id, { pts, x: pts[0].x, y: pts[0].y });
  }

  /* ----- pointer handling ----- */
  const TAP_DIST = 1.4;

  function onSvgDown(e) {
    noteStylus(e);
    if (palmBlocked(e)) return;                // Pencil in use — the ice ignores skin
    if (holdStep) { skipHold(); return; }      // presentation hold → a tap on the ice advances early
    setOpenMenu(null);                         // a tap on the ice always closes any open menu
    if (playing || pinchRef.current) return;
    if (wakeEdit()) return;                    // paused/finished → snap back to start first
    const pt = svgPt(e);
    // a pointer-down with any other tool closes an open pen burst first, so
    // draw-an-X-then-drag-something can't race the settle timer
    if (tool !== "pen") flushPen();
    if (tool === "draw") { setPopup(null); beginDraw(e); return; }
    if (tool === "marker") { setPopup(null); beginMark(e); return; }
    if (tool === "pen") { setPopup(null); beginPen(e); return; }
    if (tool === "playerpuck") {
      addPlayerWithPuck(pt, false);
      setTool("select");
      return;
    }
    if (tool !== "select") {
      const np = makePiece(tool, pt);
      setPieces(ps => [...ps, np]);
      // Deliberately NOT selected. A selection takes the Edit bar over with the
      // modify strip, so auto-selecting what you just placed hid the palette and
      // you had to tap empty ice before you could place the next one. You can
      // still tap the piece to select it; a LABEL is the exception, since it's
      // useless until you type something into it.
      if (tool === "label") { setSelectedId(np.id); setPopup({ type: "piece", id: np.id }); }
      else setPopup(null);
      setTool("select");
      return;
    }
    // pinned: an empty-ice tap keeps the last-edited item in the panel (don't
    // close it) — but still allow double-tap "add here" and box-select below
    if (!(pinned && editing)) setPopup(null);
    if (!editing) { setSelectedId(null); setMultiSel(null); return; }
    // double-click / double-tap on empty ice → "add here" menu
    const now = performance.now();
    const it = lastIceTap.current;
    if (it && now - it.t < 350 && Math.hypot(it.pt.x - pt.x, it.pt.y - pt.y) < 3) {
      lastIceTap.current = null;
      setSelectedId(null); setMultiSel(null);
      setPopup({ type: "add", pt });
      return;
    }
    lastIceTap.current = { t: now, pt };
    // begin a box-select — it only activates once dragged; a plain tap (no move)
    // just clears the selection on pointer-up
    drag.current = { kind: "marquee", start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function addPieceAt(kind, pt) {
    const np = makePiece(kind, pt);
    setPieces(ps => [...ps, np]);
    setSelectedId(np.id);
    setPopup({ type: "piece", id: np.id });
  }
  // bump the number embedded in a name to the next one not already taken, so
  // duplicating P1 (with P2 around) yields P3, not another P1. No number → as-is.
  function bumpLabel(label, used) {
    const m = /^(.*?)(\d+)(\D*)$/.exec(label || "");
    if (!m) return label;
    const pre = m[1], suf = m[3];
    let n = parseInt(m[2], 10) + 1;
    while (used.has(pre + n + suf)) n++;
    const nl = pre + n + suf;
    used.add(nl);
    return nl;
  }
  const playerLabels = () => new Set(pieces.filter(p => p.kind === "player").map(p => p.label));
  // copy a piece (with its route/props) to a fresh id, offset so it's visible
  function duplicatePiece(id) {
    const src = pieces.find(p => p.id === id);
    if (!src) return;
    const off = 9, nid = nextId(src.kind);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = nid;
    if (src.kind === "player") copy.label = bumpLabel(src.label, playerLabels());
    copy.x = clampX(src.x + off); copy.y = clampY(src.y + off);
    if (Array.isArray(copy.path)) copy.path = copy.path.map(s => {
      const t = { ...s };
      for (const k of ["x", "cx", "c1x", "c2x"]) if (t[k] != null) t[k] = clampX(t[k] + off);
      for (const k of ["y", "cy", "c1y", "c2y"]) if (t[k] != null) t[k] = clampY(t[k] + off);
      return t;
    });
    // a mark's copy has to carry its pts across, or it lands exactly on top of
    // the original with only its (derived) x/y offset
    if (Array.isArray(copy.pts) && copy.pts.length) {
      copy.pts = fitInside(copy.pts.map(q => ({ ...q, x: q.x + off, y: q.y + off })));
      copy.x = copy.pts[0].x; copy.y = copy.pts[0].y;
    }
    // a duplicated puck starts loose (avoid two pucks glued to one carrier)
    if (copy.kind === "puck") { copy.carrier = null; copy.transfers = []; copy.terminals = undefined; copy.pickup = null; }
    setPieces(ps => [...ps, copy]);
    setSelectedId(nid);
    setPopup({ type: "piece", id: nid });
  }

  // ----- box-select group operations (multiSel) -----
  const idPrefix = kind => (kind === "player" ? "P" : kind === "puck" ? "PK" : kind === "net" ? "N"
    : kind === "bumper" ? "B" : kind === "deker" ? "DK" : kind === "passer" ? "PS"
    : kind === "label" ? "L" : kind === "tire" ? "T" : kind === "stick" ? "ST" : kind === "light" ? "LT" : kind === "mark" ? "MK" : "C");
  const rotatesFacing = p => ["net", "bumper", "deker", "passer", "tire", "light"].includes(p.kind) || (p.kind === "player" && !p.path.length);
  const groupCentroid = sel => sel.length
    ? { x: sel.reduce((a, p) => a + p.x, 0) / sel.length, y: sel.reduce((a, p) => a + p.y, 0) / sel.length } : null;
  // slide a set of pieces (and their routes) by dx,dy
  const moveMembersBy = (has, dx, dy) => {
    const ci = (x, y) => boards.clampInside(x, y);
    update(p => {
      if (!has(p.id) || p.lock) return p;   // a locked member never slides with its group
      // a mark's geometry lives in pts (x/y is just a copy of pts[0]), so it
      // has to move as a rigid body — moving x/y alone left the ink sitting
      // still while its position desynced from what's drawn
      if (p.kind === "mark" && p.pts) {
        const pts = fitInside(p.pts.map(q => ({ ...q, x: q.x + dx, y: q.y + dy })));
        return { ...p, pts, x: pts[0].x, y: pts[0].y };
      }
      const np = ci(p.x + dx, p.y + dy);
      const path = (p.path || []).map(s => {
        const q = ci(s.x + dx, s.y + dy), s2 = { ...s, x: q.x, y: q.y };
        if (s.type === "Q") { const c = ci(s.cx + dx, s.cy + dy); s2.cx = c.x; s2.cy = c.y; }
        if (s.type === "C") { const c1 = ci(s.c1x + dx, s.c1y + dy); s2.c1x = c1.x; s2.c1y = c1.y; const c2 = ci(s.c2x + dx, s.c2y + dy); s2.c2x = c2.x; s2.c2y = c2.y; }
        return s2;
      });
      return { ...p, x: np.x, y: np.y, path };
    });
  };
  const moveGroupBy = (dx, dy) => moveMembersBy(id => !!multiSel && multiSel.has(id), dx, dy);
  // whether anything on the board is locked (piece or any of its waypoints) — drives
  // the menu label + one-tap Lock all / Unlock all
  const anyLocked = pieces.some(p => p.lock || (p.path || []).some(s => s.lock));
  const toggleLockAll = () => {
    const lock = !anyLocked;                    // lock everything, or clear every lock
    const lockPath = arr => (arr || []).map(s => (lock ? { ...s, lock: true } : (() => { const { lock: _l, ...rest } = s; return rest; })()));
    const lockForks = fks => (fks || []).map(f => ({ ...f, path: lockPath(f.path), forks: lockForks(f.forks) }));
    setPieces(ps => ps.map(p => ({ ...p, lock, path: lockPath(p.path), forks: lockForks(p.forks) })));
  };
  // ----- named groups (persistent, saved as group= on each piece) -----
  const groupMembers = name => new Set(pieces.filter(q => q.group === name).map(q => q.id));
  // the shared group name of the current box-selection, or null if mixed/none
  const selGroupName = () => {
    if (!multiSel || !multiSel.size) return null;
    const sel = pieces.filter(p => multiSel.has(p.id));
    const g = sel[0] && sel[0].group;
    return g && sel.every(p => p.group === g) ? g : null;
  };
  const createGroup = name => {
    const nm = (name || "").trim();
    if (!nm || !multiSel || !multiSel.size) return;
    update(p => (multiSel.has(p.id) ? { ...p, group: nm } : p));
  };
  const ungroup = name => update(p => (p.group === name ? { ...p, group: undefined } : p));
  // rotate the whole selection around its centroid (positions, routes, facings)
  function rotateGroup(deg) {
    if (!multiSel || !multiSel.size) return;
    const C = groupCentroid(pieces.filter(p => multiSel.has(p.id))); if (!C) return;
    const r = (deg * Math.PI) / 180, ca = Math.cos(r), sa = Math.sin(r);
    const rot = (x, y) => { const dx = x - C.x, dy = y - C.y; return boards.clampInside(C.x + dx * ca - dy * sa, C.y + dx * sa + dy * ca); };
    update(p => {
      if (!multiSel.has(p.id)) return p;
      // a mark rotates through its own points, rigidly (rot() clamps per point,
      // which would squash it) — x/y then follows pts[0] as everywhere else
      if (p.kind === "mark" && p.pts) {
        const pts = fitInside(p.pts.map(q => ({
          ...q,
          x: C.x + (q.x - C.x) * ca - (q.y - C.y) * sa,
          y: C.y + (q.x - C.x) * sa + (q.y - C.y) * ca,
        })));
        return { ...p, pts, x: pts[0].x, y: pts[0].y };
      }
      const np = { ...p }, q = rot(p.x, p.y); np.x = q.x; np.y = q.y;
      if (rotatesFacing(p)) np.facing = (p.facing || 0) + deg;
      np.path = (p.path || []).map(s => {
        const t = { ...s };
        for (const [xk, yk] of [["x", "y"], ["cx", "cy"], ["c1x", "c1y"], ["c2x", "c2y"]])
          if (t[xk] != null && t[yk] != null) { const w = rot(t[xk], t[yk]); t[xk] = w.x; t[yk] = w.y; }
        return t;
      });
      return np;
    });
  }
  // duplicate the whole selection; references between selected pieces retarget to
  // the copies, references to OUTSIDE pieces stay pointing at the originals
  function duplicateGroup() {
    if (!multiSel || !multiSel.size) return;
    const off = 9, src = pieces.filter(p => multiSel.has(p.id));
    const used = new Set(pieces.map(p => p.id)), idMap = {};
    const fresh = kind => { const pre = idPrefix(kind); let n = 1; while (used.has(pre + n)) n++; used.add(pre + n); return pre + n; };
    for (const p of src) idMap[p.id] = fresh(p.kind);
    const usedLabels = playerLabels();          // bump player names in order (P1,P2 → P3,P4)
    const copies = src.map(p => {
      const c = JSON.parse(JSON.stringify(p));
      c.id = idMap[p.id];
      if (c.kind === "player") c.label = bumpLabel(p.label, usedLabels);
      c.x = clampX(p.x + off); c.y = clampY(p.y + off);
      if (Array.isArray(c.path)) c.path = c.path.map(s => {
        const t = { ...s };
        for (const k of ["x", "cx", "c1x", "c2x"]) if (t[k] != null) t[k] = clampX(t[k] + off);
        for (const k of ["y", "cy", "c1y", "c2y"]) if (t[k] != null) t[k] = clampY(t[k] + off);
        return t;
      });
      // as in duplicatePiece: a mark's geometry is pts, so offset that too
      if (Array.isArray(c.pts) && c.pts.length) {
        c.pts = fitInside(c.pts.map(q => ({ ...q, x: q.x + off, y: q.y + off })));
        c.x = c.pts[0].x; c.y = c.pts[0].y;
      }
      if (c.kind === "puck") {
        if (c.carrier) c.carrier = idMap[c.carrier] || null;                       // carrier outside the group → drop (loose)
        if (c.pickup && c.pickup.to) c.pickup = idMap[c.pickup.to] ? { ...c.pickup, to: idMap[c.pickup.to] } : null;
        if (Array.isArray(c.transfers)) c.transfers = c.transfers.map(t => ({
          ...t, ...(idMap[t.to] ? { to: idMap[t.to] } : {}),
          ...(t.by && idMap[t.by] ? { by: idMap[t.by] } : {}), ...(t.via && idMap[t.via] ? { via: idMap[t.via] } : {}),
        }));
        if (c.net && idMap[c.net]) c.net = idMap[c.net];
        if (Array.isArray(c.terminals)) c.terminals = c.terminals.map(t => (t.by && idMap[t.by] ? { ...t, by: idMap[t.by] } : t));
        // a copied puck whose carrier fell outside the group starts loose
        if (!c.carrier && !c.pickup && p.carrier && !idMap[p.carrier]) { c.transfers = []; c.terminals = undefined; }
      }
      return c;
    });
    // a duplicated group becomes its own independent named group ("X copy")
    const names = new Set(pieces.map(p => p.group).filter(Boolean)), gmap = {};
    copies.forEach(c => {
      if (!c.group) return;
      if (!gmap[c.group]) { let n = c.group + " copy", k = 2; while (names.has(n)) n = `${c.group} copy ${k++}`; names.add(n); gmap[c.group] = n; }
      c.group = gmap[c.group];
    });
    setPieces(ps => [...ps, ...copies]);
    setSelectedId(null); setPopup(null);
    setMultiSel(new Set(copies.map(c => c.id)));
  }
  function deleteGroup() {
    if (!multiSel || !multiSel.size) return;
    const n = multiSel.size;
    setPieces(ps => { let list = ps.filter(q => !multiSel.has(q.id)); for (const id of multiSel) list = scrubRefs(list, id); return list; });
    setMultiSel(null); setSelectedId(null); setPopup(null);
    flash(`Deleted ${n} item${n > 1 ? "s" : ""} — Undo restores them`);
  }

  // turn one puck into a pile: scatter a few more loose, individual pucks in a
  // tight cluster around it (each its own selectable piece)
  function makePuckPile(pkId) {
    const src = pieces.find(p => p.id === pkId && p.kind === "puck");
    if (!src) return;
    const used = new Set(pieces.map(p => p.id));
    const fresh = () => { let n = 1; while (used.has("PK" + n)) n++; used.add("PK" + n); return "PK" + n; };
    // a fresh random scatter each time — 5–7 pucks flung around the source
    const n = 5 + Math.floor(Math.random() * 3);
    const extra = [];
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2, rad = 1.1 + Math.random() * 2.8;
      extra.push({
        id: fresh(), kind: "puck", color: src.color,
        x: clampX(src.x + Math.cos(ang) * rad), y: clampY(src.y + Math.sin(ang) * rad),
        speed: src.speed || 1, carrier: null, pickup: null, transfers: [], net: null, path: [],
      });
    }
    setPieces(ps => [...ps, ...extra]);
  }

  // showPopup also decides whether to SELECT: the quick-add popup wants the new
  // player open for editing, but a drop from the Edit bar must leave the bar on
  // its add palette (a selection swaps it for the modify strip) so you can place
  // the next one without tapping empty ice first.
  function addPlayerWithPuck(pt, showPopup) {
    const pl = makePiece("player", pt);
    const pk = makePiece("puck", pt);
    pk.carrier = pl.id;
    setPieces(ps => [...ps, pl, pk]);
    if (showPopup) { setSelectedId(pl.id); setPopup({ type: "piece", id: pl.id }); }
    else setPopup(null);
  }

  function pieceDown(e, id) {
    if (penPassThrough(e)) return;
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw") { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    // pen ink starts on pieces all the time (routes leave players, dashes leave
    // route ends) — keep sketching, never grab the piece
    if (tool === "pen") { setPopup(null); beginPen(e); return; }
    if (wakeEdit()) return;
    // Grabbing a piece is a different intent from placing one, so it disarms
    // whatever was armed. Leaving it armed made a HIDDEN mode: a selection
    // hides the add palette, so the armed chip wasn't on screen any more, yet
    // the bar still carried its Cancel — two exits at once, one of them for a
    // tool you could no longer see. ("draw" and "pen" return above; they mean
    // to act ON this piece.)
    if (tool !== "select") setTool("select");
    const pt = svgPt(e);
    // a locked piece is grabbed only to select it (so it can open its popup and
    // be unlocked) — never moved. onSvgMove bails on d.locked, keeping d.moved
    // false so the tap still opens the popup.
    const locked = !!pieces.find(q => q.id === id)?.lock;
    // if this piece is part of a box-selection, drag the whole group together
    if (multiSel && multiSel.has(id)) {
      drag.current = { kind: "group", start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    // a piece in a NAMED group: dragging any member slides the whole formation;
    // a plain tap still selects/edits just this piece
    const pc = pieces.find(q => q.id === id);
    if (pc && pc.group) {
      setMultiSel(null);
      setSelectedId(id);
      drag.current = { kind: "gmove", id, members: groupMembers(pc.group), start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    setMultiSel(null);
    setSelectedId(id);
    // was this piece's editor already open (or a pinned panel) at grab time? A
    // routed piece reopens its editor after a move so its start-angle handle
    // reshows — but only if it was ALREADY being edited; a bare reposition of a
    // piece whose popup was closed should stay closed.
    const popOpen = pinned || (!!popup && popup.id === id);
    // a mark moves as a rigid body, so it needs its geometry as it was at grab
    // time: every move re-derives from pts0, never from the last committed
    // (possibly boundary-shifted) state — see the mark branch in onSvgMove
    const pts0 = pc && pc.kind === "mark" && pc.pts ? pc.pts.map(q => ({ ...q })) : null;
    drag.current = { kind: "piece", id, popOpen, pts0, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function markPtDown(e, id, idx) {
    if (penPassThrough(e)) return;
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    if (wakeEdit()) return;
    setOpenMenu(null);
    setSelectedId(id);
    const pt = svgPt(e);
    // start/last/moved are required by onSvgMove's tap-threshold guard —
    // without them it dereferences d.start.x and throws, killing the drag
    drag.current = { kind: "markpt", id, idx, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked: !!pieces.find(q => q.id === id)?.lock };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // a leg tap that lands within grabbing distance of one of its endpoint
  // waypoints → that waypoint's index (nearest wins), else null. Lets a tap on a
  // curve where a waypoint sits open the point popup without a second tap.
  function waypointUnderTap(id, segIdx, pt, fork) {
    const p = pieces.find(q => q.id === id);
    if (!p) return null;
    const route = routeSegs(p, fork);
    let best = null, bd = coarsePtr ? 5 : 3.6;   // ~ the on-ice waypoint grab radius, in feet
    for (const w of [segIdx, segIdx - 1]) {
      if (w < 0 || w >= route.length) continue;
      const dd = Math.hypot(route[w].x - pt.x, route[w].y - pt.y);
      if (dd < bd) { bd = dd; best = w; }
    }
    // a staggered end ARROWHEAD is a tap alias for the last waypoint — the head
    // sits pulled back on the line, away from the true endpoint it stands for
    if (!fork && route.length && endStagger[id]) {
      const hp = staggeredEndPt(p, endStagger[id]);
      if (hp && Math.hypot(hp.x - pt.x, hp.y - pt.y) < bd) best = route.length - 1;
    }
    return best;
  }
  function lineDown(e, id, segIdx, fork = null) {
    if (penPassThrough(e)) return;
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw" && !fork) { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    if (wakeEdit()) return;
    setSelectedId(id);
    if (fork) setEditingFork({ id, color: fork });   // tapping a reaction route opens it for editing
    const pt = svgPt(e);
    // grabbing a route leg slides the WHOLE piece + route. Block that if the piece
    // is locked OR any waypoint on this route is pinned — a pinned point locks the
    // route down, leaving only individual (unlocked) point drags. The leg still
    // taps through to its popup (add/edit points) since d.moved stays false.
    const pc = pieces.find(q => q.id === id);
    const rseg = (routePiece(pc, fork) || {}).path || [];
    const locked = !!(pc?.lock || rseg.some(s => s.lock));
    drag.current = { kind: "piece", id, line: segIdx, ...(fork ? { fork } : {}), tapPt: pt, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function handleDown(e, payload) {
    if (penPassThrough(e)) return;
    if (!editing || pinchRef.current) return;
    e.stopPropagation();
    if (wakeEdit()) return;
    setOpenMenu(null);
    // same as pieceDown: taking hold of a waypoint is not placing a piece, so
    // it disarms the tool rather than leaving it armed but off screen
    if (tool !== "select" && tool !== "draw") setTool("select");
    if (payload.id) setSelectedId(payload.id);
    const pt = svgPt(e);
    // resize handle: remember the pointer's starting distance from the label
    // centre so size scales with how far it's dragged out/in
    const extra = payload.kind === "resize"
      ? { dist0: Math.max(0.5, Math.hypot(pt.x - payload.cx, pt.y - payload.cy)) } : {};
    // a locked piece locks all its handles; a locked waypoint locks its own
    const pc = pieces.find(q => q.id === payload.id);
    const locked = !!(pc?.lock || (payload.seg != null && pc?.path?.[payload.seg]?.lock));
    drag.current = { ...payload, ...extra, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // grab the stick of a stationary player to rotate them; the blade's
  // own angular offset from the body is subtracted so the blade tracks
  // the pointer exactly instead of jumping on grab
  function stickDown(e, p) {
    if (penPassThrough(e)) return;
    if (playing || pinchRef.current) return;
    if (wakeEdit()) return;
    e.stopPropagation();
    setOpenMenu(null);
    setSelectedId(p.id);
    const side = p.hand === "L" ? -1 : 1;
    const offset = (Math.atan2(2.55 * side, 4.7) * 180) / Math.PI;
    const pt = svgPt(e);
    drag.current = { kind: "rotate", id: p.id, offset, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse", locked: !!p.lock };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function onSvgMove(e) {
    if (pinchRef.current) return;
    const d = drag.current;
    if (!d) return;
    // a locked entity was grabbed only to select/open its popup — never moved.
    // Leaving d.moved false lets onSvgUp treat the grab as a tap (opens popup).
    if (d.locked) return;
    // a stroke belongs to the pointer that started it — a palm (or second
    // finger) landing mid-stroke must not extend the line
    if (d.pid != null && e.pointerId !== d.pid) return;
    const pt = svgPt(e);
    if (d.kind === "drawing") {
      const last = drawRaw.current[drawRaw.current.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) > (d.pen ? inkStepFt(penReadRef.current === "sketch") : 1.1)) {
        if (e.pointerType === "pen" && e.pressure > 0) pt.p = e.pressure;
        drawRaw.current.push(pt);
        setDrawPreview(drawRaw.current.slice());
      }
      // the pen shows a footprint reticle instead of the magnifying loupe —
      // the loupe's offset panel is more distraction than help when sketching
      if (d.pen) {
        setPenTip(pt);
        if (penDraw.current?.stylus && e.pressure > 0) penDraw.current.press.push(e.pressure);
      }
      else if (d.touch) setLoupe(pt);
      return;
    }
    if (!d.moved) {
      if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) < TAP_DIST) return;
      d.moved = true;
      d.last = d.start;
      if (!pinned) setPopup(null);   // a pinned/docked panel stays open while dragging
    }
    // box-select: track the rectangle (no loupe — it's not a precise handle drag)
    if (d.kind === "marquee") { d.last = pt; setMarquee({ x0: d.start.x, y0: d.start.y, x1: pt.x, y1: pt.y }); return; }
    // group move: slide every selected piece by the pointer delta
    if (d.kind === "group") { const dx = pt.x - d.last.x, dy = pt.y - d.last.y; d.last = pt; moveGroupBy(dx, dy); if (d.touch) setLoupe(pt); return; }
    // named-group move: slide the whole formation by dragging one member
    if (d.kind === "gmove") { const dx = pt.x - d.last.x, dy = pt.y - d.last.y; d.last = pt; moveMembersBy(id => d.members.has(id), dx, dy); if (d.touch) setLoupe(pt); return; }
    if (d.touch) setLoupe(pt);
    if (d.kind === "rotate") {
      update(p => {
        if (p.id !== d.id) return p;
        const ang = (Math.atan2(pt.y - p.y, pt.x - p.x) * 180) / Math.PI;
        return { ...p, facing: ang - (d.offset || 0) };
      });
      return;
    }
    if (d.kind === "aim") {
      const ang = Math.round((Math.atan2(pt.y - d.origin.y, pt.x - d.origin.x) * 180) / Math.PI);
      setAim(d.pkId, d.target, ang);
      return;
    }
    if (d.kind === "markpt") {
      const cp = boards.clampInside(pt.x, pt.y);
      update(p => {
        if (p.id !== d.id || p.kind !== "mark") return p;
        const pts = p.pts.map((q, i) => (i === d.idx ? { ...q, x: cp.x, y: cp.y } : q));
        return { ...p, pts, x: pts[0].x, y: pts[0].y };
      });
      return;
    }
    if (d.kind === "release") {
      const ang = Math.round((Math.atan2(pt.y - d.origin.y, pt.x - d.origin.x) * 180) / Math.PI);
      // the handle is REL_MULT× closer than the landing, so scale the drag up
      const raw = Math.hypot(pt.x - d.origin.x, pt.y - d.origin.y) * REL_MULT;
      const lo = d.relKind === "chip" ? 6 : 10, hi = d.relKind === "chip" ? 90 : 170;
      const dist = Math.round(Math.max(lo, Math.min(hi, raw)));
      setRelease(d.pkId, d.term, ang, dist);
      return;
    }
    if (d.kind === "resize") {
      const dist = Math.hypot(pt.x - d.cx, pt.y - d.cy);
      const size = Math.max(0.4, Math.min(6, (d.size0 || 1) * (dist / d.dist0)));
      if (d.seg == null) updateById(d.id, { size });
      else updateSeg(d.id, d.seg, { dsize: size });
      return;
    }
    if (d.kind === "markrotate") {
      // rotate handle: spin the mark about its centroid, following the pointer
      d.moved = true;
      const ang = Math.atan2(pt.y - d.cy, pt.x - d.cx) - d.a0;
      const c = Math.cos(ang), s = Math.sin(ang);
      const pts = fitInside(d.pts0.map(q => ({
        ...q,
        x: d.cx + (q.x - d.cx) * c - (q.y - d.cy) * s,
        y: d.cy + (q.x - d.cx) * s + (q.y - d.cy) * c,
      })));
      updateById(d.id, { pts, x: pts[0].x, y: pts[0].y });
      return;
    }
    if (d.kind === "markscale") {
      // corner drag scales the mark about the OPPOSITE corner, each axis free
      // (the popup's Size/Wide/Tall buttons cover constrained adjustments)
      d.moved = true;
      const sx = Math.max(0.12, Math.min(8, (pt.x - d.ax) / ((d.x0 - d.ax) || 1e-6)));
      const sy = Math.max(0.12, Math.min(8, (pt.y - d.ay) / ((d.y0 - d.ay) || 1e-6)));
      // fitInside, not a per-point clamp: a shape grown against a wall slides
      // inward whole (the anchor corner gives) instead of flattening on it
      const pts = fitInside(d.pts0.map(q => ({ ...q, x: d.ax + (q.x - d.ax) * sx, y: d.ay + (q.y - d.ay) * sy })));
      updateById(d.id, { pts, x: pts[0].x, y: pts[0].y });
      return;
    }
    if (d.kind === "wlabel") {
      const dx = pt.x - d.last.x, dy = pt.y - d.last.y;
      d.last = pt;
      update(p => {
        if (p.id !== d.id) return p;
        const path = p.path.slice();
        const s = path[d.seg];
        path[d.seg] = { ...s, dox: (s.dox || 0) + dx, doy: (s.doy != null ? s.doy : -5) + dy };
        return { ...p, path };
      });
      return;
    }
    if (d.kind === "piece") {
      const dx = pt.x - d.last.x, dy = pt.y - d.last.y;
      d.last = pt;
      const ci = (x, y) => boards.clampInside(x, y);    // clamp to the rounded boards
      update(p => {
        if (p.id !== d.id) return p;
        if (p.kind === "mark") {
          // A marker annotation is a RIGID body: translate the whole thing by
          // the total drag, then shift it back inside as a unit. Clamping each
          // point on its own squashed the shape flat against the boards, and
          // since the clamped result fed the next move it never came back.
          // Deriving from pts0 + (pt - start) rather than an incremental delta
          // is what makes it recoverable: push 10ft past the wall, pull back
          // 5ft, and the shape sits 5ft off the wall, still under the cursor.
          const src = d.pts0 || p.pts;
          const tx = pt.x - d.start.x, ty = pt.y - d.start.y;
          // spread q first so per-point flags (sharp corners, pressure) survive
          const pts = fitInside(src.map(q => ({ ...q, x: q.x + tx, y: q.y + ty })));
          return { ...p, pts, x: pts[0].x, y: pts[0].y };
        }
        if (d.line == null) {
          // dragging the piece itself moves the route's START point; carry the
          // first leg's departure handle along so the start-point angle handle
          // stays glued to the piece (waypoint 0 and the rest stay anchored, just
          // like moving an anchor in a curve editor carries only its own tangent)
          const np = ci(p.x + dx, p.y + dy);
          const s0 = p.path[0];
          if (s0 && (s0.type === "C" || s0.type === "Q")) {
            const kx = s0.type === "C" ? "c1x" : "cx", ky = s0.type === "C" ? "c1y" : "cy";
            const c = ci(s0[kx] + (np.x - p.x), s0[ky] + (np.y - p.y));
            return { ...p, x: np.x, y: np.y, path: p.path.map((s, i) => i === 0 ? { ...s, [kx]: c.x, [ky]: c.y } : s) };
          }
          return { ...p, x: np.x, y: np.y };
        }
        // dragging a route line slides the whole piece + route together
        const mv = s => {
          const q = ci(s.x + dx, s.y + dy);
          const s2 = { ...s, x: q.x, y: q.y };
          if (s.type === "Q") { const c = ci(s.cx + dx, s.cy + dy); s2.cx = c.x; s2.cy = c.y; }
          if (s.type === "C") {
            const c1 = ci(s.c1x + dx, s.c1y + dy); s2.c1x = c1.x; s2.c1y = c1.y;
            const c2 = ci(s.c2x + dx, s.c2y + dy); s2.c2x = c2.x; s2.c2y = c2.y;
          }
          return s2;
        };
        const np = ci(p.x + dx, p.y + dy);
        return { ...p, x: np.x, y: np.y, path: p.path.map(mv) };
      });
      return;
    }
    const cp = boards.clampInside(pt.x, pt.y);          // keep the handle inside the boards
    update(p => {
      if (p.id !== d.id) return p;
      const edit = arr => {
        let path = arr.slice();
        const s = { ...path[d.seg] };
        if (d.kind === "anchor") {
          const dx = cp.x - s.x, dy = cp.y - s.y;
          s.x = cp.x; s.y = cp.y; path[d.seg] = s;
          // A waypoint carries its curve handles, whatever its join type. This
          // used to be gated on smooth/sym, so dragging a CORNER waypoint left
          // its control points behind — a Bézier control is defined relative to
          // its anchor, so the curve reshaped itself around the move instead of
          // travelling with it. jointControls returns null for a straight leg or
          // a route end, so there's nothing to carry in those cases anyway.
          if (d.wp != null) path = translateJointHandles(path, d.wp, dx, dy);
          return path;
        }
        if (d.kind === "q") { s.cx = cp.x; s.cy = cp.y; }
        if (d.kind === "c1") { s.c1x = cp.x; s.c1y = cp.y; }
        if (d.kind === "c2") { s.c2x = cp.x; s.c2y = cp.y; }
        path[d.seg] = s;
        // smooth/symmetric points drive their opposite handle to stay aligned
        if (d.wp != null) path = mirrorJoint(path, d.wp, d.seg, d.kind, cp);
        return path;
      };
      if (d.fork) return { ...p, forks: mapForkAt(p.forks, d.fork, f => ({ ...f, path: edit(f.path) })) };
      return { ...p, path: edit(p.path) };
    });
  }

  function onSvgUp(e) {
    const d = drag.current;
    // ignore the lift of a pointer that isn't the one driving this drag
    // (a rejected palm releasing must not end the Pencil's stroke)
    if (d && d.pid != null && e && e.pointerId != null && e.pointerId !== d.pid) return;
    drag.current = null;
    setLoupe(null);
    if (!d) return;
    if (d.kind === "drawing") { finishDraw(); return; }
    if (d.kind === "marquee") {
      setMarquee(null);
      if (!d.moved) { setSelectedId(null); setMultiSel(null); setDragSel(null); return; }   // a plain tap deselects
      const x0 = Math.min(d.start.x, d.last.x), x1 = Math.max(d.start.x, d.last.x);
      const y0 = Math.min(d.start.y, d.last.y), y1 = Math.max(d.start.y, d.last.y);
      const hit = pieces.filter(p => !p.lock && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map(p => p.id);
      setSelectedId(null); setPopup(null);
      setMultiSel(hit.length ? new Set(hit) : null);
      return;
    }
    if (d.kind === "group") return;   // group move already applied live
    if (d.kind === "gmove") { if (!d.moved) setPopup({ type: "piece", id: d.id }); return; }   // tap a grouped piece = edit it
    // snap a dropped net into a standard goal position if it's near one
    if (d.kind === "piece" && d.moved && d.line == null) {
      const pc = pieces.find(q => q.id === d.id);
      if (pc && pc.kind === "net") {
        const spots = [{ x: 11, y: 42.5, facing: 0 }, { x: 189, y: 42.5, facing: 180 }];
        const near = spots.find(s => Math.hypot(s.x - pc.x, s.y - pc.y) < 12);
        if (near) updateById(pc.id, near);
      }
      // a routed piece carries a start-point angle handle — reopen its editor so
      // that handle reshows after the move instead of needing a second click. Only
      // when it was already being edited (or a pinned panel): a bare drag of a piece
      // whose popup was closed shouldn't pop the editor open.
      if (pc && pc.path && pc.path.length && d.popOpen) { setSelectedId(d.id); setPopup({ type: "piece", id: d.id }); }
      setDragSel(null);   // a body move → the bar's piece actions, not a stale point
      return;
    }
    // a MOVED drag doesn't (re)open the popup, but the bar should still reflect
    // what was just dragged: a waypoint drag loads that point's actions so Delete
    // hits the point, not the player. Anything else falls back to piece actions.
    if (d.moved) {
      if ((d.kind === "anchor" || d.kind === "wlabel") && d.seg != null)
        setDragSel({ type: "point", id: d.id, seg: d.seg, ...(d.fork ? { fork: d.fork } : {}) });
      else
        setDragSel(null);
      return;
    }
    setDragSel(null);   // a plain tap sets popup below; that becomes the source of truth
    if (d.kind === "wlabel") { setSelectedId(d.id); setPopup({ type: "point", id: d.id, seg: d.seg }); return; }
    if (d.kind === "resize" || d.kind === "markscale" || d.kind === "markrotate") return;
    if (d.kind === "markpt") {
      // tap (no drag) on a mark control point toggles its kind: sharp corner
      // (break handle) ↔ smooth curve point — like route waypoint kinds
      const mk = pieces.find(q => q.id === d.id && q.kind === "mark");
      if (mk?.pts?.[d.idx]) {
        const c = !mk.pts[d.idx].c;
        updateById(d.id, { pts: mk.pts.map((q, i) => (i === d.idx ? { ...q, c: c || undefined } : q)) });
        flash(c ? "Sharp corner" : "Smooth point");
      }
      return;
    }
    if (d.kind === "aim") { setAim(d.pkId, d.target, null); return; }  // tap to clear the aim
    if (d.kind === "release") { setAim(d.pkId, { term: d.term }, null); return; }  // tap clears direction back to auto
    if (d.kind === "rotate") { setPopup({ type: "piece", id: d.id }); return; }
    if (d.kind === "piece") {
      if (d.line != null) {
        const now = performance.now();
        const lt = lastLineTap.current;
        if (lt && now - lt.t < 350 && lt.id === d.id &&
            Math.hypot(lt.pt.x - d.tapPt.x, lt.pt.y - d.tapPt.y) < 3) {
          lastLineTap.current = null;
          addPointAt(d.id, d.line, d.tapPt, d.fork || null);
          return;
        }
        lastLineTap.current = { t: now, id: d.id, pt: d.tapPt };
        // a tap landing on a waypoint opens that point directly — don't make the
        // coach hit the leg first, then the dot on a second tap
        const wp = waypointUnderTap(d.id, d.line, d.tapPt, d.fork || null);
        if (wp != null) { setSelectedId(d.id); setPopup({ type: "point", id: d.id, seg: wp, ...(d.fork ? { fork: d.fork } : {}) }); return; }
        setSelectedId(d.id);
        setPopup({ type: "line", id: d.id, seg: d.line, pt: d.tapPt, ...(d.fork ? { fork: d.fork } : {}) });
        return;
      }
      setPopup({ type: "piece", id: d.id });
    }
    if (d.kind === "anchor") { setSelectedId(d.id); setPopup({ type: "point", id: d.id, seg: d.seg, ...(d.fork ? { fork: d.fork } : {}) }); }
  }

  /* ----- text / files ----- */
  function openText() {
    setTextDraft(serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems));
    setTextError("");
    setTextCloseAsk(false);
    setOpenMenu("text");
  }
  function applyText() {
    const r = parseDrill(extractDrill(textDraft));   // accepts a pasted ```drill markdown block
    if (r.errors.length) { setTextError(r.errors.join("\n")); return; }
    setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc); setDrillSteps(r.steps || []); setDrillNotes(r.notes || ""); setDrillItems(r.items || []); setDrillVersion(r.dslVersion); setSelectedId(null); setPopup(null);
    resetAnim(); setTextError(""); setOpenMenu(null);
    flash("Board replaced — Undo restores the old drill");
  }
  const slug = () => (drillTitle || "drill").replace(/[^\w-]+/g, "_").toLowerCase();
  // a drill as a markdown doc: title heading + description + a ```drill fenced
  // block that round-trips (renders as a code block in Obsidian / on the web)
  function toMarkdown() {
    const dsl = serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems).trimEnd();
    const title = (drillTitle || "Drill").trim();
    const desc = drillDesc && drillDesc.trim() ? drillDesc.trim() + "\n\n" : "";
    const notes = drillNotes && drillNotes.trim() ? drillNotes.trim() + "\n\n" : "";
    // a real markdown table (rendered outside the fence for humans; the fenced
    // DSL below still round-trips everything on load)
    const rows = deriveInventory(pieces, drillItems).filter(r => !r.hide);
    const inv = rows.length
      ? "## What you need\n\n| Item | Qty |\n|---|---|\n"
        + rows.map(r => `| ${r.label} | ${r.count} |`).join("\n") + "\n\n"
      : "";
    return `# ${title}\n\n${desc}${notes}${inv}\`\`\`drill\n${dsl}\n\`\`\`\n`;
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportTxt() { download(`${slug()}.txt`, serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems), "text/plain"); flash(`Saved ${slug()}.txt`); }
  function exportMd() { download(`${slug()}.md`, toMarkdown(), "text/markdown"); flash(`Saved ${slug()}.md`); }
  // render the drill (via the DSL→SVG renderer) and rasterise it to a PNG
  function exportImage() {
    const dsl = serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems);
    // size the raster to the drill's rink mode, matching the diagram's aspect-
    // preserving viewBox so full ice keeps true 200:85 ice proportions
    const [, , vw, vh] = VIEWS[rink] || VIEWS.full;
    const py = 7, px = (vw / vh) * py;
    const W = 1800, H = Math.round((W * (vh + 2 * py)) / (vw + 2 * px));
    const svg = drillSvg(dsl).replace("<svg ", `<svg width="${W}" height="${H}" `);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      // Exports are ALWAYS light, whatever the app is set to: an <img>-loaded
      // SVG gets no host cascade, so drillSvg() renders on its var() fallbacks
      // — which are THEMES.light. This surround must come from the same table
      // or the PNG gets a mismatched border around the rink.
      ctx.fillStyle = tokens("light")["ice-surround"]; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => {
        if (!b) { flash("Image export failed"); return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = `${slug()}.png`; a.click();
        URL.revokeObjectURL(a.href);
        flash(`Saved ${slug()}.png`);
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); flash("Image export failed"); };
    img.src = url;
  }
  const flash = (msg, ms = 1400) => { setToast(msg); setTimeout(() => setToast(""), ms); };
  // clipboard needs a secure context (https / localhost) — on a plain-http LAN
  // URL navigator.clipboard is absent, so fall back to execCommand and never
  // claim "copied" unless a copy actually happened
  function copyToClipboard(text, okMsg) {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        flash(ok ? okMsg : "Copy failed — use Export or Share instead", ok ? 1400 : 3000);
      } catch { flash("Copy failed — use Export or Share instead", 3000); }
    };
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(() => flash(okMsg), fallback);
    else fallback();
  }
  // a #d= link that failed to parse fell back to the saved board — say so
  useEffect(() => {
    if (linkBad) flash("Couldn't read the shared drill link — showing your saved board instead", 4200);
  }, []);
  // one-time contextual tips for the gesture-only features (flagged in
  // localStorage so each shows exactly once, ever)
  const hintOnce = (key, msg) => {
    try {
      if (localStorage.getItem("hd-hint-" + key)) return;
      localStorage.setItem("hd-hint-" + key, "1");
    } catch { return; }   // private mode — skip rather than nag every session
    flash(msg, 3600);
  };
  useEffect(() => {
    if (popup?.type !== "piece") return;
    const p = pieces.find(q => q.id === popup.id);
    if (p && p.kind === "player" && p.path?.length)
      hintOnce("dbltap-point", "Tip: double-tap the route line to add a point");
  }, [popup?.type, popup?.id]);
  function copyMd() { copyToClipboard(toMarkdown(), "Markdown copied"); }
  // copy the drill text from the editor to the clipboard
  function copyText() { copyToClipboard(textDraft, "Text copied"); }
  // share the drill (native share sheet where available, else copy the markdown)
  function shareDrill() {
    const md = toMarkdown();
    if (navigator.share) {
      navigator.share({ title: (drillTitle || "Drill").trim(), text: md }).catch(() => {});
    } else {
      copyToClipboard(md, "Markdown copied");
    }
  }
  // build a link to the standalone preview page with the current drill encoded in
  // the URL hash (matches the preview page's #d= URL-safe base64 format)
  function previewLink() {
    const dsl = serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems);
    const enc = btoa(unescape(encodeURIComponent(dsl)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = new URL("drill-preview.html", window.location.href).href + "#d=" + enc;
    if (navigator.share) navigator.share({ title: (drillTitle || "Drill").trim(), url }).catch(() => {});
    else copyToClipboard(url, "Preview link copied");
  }
  // open a clean, self-contained print sheet (diagram + notes + inventory +
  // steps) in a new window and offer to print it. Reuses the same DSL→SVG
  // renderer and markdown helpers as the standalone preview page.
  function printSheet() {
    const dsl = serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems);
    const svg = drillSvg(dsl);
    const title = (drillTitle || "Drill").trim();
    const rows = deriveInventory(pieces, drillItems).filter(r => !r.hide);
    const stepRows = (drillSteps.length ? resolveSteps().filter(s => s.resolved).slice().sort((a, b) => a.t - b.t) : buildSteps())
      .filter(s => (s.text || "").trim());
    const invHtml = rows.length
      ? `<table class="inv"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>`
        + rows.map(r => `<tr><td>${mdEscape(r.label)}</td><td>${r.count}</td></tr>`).join("") + `</tbody></table>`
      : "";
    const stepsHtml = stepRows.length
      ? `<ol class="steps">` + stepRows.map(s => `<li>${mdInline(mdEscape(s.text))}</li>`).join("") + `</ol>` : "";
    const notesHtml = drillNotes && drillNotes.trim() ? `<div class="notes">${mdBlock(drillNotes)}</div>` : "";
    const descHtml = drillDesc && drillDesc.trim() ? `<p class="lede">${mdInline(mdEscape(drillDesc.trim()))}</p>` : "";
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${mdEscape(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:28px 34px 48px;color:#14202b;background:#fff;
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1{font:800 30px/1.05 "Helvetica Neue",Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:-.01em;margin:0 0 6px}
  .lede{color:#5c6b78;max-width:62ch;margin:0 0 18px}
  .diagram{border:1px solid #d6e2ea;border-radius:12px;padding:12px;margin:0 0 22px;page-break-inside:avoid;background:#eef5f9}
  .diagram svg{display:block;width:100%;height:auto}
  h2{font:700 13px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5c6b78;margin:22px 0 10px}
  .notes h1{font-size:20px;text-transform:none;letter-spacing:0;margin:14px 0 8px}
  .notes h2,.notes h3{font-size:16px;text-transform:none;letter-spacing:0;color:#14202b;margin:12px 0 6px}
  .notes p{margin:8px 0}.notes ul,.notes ol{margin:8px 0 8px 22px}.notes code,.steps code{background:#eef2f6;padding:1px 5px;border-radius:5px;font:500 13px ui-monospace,Menlo,monospace}
  table.inv{border-collapse:collapse;min-width:280px;margin:0 0 8px}
  table.inv th,table.inv td{border:1px solid #d6e2ea;padding:6px 14px;text-align:left}
  table.inv th{background:#f6fafd;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5c6b78}
  table.inv td:last-child,table.inv th:last-child{text-align:right;font-variant-numeric:tabular-nums;width:64px}
  ol.steps{margin:0 0 8px 22px;padding:0}ol.steps li{margin:5px 0}
  .bar{margin:18px 0 0}
  button{font:600 14px system-ui,sans-serif;color:#fff;background:#d7263d;border:0;border-radius:9px;padding:10px 18px;cursor:pointer}
  @media print{.bar{display:none}body{padding:0}}
</style></head><body>
  <h1>${mdEscape(title)}</h1>
  ${descHtml}
  <div class="diagram">${svg}</div>
  ${notesHtml}
  ${invHtml ? `<h2>What you need</h2>${invHtml}` : ""}
  ${stepsHtml ? `<h2>Steps</h2>${stepsHtml}` : ""}
  <div class="bar"><button onclick="window.print()">🖨 Print</button></div>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { flash("Allow pop-ups to print"); return; }
    w.document.open(); w.document.write(doc); w.document.close();
  }

  /* ----- inventory editing ----- */
  // Canonical rows persist an ITEM override only when they differ from the auto
  // count or are hidden; back to pure-auto → the entry is dropped (nothing saved).
  function setCanonItem(row, { count, hide } = {}) {
    const c = count != null ? Math.max(0, Math.round(count)) : row.count;
    const h = hide != null ? hide : row.hide;
    setDrillItems(prev => {
      const rest = prev.filter(it => it.custom || it.key !== row.key);
      const differs = c !== row.autoCount;
      if (!differs && !h) return rest;
      return [...rest, { key: row.key, ...(differs ? { count: c } : {}), ...(h ? { hide: true } : {}) }];
    });
  }
  // Custom gear rows always persist (they exist only in the DSL, not on the ice).
  function setCustomItem(row, { count, label, remove } = {}) {
    setDrillItems(prev => {
      const rest = prev.filter(it => !(it.custom && it.key === row.key));
      if (remove) return rest;
      const c = count != null ? Math.max(0, Math.round(count)) : row.count;
      const l = label != null ? label : row.label;
      return [...rest, { key: row.key, custom: true, count: c, ...(l ? { label: l } : {}) }];
    });
  }
  function addCustomItem() {
    let k = "gear", n = 1;
    while (drillItems.some(it => it.custom && it.key === k)) k = "gear" + (++n);
    // no default label — the field shows its "Gear…" placeholder so you type straight in
    setDrillItems(prev => [...prev, { key: k, custom: true, count: 1 }]);
  }
  function importTxt(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result);
      const r = parseDrill(extractDrill(txt));      // .txt or a .md with a ```drill block
      if (r.errors.length) { setTextDraft(txt); setTextError(r.errors.join("\n")); setOpenMenu("text"); return; }
      setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc); setDrillSteps(r.steps || []); setDrillNotes(r.notes || ""); setDrillItems(r.items || []); setDrillVersion(r.dslVersion); setSelectedId(null); setPopup(null);
      resetAnim(); setTextError(""); setOpenMenu(null);
      flash("Drill loaded — Undo restores the old board");
    };
    reader.readAsText(f);
    e.target.value = "";
  }
  // apply a parsed drill to the board without committing it to the autosave —
  // same preview contract as a #d= link: the saved board survives until the
  // user edits (or taps Keep on the import bar)
  function applyDrillPreview(r) {
    skipFirstSave.current = true;
    setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc);
    setDrillSteps(r.steps || []); setDrillNotes(r.notes || ""); setDrillItems(r.items || []);
    setDrillVersion(r.dslVersion); setSelectedId(null); setPopup(null);
    resetAnim();
  }
  // Anthropic API key for photo import — kept in localStorage on this device.
  // No key yet → open the settings menu with the inline key editor showing.
  function getApiKey() {
    const key = localStorage.getItem(ANTHROPIC_KEY_STORE);
    if (!key) {
      setOpenMenu("prefs"); setKeyEdit("");
      flash("Add your Claude API key to import photos", 3000);
      return null;
    }
    return key;
  }
  async function importPhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || photoBusy) return;
    const apiKey = getApiKey();
    if (!apiKey) return;
    photoAbort.current = new AbortController();
    try {
      setPhotoBusy("Reading photo…");
      const img = await prepareImage(f);
      setPhotoBusy("Transcribing with Claude… can take a minute — keep the app open");
      const result = await drillFromImage({
        apiKey, ...img, onStatus: setPhotoBusy, signal: photoAbort.current.signal,
      });
      if (result.drill) {
        const prior = serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems);
        applyDrillPreview(result.drill);
        setTextError(""); setOpenMenu(null);
        setPhotoUndo(prior);
      } else {
        // repair pass didn't converge — hand the raw text to the editor to fix
        setTextDraft(result.text); setTextError(result.errors.join("\n")); setOpenMenu("text");
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (err?.status === 401) localStorage.removeItem(ANTHROPIC_KEY_STORE);
      flash(err?.message || "Photo import failed");
    } finally {
      setPhotoBusy(null);
      photoAbort.current = null;
    }
  }
  function keepImport() {
    try { localStorage.setItem(SAVE_KEY, serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems)); }
    catch { /* storage full / disabled */ }
    setPhotoUndo(null);
  }
  function discardImport() {
    const r = parseDrill(photoUndo);
    if (!r.errors.length) applyDrillPreview(r);
    setPhotoUndo(null);
  }

  /* ----- render helpers ----- */
  // `flat` = draw with plain rink-unit widths (used by the loupe, which has its
  // own near-square viewBox); otherwise use screen-uniform non-scaling strokes so
  // the fill-mode stretch can't make a line thicker along one axis than the other
  // ice-coloured opaque under-stroke ("casing") for a drill line: where the line
  // crosses the rink's red/blue markings it reads as a clean channel of ice, and
  // because the casing matches the ice, the ink over it keeps its exact colour.
  // Pure vector — no filter raster, no compositing lightening.
  // T.ice, not a literal: the casing only reads as a clean channel cut through
  // the rink markings if it is EXACTLY the ice fill. Two literals would drift.
  const caseOf = st => ({ ...st, stroke: T.ice, opacity: 1,
    strokeWidth: (st.strokeWidth || 1) * 2.1 });
  function segStroke(p, s, isLast, flat) {
    const W = w => (flat ? w : sw(w)) * lineScale;   // global route line-thickness scale
    const D = d => (flat ? d : sdash(d));
    const base = { stroke: ink(p.color), fill: "none", strokeLinecap: "round", opacity: 0.78,
      ...(flat ? {} : { vectorEffect: "non-scaling-stroke" }) };
    if (p.kind !== "puck") return { ...base, strokeWidth: W(0.7) };
    if (s.mode === "pass") return { ...base, strokeWidth: W(0.7), strokeDasharray: D("2.4 1.8") };
    if (s.mode === "shot") return { ...base, strokeWidth: W(1.25) };
    return { ...base, strokeWidth: W(0.75), strokeDasharray: D("0.2 1.5") };
  }

  /* ---- action badges at waypoints ---- */
  // ACT_GAP / ACT_R (the line's gap around a badge, and the disc radius) live in
  // constants.js: the settings sheet's preview tile draws the same badge.
  // With no badge discs — whiteboard, or Action badges off — the line-gap shrinks
  // to a small central gap the arrows point into: there is nothing left to clear
  // but the waypoint itself, and a 3.4ft hole around nothing reads as a broken
  // route. This is why the pref cannot just hide the discs with CSS.
  const actGap = effActCircles ? ACT_GAP : 0.8;
  // route ends converging on one waypoint queue their arrowheads back along their
  // own lines (same idea as the shot stagger in puckPathNodes) instead of clumping
  const ARROW_CLUSTER_R = 2;      // ft: only ends that directly overlap share a stagger group
  const ARROW_STAGGER_STEP = 2.5; // ft each queued arrowhead steps back (~one chevron depth)
  const ARROW_MIN_KEEP = 2;       // ft of last leg that must survive the trim
  const ARROW_LINE_CLEAR = 1.2;   // ft a head keeps clear of any foreign route line
  // ...and the same vocabulary for the grey shot carets in puckPathNodes
  const SHOT_TIP_GAP = 6;         // ft a shot's caret stands off its landing point
  const SHOT_CLUSTER_R = 5;       // ft: only shot heads this close queue behind each other
  const SHOT_STAGGER_STEP = 9;    // ft each queued shot head steps back along its own axis
  // priority for picking the "main" action shown in a badge with several actions
  const ACT_PRI = { shot: 5, pass: 4, rim: 3, chip: 2, receive: 1, collect: 1, pickup: 1 };
  const stepActionType = st => st.role === "pickup" ? "pickup" : st.role === "receive" ? "receive"
    : st.role === "collect" ? "collect" : (st.kind || "pass");   // release/terminal → its kind
  const actionIconName = t => t === "shot" ? "net" : t === "pass" ? "pass" : t === "chip" ? "chip"
    : t === "rim" ? "rim" : "collect";   // receive / collect / pickup all = gaining the puck
  // waypoints (index → {count, type}) where a player acts on the puck. Skips the
  // standing spot (i=-1) — the player icon already sits there.
  // action waypoints on ANY route of player p — the base path (ref "") or a branch
  // (ref = colour-path). Reads the ref-aware stepsAt, so a branch shows its OWN actions.
  function routeActionWaypoints(p, segs, ref) {
    const m = new Map();
    if (p.kind !== "player" || !(segs || []).length) return m;
    for (let i = 0; i < segs.length; i++) {
      const steps = stepsAt(p, i, ref);
      if (!steps.length) continue;
      let best = null, bp = -1;
      for (const st of steps) { const t = stepActionType(st), pr = ACT_PRI[t] || 0; if (pr > bp) { bp = pr; best = t; } }
      m.set(i, { count: steps.length, type: best });
    }
    return m;
  }
  function actionWaypoints(p) { return routeActionWaypoints(p, p.path, ""); }
  // draw, at each action waypoint: the incoming end-mark (chevron, or ‖ when the
  // player stops there) plus a circular badge with the main action's icon and, if
  // several actions land there, a count. The route's segment trims leave the gaps.
  // the shared route end-mark: an open chevron, or a ‖ stop mark. Drawn rink-scaled
  // in the stretch-cancelling frame so a route's END and an ACTION-CIRCLE entry look
  // identical — same shape, weight, and scaling.
  function routeMark(key, endPt, ang, stop, color, opacity = 1) {
    const fx = iconXf({ x: endPt.x, y: endPt.y, a: ang });
    // the whole mark scales with the line-thickness setting (like SVG's native
    // stroke-width marker units), anchored on the tip so it stays at the line's end
    return (
      <g key={key} transform={fx.t} pointerEvents="none" opacity={opacity}>
        <g transform={lineScale !== 1 ? `scale(${lineScale})` : undefined}>
          {stop
            // ‖ stop mark: the incoming line ends at the FIRST bar (the line's end);
            // the second bar sits just PAST it, so the line doesn't run through both
            ? <path d="M 0 -2.4 L 0 2.4 M 1.5 -2.4 L 1.5 2.4" fill="none" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
            : <path d="M -3.0 -1.85 L 0 0 L -3.0 1.85" fill="none" stroke={color} strokeWidth={1.0} strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      </g>
    );
  }
  // a round action circle: opaque white disc, colour-stroked, with an icon (counter-
  // rotated to read upright under rink rotation) and an optional count bubble. Shared
  // by base-route action marks, reaction-light branch badges, and reaction-fork ends,
  // so every action circle in the app is identical.
  // the little filled disc with a bold number. One tally style, shared by the action
  // circles and by a merged shot mark, so they can't drift apart.
  const tallyBubble = (n, r, fill, ink) => (<>
    <circle cx={0} cy={0} r={r} fill={fill} />
    <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={r * 1.4}
      fontWeight={800} fill={ink} style={{ fontFamily: "system-ui, sans-serif" }}>{n}</text>
  </>);
  function iconBadge(pt, iconName, color, key, opacity = 1, count = 0, dy = 0) {
    const cfx = iconXf({ x: pt.x, y: pt.y, a: 0 });
    return (
      <g key={key} transform={cfx.t + (dy ? ` translate(0 ${dy})` : "")} pointerEvents="none" opacity={opacity}>
        <circle cx={0} cy={0} r={ACT_R} fill="#fff" stroke={color} strokeWidth={0.5} />
        <g transform={`rotate(${-cfx.th})`}>
          <g style={{ color }} transform={`scale(0.178) translate(-12 -12)`}
            fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            {ICONS[iconName]}
          </g>
          {count > 1 && (
            <g transform={`translate(${ACT_R * 0.74} ${-ACT_R * 0.74})`}>
              {tallyBubble(count, 1.55, color, "#fff")}
            </g>
          )}
        </g>
      </g>
    );
  }
  // fork action → its action-circle icon (skate has none — its end is a carat/stop)
  const forkActionIcon = a => a === "shoot" ? "net" : a === "pass" ? "pass" : a === "chip" ? "chip" : a === "rim" ? "rim" : null;
  // action circles (+ incoming end-mark) at every action waypoint of a route. Works on
  // any route's segments + origin, so base routes and branch routes render identically.
  function routeActionMarks(segs, origin, acts, color, bentPts, keyPrefix = "") {
    if (!acts || !acts.size) return null;
    const n = segs.length, els = [];
    for (const [i, info] of acts) {
      const s = segs[i];
      const prev = i >= 1 ? { x: segs[i - 1].x, y: segs[i - 1].y } : origin;
      let tx, ty;
      if (i === n - 1 && bentPts && bentPts.length >= 2) {
        const b = bentPts[Math.max(0, bentPts.length - 4)]; tx = s.x - b.x; ty = s.y - b.y;
      } else {
        if (bentPts && bentPts.length >= 2) {
          // detoured route: take the incoming tangent from the bent polyline near
          // this waypoint, so the carat aligns with the curve actually drawn
          let j = 0, best = Infinity;
          for (let k = 0; k < bentPts.length; k++) {
            const dd = (bentPts[k].x - s.x) ** 2 + (bentPts[k].y - s.y) ** 2;
            if (dd < best) { best = dd; j = k; }
          }
          const b = bentPts[Math.max(0, j - 3)];
          tx = s.x - b.x; ty = s.y - b.y;
        } else { tx = 0; ty = 0; }
        if (Math.hypot(tx, ty) < 1e-4) {
          // follow the CURVE: the visible line is ARC-trimmed by actGap, and on a
          // hooked leg that end is nowhere near a straight step back along the
          // end tangent — so trim identically and sit the carat exactly where
          // the drawn line stops, pointing along its final run
          const tr = trimSegEnd(prev, s, actGap, strokeAR);
          if (tr && tr.seg) {
            const tip0 = { x: tr.seg.x, y: tr.seg.y };
            const back = arrivalBack("main", tip0.x, tip0.y);
            const tr2 = back ? trimSegEnd(prev, s, actGap + back, strokeAR) : tr;
            const fin = (tr2 && tr2.seg) ? tr2.seg : tr.seg;
            const near2 = evalSeg(prev, fin, 0.94);
            let dx = fin.x - near2.x, dy = fin.y - near2.y;
            if (Math.hypot(dx, dy) < 1e-4) { dx = s.x - prev.x; dy = s.y - prev.y; }
            els.push(routeMark(`${keyPrefix}am${i}`, { x: fin.x, y: fin.y },
              (Math.atan2(dy, dx) * 180) / Math.PI, s.endStop, color));
            if (effActCircles) els.push(iconBadge({ x: s.x, y: s.y }, actionIconName(info.type), color, `${keyPrefix}ab${i}`, 1, info.count));
            continue;
          }
          const near = evalSeg(prev, s, 0.95); tx = s.x - near.x; ty = s.y - near.y;   // near the end → carat aligns with the incoming run
          if (Math.hypot(tx, ty) < 1e-4) { tx = s.x - prev.x; ty = s.y - prev.y; }
        }
      }
      const tl = Math.hypot(tx, ty) || 1, ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      // incoming end-mark, just outside the round badge — the SAME glyph as a route
      // end. Registers its natural tip so same-direction arrivals queue behind it.
      const mp0 = gmMove(s.x, s.y, -tx / tl, -ty / tl, actGap);
      const back = arrivalBack("main", mp0.x, mp0.y);
      const mp = back ? gmMove(s.x, s.y, -tx / tl, -ty / tl, actGap + back) : mp0;
      els.push(routeMark(`${keyPrefix}am${i}`, mp, ang, s.endStop, color));
      // no disc — the arrow just stops, pointing into the gap
      if (effActCircles) els.push(iconBadge({ x: s.x, y: s.y }, actionIconName(info.type), color, `${keyPrefix}ab${i}`, 1, info.count));
    }
    return <g>{els}</g>;
  }
  function renderActionMarks(p, bentPts, acts) { return routeActionMarks(p.path, { x: p.x, y: p.y }, acts, ink(p.color), bentPts, ""); }
  // the marks of a GHOST catch waypoint (a led pass's computed mid-curve catch):
  // the same incoming carat + receive badge as a real action circle, slightly
  // ghosted, with NO hit area — the spot is derived from the pass plan, so it
  // can't be grabbed, moved, or edited.
  const GHOST_OP = 0.55;
  // Number a receiver's waypoints on the ice. A pass step's "Catch:" list offers
  // "@1, @2, @3…", which names points the coach has no way to identify on the
  // board — so while that step is on screen, its target wears the same numbers.
  // Base route only: the list also reaches a receiver's reaction forks ("↳ ref
  // @2"), and those would need per-branch badges to stay unambiguous.
  function renderWpNumbers(p) {
    const route = p.path || [];
    if (!route.length) return null;
    const col = ink(p.color);
    return (
      <g key={`wpn-${p.id}`} pointerEvents="none">
        {route.map((s, i) => {
          const cfx = iconXf({ x: s.x, y: s.y, a: 0 });
          return (
            <g key={i} transform={cfx.t}>
              <circle cx={0} cy={0} r={2.2} fill={T["surface-panel"]} stroke={col} strokeWidth={0.5} />
              {/* un-rotate so the digit reads upright whatever the sheet does */}
              <g transform={`rotate(${-cfx.th})`}>
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={2.9}
                  fontWeight={800} fill={col} style={{ fontFamily: "system-ui, sans-serif" }}>{i + 1}</text>
              </g>
            </g>
          );
        })}
      </g>
    );
  }

  function renderLedCatchMarks(p, ledCs) {
    if (!ledCs || !ledCs.length) return null;
    const els = [];
    ledCs.forEach((e, k) => {
      const seg = p.path[e.j];
      if (!seg) return;
      const prev = e.j >= 1 ? { x: p.path[e.j - 1].x, y: p.path[e.j - 1].y } : { x: p.x, y: p.y };
      const near = evalSeg(prev, seg, Math.max(0, e.t - 0.06));
      let tx = e.x - near.x, ty = e.y - near.y;
      if (Math.hypot(tx, ty) < 1e-4) { tx = seg.x - prev.x; ty = seg.y - prev.y; }
      const tl = Math.hypot(tx, ty) || 1, ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      const mp0 = gmMove(e.x, e.y, -tx / tl, -ty / tl, actGap);
      const back = arrivalBack("main", mp0.x, mp0.y);
      const mp = back ? gmMove(e.x, e.y, -tx / tl, -ty / tl, actGap + back) : mp0;
      els.push(routeMark(`lcm-${p.id}-${k}`, mp, ang, false, ink(p.color), GHOST_OP));
      if (effActCircles) els.push(iconBadge({ x: e.x, y: e.y }, "collect", p.color, `lcb-${p.id}-${k}`, GHOST_OP));
    });
    return els.length ? <g>{els}</g> : null;
  }

  // an action circle at a light-reaction branch point: the same round badge as a
  // puck-action circle, but stamped with a BRAIN glyph, since the waypoint's job is
  // "read the situation, then react" — a decision point where routes fork out (any
  // condition: cue, possession, another player's route, …). Drawn opaque in the
  // stretch-cancelling frame; the glyph counter-rotates to stay upright.
  // `lift` = the branch departs from a waypoint that ALSO carries a puck-action badge
  // → shift the brain up to sit tangent above it, so the action circle (and its count
  // bubble) stays readable instead of hiding underneath.
  function reactionBadge(pt, color, key, lift = false) {
    if (!effActCircles) return null;   // no discs: branches just fan out of the gap
    return iconBadge(pt, "brain", color, key, 1, 0, lift ? -(ACT_R * 2 + 0.7) : 0);
  }

  // Where p's end mark actually renders once its stagger pull-back is applied —
  // the endpoint of the last leg trimmed by `gap` (the same trim the visible line
  // and renderArrow use, so all three agree). Shared by the stagger's clearance
  // pass, the arrowhead grab alias in renderHandles, and waypointUnderTap.
  function staggeredEndPt(p, gap) {
    const n = p.path.length;
    const last = p.path[n - 1];
    if (!last) return null;
    if (!(gap > 0)) return { x: last.x, y: last.y };
    const prev = n >= 2 ? segEnd(p, n - 2) : { x: p.x, y: p.y };
    const t = trimSegEnd(prev, last, gap, strokeAR);
    return t ? { x: t.seg.x, y: t.seg.y } : { x: last.x, y: last.y };
  }

  // Several route ends converging on one waypoint would stamp their end marks on
  // the exact same spot — group ends within ARROW_CLUSTER_R and pull each mark
  // back along its OWN line by a spaced interval so the heads queue up readably
  // (the same de-confliction puckPathNodes does for converging shot heads). Shortest
  // last leg keeps the true endpoint; the pull-back is clamped so a short leg
  // never trims past its own start. A second pass then RECESSES any head sitting
  // on a foreign route's line until it clears it. Cosmetic only — ref paths/
  // timing untouched.
  function routeEndStagger() {
    const ends = [];
    for (const p of pieces) {
      const n = (p.path || []).length;
      if (!n) continue;
      // mirror renderArrow's early exits so only ends that DRAW a plain end mark
      // cluster: badge-marked ends and branch-point ends place their own carats
      if (p.kind === "player" && actionWaypoints(p).has(n - 1)) continue;
      if ((p.forks || []).some(f => f.path && f.path.length && (f.at != null ? f.at : n - 1) === n - 1)) continue;
      const last = p.path[n - 1];
      const prev = n >= 2 ? segEnd(p, n - 2) : { x: p.x, y: p.y };
      ends.push({ p, id: p.id, x: last.x, y: last.y,
        len: Math.hypot((last.x - prev.x) * gmSar, (last.y - prev.y) / gmSar) });
    }
    const clusters = [];
    for (const e of ends) {
      let c = clusters.find(c => Math.hypot(c.seed.x - e.x, c.seed.y - e.y) <= ARROW_CLUSTER_R);
      if (!c) { c = { seed: e, list: [] }; clusters.push(c); }
      c.list.push(e); e.cluster = c;
    }
    const out = {};
    for (const c of clusters) {
      if (c.list.length < 2) continue;
      c.list.sort((a, b) => a.len - b.len).forEach((e, i) => {
        if (i) out[e.id] = Math.min(i * ARROW_STAGGER_STEP, Math.max(0, e.len - ARROW_MIN_KEEP));
      });
    }
    // clearance pass: a head landing on a FOREIGN route's line recesses further
    // back along its own line until it clears. Same-cluster lines are excluded —
    // they converge on the shared point by definition, and the along-line stagger
    // above is their de-confliction. Distances in gm space so clearance reads the
    // same in every direction under the fill-mode stretch. If a head can never
    // clear (a near-parallel foreign line), it keeps its base spot.
    if (ends.length) {
      const lines = pieces.filter(q => (q.path || []).length).map(q => {
        const pts = [{ x: q.x * gmSar, y: q.y / gmSar }];
        let prev = { x: q.x, y: q.y };
        for (const s of q.path) {
          for (let k = 1; k <= 12; k++) { const t = evalSeg(prev, s, k / 12); pts.push({ x: t.x * gmSar, y: t.y / gmSar }); }
          prev = { x: s.x, y: s.y };
        }
        return { id: q.id, pts };
      });
      const segd = (P, a, b) => {   // point-to-segment distance (gm space)
        const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
        const t = L2 ? Math.max(0, Math.min(1, ((P.x - a.x) * vx + (P.y - a.y) * vy) / L2)) : 0;
        return Math.hypot(P.x - (a.x + vx * t), P.y - (a.y + vy * t));
      };
      for (const e of ends) {
        const own = new Set(e.cluster.list.map(m => m.id));
        const foreign = lines.filter(l => !own.has(l.id));
        if (!foreign.length) continue;
        const maxGap = Math.max(0, e.len - ARROW_MIN_KEEP);
        let gap = out[e.id] || 0, clearAt = null;
        for (let tries = 0; tries < 12; tries++) {
          const hp = staggeredEndPt(e.p, gap);
          const P = { x: hp.x * gmSar, y: hp.y / gmSar };
          const hit = foreign.some(l => {
            for (let k = 1; k < l.pts.length; k++) if (segd(P, l.pts[k - 1], l.pts[k]) < ARROW_LINE_CLEAR) return true;
            return false;
          });
          if (!hit) { clearAt = gap; break; }
          if (gap >= maxGap) break;
          gap = Math.min(maxGap, gap + 0.75);
        }
        if (clearAt != null && clearAt > 0) out[e.id] = clearAt;
      }
    }
    return out;
  }

  // Arrowhead at a route's end, drawn in the stretch-cancelling icon frame so it
  // stays a clean triangle (SVG markers get sheared by the fill-mode stretch).
  // `gap` (rink ft) pulls the mark back along the line — the converging-waypoint
  // stagger; the visible line is trimmed by the same amount at the call site.
  function renderArrow(p, bentPts, acts, gap = 0) {
    const n = p.path.length;
    if (!n) return null;
    if (acts && acts.has(n - 1)) return null;   // an action badge marks this end instead (with its own incoming carat)
    // a route whose end is a BRANCH POINT still gets the incoming chevron — pulled
    // back to the reaction badge's ring, like the carat outside an action circle —
    // so the leg visibly points INTO the decision instead of merging with it
    const branchAtEnd = (p.forks || []).some(f => f.path && f.path.length && (f.at != null ? f.at : n - 1) === n - 1);
    // anchor the tip at the drawn line's END and point it along that line's end
    // tangent — use the detoured (bent) polyline when there is one so the head
    // lines up with the curve actually shown, not the raw path
    let endPt, tx, ty;
    if (bentPts && bentPts.length >= 2) {
      const pts = gap > 0 ? trimPolyEnd(bentPts, gap, strokeAR) : bentPts;
      endPt = pts[pts.length - 1];
      const b = pts[Math.max(0, pts.length - 4)];
      tx = endPt.x - b.x; ty = endPt.y - b.y;
    } else {
      let last = p.path[n - 1];
      const prev = n >= 2 ? segEnd(p, n - 2) : { x: p.x, y: p.y };
      if (gap > 0) {
        // the SAME trim the visible line got, so head and line end agree
        const t = trimSegEnd(prev, last, gap, strokeAR);
        if (t) last = t.seg;
      }
      endPt = { x: last.x, y: last.y };
      const near = evalSeg(prev, last, 0.97);   // sample the TRUE end tangent so the carat lines up with the line's final run
      tx = last.x - near.x; ty = last.y - near.y;
      if (Math.hypot(tx, ty) < 1e-4) {               // degenerate (control on the endpoint)
        if (last.type === "C") { tx = last.x - last.c2x; ty = last.y - last.c2y; }
        else if (last.type === "Q") { tx = last.x - last.cx; ty = last.y - last.cy; }
        else { tx = last.x - prev.x; ty = last.y - prev.y; }
      }
    }
    if (!tx && !ty) return null;
    const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
    const tl = Math.hypot(tx, ty) || 1;
    // natural tip first (badge stand-off for a branch point, the endpoint itself
    // otherwise), THEN the queue-back for same-direction arrivals already there
    const base = branchAtEnd ? actGap : 0;
    const tip0 = base ? gmMove(endPt.x, endPt.y, -tx / tl, -ty / tl, base) : endPt;
    const back = arrivalBack("main", tip0.x, tip0.y);
    const pt2 = back ? gmMove(endPt.x, endPt.y, -tx / tl, -ty / tl, base + back) : tip0;
    return routeMark(`arw-${p.id}`, pt2, ang, branchAtEnd ? false : !!(p.path[n - 1] && p.path[n - 1].endStop), ink(p.color));
  }
  // end point + heading (deg) of a route path array that begins at `start`; null
  // if empty or degenerate. Shared by base routes and reaction forks.
  function pathEndArrow(pathArr, start) {
    const n = pathArr.length;
    if (!n) return null;
    const last = pathArr[n - 1];
    const prev = n >= 2 ? { x: pathArr[n - 2].x, y: pathArr[n - 2].y } : start;
    const endPt = { x: last.x, y: last.y };
    const near = evalSeg(prev, last, 0.9);
    let tx = last.x - near.x, ty = last.y - near.y;
    if (Math.hypot(tx, ty) < 1e-4) {               // degenerate (control on the endpoint)
      if (last.type === "C") { tx = last.x - last.c2x; ty = last.y - last.c2y; }
      else if (last.type === "Q") { tx = last.x - last.cx; ty = last.y - last.cy; }
      else { tx = last.x - prev.x; ty = last.y - prev.y; }
    }
    if (!tx && !ty) return null;
    return { endPt, ang: (Math.atan2(ty, tx) * 180) / Math.PI };
  }

  function renderHandles(p, yf = yFix, fork = null) {
    const hd = (cx, cy, r, props) => hdot(cx, cy, r, props, yf);
    if (!editing || p.id !== selectedId || tool === "draw") return null;
    const rp = routePiece(p, fork);           // fork ? branch-origin route piece : p
    const route = rp.path;
    // colour the fork's handles by its cue colour so overlapping routes stay legible
    const dotFill = fork || T["ice-select"], dotStroke = fork ? "#0b1116" : "#7a5c00";
    // the selected waypoint = the leg/point popup that's open (tapping the anchor
    // opens a "point" popup, the line a "line" popup — both carry its seg). Its
    // handles show only for it, not every waypoint. A handle being dragged stays
    // active via its `wp` (owning waypoint) so it can't collapse to a dot mid-drag.
    // Only this route's handles react (drag/popup `fork` must match).
    const d = drag.current;
    const activeWp = d && d.id === p.id && forkEq(d.fork, fork) && (d.wp != null || d.seg != null || d.line != null)
      ? (d.wp != null ? d.wp : d.seg != null ? d.seg : d.line)
      : popup && (popup.type === "line" || popup.type === "point") && popup.id === p.id && forkEq(popup.fork, fork) ? popup.seg : null;
    // the player/route START is a curve point too — its departure tangent aims the
    // launch. Expose it whenever the piece itself is selected, so you don't have to
    // open the NEXT waypoint just to adjust the starting point's angle.
    const originActive = popup && popup.type === "piece" && popup.id === p.id && forkEq(popup.fork, fork);
    const els = [];
    // grab-target sizing (rink feet). Touch pointers get ~1.4× fatter targets so a
    // fingertip clears Apple's ~44px min; a mouse keeps the tighter targets. The
    // anchor also gets a small always-on-top CORE so the dead-centre of a waypoint
    // reliably grabs the POINT, never an overlapping tangent handle or the route
    // line — the fix for "grabbing off-centre from the waypoint" on desktop.
    const G = coarsePtr ? 1.4 : 1;
    const ANCHOR_R = 4 * G, DOT_R = 3.6 * G, CTRL_R = 4 * G, CORE_R = coarsePtr ? 2.6 : 2;
    // a draggable tangent control, with a dashed leash back to its waypoint anchor.
    const ctrlPt = (key, cx, cy, kind, seg, wp, ax, ay) => {
      const lkOff = (p.lock || route[wp]?.lock) && !lockedSelectable;   // locked point: click-through
      els.push(<line key={key + "l"} x1={ax} y1={ay} x2={cx} y2={cy} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
      els.push(hd(cx, cy, 1.5, { key, fill: "#fff", stroke: "#5b7d9e", strokeWidth: 0.4, pointerEvents: "none" }));
      els.push(hd(cx, cy, CTRL_R, { key: key + "h", fill: "transparent", style: { cursor: "grab" }, pointerEvents: lkOff ? "none" : undefined,
        onPointerDown: e => handleDown(e, { kind, id: p.id, seg, wp, ...(fork ? { fork } : {}) }) }));
    };
    route.forEach((s, i) => {
      // a locked waypoint (or a waypoint of a locked piece) reads in a muted
      // "locked" colour and — unless locked items are selectable — is click-through
      const lk = !!(p.lock || s.lock);
      const wFill = lk ? "#8792a0" : dotFill, wStroke = lk ? "#2b333d" : dotStroke;
      const lkOff = lk && !lockedSelectable;
      if (i === activeWp) {
        // full anchor grab: a circle for a linked (smooth/sym) point, a square for
        // a corner — the vector-editor convention, so the point type reads on-ice
        if (s.join === "smooth" || s.join === "sym")
          els.push(hd(s.x, s.y, 1.6, { key: `a${i}`, fill: wFill, stroke: wStroke, strokeWidth: 0.35, pointerEvents: "none" }));
        else
          els.push(<rect key={`a${i}`} x={s.x - 1.4} y={s.y - 1.4 * yf} width={2.8} height={2.8 * yf}
            fill={wFill} stroke={wStroke} strokeWidth={0.35} pointerEvents="none" />);
        els.push(hd(s.x, s.y, ANCHOR_R, { key: `ah${i}`, fill: "transparent", style: { cursor: "grab" }, pointerEvents: lkOff ? "none" : undefined,
          onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: i, wp: i, ...(fork ? { fork } : {}) }) }));
        // incoming tangent: this leg's control nearest waypoint i
        if (s.type === "C") ctrlPt(`ic${i}`, s.c2x, s.c2y, "c2", i, i, s.x, s.y);
        else if (s.type === "Q") ctrlPt(`iq${i}`, s.cx, s.cy, "q", i, i, s.x, s.y);
        // outgoing tangent: the next leg's control nearest waypoint i
        const nx = route[i + 1];
        if (nx && nx.type === "C") ctrlPt(`oc${i}`, nx.c1x, nx.c1y, "c1", i + 1, i, s.x, s.y);
        else if (nx && nx.type === "Q") ctrlPt(`oq${i}`, nx.cx, nx.cy, "q", i + 1, i, s.x, s.y);
        // priority core: painted AFTER the tangents so the centre always wins the
        // grab, even when a short handle's control sits on top of the anchor.
        if (!lkOff) els.push(hd(s.x, s.y, CORE_R, { key: `ac${i}`, fill: "transparent", style: { cursor: "grab" },
          onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: i, wp: i, ...(fork ? { fork } : {}) }) }));
      } else {
        // every other waypoint is just a small (still grabbable) dot
        els.push(hd(s.x, s.y, 0.9, { key: `am${i}`, fill: wFill, stroke: wStroke, strokeWidth: 0.3, pointerEvents: "none" }));
        els.push(hd(s.x, s.y, DOT_R, { key: `amh${i}`, fill: "transparent", style: { cursor: "grab" }, pointerEvents: lkOff ? "none" : undefined,
          onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: i, wp: i, ...(fork ? { fork } : {}) }) }));
      }
    });
    // the staggered end ARROWHEAD doubles as a grab target for the last waypoint —
    // when the head is pulled back off the true endpoint (converging-waypoint
    // stagger), grabbing/tapping the visual you see still edits that endpoint
    if (!fork && route.length && endStagger[p.id]) {
      const li = route.length - 1, ls = route[li];
      const lkOffA = (p.lock || ls.lock) && !lockedSelectable;
      const hp = staggeredEndPt(p, endStagger[p.id]);
      if (hp && !lkOffA) els.push(hd(hp.x, hp.y, DOT_R, { key: "arwgrab", fill: "transparent", style: { cursor: "grab" },
        onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: li, wp: li }) }));
    }
    // while a leg popup is open ("Add point here"), ghost the would-be waypoint —
    // a dashed anchor at the tap's projection onto the curve, where the split
    // lands. Hidden the moment a point or curve handle is being dragged: the
    // hand is busy re-shaping the leg, so the add-target is just noise there.
    if (popup && popup.type === "line" && popup.id === p.id && forkEq(popup.fork, fork) && popup.pt && route[popup.seg] && !drag.current) {
      const gs = route[popup.seg];
      const gPrev = segEnd(rp, popup.seg - 1);
      const g = evalSeg(gPrev, gs, nearestT(gPrev, gs, popup.pt));
      els.push(hd(g.x, g.y, 1.6, { key: "ghostwp", fill: "none", stroke: dotFill, strokeWidth: 0.5,
        strokeDasharray: "1 1", opacity: 0.95, pointerEvents: "none" }));
      els.push(hd(g.x, g.y, 0.45, { key: "ghostwpc", fill: dotFill, opacity: 0.9, pointerEvents: "none" }));
    }
    // departure-angle handle at the route origin, leashed back to the piece: shown
    // when the piece is selected OR waypoint 0 is active. For a cubic it's the c1
    // control (distinct from waypoint 0's incoming c2); a quad has one shared
    // control, already drawn at waypoint 0 when it's active — so only add it here
    // for the piece-selected case to avoid a duplicate dot.
    const s0 = route[0];
    if (s0 && s0.type === "C" && (originActive || activeWp === 0))
      ctrlPt(`sc0`, s0.c1x, s0.c1y, "c1", 0, 0, rp.x, rp.y);
    else if (s0 && s0.type === "Q" && originActive && activeWp !== 0)
      ctrlPt(`sq0`, s0.cx, s0.cy, "q", 0, 0, rp.x, rp.y);
    return <g>{els}</g>;
  }

  // rotation ring + knob for a selected stationary player (touch-friendly);
  // the knob sits at the current facing angle, radius 7 ft
  function renderRotateHandle(p, yf = yFix) {
    const hd = (cx, cy, r, props) => hdot(cx, cy, r, props, yf);
    const rotatable = p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || p.kind === "stick" || p.kind === "light" || (p.kind === "player" && !p.path.length);
    if (!editing || tool === "draw" || !rotatable) return null;
    const a = ((p.facing || 0) * Math.PI) / 180;
    const R = 7;
    // the knob's y-offset is pre-compensated so it sits on the round ring
    const kx = p.x + Math.cos(a) * R, ky = p.y + Math.sin(a) * R * yf;
    return (
      <g>
        {hd(p.x, p.y, R, { fill: "none", stroke: T["ice-select"], strokeWidth: 0.25, strokeDasharray: "1 1", opacity: 0.75, pointerEvents: "none" })}
        {hd(kx, ky, 1.6, { fill: T["ice-select"], stroke: "#7a5c00", strokeWidth: 0.35, pointerEvents: "none" })}
        {hd(kx, ky, 4.2, { fill: "transparent", style: { cursor: "grab" }, onPointerDown: e => handleDown(e, { kind: "rotate", id: p.id, offset: 0 }) })}
      </g>
    );
  }

  // Release handles for a hard rim / chip. A terminal release shows a handle
  // sitting at the puck's landing point: drag it to set BOTH the direction and
  // the distance of the release; the dashed path previews where the puck goes.
  // (Legacy rim/chip transfers keep a simple direction-only aim ring.)
  function renderAim(p, force, yf = yFix) {
    const hd = (cx, cy, r, props) => hdot(cx, cy, r, props, yf);
    if (!editing || tool === "draw" || p.kind !== "player") return null;
    // prefer the selected puck's handle when p carries more than one
    const pk = pieces.find(q => q.kind === "puck" && q.id === selectedId && puckChain(q).includes(p.id))
      || pieces.find(q => q.kind === "puck" && puckChain(q).includes(p.id));
    if (!pk) return null;
    // only show the release/aim handle when this player (or its puck) is selected
    // (the loupe passes force=true so the chip/rim path always shows while aiming,
    // even if grabbing the small handle dropped the selection on touch)
    if (!force && p.id !== selectedId && pk.id !== selectedId) return null;
    const chain = puckChain(pk);
    const ts = pk.transfers || [];
    const last = chain.length - 1;
    const out = [];

    const defDirAt = at => {
      // a route-less player releases along its facing; otherwise follow the route
      if (!p.path.length) return ((p.facing || 0) * Math.PI) / 180;
      const here = at < 0 ? { x: p.x, y: p.y } : segEnd(p, at);
      const nextPt = p.path[at + 1] ? segEnd(p, at + 1) : null;
      return nextPt
        ? Math.atan2(nextPt.y - here.y, nextPt.x - here.x)
        : (() => { const pv = at - 1 < 0 ? { x: p.x, y: p.y } : segEnd(p, at - 1); return Math.atan2(here.y - pv.y, here.x - pv.x); })();
    };

    // terminal release handle (dir + distance) for chip / hard rim. The grab
    // knob sits REL_MULT× closer than the puck's real landing, so a compact drag
    // near the player sets a long release; the dashed path shows where it lands.
    const release = (at, kind, aim, dist, term) => {
      const here = at < 0 ? { x: p.x, y: p.y } : segEnd(p, at);
      const ang = aim != null ? (aim * Math.PI) / 180 : defDirAt(at);
      let path;
      try {
        path = kind === "chip"
          ? boards.slide(here.x, here.y, Math.cos(ang), Math.sin(ang), dist)
          : boards.rimAround(here, dist, aim);
      } catch { path = [here]; }
      const end = path[path.length - 1] || here;
      // the grab knob sits on the actual travel path at 1/REL_MULT of its length,
      // so a rim's handle follows the boards and stays inside the rink (clamped as
      // a safety) instead of projecting straight into a corner
      const hpt = path.length > 1 ? samplePoly(path, 1 / REL_MULT)
        : { x: here.x + Math.cos(ang) * dist / REL_MULT, y: here.y + Math.sin(ang) * dist / REL_MULT };
      const hc = boards.clampInside(hpt.x, hpt.y);
      const hx = hc.x, hy = hc.y;
      const col = "#3a8dff";
      out.push(
        <g key={`rel-${p.id}-${kind}-${at}`}>
          <polyline points={path.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col}
            strokeWidth={0.4} strokeDasharray="2 1.4" opacity={0.7} pointerEvents="none" />
          {hd(end.x, end.y, 1.4, { fill: "none", stroke: col, strokeWidth: 0.35, opacity: 0.7, pointerEvents: "none" })}
          {hd(here.x, here.y, 1, { fill: col, opacity: 0.8, pointerEvents: "none" })}
          {hd(hx, hy, 1.9, { fill: col, stroke: "#fff", strokeWidth: 0.4, pointerEvents: "none" })}
          {hd(hx, hy, 5, { fill: "transparent", style: { cursor: "grab" },
            onPointerDown: e => handleDown(e, { kind: "release", pkId: pk.id, origin: here, term, relKind: kind }) })}
        </g>
      );
    };
    // one release handle per rim/chip terminal this player performs (own actor + lineage)
    for (const t of (pk.terminals || [])) {
      if (t.kind !== "chip" && t.kind !== "rim") continue;
      const actor = t.by || terminalActor(pk, pieces, t.ref || "");
      if (actor !== p.id) continue;
      const defDist = t.kind === "rim" ? REL_DEFAULT.rimAt : REL_DEFAULT.chipAt;
      release(t.at, t.kind, t.aim ?? null, t.dist != null ? t.dist : defDist, { kind: t.kind, at: t.at, ref: t.ref, by: t.by });
    }

    // legacy transfer chip/rim: direction-only aim ring
    const R = 8;
    ts.forEach((tr, s) => {
      if (!((tr.kind === "chip" || tr.kind === "rim") && chain[s] === p.id)) return;
      const here = tr.at < 0 ? { x: p.x, y: p.y } : segEnd(p, tr.at);
      const a = tr.aim != null ? (tr.aim * Math.PI) / 180 : defDirAt(tr.at);
      const kx = here.x + Math.cos(a) * R, ky = here.y + Math.sin(a) * R * yf;
      const col = tr.aim != null ? "#3a8dff" : "#9fb4c6";
      out.push(
        <g key={`aim-${p.id}-${s}`}>
          {hd(here.x, here.y, R, { fill: "none", stroke: col, strokeWidth: 0.25, strokeDasharray: "1 1", opacity: 0.7, pointerEvents: "none" })}
          <line x1={here.x} y1={here.y} x2={kx} y2={ky} stroke={col} strokeWidth={0.35} opacity={0.75} pointerEvents="none" />
          {hd(kx, ky, 1.6, { fill: col, stroke: "#12233a", strokeWidth: 0.35, pointerEvents: "none" })}
          {hd(kx, ky, 4.2, { fill: "transparent", style: { cursor: "grab" },
            onPointerDown: e => handleDown(e, { kind: "aim", pkId: pk.id, target: { stage: s }, origin: here }) })}
        </g>
      );
    });
    return out.length ? out : null;
  }

  // a movable/resizable on-ice text label, drawn undistorted (icon frame) and
  // held screen-upright. Used for standalone labels and for waypoint
  // descriptions shown in "label" mode.
  function labelNode(key, x, y, text, size, st, sel, onDown, resizeDown, hitOff = false) {
    const fx = iconXf({ x, y, a: 0 });
    const lines = String(text || " ").split("\n");
    // the icon frame bakes in ICON_SCALE (0.8), so on-ice height ≈ fs·0.8;
    // fs≈6.5 → ~5 ft tall at size 1 (readable as words on a full-sheet phone)
    const fs = 6.5 * (size || 1) / ICON_SCALE;
    const lh = fs * 1.16;
    const w = Math.max(1, ...lines.map(l => l.length)) * fs * 0.56 + fs * 0.7;
    const h = lines.length * lh + fs * 0.34;
    // st: { color, bg, bgOp, border, borderOp, textOp } — absent fields = the
    // classic sticky-note look (near-white 0.95 bg, faint ink border)
    const bgOff = st.bg === "none", bgCol = bgOff ? null : (st.bg || "#f6fbfd");
    const bgOp = st.bgOp != null ? st.bgOp : 0.95;
    const bdOff = st.border === "none", bdCol = bdOff ? null : (st.border || "#14202b");
    const bdOp = st.borderOp != null ? st.borderOp : 0.35;
    return (
      <g key={key} transform={fx.t}>
        <g transform={`rotate(${-fx.th})`}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={fs * 0.28}
            fill={bgOff ? "transparent" : bgCol} fillOpacity={bgOff ? undefined : bgOp}
            stroke={bdOff ? "none" : bdCol} strokeOpacity={bdOff ? undefined : bdOp}
            strokeWidth={bdOff ? 0 : 0.4} onPointerDown={onDown} pointerEvents={hitOff ? "none" : undefined}
            style={{ cursor: onDown ? "grab" : "default" }} />
          {sel && (
            // selection = a dashed halo OUTSIDE the box, so the label's own
            // border colour/opacity stays visible while it's being edited
            <rect x={-w / 2 - fs * 0.22} y={-h / 2 - fs * 0.22} width={w + fs * 0.44} height={h + fs * 0.44}
              rx={fs * 0.28 + fs * 0.22} fill="none" stroke={T["ice-select"]} strokeWidth={0.55}
              strokeDasharray={`${fs * 0.3} ${fs * 0.22}`} pointerEvents="none" />
          )}
          <text textAnchor="middle" fontSize={fs} fontWeight={800} fill={st.color || "#14202b"}
            opacity={st.textOp != null ? st.textOp : undefined}
            pointerEvents="none" style={{ fontFamily: "system-ui, sans-serif", userSelect: "none",
              paintOrder: "stroke", stroke: bgCol || "rgba(246,251,253,0.9)", strokeWidth: fs * 0.06,
              strokeOpacity: bgCol ? 0.9 : undefined }}>
            {lines.map((l, k) => (
              <tspan key={k} x={0} y={(k - (lines.length - 1) / 2) * lh + fs * 0.34}>{l || " "}</tspan>
            ))}
          </text>
          {sel && resizeDown && (
            <>
              <rect x={w / 2 - fs * 0.42} y={h / 2 - fs * 0.42} width={fs * 0.84} height={fs * 0.84}
                rx={fs * 0.15} fill={T["ice-select"]} stroke="#7a5c00" strokeWidth={0.3} pointerEvents="none" />
              <rect x={w / 2 - fs * 0.7} y={h / 2 - fs * 0.7} width={fs * 1.4} height={fs * 1.4}
                fill="transparent" style={{ cursor: "nwse-resize" }} onPointerDown={resizeDown} />
            </>
          )}
        </g>
      </g>
    );
  }

  // standalone label pieces + every "label"-mode waypoint description
  // freehand marker annotations: a coloured polyline in the chosen style
  const densifyPts = (pts, step) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.round(d / step));
      for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
    return out;
  };
  const wavyPts = (pts, amp, wl) => {
    const d = densifyPts(pts, 0.4); if (d.length < 3) return pts;
    let acc = 0; const out = [];
    for (let i = 0; i < d.length; i++) {
      const prev = d[Math.max(0, i - 1)], next = d[Math.min(d.length - 1, i + 1)];
      const dx = next.x - prev.x, dy = next.y - prev.y, m = Math.hypot(dx, dy) || 1;
      if (i > 0) acc += Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y);
      const edge = Math.min(1, i / 3, (d.length - 1 - i) / 3);   // taper the ends
      const off = Math.sin((acc / wl) * Math.PI * 2) * amp * edge;
      out.push({ x: d[i].x + (-dy / m) * off, y: d[i].y + (dx / m) * off });
    }
    return out;
  };
  // sample a smooth Catmull-Rom curve through a run of control points
  const smoothRun = cp => {
    if (cp.length < 3) return cp.map(q => ({ x: q.x, y: q.y }));
    const segs = catmullToBezier(cp);
    let prev = cp[0]; const out = [{ x: cp[0].x, y: cp[0].y }];
    segs.forEach(s => {
      const n = Math.max(2, Math.round(Math.hypot(s.x - prev.x, s.y - prev.y) / 0.6));
      for (let k = 1; k <= n; k++) out.push(evalSeg(prev, s, k / n));
      prev = { x: s.x, y: s.y };
    });
    return out;
  };
  // the mark's control points → drawn curve. A point flagged `c` is a sharp
  // CORNER (a break handle, like a route corner waypoint): the smoothing
  // splits there and each side curves independently, meeting in a hard join
  const markCurve = cp => {
    if (!cp || cp.length < 3) return cp || [];
    const runs = []; let cur = [cp[0]];
    for (let i = 1; i < cp.length; i++) {
      cur.push(cp[i]);
      if (cp[i].c && i < cp.length - 1) { runs.push(cur); cur = [cp[i]]; }
    }
    runs.push(cur);
    if (runs.length === 1) return smoothRun(cp);
    const out = [];
    runs.forEach((run, ri) => { const sm = smoothRun(run); out.push(...(ri ? sm.slice(1) : sm)); });
    return out;
  };
  // split a pressure-carrying note stroke into contiguous runs of similar
  // weight. Bands are coarse on purpose: 4 levels read as a pencil while
  // keeping the element count per stroke in single figures.
  // A note stroke's weight, as pieces small enough that the changes read as a
  // taper rather than a staircase. Quantising pressure into bands doesn't work:
  // captured points sit far apart, so consecutive points can differ by a third
  // of the width no matter how fine the bands are. Instead each segment is
  // subdivided until neighbouring pieces differ by only a few percent, then
  // near-equal neighbours are merged back so flat stretches stay cheap. Cost
  // tracks how much the pressure actually moves, not the stroke's length.
  const PRESS_STEP = 0.05;                 // most a neighbouring piece may differ
  function pressRuns(m) {
    const n = m.pts.length;
    // raw stylus pressure is jittery; smooth it before it drives anything
    const raw = m.press.map(v => (v == null ? 0.5 : Math.max(0, Math.min(1, v))));
    const kAt = i => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s += raw[j]; c++; }
      return 0.55 + (s / c) * 0.95;        // 0.55x … 1.50x of the chosen width
    };
    const parts = [];
    for (let i = 1; i < n; i++) {
      const a = m.pts[i - 1], b = m.pts[i];
      const k0 = kAt(i - 1), k1 = kAt(i);
      const steps = Math.max(1, Math.min(8,
        Math.ceil(Math.abs(k1 - k0) / (PRESS_STEP * Math.max(k0, k1)))));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        parts.push({ k: k0 + (k1 - k0) * ((t0 + t1) / 2), pts: [at(t0), at(t1)] });
      }
    }
    // merge neighbours of near-equal weight into one polyline
    const runs = [];
    parts.forEach(part => {
      const last = runs[runs.length - 1];
      if (last && Math.abs(part.k - last.k) / Math.max(part.k, last.k) < PRESS_STEP / 2) {
        last.pts.push(part.pts[1]);
      } else runs.push({ k: part.k, pts: part.pts.slice() });
    });
    return runs.filter(r => r.pts.length > 1);
  }

  function renderMark(m, hit) {
    if (!m.pts || m.pts.length < 2) return null;
    // Handwriting is drawn, not fitted: note ink renders through its own points
    // rather than a Catmull-Rom curve, which would round the corners off every
    // letter and bow the straight strokes.
    const base = m.sketch ? m.pts : markCurve(m.pts);
    const pts = m.style === "wavy" ? wavyPts(base, Math.max(0.5, m.width * 0.9), 2.8) : base;
    const w = m.width || 1.1;
    const dash = m.style === "dashed" ? `${(w * 2.6).toFixed(2)} ${(w * 1.9).toFixed(2)}`
      : m.style === "dotted" ? `0.02 ${(w * 2).toFixed(2)}` : undefined;
    const line = pts.map(q => `${clampX(q.x)},${clampY(q.y)}`).join(" ");
    return (
      <g key={`mk-${m.id}`}>
        {m.fill && (
          <polygon points={line} fill={m.fill} fillOpacity={m.fillOp != null ? m.fillOp : 0.25}
            stroke="none" pointerEvents="none" />
        )}
        {/* No ice-coloured casing: ink draws as the bare line it was drawn as.
            The halo was there to lift broad marker strokes off the rink dots,
            but it reads as a white outline on anything heavier than a hairline
            — including bold pen strokes and hard Pencil pressure. */}
        {/* A pencil-weighted note: pressure quantised into a few bands and each
            run drawn at its own width. Per-point widths would mean one element
            per segment — dozens per word — where bands collapse a stroke to a
            handful and still read as a pencil. */}
        {pencilPress && m.sketch && m.press && m.press.length === m.pts.length ? pressRuns(m).map((run, i) => (
          <polyline key={`pw${i}`} points={run.pts.map(q => `${clampX(q.x)},${clampY(q.y)}`).join(" ")}
            fill="none" stroke={ink(m.color)} strokeWidth={w * run.k} strokeDasharray={dash}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.94}
            pointerEvents={hit ? "none" : undefined} />
        )) : (
          <polyline points={line} fill="none" stroke={ink(m.color)} strokeWidth={w} strokeDasharray={dash}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.94}
            pointerEvents={hit ? "none" : undefined} />
        )}
        {m.id === selectedId && (
          <polyline points={line} fill="none" stroke={T["ice-select"]} strokeWidth={w + 1.1}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.35} pointerEvents="none" />
        )}
        {hit && editing && !markEdit && (
          <polyline points={line} fill="none" stroke="transparent" strokeWidth={Math.max(4, w + 3)}
            strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "grab" }}
            onPointerDown={e => pieceDown(e, m.id)}
            pointerEvents={m.lock && !lockedSelectable ? "none" : undefined} />
        )}
      </g>
    );
  }
  // the mark's draggable control points live in a TOP overlay (like route
  // handles) so a fingertip target isn't buried under the drill layer
  function renderMarkHandles(yf = yFix) {
    if (!editing || !markEdit) return null;
    const m = pieces.find(q => q.id === selectedId && q.kind === "mark");
    if (!m || !m.pts) return null;
    return m.pts.map((q, i) => (
      <g key={`mp-${m.id}-${i}`}>
        {/* route convention: a round node is a smooth point, a square one a
            sharp corner (break handle). Tap to toggle, drag to re-shape. */}
        {q.c
          ? <rect x={clampX(q.x) - 1.5} y={clampY(q.y) - 1.5 * yf} width={3} height={3 * yf}
              fill={T["ice-select"]} stroke="#14171a" strokeWidth={0.35} pointerEvents="none" />
          : hdot(clampX(q.x), clampY(q.y), 1.7, {
              fill: T["ice-select"], stroke: "#14171a", strokeWidth: 0.35, pointerEvents: "none" }, yf)}
        {/* a larger transparent target so a fingertip can grab the point */}
        {hdot(clampX(q.x), clampY(q.y), 4.5, {
          fill: "transparent", style: { cursor: "grab" },
          onPointerDown: e => markPtDown(e, m.id, i) }, yf)}
      </g>
    ));
  }
  // Bounding-box resize handles for a selected mark (shape overlays included):
  // drag a corner to scale about the opposite corner, editor-style. Per-point
  // reshaping stays behind the popup's "Edit points" toggle.
  function renderMarkResize(yf = yFix) {
    if (!editing || markEdit || tool !== "select") return null;
    const m = pieces.find(q => q.id === selectedId && q.kind === "mark");
    if (!m || !m.pts || m.pts.length < 2 || (m.lock && !lockedSelectable)) return null;
    const xs = m.pts.map(q => q.x), ys = m.pts.map(q => q.y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    if (x2 - x1 < 1.5 && y2 - y1 < 1.5) return null;
    const corners = [[x1, y1, x2, y2], [x2, y1, x1, y2], [x2, y2, x1, y1], [x1, y2, x2, y1]];
    return (
      <g key={`mkrs-${m.id}`}>
        <rect x={x1} y={y1} width={Math.max(0.1, x2 - x1)} height={Math.max(0.1, y2 - y1)}
          fill="none" stroke={T["ice-select"]} strokeWidth={sw(0.35)} strokeDasharray={sdash("1.6 1.2")}
          vectorEffect="non-scaling-stroke" opacity={0.8} pointerEvents="none" />
        {corners.map(([cx, cy, ax, ay], i) => {
          const down = e => handleDown(e, { kind: "markscale", id: m.id, x0: cx, y0: cy, ax, ay,
            pts0: m.pts.map(q => ({ ...q })) });
          return <g key={`c${i}`}>
            {hdot(cx, cy, 1.3, { fill: T["ice-select"], stroke: "#14202b", strokeWidth: 0.28, pointerEvents: "none" }, yf)}
            {/* generous invisible touch target over the visible dot */}
            {hdot(cx, cy, 3.4, { fill: "transparent", style: { cursor: "grab" }, onPointerDown: down }, yf)}
          </g>;
        })}
        {(() => {
          // rotate handle: a lollipop above the box's top edge, spins about the
          // centroid. Stem is long enough to clear the corner touch targets,
          // and the grab area is a big invisible disc for fingertips.
          const mx = (x1 + x2) / 2;
          const cx = m.pts.reduce((a, q) => a + q.x, 0) / m.pts.length;
          const cy = m.pts.reduce((a, q) => a + q.y, 0) / m.pts.length;
          const hy = y1 - 7 * yf;
          const down = e => { const pt0 = svgPt(e);
            handleDown(e, { kind: "markrotate", id: m.id, cx, cy,
              a0: Math.atan2(pt0.y - cy, pt0.x - cx),
              pts0: m.pts.map(q => ({ ...q })) }); };
          return <g key="rot">
            <line x1={mx} y1={y1} x2={mx} y2={hy} stroke={T["ice-select"]} strokeWidth={sw(0.35)}
              vectorEffect="non-scaling-stroke" opacity={0.8} pointerEvents="none" />
            {hdot(mx, hy, 1.5, { fill: "#14202b", stroke: T["ice-select"], strokeWidth: 0.35, pointerEvents: "none" }, yf)}
            {hdot(mx, hy, 4.2, { fill: "transparent", style: { cursor: "grab" }, onPointerDown: down }, yf)}
          </g>;
        })()}
      </g>
    );
  }
  function renderLabels() {
    const canEdit = editing && tool !== "draw";
    const els = [];
    pieces.forEach(p => {
      if (p.kind === "label") {
        const sel = canEdit && p.id === selectedId;
        els.push(labelNode(`lbl-${p.id}`, p.x, p.y, p.text, p.size, p, sel,
          e => pieceDown(e, p.id),
          canEdit && !p.lock ? e => handleDown(e, { kind: "resize", id: p.id, seg: null, cx: p.x, cy: p.y, size0: p.size || 1 }) : null,
          p.lock && !lockedSelectable));
      } else if (p.label && (p.kind !== "player" || (wbTags && symOf(p) !== p.label))) {
        // a name tag under any named prop/piece. Players normally wear the name
        // on their jersey, but the whiteboard X/O symbols don't — tag them when
        // the pref is on, or while a player popup is open (pass-target picking),
        // so "pass to P3" is findable on the ice. Skipped when the symbol already
        // IS the name (a player named LW draws as LW) — no point saying it twice.
        // Player tags rotate around the symbol to the clearest spot (never on a
        // route/pass line) and read slightly larger, in the player's own colour.
        const off = p.kind === "net" ? 6.5 : p.kind === "player" ? 4.6 : 5;
        const spot = p.kind === "player" ? tagSpotFor(p, off) : { x: p.x, y: p.y + off };
        els.push(p.kind === "player"
          ? labelNode(`nm-${p.id}`, spot.x, spot.y, p.label, 0.62, { color: ink(p.color) }, false, null, null)
          : labelNode(`nm-${p.id}`, spot.x, spot.y, p.label, 0.5, { color: "#33414f" }, false, null, null));
      }
      (p.path || []).forEach((s, i) => {
        if (s.dmode !== "label" || !s.desc) return;
        const cx = s.x + (s.dox || 0), cy = s.y + (s.doy != null ? s.doy : -5);
        const sel = canEdit && p.id === selectedId;
        const wlk = !!(p.lock || s.lock);
        els.push(labelNode(`wl-${p.id}-${i}`, cx, cy, s.desc, s.dsize, { color: "#14202b" }, sel,
          canEdit ? e => handleDown(e, { kind: "wlabel", id: p.id, seg: i }) : undefined,
          canEdit && !wlk ? e => handleDown(e, { kind: "resize", id: p.id, seg: i, cx, cy, size0: s.dsize || 1 }) : null,
          wlk && !lockedSelectable));
      });
    });
    return els;
  }

  // the goalie sprite for a net/tire (tracks the puck in front of the net). Drawn
  // ABOVE the net + its drawn crease, but still below the pucks/players (rank 0.5).
  function renderGoalie(net) {
    const gp = goaliePos(net);
    const fx = iconXf(gp);
    const col = net.color || "#c81e33";
    const dark = "#1d2126";
    if (whiteboard) return (
      <g key={`goalie-${net.id}`} transform={fx.t} pointerEvents="none">
        {wbCircle && <circle cx={0} cy={0} r={3.3} fill="#fff" stroke={col} strokeWidth={0.5} />}
        <text transform={`rotate(${-fx.th})`} textAnchor="middle" dominantBaseline="central"
          fontSize={wbCircle ? 4.1 : 5} fontWeight={900} fill={col}
          style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
            ...(wbCircle ? {} : { paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: 0.55 }) }}>
          G
        </text>
      </g>
    );
    return (
      <g key={`goalie-${net.id}`} transform={fx.t} pointerEvents="none">
        <ellipse cx={0.4} cy={0} rx={2.9} ry={2.6} fill="#0a1016" opacity={0.16} />
        <path d="M 2.3 2.2 L 3.9 1 M 3.9 1.1 L 4.5 -1.1" stroke={dark} strokeWidth={1} strokeLinecap="round" />
        <rect x={-1.7} y={-1.5} width={2.4} height={3} rx={1.05} fill={col} stroke="#fff" strokeWidth={0.3} />
        <rect x={0.2} y={-1.85} width={2.6} height={1.5} rx={0.42} fill="#eef2f6" stroke="#2a2f36" strokeWidth={0.3} />
        <rect x={0.2} y={0.35} width={2.6} height={1.5} rx={0.42} fill="#eef2f6" stroke="#2a2f36" strokeWidth={0.3} />
        <circle cx={1.95} cy={-2.4} r={1.05} fill="#e8edf2" stroke="#2a2f36" strokeWidth={0.32} />
        <circle cx={1.95} cy={-2.4} r={0.48} fill="none" stroke="#2a2f36" strokeWidth={0.18} opacity={0.55} />
        <rect x={1.35} y={1.6} width={1.85} height={1.5} rx={0.28} fill="#e8edf2" stroke="#2a2f36" strokeWidth={0.32} />
        <circle cx={-0.15} cy={0} r={0.92} fill={col} stroke="#fff" strokeWidth={0.3} />
        <path d="M 0.35 -0.55 Q 0.85 0 0.35 0.55" fill="none" stroke="#fff" strokeWidth={0.16} opacity={0.55} />
      </g>
    );
  }

  // Result splash for each net's latest shot (GOAL/SAVE/POST/WIDE/OVER). Parks in
  // an open area near the net (clear of players/routes) and flashes with an
  // outcome-specific motion (see the per-type block below); once the drill has
  // finished it holds the final result at full strength so a last-instant goal
  // isn't cut off. Stretch-cancelled via the icon frame like a label.
  function renderResultSplash() {
    if (!showResult || whiteboard || aiPlay || animT <= 0) return null;
    if (previewAllBranches) return null;   // no single-run goal call while previewing every branch
    const DUR = 0.9, e = animT * totalTime;
    const { plans } = getPlan();
    // gather every shot result, grouped by which net it hit (left vs right)
    const byNet = new Map();
    for (const q of pieces) {
      if (q.kind !== "puck") continue;
      const plan = plans[q.id];
      if (!plan) continue;
      plan.legs.forEach((L, i) => {
        if (L.type !== "fly" || !L.shot || (!L.goal && !L.save && !L.post && !L.wide && !L.over)) return;
        const side = L.x1 < 100 ? "L" : "R";
        const cur = byNet.get(side);
        // keep only the latest shot on this net that has already arrived, so a
        // rebound goal instantly supersedes the earlier save (no overlap)
        if (L.t1 <= e && (!cur || L.t1 > cur.L.t1)) byNet.set(side, { L, key: `${q.id}-${i}` });
      });
    }
    if (!byNet.size) return null;
    const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer" || q.kind === "tire" || q.kind === "bumper");
    const ld = liftDir();                                    // screen-up, for floating the splash above the net
    // darken a hex toward black (for the extruded 3D side of the letters)
    const darken = (hex, f) => {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    };
    const LAB = { fontFamily: "system-ui, sans-serif", userSelect: "none" };
    const els = [];
    for (const [side, { L, key }] of byNet) {
      const dt = e - L.t1;
      if (dt < 0 || dt > DUR) continue;                     // before the shot lands, or fully faded
      const type = L.goal ? "goal" : L.post ? "post" : "grow";
      // pop right at the net the shot is on, floated a touch up-screen so it
      // clears the cage and puck
      const netP = nets.length ? nets.reduce((a, b) => Math.hypot(b.x - L.x1, b.y - L.y1) < Math.hypot(a.x - L.x1, a.y - L.y1) ? b : a) : null;
      const ax = (netP ? netP.x : L.x1) + ld.x * 8, ay = (netP ? netP.y : L.y1) + ld.y * 8;
      // per-outcome flash: GOAL pops in, tilts back-and-forth, pops out; POST
      // fades in and violently shakes; a miss (save / wide / over) fades in, grows.
      // restFade drives the fade to zero once the sim is paused/stopped.
      let op = 1, scale = 1, rot = 0, dx = 0, dy = 0;
      const inT = 0.1, outT = 0.28;                         // quick in, quick fade out
      op = dt < inT ? dt / inT : dt > DUR - outT ? Math.max(0, (DUR - dt) / outT) : 1;
      op *= restFade;
      if (type === "goal") {
        const eob = f => { const c1 = 1.9, c3 = c1 + 1, g = f - 1; return 1 + c3 * g * g * g + c1 * g * g; };
        scale = dt < 0.18 ? eob(dt / 0.18) : 1;                          // pop in w/ overshoot
        if (dt > DUR - outT) scale = 1 + 0.5 * (1 - (DUR - dt) / outT);  // pop out bigger
        rot = 12 * Math.max(0, 1 - dt / DUR) * Math.sin(dt * 16);        // tilt back and forth
      } else if (type === "post") {
        const sd = Math.max(0, 1 - dt / 0.45);                           // shake decays over ~0.45s
        dx = 1.6 * sd * Math.sin(dt * 60);
        dy = 1.2 * sd * Math.cos(dt * 67);
        rot = 7 * sd * Math.sin(dt * 52);
      } else {
        scale = 0.85 + 0.5 * (dt / DUR);                                 // fade in + grow
      }
      const fx = iconXf({ x: clampX(ax), y: clampY(ay), a: 0 });
      // GOAL is a hit; SAVE/POST/WIDE/OVER are all misses (post & wide share the
      // amber "iron/off-target" look, over is a deeper miss, save stays blue)
      const text = L.goal ? "GOAL!" : L.save ? "SAVE!" : L.post ? "POST!" : L.wide ? "WIDE!" : "OVER!";
      const fill = L.goal ? "#ff3b52" : L.save ? "#2b8cff" : L.over ? "#8a5a2b" : "#e0902b";
      const dk = darken(fill, 0.42);
      const fs = 3.7 / ICON_SCALE;                          // smaller
      const dep = fs * 0.07;                                 // extrusion step (shallower 3D)
      els.push(
        <g key={`rs-${key}`} transform={fx.t} opacity={op} pointerEvents="none">
          <g transform={`rotate(${-fx.th}) translate(${dx.toFixed(2)} ${dy.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${scale.toFixed(3)})`}>
            {/* extruded 3D depth: a few dark copies stacked down-screen behind the face */}
            {[3, 2, 1].map(k => (
              <text key={k} textAnchor="middle" y={fs * 0.34 + k * dep} fontSize={fs} fontWeight={900}
                fill={dk} style={{ ...LAB, letterSpacing: fs * 0.02 }}>{text}</text>
            ))}
            {/* bright face with a white outline for pop against the ice */}
            <text textAnchor="middle" y={fs * 0.34} fontSize={fs} fontWeight={900} fill={fill}
              stroke="#fff" strokeWidth={fs * 0.05} paintOrder="stroke"
              style={{ ...LAB, letterSpacing: fs * 0.02 }}>{text}</text>
          </g>
        </g>
      );
    }
    return els;
  }

  function renderStops(p, yf = yFix) {
    const hd = (cx, cy, r, props) => hdot(cx, cy, r, props, yf);
    const els = [];
    p.path.forEach((s, i) => {
      if (!(s.stop > 0) && !(s.waitOn && s.waitOn.on)) return;   // a fixed pause OR a trigger pause
      const pt = segEnd(p, i - 1);
      els.push(
        <g key={`st${p.id}${i}`} opacity={0.9} pointerEvents="none">
          {hd(pt.x, pt.y, 2, { fill: "#fff", stroke: ink(p.color), strokeWidth: 0.35 })}
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
    // rink point → root-viewBox coords, then fractions of the (possibly
    // letterbox-padded) root the canvas actually shows
    const g = geomRef.current;
    const rx = screenRot === 90 ? my + vh - pt.y
      : screenRot === 180 ? mx + vw - pt.x
      : screenRot === 270 ? pt.y - my
      : pt.x;
    const ry = screenRot === 90 ? pt.x - mx
      : screenRot === 180 ? my + vh - pt.y
      : screenRot === 270 ? mx + vw - pt.x
      : pt.y;
    const lx = ((rx - g.ox) / g.rootW) * 100;
    const ty = ((ry - g.oy) / g.rootH) * 100;
    if (lx < -2 || lx > 102 || ty < -2 || ty > 102) return null;
    return { lx: Math.max(0, Math.min(100, lx)), ty: Math.max(0, Math.min(100, ty)) };
  }

  function renderPopout() {
    // a pinned/docked panel stays up while the animation runs so the last
    // selected item keeps its info in view; an unpinned popup only shows while
    // stopped at the start (editing). "draw" always hides it; a missing target
    // = nothing to show.
    const noTarget = !popup || tool === "draw" ||
      (popup.type !== "add" && !pieces.find(q => q.id === popup.id));
    const hidden = noTarget || (!editing && !pinned);
    // docked sidebar with nothing valid to show: keep the reserved column in
    // place with a hint instead of collapsing it to an empty gap
    if (docked && hidden) {
      return (
        <div className="hd-pop pinned dock" ref={popRef} onPointerDown={e => e.stopPropagation()}>
          <div className="hd-pophead">
            <span className="hd-poptitle">Edit</span>
            <button className="hd-x on" title="Un-dock" onPointerDown={e => e.stopPropagation()}
              aria-pressed={docked}
              onClick={toggleDock}><Icon name={docked ? "sidebarOn" : "sidebar"} size={15} /></button>
            <button className="hd-x" title="Close" onPointerDown={e => e.stopPropagation()}
              onClick={() => { setPopup(null); setPinMode(null); }}><Icon name="close" size={15} /></button>
          </div>
          <div className="hd-poprow hd-stephint">
            Tap a player, puck, or point to edit it here.
          </div>
        </div>
      );
    }
    if (hidden) return null;
    const p = pieces.find(q => q.id === popup.id);
    if (!p && popup.type !== "add") return null;

    // ── Unified per-waypoint Action panel ─────────────────────────────────
    // an ordered, editable list of steps at ONE spot (player p, waypoint i;
    // i=-1 = the start/standing spot). Context-aware: with no puck only Receive
    // Pass / Collect Puck are offered; once holding, Pass / Shoot / Chip / Hard
    // Rim open up. Projects the existing puck-chain model via stepsAt and edits
    // it with the same mutators — timing/DSL unchanged.
    const GAIN_TYPES = [["receive", "Receive Pass"], ["collect", "Collect Puck"]];
    const RELEASE_TYPES = [["pass", "Pass"], ["shoot", "Shoot"], ["chip", "Chip"], ["rim", "Hard Rim"]];
    const isGain = t => t === "receive" || t === "collect";
    const shootTargets2 = pieces.filter(q => q.kind === "net" || q.kind === "passer" || q.kind === "bumper" || q.kind === "tire");
    const tgtLabel2 = t => t.id + (t.kind === "bumper" ? " · bumper" : t.kind === "tire" ? " · tire" : t.kind === "passer" ? " · passer" : "");
    const typeOfStep = st => st.role === "receive" ? "receive"
      : st.role === "collect" || st.role === "pickup" ? "collect"
      : st.kind === "pass" ? "pass" : st.kind === "shot" ? "shoot" : st.kind === "rim" ? "rim" : "chip";

    const passSubRows = (p, i, st) => {
      const pk = st.pk, tr = (pk.transfers || [])[st.stage] || {};
      const rec = pieces.find(q => q.id === tr.to && q.kind === "player");
      const isSauce = !!tr.sauce;
      const doSauce = () => update(q => q.id !== pk.id ? q : { ...q, transfers: (q.transfers || []).map((x, s) => s === st.stage ? { ...x, sauce: !x.sauce } : x) });
      // No "caught at [auto][1][2]…" chip row here any more: the step's own
      // "Catch:" dropdown already sets exactly this, and does it better — the
      // chips could only address the receiver's BASE path, while the dropdown
      // also reaches waypoints on their reaction forks. Two controls writing one
      // field, one of them a strict subset, and on a long route the chips ran to
      // eight buttons that wrapped across the panel.
      return (
        <div className="hd-poprow">
          <button className={`hd-mini${isSauce ? " on" : ""}`} onClick={doSauce}><Icon name={isSauce ? "check" : "sauce"} size={14} /> Sauce pass</button>
        </div>
      );
    };

    // The receiver's side of a delivery. "Open up" is the coach's term for turning
    // to face where the puck is coming from so it arrives on the forehand instead of
    // reaching back onto the backhand — a right shot down the left wing taking a pass
    // from behind on their right, or a left shot down the right wing from their left.
    // The flag rides the same transfer the passer's step edits (or the pickup, for a
    // loose puck), so it round-trips as a trailing `+` in the DSL.
    const gainSubRows = (p, i, st) => {
      const pk = st.pk;
      if (!pk) return null;
      const pick = st.role === "pickup";
      const tr = pick ? (pk.pickup || {}) : (pk.transfers || [])[st.stage] || {};
      const isOpen = !!tr.open;
      const doOpen = () => update(q => q.id !== pk.id ? q
        : pick ? { ...q, pickup: { ...q.pickup, open: !isOpen } }
        : { ...q, transfers: (q.transfers || []).map((x, s) => s === st.stage ? { ...x, open: !isOpen } : x) });
      return (
        <>
          <div className="hd-poprow">
            <button className={`hd-mini${isOpen ? " on" : ""}`} onClick={doOpen}>
              <Icon name={isOpen ? "check" : "rotateCw"} size={14} /> Open up
            </button>
          </div>
          <div className="hd-sechint">Turns to face the puck and takes it on the forehand, then pivots forward.</div>
        </>
      );
    };

    // Which hand a release comes off — shots, passes, chips and hard rims alike.
    // Default reads the angle from the releaser to what they're playing the puck at
    // and takes whichever side it is already on; the coach can force either instead,
    // because a drill built around finishing on the backhand shouldn't depend on
    // geometry. The flag lives on the terminal for a terminal release and on the
    // transfer for a delivery, so it round-trips as a trailing `&f`/`&b` either way.
    const HAND_TARGET = { shoot: "the net", pass: "the receiver", chip: "the chip", rim: "the rim" };
    const handSubRows = (p, i, st, t) => {
      const pk = st.pk;
      const term = st.role === "terminal" ? st.term : null;
      if (!pk || (!term && st.stage == null)) return null;
      const cur = (term ? term.shand : ((pk.transfers || [])[st.stage] || {}).shand) || "auto";
      const setHand = h => { const v = h === "auto" ? undefined : h;
        update(q => q.id !== pk.id ? q
          : term ? { ...q, terminals: (q.terminals || []).map(x => sameTerm(x, term) ? { ...x, shand: v } : x) }
          : { ...q, transfers: (q.transfers || []).map((x, s) => s === st.stage ? { ...x, shand: v } : x) }); };
      const lbl = t === "shoot" ? "Shot" : t === "pass" ? "Pass" : t === "chip" ? "Chip" : "Rim";
      return (
        <>
          <div className="hd-sectitle" style={{ marginTop: 5 }}>{lbl} hand</div>
          <div className="hd-poprow">
            {[["auto", "Default", `whichever side ${HAND_TARGET[t]} is already on`],
              ["fore", "Forehand", "always off the strong side"],
              ["back", "Backhand", "always off the back of the blade"]].map(([k, tx, tip]) => (
              <button key={k} className={`hd-mini${cur === k ? " on" : ""}`} title={`${tx} — ${tip}`}
                onClick={() => setHand(k)}>{tx}</button>
            ))}
          </div>
        </>
      );
    };

    const ActionSteps = (p, i, fork = null) => {
      const steps = stepsAt(p, i, fork);
      // at the START spot (i<0): if a puck the player is carrying here is passed
      // or shot at a LATER waypoint of theirs, lock the start Actions — adding an
      // action here would take that puck away before it reaches the downchain
      // action that needs it. Edit the action at that waypoint instead.
      const startLocked = i < 0 && p.kind === "player" && pieces.some(pk => {
        if (pk.kind !== "puck") return false;
        const chain = puckChain(pk);
        const carriedHere = pk.carrier === p.id
          || (pk.pickup && pk.pickup.to === p.id && (pk.pickup.at == null || pk.pickup.at < 0));
        if (!carriedHere) return false;
        const ts = pk.transfers || [];
        const releaseDown = ts.some((t, s) => (t.by || chain[s]) === p.id && t.at != null && t.at >= 0);
        const termActor = pk.termBy || chain[chain.length - 1];
        const termDown = termActor === p.id && (
          (pk.shotAt != null && pk.shotAt >= 0) || (pk.rimAt != null && pk.rimAt >= 0)
          || (pk.chipAt != null && pk.chipAt >= 0) || (pk.xterms || []).some(xt => xt.at != null && xt.at >= 0));
        return releaseDown || termDown;
      });
      // this spot's route: puck actions authored here carry the branch ref so
      // resolveForks can lower them to the chosen run's flat index (base = no ref)
      const relRef = fork ? { atRef: fork } : {};
      const recRef = fork ? { recvRef: fork } : {};
      const others = pieces.filter(q => q.kind === "player" && q.id !== p.id);
      // give-and-go bounce targets: passers, tires, bumpers (the puck rebounds
      // off them back to this player) — available even with no other player
      const viaTargets = pieces.filter(q => q.kind === "passer" || q.kind === "tire" || q.kind === "bumper");
      const defaultPasser = () => ((others.find(o => pieces.some(q => q.kind === "puck" && puckChain(q).includes(o.id))) || others[0] || {}).id) || null;
      // the puck p is holding, unreleased, ready to act on — works at ANY spot
      // (including a stationary i=-1, where index bookkeeping differs): p is the
      // chain's current last carrier and it has no terminal yet. Prefer one
      // gained right here, then the most recent.
      const heldRelease = () => {
        // holds this puck on THIS route (branch lineage `fork`), unreleased — a sibling
        // branch's shot/pass doesn't take it away here
        const holds = pieces.filter(q => q.kind === "puck"
          && holdsOnLineage(q, p.id, fork) && !termedByOnLineage(q, p.id, fork));
        const here = holds.filter(q => {
          if (q.pickup && q.pickup.to === p.id) {
            const qi = !p.path.length || q.pickup.at < 0 ? -1 : q.pickup.at;   // waypoint 0 = start (i=-1)
            if (qi === i) return true;
          }
          const ts = q.transfers || [], t = ts[ts.length - 1];
          return t && t.to === p.id && (t.recvAt != null ? t.recvAt : -1) === i;
        });
        const pool = here.length ? here : holds;
        const pk = pool[pool.length - 1]
          || heldPuckAt(p, i) || pieces.find(q => q.kind === "puck" && puckChain(q).includes(p.id)) || pieces.find(q => q.kind === "puck");
        if (!pk) return null;
        return { pk, last: holdsOnLineage(pk, p.id, fork) };
      };
      // always pin the releaser (`by`): after sibling-branch receivers the inferred
      // releaser of a later transfer is genuinely ambiguous (several players "hold"
      // on their own mutually-exclusive runs), and inference would attribute the
      // pass to the wrong player — it then renders on THEIR waypoint, not here.
      const addPass = to => { const h = heldRelease(); if (h) appendTransfer(h.pk.id, { at: i, to, recvAt: null, kind: "pass", ...relRef, by: p.id }); };
      // give-and-go: bounce off a passer/tire/bumper back to this player
      const addVia = via => { const h = heldRelease(); if (h) appendTransfer(h.pk.id, { at: i, to: p.id, recvAt: i < 0 ? null : i, kind: "pass", via, ...relRef, ...recRef, by: p.id }); };
      const addTerminal = (kind, net) => {
        const h = heldRelease(); if (!h) return;
        const pk = h.pk;
        const dist = kind === "rim" ? REL_DEFAULT.rimAt : kind === "chip" ? REL_DEFAULT.chipAt : null;
        // a branch ends one way PER PLAYER: drop only p's own prior end on this lineage
        const patch = stripLineageTerms(pk, fork, p.id);
        const base = "terminals" in patch ? (patch.terminals || []) : (pk.terminals || []);
        // always pin the shooter — the actor must not drift as the chain is edited
        // (an inferred actor follows "last authored receiver", so adding a pass later
        // would silently reassign an unpinned terminal)
        patch.terminals = [...base, { kind, at: i, ref: fork || "", by: p.id,
          ...(kind === "shot" ? (net ? { net } : {}) : { aim: null, dist }) }];
        updateById(pk.id, patch);
        if (kind === "shot") ensureNet();
      };
      const createType = t => {
        if (t === "receive") { const src = defaultPasser(); if (src) doReceiveFrom(p.id, i, src, fork); else flash("Add another player to pass from"); }
        else if (t === "collect") collectPuckAt(p.id, i, undefined, fork);
        else if (t === "pass") { const to = (others[0] || {}).id; if (to) addPass(to); else if (viaTargets[0]) addVia(viaTargets[0].id); else flash("Add a player, passer, tire, or bumper to pass to"); }
        else if (t === "shoot") addTerminal("shot", null);
        else if (t === "chip") addTerminal("chip");
        else if (t === "rim") addTerminal("rim");
      };
      const changeType = (st, t) => {
        if (t === "none") { st.del(); return; }
        const cur = typeOfStep(st);
        if (t === cur) return;
        const pk = st.pk;
        if (!isGain(cur) && !isGain(t)) {                       // release/terminal ↔ release/terminal, same stage/puck
          const stage = st.role === "terminal" ? (pk.transfers || []).length : st.stage;
          if (t === "pass") {
            // a terminal turning into a pass removes ITSELF (setTransfer no longer
            // clears terminals — they're independent branch ends)
            if (st.role === "terminal" && st.term) clearTerminal(pk.id, st.term);
            setTransfer(pk.id, stage, { at: i, to: (others[0] || {}).id, recvAt: null, kind: "pass", ...relRef });
          } else {
            const kind2 = t === "shoot" ? "shot" : t;
            update(q => {
              if (q.id !== pk.id) return q;
              const patch = stripLineageTerms(q, fork, p.id);   // a branch ends one way per player
              // a pass turning into a terminal removes JUST that pass — sibling-branch
              // transfers after it are independent, not a dependent tail
              patch.transfers = (q.transfers || []).slice(); patch.transfers.splice(stage, 1);
              const dist = kind2 === "rim" ? REL_DEFAULT.rimAt : kind2 === "chip" ? REL_DEFAULT.chipAt : null;
              const base = "terminals" in patch ? (patch.terminals || []) : (q.terminals || []);
              patch.terminals = [...base, { kind: kind2, at: i, ref: fork || "", by: p.id, ...(kind2 === "shot" ? {} : { aim: null, dist }) }];
              return { ...q, ...patch };
            });
            if (kind2 === "shot") ensureNet();
          }
          return;
        }
        st.del(); createType(t);                               // crossing gain↔release (or gain↔gain): rebuild
      };
      const secondary = (st) => {
        const t = typeOfStep(st), pk = st.pk;
        if (t === "pass") {
          const tr = (pk.transfers || [])[st.stage] || {};
          const val = tr.via ? "v:" + tr.via : "p:" + tr.to;
          // the receiver's routes with BRANCH-LOCAL indices (recvAt/recvRef space):
          // base ("") then each branch by its colour-path — a pass can be caught on
          // any of them, e.g. led onto the receiver's reaction route
          const rec = pieces.find(q => q.id === tr.to);
          const recRoutes = [];
          if (rec) {
            recRoutes.push({ ref: "", path: rec.path || [] });
            const walk = (forks, prefix) => (forks || []).forEach(f => {
              if (!f.path || !f.path.length) return;
              const r = prefix ? prefix + "/" + f.color : f.color;
              recRoutes.push({ ref: r, path: f.path });
              walk(f.forks, r);
            });
            walk(rec.forks, "");
          }
          const rv = tr.recvAt == null ? "" : `${(tr.recvRef || "").toLowerCase()}|${tr.recvAt}`;
          const setRecv = v => update(q => {
            if (q.id !== pk.id) return q;
            const ts = (q.transfers || []).map((x, s2) => {
              if (s2 !== st.stage) return x;
              if (!v) { const { recvRef, ...rest } = x; return { ...rest, recvAt: null }; }
              const [ref, idx] = v.split("|");
              const { recvRef, ...rest } = x;
              return { ...rest, recvAt: parseInt(idx, 10), ...(ref ? { recvRef: ref } : {}) };
            });
            // chained(): moving WHERE a pass is caught moves it in the chain, so
            // the transfers have to re-order. main added this to setRecvAt — the
            // chip row this branch replaced — and this dropdown is now the only
            // control for recvAt, so the fix has to live here instead.
            return chained({ ...q, transfers: ts });
          });
          return (<>
            <select className="hd-select on" value={val} onChange={e => { const v = e.target.value;
              if (v[0] === "v") setTransfer(pk.id, st.stage, { at: i, to: p.id, recvAt: i < 0 ? null : i, kind: "pass", via: v.slice(2), ...relRef, ...recRef });
              else setTransfer(pk.id, st.stage, { ...tr, to: v.slice(2), via: undefined, recvAt: null, recvRef: undefined, at: i, kind: "pass", ...relRef }); }}>
              {others.map(o => <option key={o.id} value={"p:" + o.id}>{nameOf(o.id)}</option>)}
              {viaTargets.map(v => <option key={v.id} value={"v:" + v.id}>{nameOf(v.id)}{v.kind === "tire" ? " (tire)" : v.kind === "bumper" ? " (bumper)" : ""} — give &amp; go ⟲</option>)}
            </select>
            {rec && (
              <select className="hd-select on" value={rv} title="where the receiver catches it"
                onChange={e => setRecv(e.target.value)}>
                <option value="">Catch: auto</option>
                {recRoutes.map(r => (r.path || []).map((_, wi) => (
                  <option key={`${r.ref}|${wi}`} value={`${r.ref.toLowerCase()}|${wi}`}>
                    {r.ref ? `↳ ${r.ref.replace(/#/g, "")} @${wi + 1}` : `@${wi + 1}`}
                  </option>
                )))}
              </select>
            )}
          </>);
        }
        if (t === "shoot") {
          const term = st.role === "terminal";
          // a terminal shot's target lives ON the terminal (each branch end aims
          // independently); a rebound transfer's on the transfer. No puck-level net.
          const curNet = term ? (st.term || {}).net : ((pk.transfers || [])[st.stage] || {}).net;
          const setNet = id => term
            ? update(q => q.id !== pk.id ? q : { ...q, terminals: (q.terminals || []).map(x => sameTerm(x, st.term) ? { ...x, net: id || undefined } : x) })
            : update(q => q.id !== pk.id ? q : { ...q, transfers: (q.transfers || []).map((x, s) => s === st.stage ? { ...x, net: id } : x) });
          return (
            <select className="hd-select on" value={curNet || "nearest"} onChange={e => setNet(e.target.value === "nearest" ? null : e.target.value)}>
              <option value="nearest">Nearest net</option>
              {shootTargets2.map(n => <option key={n.id} value={n.id}>{tgtLabel2(n)}</option>)}
            </select>
          );
        }
        if (t === "receive") {
          const src = st.via || st.src || "";
          return (
            <select className="hd-select on" value={src} onChange={e => { const v = e.target.value; st.del(); if (v) doReceiveFrom(p.id, i, v, fork); }}>
              {[...others, ...viaTargets].map(o => <option key={o.id} value={o.id}>{nameOf(o.id)}</option>)}
            </select>
          );
        }
        if (t === "collect") {
          // a nearest pickup keeps the dynamic "Nearest puck" selection; a fixed
          // pickup or rebound-collect shows its concrete puck id
          const cur = st.pk && !(st.pk.pickup && st.pk.pickup.nearest) ? st.pk.id : "nearest";
          return (
            <select className="hd-select on" value={cur}
              onChange={e => { const v = e.target.value; st.del(); collectPuckAt(p.id, i, v === "nearest" ? undefined : v, fork); }}>
              <option value="nearest">Nearest puck</option>
              {pieces.filter(q => q.kind === "puck").map(q => <option key={q.id} value={q.id}>{q.id}</option>)}
            </select>
          );
        }
        return null;                                            // chip / rim → on-ice handle (hint row below)
      };
      // each step's type options lead with ITS OWN role family (a gain step leads
      // with gains) but include the other too — changeType already knows how to
      // rebuild across the gain↔release divide.
      const rows = steps.map(st => ({ st,
        opts: (st.role === "receive" || st.role === "collect" || st.role === "pickup")
          ? [...GAIN_TYPES, ...RELEASE_TYPES] : [...RELEASE_TYPES, ...GAIN_TYPES] }));
      // The Add control leads with releases when the player MAY hold an un-released
      // puck on THIS route, else gains — but always offers BOTH families. The
      // possession ledger is condition-aware: a delivery whose conditions can't
      // co-occur with taking this branch (e.g. a red-branch pass vs a when=<player>!
      // green reaction) is PROVED absent, so a pickup route correctly leads with
      // Collect instead of assuming a hold from base-route lineage math.
      const holdingHere = mayHoldOn(posLedger, pieces, p.id, fork || "");
      const addOpts = holdingHere ? [...RELEASE_TYPES, ...GAIN_TYPES] : [...GAIN_TYPES, ...RELEASE_TYPES];
      const typeSelect = (value, options, onChange, key) => (
        <select key={key} className={`hd-select${value !== "none" ? " on" : ""}`} style={{ flex: "0 1 auto", minWidth: 96 }} value={value} onChange={e => onChange(e.target.value)}>
          <option value="none">No Action</option>
          {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
        </select>
      );
      const addRow = key => (
        <div key={key} className="hd-poprow">
          <span className="hd-steplbl">＋ Add</span>
          {typeSelect("none", addOpts, t => t !== "none" && createType(t), key)}
        </div>
      );
      return (
        <div className={`hd-actions${startLocked ? " locked" : ""}`}>
          <div className="hd-mh" style={{ marginBottom: 5 }}>Actions</div>
          {startLocked && (
            <div className="hd-poprow"><span className="hd-stepwarn">
              This puck is passed or shot at a later route point — set that action there.
            </span></div>
          )}
          {rows.length > 0 && addRow("addtop")}
          {rows.map(({ st, opts }, n) => {
            const t = typeOfStep(st);
            return (
              <div key={n} className={`hd-step ${t}${st.warn ? " warn" : ""}`}>
                <div className="hd-poprow">
                  <span className="hd-steplbl">Step {n + 1}</span>
                  {typeSelect(t, opts, v => changeType(st, v), n)}
                  {secondary(st)}
                  <button className="hd-mini danger hd-stepx" title="Remove step" onClick={st.del}>✕</button>
                </div>
                {st.warn && <div className="hd-poprow"><span className="hd-stepwarn">⚠ {st.warn}</span></div>}
                {t === "pass" && passSubRows(p, i, st)}
                {isGain(t) && gainSubRows(p, i, st)}
                {!isGain(t) && handSubRows(p, i, st, t)}
                {(t === "chip" || t === "rim") && <div className="hd-poprow"><span className="hd-stephint">drag the on-ice handle to aim &amp; set distance</span></div>}
              </div>
            );
          })}
          {rows.length === 0
            ? <div className="hd-poprow"><span className="hd-steplbl">Step 1</span>{typeSelect("none", addOpts, t => t !== "none" && createType(t), "s1")}</div>
            : addRow("addbot")}
        </div>
      );
    };

    let anchorPt, body, title;
    if (popup.type === "add") {
      if (!popup.pt) return null;
      anchorPt = popup.pt;
      title = "Add here";
      // hover/focus a tile → ghost-preview that piece at the tap spot
      const hov = k => ({
        onPointerEnter: () => setAddHover(k), onPointerLeave: () => setAddHover(null),
        onFocus: () => setAddHover(k), onBlur: () => setAddHover(null),
      });
      body = (
        <>
          {/* same order as the main Add/draw palette so both grids build one
              muscle memory; the pen leads here too */}
          <button className="hd-item" onClick={() => { setMode("draw"); }}>
            <Icon name="marker" size={16} /> Smart pen — sketch it
          </button>
          {/* Driven by the SAME ADD_GROUPS table as the Edit bar, so the two
              can't drift — they were written out separately and did. Marks are
              skipped: they're drawn or placed, not dropped at a tapped point. */}
          <div className="hd-toolgrid compact">
            {ADD_GROUPS.slice(0, 2).flatMap(g => g.kinds).map(([k, lbl]) => (
              <button key={k} className="hd-tool" {...hov(k)} title={lbl}
                onClick={() => (k === "playerpuck" ? addPlayerWithPuck(popup.pt, true) : addPieceAt(k, popup.pt))}>
                {toolImg(k, whiteboard, wbCircle)}<span>{lbl}</span>
              </button>
            ))}
            <button className="hd-tool" {...hov("label")} onClick={() => addPieceAt("label", popup.pt)}>
              <span className="hd-toolglyph"><Icon name="label" size={22} /></span><span>Label</span></button>
          </div>
        </>
      );
    } else if (popup.type === "piece") {
      anchorPt = { x: p.x, y: p.y };
      // one shared "Route" field (title above, instruction, curve buttons) —
      // used at the top of the player menu and in the puck editor
      const routeField = () => (
        <div className="hd-field">
          <div className="hd-sectitle">Route</div>
          <div className="hd-sechint">
            {p.path.length ? "Tap a shape to extend the route, or draw freehand." : "Tap a shape to start a route, or draw freehand."}
          </div>
          <div className="hd-poprow">{curveButtons(t => addSegment(p.id, t), () => drawRouteMode(p.id))}</div>
        </div>
      );
      title = p.kind === "player" ? `Player ${p.label || p.id}` : p.kind === "puck" ? `Puck ${p.id}`
        : p.kind === "net" ? `Net ${p.id}` : p.kind === "bumper" ? `Bumper ${p.id}`
        : p.kind === "deker" ? `Deker ${p.id}` : p.kind === "passer" ? `Passer ${p.id}`
        : p.kind === "label" ? `Label ${p.id}` : p.kind === "tire" ? `Tire ${p.id}` : p.kind === "stick" ? `Stick ${p.id}`
        : p.kind === "light" ? `Light ${p.id}` : p.kind === "mark" ? `Mark ${p.id}` : `Cone ${p.id}`;
      body = (
        <>
          {p.kind === "label" && (
            <>
              <div className="hd-field">
                <div className="hd-sectitle">Text</div>
                <div className="hd-poprow">
                  <input className="hd-input" style={{ flex: 1, minWidth: 120 }} value={p.text || ""}
                    placeholder="Label text" autoFocus
                    onChange={e => updateById(p.id, { text: e.target.value })} />
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Size</div>
                <div className="hd-poprow">
                  <Stepper value={+(p.size || 1).toFixed(2)} onChange={v => updateById(p.id, { size: Math.max(0.4, v) })} step={0.2} min={0.4} suffix="×" />
                </div>
                <div className="hd-sechint">Drag to move · corner to resize.</div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Color</div>
                <div className="hd-poprow">
                  {LABEL_COLORS.map(c => (
                    <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                      onClick={() => updateById(p.id, { color: c })} />
                  ))}
                </div>
                <div className="hd-poprow">
                  <span>Opacity</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={p.textOp != null ? p.textOp : 1}
                    style={{ flex: 1, minWidth: 80 }}
                    onChange={e => updateById(p.id, { textOp: parseFloat(e.target.value) })} />
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Background</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${p.bg === "none" ? " on" : ""}`}
                    onClick={() => updateById(p.id, { bg: "none" })}>None</button>
                  {LABEL_BG_COLORS.map(c => (
                    <div key={c} className={`hd-swatch${p.bg !== "none" && (p.bg || "#f6fbfd") === c ? " on" : ""}`}
                      style={{ background: c }}
                      onClick={() => updateById(p.id, { bg: c, bgOp: p.bgOp != null ? p.bgOp : 0.95 })} />
                  ))}
                </div>
                {p.bg !== "none" && (
                  <div className="hd-poprow">
                    <span>Opacity</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={p.bgOp != null ? p.bgOp : 0.95}
                      style={{ flex: 1, minWidth: 80 }}
                      onChange={e => updateById(p.id, { bgOp: parseFloat(e.target.value) })} />
                  </div>
                )}
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Border</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${p.border === "none" ? " on" : ""}`}
                    onClick={() => updateById(p.id, { border: "none" })}>None</button>
                  {LABEL_BORDER_COLORS.map(c => (
                    <div key={c} className={`hd-swatch${p.border !== "none" && (p.border || "#14202b") === c ? " on" : ""}`}
                      style={{ background: c }}
                      onClick={() => updateById(p.id, { border: c, borderOp: p.borderOp != null ? p.borderOp : 0.35 })} />
                  ))}
                </div>
                {p.border !== "none" && (
                  <div className="hd-poprow">
                    <span>Opacity</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={p.borderOp != null ? p.borderOp : 0.35}
                      style={{ flex: 1, minWidth: 80 }}
                      onChange={e => updateById(p.id, { borderOp: parseFloat(e.target.value) })} />
                  </div>
                )}
              </div>
            </>
          )}
          {p.kind === "net" && (
            <>
              <div className="hd-field">
                <div className="hd-sectitle">Goalie</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${p.goalie ? " on" : ""}`}
                    onClick={() => updateById(p.id, { goalie: !p.goalie })}>
                    {p.goalie ? "✓ Goalie in net" : "🥅 Goalie in net"}
                  </button>
                </div>
                <div className="hd-sechint">Drag to move · ring to rotate.</div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Crease</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${p.crease ? " on" : ""}`}
                    onClick={() => updateById(p.id, { crease: !p.crease })}>
                    {p.crease ? "✓ Crease drawn" : "◗ Draw crease"}
                  </button>
                </div>
                <div className="hd-sechint">An arc in front — for a net off the goal line.</div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Size</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${(p.size || 1) >= 0.85 ? " on" : ""}`}
                    onClick={() => updateById(p.id, { size: 1 })}>NHL</button>
                  <button className={`hd-mini${(p.size || 1) < 0.85 ? " on" : ""}`}
                    onClick={() => updateById(p.id, { size: 0.62 })}>Mite</button>
                </div>
              </div>
            </>
          )}
          {p.kind === "tire" && (
            <>
              <div className="hd-field">
                <div className="hd-poprow">
                  <button className={`hd-mini${p.goalie ? " on" : ""}`}
                    onClick={() => updateById(p.id, { goalie: !p.goalie })}>
                    {p.goalie ? "✓ Keeper on the tire" : "🥅 Keeper on the tire"}
                  </button>
                </div>
                <div className="hd-sechint">Defends shots all the way around.</div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Size</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${(p.size || 1) >= 0.8 ? " on" : ""}`}
                    onClick={() => updateById(p.id, { size: 1 })}>Large</button>
                  <button className={`hd-mini${(p.size || 1) < 0.8 ? " on" : ""}`}
                    onClick={() => updateById(p.id, { size: 0.55 })}>Small</button>
                </div>
                <div className="hd-sechint">Drag to move.</div>
              </div>
            </>
          )}
          {p.kind === "stick" && (
            <div className="hd-field">
              <div className="hd-sectitle">Shoots</div>
              <div className="hd-poprow">
                <button className={`hd-mini${(p.hand || "R") === "R" ? " on" : ""}`}
                  onClick={() => updateById(p.id, { hand: "R" })}>R</button>
                <button className={`hd-mini${p.hand === "L" ? " on" : ""}`}
                  onClick={() => updateById(p.id, { hand: "L" })}>L</button>
              </div>
              <div className="hd-sechint">Flips the blade for a left- or right-handed stick · drag to move · ring to rotate.</div>
            </div>
          )}
          {p.kind === "light" && (() => {
            const cues = p.cues || [];
            const nextColor = c => LIGHT_COLORS[(LIGHT_COLORS.indexOf(c) + 1) % LIGHT_COLORS.length];
            const setCues = next => updateById(p.id, { cues: next });
            return (
              <>
                <div className="hd-field">
                  <div className="hd-sectitle">Idle color</div>
                  <div className="hd-poprow">
                    {LIGHT_COLORS.map(c => (
                      <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                        onClick={() => updateById(p.id, { color: c })} />
                    ))}
                  </div>
                </div>
                {(() => {
                  const mode = lightMode(p);
                  const MODES = [
                    ["reactive", "Reactive", "shuffles + loops the cues — different route each run, based on timing"],
                    ["sequence", "Sequence", "plays the cues in order, once — consistent route every run"],
                    ["random", "Random", "a random route each play — the light cues it as the player reaches the branch"],
                    ["always", "Always", "one designated cue's route always runs, no matter what"],
                  ];
                  const distinct = [...new Set(cues.map(c => c.color))];
                  const hint = (MODES.find(m => m[0] === mode) || MODES[0])[2];
                  return (
                    <>
                      <div className="hd-field">
                        <div className="hd-sectitle">Mode</div>
                        <div className="hd-sechint">{hint}</div>
                        <div className="hd-poprow">
                          {MODES.map(([m, lbl]) => (
                            <button key={m} className={`hd-mini${mode === m ? " on" : ""}`}
                              onClick={() => updateById(p.id, { mode: m, ...(m === "always" && !p.alwaysColor ? { alwaysColor: distinct[0] || p.color } : {}) })}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                      </div>
                      {mode === "always" && (
                        <div className="hd-field">
                          <div className="hd-sectitle">Route</div>
                          <div className="hd-poprow">
                            {distinct.length
                              ? distinct.map(c => (
                                  <div key={c} className={`hd-swatch${sameColor(p.alwaysColor, c) ? " on" : ""}`} title="the cue whose route always runs"
                                    style={{ background: c, cursor: "pointer" }} onClick={() => updateById(p.id, { alwaysColor: c })} />
                                ))
                              : <span className="hd-sechint">add a cue colour below first</span>}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className="hd-field">
                  <div className="hd-sectitle">Cue timeline</div>
                  <div className="hd-sechint">The colours the screen shows{(lightMode(p) === "reactive" || lightMode(p) === "random") ? " (order randomised per run)" : ""}. Cognitive-training light · drag to move · ring to rotate.</div>
                  {cues.map((c, i) => (
                    <Fragment key={i}>
                      <div className="hd-poprow">
                        <div className="hd-swatch on" title="Change colour" style={{ background: c.color, cursor: "pointer" }}
                          onClick={() => setCuePick(v => (v === i ? null : i))} />
                        <Stepper value={+(c.dur || 0).toFixed(1)} step={0.5} min={0.5}
                          onChange={v => setCues(cues.map((q, j) => j === i ? { ...q, dur: v } : q))} />
                        <button className="hd-mini" onClick={() => { setCues(cues.filter((_, j) => j !== i)); setCuePick(null); }}><Icon name="close" size={13} /></button>
                      </div>
                      {cuePick === i && (
                        <div className="hd-poprow">
                          {LIGHT_COLORS.map(col => (
                            <div key={col} className={`hd-swatch${c.color === col ? " on" : ""}`} style={{ background: col, cursor: "pointer" }}
                              onClick={() => { setCues(cues.map((q, j) => j === i ? { ...q, color: col } : q)); setCuePick(null); }} />
                          ))}
                        </div>
                      )}
                    </Fragment>
                  ))}
                  <div className="hd-poprow">
                    <button className="hd-mini" onClick={() => setCues([...cues, { color: LIGHT_COLORS[cues.length % LIGHT_COLORS.length], dur: 2 }])}>
                      + Add cue
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
          {(p.kind === "bumper" || p.kind === "deker" || p.kind === "passer") && (
            <div className="hd-field">
              <div className="hd-sechint">
                {p.kind === "deker" ? "Stickhandle under the stick · " : p.kind === "passer" ? "Pucks rebound off the face · " : ""}drag to move · ring to rotate.
              </div>
            </div>
          )}
          {p.kind === "mark" && (
            <>
              <div className="hd-field">
                <div className="hd-sectitle">Color</div>
                <div className="hd-poprow">
                  {["#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#ffffff", "#14202b"].map(c => (
                    <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                      onClick={() => updateById(p.id, { color: c })} />
                  ))}
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Style</div>
                <div className="hd-poprow">
                  {PEN_STYLES.map(([s, lbl]) => (
                    <button key={s} className={`hd-mini${(p.style || "solid") === s ? " on" : ""}`} onClick={() => updateById(p.id, { style: s })}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Thickness</div>
                <div className="hd-poprow">
                  <input type="range" min={0.5} max={3} step={0.1} value={p.width || 1.1} style={{ flex: 1, minWidth: 80 }}
                    onChange={e => updateById(p.id, { width: parseFloat(e.target.value) })} />
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Fill</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${!p.fill ? " on" : ""}`} onClick={() => updateById(p.id, { fill: null })}>None</button>
                  {["#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#ffffff", "#14202b"].map(c => (
                    <div key={c} className={`hd-swatch${p.fill === c ? " on" : ""}`} style={{ background: c }}
                      onClick={() => updateById(p.id, { fill: c, fillOp: p.fillOp != null ? p.fillOp : 0.25 })} />
                  ))}
                </div>
                {p.fill && (
                  <div className="hd-poprow">
                    <span>Opacity</span>
                    <input type="range" min={0.05} max={0.9} step={0.05} value={p.fillOp != null ? p.fillOp : 0.25}
                      style={{ flex: 1, minWidth: 80 }}
                      onChange={e => updateById(p.id, { fillOp: parseFloat(e.target.value) })} />
                  </div>
                )}
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Size &amp; proportion</div>
                <div className="hd-poprow">
                  <span>Size</span>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1 / 1.12, 1 / 1.12)}>−</button>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1.12, 1.12)}>＋</button>
                  <span style={{ marginLeft: 8 }}>Wide</span>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1 / 1.12, 1)}>−</button>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1.12, 1)}>＋</button>
                  <span style={{ marginLeft: 8 }}>Tall</span>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1, 1 / 1.12)}>−</button>
                  <button className="hd-mini" onClick={() => scaleMark(p.id, 1, 1.12)}>＋</button>
                </div>
                <div className="hd-poprow">
                  <span>Rotate</span>
                  <button className="hd-mini" onClick={() => rotateMark(p.id, -15)}>↺ 15°</button>
                  <button className="hd-mini" onClick={() => rotateMark(p.id, 15)}>↻ 15°</button>
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-poprow">
                  <button className={`hd-mini${markEdit ? " on" : ""}`} onClick={() => setMarkEdit(v => !v)}>
                    {markEdit ? "Done editing" : "Edit points"}
                  </button>
                </div>
                {markEdit && <div className="hd-sechint">Drag a dot to re-shape; tap one to toggle sharp corner (square) ↔ smooth (round).</div>}
              </div>
            </>
          )}
          {p.kind === "player" && (
            <>
              {/* Waypoint navigator at the very top — the player is waypoint 1
                  (the start); step into the route from here */}
              {p.path.length > 0 && (
                <div className="hd-field">
                  <div className="hd-sectitle">Route points</div>
                  <div className="hd-poprow">
                    <button className="hd-mini" disabled>‹ Prev</button>
                    <span className="hd-sechint">Start · {p.path.length} point{p.path.length > 1 ? "s" : ""} follow</span>
                    <button className="hd-mini" onClick={() => navPopup({ type: "point", id: p.id, seg: 0 })}>Next ›</button>
                  </div>
                </div>
              )}
              {/* Route — build/extend the skating path */}
              {!p.defense && routeField()}
              {/* initial skate direction — the first leg out of the start */}
              {p.path.length > 0 && !p.defense && (
                <div className="hd-field">
                  <div className="hd-sectitle">Skate direction</div>
                  <div className="hd-poprow">
                    <button className={`hd-mini${dirOf(p.path[0]) === "fwd" ? " on" : ""}`}
                      onClick={() => setSegDir(p.id, 0, "fwd")}>Forwards</button>
                    <button className={`hd-mini${dirOf(p.path[0]) === "bwd" ? " on" : ""}`}
                      onClick={() => setSegDir(p.id, 0, "bwd")}>Backwards</button>
                  </div>
                  <div className="hd-sechint">Applies from here on, until you change it at a later point.</div>
                </div>
              )}
              {/* the name doubles as the whiteboard symbol, so it's offered from
                  the same shorthand list — pick LW here and the board reads LW.
                  A preset clears any explicit sym= so the new name shows through */}
              <div className="hd-field">
                <div className="hd-sectitle">Name</div>
                <div className="hd-poprow">
                  {WB_SYMS.map(s => (
                    <button key={s} className={`hd-mini${p.label === s ? " on" : ""}`}
                      onClick={() => updateById(p.id, { label: s, sym: "" })}>{s}</button>
                  ))}
                </div>
                <div className="hd-poprow">
                  <input className="hd-input" style={{ width: 56 }} value={p.label} maxLength={3}
                    onChange={e => updateById(p.id, { label: e.target.value })} />
                </div>
                {whiteboard && <div className="hd-sechint">Also the whiteboard symbol, unless one is set below.</div>}
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Color</div>
                <div className="hd-poprow">
                  {COLORS.map(c => (
                    <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                      onClick={() => updateById(p.id, { color: c })} />
                  ))}
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Shoots</div>
                <div className="hd-poprow">
                  <button className={`hd-mini${(p.hand || "R") === "R" ? " on" : ""}`}
                    onClick={() => updateById(p.id, { hand: "R" })}>Right</button>
                  <button className={`hd-mini${p.hand === "L" ? " on" : ""}`}
                    onClick={() => updateById(p.id, { hand: "L" })}>Left</button>
                </div>
                <div className="hd-sechint">Which side the player holds the stick — flips the blade.</div>
              </div>
              {whiteboard && (
                <div className="hd-field">
                  <div className="hd-sectitle">Whiteboard icon</div>
                  <div className="hd-poprow" style={{ flexWrap: "wrap" }}>
                    {/* Auto = follow the name; the button shows what that resolves to */}
                    <button className={`hd-mini${!(p.sym && p.sym.trim()) ? " on" : ""}`}
                      onClick={() => updateById(p.id, { sym: "" })}>Auto ({symOf({ ...p, sym: "" })})</button>
                    {WB_SYMS.map(s => (
                      // an icon names the player too while they're still an unnamed
                      // P1/P2 — otherwise it's an override and the real name stands
                      <button key={s} className={`hd-mini${p.sym === s ? " on" : ""}`}
                        onClick={() => updateById(p.id, /^P\d+$/.test(p.label || "") ? { sym: s, label: s } : { sym: s })}>{s}</button>
                    ))}
                  </div>
                  <div className="hd-poprow">
                    <input className="hd-input" style={{ width: 56 }} value={p.sym || ""} maxLength={3}
                      placeholder="X"
                      onChange={e => updateById(p.id, { sym: e.target.value })} />
                  </div>
                </div>
              )}
              {(() => {
                // a carried puck now sits under the player, so surface a direct
                // route to its popup here instead of tapping the blade
                const carried = pieces.find(q => q.kind === "puck" && q.carrier === p.id);
                return (
                  <div className="hd-field">
                    <div className="hd-sectitle">Puck</div>
                    <div className="hd-poprow">
                      {carried ? (
                        <button className="hd-mini" onClick={() => { setSelectedId(carried.id); setPopup({ type: "piece", id: carried.id }); }}>● Edit puck</button>
                      ) : (
                        <button className="hd-mini" onClick={() => { const pk = makePiece("puck", { x: p.x, y: p.y }); pk.carrier = p.id; setPieces(ps => [...ps, pk]); }}>● Give puck</button>
                      )}
                    </div>
                  </div>
                );
              })()}
              {/* unified delay trigger: hold the whole route at the start until a
                  timer, another player's arrival, or another player's puck action */}
              {p.path.length > 0 && !p.defense && (
                <DelayTrigger
                  sub="Delay start"
                  players={pieces.filter(q => q.kind === "player" && q.id !== p.id)}
                  actorIds={puckActors(pieces)}
                  nameOf={nameOf}
                  value={p.wait && p.wait.on
                    ? { mode: p.wait.mode || "waypoint", on: p.wait.on, at: p.wait.at, secs: 0 }
                    : { mode: "timer", secs: (p.path[0] && p.path[0].stop) || 0 }}
                  onChange={v => {
                    if (v.mode === "none") { updateById(p.id, { wait: null }); updateSeg(p.id, 0, { stop: 0 }); }
                    else if (v.mode === "timer") { updateById(p.id, { wait: null }); updateSeg(p.id, 0, { stop: v.secs || 0 }); }
                    else if (v.on) { updateById(p.id, { wait: { on: v.on, at: v.at, mode: v.mode } }); updateSeg(p.id, 0, { stop: 0 }); }
                    else updateById(p.id, { wait: null });
                  }}
                />
              )}
              {/* light reactions live on the branch waypoint (route end, nearest the
                  light); a route-less player branches from its start, so show them here */}
              {!p.path.length && renderLightReactions(p)}
              {/* additional options — the on/off behaviours grouped together */}
              <div className="hd-field">
                <div className="hd-sectitle">Additional options</div>
                {p.path.length > 0 && !p.defense && (
                  <>
                    <div className="hd-poprow">
                      <button className={`hd-mini${p.holdLine ? " on" : ""}`}
                        onClick={() => updateById(p.id, { holdLine: !p.holdLine })}>
                        {p.holdLine ? "✓ Hold at blue line" : "Hold at blue line"}
                      </button>
                    </div>
                    <div className="hd-sechint">Waits for the puck to enter the zone.</div>
                  </>
                )}
                <div className="hd-poprow">
                  <button className={`hd-mini${p.defense ? " on" : ""}`}
                    onClick={() => updateById(p.id, { defense: !p.defense })}>
                    {p.defense ? "✓ Auto defense" : "🛡 Auto defense"}
                  </button>
                </div>
                <div className="hd-sechint">Holds the slot, tracks the puck goal-side.</div>
              </div>
            </>
          )}
          {p.kind === "puck" && chainEvents(p).length > 0 && chainList(p, null)}
          {p.kind === "puck" && (
            <div className="hd-field">
              <div className="hd-poprow">
                <button className="hd-mini" onClick={() => makePuckPile(p.id)}>
                  <Icon name="puck" size={13} /> Make a pile
                </button>
              </div>
              <div className="hd-sechint">Scatters a few loose pucks here.</div>
            </div>
          )}
          {p.kind === "puck" && pieces.some(q => q.kind === "player") && (() => {
            // a player can only carry one puck — disable any already holding a
            // DIFFERENT puck (this puck's own carrier stays enabled to un-assign)
            const takenBy = new Set(pieces.filter(q => q.kind === "puck" && q.id !== p.id && q.carrier).map(q => q.carrier));
            const anyTaken = pieces.some(pl => pl.kind === "player" && takenBy.has(pl.id) && p.carrier !== pl.id);
            return (
            <div className="hd-field">
              <div className="hd-sectitle">On stick of</div>
              <div className="hd-poprow">
                {pieces.filter(q => q.kind === "player").map(pl => {
                  const taken = takenBy.has(pl.id) && p.carrier !== pl.id;
                  return (
                    <button key={pl.id} className={`hd-mini${p.carrier === pl.id ? " on" : ""}`}
                      disabled={taken}
                      title={taken ? `${nameOf(pl.id)} already has a puck` : undefined}
                      onClick={() => updateById(p.id, { carrier: p.carrier === pl.id ? null : pl.id })}>
                      {nameOf(pl.id)}
                    </button>
                  );
                })}
              </div>
              {anyTaken && <div className="hd-sechint">Greyed-out players already carry another puck.</div>}
              {p.carrier && p.path.length > 0 && (
                <div className="hd-sechint">
                  Rides the blade, releases when the carrier reaches the puck’s spot (dashed ring), then runs its own route.
                </div>
              )}
              {(() => {
                // a route-less carrier hosts its chain on the player popup, so
                // point the user there rather than duplicating it here
                const head = p.carrier || (p.pickup && p.pickup.to);
                const hp = head && pieces.find(q => q.id === head && q.kind === "player");
                if (!hp || hp.path.length) return null;
                return (
                  <div className="hd-sechint">
                    {hp.id} has no route — set its pass / shoot / rebound from the {hp.id} player popup.
                  </div>
                );
              })()}
            </div>
            );
          })()}
          {/* Route — pucks build their own path here; players have it at the top */}
          {p.kind === "puck" && !p.defense && routeField()}
          {(p.kind === "player" || p.kind === "puck") && (
            <div className="hd-field">
              <div className="hd-sectitle">{p.kind === "player" ? "Skating speed" : "Speed"} ×{(p.speed || 1).toFixed(2)}</div>
              <div className="hd-poprow">
                <input type="range" min={0.5} max={2} step={0.05} value={p.speed || 1} style={{ flex: 1, minWidth: 80 }}
                  onChange={e => updateById(p.id, { speed: parseFloat(e.target.value) })} />
              </div>
            </div>
          )}
          {p.kind !== "player" && p.path.length > 0 && (
            <div className="hd-field">
              <div className="hd-sectitle">Start delay</div>
              <div className="hd-poprow">
                <Stepper value={p.path[0].stop || 0} onChange={v => updateSeg(p.id, 0, { stop: v })} />
                <span className="hd-sechint">seconds</span>
              </div>
            </div>
          )}
          {p.kind !== "player" && p.kind !== "label" && p.kind !== "mark" && (
            <div className="hd-field">
              <div className="hd-sectitle">Name</div>
              <div className="hd-poprow">
                <input className="hd-input" style={{ flex: 1, minWidth: 90 }} value={p.label || ""} placeholder={p.id}
                  onChange={e => updateById(p.id, { label: e.target.value.replace(/[\s,]+/g, "_") })} />
              </div>
            </div>
          )}
          {p.group && (
            <div className="hd-field">
              <div className="hd-sectitle">Group</div>
              <div className="hd-poprow">
                <span>◇ {p.group}</span>
                <button className="hd-mini" title="Select the whole group"
                  onClick={() => { setPopup(null); setSelectedId(null); setMultiSel(groupMembers(p.group)); }}>Select group</button>
                <button className="hd-mini" title="Remove this piece from the group"
                  onClick={() => updateById(p.id, { group: undefined })}>Leave</button>
              </div>
            </div>
          )}
          {/* Actions panel at the player's standing/start spot — just above the
              bottom row of buttons */}
          {p.kind === "player" && ActionSteps(p, -1)}
          {TOOL_KINDS.includes(p.kind) && (
            <div className="hd-field">
              <div className="hd-sectitle">Change to</div>
              <div className="hd-poprow" style={{ flexWrap: "wrap" }}>
                {TOOL_KINDS.filter(k => k !== p.kind).map(k => (
                  <button key={k} className="hd-mini hd-swapbtn iconlbl" title={`Change to ${k}`}
                    onClick={() => updateById(p.id, { kind: k, color: defaultColor(k) })}>
                    {toolImg(k, whiteboard, wbCircle)}<small>{k}</small></button>
                ))}
              </div>
            </div>
          )}
          {/* same table the Edit bar's selection strip renders, so the panel and
              the bar can't offer different things for the same piece */}
          <div className="hd-poprow" style={{ marginTop: 2 }}>
            {pieceActions(p, false).map(a => (
              <button key={a.key} className={`hd-mini${a.danger ? " danger" : ""}`} title={a.title} onClick={a.on}>
                {a.icon && <Icon name={a.icon} size={15} />} {a.label}
              </button>
            ))}
          </div>
        </>
      );
    } else if (popup.type === "line") {
      const fork = popup.fork || null;
      const route = routeSegs(p, fork);
      const s = route[popup.seg];
      if (!s || !popup.pt) return null;
      anchorPt = popup.pt;
      title = fork ? `Reaction · leg ${popup.seg + 1}` : `${p.id} · leg ${popup.seg + 1}`;
      body = (
        <>
          <div className="hd-field">
            <div className="hd-sectitle">Leg shape</div>
            <div className="hd-poprow">
              {curveButtons(t => changeSegType(p.id, popup.seg, t, fork), () => drawRouteMode(p.id, fork), s.type)}
            </div>
          </div>
          <div className="hd-poprow">
            <button className="hd-mini" onClick={() => addPointAt(p.id, popup.seg, popup.pt, fork)}>
              ＋ Add point here
            </button>
            <button className="hd-mini danger" onClick={() => { deleteSeg(p.id, popup.seg, fork); flash("Leg removed — Undo restores it"); }}>
              Delete leg
            </button>
          </div>
        </>
      );
    } else {
      const fork = popup.fork || null;
      const rp = routePiece(p, fork);        // origin + path of the base route or the fork
      const route = rp.path;
      const uSeg = (k, patch) => updateSeg(p.id, k, patch, fork);   // writes to the active route
      const i = popup.seg;
      const s = route[i];
      if (!s) return null;
      anchorPt = { x: s.x, y: s.y };
      const next = route[i + 1];
      // ONE numbering everywhere: the standing start is point 0 (matching the
      // DSL — "pass=2" fires at point 2), so route[i] is point i+1 of
      // route.length. Title, pager, and DSL references all agree.
      title = fork ? `Reaction · point ${i + 1}/${route.length}` : `${nameOf(p.id)} · point ${i + 1}/${route.length}`;
      // Prev at waypoint 0: a fork steps back to its branch (the base route's end);
      // a base route steps back to the player/start popup.
      const branchNav = () => p.path.length ? { type: "point", id: p.id, seg: p.path.length - 1 } : { type: "piece", id: p.id };
      const goSeg = j => navPopup(j < 0 ? (fork ? branchNav() : { type: "piece", id: p.id })
        : { type: "point", id: p.id, seg: j, ...(fork ? { fork } : {}) });
      body = (
        <>
          {route.length > 0 && (
            <div className="hd-field">
              <div className="hd-sectitle">Route points</div>
              <div className="hd-poprow">
                <button className="hd-mini" onClick={() => goSeg(i - 1)}>‹ {fork && i === 0 ? "Branch" : "Prev"}</button>
                <span className="hd-sechint">Point {i + 1} of {route.length}</span>
                <button className="hd-mini" disabled={i >= route.length - 1}
                  onClick={() => goSeg(i + 1)}>Next ›</button>
              </div>
            </div>
          )}
          {/* whose route this waypoint belongs to — quick facts + a click-through
              into that piece's own editor (position preserved when pinned) */}
          <div className="hd-field">
            <div className="hd-sectitle">{p.kind === "player" ? "Player" : "Puck"} on this {fork ? "reaction" : "route"}</div>
            <div className="hd-poprow">
              <span className="hd-swatch" style={{ background: p.color, width: 16, height: 16, cursor: "default" }} />
              <span style={{ fontWeight: 700 }}>{nameOf(p.id)}</span>
              <button className="hd-mini" onClick={() => navPopup({ type: "piece", id: p.id })}>Open ›</button>
            </div>
          </div>
          {/* the branch waypoint carries the reaction controls: the base route's end
              (light reactions), or a SKATE reaction's end (chain another reaction) */}
          {p.kind === "player" && i === route.length - 1 && (!fork
            ? renderLightReactions(p, null)
            : branchEndsOpen(p, fork) ? renderLightReactions(p, fork) : null)}
          <div className="hd-field">
            <div className="hd-sectitle">Note</div>
            <div className="hd-poprow">
              <input className="hd-input" style={{ flex: 1, minWidth: 90 }}
                value={s.desc != null ? s.desc : (s.name || "")}
                placeholder={zoneAt(s.x, s.y) || "describe this spot"}
                onChange={e => uSeg(i, { desc: e.target.value || undefined, name: undefined })} />
            </div>
          </div>
          {(s.desc != null ? s.desc : s.name) && (
            <div className="hd-field">
              <div className="hd-sectitle">Show as</div>
              <div className="hd-sechint">Auto decides for you · Present reads it as a caption during playback · Label pins it on the ice.</div>
              <div className="hd-poprow">
                {[["auto", "Auto"], ["preso", "Present"], ["label", "Label"]].map(([m, lab]) => (
                  <button key={m} className={`hd-mini${(s.dmode || "auto") === m ? " on" : ""}`}
                    onClick={() => uSeg(i, {
                      desc: s.desc != null ? s.desc : s.name, name: undefined,   // migrate legacy NAME
                      ...(m === "label"
                        ? { dmode: "label", dsize: s.dsize || 1, dox: s.dox || 0, doy: s.doy != null ? s.doy : -5 }
                        : { dmode: m }),
                    })}>{lab}</button>
                ))}
              </div>
            </div>
          )}
          {s.dmode === "label" && (s.desc != null ? s.desc : s.name) && (
            <div className="hd-field">
              <div className="hd-sectitle">Label size</div>
              <div className="hd-poprow">
                <Stepper value={+(s.dsize || 1).toFixed(2)} onChange={v => uSeg(i, { dsize: Math.max(0.4, v) })} step={0.2} min={0.4} suffix="×" />
                <span className="hd-sechint">drag it to move</span>
              </div>
            </div>
          )}
          {next ? (
            <>
              {/* unified delay trigger: pause here on a timer, another player's
                  arrival, or another player's puck action (players only — a
                  puck's mid-route waitOn isn't resolved by the timing engine) */}
              {p.kind === "player" ? (
                <DelayTrigger
                  sub="Pause here"
                  players={pieces.filter(q => q.kind === "player" && q.id !== p.id)}
                  actorIds={puckActors(pieces)}
                  nameOf={nameOf}
                  value={next.waitOn && next.waitOn.on
                    ? { mode: next.waitOn.mode || "waypoint", on: next.waitOn.on, at: next.waitOn.at, secs: 0 }
                    : { mode: "timer", secs: next.stop || 0 }}
                  onChange={v => {
                    if (v.mode === "none") uSeg(i + 1, { waitOn: null, stop: 0 });
                    else if (v.mode === "timer") uSeg(i + 1, { waitOn: null, stop: v.secs || 0 });
                    else if (v.on) uSeg(i + 1, { waitOn: { on: v.on, at: v.at, mode: v.mode }, stop: 0 });
                    else uSeg(i + 1, { waitOn: null });
                  }}
                />
              ) : (
                <div className="hd-field">
                  <div className="hd-sectitle">Pause here</div>
                  <div className="hd-poprow">
                    <Stepper value={next.stop || 0} onChange={v => uSeg(i + 1, { stop: v })} />
                    <span className="hd-sechint">seconds</span>
                  </div>
                </div>
              )}
              {p.kind === "player" && (
                <div className="hd-field">
                  <div className="hd-poprow">
                    <button className={`hd-mini${next.jump ? " on" : ""}`}
                      onClick={() => uSeg(i + 1, { jump: !next.jump })}>
                      <Icon name={next.jump ? "check" : "sauce"} size={15} /> Jump here
                    </button>
                  </div>
                  <div className="hd-sechint">Hops as they pass this spot.</div>
                </div>
              )}
              <div className="hd-field">
                <div className="hd-sectitle">{p.kind === "player" ? "Skating speed after" : "Speed after"} ×{(next.rate || 1).toFixed(2)}</div>
                <div className="hd-poprow">
                  <input type="range" min={0.5} max={2} step={0.05} value={next.rate || 1} style={{ flex: 1, minWidth: 70 }}
                    onChange={e => uSeg(i + 1, { rate: parseFloat(e.target.value) })} />
                </div>
              </div>
              <div className="hd-field">
                <div className="hd-sectitle">Next leg</div>
                <div className="hd-poprow">
                  {curveButtons(t => changeSegType(p.id, i + 1, t, fork), () => drawRouteMode(p.id, fork), next.type)}
                </div>
              </div>
              {/* point type — only when both adjoining legs are curves (there's a
                  handle on each side to link). Corner = independent handles;
                  Smooth = handles kept collinear (auto-smooths); Sym = collinear + equal */}
              {s.type !== "L" && next.type !== "L" && (
                <div className="hd-field">
                  <div className="hd-sectitle">Corner style</div>
                  <div className="hd-poprow">
                    {[["corner", "ptCorner", "Sharp", "a hard turn at this point"],
                      ["smooth", "ptSmooth", "Smooth", "rounds the turn through this point"],
                      ["sym", "ptSym", "Even", "rounds it evenly on both sides"]].map(([j, ic, lbl, tip]) => (
                      <button key={j} className={`hd-mini iconlbl${(s.join || "corner") === j ? " on" : ""}`} title={`${lbl} — ${tip}`}
                        onClick={() => setJoint(p.id, i, j, fork)}><Icon name={ic} /><small>{lbl}</small></button>
                    ))}
                  </div>
                </div>
              )}
              {p.kind === "player" && (
                <div className="hd-field">
                  <div className="hd-sectitle">Skate direction</div>
                  <div className="hd-poprow">
                    <button className={`hd-mini${dirOf(next) === "fwd" ? " on" : ""}`}
                      onClick={() => setSegDir(p.id, i + 1, "fwd", fork)}>Forwards</button>
                    <button className={`hd-mini${dirOf(next) === "bwd" ? " on" : ""}`}
                      onClick={() => setSegDir(p.id, i + 1, "bwd", fork)}>Backwards</button>
                  </div>
                  <div className="hd-sechint">Applies from here on, until you change it at a later point.</div>
                  {/* the player pivots here, so which shoulder they open over is a
                      real choice — by default they turn to face the puck in play */}
                  {dirOf(next) !== dirOf(s) && (
                    <>
                      <div className="hd-sectitle" style={{ marginTop: 6 }}>Turn toward</div>
                      <div className="hd-poprow">
                        {[["left", "Left", "pivots over their left shoulder"],
                          ["right", "Right", "pivots over their right shoulder"],
                          ["player", "Player", "turns toward the nearest other player"],
                          ["puck", "Puck", "turns toward the puck on a player's stick"]].map(([k, lbl, tip]) => (
                          <button key={k} className={`hd-mini${(next.turn || "puck") === k ? " on" : ""}`}
                            title={`${lbl} — ${tip}`} onClick={() => uSeg(i + 1, { turn: k })}>{lbl}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {p.kind === "puck" && (
                <div className="hd-field">
                  <div className="hd-sectitle">Then</div>
                  <div className="hd-poprow">
                    {["carry", "pass", "shot"].map(m => (
                      <button key={m} className={`hd-mini${(next.mode || "carry") === m ? " on" : ""}`}
                        onClick={() => uSeg(i + 1, { mode: m })}>
                        {m[0].toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (p.kind === "player" || p.kind === "puck") && !p.defense ? (
            <div className="hd-field">
              <div className="hd-sectitle">Route</div>
              <div className="hd-sechint">Tap a shape to extend the {fork ? "reaction" : "route"}, or draw freehand.</div>
              <div className="hd-poprow">{curveButtons(t => addSegment(p.id, t, fork), () => drawRouteMode(p.id, fork))}</div>
            </div>
          ) : (
            <div className="hd-poprow hd-stephint">End of {fork ? "reaction" : "route"}</div>
          )}
          {/* route end: mark that the player stops here → a ‖ stop mark replaces
              the direction arrowhead (skating-diagram convention). Offered on a base
              route end and on a skate reaction that ends here (not one that passes/
              shoots — that end is an action circle — nor one that chains onward). */}
          {!next && p.kind === "player" && (() => {
            if (fork) {
              const fn = forkAt(p, fork);
              const chains = fn && (fn.forks || []).some(g => g.path && g.path.length);
              if (!branchEndsOpen(p, fork) || chains) return null;
            }
            return (
              <div className="hd-field">
                <div className="hd-poprow">
                  <button className={`hd-mini${s.endStop ? " on" : ""}`}
                    onClick={() => uSeg(i, { endStop: s.endStop ? undefined : true })}>
                    {s.endStop ? "✓ Stops here" : "Stops here"}
                  </button>
                </div>
                <div className="hd-sechint">Ends with a ‖ stop mark, not an arrow.</div>
              </div>
            );
          })()}
          {p.kind === "player" && ActionSteps(p, i, fork)}
          <div className="hd-poprow" style={{ marginTop: 2 }}>
            <button className="hd-mini" title="Pin this waypoint in place so it can't be moved or edited by accident."
              onClick={() => uSeg(i, { lock: true })}>🔒 Lock point</button>
            <button className="hd-mini danger" onClick={() => deleteSeg(p.id, i, fork)}>Delete point</button>
          </div>
        </>
      );
    }

    // ── Lock overlay ─────────────────────────────────────────────────────
    // A locked piece / waypoint can't be edited: its popup collapses to an
    // Unlock panel. An unlocked one gains a Lock toggle at the bottom. (A
    // waypoint is also locked when its whole piece is.)
    if (p && (popup.type === "piece" || popup.type === "line" || popup.type === "point")) {
      const seg = popup.type === "point" ? routePiece(p, popup.fork || null).path[popup.seg] : null;
      const wpLock = popup.type === "point" && !!seg?.lock;
      if (p.lock || wpLock) {
        const pieceOnly = popup.type === "point" && p.lock && !wpLock;   // locked only via its piece
        body = (
          <div className="hd-field">
            <div className="hd-sectitle">🔒 Locked</div>
            <div className="hd-sechint">
              {pieceOnly
                ? "Locked because its piece is locked."
                : `This ${popup.type === "point" ? "waypoint" : "item"} is pinned — it can't be moved or edited until you unlock it.`}
            </div>
            <div className="hd-poprow">
              {pieceOnly
                ? <button className="hd-mini" onClick={() => navPopup({ type: "piece", id: p.id })}>Open piece ›</button>
                : <button className="hd-mini on" onClick={() => {
                    if (popup.type === "point") updateSeg(p.id, popup.seg, { lock: undefined }, popup.fork || null);
                    else updateById(p.id, { lock: false });
                  }}>🔓 Unlock</button>}
            </div>
          </div>
        );
      } else if (popup.type === "line") {
        // piece/point popups carry the Lock button inline in their action row;
        // a leg popup has no such row, so it keeps the appended section
        body = <>{body}<div className="hd-field"><div className="hd-poprow">
          <button className="hd-mini" onClick={() => updateById(p.id, { lock: true })}>🔒 Lock {p.kind === "player" ? "player" : "item"}</button></div>
          <div className="hd-sechint">Pin in place so it can't be moved or edited by accident.</div></div></>;
      }
    }

    // a positioned popup keeps its own px spot, so a briefly off-screen anchor
    // (e.g. a far waypoint during Prev/Next) must not blank it out
    const a = popoutAnchor(anchorPt) || (popPos ? { lx: 50, ty: 50 } : null);
    if (!a) return null;
    // An UNPINNED popup pins to the edge OPPOSITE the item it belongs to so it
    // opens completely clear of what's being selected/edited (and its handles) —
    // no need to move or minimize just to see the item. Item in the top half →
    // popup pins along the bottom (above the play bar); item in the bottom half →
    // pins along the top (below the floating play dock). All popups carry a
    // minimize (header only) + maximize (fill the height) control, and drag the
    // header to move it (bounded — it can't leave the screen). The pin toggle
    // keeps it open + re-targeting (float), and — on a wide screen — the dock
    // toggle moves it to a fixed right sidebar (finalStyle ignored; CSS owns it).
    const collapsed = !docked && popState === "min";   // the sidebar always shows its body
    const maxed = popState === "max";
    const lx = Math.max(16, Math.min(84, a.lx));
    const atBottom = a.ty < 50;
    const common = { left: `${lx}%`, transform: `translateX(-50%) translate(${popOff.x}px, ${popOff.y}px)` };
    const style = atBottom
      ? { ...common, bottom: `calc(var(--hd-b) + 60px)`,
          maxHeight: collapsed ? "none"
            : maxed ? "calc(100% - var(--hd-b) - 60px - env(safe-area-inset-top) - var(--hd-pintop, 78px))"
            : "52%" }
      : { ...common, top: `calc(env(safe-area-inset-top) + var(--hd-pintop, 78px))`,
          maxHeight: collapsed ? "none"
            : maxed ? "calc(100% - env(safe-area-inset-top) - var(--hd-pintop, 78px) - var(--hd-b) - 60px)"
            : "52%" };
    // layer explicit position (popPos) and size (popDim) over the anchor style —
    // they're independent, so a placed/frozen popup can still carry the user's
    // resize, and an auto-height (popDim.h == null) freeze grows to fit content
    const finalStyle = { ...style };
    // Position is honoured even when collapsed — that's what keeps the header
    // still. Only the HEIGHT is dropped: a collapsed panel is its header.
    if (popPos) {
      finalStyle.left = `${popPos.left}px`;
      finalStyle.top = `${popPos.top}px`;
      finalStyle.bottom = "auto";
      finalStyle.transform = `translate(${popOff.x}px, ${popOff.y}px)`;   // px position: no centering
    }
    if (popDim) {
      finalStyle.width = `${popDim.w}px`;
      if (!collapsed && popDim.h != null) { finalStyle.height = `${popDim.h}px`; finalStyle.maxHeight = "none"; }
    }
    const boxed = !collapsed && (popPos || popDim);
    const usePreset = () => { setPopPos(null); setPopDim(null); };   // presets re-anchor at default size
    // Collapsing must not MOVE the panel — only shorten it. Pin it to where it
    // is first, so the header stays under the finger that just tapped it.
    // Without this the panel fell back to its anchor style, which is derived
    // from the piece's spot on the ice: it slid sideways, and a bottom-anchored
    // one flipped to the top of the screen, so minimising looked like the panel
    // had jumped somewhere else.
    const freezeHere = () => {
      const r = popRef.current?.getBoundingClientRect();
      if (r) setPopPos({ left: Math.round(r.left), top: Math.round(r.top) });
    };
    return (
      <div className={`hd-pop pinned${docked ? " dock" : ""}`} style={docked ? undefined : finalStyle} ref={popRef}
        onScroll={syncPopScroll} onPointerDown={e => e.stopPropagation()}>
        {/* always-visible scrollbar thumb: sticky rail pinned to the viewport
            top, thumb positioned/sized imperatively in syncPopScroll */}
        <div className="hd-sbrail" aria-hidden="true"><div className="hd-sbthumb" ref={sbThumbRef} /></div>
        <div className="hd-pophead"
          {...(docked ? {} : { onPointerDown: popDragStart, onPointerMove: popDragMove,
            onPointerUp: popDragEnd, onPointerCancel: popDragEnd })}>
          {!docked && <span className="hd-grip"><Icon name="grip" size={14} /></span>}
          <span className="hd-poptitle">{title}</span>
          {/* pin (float) + dock (sidebar, wide only): the first .hd-x gets
              margin-left:auto, right-aligning the whole control cluster */}
          <button className={`hd-x${pinMode === "float" ? " on" : ""}`} onPointerDown={e => e.stopPropagation()}
            title={pinMode === "float" ? "Un-pin" : "Pin (floating)"}
            aria-pressed={pinMode === "float"}
            onClick={togglePin}><Icon name={pinMode === "float" ? "pinOn" : "pinOff"} size={15} /></button>
          {isWide && (
            <button className={`hd-x${docked ? " on" : ""}`} onPointerDown={e => e.stopPropagation()}
              title={docked ? "Un-dock" : "Dock to sidebar"}
              aria-pressed={docked}
              onClick={toggleDock}><Icon name={docked ? "sidebarOn" : "sidebar"} size={15} /></button>
          )}
          {!docked && !collapsed && (
            <button className="hd-x" onPointerDown={e => e.stopPropagation()} title="Minimize"
              onClick={() => { freezeHere(); setPopState("min"); }}><Icon name="chevronUp" size={15} /></button>
          )}
          {!docked && (
            <button className="hd-x" onPointerDown={e => e.stopPropagation()} title={maxed ? "Restore" : "Maximize"}
              onClick={() => {
                // expanding a collapsed panel keeps its spot too and grows
                // downward from the header; only the size PRESETS re-anchor
                if (!collapsed) usePreset();
                setPopState(maxed && !boxed ? "mid" : collapsed ? "mid" : "max");
              }}>
              <Icon name={collapsed ? "chevronDown" : (maxed && !boxed) ? "restore" : "expand"} size={15} /></button>
          )}
          <button className="hd-x" onPointerDown={e => e.stopPropagation()}
            onClick={() => { setPopup(null); setPinMode(null); }}><Icon name="close" size={15} /></button>
        </div>
        {!collapsed && body}
        {!collapsed && !docked && (
          // resize: a bottom bar (height) + a bottom-right corner (both). Sticky
          // so they ride the popup's visible bottom edge even while it scrolls.
          <div className="hd-resizebar">
            <div className="hd-resize-h" title="Drag to resize height"
              onPointerDown={e => popResizeStart(e, "h")} onPointerMove={popResizeMove}
              onPointerUp={popResizeEnd} onPointerCancel={popResizeEnd} />
            <div className="hd-resize-c" title="Drag to resize"
              onPointerDown={e => popResizeStart(e, "wh")} onPointerMove={popResizeMove}
              onPointerUp={popResizeEnd} onPointerCancel={popResizeEnd} />
          </div>
        )}
      </div>
    );
  }

  // the planned puck lines (pass / shot / chip / rim travel) drawn from the
  // timing legs. `flat` = plain rink-unit widths for the loupe (which has no
  // non-scaling-stroke context); the main scene uses screen-constant widths.
  function puckPathNodes(flat, casing = false) {
    if (!showPuckPaths) return null;
    // casing pass: same geometry, ice-coloured and wider — rendered once under
    // the ink pass so pass/shot/chip/rim lines stay readable over rink markings
    const W = w => (flat ? w : sw(w)) * lineScale * (casing ? 2.1 : 1);
    const D = d => (flat ? d : sdash(d));
    const INK = casing ? T.ice : T["ice-ink"];
    const ve = flat ? undefined : "non-scaling-stroke";
    // the casing pass runs this whole renderer a second time — it must register
    // its arrival tips in its OWN channel, or the ink pass would count them as
    // earlier arrivals and queue itself back off its own casing. Seed the channel
    // from "main"'s current state (route carats already registered) so both
    // passes evolve identically and land every tip in the same spot.
    const AR_SCENE = flat ? "flat" : casing ? "case" : "main";
    if (AR_SCENE === "case") arrivalReg.set("case", [...(arrivalReg.get("main") || [])]);
    const { plans } = getIntentPlan();   // draw the shot's intent (on net), not a realistic miss
    const z = 1 / (view.s || 1);
    // action-badge centres: a pass/shot released AT a waypoint (not off a player's
    // stick at their standing spot) begins just outside that badge's edge
    const badges = [];
    pieces.forEach(p => { if (p.kind === "player" && p.path.length) { const m = actionWaypoints(p); for (const i of m.keys()) badges.push({ x: p.path[i].x, y: p.path[i].y }); } });
    const START_OFF = ACT_R * ICON_SCALE + 0.9;   // badge radius (rink ft) + a slight gap
    // a fly leg launches/lands at the player's STICK, ~a stick-length off the
    // waypoint centre where the badge sits — so match within that reach
    const nearBadge = (x, y) => { let best = null, bd = 6; for (const b of badges) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } } return best; };
    // which target a shot lands on — landings scatter a few feet across the mouth,
    // so bucket by nearest net rather than exact point. Only the repeat-shot dedup
    // key below uses it; the stagger reads tip positions, not nets.
    const shotTargets = pieces.filter(q => q.kind === "net" || q.kind === "passer" || q.kind === "bumper" || q.kind === "tire");
    const nearNet = (x, y) => { let best = "?", bd = 24; for (const nt of shotTargets) { const d = Math.hypot(nt.x - x, nt.y - y); if (d < bd) { bd = d; best = nt.id; } } return best; };
    // A player firing a pile of pucks from one spot at one net draws the same arrow
    // over and over. Collapse those into ONE mark carrying a count, the way an action
    // circle already tallies repeats, instead of a stack of identical lines. Bucketed
    // by release point (~3ft) rather than exact coordinates: the blade shifts a little
    // between shots as the body settles, and they are still visually the same mark.
    const shotOne = {}, shotN = {};      // `${pk}/${k}` → is the drawn one / how many it stands for
    const shotStagger = {};              // `${pk}/${k}` → extra feet in front of the net
    const groups = {};
    pieces.filter(q => q.kind === "puck" && plans[q.id]).forEach(q => plans[q.id].legs.forEach((L, k, legs) => {
      if (L.type === "fly" && L.shot && (!legs[k + 1] || legs[k + 1].type !== "fly")) {
        // keyed on the SHOOTER as well as the spot: two players standing within a
        // yard of each other are still two marks, not one attributed to whoever
        // happened to shoot shortest
        const g = `${L.by || "?"}|${Math.round(L.x0 / 3)},${Math.round(L.y0 / 3)}|${nearNet(L.x1, L.y1)}`;
        (groups[g] = groups[g] || []).push({ id: `${q.id}/${k}`, len: Math.hypot(L.x1 - L.x0, L.y1 - L.y0) });
      }
    }));
    // the shortest of a group is the one drawn — it reads truest against the net
    Object.values(groups).forEach(list => {
      const lead = list.reduce((a, c) => (c.len < a.len ? c : a));
      list.forEach(sIt => { shotN[sIt.id] = list.length; });
      shotOne[lead.id] = true;
    });
    // ...and only the drawn ones queue for room in front of the net. Group by where
    // the CARET actually lands — the landing point pulled back SHOT_TIP_GAP along the
    // shot's own axis — and NOT by which net it's aimed at: two shots converging on
    // one net from clearly different angles have heads yards apart and need no
    // stagger at all. Same tip rule arrivalBack applies to passes and route carats,
    // so swinging a shooter round the net dissolves the queue the moment they clear.
    // Within a cluster the shortest shot keeps the slot at the net and the longer
    // ones step back, so a close-in shot still reads true against the cage.
    if (arrowStagger) {
      const tips = [];
      pieces.filter(q => q.kind === "puck" && plans[q.id]).forEach(q => plans[q.id].legs.forEach((L, k, legs) => {
        if (!(L.type === "fly" && L.shot && (!legs[k + 1] || legs[k + 1].type !== "fly") && shotOne[`${q.id}/${k}`])) return;
        // the same origin and direction the renderer draws with (badge centre when
        // released at an action circle), so the tip we cluster on is the real one
        const sb = (k === 0 || legs[k - 1].type !== "fly") ? nearBadge(L.x0, L.y0) : null;
        const ox = sb ? sb.x : L.x0, oy = sb ? sb.y : L.y0;
        const len = Math.hypot(L.x1 - ox, L.y1 - oy) || 1;
        const t = gmMove(L.x1, L.y1, -(L.x1 - ox) / len, -(L.y1 - oy) / len, SHOT_TIP_GAP);
        // gm space, so the cluster radius reads the same in every direction under
        // the fill-mode stretch (as the route-end clearance pass does)
        tips.push({ id: `${q.id}/${k}`, len, x: t.x * gmSar, y: t.y / gmSar });
      }));
      const shotClusters = [];
      for (const t of tips) {
        let c = shotClusters.find(c2 => Math.hypot(c2.seed.x - t.x, c2.seed.y - t.y) <= SHOT_CLUSTER_R);
        if (!c) { c = { seed: t, list: [] }; shotClusters.push(c); }
        c.list.push(t);
      }
      for (const c of shotClusters) {
        if (c.list.length < 2) continue;
        c.list.sort((a, b) => a.len - b.len).forEach((s, i) => { if (i) shotStagger[s.id] = i * SHOT_STAGGER_STEP; });
      }
    }
    // a PASS's drawn line comes from the AUTHORED chain (planner geometry:
    // release waypoint → catch waypoint, like renderBranchGhostArrows), NOT the
    // animation plan's fly legs — those launch/land on warped blade positions
    // along possibly-detoured routes, so they drift off the planner picture.
    // Shots / rims / chips keep their plan legs (intent aim, board-following runs).
    const passArrows = q => (q.transfers || []).flatMap((t, s) => {
      if (t.kind !== "pass") return [];
      const actor = t.by || releaserOf(q, s);
      const wp = releasePos(actor, t);
      if (!wp) return [];
      const rec0 = pieces.find(x => x.id === t.to);
      const rec = rec0 && t.recvRef ? routePiece(rec0, t.recvRef) : rec0;
      if (!rec) return [];
      // a led pass lands on its GHOST catch waypoint (the computed mid-curve
      // catch); an authored @recv — or a led pass that lands on the waypoint
      // itself — points at the planner waypoint
      const ghost = t.recvAt == null ? ledCatchByPuck.get(`${q.id}:${s}`) : null;
      const rw = t.recvAt != null ? t.recvAt : closestWp(rec, wp);
      const tgt = ghost || ((rw < 0 || !(rec.path || []).length) ? { x: rec.x, y: rec.y }
        : { x: rec.path[Math.min(rw, rec.path.length - 1)].x, y: rec.path[Math.min(rw, rec.path.length - 1)].y });
      // give-and-go: the line elbows off the passer's face, head only on the return
      const via = t.via ? pieces.find(x => x.id === t.via) : null;
      const pts = via ? [wp, { x: via.x, y: via.y }, tgt] : [wp, tgt];
      const out = [];
      for (let j = 1; j < pts.length; j++) {
        const a = pts[j - 1], b = pts[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const head = j === pts.length - 1;
        // stand the release off its badge / the releaser icon; arrivals register
        // their natural tip so same-direction heads at one badge queue back
        const sp = j === 1 ? gmMove(a.x, a.y, ux, uy, Math.min(START_OFF, len / 2)) : a;
        let eGap = head ? Math.min(START_OFF, Math.max(0, len - 2)) : 0;
        if (eGap > 0) {
          const t0 = gmMove(b.x, b.y, -ux, -uy, eGap);
          const back = arrivalBack(AR_SCENE, t0.x, t0.y);
          if (back) eGap = Math.min(eGap + back, Math.max(0, len - 2));
        }
        const ep = eGap > 0 ? gmMove(b.x, b.y, -ux, -uy, eGap) : b;
        // line stops at the open caret's mouth so it never pokes through it
        const le = head && !flat ? gmMove(ep.x, ep.y, -ux, -uy, 2.9 * z * lineScale) : ep;
        out.push(
          <g key={`pp-${q.id}-${s}-${j}`} pointerEvents="none" opacity={0.62}>
            <line x1={sp.x} y1={sp.y} x2={le.x} y2={le.y} vectorEffect={ve}
              stroke={INK} strokeWidth={W(0.55)} strokeDasharray={D("2.4 1.8")} />
            {head && (dx || dy) ? (flat
              ? <circle cx={ep.x} cy={ep.y} r={1.1} fill="none" vectorEffect={ve} stroke={INK} strokeWidth={W(0.3)} />
              : (() => { const fx = iconXf({ x: ep.x, y: ep.y, a: (Math.atan2(dy, dx) * 180) / Math.PI });
                  return <g transform={fx.t}><g transform={`scale(${z * lineScale})`}>
                    <path d="M -3.3 -2.2 L 0 0 L -3.3 2.2" fill="none" stroke={INK} strokeWidth={casing ? 2.1 : 0.95} strokeLinecap="round" strokeLinejoin="round" />
                  </g></g>; })()) : null}
          </g>
        );
      }
      return out;
    });
    return pieces
      .filter(q => q.kind === "puck" && plans[q.id] && !condPuck(q))   // conditional pucks draw via renderBranchGhostArrows (plan geometry)
      .map(q => [passArrows(q), plans[q.id].legs.map((L, k, legs) => {
        if (L.type !== "fly") return null;
        if (!L.shot && !L.rim && !L.chip) return null;   // a plain fly leg is a pass — drawn from the authored chain above
        const nxt = legs[k + 1];
        const runEnd = !nxt || nxt.type !== "fly";   // last fly leg of a pass/shot/rim/chip run
        const runStart = k === 0 || legs[k - 1].type !== "fly";   // first fly leg of the run
        // rim/chip runs arrive as MANY short legs (one per boards-path vertex);
        // a line per leg restarts the dash phase every segment and reads as a
        // near-solid chain. Draw the WHOLE run as ONE polyline so the dash
        // rhythm matches a pass exactly. (The block below then handles shots only.)
        if (L.rim || L.chip) {
          if (!runEnd) return null;                    // the run draws once, at its end
          let s0 = k; while (s0 > 0 && legs[s0 - 1].type === "fly") s0--;
          const pts = [{ x: legs[s0].x0, y: legs[s0].y0 }];
          for (let m = s0; m <= k; m++) pts.push({ x: legs[m].x1, y: legs[m].y1 });
          const land = pts[pts.length - 1];
          const sb2 = nearBadge(pts[0].x, pts[0].y);
          const line = sb2 ? trimPolyStart([{ x: sb2.x, y: sb2.y }, ...pts.slice(1)], START_OFF, strokeAR) : pts;
          const eb2 = nearBadge(land.x, land.y);
          const gl = !flat && whiteboard && !eb2;      // loose landing → ghost puck
          let gap = eb2 ? START_OFF : gl ? 3.4 : 0;
          if (eb2 && gap > 0) {
            const t0 = trimPolyEnd(line, gap, strokeAR);
            const tp = t0[t0.length - 1];
            const back = arrivalBack(AR_SCENE, tp.x, tp.y);
            if (back) gap += back;
          }
          const tipLine = gap > 0 ? trimPolyEnd(line, gap, strokeAR) : line;
          const tip = tipLine[tipLine.length - 1];
          const pv = tipLine[Math.max(0, tipLine.length - 2)];
          const ta = (Math.atan2(tip.y - pv.y, tip.x - pv.x) * 180) / Math.PI;
          const vis = flat ? tipLine : trimPolyEnd(tipLine, 2.9 * z * lineScale, strokeAR);
          return (
            <g key={`pf-${q.id}-${k}`} pointerEvents="none" opacity={0.62}>
              <polyline points={vis.map(q2 => `${q2.x.toFixed(2)},${q2.y.toFixed(2)}`).join(" ")} fill="none"
                vectorEffect={ve} stroke={INK} strokeWidth={W(0.55)} strokeDasharray={D("2.4 1.8")}
                strokeLinecap="round" strokeLinejoin="round" />
              {flat
                ? <circle cx={tip.x} cy={tip.y} r={1.1} fill="none" vectorEffect={ve} stroke={INK} strokeWidth={W(0.3)} />
                : (() => { const fx = iconXf({ x: tip.x, y: tip.y, a: ta });
                    return <g transform={fx.t}><g transform={`scale(${z * lineScale})`}>
                      <path d="M -3.3 -2.2 L 0 0 L -3.3 2.2" fill="none" stroke={INK} strokeWidth={casing ? 2.1 : 0.95} strokeLinecap="round" strokeLinejoin="round" />
                    </g></g>; })()}
              {gl && !casing && (() => {
                const fx = iconXf({ x: land.x, y: land.y, a: 0 });
                return <g opacity={0.55}>
                  <PieceIcon p={{ kind: "puck", color: T["ice-ink"] }} pos={{ x: land.x, y: land.y, a: 0 }}
                    xf={fx.t} thDeg={fx.th} noShadow hitOff onDown={() => {}} />
                </g>; })()}
            </g>
          );
        }
        // one of a pile of identical shots — the group draws once, on its shortest
        if (L.shot && runEnd && shotN[`${q.id}/${k}`] > 1 && !shotOne[`${q.id}/${k}`]) return null;
        const nShots = L.shot && runEnd ? (shotN[`${q.id}/${k}`] || 1) : 1;
        const dx = L.x1 - L.x0, dy = L.y1 - L.y0;
        // start: released AT an action badge → begin just outside its round edge,
        // measured from the badge CENTRE (not the stick); off a standing stick → start there.
        // The drawn direction is badge→target (NOT the plan leg's own blade→target):
        // the leg launches at the blade a couple of feet off the badge, and reusing
        // its direction from a badge-centred start skews the visible line off-target
        // while the head still points true — line and arrow must stay collinear.
        const sb = runStart ? nearBadge(L.x0, L.y0) : null;
        const ox = sb ? sb.x : L.x0, oy = sb ? sb.y : L.y0;
        const len = Math.hypot(L.x1 - ox, L.y1 - oy) || 1, ux = (L.x1 - ox) / len, uy = (L.y1 - oy) / len;
        const sp = sb ? gmMove(sb.x, sb.y, ux, uy, START_OFF) : { x: L.x0, y: L.y0 };
        const sx = sp.x, sy = sp.y;
        // end: a shot stops just short of the net (+ stagger when another shot's
        // head lands on top of this one); a pass/rim/chip into a receiver's badge
        // stops just off its edge. Clamp the offset so a SHORT leg's arrow never
        // overshoots its own start and reverses.
        const eb = runEnd && !L.shot ? nearBadge(L.x1, L.y1) : null;
        // whiteboard: a chip/rim that lands LOOSE (no collector badge) gets a
        // ghost puck sitting on the landing spot — the line stops just short
        const ghostLand = !flat && whiteboard && runEnd && (L.rim || L.chip) && !eb;
        let eGap = L.shot && runEnd ? SHOT_TIP_GAP + (shotStagger[`${q.id}/${k}`] || 0) : eb ? START_OFF : ghostLand ? 3.4 : 0;
        const eCap = Math.max(0, Math.hypot((L.x1 - sx) * gmSar, (L.y1 - sy) / gmSar) - 2);
        if (eGap > 0) eGap = Math.min(eGap, eCap);
        // pass/rim/chip arrivals register their natural TIP so same-direction heads at
        // one badge queue back, while different-angle arrivals stay put; shots keep
        // their own per-net stagger
        if (eb && eGap > 0) {
          const t0 = gmMove(L.x1, L.y1, -ux, -uy, eGap);
          const back = arrivalBack(AR_SCENE, t0.x, t0.y);
          if (back) eGap = Math.min(eGap + back, eCap);
        }
        const ep = eGap > 0 ? gmMove(L.x1, L.y1, -ux, -uy, eGap) : { x: L.x1, y: L.y1 };
        const ex = ep.x, ey = ep.y;
        return (
          <g key={`pf-${q.id}-${k}`} pointerEvents="none" opacity={0.62}>
            {L.shot
              // standard shot notation: two parallel lines with an open caret.
              // The lines stop at the caret's mouth (backed off by its zoom-
              // scaled depth) so they never protrude past the head.
              ? (() => {
                  const le = runEnd ? gmMove(ex, ey, -ux, -uy, 2.9 * z * lineScale) : { x: ex, y: ey };
                  const sep = 0.65 * lineScale;   // pair separation keeps pace so the double line stays readable
                  const a1 = gmMove(sx, sy, -uy, ux, sep), a2 = gmMove(le.x, le.y, -uy, ux, sep);
                  const b1 = gmMove(sx, sy, uy, -ux, sep), b2 = gmMove(le.x, le.y, uy, -ux, sep);
                  return <>
                    <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} vectorEffect={ve} stroke={INK} strokeWidth={W(0.55)} />
                    <line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} vectorEffect={ve} stroke={INK} strokeWidth={W(0.55)} />
                  </>;
                })()
              : (() => {
                  // line stops at the caret's mouth on the run-end leg
                  const lt = runEnd && (dx || dy) && !flat ? gmMove(ex, ey, -ux, -uy, 2.9 * z * lineScale) : { x: ex, y: ey };
                  return <line x1={sx} y1={sy} x2={lt.x} y2={lt.y} vectorEffect={ve}
                    stroke={INK} strokeWidth={W(0.55)} strokeDasharray={D("2.4 1.8")} />;
                })()}
            {runEnd && (dx || dy) && (flat
              ? <circle cx={ex} cy={ey} r={1.1} fill="none" vectorEffect={ve} stroke={INK} strokeWidth={W(0.3)} />
              : (() => { const fx = iconXf({ x: ex, y: ey, a: (Math.atan2(uy, ux) * 180) / Math.PI });
                  // heads scale with the line-thickness setting, like routeMark
                  return <g transform={fx.t}><g transform={`scale(${z * lineScale})`}>
                    {/* one caret vocabulary: shots, passes, chips, and rims all
                        end in the standard open ">" like skating routes */}
                    <path d="M -3.3 -2.2 L 0 0 L -3.3 2.2" fill="none" stroke={INK} strokeWidth={casing ? 2.1 : 0.95} strokeLinecap="round" strokeLinejoin="round" />
                  </g></g>; })())}
            {/* how many shots this one mark stands for — same tally an action circle
                uses for repeats, sat just off the shoulder of the caret */}
            {nShots > 1 && !casing && !flat && (() => {
              const b0 = gmMove(ex, ey, -ux, -uy, 3.1);          // back off the caret...
              const bp = gmMove(b0.x, b0.y, -uy, ux, 2.6);        // ...and off its shoulder
              const bfx = iconXf({ x: bp.x, y: bp.y, a: 0 });
              return <g transform={bfx.t}><g transform={`rotate(${-bfx.th})`}>
                {tallyBubble(nShots, 1.75, INK, T.ice)}
              </g></g>; })()}
            {ghostLand && !casing && (() => {
              // ghost puck resting where the chip/rim lands
              const fx = iconXf({ x: L.x1, y: L.y1, a: 0 });
              return <g opacity={0.55}>
                <PieceIcon p={{ kind: "puck", color: T["ice-ink"] }} pos={{ x: L.x1, y: L.y1, a: 0 }}
                  xf={fx.t} thDeg={fx.th} noShadow hitOff onDown={() => {}} />
              </g>; })()}
          </g>
        );
      })]);
  }

  // Faint R-numbers over a player's branch routes while a ROUTE condition is being
  // edited (the open popup's player has a link cond somewhere in their fork tree) —
  // each number matches the picker's "R1 · 2ea043" entries, so the coach picks the
  // route they can SEE instead of decoding colour hexes. One label per BRANCH line,
  // at that branch's midpoint.
  function renderRouteNumbers() {
    const pid = popup && (popup.type === "piece" || popup.type === "point") ? popup.id : null;
    const editor = pid ? pieces.find(q => q.id === pid && q.kind === "player") : null;
    if (!editor) return null;
    const targets = new Set();
    const scan = forks => (forks || []).forEach(f => {
      if (f.cond && f.cond.type === "link" && f.cond.player) targets.add(f.cond.player);
      scan(f.forks);
    });
    scan(editor.forks);
    if (!targets.size) return null;
    const els = [];
    for (const tid of targets) {
      const tgt = pieces.find(q => q.id === tid && q.kind === "player");
      if (!tgt) continue;
      for (const [ref, n] of forkNumbers(tgt)) {
        const rp = routePiece(tgt, ref);
        const segs = rp.path || [];
        if (!segs.length) continue;
        const mid = segEnd(rp, Math.floor((segs.length - 1) / 2));
        els.push(
          <text key={`rn-${tid}-${ref}`} x={mid.x} y={mid.y - 2.5} textAnchor="middle"
            fontSize={5} fontWeight={800} fill="#eaf0f6" stroke="#14202b" strokeWidth={0.55}
            paintOrder="stroke" opacity={0.55} pointerEvents="none">R{n}</text>
        );
      }
    }
    return els.length ? <g>{els}</g> : null;
  }

  // ALL of a conditional puck's pass/shot/chip/rim arrows, drawn from the PLAN geometry
  // (release waypoint → catch waypoint / net / boards landing) so every possibility
  // reads the same. The action that fires on the CURRENT run draws at full strength;
  // the other branches' stay faint ghosts. (puckPathNodes skips conditional pucks —
  // the animation plan's warped fly legs would draw the firing action differently.)
  function renderBranchGhostArrows() {
    if (!showPuckPaths) return null;   // puck-action arrows follow the Routes-on-play "All +puck" rule
    const z = 1 / (view.s || 1);
    // in the planner at rest, every branch's line reads solid enough to edit; during
    // playback the non-chosen branches fade further back.
    const plannerEdit = !presentation && animT <= 0;
    const OP_GHOST = plannerEdit ? 0.4 : 0.22;
    const OP_LIVE = plannerEdit ? 0.85 : 0.62;
    const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer" || q.kind === "bumper" || q.kind === "tire");
    const nearNet = pt => nets.length ? nets.reduce((a, b) => Math.hypot(b.x - pt.x, b.y - pt.y) < Math.hypot(a.x - pt.x, a.y - pt.y) ? b : a) : null;
    const landing = (wp, kind, aim, dist) => {
      const d = dist != null ? dist : (kind === "rim" ? REL_DEFAULT.rimAt : REL_DEFAULT.chipAt);
      try { const path = kind === "chip" ? boards.slide(wp.x, wp.y, Math.cos((aim || 0) * Math.PI / 180), Math.sin((aim || 0) * Math.PI / 180), d) : boards.rimAround(wp, d, aim); return (path && path.length) ? path[path.length - 1] : wp; } catch { return wp; }
    };
    const START_OFF = ACT_R * ICON_SCALE + 0.9;
    // the arrowhead registers its natural TIP with the arrival registry: heads
    // converging from the SAME direction queue back, different angles stay put
    const arrow = (a, b, shot, key, op = OP_GHOST) => {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const sp = gmMove(a.x, a.y, ux, uy, Math.min(START_OFF, len / 2));
      const base = Math.min(shot ? SHOT_TIP_GAP : START_OFF, Math.max(0, len - 2));
      const ep0 = gmMove(b.x, b.y, -ux, -uy, base);
      const back = arrivalBack("main", ep0.x, ep0.y);
      const ep = back ? gmMove(b.x, b.y, -ux, -uy, Math.min(base + back, Math.max(0, len - 2))) : ep0;
      const fx = iconXf({ x: ep.x, y: ep.y, a: (Math.atan2(dy, dx) * 180) / Math.PI });
      return (
        <g key={key} pointerEvents="none" opacity={op}>
          {shot
            // standard shot notation: two parallel lines with an open caret
            // that the lines stop at (never protrude past)
            ? (() => {
                const le = gmMove(ep.x, ep.y, -ux, -uy, 2.9 * z * lineScale);
                const sep = 0.65 * lineScale;
                const a1 = gmMove(sp.x, sp.y, -uy, ux, sep), a2 = gmMove(le.x, le.y, -uy, ux, sep);
                const b1 = gmMove(sp.x, sp.y, uy, -ux, sep), b2 = gmMove(le.x, le.y, uy, -ux, sep);
                return <>
                  <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} vectorEffect="non-scaling-stroke" stroke={T["ice-ink"]} strokeWidth={sw(0.55) * lineScale} />
                  <line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} vectorEffect="non-scaling-stroke" stroke={T["ice-ink"]} strokeWidth={sw(0.55) * lineScale} />
                </>;
              })()
            : (() => {
                const lg = gmMove(ep.x, ep.y, -ux, -uy, 2.9 * z * lineScale);
                return <line x1={sp.x} y1={sp.y} x2={lg.x} y2={lg.y} vectorEffect="non-scaling-stroke"
                  stroke={T["ice-ink"]} strokeWidth={sw(0.55) * lineScale} strokeDasharray={sdash("2.4 1.8")} />;
              })()}
          <g transform={fx.t}><g transform={`scale(${z * lineScale})`}>
            <path d="M -3.3 -2.2 L 0 0 L -3.3 2.2" fill="none" stroke={T["ice-ink"]} strokeWidth={0.95} strokeLinecap="round" strokeLinejoin="round" />
          </g></g>
        </g>
      );
    };
    // arrows are COLLECTED first, then clustered by landing point: several branches'
    // passes can converge on one catch waypoint (close to or exactly on each other),
    // so arrivals at the same spot queue back in small steps — the FIRING arrow keeps
    // the slot nearest the badge, ghosts stack just behind it.
    const specs = [];
    const els = [];
    for (const pk of pieces) {
      if (pk.kind !== "puck" || !condPuck(pk)) continue;
      const low = effById.get(pk.id);
      const won = low && low._winTerm;
      // terminals: releasePos resolves a branch ref within the SHOOTER's route tree, so
      // shared cue colours across players can't land an arrow on the wrong branch
      for (const t of (pk.terminals || [])) {
        const shooterId = t.by || terminalActor(pk, pieces, t.ref || "");
        const wp = releasePos(shooterId, { at: t.at, atRef: t.ref });
        if (!wp) continue;
        const tgt = t.kind === "shot"
          ? (() => { const n = t.net ? pieces.find(x => x.id === t.net) : nearNet(wp); return n ? { x: n.x, y: n.y } : null; })()
          : landing(wp, t.kind, t.aim, t.dist);
        if (tgt) specs.push({ a: wp, b: tgt, shot: t.kind === "shot",
          key: `tterm-${pk.id}-${shooterId}-${t.kind}${t.at}-${(t.ref || "")}`, op: won && sameTerm(t, won) ? OP_LIVE : OP_GHOST });
      }
      // transfers (pass/rebound/rim/chip handoffs), branch or base — the lowered run's
      // own entries (matched via their _src tag) draw at full strength
      const lives = new Set(((low && low.transfers) || []).map(lt => lt._src || lt));
      (pk.transfers || []).forEach((t, s) => {
        const actor = t.by || releaserOf(pk, s);
        const wp = releasePos(actor, t);
        if (!wp) return;
        const rec0 = pieces.find(q => q.id === t.to);
        const rec = rec0 && t.recvRef ? routePiece(rec0, t.recvRef) : rec0;   // caught on the receiver's branch route
        const rw = rec ? (t.recvAt != null ? t.recvAt : closestWp(rec, wp)) : -1;
        const tgt = rec ? (rw < 0 || !rec.path.length ? { x: rec.x, y: rec.y }
          : { x: rec.path[Math.min(rw, rec.path.length - 1)].x, y: rec.path[Math.min(rw, rec.path.length - 1)].y }) : null;
        if (tgt) specs.push({ a: wp, b: tgt, shot: t.kind === "shot", key: `tpass-${pk.id}-${actor}-${s}`, op: lives.has(t) ? OP_LIVE : OP_GHOST });
      });
    }
    // render LIVE arrows first so the firing action claims the slot nearest the
    // badge; ghosts with the same approach queue just behind (arrow() itself
    // registers each natural tip with the shared registry)
    specs.sort((a, b) => (a.op === b.op ? 0 : a.op === OP_LIVE ? -1 : 1));
    for (const s of specs) els.push(arrow(s.a, s.b, s.shot, s.key, s.op));
    return els.length ? <g>{els}</g> : null;
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
    const loupeXf = screenRot === 90
      ? `rotate(90) translate(${R - loupe.x} ${-loupe.y - R})`
      : screenRot === 180
      ? `rotate(180) translate(${-loupe.x - R} ${-loupe.y - R})`
      : screenRot === 270
      ? `rotate(-90) translate(${-loupe.x - R} ${R - loupe.y})`
      : `translate(${R - loupe.x} ${R - loupe.y})`;
    return (
      <div className="hd-loupe" style={{
        left: `${lx}%`, top: `${ty}%`,
        transform: `translate(${xShift}, ${below ? `${GAP}px` : `calc(-100% - ${GAP}px)`})`,
      }}>
        <svg viewBox={`0 0 ${2 * R} ${2 * R}`}>
          <g transform={loupeXf}>
          <RinkMarkings dim={rinkDim} />
          {pieces.map(p => {
            let prev = { x: p.x, y: p.y };
            return p.path.map((s, i) => {
              const d = segD(prev, s);
              const from = prev;
              prev = { x: s.x, y: s.y };
              const style = segStroke(p, s, i === p.path.length - 1, true);
              return p.kind === "player" && s.dir === "bwd"
                ? <path key={`${p.id}${i}`} d={zigzagPoints(from, s, 1, i === p.path.length - 1)} {...style} strokeLinejoin="round" />
                : <path key={`${p.id}${i}`} d={d} {...style} />;
            });
          })}
          {pieces.map(p => <g key={`ls${p.id}`}>{renderStops(p, 1)}</g>)}
          {drawPreview && drawPreview.length > 1 && (
            <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")}
              fill="none" stroke={T["ice-select"]} strokeWidth={0.6} strokeDasharray="1.4 1" opacity={0.9} />
          )}
          {puckPathNodes(true)}
          {selected && renderHandles(selected, 1)}
          {renderMarkHandles(1)}
          {selected && renderRotateHandle(selected, 1)}
          {pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p, true, 1)}</g>)}
          {pieces.filter(p => p.kind !== "label" && p.kind !== "mark").map(p => {
            const dp = displayPos(p);
            return (
              <PieceIcon key={`lp${p.id}`} p={p} pos={dp} thDeg={(dp.a || 0) + screenRot} wb={whiteboard} wbCircle={wbCircle}
                selected={editing && p.id === selectedId} dim={animT > 0} onDown={() => {}} swing={displaySwing(p)} />
            );
          })}
          {/* labels are their own kind — render them as text, not the player fallback */}
          {pieces.filter(p => p.kind === "label" && p.text).map(p =>
            labelNode(`lp-lbl-${p.id}`, p.x, p.y, p.text, p.size, p, p.id === selectedId, null, null))}
          <circle cx={loupe.x} cy={loupe.y} r={1.1} fill="none" stroke="#d7263d" strokeWidth={0.25} />
          <line x1={loupe.x - 2} y1={loupe.y} x2={loupe.x + 2} y2={loupe.y} stroke="#d7263d" strokeWidth={0.18} />
          <line x1={loupe.x} y1={loupe.y - 2} x2={loupe.x} y2={loupe.y + 2} stroke="#d7263d" strokeWidth={0.18} />
          </g>
        </svg>
      </div>
    );
  }

  // Changing what the pen does COMMITS what you have already drawn first, so a
  // stroke always lands under the mode it was drawn in. Without this, sketching
  // and then switching to Manual inside the 1s settle window re-laid those
  // strokes as ordinary ink — at route fidelity, without their per-point
  // pressure — and the next Convert could read your handwriting as a player.
  // Same reason every tool change and setMode already flush.
  const setPen = v => {
    if (v !== penRead) flushPen();
    setPenRead(v);
    setEraser(false);
    if (tool !== "pen") setTool("pen");
  };
  // "Manual — ink waits until you tap Convert." The stored sentence stands
  // alone on the bar, so it is sentence-case; joined after the label it reads
  // as one clause, hence the lowercased first letter.
  const penSays = () => {
    const [, label, , says] = penReadRow(penRead);
    return `${label} — ${says.charAt(0).toLowerCase()}${says.slice(1)}`;
  };
  const toolHint =
    !playing && !aiPlay && animT > 0
      ? "Paused — tap the ice or a piece to edit (jumps to start)"
      : editingFork && tool === "select"
      ? `Editing the reaction — drag waypoints · tap the line to add · “✓ Editing” to finish`
      : tool === "draw" && forkDrawColor
      ? `Drawing the reaction — drag from the route's end`
      : tool === "draw"
      ? (selected ? `Drawing ${selected.id}'s route — drag across the ice` : "Drag on the ice — creates a player")
      : tool === "marker" ? "Marker — drag on the ice to draw"
      // Say what the pen will do with the NEXT stroke, from the same sentence
      // the bar shows. It used to say "ink becomes pieces" unconditionally —
      // which was flatly untrue in Sketch, on the one surface a phone has.
      : tool === "pen" ? (stylusOn && stylusMode()
          ? `${penSays()} Apple Pencil: palm rejection on.`
          : penSays())
      : tool !== "select" ? "Tap the ice to place"
      // Edit mode's bar has room for a standing hint, so say what the two
      // gestures are rather than leaving the strip blank
      : selected ? `${selected.id} selected — drag to move, tap for its settings`
      : "Tap a piece to edit it · double-tap the ice to add";
  // The subset worth interrupting the ice for: something is armed or in
  // progress and the hint tells you how to finish it. Everything else is the
  // idle standing hint, which on a phone is just noise over the rink.
  const transientHint =
    (!playing && !aiPlay && animT > 0) || editingFork || tool !== "select" ? toolHint : null;

  // ---- presentation: the EDITOR chrome gets out of the way ----------------
  // Showing a drill to a room, you still want play/pause and the scrubber —
  // what you don't want is Menu, Rink, the mode switch and Undo/Redo. So the
  // menu bar slides away and hands its 54px to the ice; the transport stays.
  // Revealing the menu bar again OVERLAYS (the transport steps up over it)
  // rather than re-reserving the space, because reserving it would resize the
  // rink every time the chrome came and went.
  const [barUp, setBarUp] = useState(false);
  const barTimer = useRef(0);
  const presoFull = presentation && mode === "play" && !aiPlay;
  // idempotent: the desktop pointer fires this continuously, so it must not
  // toggle — it shows the bar and restarts the idle countdown
  const showBar = () => {
    setBarUp(true);
    clearTimeout(barTimer.current);
    barTimer.current = setTimeout(() => setBarUp(false), 3000);
  };
  const toggleBar = () => {
    if (barUp) { clearTimeout(barTimer.current); setBarUp(false); } else showBar();
  };
  // entering or leaving presentation always starts from hidden
  useEffect(() => { setBarUp(false); clearTimeout(barTimer.current); }, [presoFull]);
  useEffect(() => () => clearTimeout(barTimer.current), []);
  // Desktop pointer in presentation, doing two jobs off one listener:
  //   · near the bottom edge → bring the editor bar back
  //   · anywhere → the pointer is "live"; a still one fades out after a beat,
  //     the way a video player does, so a forgotten cursor doesn't sit over the
  //     ice for a whole run-through
  // Touch has neither: there's no cursor, and a swipe from the very bottom is
  // iOS's own home gesture in standalone, so the app can't count on seeing it —
  // the chevron on the transport is the way back there.
  const [cursorIdle, setCursorIdle] = useState(false);
  const cursorTimer = useRef(0);
  useEffect(() => {
    if (!presoFull || coarsePtr) { setCursorIdle(false); return; }
    const arm = () => {
      clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setCursorIdle(true), 2500);
    };
    const on = e => {
      setCursorIdle(false); arm();
      if (e.clientY > window.innerHeight - 90) showBar();
    };
    window.addEventListener("pointermove", on);
    window.addEventListener("pointerdown", on);
    arm();                                   // a cursor that never moves still fades
    return () => {
      window.removeEventListener("pointermove", on);
      window.removeEventListener("pointerdown", on);
      clearTimeout(cursorTimer.current); setCursorIdle(false);
    };
  }, [presoFull, coarsePtr]);   // eslint-disable-line

  // Presentation is for showing the drill to a room, so turning it on clears
  // the editing furniture off the ice: any pinned panel, the docked sidebar
  // (which costs 320px of rink), and the current selection with its handles.
  // Turning it OFF leaves the board alone — you re-open what you want.
  const togglePresentation = () => setPresentation(v => {
    if (!v) { setPinMode(null); setPopup(null); setSelectedId(null); setMultiSel(null); }
    return !v;
  });

  // Switch editor flows. Every clause here is lifted from a place that already
  // did exactly this before there was a mode to name — the Add sheet's pen rows,
  // togglePlay, wakeEdit — so this is one definition replacing five copies.
  //
  // The one thing it must NOT do is disturb the pen. flushPen() COMMITS buffered
  // ink (it is not clearInk), and the ink colour, width, style and the pen's
  // read mode (sketch/manual/auto) all survive a trip through another mode:
  // draw → edit → draw has always been a free round trip so you can nudge a
  // piece mid-sketch, and moving that switch from the palette to the bottom bar
  // mustn't cost it. This comment used to claim the note flag survived while
  // the code cleared it two lines below; it does now.
  const setMode = next => {
    if (next === mode) return;
    flushPen();
    setPenPop(null); setOpenMenu(null); setPopup(null);
    setPlacingStep(null); setEditAnchor(null);
    setHoldStep(null); holdRef.current = 0;
    if (next !== "play") {
      setPlaying(false);
      // same rule as wakeEdit: you can only edit the board at t=0
      if (animT > 0) { resetAnim(); flash("Back to start — editing"); }
    }
    if (next === "draw") { setTool("pen"); setEraser(false); }
    else { setTool("select"); setEraser(false); }
    if (next !== "edit") { setSelectedId(null); setMultiSel(null); setEditingFork(null); }
    setModeRaw(next);
  };
  // Leaving Play with nothing to play. Deleting the last route mid-run would
  // otherwise strand you looking at an empty transport with a dead scrubber.
  useEffect(() => {
    if (mode === "play" && !hasTimeline) setMode("edit");
  }, [hasTimeline]);  // eslint-disable-line

  const togglePlay = () => {
    if (mode !== "play") setMode("play");   // Space plays from any flow
    flushPen();                    // buffered pen ink lands before playback
    // starting a FRESH run (from the top OR replaying a finished one) re-rolls playSeed
    // → random reactions / cue timings vary each run. NB: check animT >= 1 too — after a
    // finished run resetAnim() only queues animT=0 (async), so `animT === 0` alone is
    // still false here and the seed would never advance on replay. Resuming a pause
    // (0 < animT < 1) must NOT re-roll.
    const fresh = animT >= 1 || animT === 0;
    if (animT >= 1) resetAnim();
    if (!playing && fresh) setPlaySeed(s => s + 1);
    setPopup(null); setOpenMenu(null); setHoldStep(null); setPlacingStep(null); holdRef.current = 0; setPlaying(p => !p);
  };
  const resetPlay = () => { setPlaying(false); resetAnim(); };

  // keyboard control for presentation / playback (laptop + projector use)
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      // never hijack typing in the group-name input, etc.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (presentation && holdStep) skipHold();  // caption held → advance early
        else togglePlay();                         // otherwise pause / continue
      } else if (e.key === "Escape") {
        if (playing) { e.preventDefault(); resetPlay(); }   // stop & reset
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        // the three flows, left to right, matching the bar's own order
        const m = ["draw", "edit", "play"][+e.key - 1];
        if (m === "play" && !hasTimeline) return;
        e.preventDefault(); setMode(m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation, holdStep, playing, mode, hasTimeline]); // eslint-disable-line

  // during playback the "Routes on play" setting controls what stays visible;
  // while editing everything shows regardless
  // whiteboard keeps the full planner picture on screen through playback
  const showRoutes = !aiPlay && (editing || whiteboard || routeVis(playRoutes).skaters);   // player route lines + stops
  const showPuckPaths = !aiPlay && (editing || whiteboard || routeVis(playRoutes).puck);    // planned pass / shot lines
  // converging-waypoint arrow pull-backs; the "Tidy arrowheads" setting turns the
  // whole feature off, landing every mark exactly where its waypoint was drawn
  const endStagger = showRoutes && arrowStagger ? routeEndStagger() : {};
  // led (no-@recv) passes land wherever the receiver meets the puck MID-CURVE.
  // That computed spot becomes a GHOST action waypoint: it gets the full
  // action-circle conventions (badge, incoming carat, line gap, possession
  // wiggle from there on) and the planner pass line lands on it — but it is
  // derived from the pass plan, never part of the model, so it can't be
  // grabbed, moved, or edited. Keyed by puck transfer (pass-line target) and
  // by receiver (route conventions); the spot is snapped onto the curve.
  const ledCatchByPuck = new Map();   // `${puckId}:${transferIdx}` → {x, y}
  const ledCatchByRec = new Map();    // receiver id → [{x, y, j, t, rw}] (segment j, param t, ledger waypoint rw)
  if (!aiPlay) {
    const { plans } = getIntentPlan();
    for (const pk of pieces) {
      if (pk.kind !== "puck" || !plans[pk.id] || condPuck(pk)) continue;
      // the computed catch of each pass, chain order: a pass is one run of plain
      // fly legs (a give-and-go's two legs share a run) CLOSED BY the receiver's
      // ride/catch leg. The gate matters: a realistic plan's missed-shot rolls
      // are plain fly legs too, but they settle to a rest — never a catch.
      const catches = [];
      let run = null;
      for (const L of plans[pk.id].legs) {
        if (L.type === "fly" && !L.shot && !L.rim && !L.chip) { run = { x: L.x1, y: L.y1 }; continue; }
        if (run && L.type === "ride" && L.catch) catches.push(run);
        run = null;
      }
      let pi = 0;
      (pk.transfers || []).forEach((t, s) => {
        if (t.kind !== "pass") return;
        const cp = catches[pi++];
        if (!cp || t.recvAt != null) return;
        const rec = pieces.find(x => x.id === t.to && x.kind === "player");
        if (!rec || !(rec.path || []).length) return;
        const wp = releasePos(t.by || releaserOf(pk, s), t);
        const rw = closestWp(rec, wp || cp);
        const anchor = rw < 0 ? { x: rec.x, y: rec.y } : rec.path[Math.min(rw, rec.path.length - 1)];
        if (Math.hypot(cp.x - anchor.x, cp.y - anchor.y) <= 1.75) return;   // lands ON the waypoint — its real badge covers it
        // snap the catch (a blade position, slightly off the line) onto the curve
        let bj = -1, bt = 0.5, bq = null, bd = Infinity, prevPt = { x: rec.x, y: rec.y };
        rec.path.forEach((sg, j) => {
          const tt = nearestT(prevPt, sg, cp);
          const q = evalSeg(prevPt, sg, tt);
          const dd = Math.hypot(q.x - cp.x, q.y - cp.y);
          if (dd < bd) { bd = dd; bj = j; bt = tt; bq = q; }
          prevPt = { x: sg.x, y: sg.y };
        });
        if (bj < 0 || bd > 4) return;   // catch isn't on the curve (receiver already finished, etc.)
        ledCatchByPuck.set(`${pk.id}:${s}`, { x: bq.x, y: bq.y });
        const list = ledCatchByRec.get(rec.id) || [];
        list.push({ x: bq.x, y: bq.y, j: bj, t: bt, rw });
        ledCatchByRec.set(rec.id, list);
      });
    }
  }
  // while previewing all branches during playback, the branching players (and the pucks
  // they carry) are hidden — only the ghosts play out, one per candidate route
  const previewHiddenIds = new Set();
  if (previewAllBranches && animT > 0) for (const q of pieces) {
    if (q.kind === "player" && (q.forks || []).length && enumerateRoutes(q).length > 1) {
      previewHiddenIds.add(q.id);
      for (const pk of pieces) if (pk.kind === "puck" && pk.carrier === q.id) previewHiddenIds.add(pk.id);
    }
  }

  // Whether the action bar is showing. ONE expression, read by both the bar's
  // own render and the root class that reserves its band, so the two can't
  // disagree about how much ice is spoken for.
  //
  // A presentation caption does NOT hide it. The bar used to vanish while a
  // caption was held, and pulling its band with it resized the ice by 68px on
  // every beat of a presentation — a jump precisely where the drill is meant to
  // be sitting still in front of a team. Keeping it up also keeps the transport
  // reachable, so you can pause or scrub back while a caption is on screen,
  // which is the moment a coach most wants to. The caption clears the bar on its
  // own (.hd-preso offsets by --hd-act) and tapping it still advances the hold.
  const actOn = !aiPlay;
  // exactly what clearInk would remove, so the button can't promise something
  // different from what it does — same predicate, same buffer
  const inkCount = pieces.reduce((n, p) => n + (inkMine(p, isSketch) ? 1 : 0), 0) + penInk.length;
  // the other pen state's ink, so a dead button can say whose it is
  const inkOther = pieces.reduce((n, p) => n + (inkMine(p, !isSketch) ? 1 : 0), 0);

  // Which players should wear waypoint numbers: the receivers of any PASS step
  // shown in the action panel that's currently open. Derived rather than stored,
  // so it can't get out of step with the panel — it appears when a pass is
  // showing and goes when the panel closes or the step changes.
  const numberedIds = (() => {
    if (!editing || !popup || (popup.type !== "piece" && popup.type !== "point")) return null;
    const src = pieces.find(q => q.id === popup.id);
    if (!src || src.kind !== "player") return null;
    const ids = new Set();
    for (const st of stepsAt(src, popup.type === "point" ? popup.seg : -1, popup.fork || null)) {
      if (st.kind !== "pass") continue;
      const to = ((st.pk?.transfers || [])[st.stage] || {}).to;
      if (to && to !== src.id) ids.add(to);
    }
    return ids.size ? ids : null;
  })();

  // The pen's three line settings — colour, thickness, style. Wide screens lay
  // them out inline, ready at the click; narrow ones stack all three inside a
  // single "Ink" popover so the bar keeps its one line. Built once here and
  // placed by either layout, so the two can never offer different options.
  const inkSwatches = PEN_INKS.map(c => (
    <button key={c} className={`hd-penswatch${markColor === c && !eraser ? " on" : ""}`}
      style={{ background: ink(c) }} title={`Ink ${c}`}
      onClick={() => { setMarkColor(c); setEraser(false); }} />
  ));
  const sizeSlider = (
    <>
      <span className="hd-penpoptip">{markWidth.toFixed(1)}</span>
      <input className="hd-penrange" type="range" min={0.4} max={3} step={0.1} value={markWidth}
        onChange={e => setMarkWidth(parseFloat(e.target.value))} />
    </>
  );
  const styleRows = PEN_STYLES.map(([s, lbl]) => (
    <button key={s} className={`hd-penopt${markStyle === s ? " on" : ""}`} title={`${lbl} line`}
      onClick={() => { setMarkStyle(s); if (dense) setPenPop(null); }}>
      <span className={`hd-penstyle ${s}`} /><span>{lbl}</span>
    </button>
  ));

  // ---- what you can do to the selected piece ----------------------------
  // ONE definition, rendered two ways: as .hd-mini rows at the foot of the
  // inspector, and as chips on the Edit bar. They were written separately, so
  // the two surfaces could quietly offer different things for the same piece.
  // `bar` picks the variant: the bar offers a door INTO the inspector, the
  // inspector offers the route-clearing the bar has no room for.
  const ROUTABLE = new Set(["player", "puck"]);
  const pieceActions = (p, bar) => {
    const a = [];
    if (bar && ROUTABLE.has(p.kind)) a.push({ key: "route", icon: "pencil",
      label: p.path?.length ? "Redraw" : "Route",
      title: `Draw ${p.id}'s route — drag across the ice`, on: () => drawRouteMode(p.id) });
    if (!bar && p.path?.length) a.push({ key: "clear", label: "Clear route",
      on: () => { updateById(p.id, { path: [] }); setPopup(null); flash("Route cleared — Undo restores it"); } });
    a.push({ key: "dup", icon: "duplicate", label: "Duplicate", short: "Copy",
      title: `Duplicate ${p.id}`, on: () => duplicatePiece(p.id) });
    a.push({ key: "lock", icon: "lock", label: "Lock",
      title: "Pin in place so it can't be moved or edited by accident.",
      on: () => updateById(p.id, { lock: true }) });
    // "More" is the door to the full inspector — but only where there IS a door
    // to open. Docked, the panel is a permanent sidebar that already re-targets
    // itself to whatever you select, so the button had nothing to do and read as
    // broken. Floating, it's a toggle that lights while its panel is up; before,
    // pressing it with the panel already open did nothing visible.
    const panelHas = popup && popup.id === p.id
      && (popup.type === "piece" || popup.type === "point" || popup.type === "line");
    if (bar && !docked) a.push({ key: "more", icon: "sliders", label: "More",
      title: panelHas ? `Hide ${p.id}'s settings` : `Everything else about ${p.id}`,
      active: panelHas,
      on: () => setPopup(panelHas ? null : { type: "piece", id: p.id }) });
    a.push({ key: "del", icon: "trash", label: "Delete", danger: true,
      title: `Delete ${p.id}`, on: () => deletePiece(p.id) });
    return a;
  };
  // ---- what you can do to a selected WAYPOINT / LEG ---------------------
  // The bar's selection strip switches to these when the thing you picked is a
  // point or a leg, so Delete removes just that — not the whole player. Same
  // chip shape as pieceActions; rendered by the same actionChip.
  const pointActions = (p, seg, fork) => {
    const a = [];
    a.push({ key: "lock", icon: "lock", label: "Lock",
      title: "Pin this waypoint so it can't be moved by accident.",
      on: () => updateSeg(p.id, seg, { lock: true }, fork) });
    const panelHas = popup && popup.type === "point" && popup.id === p.id && popup.seg === seg;
    if (!docked) a.push({ key: "more", icon: "sliders", label: "More",
      active: panelHas, title: panelHas ? "Hide this point's settings" : "Everything else about this point",
      on: () => setPopup(panelHas ? null : { type: "point", id: p.id, seg, ...(fork ? { fork } : {}) }) });
    a.push({ key: "del", icon: "trash", label: "Delete", danger: true,
      title: "Delete this waypoint", on: () => deleteSeg(p.id, seg, fork) });
    return a;
  };
  const legActions = (p, seg, pt, fork) => {
    const a = [];
    if (pt) a.push({ key: "add", icon: "plus", label: "Add point", short: "Add",
      title: "Add a waypoint on this leg", on: () => addPointAt(p.id, seg, pt, fork) });
    const panelHas = popup && popup.type === "line" && popup.id === p.id && popup.seg === seg;
    if (!docked) a.push({ key: "more", icon: "sliders", label: "More",
      active: panelHas, title: panelHas ? "Hide this leg's settings" : "Everything else about this leg",
      on: () => setPopup(panelHas ? null : { type: "line", id: p.id, seg, pt, ...(fork ? { fork } : {}) }) });
    a.push({ key: "del", icon: "trash", label: "Delete", danger: true,
      title: "Delete this leg",
      on: () => { deleteSeg(p.id, seg, fork); flash("Leg removed — Undo restores it"); } });
    return a;
  };
  const actionChip = a => (
    <button key={a.key} className={`hd-pentool${a.danger ? " danger" : ""}${a.active ? " on" : ""}`}
      title={a.title} onClick={a.on}>
      <Icon name={a.icon} size={17} /><span>{dense ? a.label : (a.short || a.label)}</span>
    </button>
  );

  // ---- Edit mode's add palette ------------------------------------------
  // Arm a tool (tap the ice to place it), except shapes, which land straight on
  // the board — the same two behaviours the Add sheet has always had.
  const armAdd = k => {
    setPenPop(null);
    if (SHAPE_KINDS.has(k)) { resetAnim(); setPlaying(false); addShapeMark(k); return; }
    setTool(t => (t === k ? "select" : k));   // tapping the armed tool disarms it
  };
  // one chip, sized for the bar: the piece's own sprite over a caption, so the
  // palette and the ice show the same thing
  const addChip = ([k, lbl, glyph]) => (
    <button key={k} className={`hd-pentool${tool === k ? " on" : ""}`} title={lbl}
      onClick={() => armAdd(k)}>
      {glyph === "marker" ? <Icon name="marker" size={17} />
        : glyph === "label" ? <Icon name="label" size={17} />
        : glyph ? <span className="hd-actglyph">{glyph}</span>
        : toolImg(k, whiteboard, wbCircle)}
      <span>{lbl}</span>
    </button>
  );
  // the same kinds as a grid, for a group that had to collapse into a popover
  const addGroupPop = g => (
    <div key={g.key} className="hd-penwrap">
      <button className={`hd-pentool${penPop === g.key ? " on" : ""}`} title={g.tip}
        onClick={() => setPenPop(v => (v === g.key ? null : g.key))}>
        <Icon name={g.icon} size={17} /><span>{g.label}</span>
      </button>
      {penPop === g.key && (
        <div className="hd-penpop grid">
          <div className="hd-toolgrid compact">
            {g.kinds.map(([k, lbl, glyph]) => (
              <button key={k} className={`hd-tool${tool === k ? " on" : ""}`} title={lbl}
                onClick={() => { armAdd(k); setPenPop(null); }}>
                {glyph === "marker" ? <span className="hd-toolglyph"><Icon name="marker" size={22} /></span>
                  : glyph === "label" ? <span className="hd-toolglyph"><Icon name="label" size={22} /></span>
                  : glyph ? <span className="hd-toolglyph">{glyph}</span>
                  : toolImg(k, whiteboard, wbCircle)}
                <span>{lbl}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    // wraps the WHOLE return, so renderLoupe()'s second <RinkMarkings/> subtree
    // gets the same tokens as the main sheet — if the loupe's ice and the board's
    // ice ever disagree, a wrong-shade rim shows at the loupe's corners
    <ThemeCtx.Provider value={T}>
    <InkCtx.Provider value={ink}>
    <div className={`hd-root${actOn ? "" : " act-off"}${dense ? " dense" : ""}${
      hand === "left" ? " lefty" : ""}${docked ? " dock-open" : ""}${
      presoFull ? (barUp ? " preso-full bar-up" : " preso-full") : ""}${cursorIdle ? " cursor-idle" : ""}${
      tool === "pen" || tool === "marker" ? (eraser && tool === "pen" ? " erase-cursor" : " draw-cursor") : ""}`} ref={rootRef}
      style={{ "--hd-font": fontStack }}>
      <style>{STYLES}</style>

      {/* ---------- the ice, filling the screen ---------- */}
      <div className="hd-stage" ref={stageRef}>
        <div className="hd-canvas" style={{ width: canvasW, height: canvasH }}>
          <svg ref={svgRef} className="hd-ice"
            viewBox={`${rootGeom.ox} ${rootGeom.oy} ${rootGeom.rootW} ${rootGeom.rootH}`}
            preserveAspectRatio="none"
            onPointerDown={onSvgDown} onPointerMove={onSvgMove}
            onPointerUp={onSvgUp} onPointerCancel={onSvgUp}>
            <defs>
              <clipPath id="boards"><rect x={0.5} y={0.5} width={199} height={84} rx={28} ry={28 * yFix} /></clipPath>
              {rink === "half" &&
                <clipPath id="halfview"><rect x={mxF} y={myF} width={vwF} height={vhF} /></clipPath>}
            </defs>

            <g transform={zoomXf}>
            <g ref={sceneRef} transform={sceneTransform} clipPath={rink === "half" ? "url(#halfview)" : undefined}>
            <RinkMarkings yFix={yFix} dim={rinkDim} />

            {/* freehand marker annotations sit on the ice, under the drill — they
                are drill markings, so they honour Mark opacity */}
            <g opacity={markMO}>
            {pieces.filter(p => p.kind === "mark").map(m => renderMark(m, true))}
            </g>

            {showZones && (
              <g pointerEvents="none">
                {ZONES.map((z, i) => (
                  <rect key={`zr${i}`} x={z.x} y={z.y} width={z.w} height={z.h}
                    rx={2} ry={2 * yFix} fill="rgba(31,79,163,0.05)" stroke="#3f74c8"
                    strokeWidth={0.3} strokeDasharray="1.6 1.2" opacity={0.75} />
                ))}
                {ZONES.map((z, i) => {
                  if (!z.label) return null;
                  const xf = iconXf({ x: z.label.x, y: z.label.y, a: 0 });
                  return (
                    <g key={`zl${i}`} transform={xf.t}>
                      <text transform={`rotate(${-xf.th})`} textAnchor="middle" dominantBaseline="middle"
                        fontSize={2.7} fontWeight={700} fill="#8fb4e8"
                        style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
                          paintOrder: "stroke", stroke: "rgba(8,12,18,0.7)", strokeWidth: 0.6 }}>
                        {z.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* ---- "Let AI play" 5v5 overlay (replaces the scripted content) ---- */}
            {aiPlay && aiRef.current && (
              <g pointerEvents="none">
                {[{ x: 11, y: 42.5, a: 0 }, { x: 189, y: 42.5, a: 180 }].map((n, i) => {
                  const fx = iconXf(n);
                  return <PieceIcon key={`ainet-${i}`} p={{ kind: "net", color: "#c81e33" }}
                    pos={n} xf={fx.t} thDeg={fx.th} onDown={() => {}} />;
                })}
                {aiRef.current.goalies.map((gl, i) => {
                  const fx = iconXf({ x: gl.x, y: gl.y, a: gl.a });
                  const col = "#2f9e57", dark = "#1d2126";
                  if (whiteboard) return (
                    <g key={`aig-${i}`} transform={fx.t}>
                      {wbCircle && <circle cx={0} cy={0} r={3.3} fill="#fff" stroke={col} strokeWidth={0.5} />}
                      <text transform={`rotate(${-fx.th})`} textAnchor="middle" dominantBaseline="central"
                        fontSize={wbCircle ? 4.1 : 5} fontWeight={900} fill={col}
                        style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
                          ...(wbCircle ? {} : { paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: 0.55 }) }}>
                        G
                      </text>
                    </g>
                  );
                  return (
                    <g key={`aig-${i}`} transform={fx.t}>
                      <ellipse cx={0.4} cy={0} rx={2.9} ry={2.6} fill="#0a1016" opacity={0.16} />
                      <path d="M 2.3 2.2 L 3.9 1 M 3.9 1.1 L 4.5 -1.1" stroke={dark} strokeWidth={1} strokeLinecap="round" />
                      <rect x={-1.7} y={-1.5} width={2.4} height={3} rx={1.05} fill={col} stroke="#fff" strokeWidth={0.3} />
                      <rect x={0.2} y={-1.85} width={2.6} height={1.5} rx={0.42} fill="#eef2f6" stroke="#2a2f36" strokeWidth={0.3} />
                      <rect x={0.2} y={0.35} width={2.6} height={1.5} rx={0.42} fill="#eef2f6" stroke="#2a2f36" strokeWidth={0.3} />
                      <circle cx={1.95} cy={-2.4} r={1.05} fill="#e8edf2" stroke="#2a2f36" strokeWidth={0.32} />
                      <rect x={1.35} y={1.6} width={1.85} height={1.5} rx={0.28} fill="#e8edf2" stroke="#2a2f36" strokeWidth={0.32} />
                      <circle cx={-0.15} cy={0} r={0.92} fill={col} stroke="#fff" strokeWidth={0.3} />
                    </g>
                  );
                })}
                {(() => { const fx = iconXf({ x: aiRef.current.puck.x, y: aiRef.current.puck.y }); return (
                  <g transform={fx.t}><circle cx={0} cy={0} r={1.5} fill={T["ice-ink"]} stroke={T.ice} strokeWidth={0.4} /></g>); })()}
                {aiRef.current.players.map(pl => {
                  const dp = { x: pl.x, y: pl.y, a: pl.a };
                  const fx = iconXf(dp);
                  return (
                    <g key={`aip-${pl.id}`} opacity={pl.stun > 0 ? 0.4 : 1}>
                      <PieceIcon p={{ kind: "player", color: pl.color, hand: "R", label: "", defense: pl.team === 1 }}
                        pos={dp} xf={fx.t} thDeg={fx.th} wb={whiteboard} wbCircle={wbCircle} onDown={() => {}} />
                    </g>
                  );
                })}
              </g>
            )}


            {/* route lines, fork/branch visuals + their ref paths — drill markings,
                dimmed by Mark opacity (players/implements below stay opaque) */}
            <g opacity={markMO}>
            {!aiPlay && pieces.map(p => {
              // DRAW the detour only when avoidance visuals are on; the animation's own
              // routeDetour (displayPos) is separate, so the skater still curves either way
              const rd = showRoutes && effAvoidVis ? routeDetour(p) : null;   // arc detour around a crossed net
              const bent = rd && rd.pts;
              const carry = p.kind === "player" ? carrySegs(p) : null;   // segments skated with the puck
              const acts = showRoutes && p.kind === "player" ? actionWaypoints(p) : new Map();
              // branch-departure waypoints: their reaction badge (and incoming carat)
              // needs the same visible-line gap as an action circle, so a possession
              // wiggle doesn't run underneath into the badge
              const forkAts = p.kind === "player"
                ? new Set((p.forks || []).filter(f => f.path && f.path.length).map(f => f.at != null ? f.at : p.path.length - 1))
                : new Set();
              // ghost catch waypoints on this route: possession starts AT the
              // computed catch, so the ledger's receive badge at its waypoint
              // retires (the ghost replaces it) and any early wiggle between the
              // credited waypoint and the catch segment un-wiggles
              const ledCs = p.kind === "player" ? (ledCatchByRec.get(p.id) || []) : [];
              for (const e of ledCs) {
                const a = e.rw >= 0 ? acts.get(e.rw) : null;
                if (a) { if (a.count <= 1 && (a.type === "receive" || a.type === "collect" || a.type === "pickup")) acts.delete(e.rw); else a.count -= 1; }
                if (carry) for (let k = e.rw + 1; k <= e.j; k++) carry.delete(k);          // credited early → no wiggle before the catch
                if (carry) for (let k = e.j + 1; k <= e.rw; k++) carry.add(k);             // credited late → wiggle from the catch onward
              }
              const ledSegCatch = i => { let best = null; for (const e of ledCs) if (e.j === i && (!best || e.t < best.t)) best = e; return best; };
              // two passes over the same geometry: casing (ice under-stroke)
              // first for the whole route, then the ink — so segment joints never
              // show a casing painted over an earlier segment's colour
              const renderSegs = cas => {
                let prev = { x: p.x, y: p.y };
                return p.path.map((s, i) => {
                    const d = segD(prev, s);
                    const from = prev;
                    prev = { x: s.x, y: s.y };
                    const isLast = i === p.path.length - 1;
                    const inkStyle = segStroke(p, s, isLast);
                    const style = cas ? caseOf(inkStyle) : inkStyle;
                    // line style: zigzag skating backward · wiggle with the puck ·
                    // straight otherwise (hockey diagram convention)
                    const bwd = p.kind === "player" && s.dir === "bwd";
                    const wig = !bwd && carry && carry.has(i);
                    // the VISIBLE line leaves a gap at the player start and around any
                    // action badge (before this waypoint / after the previous one);
                    // the ref path + hit area below still use the full segment
                    const startGap = i === 0 && p.kind === "player" ? ROUTE_START_GAP : (acts.has(i - 1) || forkAts.has(i - 1)) ? actGap : 0;
                    const endGap = (acts.has(i) || forkAts.has(i)) ? actGap : isLast ? (endStagger[p.id] || 0) : 0;
                    let vFrom = from, vSeg = s;
                    if (startGap) { const t = trimSegStart(vFrom, vSeg, startGap, strokeAR); if (t) { vFrom = t.from; vSeg = t.seg; } }
                    if (endGap) { const t = trimSegEnd(vFrom, vSeg, endGap, strokeAR); if (t) vSeg = t.seg; }
                    const vD = (startGap || endGap) ? segD(vFrom, vSeg) : d;
                    return (
                      <g key={`${cas ? "c:" : ""}${p.id}/${i}`}>
                        {/* invisible ref path is always present — timing measures it */}
                        {!cas && <path d={d} fill="none" stroke="none"
                          ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />}
                        {showRoutes && !bent && (() => {
                          // a ghost catch mid-segment splits the drawn leg at the
                          // catch spot with the regular action-circle treatment:
                          // plain approach, actGap hole, wiggle away with the puck
                          const lc = !bwd ? ledSegCatch(i) : null;
                          if (lc) {
                            const [segA, segB] = splitSeg(from, s, lc.t);
                            const fromB = { x: segA.x, y: segA.y };
                            let aFrom = from, aSeg = segA;
                            if (startGap) { const t2 = trimSegStart(aFrom, aSeg, startGap, strokeAR); if (t2) { aFrom = t2.from; aSeg = t2.seg; } }
                            const ta = aSeg ? trimSegEnd(aFrom, aSeg, actGap, strokeAR) : null;
                            let bFrom = fromB, bSeg = segB;
                            const tb = trimSegStart(bFrom, bSeg, actGap, strokeAR);
                            if (tb) { bFrom = tb.from; bSeg = tb.seg; } else bSeg = null;
                            if (bSeg && endGap) { const t2 = trimSegEnd(bFrom, bSeg, actGap, strokeAR); if (t2) bSeg = t2.seg; }
                            return (<g pointerEvents="none">
                              {ta && <path d={segD(aFrom, ta.seg)} {...style} pointerEvents="none" />}
                              {bSeg && <polyline points={wigglePoints(bFrom, bSeg, strokeAR, isLast || acts.has(i))} {...style} strokeLinejoin="round" pointerEvents="none" />}
                            </g>);
                          }
                          return bwd
                          ? <path d={zigzagPoints(vFrom, vSeg, strokeAR, isLast || acts.has(i))} {...style} strokeLinejoin="round" pointerEvents="none" />
                          : wig
                          ? <polyline points={wigglePoints(vFrom, vSeg, strokeAR, isLast || acts.has(i))} {...style} strokeLinejoin="round" pointerEvents="none" />
                          : <path d={vD} {...style} pointerEvents="none" />;
                        })()}
                        {/* detour active → the authored route lingers as a faint,
                            dashed ghost so the user can still see + grab it (add
                            waypoints / edit); the transparent hit path below drives
                            the interaction, so the ghost stays pointer-transparent */}
                        {!cas && showRoutes && bent && (
                          <path d={vD} fill="none" stroke={ink(p.color)}
                            strokeWidth={sw(0.5)} strokeDasharray={sdash("1.4 1.6")}
                            strokeLinecap="round" vectorEffect="non-scaling-stroke"
                            opacity={0.22} pointerEvents="none" />
                        )}
                        {!cas && showRoutes && (
                          <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                            onPointerDown={e => lineDown(e, p.id, i)} style={{ cursor: "pointer" }}
                            pointerEvents={p.lock && !lockedSelectable ? "none" : undefined} />
                        )}
                      </g>
                    );
                  });
              };
              return (
                <g key={`rt-${p.id}`}>
                  {renderSegs(true)}
                  {renderSegs(false)}
                  {bent && (() => {
                    // a detour collapses the route to one polyline — keep the
                    // hockey-diagram styling: wiggle a full carry, zigzag a fully
                    // backward leg, plain otherwise (or when it's mixed)
                    let line = p.kind === "player" ? trimPolyStart(bent, ROUTE_START_GAP, strokeAR) : bent;
                    if (endStagger[p.id]) line = trimPolyEnd(line, endStagger[p.id], strokeAR);
                    // same actGap holes around action/branch waypoints as the
                    // authored trims leave, so the bent line stops short of every
                    // action circle instead of running under its carat
                    const centers = [...new Set([...acts.keys(), ...forkAts])]
                      .filter(i => p.path[i]).map(i => ({ x: p.path[i].x, y: p.path[i].y }))
                      .concat(ledCs.map(e => ({ x: e.x, y: e.y })));   // ghost catch waypoints cut holes too
                    const inkStyle = segStroke(p, p.path[p.path.length - 1] || {}, false);
                    // each LEG of the bent line keeps its own zigzag/wiggle/plain
                    // shape (a mixed fwd/bwd route must not flatten to plain);
                    // casing pass first for the whole bent line, then the ink
                    const spans = polyLegSpans(line, p.path);
                    return [caseOf(inkStyle), inkStyle].flatMap((style, ci) => spans.flatMap(({ pts, leg }, si) => {
                      const seg = p.path[leg] || {};
                      const bwd = p.kind === "player" && seg.dir === "bwd";
                      const wig = !bwd && p.kind === "player" && carry && carry.has(leg);
                      const subs = gapPolyAt(pts, centers, actGap, strokeAR);
                      return subs.map((sub, k) => {
                        const lastBit = si === spans.length - 1 && k === subs.length - 1;
                        if (bwd) return <path key={`${ci}/${si}/${k}`} d={zigzagPoly(sub, strokeAR, lastBit)} {...style} strokeLinejoin="round" pointerEvents="none" />;
                        const shaped = wig ? wigglePoly(sub, strokeAR, lastBit) : sub;
                        return (
                          <polyline key={`${ci}/${si}/${k}`} points={shaped.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ")}
                            {...style} strokeLinejoin="round" pointerEvents="none" />
                        );
                      });
                    }));
                  })()}
                  {/* arrow + action badges last so they sit ON TOP of the line */}
                  {showRoutes && p.path.length > 0 && renderArrow(p, bent, acts, endStagger[p.id] || 0)}
                  {showRoutes && renderActionMarks(p, bent, acts)}
                  {showRoutes && renderLedCatchMarks(p, ledCs)}
                </g>
              );
            })}

            {/* (A) resolved-index refs for the CHOSEN path of every branching player —
                timing measures each spliced segment at `id/i`. Rendered over the whole
                effective path (not base-length + append) so a mid-route branch, which
                truncates the trunk, still lands its segments at the right indices. */}
            {!aiPlay && effPieces.map(p => {
              if (p.kind !== "player" || !(p.forks || []).length) return null;
              let prev = { x: p.x, y: p.y };
              return (
                <g key={`fkm-${p.id}`}>
                  {p.path.map((s, i) => {
                    const d = segD(prev, s); prev = { x: s.x, y: s.y };
                    return <path key={i} d={d} fill="none" stroke="none"
                      ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />;
                  })}
                </g>
              );
            })}
            {/* (B) authoring-key refs for EVERY authored segment (base path + every
                branch, chosen or not) at `seg:id:ref:i`, so resolveRoute can measure
                branch-arrival times BEFORE the light picks a branch. Origin of a branch
                is its parent's `at` waypoint (route end by default). Rendered for ALL
                players (not just branching ones) so a NON-branching player watched by a
                `when=…@wp`/`link=` condition still has measured reach-times to race on. */}
            {!aiPlay && pieces.map(p => {
              if (p.kind !== "player" || !(p.path || []).length) return null;
              const els = [];
              const emit = (segs, origin, ref, branches) => {
                let prev = origin;
                (segs || []).forEach((s, i) => {
                  const d = segD(prev, s); prev = { x: s.x, y: s.y };
                  const key = `seg:${p.id}:${ref}:${i}`;
                  els.push(<path key={key} d={d} fill="none" stroke="none"
                    ref={el => { if (el) segRefs.current[key] = el; }} />);
                });
                (branches || []).forEach(f => {
                  if (!f.path || !f.path.length) return;
                  const at = f.at != null ? f.at : (segs.length - 1);
                  const o = segs && segs[at] ? { x: segs[at].x, y: segs[at].y } : origin;
                  emit(f.path, o, ref ? ref + "/" + f.color : f.color, f.forks);
                });
              };
              emit(p.path, { x: p.x, y: p.y }, "", p.forks);
              return <g key={`segm-${p.id}`}>{els}</g>;
            })}
            {showRoutes && !aiPlay && pieces.map(p => {
              if (p.kind !== "player" || !(p.forks || []).length) return null;
              const chosen = chosenForkRefs(p);
              // while previewing all branches, EVERY candidate route reads as solid/active
              const previewAll = previewAllBranches && animT > 0;
              // in the PLANNER (not presentation) and NOT animating, every branch off a
              // conditional waypoint reads solid/active so they can all be seen and edited;
              // playback (animT > 0) still highlights just the chosen run's route.
              const plannerEdit = !presentation && animT <= 0;
              const obstacles = collisions && effAvoidVis ? detourObstaclesFor(p.id) : [];
              // Draw each branch from the waypoint it departs (its `at`, route end by
              // default); recurse into chained branches. Branch routes render with the
              // SAME machinery and style as base routes — segStroke thickness/opacity,
              // line-thickness setting, tidy-arrowhead end trims, obstacle detour (bent
              // line + faint ghost), and wiggle/zigzag shaping — so a reaction line
              // looks identical to a base line; only the dash marks a non-chosen
              // alternative. Each distinct branch origin gets a reaction-light action
              // circle, drawn last (on top).
              const renderLevel = (branches, parentSegs, parentOrigin, prefix) => {
                const items = [], badges = new Map();
                // the parent route's own action waypoints — a branch departing from one
                // lifts its brain badge above the action circle instead of covering it
                const parentActs = routeActionWaypoints(p, parentSegs || [], prefix);
                (branches || []).forEach(f => {
                  if (!f.path || !f.path.length) return;
                  const ref = prefix ? prefix + "/" + f.color : f.color;
                  const at = f.at != null ? f.at : (parentSegs.length - 1);
                  const origin = parentSegs && parentSegs[at] ? { x: parentSegs[at].x, y: parentSegs[at].y } : parentOrigin;
                  const editThis = editingFork && editingFork.id === p.id && forkEq(editingFork.color, ref);
                  const active = previewAll || plannerEdit || chosen.has(String(ref).toLowerCase());
                  const end = f.path[f.path.length - 1];
                  const solid = editThis || active;
                  // marks only: chosen/active branch marks read full like base-route marks;
                  // non-chosen alternatives keep a dim so they don't compete during playback
                  const markOp = solid ? 1 : 0.5;
                  const det = collisions ? detourOf(origin, f.path, obstacles, `${p.id}:fork:${ref}`) : null;
                  const bent = det && det.pts;
                  // a branch is a normal route: action circles at its OWN action waypoints
                  // (every branch shows its own, faint for the non-chosen ones), and a
                  // wiggle line wherever the player carries the puck on it
                  const acts = routeActionWaypoints(p, f.path, ref);
                  const carry = branchCarrySegs(p, ref, f.path);
                  // a CUE-driven route draws in its cue colour (matching the light), so
                  // "on green" reads green on the ice; any other condition (random /
                  // sequence / always / possession / link / event) keeps the player's own
                  // colour — it's a decision, not a colour-coded read.
                  const cd = condOf(f);
                  const routeCol = cd.type === "light" ? (cd.color || f.color) : ink(p.color);
                  // same stroke as a base route (segStroke: thickness setting × lineScale,
                  // 0.78 opacity, non-scaling) with the cue colour swapped in; non-chosen
                  // alternatives dim to half the base opacity and keep their dash
                  const baseLine = segStroke(p, f.path[f.path.length - 1] || {}, false, false);
                  const line = { ...baseLine, stroke: routeCol, strokeLinejoin: "round", pointerEvents: "none",
                    ...(solid ? {} : { opacity: baseLine.opacity * 0.5 }) };
                  // chained-fork departures on THIS branch get the same line hole as a
                  // base route's branch points (forkAts)
                  const subForkAts = new Set((f.forks || []).filter(g => g.path && g.path.length)
                    .map(g => g.at != null ? g.at : f.path.length - 1));
                  // hoisted so the end carat's queue-back can trim the drawn line, just
                  // like a base route's endStagger trim. arrivalBack is call-order
                  // sensitive: keep today's order — this branch's action-mark carats,
                  // then its end mark, then (via JSX) chained children.
                  const actMarksEl = routeActionMarks(f.path, origin, acts, routeCol, bent, `${ref}:`);
                  const endMark = (() => {
                    // chains onward (drawn child branches) → the reaction badge marks it
                    if ((f.forks || []).some(g => g.path && g.path.length)) return null;
                    // an action authored on the last waypoint is already an action circle
                    if (acts.has(f.path.length - 1)) return null;
                    let ea;
                    if (bent && bent.length >= 2) {
                      const eP = bent[bent.length - 1], b = bent[Math.max(0, bent.length - 4)];
                      ea = { endPt: eP, ang: Math.atan2(eP.y - b.y, eP.x - b.x) * 180 / Math.PI };
                    } else ea = pathEndArrow(f.path, origin);
                    if (!ea) return null;
                    // legacy branch `action` → its circle, else a plain skate carat / ‖ stop
                    const legacy = f.action && f.action !== "skate" ? forkActionIcon(f.action) : null;
                    if (legacy && effActCircles) return { ea, legacy };
                    // several branches can END at the same spot — queue the carats
                    return { ea, bk: arrivalBack("main", ea.endPt.x, ea.endPt.y) };
                  })();
                  const endBk = endMark && !endMark.legacy ? (endMark.bk || 0) : 0;
                  // casing pass first over the whole branch, then the ink pass —
                  // dim (non-chosen) branches keep a softer casing so they don't
                  // read heavier than their own line
                  const caseLine = { ...caseOf(line), ...(solid ? {} : { opacity: 0.6 }) };
                  const renderBranchSegs = cas => {
                    const st = cas ? caseLine : line;
                    let prev = origin;
                    return f.path.map((s, i) => {
                        const from = prev, d = segD(prev, s);
                        prev = { x: s.x, y: s.y };
                        const isLast = i === f.path.length - 1;
                        const bwd = solid && s.dir === "bwd";          // backward skating → zigzag
                        const wig = solid && carry.has(i) && !bwd;     // carrying the puck → wiggle
                        // leave a gap at the branch origin (its reaction badge) and around any
                        // action circle, just like a base route
                        const startGap = i === 0 ? actGap : (acts.has(i - 1) || subForkAts.has(i - 1)) ? actGap : 0;
                        const endGap = (acts.has(i) || subForkAts.has(i)) ? actGap : isLast ? endBk : 0;
                        let vFrom = from, vSeg = s;
                        if (!bent && startGap) { const t = trimSegStart(vFrom, vSeg, startGap, strokeAR); if (t) { vFrom = t.from; vSeg = t.seg; } }
                        if (!bent && endGap) { const t = trimSegEnd(vFrom, vSeg, endGap, strokeAR); if (t) vSeg = t.seg; }
                        const vD = (!bent && (startGap || endGap)) ? segD(vFrom, vSeg) : d;
                        return (
                          <g key={`${cas ? "c:" : ""}${i}`}>
                            {!bent && (bwd
                              ? <path d={zigzagPoints(vFrom, vSeg, strokeAR, isLast || acts.has(i))} {...st} strokeLinejoin="round" />
                              : wig
                              ? <polyline points={wigglePoints(vFrom, vSeg, strokeAR, isLast || acts.has(i))} {...st} strokeLinejoin="round" />
                              : <path d={vD} {...st} strokeDasharray={solid ? undefined : sdash("1.6 1.1")} />)}
                            {/* detour active → the authored branch lingers as a faint dashed
                                ghost, exactly like a base route */}
                            {!cas && bent && (
                              <path d={d} fill="none" stroke={routeCol} strokeWidth={sw(0.5)}
                                strokeDasharray={sdash("1.4 1.6")} strokeLinecap="round"
                                vectorEffect="non-scaling-stroke" opacity={0.22 * (solid ? 1 : 0.5)} pointerEvents="none" />
                            )}
                            {!cas && editing && !playing && (
                              <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                                onPointerDown={e => lineDown(e, p.id, i, ref)} style={{ cursor: "pointer" }}
                                pointerEvents={p.lock && !lockedSelectable ? "none" : undefined} />
                            )}
                          </g>
                        );
                      });
                  };
                  items.push(
                    <g key={ref}>
                      {renderBranchSegs(true)}
                      {renderBranchSegs(false)}
                      {/* detour collapses the branch to one bent polyline (wiggle a carry,
                          zigzag a backward leg), same as a base route. actGap holes at
                          the origin (its reaction badge — the authored startGap) and at
                          the branch's own action circles keep the bent line clear of them */}
                      {bent && (() => {
                        const bLine = endBk ? trimPolyEnd(bent, endBk, strokeAR) : bent;
                        const centers = [{ x: origin.x, y: origin.y },
                          ...[...acts.keys()].filter(i => f.path[i]).map(i => ({ x: f.path[i].x, y: f.path[i].y })),
                          ...[...subForkAts].filter(i => f.path[i]).map(i => ({ x: f.path[i].x, y: f.path[i].y }))];
                        // per-leg spans, exactly like a bent base route
                        const spans = polyLegSpans(bLine, f.path);
                        return [caseLine, line].flatMap((st, ci) => spans.flatMap(({ pts, leg }, si) => {
                          const seg = f.path[leg] || {};
                          const bwd = solid && seg.dir === "bwd";
                          const wig = !bwd && solid && carry.has(leg);
                          const subs = gapPolyAt(pts, centers, actGap, strokeAR);
                          return subs.map((sub, k) => {
                            const lastBit = si === spans.length - 1 && k === subs.length - 1;
                            if (bwd) return <path key={`${ci}/${si}/${k}`} d={zigzagPoly(sub, strokeAR, lastBit)}
                              {...st} strokeDasharray={solid ? undefined : sdash("1.6 1.1")} strokeLinejoin="round" />;
                            const shaped = wig ? wigglePoly(sub, strokeAR, lastBit) : sub;
                            return <polyline key={`${ci}/${si}/${k}`} points={shaped.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ")}
                              {...st} strokeDasharray={solid ? undefined : sdash("1.6 1.1")} strokeLinejoin="round" />;
                          });
                        }));
                      })()}
                      {/* action circles at every action waypoint on this branch (all branches,
                          dimmed to the branch's own opacity for the non-chosen ones) */}
                      <g opacity={markOp}>{actMarksEl}</g>
                      {endMark && (() => {                  // the branch's END mark (hoisted above)
                        const { ea, legacy, bk } = endMark;
                        if (legacy) return iconBadge(ea.endPt, legacy, routeCol, ref + "/act", markOp);
                        const ar = ea.ang * Math.PI / 180;
                        const ept = bk ? gmMove(ea.endPt.x, ea.endPt.y, -Math.cos(ar), -Math.sin(ar), bk) : ea.endPt;
                        return routeMark(ref + "/end", ept, ea.ang, !!end.endStop, routeCol, markOp);
                      })()}
                      {renderLevel(f.forks, f.path, origin, ref)}
                    </g>
                  );
                  const okey = `${origin.x.toFixed(2)},${origin.y.toFixed(2)}`;
                  const lift = parentActs.has(at);
                  if (!badges.has(okey)) badges.set(okey, { pt: origin, lift });
                  else if (lift) badges.get(okey).lift = true;
                });
                // badges last so each action circle sits ON TOP of its converging routes
                badges.forEach((b, k) => items.push(reactionBadge(b.pt, p.color, `rb-${p.id}-${prefix || "base"}-${k}`, b.lift)));
                return items;
              };
              return <g key={`fkv-${p.id}`}>{renderLevel(p.forks, p.path, branchPoint(p), "")}</g>;
            })}

            {showRoutes && pieces.map(p => <g key={`s-${p.id}`}>{renderStops(p)}</g>)}
            </g>{/* end route-markings opacity group */}

            {editing && pieces.map(p =>
              p.kind === "puck" && p.carrier && p.path.length > 0
                ? hdot(p.x, p.y, 2.1, { key: `rel-${p.id}`, fill: "none", stroke: T["ice-ink"],
                    strokeWidth: 0.35, strokeDasharray: "0.9 0.7", opacity: 0.6, pointerEvents: "none" })
                : null
            )}

            {/* puck travel path, branch ghost arrows + the in-progress draw preview
                are drill markings — dimmed by Mark opacity */}
            <g opacity={markMO}>
            <g>{puckPathNodes(false, true)}{puckPathNodes(false)}</g>
            {renderBranchGhostArrows()}
            {renderRouteNumbers()}

            {/* Nib reticle: a ring the exact size of the mark about to be laid
                down (or of the eraser's reach), so a fingertip — which hides
                its own contact point — still shows where and how thick. The
                ellipse pre-compensates the fill-stretch so it reads round. */}
            {penTip && (() => {
              // A faint ghost of the nib, not a target: a soft dot the size and
              // colour of the ink about to be laid down, so it reads as a hint
              // rather than competing with the drawing. Sized in SCREEN terms —
              // a feet-based floor would vanish at full-rink zoom and bloat when
              // zoomed right in. The eraser gets its own reach, in red.
              const ft = n => n * Math.min(penScale.current.x || 0.24, penScale.current.y || 0.24);
              const r = eraser ? ft(16) : Math.max(penW / 2, ft(6));
              const col = eraser ? "#ff8b8b" : markColor;
              return (
                <g pointerEvents="none">
                  <ellipse cx={penTip.x} cy={penTip.y} rx={r} ry={r * yFix}
                    fill={eraser ? "none" : col} fillOpacity={0.22}
                    stroke={col} strokeOpacity={eraser ? 0.5 : 0.35} strokeWidth={ft(1)}
                    strokeDasharray={eraser ? `${ft(3)} ${ft(3)}` : undefined} />
                </g>
              );
            })()}
            {/* buffered pen strokes render exactly like the live one — the ink
                reads as one continuous line until the burst snaps into pieces */}
            {penInk.map((pts, i) => pts.length > 1 && (
              <polyline key={`pen${i}`} points={pts.map(q => `${q.x},${q.y}`).join(" ")} fill="none"
                stroke={ink(markColor)} strokeWidth={penW} strokeLinecap="round" strokeLinejoin="round"
                opacity={0.9} pointerEvents="none" />
            ))}
            {drawPreview && drawPreview.length > 1 && (
              tool === "marker" || tool === "pen"
                ? <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={ink(markColor)}
                    strokeWidth={tool === "pen" ? penW : markWidth} strokeLinecap="round" strokeLinejoin="round"
                    opacity={0.9} pointerEvents="none" />
                : <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")} vectorEffect="non-scaling-stroke"
                    fill="none" stroke={T["ice-select"]} strokeWidth={sw(0.6)} strokeDasharray={sdash("1.4 1")} opacity={0.9} />
            )}
            </g>

            {/* named-group outline + label: shown for the selected piece's group
                and the currently multi-selected group */}
            {editing && !playing && (() => {
              const shown = new Set();
              const selP = pieces.find(p => p.id === selectedId);
              if (selP && selP.group) shown.add(selP.group);
              const mg = selGroupName();
              if (mg) shown.add(mg);
              return [...shown].map(name => {
                const mem = pieces.filter(p => p.group === name);
                if (!mem.length) return null;
                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                const acc = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
                mem.forEach(p => { const dp = displayPos(p); acc(dp.x, dp.y); (p.path || []).forEach(s => acc(s.x, s.y)); });
                const PAD = 6.5; x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
                const xf = iconXf({ x: x0 + 2.5, y: y0 + 1, a: 0 });
                return (
                  <g key={`grp-${name}`} pointerEvents="none">
                    <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={2.5} ry={2.5 * yFix}
                      fill="none" stroke="#8b6ff0" strokeWidth={sw(0.55)} strokeDasharray={sdash("2 1.5")} vectorEffect="non-scaling-stroke" opacity={0.9} />
                    <g transform={xf.t}>
                      <text transform={`rotate(${-xf.th})`} fontSize={2.6} fontWeight={800} fill="#a48cf5"
                        style={{ userSelect: "none", fontFamily: "system-ui, sans-serif", paintOrder: "stroke", stroke: "rgba(8,12,18,0.65)", strokeWidth: 0.55 }}>◇ {name}</text>
                    </g>
                  </g>
                );
              });
            })()}
            {/* box-select highlights + the marquee rectangle */}
            {multiSel && editing && [...pieces].filter(p => multiSel.has(p.id)).map(p => {
              const dp = displayPos(p);
              return hdot(dp.x, dp.y, 5.2, { key: `ms-${p.id}`, fill: "rgba(58,141,255,0.1)",
                stroke: "#3a8dff", strokeWidth: sw(0.6), strokeDasharray: sdash("1.5 1"), vectorEffect: "non-scaling-stroke", pointerEvents: "none" });
            })}
            {marquee && (
              <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
                fill="rgba(58,141,255,0.12)" stroke="#3a8dff" strokeWidth={sw(0.5)} strokeDasharray={sdash("1.5 1")}
                vectorEffect="non-scaling-stroke" pointerEvents="none" />
            )}

            {/* double-tap "Add here": a target reticle marks where the piece will
                land; hovering/focusing a tool in the popup previews that exact
                piece (same colour/label the real placement would get) in place */}
            {popup?.type === "add" && popup.pt && (() => {
              const pt = popup.pt;
              const k = addHover === "playerpuck" ? "player" : addHover;
              if (k && k !== "draw") {
                const gp = makePiece(k, pt);
                // labels aren't a PieceIcon kind — ghost them with the real label renderer
                if (k === "label") {
                  return (
                    <g key="addghost" opacity={0.55} pointerEvents="none">
                      {labelNode("addghost-lbl", pt.x, pt.y, gp.text, gp.size, gp, false, null, null, true)}
                    </g>
                  );
                }
                const fx = iconXf({ x: pt.x, y: pt.y, a: gp.facing || 0 });
                return (
                  <g key="addghost" opacity={0.55} pointerEvents="none">
                    <PieceIcon p={gp} pos={{ x: pt.x, y: pt.y, a: gp.facing || 0 }} xf={fx.t} thDeg={fx.th}
                      wb={whiteboard} wbCircle={wbCircle} noShadow hitOff onDown={() => {}} />
                  </g>
                );
              }
              return (
                <g key="addtarget" pointerEvents="none">
                  {hdot(pt.x, pt.y, 2.4, { fill: "none", stroke: T.accent, strokeWidth: sw(0.55),
                    strokeDasharray: sdash("1.2 1"), vectorEffect: "non-scaling-stroke" })}
                  {hdot(pt.x, pt.y, 0.45, { fill: T.accent })}
                </g>
              );
            })()}

            {/* route/mark editing handles are painted LAST (below, after the piece
                icons) so grabbing a waypoint always wins over any prop stacked on
                top of it — see the handles block after the pieces map. */}

            {/* preview all branches: while playing, a faint ghost of the player skates
               down EVERY candidate route at once, so the coach sees each reaction option
               in one pass. If the player starts with a puck, each ghost carries a ghost
               puck that rides along and breaks to the net / receiver when that branch's
               action fires. Render-only — never enters timing, so the real run is unaffected. */}
            {previewAllBranches && animT > 0 && !aiPlay && pieces.map(p => {
              if (p.kind !== "player" || !(p.forks || []).length) return null;
              const routes = enumerateRoutes(p);
              if (routes.length <= 1) return null;
              const carried = pieces.find(q => q.kind === "puck" && q.carrier === p.id);   // the puck P starts with
              const side = p.hand === "L" ? -1 : 1;
              const nets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
              const nearNet = pt => nets.length ? nets.reduce((a, b) => Math.hypot(b.x - pt.x, b.y - pt.y) < Math.hypot(a.x - pt.x, a.y - pt.y) ? b : a) : null;
              // the puck action that fires on branch `leafRef` → { relPt, target }, where
              // target is the ACTUAL completion: the net for a shot, the boards landing for
              // a chip/rim, the receiver's LIVE position for a pass.
              const ghostAction = leafRef => {
                if (!carried) return null;
                const terms = carried.terminals || [];
                for (const t of terms) {
                  if ((t.by || terminalActor(carried, pieces, t.ref || "")) !== p.id) continue;   // a cross-player terminal (a received puck's shot) isn't P's own
                  if (!isAncestorRef(t.ref, leafRef)) continue;
                  const rp = routeSegs(p, t.ref), wp = t.at < 0 ? { x: p.x, y: p.y } : rp[t.at];
                  if (!wp) continue;
                  let target;
                  if (t.kind === "shot") { const net = t.net ? pieces.find(n => n.id === t.net) : nearNet(wp); target = net ? { x: net.x, y: net.y } : wp; }
                  else {
                    const dist = t.dist != null ? t.dist : (t.kind === "rim" ? REL_DEFAULT.rimAt : REL_DEFAULT.chipAt);
                    let path = null;
                    try {
                      if (t.kind === "chip") { const a = (t.aim != null ? t.aim : 0) * Math.PI / 180; path = boards.slide(wp.x, wp.y, Math.cos(a), Math.sin(a), dist); }
                      else path = boards.rimAround(wp, dist, t.aim);
                    } catch { path = null; }
                    target = (path && path.length) ? path[path.length - 1] : wp;
                  }
                  return { kind: t.kind, relPt: { x: wp.x, y: wp.y }, target };
                }
                for (const t of (carried.transfers || [])) {
                  if (t.kind !== "pass" || !isAncestorRef(t.atRef, leafRef)) continue;
                  const rp = routeSegs(p, t.atRef), wp = t.at < 0 ? { x: p.x, y: p.y } : rp[t.at];
                  if (!wp) continue;
                  const rec = pieces.find(q => q.id === t.to);
                  const live = rec ? displayPos(rec) : null;   // pass to where the receiver actually is
                  return { kind: "pass", relPt: { x: wp.x, y: wp.y }, target: live ? { x: live.x, y: live.y } : (rec ? { x: rec.x, y: rec.y } : wp) };
                }
                return null;
              };
              const polyLen = poly => { let t = 0; for (let i = 1; i < poly.length; i++) t += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y); return t; };
              const arcFracAt = (poly, pt) => {
                let total = 0; const cum = [0];
                for (let i = 1; i < poly.length; i++) { total += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y); cum.push(total); }
                let best = 0, bd = Infinity;
                for (let i = 0; i < poly.length; i++) { const d = Math.hypot(poly[i].x - pt.x, poly[i].y - pt.y); if (d < bd) { bd = d; best = i; } }
                return total > 0 ? cum[best] / total : 1;
              };
              return (
                <g key={`ghost-${p.id}`} opacity={0.5} pointerEvents="none">
                  {routes.map((route, k) => {
                    const segs = route.path;
                    if (!segs.length) return null;
                    const det = collisions ? detourOf({ x: p.x, y: p.y }, segs, detourObstaclesFor(p.id), `${p.id}:ghost:${k}`) : null;
                    const poly = det ? det.pts : pathPolyline({ x: p.x, y: p.y }, segs);
                    if (poly.length < 2) return null;
                    const act = carried ? ghostAction(route.ref) : null;
                    // split the ghost's [0,1] clock into skate + flight, like the real run: the
                    // player carries to the release point, then the puck flies (fast: shots ×10,
                    // passes ×7). Without this a shot at the route END would never get airtime.
                    const rlen = polyLen(poly);
                    let skateEnd = 1, tRelease = 1, flightSpan = 0;
                    if (act) {
                      const relFrac = arcFracAt(poly, act.relPt);
                      const skateU = relFrac * rlen;
                      const spd = act.kind === "shot" ? SPEED.shot : act.kind === "pass" ? SPEED.pass : 5;
                      const flightU = Math.hypot(act.target.x - act.relPt.x, act.target.y - act.relPt.y) / spd;
                      const totalU = Math.max(rlen, skateU + flightU) || 1;
                      skateEnd = rlen / totalU; tRelease = skateU / totalU; flightSpan = flightU / totalU;
                    }
                    const gp = samplePoly(poly, skateEnd > 0 ? Math.min(animT / skateEnd, 1) : 1);
                    const fx = iconXf(gp);
                    const gpiece = { ...p, id: `${p.id}~g${k}`, path: segs, forks: [] };
                    const els = [<PieceIcon key="pl" p={gpiece} pos={gp} xf={fx.t} thDeg={fx.th} wb={whiteboard} wbCircle={wbCircle} dim onDown={() => {}} />];
                    if (carried) {
                      let pp;
                      if (!act || animT < tRelease) pp = bladeAtWorld(gp.x, gp.y, gp.a || 0, BLADE_FWD, BLADE_LAT, side);
                      else { const t2 = flightSpan > 0 ? Math.min(1, (animT - tRelease) / flightSpan) : 1; pp = { x: act.relPt.x + (act.target.x - act.relPt.x) * t2, y: act.relPt.y + (act.target.y - act.relPt.y) * t2 }; }
                      const pfx = iconXf({ x: pp.x, y: pp.y, a: 0 });
                      els.push(<PieceIcon key="pk" p={{ kind: "puck", color: carried.color }} pos={{ x: pp.x, y: pp.y, a: 0 }} xf={pfx.t} thDeg={pfx.th} dim onDown={() => {}} />);
                    }
                    return <g key={k}>{els}</g>;
                  })}
                </g>
              );
            })}

            {/* whiteboard: a faded ghost of each routed player's symbol holds the
               starting spot while the live symbol skates the route */}
            {!aiPlay && whiteboard && animT > 0 && pieces
              .filter(p => p.kind === "player" && p.path.length && !previewHiddenIds.has(p.id))
              .map(p => {
                const fx = iconXf({ x: p.x, y: p.y, a: p.facing || 0 });
                return (
                  <g key={`wbg-${p.id}`} opacity={0.3} pointerEvents="none">
                    <PieceIcon p={p} pos={{ x: p.x, y: p.y, a: p.facing || 0 }} xf={fx.t} thDeg={fx.th}
                      wb wbCircle={wbCircle} noShadow hitOff onDown={() => {}} />
                  </g>
                );
              })}

            {/* nets sit on the ice (bottom); players paint above pucks so a
               carried puck can't steal the grab; rotate ring is drawn last. A
               puck IN the net (a goal) sinks below the cage (rank −1). */}
            {!aiPlay && [
                ...pieces.filter(p => p.kind !== "label" && p.kind !== "mark" && !previewHiddenIds.has(p.id)),
                // goalies ride at rank 0.5 — above their net + drawn crease, below the action
                ...pieces.filter(q => (q.kind === "net" || q.kind === "tire") && q.goalie).map(n => ({ goalieOf: n })),
              ]
              .sort((a, b) => {
                const goalE = animT <= 0 ? 0 : animT * totalTime;
                const kindRank = p => (p.goalieOf ? 0.5
                  : p.kind === "puck" && puckInGoal(p, goalE) ? -1
                  // whiteboard: the puck rides ABOVE the symbols, so a carried puck
                  // sits on top of an opaque circled-symbol disc instead of under it
                  : p.kind === "puck" && whiteboard ? 2.5
                  : p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || p.kind === "tire" || p.kind === "stick" || p.kind === "light" ? 0 : p.kind === "player" ? 2 : 1);
                // locked pieces sink beneath every unlocked one, so a contested tap
                // always lands on the unlocked piece/waypoint stacked over it
                const rank = p => kindRank(p) - (p.lock ? 10 : 0);
                return rank(a) - rank(b);
              })
              .map(p => {
              if (p.goalieOf) return renderGoalie(p.goalieOf);
              const dp = displayPos(p);
              // a light's screen colour tracks its cue timeline as the drill plays
              if (p.kind === "light") p = { ...p, color: lightColor(p) };
              const isJump = p.kind === "player";
              const lift = p.kind === "puck" ? sauceLift(p) : isJump ? jumpLift(p) : 0;
              if (lift > 0.002) {
                // a sauced puck / jumping player floats above a sticky ground
                // shadow, riding higher + bigger toward the peak; the shadow
                // shrinks + fades as it rises. A jump grows the player more.
                const ld = liftDir(), off = lift * (isJump ? 2.8 : LIFT_MAX);
                const lp = { ...dp, x: dp.x + ld.x * off, y: dp.y + ld.y * off };
                const gfx = iconXf(dp), lfx = iconXf(lp);
                const k = 1 + (isJump ? 0.55 : 0.4) * lift;
                const shR = isJump ? 3.7 : 2.1, shOp = (isJump ? 0.2 : 0.24) * (1 - 0.55 * lift);
                return (
                  <g key={p.id}>
                    <g transform={gfx.t}>
                      <ellipse cx={isJump ? -0.5 : 0} cy={0} rx={shR * (1 - 0.2 * lift)} ry={shR * (1 - 0.2 * lift)}
                        fill="#0a0f14" opacity={shOp} pointerEvents="none" />
                    </g>
                    <g transform={`translate(${lp.x} ${lp.y}) scale(${k}) translate(${-lp.x} ${-lp.y})`}>
                      <PieceIcon p={p} pos={lp} xf={lfx.t} thDeg={lfx.th} noShadow={isJump} wb={whiteboard} wbCircle={wbCircle}
                        selected={editing && p.id === selectedId} swing={isJump ? displaySwing(p) : 0} dim={animT > 0} onDown={e => pieceDown(e, p.id)}
                        hitOff={p.lock && !lockedSelectable} />
                    </g>
                  </g>
                );
              }
              const fx = iconXf(dp);
              const icon = (
                <PieceIcon key={p.id} p={p} pos={dp} xf={fx.t} thDeg={fx.th} wb={whiteboard} wbCircle={wbCircle}
                  selected={editing && p.id === selectedId} swing={displaySwing(p)}
                  dim={animT > 0} onDown={e => pieceDown(e, p.id)}
                  hitOff={p.lock && !lockedSelectable}
                  onStickDown={editing && tool !== "draw" && p.kind === "player" && !p.path.length && !(p.lock && !lockedSelectable)
                    ? e => stickDown(e, p) : undefined} />
              );
              const spray = snowSpray(p, dp);
              return spray ? <g key={p.id}>{spray}{icon}</g> : icon;
            })}
            {/* editing handles ON TOP of all piece icons: a waypoint's grab target
                must beat any prop (stick/cone/…) stacked over it, so these paint
                after the pieces — same layer convention as the rotate/aim handles. */}
            {pieces.map(p => (
              <g key={`h-${p.id}`}>
                {renderHandles(p)}
                {/* a reaction fork open for editing gets its own handles */}
                {editingFork && editingFork.id === p.id && forkOf(p, editingFork.color)
                  ? renderHandles(p, yFix, editingFork.color) : null}
                {/* a pass receiver wears its waypoint numbers while the step
                    naming them is on screen */}
                {numberedIds?.has(p.id) ? renderWpNumbers(p) : null}
              </g>
            ))}
            {renderMarkHandles()}
            {renderMarkResize()}
            {selected && renderRotateHandle(selected)}
          <g opacity={markMO}>{pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p)}</g>)}</g>
            {!aiPlay && renderLabels()}
            {renderResultSplash()}
            </g>
            </g>
          </svg>
          {renderPopout()}
          {renderLoupe()}
          {view.s > 1.02 && (
            <button onClick={resetView} title="Reset zoom"
              style={{ position: "absolute", top: "calc(8px + env(safe-area-inset-top))", right: 8, zIndex: 46,
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 40,
                font: "600 13px system-ui, sans-serif", color: "#e8edf2",
                background: "rgba(23,29,37,.92)", border: "1px solid #33404f", borderRadius: 999,
                boxShadow: "0 2px 10px rgba(0,0,0,.4)", cursor: "pointer" }}>
              <Icon name="expand" size={14} /> Fit · {view.s.toFixed(1)}×
            </button>
          )}
        </div>
      </div>

      {/* ---------- AI game scoreboard ---------- */}
      {aiPlay && aiRef.current && (
        <div className="hd-preso" style={{ flexDirection: "row", alignItems: "center", bottom: "auto", top: "calc(10px + env(safe-area-inset-top))" }}>
          <div className="hd-preso-text">
            <span style={{ color: "#ff6b7a" }}>{aiRef.current.score[0]}</span>
            <span style={{ opacity: 0.6, margin: "0 6px" }}>–</span>
            <span style={{ color: "#6ea8ff" }}>{aiRef.current.score[1]}</span>
            <span style={{ opacity: 0.7, marginLeft: 14, fontSize: "0.8em" }}>
              {Math.max(0, Math.ceil(aiMins * 60 - aiClockRef.current))}s{aiRef.current.msg ? ` · ${aiRef.current.msg}` : ""}
            </span>
          </div>
          <button className="hd-preso-btn" onClick={() => setAiPlay(false)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="stop" size={13} /> Stop</button>
        </div>
      )}

      {/* ---------- presentation caption (read during a hold, or placeable while authoring) ---------- */}
      {(() => {
        const placing = placingStep != null && placingStep < drillSteps.length;
        const cap = placing ? { ...drillSteps[placingStep], idx: placingStep } : (presentation && holdStep ? holdStep : null);
        if (!cap) return null;
        const fpos = cap.pos ? rinkToRootFrac(cap.pos.x, cap.pos.y) : null;   // rink feet → app-rect fraction
        return (
          // in placing mode the box is the SAME size the caption will play at; the
          // move / delete / submit controls hang off the top as tabs so they don't
          // change its footprint (WYSIWYG placement).
          <div className={`hd-preso${placing ? " placing" : " tap"}`} style={captionStyle(fpos, placing)}
            onClick={placing ? undefined : skipHold}>
            {placing && (
              <div className="hd-preso-tabs">
                <span className="hd-preso-tab move" onPointerDown={capDragStart} onPointerMove={capDragMove}
                  onPointerUp={capDragEnd} onPointerCancel={capDragEnd} title="Drag to place">
                  <Icon name="grip" size={13} /> move
                </span>
                <button className="hd-preso-tab del" title="Delete this step"
                  onClick={() => { deleteStep(cap.idx); setPlacingStep(null); }}>✕</button>
                <button className="hd-preso-tab done" title="Done"
                  onClick={() => setPlacingStep(null)}>Done ✓</button>
              </div>
            )}
            {placing
              ? <div className="hd-preso-text" contentEditable suppressContentEditableWarning ref={edRef}
                  data-ph="Describe this beat…" onInput={e => setStepText(cap.idx, e.currentTarget.textContent)} />
              : <div className="hd-preso-text" dangerouslySetInnerHTML={{ __html: mdInline(mdEscape(cap.text || "")) }} />}
          </div>
        );
      })()}

      {/* ---------- empty-board coaching hint (new/cleared board only) ---------- */}
      {editing && mode === "edit" && !openMenu && !popup && tool === "select" &&
        pieces.every(p => p.kind === "net") && (
        <div className="hd-emptyhint">
          Tap <b>Add</b> on the bar to place players, or switch to <b>Draw</b> and sketch the drill.
          <span className="hd-ehsub">Quick add: double-tap anywhere on the ice</span>
        </div>
      )}

      {/* ---------- action bar · DRAW: the pen palette ---------- */}
      {actOn && mode === "draw" && (
        <div className="hd-act draw">
          {/* what the PEN does */}
          <div className="hd-pengroup">
            {/* No Draw|Edit switch here any more — the bottom bar's three-flow
                segment owns that, and it's the ~90px this palette needed to fit
                on one line at phone widths. */}
            {/* What the pen does with your ink, as ONE control. It used to be
                a Sketch toggle here and an Auto toggle 100px away in the other
                group, with Convert next to that — three controls for one idea,
                split across the bar, and the pair implied a fourth state that
                does not exist. Each cell says what happens to the NEXT stroke;
                the sentence under PEN_READ says it in words.
                On a phone there is no room for three cells, so it cycles —
                the same idiom as Speed and Lines on the transport.
                The DSL writes `sketch` on a mark (DSL 10); the old `note`
                spelling is still read, so older drills keep their ink. */}
            {dense ? (
              <div className={`hd-seg hd-penseg ${penRead}`} role="group" aria-label="What the pen does">
                <span className="hd-segknob" />
                {PEN_READ.map(([v, label, icon, says]) => (
                  <button key={v} className={`hd-segopt ${v}`} title={`${label} — ${says}`}
                    aria-pressed={penRead === v}
                    onClick={() => { setPen(v); }}>
                    <Icon name={icon} size={15} /><span>{label}</span>
                  </button>
                ))}
              </div>
            ) : (
              (() => {
                const i = PEN_READ.findIndex(([v]) => v === penRead);
                const [, label, icon, says] = penReadRow(penRead);
                return (
                  <button className={`hd-pentool${isSketch ? " on" : ""}`}
                    title={`${label} — ${says} Tap to change.`}
                    aria-label={`Pen: ${label}`}
                    onClick={() => setPen(PEN_READ[(i + 1) % PEN_READ.length][0])}>
                    <Icon name={icon} size={18} /><span>{label}</span>
                  </button>
                );
              })()
            )}
            {/* Convert lives beside the state it belongs to, and ONLY in
                manual — it is what makes conversion happen there. In sketch
                nothing is ever read, and in auto it already has been, so a
                button that swept older ink from either was just a surprise. */}
            {penRead === "manual" && (
              <button className="hd-pentool" title="Convert — read the whole drawing now" onClick={convertInk}>
                <Icon name="wand" size={18} /><span>Convert</span>
              </button>
            )}
            <div className="hd-pensep" />
            {/* a toggle, not a one-way latch — with Draw folded into the mode
                switch, this is the only way back to inking. It does NOT touch
                what the pen does: arming the eraser used to silently drop you
                out of Sketch, with no way back but noticing. */}
            <button className={`hd-pentool${eraser ? " on" : ""}`}
              title={eraser ? "Erasing — tap to ink again"
                : "Erase — stroke over ink, routes or pieces to remove them"}
              onClick={() => { setEraser(v => !v); if (tool !== "pen") setTool("pen"); }}>
              <Icon name="eraser" size={18} /><span>Erase</span>
            </button>
            <div className="hd-pensep" />
            {dense ? (
              /* wide: colour, size and style all out on the bar, one click each */
              <>
                <div className="hd-peninks" title="Ink colour — also the colour of any piece you draw">
                  {inkSwatches}
                </div>
                <div className="hd-pensep" />
                {/* size: a vertical slider that springs from its own button */}
                <div className="hd-penwrap">
                  <button className={`hd-pentool${penPop === "size" ? " on" : ""}`} title="Line thickness"
                    onClick={() => setPenPop(v => (v === "size" ? null : "size"))}>
                    <span className="hd-penwdot" style={{ height: Math.max(2, Math.round(markWidth * markWidth * 2.4)) }} />
                    <span>Size</span>
                  </button>
                  {penPop === "size" && <div className="hd-penpop">{sizeSlider}</div>}
                </div>
                {/* style: the four line kinds, stacked above their button */}
                <div className="hd-penwrap">
                  <button className={`hd-pentool${penPop === "style" ? " on" : ""}`} title="Line style"
                    onClick={() => setPenPop(v => (v === "style" ? null : "style"))}>
                    <span className={`hd-penstyle ${markStyle}`} /><span>Style</span>
                  </button>
                  {penPop === "style" && <div className="hd-penpop menu">{styleRows}</div>}
                </div>
              </>
            ) : (
              /* narrow: all three behind one button. The trigger wears the live
                 ink as a swatch — the only place a raw colour is legible, since
                 .hd-penwdot and .hd-penstyle deliberately follow the BUTTON's
                 colour so black ink can't vanish against a dark bar. */
              <div className="hd-penwrap">
                <button className={`hd-pentool${penPop === "ink" ? " on" : ""}`} title="Ink colour, thickness & style"
                  onClick={() => setPenPop(v => (v === "ink" ? null : "ink"))}>
                  <span className="hd-penswatch" style={{ background: ink(markColor), width: 18, height: 18 }} />
                  <span>Ink</span>
                </button>
                {penPop === "ink" && (
                  <div className="hd-penpop menu">
                    <div className="hd-inkgrid">{inkSwatches}</div>
                    <div className="hd-penrule" />
                    {sizeSlider}
                    <div className="hd-penrule" />
                    {styleRows}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The bar's one flexible child, and until now 450px of dead space on
              a desktop. It says in plain words what the pen will do with the
              next stroke — the labels name the state, this says what the state
              MEANS. On a phone there's no room, so the same sentence goes over
              the ice through toolHint instead. */}
          <div className="hd-penspacer">
            {dense && <span className="hd-pensays">{penReadRow(penRead)[3]}</span>}
          </div>

          {/* what happens to the BOARD */}
          <div className="hd-pengroup">
            {/* "Clear" beside a trash can, in red, read as "clear the BOARD" —
                it only ever removes ink, and only the ink this pen state laid.
                Three things say so: the label names what goes, the count says
                how much — of THIS state's ink, so switching states changes the
                number — and with none of it on the sheet the button is dead,
                which is the strongest signal of all. A board full of players,
                or of the other state's ink, showing a greyed-out button plainly
                isn't offering to delete any of it. The title carries the scope,
                because the label has no room for it at 320px. */}
            <div className="hd-pensep" />
            <button className="hd-pentool danger" disabled={!inkCount} onClick={clearInk}
              title={inkCount
                ? `Remove ${inkCount} ${isSketch ? "sketch" : "ink"} mark${inkCount > 1 ? "s" : ""} — your ${isSketch ? "smart-pen ink" : "sketch ink"}, players, routes and props are untouched. Undo restores them.`
                : inkOther
                ? `No ${isSketch ? "sketch" : "smart-pen"} ink to clear — the ${inkOther} mark${inkOther > 1 ? "s" : ""} on the sheet ${inkOther > 1 ? "are" : "is"} ${isSketch ? "smart-pen ink. Switch the pen to Manual or Auto" : "sketch ink. Switch the pen to Sketch"} to clear ${inkOther > 1 ? "those" : "it"}.`
                : "No ink on the sheet to clear"}>
              <Icon name="trash" size={17} />
              <span>Clear ink{inkCount ? ` ${inkCount}` : ""}</span>
            </button>
            {/* no Done either: tapping EDIT or PLAY below is what finishes a
                sketch, and it commits the buffered ink on the way out */}
          </div>
        </div>
      )}

      {/* On a phone the bar has no room for a readable hint, so the ones that
          say what's happening RIGHT NOW float over the ice instead — where they
          have the width to be read, and clear of the bar. Only transient
          states: an armed tool, a route being drawn, a paused animation. The
          standing "tap a piece to edit it" is dropped, since a hint you've seen
          a hundred times is just something covering the rink. */}
      {actOn && !dense && !presoFull && transientHint && (
        <div className="hd-floathint">{transientHint}</div>
      )}

      {/* ---------- action bar · EDIT: the add palette ----------
          What used to be a full-screen sheet you opened, picked from, and closed
          again. Groups expand onto the bar as the screen earns the room:
            phone (< DENSE_MIN) — the four mains inline, props behind a popover
            tablet / desktop    — props come out too, so every common piece is
                                  one click away, which is the point of the room
          Keyed on width alone, NOT on isWide's pointer:fine — an iPad reports a
          COARSE pointer even with a Pencil attached, and a Pencil on a tablet is
          exactly the case that wants the open palette.
          desktop / landscape iPad (>= ROOMY_MIN) — the shapes come out too
          Shapes used to stay grouped at every width, on the grounds that
          inlining them would push the common pieces off the line. That's true
          up to about 972px and false above it, so it's a third tier rather
          than a rule. */}
      {actOn && mode === "edit" && (
        <div className="hd-act edit">
          {/* A selection takes the bar over completely — what you want next is
              something to DO with the thing you just picked, not another piece.
              There is deliberately no collapsed [+ Add] here: it assumed you'd
              add from a selection, when the way back to the palette is to tap
              the ice, which deselects. That's one tap either way, and it's the
              tap you were going to make anyway. */}
          {!selected && !multiSel?.size && (
            <>
              {ADD_GROUPS[0].kinds.map(addChip)}
              <div className="hd-pensep" />
              {dense ? <>{ADD_GROUPS[1].kinds.map(addChip)}</> : addGroupPop(ADD_GROUPS[1])}
              {roomy
                ? <><div className="hd-pensep" />{ADD_GROUPS[2].kinds.map(addChip)}</>
                : addGroupPop(ADD_GROUPS[2])}
            </>
          )}
          {/* ---- multi-select: was a third floating toolbar over the ice, with
              its own hand-rolled palette of raw hexes. It's the same kind of
              thing the bar exists for, so it lives here now. ---- */}
          {multiSel?.size > 0 && (
            <>
              <div className="hd-pensep" />
              <span className="hd-selchip">{selGroupName() ? `◇ ${selGroupName()}` : `${multiSel.size} selected`}</span>
              {dense && <>
                <button className="hd-pentool" title="Rotate left 15°" onClick={() => rotateGroup(-15)}>
                  <Icon name="rotateCcw" size={17} /><span>-15°</span></button>
                <button className="hd-pentool" title="Rotate right 15°" onClick={() => rotateGroup(15)}>
                  <Icon name="rotateCw" size={17} /><span>+15°</span></button>
                <button className="hd-pentool" title="Rotate 90°" onClick={() => rotateGroup(90)}>
                  <Icon name="rotateCw" size={17} /><span>90°</span></button>
              </>}
              <button className="hd-pentool" title="Duplicate the selection" onClick={duplicateGroup}>
                <Icon name="duplicate" size={17} /><span>Copy</span></button>
              {groupInput != null ? (
                <>
                  <input className="hd-groupname" autoFocus value={groupInput} placeholder="group name"
                    onChange={e => setGroupInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { createGroup(groupInput); setGroupInput(null); }
                      if (e.key === "Escape") setGroupInput(null); }} />
                  <button className="hd-pentool" title="Create group"
                    onClick={() => { createGroup(groupInput); setGroupInput(null); }}>
                    <Icon name="check" size={17} /><span>OK</span></button>
                </>
              ) : selGroupName() ? (
                <button className="hd-pentool" title="Ungroup" onClick={() => ungroup(selGroupName())}>
                  <Icon name="close" size={17} /><span>Ungroup</span></button>
              ) : (
                <button className="hd-pentool" title="Group the selection"
                  onClick={() => setGroupInput(selGroupName() || "")}>
                  <Icon name="grid" size={17} /><span>Group</span></button>
              )}
              <button className="hd-pentool danger" title="Delete the selection" onClick={deleteGroup}>
                <Icon name="trash" size={17} /><span>Delete</span></button>
              <div className="hd-pensep" />
              <button className="hd-pentool exit" title="Clear selection"
                onClick={() => { setMultiSel(null); setGroupInput(null); }}>
                <Icon name="close" size={17} /><span>Done</span></button>
            </>
          )}
          {/* ---- one piece selected: the four things you reach for without
              opening anything. "More" is the door to the full inspector. ---- */}
          {selected && !multiSel?.size && (() => {
            // popup wins when it targets this piece; otherwise a just-dragged
            // waypoint (dragSel) drives the strip, so a drag with no panel still
            // loads the point's actions.
            const active = popup && popup.id === selected.id ? popup
                         : (dragSel && dragSel.id === selected.id ? dragSel : null);
            const wp  = active && active.type === "point" ? active : null;
            const leg = active && active.type === "line"  ? active : null;
            const label = wp  ? `${selected.id} · pt ${wp.seg + 1}`
                        : leg ? `${selected.id} · leg ${leg.seg + 1}`
                        : selected.id;
            const acts  = wp  ? pointActions(selected, wp.seg, wp.fork || null)
                        : leg ? legActions(selected, leg.seg, leg.pt, leg.fork || null)
                        : pieceActions(selected, true);
            return (
              <>
                <span className="hd-selchip">{label}</span>
                {acts.map(actionChip)}
                <div className="hd-pensep" />
                <button className="hd-pentool exit" title="Deselect"
                  onClick={() => { setSelectedId(null); setPopup(null); setDragSel(null); }}>
                  <Icon name="close" size={17} /><span>Done</span></button>
              </>
            );
          })()}
          {/* the marker's own ink settings, surfaced only while it's armed —
              they came off the deleted Add sheet, where they appeared under the
              same condition */}
          {tool === "marker" && (
            <div className="hd-penwrap">
              <button className={`hd-pentool${penPop === "ink" ? " on" : ""}`} title="Marker colour, thickness & style"
                onClick={() => setPenPop(v => (v === "ink" ? null : "ink"))}>
                <span className="hd-penswatch" style={{ background: markColor, width: 18, height: 18 }} />
                <span>Ink</span>
              </button>
              {penPop === "ink" && (
                <div className="hd-penpop menu">
                  <div className="hd-inkgrid">{inkSwatches}</div>
                  <div className="hd-penrule" />
                  {sizeSlider}
                  <div className="hd-penrule" />
                  {styleRows}
                </div>
              )}
            </div>
          )}
          {tool !== "select" && (
            <>
              <div className="hd-pensep" />
              <button className="hd-pentool exit" title="Cancel the armed tool — nothing will be placed"
                onClick={() => setTool("select")}>
                <Icon name="close" size={17} /><span>Cancel</span>
              </button>
            </>
          )}
          {/* The hint only earns bar space where it can be READ. On a phone it
              truncated to "Tap a piece to ..." — worse than nothing — so there
              it moves over the ice (see .hd-floathint) and only for hints that
              say what's happening RIGHT NOW, not the standing idle one. */}
          {dense && !selected && !multiSel?.size
            ? <div className="hd-acthint">{toolHint || ""}</div>
            : <div className="hd-actspacer" />}
        </div>
      )}

      {/* ---------- action bar · PLAY: transport + scrubber ---------- */}
      {actOn && mode === "play" && (
        <div className="hd-act play">
          {/* In presentation the editor chrome is hidden; this is the way back
              to it. It lives ON the transport rather than being an edge gesture
              because the transport is the one thing always on screen — nothing
              to discover, and no fight with the iOS home swipe. */}
          {presoFull && (
            <button className={`hd-scrubbtn${barUp ? " on" : ""}`} onClick={toggleBar}
              title={barUp ? "Hide the editor bar" : "Show the editor bar"}
              aria-pressed={barUp}>
              <Icon name={barUp ? "chevronDown" : "chevronUp"} size={17} /></button>
          )}
          {/* Three jobs, three clusters. Transport (what the clock is doing),
              then how the ice LOOKS while it runs, and — separated by the track
              itself — the two that change the drill or the room rather than the
              playback. Grouping is spacing on a phone and a hairline once
              there's width for one: the separators cost ~26px, which at 375 the
              scrub track cannot spare. */}
          <div className="hd-scrubgrp">
            <button className="hd-scrubbtn play" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} size={20} /></button>
            <button className="hd-scrubbtn" onClick={resetPlay} title={playing ? "Stop" : "Reset"}>
              <Icon name={playing ? "stop" : "reset"} size={17} /></button>
            {dense && (
              <button className={`hd-scrubbtn${loopMode ? " on" : ""}`} onClick={() => setLoopMode(v => !v)} title="Loop">
                <Icon name="loop" size={17} /></button>
            )}
          </div>
          <div className="hd-scrubsep" />
          <div className="hd-scrubgrp vis">
          {/* What stays drawn while it plays. It belongs here rather than in a
              settings panel: it's something you change WHILE showing a drill —
              lines on to explain the pattern, off to watch it move — and the
              glyph is the answer itself, a route line over a puck path, each
              lit or dimmed. Tapping cycles the four. */}
          {(() => {
            const i = Math.max(0, ROUTE_VIS.findIndex(([v]) => v === playRoutes));
            const [, label, what] = ROUTE_VIS[i];
            const vis = routeVis(playRoutes);
            return (
              <button className="hd-scrubbtn rv" title={`Lines while playing: ${label} — ${what}. Tap to change.`}
                aria-label={`Lines while playing: ${label}`}
                onClick={() => setPlayRoutes(ROUTE_VIS[(i + 1) % ROUTE_VIS.length][0])}>
                <span className={`hd-rvline${vis.skaters ? " on" : ""}`} />
                <span className={`hd-rvpuck${vis.puck ? " on" : ""}`} />
              </button>
            );
          })()}
          {/* Speed. Same reasoning as the lines button beside it: you reach for
              it mid-demo, so it sits on the transport and not in a menu. It
              reads out its own state, so there's nothing to remember. */}
          {(() => {
            const i = Math.max(0, PLAY_SPEEDS.findIndex(([m]) => m === speedMul));
            const [, label, what] = PLAY_SPEEDS[i];
            return (
              <button className={`hd-scrubbtn spd${speedMul !== 1 ? " on" : ""}`}
                title={`Speed: ${label} — ${what}. Tap to change.`}
                aria-label={`Playback speed ${label}`}
                onClick={() => setSpeedMul(PLAY_SPEEDS[(i + 1) % PLAY_SPEEDS.length][0])}>
                {label}
              </button>
            );
          })()}
          </div>
          <div className="hd-scrubtrack">
            {wpTicks.map((f, k) => <span key={"w" + k} className="hd-tick wp" style={{ left: f * 100 + "%" }} />)}
            {stepTicks.map((f, k) => <span key={"s" + k} className="hd-tick step" style={{ left: f * 100 + "%" }} />)}
            <input className="hd-scrubrange" type="range" min={0} max={1} step={0.001} value={animT}
              onPointerDown={() => { if (playing) setPlaying(false); setHoldStep(null); holdRef.current = 0; }}
              onChange={e => scrubTo(+e.target.value)} />
          </div>
          <span className="hd-scrubtime">{Math.min(animT * totalTime, drillTime).toFixed(1)}/{drillTime.toFixed(1)}s</span>
          {/* Past the track, deliberately: neither of these is playback.
              Presentation changes how the room sees the drill, and the note
              button WRITES to it. Keeping them off the transport cluster means
              a reach for Stop can't land on "record a caption" mid-demo.

              On a phone this cluster — plus Loop — folds into one button. Seven
              controls and a draggable scrub track do not both fit at 375px: the
              track was measuring 25px, which is not something you can put a
              thumb on. Loop joins them because it is set once per run, where
              lines and speed get changed mid-demo. */}
          {dense ? (
            <>
              <div className="hd-scrubsep" />
              <div className="hd-scrubgrp">
                <button className={`hd-scrubbtn${presentation ? " on" : ""}`} onClick={togglePresentation} title="Presentation mode">
                  <Icon name="presentation" size={17} /></button>
                <button className="hd-scrubbtn" disabled={playing} onClick={addStepHere}
                  title="Add a description at this point"><Icon name="note" size={17} /></button>
              </div>
            </>
          ) : (
            <div className="hd-penwrap">
              {/* lit while open, and lit when something inside it is ON — so a
                  looping or presenting drill still says so with the pair
                  folded away */}
              <button className={`hd-scrubbtn${penPop === "more" || loopMode || presentation ? " on" : ""}`}
                title="Loop, presentation & captions"
                onClick={() => setPenPop(v => (v === "more" ? null : "more"))}>
                <Icon name="sliders" size={17} /></button>
              {penPop === "more" && (
                <div className="hd-penpop menu more">
                  <button className={`hd-penopt${loopMode ? " on" : ""}`}
                    onClick={() => { setLoopMode(v => !v); setPenPop(null); }}>
                    <Icon name="loop" size={15} /><span>Loop</span></button>
                  <button className={`hd-penopt${presentation ? " on" : ""}`}
                    onClick={() => { togglePresentation(); setPenPop(null); }}>
                    <Icon name="presentation" size={15} /><span>Presentation</span></button>
                  <button className="hd-penopt" disabled={playing}
                    onClick={() => { addStepHere(); setPenPop(null); }}>
                    <Icon name="note" size={15} /><span>Add caption</span></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- bottom menu bar ---------- */}
      {/* touching it while it's on loan in presentation restarts the countdown,
          so it can't slide away mid-reach */}
      <div className="hd-bar"
        onPointerDown={presoFull ? showBar : undefined}
        onPointerMove={presoFull ? showBar : undefined}>
        {/* Undo and redo LEAD the bar. They used to hold the middle; the flows
            took it, because the flows are what you touch all session and undo
            is a rescue — the prime, either-thumb spot goes to the control that
            earns it. Wrapped as ONE element so the lefty mirror moves the pair
            without reversing it: undo-then-redo is a direction, not an
            arrangement. These two buttons are the app's ONLY undo surface — no
            shortcut, no menu row, and a dozen toasts end "— Undo restores
            them" — which is why they keep their captions while the switch
            beside them drops its. */}
        <div className="hd-undogrp">
          <button className="hd-barbtn" title="Undo last change" disabled={!undoCount}
            onClick={undoLast}><Icon name="undo" size={16} /><span className="hd-blbl">Undo</span></button>
          <button className="hd-barbtn" title="Redo" disabled={!redoCount}
            onClick={redoLast}><Icon name="redo" size={16} /><span className="hd-blbl">Redo</span></button>
        </div>
        <div className="hd-barspacer" />
        {/* The three editor flows: dead centre, and bigger than anything beside
            them, because this is the control the whole app is driven from. It
            is centred by CONSTRUCTION, not by measurement — the block either
            side of it weighs the same (see .hd-barspacer in styles.js), which
            is also why it doesn't move when the bar mirrors for a lefty.
            Icon-only: the glyph plus the knob's colour say which flow is live,
            and the caption was costing about what the bigger cells now spend.
            aria-label carries the name instead — a title does nothing on touch.
            PLAY is disabled with nothing to animate; tapping it while already
            in Play starts/pauses the run, so a preview is one tap from anywhere
            without spending bar width on a separate transport button — which is
            why its accessible name follows what the tap will actually do. */}
        <div className={`hd-mode ${mode}`} role="group" aria-label="Editor mode">
          <span className="hd-modeknob" />
          {[["draw", "marker", "Draw", "Sketch the drill with the smart pen"],
            ["edit", "cursor", "Edit", "Add and change pieces, routes and settings"],
            ["play", "play", "Play", "Animate, scrub and present"]].map(([m, icon, lbl, tip]) => (
            <button key={m} className={`hd-modeopt ${m}`} title={tip}
              aria-label={m !== "play" ? lbl
                : !hasTimeline ? "Play — draw a route first"
                : mode === "play" ? (playing ? "Pause" : "Play") : lbl}
              disabled={m === "play" && !hasTimeline}
              aria-pressed={mode === m}
              onClick={() => (mode === m ? (m === "play" && togglePlay()) : setMode(m))}>
              <Icon name={m === "play" && mode === "play" && playing ? "pause" : icon} size={22} />
            </button>
          ))}
        </div>
        <div className="hd-barspacer" />
        <button ref={barBtnRefs.rinkmenu} className={`hd-barbtn${openMenu === "rinkmenu" ? " on" : ""}`} title="Rink"
          onClick={() => setOpenMenu(m => (m === "rinkmenu" ? null : "rinkmenu"))}>
          <Icon name="rink" size={16} />
          <span className="hd-blbl">{rink === "full" ? "Full"
            : rink === "half" ? `Half ${halfNS ? (halfFlip ? "↑" : "↓") : (halfFlip ? "←" : "→")}`
            : QUARTERS.find(q => q[0] === rink)?.[2] || "¼ ice"}</span>
        </button>
        <button ref={barBtnRefs.settings} className={`hd-barbtn${openMenu === "settings" ? " on" : ""}`} title="Menu"
          onClick={() => setOpenMenu(m => (m === "settings" ? null : "settings"))}>
          <Icon name="menu" size={16} /><span className="hd-blbl">Menu</span></button>
      </div>

      {/* ---------- menus ---------- */}
      {openMenu === "settings" && (
        <div className="hd-menu" style={menuAnchor}>
          {/* Sectioned by what a row DOES, and it keeps one grammar throughout:
              a chevron means the row opens another surface, a switch means it
              toggles something here, and a bare row acts immediately. The
              settings that used to sit in this list (ice zones, locked-item
              selection, the caption pause) moved to App & drill settings, where
              every row gets a line explaining it — a menu is for verbs. */}
          <div className="hd-mh">This drill</div>
          <input className="hd-input" placeholder="Drill name" value={drillTitle}
            onChange={e => setDrillTitle(e.target.value)} />
          {/* 62, not 46: under border-box the padding and border are inside the
              min-height, and 46 would render 16px shorter than it always has */}
          <textarea className="hd-input" style={{ minHeight: 62, resize: "vertical", fontFamily: "inherit" }}
            placeholder="Description" value={drillDesc} onChange={e => setDrillDesc(e.target.value)} spellCheck={false} />
          <button className="hd-item" onClick={() => setOpenMenu("notes")}>
            <Icon name="note" size={16} /> Notes / writeup{drillNotes.trim() ? " ✓" : ""}
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span></button>
          <button className="hd-item" onClick={() => setOpenMenu("steps")}>
            <Icon name="presentation" size={16} /> Steps &amp; captions
            {drillSteps.length ? ` · ${drillSteps.length}` : ""}
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span></button>
          <button className="hd-item" onClick={() => setOpenMenu("inventory")}>
            <Icon name="grid" size={16} /> Inventory / gear
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span></button>

          <div className="hd-mh hd-prefsec">Share</div>
          <button className="hd-item" onClick={() => { previewLink(); setOpenMenu(null); }}><Icon name="share" size={16} /> Share preview link</button>
          <button className="hd-item" onClick={() => { copyMd(); setOpenMenu(null); }}><Icon name="duplicate" size={16} /> Copy markdown</button>
          <button className="hd-item" onClick={() => { printSheet(); setOpenMenu(null); }}><Icon name="printer" size={16} /> Print sheet…</button>
          <button className="hd-item" onClick={() => { exportImage(); setOpenMenu(null); }}><Icon name="image" size={16} /> Export image</button>
          <button className="hd-item" onClick={() => { exportTxt(); setOpenMenu(null); }}><Icon name="download" size={16} /> Export .txt</button>
          <button className="hd-item" onClick={() => { exportMd(); setOpenMenu(null); }}><Icon name="download" size={16} /> Export .md</button>

          <div className="hd-mh hd-prefsec">Open</div>
          <button className="hd-item" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Load .txt / .md</button>
          <button className="hd-item" disabled={!!photoBusy} onClick={() => { setOpenMenu(null); photoRef.current?.click(); }}><Icon name="camera" size={16} /> Import from photo…</button>
          <button className="hd-item" onClick={openText}>
            <Icon name="keyboard" size={16} /> Text editor
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span></button>
          {crashBackup && (
            <button className="hd-item" onClick={() => {
              const r = parseDrill(crashBackup);
              if (r.errors.length) { flash("That saved board can't be read", 3200); return; }
              // no explicit undo push: the doc-watching effect records a
              // snapshot whenever pieces/rink/steps change, so a restore is
              // already as undoable as a file Load
              applyDrillPreview(r);
              clearBackup(); setCrashBackup(null);
              setOpenMenu(null);
              flash("Board restored", 2600);
            }}><Icon name="reset" size={16} /> Restore last board</button>
          )}

          <div className="hd-mh hd-prefsec">Board</div>
          <button className="hd-item" onClick={toggleLockAll}>
            <Icon name={anyLocked ? "unlock" : "lock"} size={16} /> {anyLocked ? "Unlock all" : "Lock board"}
            <span className={`hd-sw${anyLocked ? " on" : ""}`} />
          </button>
          <button className="hd-item" onClick={() => setOpenMenu("game")}>
            <Icon name="react" size={16} /> Game mode
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span>
          </button>

          <div className="hd-mh hd-prefsec">App</div>
          <button className="hd-item" onClick={() => setOpenMenu("prefs")}>
            <Icon name="sliders" size={16} /> App &amp; drill settings
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span>
          </button>
          {/* The version watermark used to sit in the bottom bar. It moved in
              here so the bar could be controls only — it's the build stamp you
              check after a deploy, so it stays a tap away rather than being
              buried, and it doubles as the way into About. */}
          <button className="hd-item hd-verrow" onClick={() => setOpenMenu("about")}>
            <Icon name="info" size={16} />
            <span className="hd-vernum">v{APP_VERSION}</span>
            <span className="hd-verstamp">{BUILD_STAMP}</span>
            <span className="hd-chev"><Icon name="chevronRight" size={14} /></span>
          </button>

          {/* destructive action lives alone at the very bottom, behind a divider */}
          <div className="hd-rule" />
          <button className="hd-item danger"
            onClick={() => {
              setPlaying(false); resetAnim();
              setPieces([]); setDrillSteps([]); setDrillItems([]);
              setDrillTitle(""); setDrillDesc(""); setDrillNotes(""); setDrillVersion(undefined);
              setPlacingStep(null); setEditAnchor(null);
              setSelectedId(null); setPopup(null); setOpenMenu(null);
              flash("Board cleared — Undo restores it", 3000);
            }}><Icon name="trash" size={16} /> Clear all</button>
        </div>
      )}

      {openMenu === "about" && (
        <div className="hd-sheet">
          <div className="hd-mh">About DrillBoard</div>
          <div className="hd-prefbody">
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">Version</span>
                <span className="hd-vernum">v{APP_VERSION}</span></div>
              <div className="hd-prefdesc">
                Built {BUILD_STAMP}. Drill format DSL&nbsp;{DSL_VERSION} — the version stamped into
                every drill you save or share.
              </div>
            </div>
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">What this is</span></div>
              <div className="hd-prefdesc">
                A full-screen drill animator for the bench. Sketch a drill with the smart pen or
                place pieces by hand, then play it back — skating, passes, shots and reactions all
                timed from real rink distances rather than from anything on screen.
              </div>
            </div>
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">Where drills live</span></div>
              <div className="hd-prefdesc">
                On this device. The board autosaves as you work, and a crash keeps a recoverable
                copy. Share a drill with <b>Share preview link</b> — the whole thing travels in the
                URL, so nothing is uploaded anywhere.
              </div>
            </div>
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">Something wrong?</span>
                <button className="hd-mini" onClick={() => { setShowDiag(true); setOpenMenu(null); }}>
                  Open diagnostics</button></div>
              <div className="hd-prefdesc">
                Diagnostics shows live viewport, safe-area and rink numbers — the fastest way to
                describe a layout problem on a phone. For ink that won&rsquo;t convert, use
                <b> Copy diagnostics</b> in App &amp; drill settings.
              </div>
            </div>
            <div className="hd-note">
              Add to Home Screen for the full-screen version — that&rsquo;s the one this is built for.
            </div>
          </div>
          <div className="hd-row">
            <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
            <button className="hd-btn exit" onClick={() => setOpenMenu(null)}>Done</button>
          </div>
        </div>
      )}

      {openMenu === "prefs" && (
        /* A sheet, not a corner menu. Every row now carries a sentence of
           explanation, and 18 of them in a 230px column wrap to five lines
           each — unreadable. Notes, Inventory and Steps are all sheets for the
           same reason. The body scrolls and the measure is capped so the prose
           stays a comfortable width on a desktop. */
        <div className="hd-sheet">
          <div className="hd-mh">App &amp; drill settings</div>
          <div className="hd-prefbody">

          {/* The rows whose effect is a PICTURE show the picture and let you tap
              it — see pref-preview.jsx. The rest keep their sentence: a sample
              that can't show the difference is noise, so timings, odds and the
              settings that only change how the SIMULATION behaves stay prose. */}
          <div className="hd-mh hd-prefsec">Display</div>
          <PrefPick title="Theme" scene="theme" ctx={pvCtx} value={themePref} set={setThemePref}
            opts={THEME_ORDER.map(v => [v, THEME_LABEL[v] || v])}
            desc={themePref === "auto"
              ? `Which palette the board and chrome use. Auto follows your device's appearance — currently ${themeName}.`
              : `Which palette the board and chrome use. Pinned to ${themePref}, ignoring your device's appearance.`} />
          {/* the one visual row with no board in it: a typeface shows itself, so
              each pill is set in the face it offers */}
          <PrefRow title="Typeface"
            desc="Which face the interface uses. All four are already on the device — nothing is downloaded, so this works with no signal. Rounded is Apple's SF Pro Rounded and only looks different on an iPhone or iPad.">
            <div className="hd-pills">
              {TYPEFACES.map(([v, lab, stack]) => (
                <button key={v} className={`hd-mini${typeface === v ? " on" : ""}`} aria-pressed={typeface === v}
                  style={{ fontFamily: stack }} onClick={() => setTypeface(v)}>{lab}</button>
              ))}
            </div>
          </PrefRow>
          <PrefPick title="Handedness" scene="hand" ctx={pvCtx} value={hand} set={setHand}
            opts={[["left", "Left"], ["right", "Right"]]}
            desc="Which side the bar's controls sit on. Left mirrors the bottom bar and the Draw and Edit palettes, so Menu, Rink and the tools fall under your left thumb instead of reaching across the ice. The rink and everything on it stay exactly where they are." />
          <PrefPick title="Stretch to fill" scene="stretch" ctx={pvCtx} value={stretchFill} set={setStretchFill}
            opts={[[true, "Stretch"], [false, "True shape"]]}
            desc="Full ice stretches to fill the screen. Off letterboxes it to true 200′ × 85′ proportions, so distances on the board match distances on the rink." />
          <PrefToggle title="Detailed animations" on={detailAnim} set={setDetailAnim}
            desc="Skater stride, stick swing, puck cradle and airborne shots. Turn off for a plainer picture, or if playback stutters on an older device." />
          <PrefPick title="Goal splashes" scene="splash" ctx={pvCtx} value={showResult} set={setShowResult}
            opts={[[true, "On"], [false, "Off"]]}
            desc="Call GOAL! / SAVE! / POST! over the net as each shot resolves." />
          <PrefPick title="Ice zones" scene="zones" ctx={pvCtx} value={showZones} set={setShowZones}
            opts={[[true, "On"], [false, "Off"]]}
            desc="Name the areas of the sheet over the rink — slot, half wall, neutral zone. Useful when writing captions that refer to them." />
          <PrefSample title="Line thickness" scene="thickness" ctx={pvCtx} value={lineScale}
            desc="Scales every route line, arrow and mark. Worth raising when projecting to a room."
            control={<Stepper value={lineScale} onChange={setLineScale} step={0.25}
              min={LINE_RANGE[0]} max={LINE_RANGE[1]} suffix="×" />} />
          <PrefSample title="Mark opacity" scene="opacity" ctx={pvCtx} value={markOpacity}
            desc={`How solid freehand marker ink and shapes are drawn — ${Math.round(markOpacity * 100)}% now. Lower lets rink markings read through your annotations.`}>
            <input type="range" min={MARK_RANGE[0]} max={MARK_RANGE[1]} step={0.05} value={markOpacity} style={{ width: "100%" }}
              onChange={e => setMarkOpacity(parseFloat(e.target.value))} />
          </PrefSample>
          {/* The mirror of Mark opacity, and next to it on purpose: that one
              quiets what you drew so the rink reads through it, this one quiets
              the rink so what you drew reads over it. */}
          <PrefSample title="Rink markings" scene="rinkdim" ctx={pvCtx} value={rinkDim}
            desc={rinkDim < 1
              ? `How strongly the rink's own lines, circles and creases are drawn — ${Math.round(rinkDim * 100)}% now. The ice itself doesn't change, so the sheet stays solid and only the markings step back.`
              : "How strongly the rink's own lines, circles and creases are drawn. Turn it down to let a busy drill read over the sheet, or to calm a projector."}>
            <input type="range" min={RINKDIM_RANGE[0]} max={RINKDIM_RANGE[1]} step={0.05} value={rinkDim} style={{ width: "100%" }}
              onChange={e => setRinkDim(parseFloat(e.target.value))} />
          </PrefSample>
          <PrefPick title="Action badges" scene="badges" ctx={pvCtx} value={actionCircles} set={setActionCircles}
            opts={[[true, "Show"], [false, "Hide"]]}
            dim={whiteboard}
            desc={whiteboard
              ? "The icon discs marking where a player passes, shoots or picks the puck up. Whiteboard mode never draws them, so this has no effect until you switch back to Graphic in the Rink menu."
              : "The icon discs marking where a player passes, shoots or picks the puck up. Hidden, the route just runs an arrow into the waypoint — the same look whiteboard mode has always had. What happens where is still listed in the piece's Chain of events."} />

          {/* Whiteboard mode itself is a board choice, not a preference — it
              lives in the Rink menu next to full/half/quarter. What stays here
              is how its symbols are drawn, and only while it is on. */}
          {whiteboard && (
            <>
              <div className="hd-mh hd-prefsec">Whiteboard</div>
              <PrefPick title="Circled symbols" scene="wbcircle" ctx={pvCtx} value={wbCircle} set={setWbCircle}
                opts={[[true, "Circled"], [false, "Bare"]]}
                desc="Put each X or O on an opaque disc so it stays readable where it crosses a rink line. Whiteboard mode itself is in the Rink menu." />
              <PrefPick title="Player names" scene="wbnames" ctx={pvCtx} value={wbNames} set={setWbNames}
                opts={[[true, "On"], [false, "Off"]]}
                desc="Show a name tag under every symbol. Off still names a player while their panel is open." />
            </>
          )}

          {/* Smart pen — settings that outlive a sketch, so they belong with the
              standing preferences rather than inside the Draw palette (which is
              a strip, not a settings panel, and only exists while drawing). */}
          <div className="hd-mh hd-prefsec">Board</div>
          <PrefToggle title="Allow selecting locked items" on={lockedSelectable} set={setLockedSelectable}
            desc="A locked piece normally ignores taps entirely, so you can draw over it freely. Turn this on to still select one — its panel opens with an Unlock button instead of its settings." />

          <div className="hd-mh hd-prefsec">Presentation</div>
          <PrefRow title="Minimum caption pause"
            desc={`The least time play holds at any caption — ${presoDelay}s. A longer note holds longer than this on its own (see below). Tapping the ice skips ahead without waiting.`}
            control={<Stepper value={presoDelay} onChange={setPresoDelay} step={0.5} min={0} suffix="s" />} />
          <PrefRow title="Reading pace"
            desc={(READ_PACES[readPace] || READ_PACES[READ_PACE_DEFAULT]).cps
              ? "Long captions hold past the minimum, scaled to how much there is to read. Brisk assumes a quick reader; Relaxed gives a room more time."
              : "Fixed — every caption holds for exactly the minimum above, however much it says."}
            control={<Stepper value={readPace} onChange={setReadPace} step={1} min={0} max={READ_PACES.length - 1}
              fmt={i => (READ_PACES[i] || READ_PACES[READ_PACE_DEFAULT]).label} />} />
          <PrefToggle title="Minor steps" on={minorDesc} set={setMinorDesc}
            desc="Auto-caption the areas each player skates through, on top of the steps you wrote yourself. A quick way to narrate a drill you haven't annotated." />

          <div className="hd-mh hd-prefsec">Smart pen</div>
          <PrefToggle title="Palm rejection" on={palmReject} set={setPalmReject}
            desc="While an Apple Pencil is in use, ignore fingers on the ice so a resting hand can't draw or drag a piece." />
          <PrefPick title="Pencil pressure" scene="pressure" ctx={pvCtx} value={pencilPress} set={setPencilPress}
            opts={[[true, "Varying"], [false, "Flat"]]}
            desc="Vary line weight with how hard you press. Off draws every stroke at the chosen width, and flattens ink already on the board." />
          <PrefRow title="Won't convert?"
            desc="Copies what the recogniser saw for the last burst of ink. Paste it into a bug report when a stroke refuses to become a piece."
            control={<button className="hd-mini" onClick={copyPenDiag}>Copy diagnostics</button>} />

          <div className="hd-mh hd-prefsec">Routes &amp; playback</div>
          <PrefPick title="Route avoidance" scene="avoid" ctx={pvCtx} value={collisions} set={setCollisions}
            opts={[[true, "Around"], [false, "Through"]]}
            desc="Skaters curve around nets, the goalie and each other instead of passing through them." />
          {collisions && (
            <PrefPick title="Show the detour" scene="detour" ctx={pvCtx} value={avoidanceVisuals} set={setAvoidanceVisuals}
              opts={[[true, "Draw it"], [false, "Hide it"]]}
              desc="Draw the curved path around an obstacle, with a ghost of the line you drew. Off keeps the drawn line straight while the skater still avoids." />
          )}
          <PrefPick title="Tidy arrowheads" scene="arrows" ctx={pvCtx} value={arrowStagger} set={setArrowStagger}
            opts={[[true, "Nudged apart"], [false, "As drawn"]]}
            desc="Nudge arrowheads apart where routes end close together, so each one stays readable. Off lands every arrow exactly where it was drawn." />
          <PrefPick title="Preview all branches" scene="branches" ctx={pvCtx} value={previewAllBranches} set={setPreviewAllBranches}
            opts={[[true, "All at once"], [false, "One at random"]]}
            desc="Where a player has reactions to a cue, play ghosts them through every option at once instead of picking one at random." />
          {/* "Lines while playing" is deliberately NOT here — it lives on the
              transport, where you change it mid-presentation. One setting, one
              control. */}
          <PrefRow title="New player speed"
            desc="The skating speed given to players you add from now on. Players already on the board keep theirs."
            control={<Stepper value={defaultSpeed} onChange={setDefaultSpeed} step={0.1} min={0.5} max={3} suffix="×" />} />
          <PrefRow title="Loop end pause"
            desc="How long a looping drill holds on the last frame before it starts again."
            control={<Stepper value={loopPause} onChange={setLoopPause} step={0.5} min={0} suffix="s" />} />
          {/* "Drill pace" is deliberately NOT here — it lives on the transport
              as the speed button, for the same reason "Lines while playing"
              does: you change it while showing a drill. One setting, one
              control. */}

          <div className="hd-mh hd-prefsec">App</div>
          {keyEdit == null ? (
            <PrefRow title="Claude API key"
              desc={`Used by Import from photo to read a drill off a whiteboard or sheet. Stored only on this device — ${localStorage.getItem(ANTHROPIC_KEY_STORE) ? "one is set." : "none set yet."}`}
              control={<button className="hd-mini" onClick={() => setKeyEdit(localStorage.getItem(ANTHROPIC_KEY_STORE) || "")}>
                {localStorage.getItem(ANTHROPIC_KEY_STORE) ? "Change…" : "Set…"}</button>} />
          ) : (
            <PrefRow title="Claude API key"
              desc="Use a spend-capped key. Saving an empty box clears it.">
              <div className="hd-poprow">
                <input className="hd-input" type="password" autoFocus placeholder="sk-ant-…" value={keyEdit}
                  autoComplete="off" style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                  onChange={e => setKeyEdit(e.target.value)} />
                <button className="hd-mini" onClick={() => {
                  if (keyEdit.trim()) { localStorage.setItem(ANTHROPIC_KEY_STORE, keyEdit.trim()); flash("API key saved"); }
                  else { localStorage.removeItem(ANTHROPIC_KEY_STORE); flash("API key cleared"); }
                  setKeyEdit(null);
                }}>Save</button>
                <button className="hd-mini" onClick={() => setKeyEdit(null)}><Icon name="close" size={13} /></button>
              </div>
            </PrefRow>
          )}

          {/* Sits directly above the odds it governs. It went missing in the
              settings rewrite — the only way to reach it had become the "Turn
              it on" button inside the collapsed Advanced warning, so it could
              be switched on and never off again. */}
          <div className="hd-mh hd-prefsec">Shots</div>
          <PrefToggle title="Realistic shots" on={realisticShots} set={setRealisticShots}
            desc="Shots resolve by chance — saved, off the post, wide, over, or in. Off, every shot goes in flat along the ice, which is clearer when you're teaching the pattern rather than the outcome." />

          <button className={`hd-item${showAdvanced ? " on" : ""}`} style={{ marginTop: 4 }}
            aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)}>
            <Icon name="target" size={16} /> Advanced · shot odds
            <span className="hd-chev"><Icon name={showAdvanced ? "chevronDown" : "chevronRight"} size={14} /></span>
          </button>
          {showAdvanced && (() => {
            const pct = v => Math.round(v * 100);
            const goalPct = Math.max(0, 1 - shotOdds.post - shotOdds.wide - shotOdds.over);
            const odd = (title, key, desc) => (
              <PrefRow key={key} title={`${title} · ${pct(shotOdds[key])}%`} desc={desc} dim={!realisticShots}>
                <input type="range" min={0} max={1} step={0.05} value={shotOdds[key]} style={{ width: "100%" }}
                  onChange={e => setShotOdds(o => ({ ...o, [key]: parseFloat(e.target.value) }))} />
              </PrefRow>
            );
            return (
              <>
                {!realisticShots && (
                  <div className="hd-prefwarn">
                    These only apply with <b>Realistic shots</b> on — right now every shot goes in along the ice.
                    <button className="hd-mini" style={{ marginLeft: 6 }} onClick={() => setRealisticShots(true)}>Turn it on</button>
                  </div>
                )}
                {odd("Goalie save", "save", "Chance a shot on a net WITH a goalie is stopped. The rest beat them.")}
                <div className="hd-mh hd-prefsec">Empty net · how a shot misses</div>
                {odd("Off the post", "post", "Rings the post and rebounds back into play.")}
                {odd("Wide", "wide", "Sails wide and runs into the corner.")}
                {odd("Over the net", "over", "Flies over — always an airborne shot.")}
                <div className="hd-prefdesc" style={{ padding: "0 2px" }}>
                  Goal <b style={{ color: goalPct > 0 ? "var(--db-good)" : "var(--db-danger)" }}>{pct(goalPct)}%</b>
                  {goalPct > 0 ? " — whatever the three misses leave." : " — the misses add up past 100%, so nothing scores."}
                </div>
                <div className="hd-mh hd-prefsec">Any shot</div>
                {odd("Airborne", "air", "Chance a shot is lifted rather than kept flat — a sauce-style rise with a shadow, dropping at the net.")}
                {odd("Board / post bounce", "bounce", "How much speed a missed puck keeps each time it caroms. Lower boards absorb more.")}
                <button className="hd-mini" style={{ marginTop: 4 }}
                  onClick={() => setShotOdds({ save: SAVE_PROB, post: MISS_POST, wide: MISS_WIDE, over: MISS_OVER, air: SHOT_AIR_PROB, bounce: BOUNCE_REST })}>Reset shot odds</button>
              </>
            );
          })()}
            <div className="hd-note">These are saved for this device, not with the drill — except the pace and shot odds, which belong to the drill you're editing.</div>
          </div>
          <div className="hd-row">
            <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
            <button className="hd-btn exit" onClick={() => setOpenMenu(null)}>Done</button>
          </div>
        </div>
      )}

      {openMenu === "game" && (
        <div className="hd-sheet">
          <div className="hd-mh">Game mode</div>
          <div className="hd-prefbody">
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">Let AI play</span></div>
              <div className="hd-prefdesc">
                Ten skaters and two goalies play a live 5v5 on the sheet — no drill, no routes,
                just a game. Useful for showing a shape or a situation you haven't drawn, or for
                letting the board run while you talk.
              </div>
            </div>
            <PrefRow title="Length"
              desc={`How long the run lasts before it stops on its own — ${aiMins} minute${aiMins > 1 ? "s" : ""}. You can stop it any time from the scoreboard at the top of the ice.`}
              control={<Stepper value={aiMins} onChange={setAiMins} step={1} min={1} suffix="m" />} />
            <div className="hd-pref">
              <div className="hd-prefhead"><span className="hd-preftitle">Your board is safe</span></div>
              <div className="hd-prefdesc">
                The game runs OVER your drill without touching it — nothing is added, moved or
                saved while it plays, and your board is exactly as you left it when it ends.
              </div>
            </div>
          </div>
          <div className="hd-row">
            <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
            <button className="hd-btn exit" onClick={startAiPlay}><Icon name="play" size={14} /> Start game</button>
          </div>
        </div>
      )}

      {openMenu === "rinkmenu" && (
        /* One menu answering "what surface, drawn which way". Style sits on top
           because it is the same class of choice as full-vs-half — which board
           you are drawing on — and it deliberately does NOT close the menu, so
           the coach can see the board flip and change their mind. The surface
           rows below do close it, as they always have. */
        <div className="hd-menu" style={menuAnchor}>
          <div className="hd-mh">Board style</div>
          <Pills value={whiteboard ? "wb" : "graphic"} set={v => setWhiteboard(v === "wb")}
            opts={[["graphic", "Graphic"], ["wb", "Whiteboard"]]} />
          <div className="hd-rule" />
          <div className="hd-mh">Ice surface</div>
          <button className={`hd-item${rink === "full" ? " on" : ""}`}
            onClick={() => { setRink("full"); setOpenMenu(null); }}>Full ice</button>
          <button className={`hd-item${rink === "half" && !halfNS && !halfFlip ? " on" : ""}`}
            onClick={() => { setRink("half"); setHalfNS(false); setHalfFlip(false); setOpenMenu(null); }}>Half ice · net →</button>
          <button className={`hd-item${rink === "half" && !halfNS && halfFlip ? " on" : ""}`}
            onClick={() => { setRink("half"); setHalfNS(false); setHalfFlip(true); setOpenMenu(null); }}>Half ice · net ←</button>
          <button className={`hd-item${rink === "half" && halfNS && !halfFlip ? " on" : ""}`}
            onClick={() => { setRink("half"); setHalfNS(true); setHalfFlip(false); setOpenMenu(null); }}>Half ice · net ↓</button>
          <button className={`hd-item${rink === "half" && halfNS && halfFlip ? " on" : ""}`}
            onClick={() => { setRink("half"); setHalfNS(true); setHalfFlip(true); setOpenMenu(null); }}>Half ice · net ↑</button>
          {/* the pad is laid out the way the quadrants sit on the sheet, so
              picking one is a glance rather than a read */}
          <div className="hd-mh hd-prefsec">Quarter sheet</div>
          <div className="hd-quadpad">
            {QUARTERS.map(([v, label]) => (
              <button key={v} className={`hd-mini${rink === v ? " on" : ""}`} aria-pressed={rink === v}
                onClick={() => { setRink(v); setOpenMenu(null); }}>{label}</button>
            ))}
          </div>
        </div>
      )}


      {openMenu === "notes" && (
        <div className="hd-sheet">
          <div className="hd-mh">Coaching notes <span style={{ fontWeight: 400, color: "var(--db-text-muted)", textTransform: "none", letterSpacing: 0 }}>· markdown</span></div>
          <textarea className="hd-ta" value={drillNotes} placeholder={"# Setup\n\n1. F1 carries out of the corner\n2. **Chip** off the glass past the D\n\n- Coach cue: head up through the neutral zone"}
            onChange={e => setDrillNotes(e.target.value)} spellCheck={false} />
          {drillNotes.trim() && (
            <div className="hd-mdprev" dangerouslySetInnerHTML={{ __html: mdBlock(drillNotes) }} />
          )}
          <div className="hd-row">
            <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
            <button className="hd-btn danger"
              onClick={() => { setDrillNotes(""); flash("Notes cleared — Undo restores them"); }}>Clear</button>
            <button className="hd-btn exit" onClick={() => setOpenMenu(null)}>Done</button>
          </div>
          <div className="hd-note">
            A written writeup shown on the print sheet and preview page. Supports markdown:
            <code># heading</code>, <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>,
            numbered (<code>1.</code>) and bulleted (<code>-</code>) lists, and <code>[links](https://…)</code>.
            Presentation captions accept inline markdown too.
          </div>
        </div>
      )}

      {openMenu === "inventory" && (() => {
        const rows = deriveInventory(pieces, drillItems);
        return (
          <div className="hd-sheet">
            <div className="hd-mh">Inventory <span style={{ fontWeight: 400, color: "var(--db-text-muted)", textTransform: "none", letterSpacing: 0 }}>· what you need</span></div>
            {/* capped width so label · count · action read as columns, not opposite screen edges */}
            <div className="hd-steplist" style={{ maxWidth: 560 }}>
              {rows.length === 0 ? (
                <div className="hd-note">No pieces yet. Add players, pucks, cones… and they’re counted here — or add gear below.</div>
              ) : rows.map(r => (
                <div key={(r.custom ? "c:" : "k:") + r.key} className="hd-poprow" style={{ opacity: r.hide ? 0.5 : 1 }}>
                  {r.custom
                    ? <input className="hd-input" style={{ flex: 1, minWidth: 0 }} value={r.label}
                        placeholder="Gear…" onChange={e => setCustomItem(r, { label: e.target.value })} />
                    : <span style={{ flex: 1, minWidth: 0 }}>{r.label}
                        {r.count !== r.autoCount && <span style={{ color: "var(--db-text-muted)", fontSize: 11 }}> · {r.autoCount} on ice</span>}</span>}
                  <Stepper value={r.count} min={0} step={1} suffix=""
                    onChange={n => (r.custom ? setCustomItem(r, { count: n }) : setCanonItem(r, { count: n }))} />
                  {r.custom
                    ? <button className="hd-mini" style={{ minWidth: 66 }} title="Remove gear row" onClick={() => setCustomItem(r, { remove: true })}><Icon name="close" size={13} /> Remove</button>
                    : <button className={`hd-mini${r.hide ? " on" : ""}`} style={{ minWidth: 66 }} title={r.hide ? "Hidden from the sheet — show it" : "Hide from the sheet (piece stays on the ice)"}
                        onClick={() => setCanonItem(r, { hide: !r.hide })}>{r.hide ? "Hidden" : "Hide"}</button>}
                </div>
              ))}
            </div>
            <div className="hd-row">
              <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
              <button className="hd-btn" onClick={addCustomItem}>＋ Add gear</button>
              <button className="hd-btn exit" onClick={() => setOpenMenu(null)}>Done</button>
            </div>
            <div className="hd-note">
              Auto-counted from the pieces on the ice. Edit a count to override it, <b>hide</b> a row to
              drop it from the sheet (the piece stays on the ice), or <b>add gear</b> for off-ice items
              (whistles, pinnies, water). Saved with the drill.
            </div>
          </div>
        );
      })()}

      {openMenu === "text" && (
        <div className="hd-sheet">
          <div className="hd-mh">Drill text</div>
          <textarea className="hd-ta" value={textDraft} onChange={e => setTextDraft(e.target.value)} spellCheck={false} />
          {textError && <div className="hd-err">{textError}</div>}
          {textCloseAsk ? (
            /* edits in the box haven't been applied to the board — never lose
               them to a stray Done tap */
            <div className="hd-row" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "#e8d48b" }}>Edits not applied yet —</span>
              <button className="hd-btn primary" onClick={() => { setTextCloseAsk(false); applyText(); }}>Apply &amp; close</button>
              <button className="hd-btn" onClick={() => setTextCloseAsk(false)}>Keep editing</button>
              <button className="hd-btn danger" onClick={() => { setTextCloseAsk(false); setOpenMenu(null); }}>Discard</button>
            </div>
          ) : (
            <div className="hd-row">
              <button className="hd-btn primary" onClick={applyText}>Apply</button>
              <button className="hd-btn" onClick={() => {
                if (textDraft !== serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems)) setTextCloseAsk(true);
                else setOpenMenu(null);
              }}>Done</button>
              <button className="hd-btn" title="Copy text" onClick={copyText}><Icon name="duplicate" size={15} /> Copy</button>
              <button className="hd-btn" title="Share drill" onClick={shareDrill}>Share</button>
              <button className="hd-btn" onClick={() => fileRef.current?.click()}>Load</button>
              <button className="hd-btn danger" style={{ marginLeft: "auto" }} title="Clear the text box"
                onClick={() => setTextDraft("")}>Clear</button>
            </div>
          )}
          <div className="hd-row" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--db-text-muted)" }}>Export</span>
            <button className="hd-btn" onClick={exportTxt}>.txt</button>
            <button className="hd-btn" onClick={exportMd}>.md</button>
            <button className="hd-btn" onClick={exportImage}>Image</button>
          </div>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#93a3b5", padding: "4px 0" }}>
              DSL reference — every command, tap to expand</summary>
          <div className="hd-note">
            Feet: x 0–200, y 0–85. <b>RINK</b> full|half|quarter-tl|quarter-tr|quarter-bl|quarter-br ·
            <b> PIECE</b> id player|puck|cone|net|bumper|deker|passer|label|tire x y [#color] [label] [speed=1.2] [hand=L] [sym=LW] [on=F1]
            (<code>sym=</code> is a player&apos;s whiteboard symbol — ≤3 chars, shown instead of the skater when <b>Whiteboard mode</b> is on; <code>△</code>/<code>○</code>/<code>□</code> draw as real shapes; unset falls back to the player&apos;s name, or X if that&apos;s still the auto id like P1)
            (a <b>bumper</b> is a solid barrier — players skate around it and pucks carom off it; a <b>deker</b> a stickhandling gate, a <b>passer</b> a rebounder box — all take <code>face=deg</code>)
            (a <b>tire</b> is an agility prop — <code>size=1</code> large / <code>size=0.55</code> small; add <code>goalie</code> for a keeper that works the full circle to defend shots at it)
            (a <b>label</b> is a movable/resizable text note: <code>PIECE L1 label 100 40 size=1.2 "Regroup here"</code> —
            style with <code>bg=</code>/<code>border=</code> (<code>none</code> or <code>&lt;hex&gt;[:&lt;opacity&gt;]</code>) and <code>textop=&lt;opacity&gt;</code>,
            e.g. <code>bg=ffd447:0.6 border=none textop=0.8</code>)
            (a <b>net</b> takes <code>face=deg</code>, <code>goalie</code>, and <code>size</code> — <code>1</code> NHL / <code>0.62</code> mite; pucks
            enter only from the front and bounce off its sides/back) ·
            <b> PATH</b> id segments (<b>L</b> x,y · <b>Q</b> cx,cy x,y · <b>C</b> c1x,c1y c2x,c2y x,y).
            Modifiers before a segment: <b>PASS</b>/<b>SHOT</b>, <b>BWD</b>, <b>STOP n</b>, <b>WAIT p n</b>, <b>WACT p n</b>, <b>RATE n</b>,
            <b> NAME word</b> (names that waypoint for presentation text; underscores show as spaces),
            <b> DESC "text"</b> (a waypoint description) with <b>SHOW</b> auto|preso|label — <b>auto</b> names it
            in the play's captions, <b>preso</b> reads it out during presentation, <b>label</b> pins it on the
            ice (add <b>SIZE n</b> and <b>OFF dx,dy</b> to resize / move that label).
            <code> on=F1</code> rides that player's blade until the carrier reaches the puck's spot.
            <code> pass=2:F2@3</code> passes at the carrier's point 2 to F2, received at F2's
            point 3 — the receiver's pace auto-syncs (omit <code>@3</code> to lead them instead).
            <code> pass=2:F1@3^PS1</code> is a <b>give-and-go off a passer</b>: F1 passes into
            rebounder PS1 and gets it right back at point 3 (tap a passer's id — marked ⟲ — in the <b>Pass to</b> row).
            A trailing <code>!</code> (<code>pass=2:F2@3!</code>) is a <b>sauce pass</b> — the puck arcs up over ice obstacles
            and bounces on landing (toggle <b>Sauce pass ⤴</b>).
            Point <b>0</b> is the starting spot (release before skating to point 1).
            <b>Shoot</b>, <b>Hard rim</b>, and <b>Chip</b> are terminal <b>releases</b> — the puck goes
            into space and lands loose. <code> shoot=4</code> fires at point 4 (targets the nearest
            net/passer, or <code>net=N2</code>/<code>net=PS1</code> — or a <b>bumper</b> (mirror deflect) or
            <b>tire</b> (deflects by where it strikes the round rubber), which must be named explicitly).
            Shots randomly rip along the ice or rise in the air (sauce look, shadow underneath). On a
            goalie it's <b>SAVE!</b> or <b>GOAL!</b>; on an <b>empty net</b> it usually buries (rests in the
            cage, under the mesh) but can ring the <b>POST!</b>, sail <b>WIDE!</b>, or go <b>OVER!</b> — each
            re-rolls every replay. A drill with a shot but <b>no net or passer at all</b> auto-places an
            empty net in the crease nearest the shooter (one per end as needed).
            <code> rim=4~90*80</code> hard-rims around the
            boards and <code>chip=4~-45*30</code> chips into space; the <code>~deg</code> is the direction and
            <code>*ft</code> the distance — or just drag the on-ice <b>handle</b> at the end of the release
            to set both. Any player then uses <b>Collect puck</b> (in their popup, or at a waypoint) to
            grab the nearest loose puck at that spot. <b>Collect puck</b> defaults to <b>Nearest puck</b> —
            a live pick that re-resolves to whichever loose puck is closest each time you play or edit
            (serialized as a trailing <code>*</code>); choose a specific puck id in the dropdown to lock it.
            (The handoff forms <code>chip=4:F1</code> /
            <code>rim=4:F2</code> that carry straight to a collector still load and play.)
            Every release picks a <b>hand</b>. By default it comes off whichever side the target is
            already on — the net for a shot, the receiver for a pass, the direction it travels for a
            chip or rim — because nobody reaches across their body for a puck already on their
            backhand. Force it with <b>Shot / Pass / Chip / Rim hand</b> on the releasing step
            (a trailing <code>&amp;f</code> / <code>&amp;b</code>, e.g. <code>pass=2:F2@3&amp;b</code>). A backhand
            leaves off the other face of the blade and the shoulders turn with it; the timing is unchanged.
            <code> pickup=F2@3</code> — a loose puck hops onto F2's blade at their point 3
            (<code>pickup=F2@3*</code> = nearest-puck, re-resolved live).
            <code> face=45</code> sets a stationary player's heading (degrees).
            <code> hold=line</code> makes a player wait at the blue line until the puck enters the zone.
            <b> Delay trigger</b> (on the player popup, and any waypoint) holds the route until a
            <b> Timer</b> (n seconds), a <b>Waypoint</b> (another player reaches a point — <code>wait=F2@3</code> /
            <code>WAIT F2 3</code>), or an <b>Action</b> (another player passes/chips/rims/shoots — <code>act=F2</code> /
            <code>WACT F2 0</code>) fires.
            <b> Presentation steps</b> — <code>STEP at=8.4 "…"</code> pins a caption to a time,
            <code>STEP on=F1:3 "…"</code> ties it to a player's waypoint activation (which tracks
            edits/retiming). Author them by scrubbing the timeline, pausing, and tapping <b>＋ note</b>;
            the caption appears on the ice to type + drag clear of the action (its spot saves as
            <code>pos=x:y</code>). In Presentation mode play pauses on each.
          </div>
          </details>
        </div>
      )}

      {openMenu === "steps" && (
        <div className="hd-sheet">
          <div className="hd-mh">Presentation steps</div>
          <div className="hd-steplist">
            {editRows.length === 0 ? (
              <div className="hd-note">No steps yet. Scrub the timeline, pause, then “＋ Add here” — or Generate from the play.</div>
            ) : editRows.map(s => (
              <div key={s.idx} className="hd-stepitem">
                <div className="hd-steprow">
                  <button className={`hd-anchorbtn${s.on ? " wp" : ""}${s.resolved ? "" : " bad"}${editAnchor === s.idx ? " open" : ""}`}
                    title="Edit when this step pops — a fixed time or a player's route point"
                    onClick={() => setEditAnchor(v => v === s.idx ? null : s.idx)}>{s.resolved ? s.label : "⚠ " + s.label}</button>
                  <input className="hd-input" style={{ flex: 1, minWidth: 0 }} value={s.text}
                    placeholder="Describe this beat…" autoFocus={!s.text}
                    onChange={e => setStepText(s.idx, e.target.value)} />
                  <button className={`hd-mini${s.pos ? " on" : ""}`} title="Place the caption on the ice"
                    disabled={!s.resolved} onClick={() => enterPlacing(s.idx)}><Icon name="pin" size={13} /> Place</button>
                  <button className="hd-mini" title="Delete step" onClick={() => deleteStep(s.idx)}><Icon name="close" size={13} /></button>
                </div>
                {editAnchor === s.idx && (
                  <div className="hd-anchoredit">
                    <button className={`hd-mini${s.on ? "" : " on"}`}
                      onClick={() => anchorToTime(s.idx)}>⏱ Time</button>
                    <button className={`hd-mini${s.on ? " on" : ""}`}
                      disabled={!stepPlayers.length}
                      onClick={() => anchorToWaypoint(s.idx)}>📍 Point</button>
                    {s.on ? (
                      <>
                        <select className="hd-select on" value={s.on.piece}
                          onChange={e => setStepWaypoint(s.idx, e.target.value,
                            Math.min(s.on.wp, Math.max(0, stepWpCount(e.target.value) - 1)))}>
                          {!stepPlayers.some(p => p.id === s.on.piece) &&
                            <option value={s.on.piece}>{s.on.piece} (missing)</option>}
                          {stepPlayers.map(p => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
                        </select>
                        <select className="hd-select on" value={s.on.wp}
                          onChange={e => setStepWaypoint(s.idx, s.on.piece, +e.target.value)}>
                          {Array.from({ length: stepWpCount(s.on.piece) }, (_, i) =>
                            <option key={i} value={i}>pt {i + 1}</option>)}
                        </select>
                      </>
                    ) : (
                      <label className="hd-seclabel">
                        <input className="hd-input hd-secinput" type="number" min="0" step="0.1"
                          inputMode="decimal" value={(s.at ?? 0).toFixed(1)}
                          onChange={e => setStepTime(s.idx, parseFloat(e.target.value) || 0)} />
                        s
                      </label>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {genAsk ? (
            <div className="hd-row" style={{ alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "#e8d48b" }}>Replace the current {drillSteps.length} step{drillSteps.length > 1 ? "s" : ""}?</span>
              <button className="hd-btn primary" onClick={() => generateSteps(true)}>Replace</button>
              <button className="hd-btn" onClick={() => setGenAsk(false)}>Cancel</button>
            </div>
          ) : (
            <div className="hd-row">
              <button className="hd-btn" disabled={playing} onClick={addStepHere}><Icon name="plus" size={14} /> Add here</button>
              <button className="hd-btn" onClick={() => generateSteps()}><Icon name="brain" size={14} /> Generate from play</button>
            </div>
          )}
          <div className="hd-row">
            <button className="hd-btn" onClick={() => setOpenMenu("settings")}><Icon name="chevronLeft" size={14} /> Menu</button>
            <button className={`hd-btn${presentation ? " primary" : ""}`}
              onClick={togglePresentation}>Presentation: {presentation ? "On" : "Off"}</button>
            <button className="hd-btn exit" onClick={() => { setOpenMenu(null); setEditAnchor(null); }}>Done</button>
          </div>
          <div className="hd-note">
            Scrub the timeline, pause, then “＋ Add here” drops a note — near a route point it
            anchors there (and tracks edits); otherwise it pins the time. Type it on the ice and
            drag it clear of the action; “Place” re-places a caption. Tap the anchor chip to set an
            exact time in seconds, or pin the step to a player's route point.
            In Presentation mode, play pauses at each step for at least {presoDelay}s — longer if
            there's more to read (tap the ice to skip ahead).
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" style={{ display: "none" }} onChange={importTxt} />
      <input ref={photoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={importPhoto} />
      {photoBusy && (
        <div className="hd-sheet" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div className="hd-spinner" />
          <div style={{ color: "#eaf2f8", fontSize: 14, textAlign: "center", padding: "0 24px" }}>{photoBusy}</div>
          <button className="hd-mini" onClick={() => photoAbort.current?.abort()}>Cancel</button>
        </div>
      )}
      {photoUndo != null && !photoBusy && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(64px + env(safe-area-inset-bottom))",
          transform: "translateX(-50%)", background: "rgba(20,26,32,0.94)", color: "#eaf2f8",
          padding: "8px 14px", borderRadius: 10, fontSize: 13, zIndex: 9998,
          display: "flex", alignItems: "center", gap: 10 }}>
          <span>Imported drill</span>
          <button className="hd-mini on" onClick={keepImport}>Keep</button>
          <button className="hd-mini" onClick={discardImport}>Discard</button>
        </div>
      )}
      {/* toast rides above the player-bar / pen-palette band, not across its controls */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(var(--hd-menubar) + 10px + var(--hd-b) + var(--hd-act))",
          transform: "translateX(-50%)", background: "rgba(20,26,32,0.92)", color: "#eaf2f8",
          padding: "6px 14px", borderRadius: 8, fontSize: 13, zIndex: 9999, pointerEvents: "none" }}>{toast}</div>
      )}
      {showDiag && <DiagPanel drillVersion={drillVersion} />}
    </div>
    </InkCtx.Provider>
    </ThemeCtx.Provider>
  );
}
