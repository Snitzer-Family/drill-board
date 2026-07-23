import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { VIEWS, COLORS, vb, APP_VERSION, ICON_SCALE, ROUTE_START_GAP, BUILD_STAMP, DEFAULT_TEXT, SPEED,
  SAVE_PROB, MISS_POST, MISS_WIDE, MISS_OVER, SHOT_AIR_PROB, BOUNCE_REST } from "./constants.js";
import { parseDrill, serializeDrill, extractDrill, deriveInventory } from "./drill-format.js";
import { drillSvg } from "./drill-svg.js";
import { mdEscape, mdInline, mdBlock } from "./md.js";
import { clampX, clampY, segEnd, segD, nearestT, splitSeg, zigzagPoints, wigglePoints, convertSeg, fitRoute, evalSeg, rdp, catmullToBezier, alignJoint, mirrorJoint, translateJointHandles, trimSegStart, trimSegEnd, trimPolyStart } from "./geometry.js";
import * as boards from "./boards.js";
import { netShapes, bumperShapes, solidShapes, detourRoute, segCrossesNet } from "./net-collide.js";
import { RinkMarkings } from "./rink.jsx";
import { ZONES, zoneAt } from "./zones.js";
import { PieceIcon, Stepper, DiagPanel, Icon, ICONS } from "./icons.jsx";
import { createTiming, resolveNearest } from "./timing.js";
import { newGame, stepGame } from "./ai-game.js";
import { STYLES } from "./styles.js";

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
const toolImg = kind => {
  const k = kind === "playerpuck" ? "player" : kind;
  const g = TOOL_GLYPH[k];
  if (!g) return null;
  const p = { kind: k, color: g.color, label: "", facing: 0, hand: "R", size: 1, path: [] };
  return (
    <svg className="hd-toolimg" viewBox={g.vb} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <PieceIcon p={p} pos={{ x: 0, y: 0, a: 0 }} xf="translate(0 0)" thDeg={0} onDown={() => {}} />
    </svg>
  );
};

// swatch palette for on-ice text labels (dark ink first — labels sit on light ice)
const LABEL_COLORS = ["#14202b", "#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#7a3fa8"];

// cue colours a cognitive-training light can show (its screen fills with one)
const LIGHT_COLORS = ["#2ea043", "#e5342b", "#2f6df6", "#f5c518", "#8a3ffc", "#f2f5f8"];

// small deterministic string hash → int (for per-run cue seeding)
const hashInt = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
// a deterministic shuffle of [0..n) from a seed (seeded Fisher-Yates)
function shuffleOrder(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = (seed | 0) || 1;
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
    const hasTerm = pk.shotAt != null || pk.rimAt != null || pk.chipAt != null;
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
  // hint; storage (via onChange) follows once a real trigger is chosen
  const [uiMode, setUiMode] = useState(value.mode || "timer");
  const mode = uiMode;
  const wpPlayers = players.filter(q => q.path && q.path.length > 0);
  const actPlayers = players.filter(q => actorIds.has(q.id));
  const trig = value.on ? players.find(q => q.id === value.on) : null;

  const pickMode = m => {
    setUiMode(m);
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
  const hint = t => <div className="hd-poprow"><span style={{ fontSize: 11, color: "#8b99a8" }}>{t}</span></div>;
  const wpSelect = () => (
    <select className="hd-select on" value={value.at == null ? -1 : value.at}
      onChange={e => onChange({ ...value, at: parseInt(e.target.value, 10) })} disabled={!trig}>
      <option value={-1}>start</option>
      {trig && trig.path.map((s, wi) => <option key={wi} value={wi}>{wi + 1}</option>)}
    </select>
  );

  return (
    <>
      <div className="hd-poprow">
        <span>Delay trigger</span>
        {[["timer", "Timer"], ["waypoint", "Waypoint"], ["action", "Action"]].map(([m, lab]) => (
          <button key={m} className={`hd-mini${mode === m ? " on" : ""}`} onClick={() => pickMode(m)}>{lab}</button>
        ))}
      </div>
      {mode === "timer" && (
        <div className="hd-poprow">
          <span>{sub} for</span>
          <Stepper value={value.secs || 0} onChange={v => onChange({ mode: "timer", secs: v })} />
          <span style={{ fontSize: 11, color: "#8b99a8" }}>seconds</span>
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
    </>
  );
}

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

const SAVE_KEY = "drillboard:autosave";   // the whole board, persisted across refreshes

export default function DrillAnimator() {
  // boot from the last auto-saved board if there is one, else the built-in demo
  const init = (() => {
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
  const [tool, setTool] = useState("select");
  // freehand marker (annotation) settings, remembered between strokes
  const [markColor, setMarkColor] = useState("#ffd447");
  const [markWidth, setMarkWidth] = useState(1.1);   // rink feet
  const [markStyle, setMarkStyle] = useState("solid"); // solid | dashed | dotted | wavy
  const [markEdit, setMarkEdit] = useState(false);   // show draggable control points on the selected mark
  useEffect(() => { setMarkEdit(false); }, [selectedId]);   // leaving a mark exits point-edit mode
  const markerDraw = useRef(false);
  const [openMenu, setOpenMenu] = useState(null); // settings | rinkmenu | tools | text
  const [textDraft, setTextDraft] = useState(DEFAULT_TEXT);
  const [textError, setTextError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [animT, setAnimT] = useState(0);
  const [restFade, setRestFade] = useState(1);         // extra splash fade-out that runs while paused/stopped
  const [pace, setPace] = useState(15);
  // routes shown during playback: "player" (routes only), "hide", "all" (+puck/shots)
  const [playRoutes, setPlayRoutes] = useState("player");
  // presentation mode: pause at each described step so viewers can read along
  const [presentation, setPresentation] = useState(false);
  const [presoDelay, setPresoDelay] = useState(2.5);   // seconds held at each step
  const [holdStep, setHoldStep] = useState(null);      // step currently being read
  const [placingStep, setPlacingStep] = useState(null); // idx of the step whose caption is being placed on the ice
  const [editAnchor, setEditAnchor] = useState(null);  // idx of the step whose time/waypoint anchor is being edited inline
  const [minorDesc, setMinorDesc] = useState(false);   // describe zones skated through
  const [showResult, setShowResult] = useState(true);  // Save!/Goal! splash on shots
  const [collisions, setCollisions] = useState(true);  // route avoidance (nets/goalie/players)
  const [realisticShots, setRealisticShots] = useState(true); // random goal/post/wide/over + air; off = always bury flat
  const [detailAnim, setDetailAnim] = useState(true);  // skater stride sway, stick swing, dribble cradle
  const [lineScale, setLineScale] = useState(1);       // route line-thickness multiplier
  const [defaultSpeed, setDefaultSpeed] = useState(1.5); // speed given to newly-added players
  // tunable shot odds (0..1): goalie save chance; empty-net miss split into
  // post/wide/over (the remainder is a goal); and how often a shot goes airborne
  const [shotOdds, setShotOdds] = useState({ save: SAVE_PROB, post: MISS_POST, wide: MISS_WIDE, over: MISS_OVER, air: SHOT_AIR_PROB, bounce: BOUNCE_REST });
  const [showAdvanced, setShowAdvanced] = useState(false); // reveal the shot-odds sliders
  const [showZones, setShowZones] = useState(false);   // named ice-area overlay
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
  // undo history: coalesced snapshots of `pieces` (a drag = one entry)
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const prevPiecesRef = useRef();
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
  const animRef = useRef(0);
  const totalRef = useRef(1);
  const holdRef = useRef(0);        // seconds remaining in the current step hold
  const nextStepRef = useRef(0);    // index of the next step to pause at
  const stepsRef = useRef([]);      // presentation steps, mirrored for the raf loop
  const presoDelayRef = useRef(2.5);
  const presoRef = useRef(false);
  const loopRef = useRef(false);
  const loopPendingRef = useRef(false); // holding on the finished drill before a loop restart
  const loopPauseRef = useRef(1);
  const popDrag = useRef(null);
  const lastLineTap = useRef(null);
  const lastIceTap = useRef(null); // double-click/tap on empty ice → add menu

  const selected = pieces.find(p => p.id === selectedId) || null;
  const editing = animT === 0 && !playing && !aiPlay;

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
    if (preservePopPos.current) return;                 // Prev/Next kept it in place
    // fresh open: reset to the auto edge-anchor at default size, then (next
    // render) run clear-space placement now that the real content is measurable
    setPopState("mid"); setPopPos(null); setPopDim(null);
    if (popup && popup.type !== "add") setPlaceToken(t => t + 1);
  }, [popup?.type, popup?.id, popup?.seg]);
  useEffect(() => {
    if (preservePopPos.current) { preservePopPos.current = false; return; }
    setPopOff({ x: 0, y: 0 });
  }, [popup?.type, popup?.id, popup?.seg, popup?.pt?.x, popup?.pt?.y]);
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
  function popDragEnd() { popDrag.current = null; }

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
    if (!el || !popup || popup.type === "add") return null;
    const par = el.offsetParent || el.parentElement;
    if (!par) return null;
    const cr = par.getBoundingClientRect();
    const r0 = el.getBoundingClientRect();               // the popup as rendered at its anchor
    const w = r0.width, h = r0.height, pad = 8;
    const { chainPts, otherPts } = obstaclePoints(workingChainIds(popup.id));
    const allPts = chainPts.concat(otherPts);
    const covers = (left, top, pts) => pts.some(c =>
      c.x >= left - pad && c.x <= left + w + pad && c.y >= top - pad && c.y <= top + h + pad);
    // if the natural anchor spot is already clear, keep the responsive anchor
    if (!covers(r0.left, r0.top, allPts)) return null;
    // otherwise search open space. INSET keeps a placed popup off the boards
    // (sitting in from the edge) rather than flush against them.
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
      const rank = covers(left, top, chainPts) ? 2 : covers(left, top, otherPts) ? 1 : 0;
      const score = rank * 1e7 - clearance(left, top);   // low rank first, then most open
      if (!best || score < best.score) best = { left, top, score };
    }));
    if (!best) return null;
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

  /* ----- draggable play dock ----- */
  const [playPos, setPlayPos] = useState(null);
  const [showDiag, setShowDiag] = useState(false);
  const playRef = useRef(null);
  const playDrag = useRef(null);
  function playDragStart(e) {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const root = playRef.current && playRef.current.parentElement;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const r = playRef.current.getBoundingClientRect();
    playDrag.current = { sx: e.clientX, sy: e.clientY, x: r.left - rr.left, y: r.top - rr.top,
      w: r.width, h: r.height, rw: rr.width, rh: rr.height };
  }
  function playDragMove(e) {
    const d = playDrag.current;
    if (!d) return;
    setPlayPos({
      x: Math.max(4, Math.min(d.rw - d.w - 4, d.x + e.clientX - d.sx)),
      y: Math.max(4, Math.min(d.rh - d.h - 4, d.y + e.clientY - d.sy)),
    });
  }
  function playDragEnd() { playDrag.current = null; }
  // hide the floating play dock (portrait phone) to its nearest edge, leaving a
  // small tab to bring it back. {edge, cross} in the dock container's px coords.
  const [playHide, setPlayHide] = useState(null);
  function hidePlayDock() {
    const el = playRef.current, root = el && el.parentElement;
    if (!el || !root) { setPlayHide({ edge: "top", cross: 0 }); return; }
    const rr = root.getBoundingClientRect(), r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - rr.left, cy = r.top + r.height / 2 - rr.top;
    const dl = cx, dr = rr.width - cx, dt = cy, db = rr.height - cy;
    const m = Math.min(dl, dr, dt, db);
    const edge = m === dt ? "top" : m === db ? "bottom" : m === dl ? "left" : "right";
    setPlayHide({ edge, cross: (edge === "top" || edge === "bottom") ? cx : cy });
  }

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
  const rotated =
    Math.abs(Math.log(sa / (vhF / vwF))) < Math.abs(Math.log(sa / (vwF / vhF)));
  let canvasW = Math.max(50, stageSize.w);
  let canvasH = Math.max(20, stageSize.h);
  // Full ice fills the stage (fill mode). Half / quarter keep their true
  // proportions: fit the width, then cap the height (and vice-versa) to at most
  // a small over-stretch, letterboxing the surplus instead of stretching tall.
  if (rink !== "full") {
    const vbW = rotated ? vhF : vwF, vbH = rotated ? vwF : vhF;   // effective viewBox dims
    const CAP = 1.12;                                             // max stretch past true aspect
    canvasH = Math.min(canvasH, Math.round((canvasW * vbH) / vbW * CAP));
    canvasW = Math.min(canvasW, Math.round((canvasH * vbW) / vbH * CAP));
  }
  // maps rink coords into the rotated viewBox: (x,y) -> (my+vh-y, x-mx)
  const sceneTransform = rotated ? `rotate(90) translate(${-mxF} ${-(myF + vhF)})` : undefined;
  const screenRot = rotated ? 90 : 0;
  // the root viewBox the pinch-zoom transform operates in (rotated swaps axes)
  geomRef.current = rotated
    ? { ox: 0, oy: 0, rootW: vhF, rootH: vwF }
    : { ox: mxF, oy: myF, rootW: vwF, rootH: vhF };
  const zoomXf = view.s !== 1 || view.tx || view.ty ? `translate(${view.tx} ${view.ty}) scale(${view.s})` : undefined;
  // roundness correction: the fill-mode stretch scales the two rink axes
  // differently; circles are drawn as ellipses with ry scaled by yFix so
  // they render perfectly round on screen after the stretch
  const yFix = (() => {
    const sx = rotated ? canvasH / vwF : canvasW / vwF;
    const sy = rotated ? canvasW / vhF : canvasH / vhF;
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
    const Sx = Math.max(1e-6, rotated ? canvasH / vwF : canvasW / vwF);
    const Sy = Math.max(1e-6, rotated ? canvasW / vhF : canvasH / vhF);
    return { Sx, Sy, k: ICON_SCALE * Math.sqrt(Sx * Sy) };
  })();
  function iconXf(pos) {
    const { Sx, Sy, k } = iconGeom;
    const a = ((pos.a || 0) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const th = rotated ? Math.atan2(Sx * c, -Sy * s) : Math.atan2(Sy * s, Sx * c);
    const ct = Math.cos(th), st = Math.sin(th);
    let m00, m01, m10, m11;
    if (rotated) {
      m00 = (k * st) / Sx; m01 = (k * ct) / Sx;
      m10 = (-k * ct) / Sy; m11 = (k * st) / Sy;
    } else {
      m00 = (k * ct) / Sx; m01 = (-k * st) / Sx;
      m10 = (k * st) / Sy; m11 = (k * ct) / Sy;
    }
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
  // timing runs on the nearest-resolved model: any "Collect nearest puck" intent
  // re-binds to whichever loose puck is actually closest right now. Rendering &
  // editing stay on raw `pieces` (displayPosAt keys plans by id, so it lines up).
  const rpieces = useMemo(() => resolveNearest(pieces), [pieces]);
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
  const { getPlan, pieceTime, displayPosAt, stickSwing, waypointTime, puckInGoal } = createTiming({ pieces: effPieces, pace, segRefs, planCache, seed: playSeed, realisticShots, detail: detailAnim, odds: shotOdds });
  // intent plan for the route preview (identical to the main plan but with misses
  // off, so shots always route on net). Only built when realistic shots are on and
  // the puck-path overlay is actually shown; otherwise the main plan already IS the
  // intent, so reuse it.
  const wantPuckPaths = !aiPlay && (editing || playRoutes === "all");
  const getIntentPlan = (!realisticShots || !wantPuckPaths) ? getPlan
    : createTiming({ pieces: effPieces, pace, segRefs, planCache: intentPlanCache, seed: playSeed, realisticShots: false, detail: detailAnim, odds: shotOdds }).getPlan;

  // a light's cue timeline can outlast every route — keep the drill running long
  // enough to show every cue (so a "read the light" reaction has time to resolve)
  const cueSpan = p => p.kind === "light" && p.cues ? p.cues.reduce((a, c) => a + Math.max(0.1, c.dur || 0), 0) : 0;
  const totalTime = Math.max(0.1, ...effPieces.map(pieceTime), ...effPieces.map(cueSpan));
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
        return { ...s, idx, key: `step:${idx}`, resolved: false, t: 0, label: "waypoint missing" };
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
    top: `clamp(calc(env(safe-area-inset-top, 0px) + ${placing ? 96 : 58}px), ${(pos.y * 100).toFixed(2)}%, calc(100% - 54px - var(--hd-b) - var(--hd-scrub) - 58px))`,
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
  function generateSteps() {
    if (drillSteps.length && !window.confirm("Replace the current presentation steps with ones generated from the play?")) return;
    const raw = buildSteps().filter(s => s.key !== "start");
    setDrillSteps(raw.map(s => {
      const m = /^([^:]+):(?:move|say):(\d+)$/.exec(s.key);
      if (m) {
        const pid = m[1], wp = parseInt(m[2], 10) - 1;
        if (wp >= 0 && pieces.some(p => p.id === pid && p.kind === "player")) return { text: s.text, on: { piece: pid, wp } };
      }
      return { text: s.text, at: s.t };
    }));
  }
  // scrubber tick positions (fractions 0..1): player waypoint activations + steps
  const scrubDur = Math.max(0.1, totalTime);
  const wpTicks = [];
  if (!aiPlay) effPieces.forEach(p => { if (p.kind === "player") (p.path || []).forEach((_, i) => wpTicks.push(Math.min(1, waypointTime(p, i) / scrubDur))); });
  const stepTicks = (!aiPlay && drillSteps.length)
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
            holdRef.current = presoDelayRef.current;
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
  function wakeEdit() { if (!playing && animT > 0) { resetAnim(); return true; } return false; }
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
  function clampView(s, tx, ty) {
    const g = geomRef.current;
    s = Math.max(1, Math.min(6, s));
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
      const s = view0.s * (d / (d0 || 1));
      // keep the pinch focal point pinned, then pan by the midpoint drift
      const pcx = (mid0.x - view0.tx) / view0.s, pcy = (mid0.y - view0.ty) / view0.s;
      const nv = clampView(s, mid.x - s * pcx, mid.y - s * pcy);
      viewRef.current = nv; setView(nv);
    };
    const end = e => { if (e.touches.length < 2) pinchRef.current = null; };
    svg.addEventListener("touchstart", start, { passive: false });
    svg.addEventListener("touchmove", move, { passive: false });
    svg.addEventListener("touchend", end);
    svg.addEventListener("touchcancel", end);
    return () => {
      svg.removeEventListener("touchstart", start);
      svg.removeEventListener("touchmove", move);
      svg.removeEventListener("touchend", end);
      svg.removeEventListener("touchcancel", end);
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
  function displaySwing(p) {
    return p.kind === "player" && animT > 0 ? stickSwing(p.id, animT * totalTime) : 0;
  }
  // an auto-reacting defenseman: hold the middle / front of the defended net,
  // stay goal-side of the puck (keep the attacker in front), gap up toward it.
  function dmanPos(p) {
    const home = { x: p.x, y: p.y };
    // net this D defends: nearest net piece, else the goal line on its side
    const nets = pieces.filter(q => q.kind === "net");
    let net = home.x < 100 ? { x: 17, y: 42.5 } : { x: 183, y: 42.5 };
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
  // solid props routes curve around: bumpers (a long bar enclosed by a disc),
  // passers, tires, and dekers. A jump over one lets it sit on the path instead.
  const propDiscs = () => [
    ...bumperShapes(pieces).map(sh => ({ cx: sh.cx, cy: sh.cy, r: sh.r })),
    ...pieces.filter(q => q.kind === "passer").map(q => ({ cx: q.x, cy: q.y, r: 2.6 })),
    ...pieces.filter(q => q.kind === "tire").map(q => ({ cx: q.x, cy: q.y, r: 2.6 * ICON_SCALE * (q.size || 1) + 0.6 })),
    ...pieces.filter(q => q.kind === "deker").map(q => ({ cx: q.x, cy: q.y, r: 2.6 })),
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
    // it stays on the path and the hop carries them over it
    const jps = jumpPointsOf(self);
    const props = propDiscs().filter(d => !jps.some(j => Math.hypot(j.x - d.cx, j.y - d.cy) < d.r + 3));
    const all = [...nets, ...props, ...discs];
    return all.length ? all : [];
  };
  // A route sampled then re-routed to arc smoothly around any net it crosses.
  // Returns { pts, origLen } (origLen = the straight-sampled length, for mapping
  // animation progress onto the detour) or null if no net is in the way. Cached
  // per render so the line and the animation share one detour.
  const detourCache = new Map();
  function routeDetour(p) {
    if (!collisions) return null;                    // avoidance off — draw routes exactly as authored
    if (!p.path.length || (p.kind !== "player" && p.kind !== "puck")) return null;
    if (detourCache.has(p.id)) return detourCache.get(p.id);
    const obstacles = detourObstaclesFor(p.id);
    if (!obstacles.length) { detourCache.set(p.id, null); return null; }
    const pts = [{ x: p.x, y: p.y }];
    let prev = { x: p.x, y: p.y }, origLen = 0;
    for (const s of p.path) {
      const n = Math.max(2, Math.min(48, Math.round((Math.hypot(s.x - prev.x, s.y - prev.y) + 4) / 2)));
      for (let k = 1; k <= n; k++) { const q = evalSeg(prev, s, k / n); const last = pts[pts.length - 1]; origLen += Math.hypot(q.x - last.x, q.y - last.y); pts.push(q); }
      prev = { x: s.x, y: s.y };
    }
    const det = detourRoute(pts, obstacles);
    const out = det !== pts ? { pts: det, origLen } : null;
    detourCache.set(p.id, out);
    return out;
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
  const TIP_FWD = 5.6 * ICON_SCALE, TIP_LAT = 2.45 * ICON_SCALE;
  const BLADE_FWD = 4.9 * ICON_SCALE, BLADE_LAT = 2.55 * ICON_SCALE;
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
    // rotate the blade (whole icon) so it points further AWAY from the net
    const a = (aDeg * Math.PI) / 180;
    const bladeAng = Math.atan2(Math.sin(a) * TIP_FWD + Math.cos(a) * TIP_LAT * side, Math.cos(a) * TIP_FWD - Math.sin(a) * TIP_LAT * side);
    let diff = bladeAng - Math.atan2(near.cy - y, near.cx - x);
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return (diff >= 0 ? 1 : -1) * w * 60;   // degrees, tunable
  }
  // per-run cue seed for a light: reactive (shuffle + loop) unless turned off.
  // Keyed by playSeed so each run reshuffles; null → the fixed authored sequence.
  // A function declaration (hoisted) since resolveForks runs during render, above.
  function cueSeed(light) {
    return (light && light.rand !== false && (light.cues || []).length) ? hashInt(light.id + "|" + playSeed) : null;
  }
  // the colour a cognitive-training light is showing right now: its cue timeline
  // resolved at the current animation time, else (no cues / before play) its idle
  // base colour.
  function lightColor(p) {
    return cueColorAt(p.cues, animT <= 0 ? 0 : animT * totalTime, cueSeed(p)) ?? p.color;
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
  const forkParts = ref => String(ref).split("/");
  const forkEq = (a, b) => (!a && !b) || (!!a && !!b && String(a).toLowerCase() === String(b).toLowerCase());
  // walk the tree by a ref → the leaf fork node (or null)
  function forkAt(p, ref) {
    if (!ref) return null;
    let list = p.forks || [], node = null;
    for (const c of forkParts(ref)) { node = (list || []).find(f => sameColor(f.color, c)); if (!node) return null; list = node.forks; }
    return node;
  }
  const forkOf = forkAt;   // single-colour refs are just a 1-part path
  // the point a fork forks FROM: its parent fork's end, or the base branch (top level)
  function forkOriginPoint(p, ref) {
    const parts = forkParts(ref);
    if (parts.length <= 1) return branchPoint(p);
    const parent = forkAt(p, parts.slice(0, -1).join("/"));
    if (parent && parent.path && parent.path.length) { const s = parent.path[parent.path.length - 1]; return { x: s.x, y: s.y }; }
    return branchPoint(p);
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
  // seconds for a player to skate their BASE route to the branch — the same arc-
  // length ÷ pace formula the timing engine uses (measured off the rendered path
  // refs), so the fork choice lines up with where the light actually is on arrival.
  function baseRouteTime(p) {
    if (!p.path || !p.path.length) return 0;
    let t = 0;
    for (let i = 0; i < p.path.length; i++) {
      const s = p.path[i];
      const el = segRefs.current[`${p.id}/${i}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      const v = pace * SPEED[s.mode || "carry"] * (p.speed || 1) * (s.rate || 1);
      t += (s.stop || 0) + (v > 0 ? L / v : 0);
    }
    return t;
  }
  // the light that governs a player's reaction: the nearest one that has a cue
  // timeline (to its branch point). null if there are no cue lights.
  function governingLightNear(ps, pt) {
    const lights = ps.filter(q => q.kind === "light" && (q.cues || []).length);
    if (!lights.length) return null;
    const d = q => Math.hypot(q.x - pt.x, q.y - pt.y);
    return lights.reduce((a, q) => (d(q) < d(a) ? q : a));
  }
  function governingLight(ps, p) { return governingLightNear(ps, branchPoint(p)); }
  // seconds to skate a run of segments sitting at effective indices startIdx.. (the
  // same arc-length ÷ pace formula, measured off the rendered refs) — used to find
  // when a chained reaction's next branch is reached.
  function pathSegTime(p, segs, startIdx) {
    let t = 0;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k], el = segRefs.current[`${p.id}/${startIdx + k}`];
      let L = 0; try { L = el ? el.getTotalLength() : 0; } catch { L = 0; }
      const v = pace * SPEED[s.mode || "carry"] * (p.speed || 1) * (s.rate || 1);
      t += (s.stop || 0) + (v > 0 ? L / v : 0);
    }
    return t;
  }
  // the puck a player carries into a reaction: one they hold at the branch with no
  // action of its own yet (so the reaction's action decides what happens to it).
  // A function declaration (hoisted) since resolveForks runs during render, above.
  function reactionPuck(ps, playerId) {
    return ps.find(q => q.kind === "puck" && q.carrier === playerId
      && q.shotAt == null && q.rimAt == null && q.chipAt == null && !(q.transfers || []).length) || null;
  }
  // Walk each branching player's CHOSEN chain of reactions and splice it onto their
  // path. At each branch (base end, then each skate reaction's end) the governing
  // light's cue at the arrival time picks the next reaction; a non-skate action ends
  // the chain and is applied to the puck the player carries into it. This is what
  // makes chained "read the light again" reactions play back deterministically.
  function resolveForks(ps) {
    const branching = ps.filter(p => p.kind === "player" && (p.forks || []).length);
    if (!branching.length) return ps;
    let out = ps;
    for (const p of branching) {
      let effPath = p.path.slice(), arrivalT = baseRouteTime(p), branchPt = branchPoint(p);
      let forks = p.forks, terminal = null, terminalIdx = -1, guard = 0;
      while (forks && forks.length && guard++ < 16) {
        const light = governingLightNear(ps, branchPt);
        if (!light) break;
        const color = cueColorAt(light.cues, arrivalT, cueSeed(light));
        const fork = forks.find(f => sameColor(f.color, color));
        if (!fork || !fork.path || !fork.path.length) break;
        const startIdx = effPath.length;
        effPath = effPath.concat(fork.path);
        arrivalT += pathSegTime(p, fork.path, startIdx);
        const last = fork.path[fork.path.length - 1];
        branchPt = { x: last.x, y: last.y };
        if ((fork.action || "skate") !== "skate") { terminal = fork; terminalIdx = effPath.length - 1; break; }
        forks = fork.forks;                                  // a skate reaction chains onward
      }
      if (effPath.length <= p.path.length) continue;         // no reaction fired
      if (out === ps) out = ps.slice();
      out[out.findIndex(q => q.id === p.id)] = { ...out.find(q => q.id === p.id), path: effPath };
      if (terminal) {                                        // apply the ending action to the carried puck
        const pk = reactionPuck(out, p.id);
        if (pk) {
          const pj = out.findIndex(q => q.id === pk.id), act = terminal.action, at = terminalIdx;
          const patch = { shotAt: null, rimAt: null, chipAt: null };
          if (act === "shoot") { patch.shotAt = at; patch.net = terminal.net || null; }
          else if (act === "chip") { patch.chipAt = at; patch.chipAim = terminal.aim ?? null; patch.chipDist = terminal.dist ?? null; }
          else if (act === "rim") { patch.rimAt = at; patch.rimAim = terminal.aim ?? null; patch.rimDist = terminal.dist ?? null; }
          else if (act === "pass" && terminal.to) { patch.transfers = [...(pk.transfers || []), { at, to: terminal.to, recvAt: null, kind: "pass" }]; }
          out[pj] = { ...out[pj], ...patch };
        }
      }
    }
    return out;
  }
  // enter draw mode to author a reaction fork for player `id` under `color`
  function beginForkDraw(id, color) {
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
      return { ...p, forks: mapForkAt(forks, ref, f => {
        const rp = { ...p, x: o.x, y: o.y, path: f.path };
        const n = rp.path.length;
        const prev = n ? segEnd(rp, n - 1) : { x: rp.x, y: rp.y };
        const before = n >= 2 ? segEnd(rp, n - 2) : { x: rp.x, y: rp.y };
        let dx = prev.x - before.x, dy = prev.y - before.y;
        const m = Math.hypot(dx, dy);
        if (m < 0.5) { dx = 22; dy = 0; } else { dx = (dx / m) * 22; dy = (dy / m) * 22; }
        const seg = convertSeg({ type, x: clampX(prev.x + dx), y: clampY(prev.y + dy) }, prev);
        return { ...f, path: [...f.path, seg] };
      }) };
    });
    setSelectedId(id); setEditingFork({ id, color: ref });
    setPopup({ type: "point", id, seg: newIdx, fork: ref });
  }
  // set the action a reaction performs (skate / pass / shoot / chip / rim); pass
  // defaults its target to the first other player. Switching to skate keeps any
  // chained nested reactions; a terminal action can't chain, so nesting is ignored.
  function setForkAction(id, ref, action) {
    const pl = pieces.find(p => p.id === id); if (!pl) return;
    const others = pieces.filter(q => q.kind === "player" && q.id !== id);
    updateById(id, { forks: mapForkAt(pl.forks, ref, f => ({
      ...f, action,
      net: action === "shoot" ? (f.net || null) : undefined,
      to: action === "pass" ? (f.to || (others[0] || {}).id || null) : undefined,
    })) });
  }
  // the shared "curve set" of route buttons: straight / curve / S-curve, plus a
  // 4th freehand-draw button. onType(t) adds a segment of that type; onDraw()
  // enters freehand mode. Used anywhere a route is built or extended.
  const curveButtons = (onType, onDraw, activeType = null) => (
    <>
      {[["L", "segLine", "Straight"], ["Q", "segQuad", "Curve"], ["C", "segCubic", "S-curve"]].map(([t, ic, lbl]) => (
        <button key={t} className={`hd-mini${activeType === t ? " on" : ""}`} title={lbl} onClick={() => onType(t)}><Icon name={ic} /></button>
      ))}
      <button className="hd-mini" title="Freehand draw" onClick={onDraw}><Icon name="pencil" /></button>
    </>
  );
  // enter freehand draw mode for a route: a reaction fork, else the base route
  function drawRouteMode(id, fork) {
    if (fork) { beginForkDraw(id, fork); return; }
    resetAnim(); setPlaying(false); setPopup(null); setSelectedId(id); setEditingFork(null); setTool("draw");
  }
  // the reaction-authoring controls (curve buttons + action + Edit/Clear per cue
  // colour). `parentRef` null = the base branch (route end); a fork ref = a chained
  // reaction off that (skate) reaction's end. Null if no governing cue-light.
  function renderLightReactions(p, parentRef = null) {
    const branchPt = parentRef
      ? (() => { const f = forkAt(p, parentRef); return f && f.path.length ? { x: f.path[f.path.length - 1].x, y: f.path[f.path.length - 1].y } : branchPoint(p); })()
      : branchPoint(p);
    const light = governingLightNear(pieces, branchPt);
    if (!light) return null;
    const colors = [...new Set((light.cues || []).map(c => c.color))];
    const selStyle = { background: "#1b2530", color: "#eaf0f6", border: "1px solid rgba(255,255,255,0.16)",
      borderRadius: 6, padding: "3px 6px", fontSize: 13, cursor: "pointer" };
    return (
      <>
        <div className="hd-poprow">
          <span style={{ fontSize: 11, color: "#8b99a8" }}>
            {parentRef ? "Chain a reaction" : "Light reactions"} ({light.id}) — a route per cue, from here
          </span>
        </div>
        {colors.map(c => {
          const ref = parentRef ? parentRef + "/" + c : c;
          const fk = forkAt(p, ref);
          const has = !!fk;
          const isEditing = editingFork && editingFork.id === p.id && forkEq(editingFork.color, ref);
          return (
            <div className="hd-poprow" key={ref}>
              <div className="hd-swatch on" style={{ background: c, cursor: "default" }} />
              {curveButtons(t => addForkSegment(p.id, ref, t), () => beginForkDraw(p.id, ref))}
              {has ? (
                <>
                  <select value={fk.action || "skate"} style={selStyle}
                    onChange={e => setForkAction(p.id, ref, e.target.value)}>
                    <option value="skate">Skate</option>
                    <option value="pass">Pass</option>
                    <option value="shoot">Shoot</option>
                    <option value="chip">Chip</option>
                    <option value="rim">Rim</option>
                  </select>
                  <button className={`hd-mini${isEditing ? " on" : ""}`}
                    onClick={() => setEditingFork(isEditing ? null : { id: p.id, color: ref })}>{isEditing ? "✓ Editing" : "Edit"}</button>
                  <button className="hd-mini" onClick={() => { if (isEditing) setEditingFork(null); clearFork(p.id, ref); }}>Clear</button>
                </>
              ) : (
                <span style={{ fontSize: 11, color: "#8b99a8" }}>add a reaction</span>
              )}
            </div>
          );
        })}
      </>
    );
  }
  // the set of fork refs (lower-cased) on a player's CHOSEN reaction chain — for
  // highlighting the reaction path they'll actually take (walks the same chain
  // resolveForks does, tracking effective indices for the branch arrival times).
  function chosenForkRefs(p) {
    const set = new Set();
    if (!(p.forks || []).length) return set;
    let effLen = p.path.length, arrivalT = baseRouteTime(p), branchPt = branchPoint(p), forks = p.forks, prefix = "", guard = 0;
    while (forks && forks.length && guard++ < 16) {
      const light = governingLightNear(pieces, branchPt);
      if (!light) break;
      const color = cueColorAt(light.cues, arrivalT, cueSeed(light));
      const fork = forks.find(f => sameColor(f.color, color));
      if (!fork || !fork.path || !fork.path.length) break;
      const ref = prefix ? prefix + "/" + fork.color : fork.color;
      set.add(String(ref).toLowerCase());
      arrivalT += pathSegTime(p, fork.path, effLen);
      effLen += fork.path.length;
      const last = fork.path[fork.path.length - 1];
      branchPt = { x: last.x, y: last.y };
      if ((fork.action || "skate") !== "skate") break;
      forks = fork.forks; prefix = ref;
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
        x = s.x; y = s.y; a = p.path.some(sg => sg.dir === "bwd") ? res.a : s.a;
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
      // open the body to shield a carried puck from a net, goalie, or another player
      const carries = collisions && pieces.some(q => q.kind === "puck"
        && Math.hypot(displayPosRaw(q).x - x, displayPosRaw(q).y - y) < 5.5);
      if (carries) a += shieldDelta(x, y, a, side, [...netObstacles, ...others, ...gDiscs]);
      return { ...res, x, y, a };
    }
    // a carried puck sits on its carrier's blade tip (so it stays on the stick
    // through the detour + shield, instead of clipping the net)
    if (p.kind === "puck") {
      for (const q of pieces) {
        if (q.kind !== "player" || q.defense) continue;   // (defense never carries; avoids recursion)
        const raw = displayPosRaw(q);
        const side = q.hand === "L" ? -1 : 1;
        const bladeRaw = bladeAtWorld(raw.x, raw.y, raw.a || 0, BLADE_FWD, BLADE_LAT, side);
        if (Math.hypot(res.x - bladeRaw.x, res.y - bladeRaw.y) < 2.2) {   // this puck is on q's blade
          const qd = displayPos(q);                                       // shielded carrier
          const tip = bladeAtWorld(qd.x, qd.y, qd.a || 0, TIP_FWD, TIP_LAT, side);
          // carry stickhandle: the puck cradles side-to-side on the blade —
          // more at low speed, less (with a forward push) when skating hard
          const e = animT * totalTime;
          const a2 = displayPosAt(q, Math.max(0, e - 0.07)), b2 = displayPosAt(q, Math.min(totalTime, e + 0.07));
          const spd = Math.hypot(b2.x - a2.x, b2.y - a2.y) / 0.14;
          const fast = Math.min(1, spd / 24);
          const w = Math.sin(e * 8.5);
          const lat = w * 1.2 * (1 - 0.5 * fast);                         // side-to-side cradle
          const push = (0.5 + 0.5 * Math.sin(e * 8.5 + 1.3)) * 1.1 * fast; // slight fore-push when moving fast
          const hd = ((qd.a || 0) * Math.PI) / 180;
          const lx = -Math.sin(hd), ly = Math.cos(hd), fx = Math.cos(hd), fy = Math.sin(hd);
          return { ...res, x: tip.x + lx * lat + fx * push, y: tip.y + ly * lat + fy * push };
        }
      }
    }
    return res;
  }
  function displayPosRaw(p) {
    p = effOf(p);
    if (p.kind === "player" && p.defense) return animT > 0 ? dmanPos(p) : { x: p.x, y: p.y, a: p.facing || 0 };
    const dp = displayPosAt(p, animT <= 0 ? 0 : animT * totalTime);
    if (!detailAnim || p.kind !== "player" || !(dp.smul > 0.02)) return dp;  // no stride sway/lean when detail off
    const r = dp.smul;                                    // effective speed multiple
    const g = Math.max(0, Math.min(1, (r - GLIDE_AT) / (HARD_AT - GLIDE_AT)));
    const strength = g * g * (3 - 2 * g);                 // 0 glide → 1 aggressive
    const phase = (2 * Math.PI * (dp.dist || 0)) / STRIDE_LAMBDA;
    const sway = Math.sin(phase) * STRIDE_AMP * strength;
    const perp = (((dp.a || 0) + 90) * Math.PI) / 180;
    // hockey stop: as speed bleeds off, plant the body sideways so the finish
    // reads like a bite, not a coast
    const plant = dp.braking ? PLANT_DEG * (1 - dp.v) * (Math.sin(phase) >= 0 ? 1 : -1) : 0;
    return {
      ...dp,
      x: clampX(dp.x + Math.cos(perp) * sway),
      y: clampY(dp.y + Math.sin(perp) * sway),
      a: (dp.a || 0) + STRIDE_LEAN * strength * Math.cos(phase) + plant,
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
    const e = animT <= 0 ? 0 : animT * totalTime;
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
        if (e >= leg.t0 && e <= leg.t1) return Math.sin(((e - leg.t0) / span) * Math.PI / 2);       // climb to a peak at the net
        if (e > leg.t1 && e < leg.t1 + 0.16) return Math.cos(((e - leg.t1) / 0.16) * Math.PI / 2);  // drop into the net
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
  const looseFields = { carrier: null, pickup: null, transfers: [], shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null };
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
    const idx = (q.transfers || []).findIndex(t => t.to === goneId);
    if (idx >= 0) return { ...q, transfers: q.transfers.slice(0, idx), shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null };
    return q;
  });
  // remove a piece and clean up any references to it
  const deletePiece = id => {
    setPieces(ps => scrubRefs(ps.filter(q => q.id !== id), id));
    setSelectedId(null); setPopup(null);
  };

  // record a coalesced undo snapshot whenever `pieces` changes; rapid changes
  // (a drag's frames) fold into a single entry, and an undo doesn't re-record
  useEffect(() => {
    const prev = prevPiecesRef.current;
    prevPiecesRef.current = pieces;
    if (undoingRef.current) { undoingRef.current = false; return; }
    if (prev === undefined || prev === pieces) return;
    // a fresh edit invalidates the redo history
    if (redoStack.current.length) { redoStack.current = []; setRedoCount(0); }
    const now = performance.now();
    if (now - lastSnapRef.current > 130) {
      undoStack.current.push(prev);
      if (undoStack.current.length > 60) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
    }
    lastSnapRef.current = now;
  }, [pieces]);

  // auto-save the whole board to localStorage so it survives a refresh / the
  // app being killed. Debounced so a drag's frames coalesce into one write.
  // Skipped during AI play (that mutates pieces transiently, not real edits).
  const saveTimer = useRef(0);
  useEffect(() => {
    if (aiPlay) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems)); }
      catch { /* storage full / disabled — nothing we can do, keep running */ }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems, aiPlay]);

  function undoLast() {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop();
    redoStack.current.push(pieces);            // current state → redo
    if (redoStack.current.length > 60) redoStack.current.shift();
    setRedoCount(redoStack.current.length);
    undoingRef.current = true;
    setPieces(prev);
    setSelectedId(null); setMultiSel(null); setPopup(null); setOpenMenu(null);
    setUndoCount(undoStack.current.length);
  }
  function redoLast() {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    undoStack.current.push(pieces);            // current state → undo
    if (undoStack.current.length > 60) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
    undoingRef.current = true;
    setPieces(next);
    setSelectedId(null); setMultiSel(null); setPopup(null); setOpenMenu(null);
    setRedoCount(redoStack.current.length);
  }
  const updateSeg = (id, i, patch, fork = null) =>
    update(p => {
      if (p.id !== id) return p;
      const edit = arr => { const path = arr.slice(); path[i] = { ...path[i], ...patch }; return path; };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: edit(f.path) })) };
      return { ...p, path: edit(p.path) };
    });

  function nextId(kind) {
    const prefix = kind === "player" ? "P" : kind === "puck" ? "PK" : kind === "net" ? "N"
      : kind === "bumper" ? "B" : kind === "deker" ? "DK" : kind === "passer" ? "PS"
      : kind === "label" ? "L" : kind === "tire" ? "T" : kind === "stick" ? "ST" : kind === "light" ? "LT" : kind === "mark" ? "MK" : "C";
    let n = 1;
    while (pieces.some(p => p.id === prefix + n)) n++;
    return prefix + n;
  }

  function makePiece(kind, pt) {
    const id = nextId(kind);
    const colorIdx = pieces.filter(p => p.kind === "player").length % COLORS.length;
    return {
      id, kind, x: pt.x, y: pt.y, speed: kind === "player" ? defaultSpeed : 1, hand: "R", carrier: null,
      facing: kind === "net" && pt.x >= 100 ? 180 : 0, transfers: [], shotAt: null, rimAt: null, chipAt: null, chipAim: null, rimAim: null, chipDist: null, rimDist: null, pickup: null, net: null, holdLine: false, goalie: false, defense: false,
      color: kind === "player" ? COLORS[colorIdx] : kind === "cone" ? "#e0731d" : kind === "net" ? "#c81e33"
        : kind === "bumper" ? "#1b1e22" : kind === "deker" ? "#c79a4e" : kind === "passer" ? "#57636f"
        : kind === "label" ? "#14202b" : kind === "tire" ? "#1c1c1e" : kind === "light" ? "#2ea043" : "#14171a",
      label: kind === "player" ? id : "", text: kind === "label" ? "Label" : "", size: 1, path: [],
    };
  }

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
      const seg = convertSeg({ type, x: clampX(prev.x + dx), y: clampY(prev.y + dy) }, prev);
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
      const conv = arr => { const path = arr.slice(); path[i] = convertSeg({ ...path[i], type }, segEnd(rp, i - 1)); return path; };
      if (fork) return { ...p, forks: mapForkAt(p.forks, fork, f => ({ ...f, path: conv(f.path) })) };
      return { ...p, path: conv(p.path) };
    });
  }
  function deleteSeg(id, i, fork = null) {
    if (fork) {
      setPieces(ps => ps.map(p => p.id === id
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
  function shiftActionWaypoints(list, playerId, fromIdx, delta) {
    const bump = v => (v != null && v >= fromIdx ? v + delta : v);
    return list.map(pk => {
      if (pk.kind !== "puck") return pk;
      const chain = puckChain(pk);
      let np = pk;
      if (pk.pickup && pk.pickup.to === playerId && bump(pk.pickup.at) !== pk.pickup.at)
        np = { ...np, pickup: { ...pk.pickup, at: bump(pk.pickup.at) } };
      if ((pk.transfers || []).length) {
        let touched = false;
        const ts = pk.transfers.map((t, s) => {
          let nt = t;
          const actor = t.by || chain[s];                       // who releases at t.at
          if (actor === playerId && bump(t.at) !== t.at) { nt = { ...nt, at: bump(t.at) }; touched = true; }
          if (t.to === playerId && t.recvAt != null && bump(t.recvAt) !== t.recvAt) { nt = { ...nt, recvAt: bump(t.recvAt) }; touched = true; }
          return nt;
        });
        if (touched) np = { ...np, transfers: ts };
      }
      const termActor = pk.termBy || chain[chain.length - 1];
      if (termActor === playerId) {
        for (const f of ["shotAt", "rimAt", "chipAt"])
          if (np[f] != null && bump(np[f]) !== np[f]) np = { ...np, [f]: bump(np[f]) };
      }
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
          const tf = pk.shotAt != null ? pk.shotAt : pk.rimAt != null ? pk.rimAt : pk.chipAt != null ? pk.chipAt : null;
          if (tf != null && (!pk.termBy || pk.termBy === p.id)) outAt = tf;
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
  function carrySegs(p) {
    const set = new Set();
    if (!p.path || !p.path.length) return set;
    for (const pk of pieces) {
      if (pk.kind !== "puck") continue;
      const chain = puckChain(pk);
      if (!chain.includes(p.id)) continue;
      const ts = pk.transfers || [];
      const termAt = pk.shotAt != null ? pk.shotAt : pk.rimAt != null ? pk.rimAt : pk.chipAt != null ? pk.chipAt : null;
      let prevRelease = -1;                        // where p last gave the puck (give-and-go)
      for (let s = 0; s < chain.length; s++) {
        if (chain[s] !== p.id) continue;
        const inc = s > 0 ? ts[s - 1] : null;
        // reception waypoint: explicit recvAt, else — for a give-and-go — the
        // waypoint AFTER where they gave it (they skate a leg without it first,
        // so that leg draws straight, and the wiggle resumes once it's back)
        // the head carries from the start — UNLESS it's a pickup, which only
        // starts carrying once it reaches the loose puck at pickup.at (so the
        // skate over to collect a second puck draws straight, not as a carry)
        const R = s === 0 ? (pk.pickup && pk.pickup.to === p.id ? pk.pickup.at : -1)
          : (inc && inc.recvAt != null ? inc.recvAt : prevRelease + 1);
        const L = s < ts.length ? ts[s].at : (termAt != null ? termAt : p.path.length - 1);
        for (let i = Math.max(0, R + 1); i <= Math.min(L, p.path.length - 1); i++) set.add(i);
        prevRelease = s < ts.length ? ts[s].at : L;
      }
    }
    return set;
  }
  const makeLoose = pkId => updateById(pkId, { carrier: null, pickup: null, transfers: [], shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null });
  const clearTerminal = pkId => updateById(pkId, { shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null });
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
    const last = chain[chain.length - 1] || pk.carrier;
    if (pk.shotAt != null) evs.push({ actor: last, desc: `${nameOf(last)} shoots at ${pk.net || "nearest net"}`, self: `Shoot at ${pk.net || "nearest net"}`, del: () => clearTerminal(pk.id) });
    else if (pk.rimAt != null) evs.push({ actor: last, desc: `${nameOf(last)} hard rims`, self: "Hard rim", del: () => clearTerminal(pk.id) });
    else if (pk.chipAt != null) evs.push({ actor: last, desc: `${nameOf(last)} chips`, self: "Chip", del: () => clearTerminal(pk.id) });
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
            <span style={{ minWidth: 16, textAlign: "right", fontWeight: 700, color: "#8b99a8", fontVariantNumeric: "tabular-nums" }}>{n + 1}</span>
            <span style={{ flex: 1, fontSize: 12.5 }}>{forPlayer ? ev.self : ev.desc}</span>
            <button className="hd-mini danger" style={{ padding: "2px 7px", minHeight: 0 }}
              title="Delete this action (and any that follow it)" onClick={ev.del}>✕</button>
          </div>
        ))}
      </div>
    );
  }
  // the ordered actions happening at ONE spot (player p at waypoint i; i=-1 = the
  // start / standing spot) as numbered steps. Anything the chain can't actually
  // pull off — a rebound that must pass through a net, or a step downstream of one
  // — is flagged "won't complete" so the user sees it plainly.
  function stepsAt(p, i) {
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
        const carrier = pieces.find(q => q.id === chain[s]), rec = pieces.find(q => q.id === t.to);
        if (!carrier || !rec) return;
        const launch = t.at < 0 || !carrier.path.length ? { x: carrier.x, y: carrier.y } : segEnd(carrier, Math.min(t.at, carrier.path.length - 1));
        const shotNetId = t.net != null ? t.net : null;   // this rebound's own target
        const net = shotNetId ? (nets.find(x => x.id === shotNetId) || null) : (nets.length ? nets.reduce((a, b) => Math.hypot(b.x - launch.x, b.y - launch.y) < Math.hypot(a.x - launch.x, a.y - launch.y) ? b : a) : null);
        const nPt = net ? { x: net.x, y: net.y } : (launch.x < 100 ? { x: 17, y: 42.5 } : { x: 183, y: 42.5 });
        const anchor = t.recvAt != null && rec.path.length ? segEnd(rec, Math.min(t.recvAt, rec.path.length - 1)) : { x: rec.x, y: rec.y };
        if (segCrossesNet(nPt, anchor, shapes)) blockStage = Math.min(blockStage, s);
      });
      // an impossible step: its intended actor (`by`) isn't the one actually
      // holding the puck at that point — it and everything after won't happen
      let badStage = Infinity;
      ts.forEach((t, s) => { if (t.by && t.by !== chain[s]) badStage = Math.min(badStage, s); });
      const deadFrom = Math.min(blockStage, badStage);
      const flag = s => s === badStage ? `${nameOf(ts[s].by)} isn't holding the puck here — won't happen`
        : s === blockStage ? "rebound can't reach the collector — a net is in the way"
        : s > deadFrom ? "won't happen — an earlier step is blocked" : null;
      ts.forEach((t, s) => {
        const actor = t.by || chain[s];
        // the receiver shows their side of the action too (at the designated
        // receive waypoint, else at their standing spot i=-1)
        const rSpot = t.recvAt != null ? t.recvAt : -1;
        const self = t.to === p.id && actor === p.id;   // chip/rim and go retrieve it, or a give-and-go via a passer
        if (t.to === p.id && (actor !== p.id || (self && (t.kind !== "pass" || t.via))) && rSpot === i) {
          const rtext = t.via ? `Take the return from ${nameOf(t.via)}`
            : self ? (t.kind === "rim" ? "Collect your own rim" : "Collect your own chip")
            : t.kind === "shot" ? `Collect rebound from ${nameOf(actor)}`
            : t.kind === "rim" ? `Collect ${nameOf(actor)}'s rim`
            : t.kind === "chip" ? `Collect ${nameOf(actor)}'s chip`
            : `Receive pass from ${nameOf(actor)}`;
          steps.push({ ord: s + 0.5, text: rtext, warn: flag(s), del: () => setTransfer(pk.id, s, null),
            role: t.kind === "pass" ? "receive" : "collect", kind: t.kind, pk, stage: s, src: actor, via: t.via });
        }
        if (actor === p.id && t.at === i) {
          const to = nameOf(t.to);
          const txt = t.via ? `Give-and-go off ${nameOf(t.via)}`
            : self && t.kind === "chip" ? "Chip and skate to retrieve" : self && t.kind === "rim" ? "Rim and skate to retrieve"
            : t.kind === "pass" ? `Pass ${pk.id} to ${to}` : t.kind === "shot" ? `Shoot ${pk.id} — rebound to ${to}` : t.kind === "rim" ? `Hard rim to ${to}` : `Chip to ${to}`;
          steps.push({ ord: s + 1, text: txt, warn: flag(s), del: () => setTransfer(pk.id, s, null),
            role: "release", kind: t.kind, pk, stage: s });
        }
      });
      const termActor = pk.termBy || chain[chain.length - 1];
      if (termActor === p.id) {
        const wt = (pk.termBy && pk.termBy !== chain[chain.length - 1]) ? `${nameOf(pk.termBy)} isn't holding the puck here — won't happen`
          : deadFrom < Infinity ? "won't happen — an earlier step is blocked" : null;
        if (pk.shotAt === i) steps.push({ ord: 900, text: `Shoot ${pk.id} at ${pk.net || "nearest net"}`, warn: wt, del: () => clearTerminal(pk.id), role: "terminal", kind: "shot", pk });
        else if (pk.rimAt === i) steps.push({ ord: 900, text: `Hard rim ${pk.id}`, warn: wt, del: () => clearTerminal(pk.id), role: "terminal", kind: "rim", pk });
        else if (pk.chipAt === i) steps.push({ ord: 900, text: `Chip ${pk.id}`, warn: wt, del: () => clearTerminal(pk.id), role: "terminal", kind: "chip", pk });
      }
      // waypoint 0 = the start (i=-1); a stationary collector shows there too. A
      // routed collect at path index k shows only at that waypoint (i=k) — no
      // more duplicating a waypoint-0 collect onto the standing spot.
      const pickI = !p.path.length || !pk.pickup || pk.pickup.at < 0 ? -1 : pk.pickup.at;
      if (pk.pickup && pk.pickup.to === p.id && pickI === i)
        steps.push({ ord: -1, text: pk.pickup.nearest ? "Collect nearest puck" : `Collect ${pk.id}`, warn: null, del: () => updateById(pk.id, { pickup: null }), role: "pickup", kind: null, pk });
    }
    // order by puck first (each puck's collect→…→shoot stays together and
    // interleaves with the next puck's), then by chain order within a puck — so
    // collect→shoot→collect→shoot reads in sequence instead of all the collects
    // bunching ahead of all the shots
    steps.sort((a, b) => (pieces.indexOf(a.pk) - pieces.indexOf(b.pk)) || (a.ord - b.ord));
    return steps;
  }
  function setTransfer(pkId, stage, tr) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).slice(0, stage);
      if (tr) ts[stage] = tr;
      return { ...q, transfers: ts, shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null, termBy: null };
    });
  }
  // append an action for a player who doesn't actually hold the puck here — it's
  // recorded (with its intended `by` actor) and flagged "won't complete", not
  // silently dropped, so the user sees their intent
  const appendTransfer = (pkId, tr) =>
    update(q => (q.id === pkId ? { ...q, transfers: [...(q.transfers || []), tr] } : q));
  // default travel distance (feet) for a fresh terminal release
  const REL_DEFAULT = { rimAt: 65, chipAt: 26 };
  // terminal actions (shoot / hard rim / chip into space) are mutually exclusive;
  // a rim/chip release gets a default distance so its handle appears immediately
  function setTerminal(pkId, field, i) {
    update(q => {
      if (q.id !== pkId) return q;
      const on = q[field] === i;
      const base = { shotAt: null, rimAt: null, chipAt: null };
      if (on) return { ...q, ...base };
      const dist = field === "rimAt" ? { rimDist: q.rimDist || REL_DEFAULT.rimAt }
        : field === "chipAt" ? { chipDist: q.chipDist || REL_DEFAULT.chipAt } : {};
      return { ...q, ...base, [field]: i, ...dist };
    });
  }
  // aim override for a chip or a hard rim (deg, or null to follow facing / auto).
  // target = { field: "chipAim"|"rimAim" } for a terminal, or { stage } for a
  // chip transfer.
  function setAim(pkId, target, deg) {
    update(q => {
      if (q.id !== pkId) return q;
      if (target.field) return { ...q, [target.field]: deg };
      const ts = (q.transfers || []).map((t, k) => (k === target.stage ? { ...t, aim: deg == null ? undefined : deg } : t));
      return { ...q, transfers: ts };
    });
  }
  // a terminal release handle sets BOTH direction (deg) and travel distance (ft)
  function setRelease(pkId, aimField, distField, deg, dist) {
    update(q => (q.id === pkId ? { ...q, [aimField]: deg, [distField]: dist } : q));
  }

  // Unified "Collect puck": the player grabs the nearest available loose puck at
  // this spot (waypoint index `at`, or -1 = their standing position). A loose
  // puck is a released chip / hard rim / shot, or a puck placed loose. Wires it
  // with the existing chain (release → collector) / pickup machinery.
  function collectPuckAt(playerId, at, targetId) {
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
      const a = pk.shotAt != null ? pk.shotAt : pk.rimAt != null ? pk.rimAt : pk.chipAt;
      if (!who) return { x: pk.x, y: pk.y };
      return (a == null || a < 0 || !who.path.length) ? { x: who.x, y: who.y } : segEnd(who, Math.min(a, who.path.length - 1));
    };
    const landing = pk => {
      const rp = relPoint(pk);
      try {
        if (pk.chipAt != null) { const ang = pk.chipAim != null ? (pk.chipAim * Math.PI) / 180 : 0; const path = boards.slide(rp.x, rp.y, Math.cos(ang), Math.sin(ang), pk.chipDist || REL_DEFAULT.chipAt); return path[path.length - 1] || rp; }
        if (pk.rimAt != null) { const path = boards.rimAround(rp, pk.rimDist || REL_DEFAULT.rimAt, pk.rimAim); return path[path.length - 1] || rp; }
      } catch { /* fall through */ }
      return rp;
    };
    const cands = pieces.filter(q => {
      if (q.kind !== "puck") return false;
      const released = q.shotAt != null || q.rimAt != null || q.chipAt != null;
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
    if (target.shotAt != null || target.rimAt != null || target.chipAt != null) {
      const field = target.shotAt != null ? "shotAt" : target.rimAt != null ? "rimAt" : "chipAt";
      const kind = field === "shotAt" ? "shot" : field === "rimAt" ? "rim" : "chip";
      const aim = field === "rimAt" ? target.rimAim : field === "chipAt" ? target.chipAim : null;
      setTransfer(target.id, (target.transfers || []).length,
        { at: target[field], to: playerId, recvAt: cAt < 0 ? null : cAt, kind, ...(aim != null ? { aim } : {}) });
    } else {
      // no explicit id → a live "nearest" collect: re-resolves to the closest
      // loose puck at play time (see resolveNearest). A chosen id stays fixed.
      updateById(target.id, { pickup: { to: playerId, at: cAt, ...(targetId ? {} : { nearest: true }) } });
    }
    // steps are ordered by puck array position, so move the just-collected puck
    // to the end — its collect (and any release) then sits at the END of the
    // action chain, in build order, instead of bunching behind an earlier action
    setPieces(ps => { const k = ps.findIndex(q => q.id === target.id); if (k < 0) return ps; const c = ps.slice(); const [t] = c.splice(k, 1); c.push(t); return c; });
    setSelectedId(playerId);
  }
  function setRecvAt(pkId, trIdx, idx) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).map((t, k) => (k === trIdx ? { ...t, recvAt: idx } : t));
      return { ...q, transfers: ts };
    });
  }
  // manual "Receive Pass": the chosen source player passes to `receiverId` at
  // waypoint `at`. Appends the pass onto a puck the source holds; if they hold
  // none, hand them a fresh one so the feed still happens.
  function doReceiveFrom(receiverId, at, srcId) {
    const src = pieces.find(q => q.id === srcId && q.kind === "player");
    if (!src) return;
    const passAt = src.path.length ? src.path.length - 1 : -1;   // source releases from their route end / spot
    const pk = heldPuckAt(src, passAt) || pieces.find(q => q.kind === "puck" && puckChain(q).includes(src.id));
    const tr = { at: passAt, to: receiverId, recvAt: at < 0 ? null : at, kind: "pass", by: src.id };
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
      // inserting a waypoint at segIdx pushes this player's later waypoints up by
      // one — shift their actions first so each stays on its own waypoint (base
      // routes only; forks carry no puck actions)
      const list = fork ? ps : shiftActionWaypoints(ps, id, segIdx, +1);
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
      drag.current = { kind: "drawing", touch: e.pointerType !== "mouse" };
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
    drag.current = { kind: "drawing", touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // start a freehand marker stroke (an ink annotation, not a route)
  function beginMark(e) {
    const pt = svgPt(e);
    drawRaw.current = [pt];
    setDrawPreview([pt]);
    markerDraw.current = true;
    drag.current = { kind: "drawing", marker: true, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function finishDraw() {
    const raw = drawRaw.current;
    drawRaw.current = [];
    setDrawPreview(null);
    // a light-reaction fork: fit a route from the player's branch point through the
    // drawn trail, and store it (replacing any existing fork of the same colour)
    if (forkTarget.current) {
      const { id, color: ref } = forkTarget.current;
      forkTarget.current = null; setForkDrawColor(null); setTool("select");
      if (raw.length < 3) return;
      setPieces(ps => ps.map(p => {
        if (p.id !== id) return p;
        const route = fitRoute(forkOriginPoint(p, ref), raw);
        if (!route.length) return p;
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
      setPieces(ps => [...ps, { id, kind: "mark", pts, x: pts[0].x, y: pts[0].y,
        color: markColor, width: markWidth, style: markStyle, path: [] }]);
      return;
    }
    const id = drawTarget.current;
    drawTarget.current = null;
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
    if (holdStep) { skipHold(); return; }      // presentation hold → a tap on the ice advances early
    setOpenMenu(null);                         // a tap on the ice always closes any open menu
    if (playing || pinchRef.current) return;
    if (wakeEdit()) return;                    // paused/finished → snap back to start first
    const pt = svgPt(e);
    if (tool === "draw") { setPopup(null); beginDraw(e); return; }
    if (tool === "marker") { setPopup(null); beginMark(e); return; }
    if (tool === "playerpuck") {
      addPlayerWithPuck(pt, false);
      setTool("select");
      return;
    }
    if (tool !== "select") {
      const np = makePiece(tool, pt);
      setPieces(ps => [...ps, np]);
      setSelectedId(np.id);
      setPopup(tool === "label" ? { type: "piece", id: np.id } : null);   // labels open for text entry
      setTool("select");
      return;
    }
    setPopup(null);
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
    // a duplicated puck starts loose (avoid two pucks glued to one carrier)
    if (copy.kind === "puck") { copy.carrier = null; copy.transfers = []; copy.shotAt = copy.rimAt = copy.chipAt = null; copy.pickup = null; }
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
      if (!has(p.id)) return p;
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
      if (c.kind === "puck") {
        if (c.carrier) c.carrier = idMap[c.carrier] || null;                       // carrier outside the group → drop (loose)
        if (c.pickup && c.pickup.to) c.pickup = idMap[c.pickup.to] ? { ...c.pickup, to: idMap[c.pickup.to] } : null;
        if (Array.isArray(c.transfers)) c.transfers = c.transfers.map(t => ({
          ...t, ...(idMap[t.to] ? { to: idMap[t.to] } : {}),
          ...(t.by && idMap[t.by] ? { by: idMap[t.by] } : {}), ...(t.via && idMap[t.via] ? { via: idMap[t.via] } : {}),
        }));
        if (c.net && idMap[c.net]) c.net = idMap[c.net];
        if (c.termBy && idMap[c.termBy]) c.termBy = idMap[c.termBy];
        // a copied puck whose carrier fell outside the group starts loose
        if (!c.carrier && !c.pickup && p.carrier && !idMap[p.carrier]) { c.transfers = []; c.shotAt = c.rimAt = c.chipAt = null; }
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
    setPieces(ps => { let list = ps.filter(q => !multiSel.has(q.id)); for (const id of multiSel) list = scrubRefs(list, id); return list; });
    setMultiSel(null); setSelectedId(null); setPopup(null);
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
        speed: src.speed || 1, carrier: null, pickup: null, transfers: [], shotAt: null, rimAt: null,
        chipAt: null, chipAim: null, rimAim: null, chipDist: null, rimDist: null, net: null, path: [],
      });
    }
    setPieces(ps => [...ps, ...extra]);
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
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw") { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    if (wakeEdit()) return;
    const pt = svgPt(e);
    // if this piece is part of a box-selection, drag the whole group together
    if (multiSel && multiSel.has(id)) {
      drag.current = { kind: "group", start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    // a piece in a NAMED group: dragging any member slides the whole formation;
    // a plain tap still selects/edits just this piece
    const pc = pieces.find(q => q.id === id);
    if (pc && pc.group) {
      setMultiSel(null);
      setSelectedId(id);
      drag.current = { kind: "gmove", id, members: groupMembers(pc.group), start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    setMultiSel(null);
    setSelectedId(id);
    drag.current = { kind: "piece", id, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function markPtDown(e, id, idx) {
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    if (wakeEdit()) return;
    setOpenMenu(null);
    setSelectedId(id);
    const pt = svgPt(e);
    // start/last/moved are required by onSvgMove's tap-threshold guard —
    // without them it dereferences d.start.x and throws, killing the drag
    drag.current = { kind: "markpt", id, idx, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // a leg tap that lands within grabbing distance of one of its endpoint
  // waypoints → that waypoint's index (nearest wins), else null. Lets a tap on a
  // curve where a waypoint sits open the point popup without a second tap.
  function waypointUnderTap(id, segIdx, pt, fork) {
    const p = pieces.find(q => q.id === id);
    if (!p) return null;
    const route = routeSegs(p, fork);
    let best = null, bd = 3.6;   // ~ the on-ice waypoint grab radius, in feet
    for (const w of [segIdx, segIdx - 1]) {
      if (w < 0 || w >= route.length) continue;
      const dd = Math.hypot(route[w].x - pt.x, route[w].y - pt.y);
      if (dd < bd) { bd = dd; best = w; }
    }
    return best;
  }
  function lineDown(e, id, segIdx, fork = null) {
    if (playing || pinchRef.current) return;
    e.stopPropagation();
    setOpenMenu(null);
    if (tool === "draw" && !fork) { setSelectedId(id); setPopup(null); beginDraw(e, id); return; }
    if (wakeEdit()) return;
    setSelectedId(id);
    if (fork) setEditingFork({ id, color: fork });   // tapping a reaction route opens it for editing
    const pt = svgPt(e);
    drag.current = { kind: "piece", id, line: segIdx, ...(fork ? { fork } : {}), tapPt: pt, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  function handleDown(e, payload) {
    if (!editing || pinchRef.current) return;
    e.stopPropagation();
    if (wakeEdit()) return;
    setOpenMenu(null);
    if (payload.id) setSelectedId(payload.id);
    const pt = svgPt(e);
    // resize handle: remember the pointer's starting distance from the label
    // centre so size scales with how far it's dragged out/in
    const extra = payload.kind === "resize"
      ? { dist0: Math.max(0.5, Math.hypot(pt.x - payload.cx, pt.y - payload.cy)) } : {};
    drag.current = { ...payload, ...extra, start: pt, last: pt, moved: false, touch: e.pointerType !== "mouse" };
    svgRef.current.setPointerCapture?.(e.pointerId);
  }

  // grab the stick of a stationary player to rotate them; the blade's
  // own angular offset from the body is subtracted so the blade tracks
  // the pointer exactly instead of jumping on grab
  function stickDown(e, p) {
    if (playing || pinchRef.current) return;
    if (wakeEdit()) return;
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
    if (pinchRef.current) return;
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
        const pts = p.pts.map((q, i) => (i === d.idx ? { x: cp.x, y: cp.y } : q));
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
      setRelease(d.pkId, d.aimField, d.distField, ang, dist);
      return;
    }
    if (d.kind === "resize") {
      const dist = Math.hypot(pt.x - d.cx, pt.y - d.cy);
      const size = Math.max(0.4, Math.min(6, (d.size0 || 1) * (dist / d.dist0)));
      if (d.seg == null) updateById(d.id, { size });
      else updateSeg(d.id, d.seg, { dsize: size });
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
        if (p.kind === "mark") {   // a marker annotation moves all its points together
          const pts = p.pts.map(q => ci(q.x + dx, q.y + dy));
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
          // a linked waypoint carries its tangent handles as it slides
          if ((s.join === "smooth" || s.join === "sym") && d.wp != null)
            path = translateJointHandles(path, d.wp, dx, dy);
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

  function onSvgUp() {
    const d = drag.current;
    drag.current = null;
    setLoupe(null);
    if (!d) return;
    if (d.kind === "drawing") { finishDraw(); return; }
    if (d.kind === "marquee") {
      setMarquee(null);
      if (!d.moved) { setSelectedId(null); setMultiSel(null); return; }   // a plain tap deselects
      const x0 = Math.min(d.start.x, d.last.x), x1 = Math.max(d.start.x, d.last.x);
      const y0 = Math.min(d.start.y, d.last.y), y1 = Math.max(d.start.y, d.last.y);
      const hit = pieces.filter(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map(p => p.id);
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
        const spots = [{ x: 17, y: 42.5, facing: 0 }, { x: 183, y: 42.5, facing: 180 }];
        const near = spots.find(s => Math.hypot(s.x - pc.x, s.y - pc.y) < 12);
        if (near) updateById(pc.id, near);
      }
      // a routed piece carries a start-point angle handle — reopen its editor so
      // that handle reshows after the move instead of needing a second click
      if (pc && pc.path && pc.path.length) { setSelectedId(d.id); setPopup({ type: "piece", id: d.id }); }
      return;
    }
    if (d.moved) return;
    if (d.kind === "wlabel") { setSelectedId(d.id); setPopup({ type: "point", id: d.id, seg: d.seg }); return; }
    if (d.kind === "resize") return;
    if (d.kind === "aim") { setAim(d.pkId, d.target, null); return; }  // tap to clear the aim
    if (d.kind === "release") { setAim(d.pkId, { field: d.aimField }, null); return; }  // tap clears direction back to auto
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
    setOpenMenu("text");
  }
  function applyText() {
    const r = parseDrill(extractDrill(textDraft));   // accepts a pasted ```drill markdown block
    if (r.errors.length) { setTextError(r.errors.join("\n")); return; }
    setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc); setDrillSteps(r.steps || []); setDrillNotes(r.notes || ""); setDrillItems(r.items || []); setDrillVersion(r.dslVersion); setSelectedId(null); setPopup(null);
    resetAnim(); setTextError(""); setOpenMenu(null);
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
  function exportTxt() { download(`${slug()}.txt`, serializeDrill(rink, pieces, drillTitle, drillDesc, drillSteps, drillNotes, drillItems), "text/plain"); }
  function exportMd() { download(`${slug()}.md`, toMarkdown(), "text/markdown"); }
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
      ctx.fillStyle = "#eef5f9"; ctx.fillRect(0, 0, W, H);         // ice surround (var fallback theme)
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => {
        if (!b) { flash("Image export failed"); return; }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = `${slug()}.png`; a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); flash("Image export failed"); };
    img.src = url;
  }
  function copyMd() {
    navigator.clipboard?.writeText(toMarkdown());
    setToast("Markdown copied"); setTimeout(() => setToast(""), 1400);
  }
  const flash = msg => { setToast(msg); setTimeout(() => setToast(""), 1400); };
  // copy the drill text from the editor to the clipboard
  function copyText() {
    navigator.clipboard?.writeText(textDraft);
    flash("Text copied");
  }
  // share the drill (native share sheet where available, else copy the markdown)
  function shareDrill() {
    const md = toMarkdown();
    if (navigator.share) {
      navigator.share({ title: (drillTitle || "Drill").trim(), text: md }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(md);
      flash("Markdown copied");
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
    else { navigator.clipboard?.writeText(url); flash("Preview link copied"); }
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
    setDrillItems(prev => [...prev, { key: k, custom: true, count: 1, label: "New item" }]);
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
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  /* ----- render helpers ----- */
  // `flat` = draw with plain rink-unit widths (used by the loupe, which has its
  // own near-square viewBox); otherwise use screen-uniform non-scaling strokes so
  // the fill-mode stretch can't make a line thicker along one axis than the other
  function segStroke(p, s, isLast, flat) {
    const W = w => (flat ? w : sw(w)) * lineScale;   // global route line-thickness scale
    const D = d => (flat ? d : sdash(d));
    const base = { stroke: p.color, fill: "none", strokeLinecap: "round", opacity: 0.78,
      ...(flat ? {} : { vectorEffect: "non-scaling-stroke" }) };
    if (p.kind !== "puck") return { ...base, strokeWidth: W(0.7) };
    if (s.mode === "pass") return { ...base, strokeWidth: W(0.7), strokeDasharray: D("2.4 1.8") };
    if (s.mode === "shot") return { ...base, strokeWidth: W(1.25) };
    return { ...base, strokeWidth: W(0.75), strokeDasharray: D("0.2 1.5") };
  }

  /* ---- action badges at waypoints ---- */
  // gap (rink ft) the line leaves around an action badge; badge radius in icon-frame units
  const ACT_GAP = 3.4, ACT_R = 3.0;
  // priority for picking the "main" action shown in a badge with several actions
  const ACT_PRI = { shot: 5, pass: 4, rim: 3, chip: 2, receive: 1, collect: 1, pickup: 1 };
  const stepActionType = st => st.role === "pickup" ? "pickup" : st.role === "receive" ? "receive"
    : st.role === "collect" ? "collect" : (st.kind || "pass");   // release/terminal → its kind
  const actionIconName = t => t === "shot" ? "net" : t === "pass" ? "pass" : t === "chip" ? "chip"
    : t === "rim" ? "rim" : "collect";   // receive / collect / pickup all = gaining the puck
  // waypoints (index → {count, type}) where a player acts on the puck. Skips the
  // standing spot (i=-1) — the player icon already sits there.
  function actionWaypoints(p) {
    const m = new Map();
    if (p.kind !== "player" || !p.path.length) return m;
    for (let i = 0; i < p.path.length; i++) {
      const steps = stepsAt(p, i);
      if (!steps.length) continue;
      let best = null, bp = -1;
      for (const st of steps) { const t = stepActionType(st), pr = ACT_PRI[t] || 0; if (pr > bp) { bp = pr; best = t; } }
      m.set(i, { count: steps.length, type: best });
    }
    return m;
  }
  // draw, at each action waypoint: the incoming end-mark (chevron, or ‖ when the
  // player stops there) plus a circular badge with the main action's icon and, if
  // several actions land there, a count. The route's segment trims leave the gaps.
  function renderActionMarks(p, bentPts, acts) {
    if (!acts || !acts.size) return null;
    const n = p.path.length, els = [];
    for (const [i, info] of acts) {
      const s = p.path[i];
      const prev = i >= 1 ? segEnd(p, i - 1) : { x: p.x, y: p.y };
      let tx, ty;
      if (i === n - 1 && bentPts && bentPts.length >= 2) {
        const b = bentPts[Math.max(0, bentPts.length - 4)]; tx = s.x - b.x; ty = s.y - b.y;
      } else {
        const near = evalSeg(prev, s, 0.85); tx = s.x - near.x; ty = s.y - near.y;
        if (Math.hypot(tx, ty) < 1e-4) { tx = s.x - prev.x; ty = s.y - prev.y; }
      }
      const tl = Math.hypot(tx, ty) || 1, ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      // incoming end-mark, just outside the badge on the incoming side
      const mfx = iconXf({ x: s.x - (tx / tl) * ACT_GAP, y: s.y - (ty / tl) * ACT_GAP, a: ang });
      els.push(
        <g key={`am${i}`} transform={mfx.t} pointerEvents="none">
          {s.endStop
            ? <path d="M 0 -1.9 L 0 1.9 M -1.5 -1.9 L -1.5 1.9" fill="none" stroke={p.color} strokeWidth={0.7} strokeLinecap="round" />
            : <path d="M -3 -1.9 L 0 0 L -3 1.9" fill="none" stroke={p.color} strokeWidth={0.7} strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      );
      // upright badge circle + action icon (+ count)
      const cfx = iconXf({ x: s.x, y: s.y, a: 0 });
      els.push(
        <g key={`ab${i}`} transform={cfx.t} pointerEvents="none">
          <circle cx={0} cy={0} r={ACT_R} fill="#fff" stroke={p.color} strokeWidth={0.5} />
          <g style={{ color: p.color }} transform={`scale(0.178) translate(-12 -12)`}
            fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            {ICONS[actionIconName(info.type)]}
          </g>
          {info.count > 1 && (
            <g transform={`translate(${ACT_R * 0.74} ${-ACT_R * 0.74})`}>
              <circle cx={0} cy={0} r={1.55} fill={p.color} />
              <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={2.2}
                fontWeight={800} fill="#fff" style={{ fontFamily: "system-ui, sans-serif" }}>{info.count}</text>
            </g>
          )}
        </g>
      );
    }
    return <g>{els}</g>;
  }

  // Arrowhead at a route's end, drawn in the stretch-cancelling icon frame so it
  // stays a clean triangle (SVG markers get sheared by the fill-mode stretch).
  function renderArrow(p, bentPts, acts) {
    const n = p.path.length;
    if (!n) return null;
    if (acts && acts.has(n - 1)) return null;   // an action badge marks this end instead
    // anchor the tip at the drawn line's END and point it along that line's end
    // tangent — use the detoured (bent) polyline when there is one so the head
    // lines up with the curve actually shown, not the raw path
    let endPt, tx, ty;
    if (bentPts && bentPts.length >= 2) {
      endPt = bentPts[bentPts.length - 1];
      const b = bentPts[Math.max(0, bentPts.length - 4)];
      tx = endPt.x - b.x; ty = endPt.y - b.y;
    } else {
      const last = p.path[n - 1];
      const prev = n >= 2 ? segEnd(p, n - 2) : { x: p.x, y: p.y };
      endPt = { x: last.x, y: last.y };
      const near = evalSeg(prev, last, 0.9);
      tx = last.x - near.x; ty = last.y - near.y;
      if (Math.hypot(tx, ty) < 1e-4) {               // degenerate (control on the endpoint)
        if (last.type === "C") { tx = last.x - last.c2x; ty = last.y - last.c2y; }
        else if (last.type === "Q") { tx = last.x - last.cx; ty = last.y - last.cy; }
        else { tx = last.x - prev.x; ty = last.y - prev.y; }
      }
    }
    if (!tx && !ty) return null;
    const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
    const fx = iconXf({ x: endPt.x, y: endPt.y, a: ang });
    // hold a constant SCREEN size (counter the pinch-zoom) so the head stays
    // locked to the non-scaling line and is equally distinctive at any zoom
    const z = 1 / (view.s || 1);
    return (
      <g key={`arw-${p.id}`} transform={fx.t} pointerEvents="none">
        <g transform={`scale(${z})`}>
          {p.path[n - 1] && p.path[n - 1].endStop
            // stop mark ("||"): the player stops here — two short bars across the
            // line's end instead of a direction arrowhead
            ? <path d="M 0 -2.8 L 0 2.8 M -1.8 -2.8 L -1.8 2.8" fill="none" stroke={p.color}
                strokeWidth={1.2} strokeLinecap="round" />
            // open chevron head (skating-route convention): two barbs meeting at
            // the tip, which sits on the line's end
            : <path d="M -4.8 -2.9 L 0 0 L -4.8 2.9" fill="none" stroke={p.color}
                strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      </g>
    );
  }

  function renderHandles(p, yf = yFix, fork = null) {
    const hd = (cx, cy, r, props) => hdot(cx, cy, r, props, yf);
    if (!editing || p.id !== selectedId || tool === "draw") return null;
    const rp = routePiece(p, fork);           // fork ? branch-origin route piece : p
    const route = rp.path;
    // colour the fork's handles by its cue colour so overlapping routes stay legible
    const dotFill = fork || "#ffd447", dotStroke = fork ? "#0b1116" : "#7a5c00";
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
    // a draggable tangent control, with a dashed leash back to its waypoint anchor.
    const ctrlPt = (key, cx, cy, kind, seg, wp, ax, ay) => {
      els.push(<line key={key + "l"} x1={ax} y1={ay} x2={cx} y2={cy} stroke="#8fa3b5" strokeWidth={0.25} strokeDasharray="1 1" />);
      els.push(hd(cx, cy, 1.5, { key, fill: "#fff", stroke: "#5b7d9e", strokeWidth: 0.4, pointerEvents: "none" }));
      els.push(hd(cx, cy, 4, { key: key + "h", fill: "transparent", style: { cursor: "grab" },
        onPointerDown: e => handleDown(e, { kind, id: p.id, seg, wp, ...(fork ? { fork } : {}) }) }));
    };
    route.forEach((s, i) => {
      if (i === activeWp) {
        // full anchor grab: a circle for a linked (smooth/sym) point, a square for
        // a corner — the vector-editor convention, so the point type reads on-ice
        if (s.join === "smooth" || s.join === "sym")
          els.push(hd(s.x, s.y, 1.6, { key: `a${i}`, fill: dotFill, stroke: dotStroke, strokeWidth: 0.35, pointerEvents: "none" }));
        else
          els.push(<rect key={`a${i}`} x={s.x - 1.4} y={s.y - 1.4 * yf} width={2.8} height={2.8 * yf}
            fill={dotFill} stroke={dotStroke} strokeWidth={0.35} pointerEvents="none" />);
        els.push(hd(s.x, s.y, 4, { key: `ah${i}`, fill: "transparent", style: { cursor: "grab" },
          onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: i, wp: i, ...(fork ? { fork } : {}) }) }));
        // incoming tangent: this leg's control nearest waypoint i
        if (s.type === "C") ctrlPt(`ic${i}`, s.c2x, s.c2y, "c2", i, i, s.x, s.y);
        else if (s.type === "Q") ctrlPt(`iq${i}`, s.cx, s.cy, "q", i, i, s.x, s.y);
        // outgoing tangent: the next leg's control nearest waypoint i
        const nx = route[i + 1];
        if (nx && nx.type === "C") ctrlPt(`oc${i}`, nx.c1x, nx.c1y, "c1", i + 1, i, s.x, s.y);
        else if (nx && nx.type === "Q") ctrlPt(`oq${i}`, nx.cx, nx.cy, "q", i + 1, i, s.x, s.y);
      } else {
        // every other waypoint is just a small (still grabbable) dot
        els.push(hd(s.x, s.y, 0.9, { key: `am${i}`, fill: dotFill, stroke: dotStroke, strokeWidth: 0.3, pointerEvents: "none" }));
        els.push(hd(s.x, s.y, 3.5, { key: `amh${i}`, fill: "transparent", style: { cursor: "grab" },
          onPointerDown: e => handleDown(e, { kind: "anchor", id: p.id, seg: i, wp: i, ...(fork ? { fork } : {}) }) }));
      }
    });
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
        {hd(p.x, p.y, R, { fill: "none", stroke: "#ffd447", strokeWidth: 0.25, strokeDasharray: "1 1", opacity: 0.75, pointerEvents: "none" })}
        {hd(kx, ky, 1.6, { fill: "#ffd447", stroke: "#7a5c00", strokeWidth: 0.35, pointerEvents: "none" })}
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
    const release = (at, kind, aim, dist, aimField, distField) => {
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
        <g key={`rel-${p.id}-${aimField}`}>
          <polyline points={path.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col}
            strokeWidth={0.4} strokeDasharray="2 1.4" opacity={0.7} pointerEvents="none" />
          {hd(end.x, end.y, 1.4, { fill: "none", stroke: col, strokeWidth: 0.35, opacity: 0.7, pointerEvents: "none" })}
          {hd(here.x, here.y, 1, { fill: col, opacity: 0.8, pointerEvents: "none" })}
          {hd(hx, hy, 1.9, { fill: col, stroke: "#fff", strokeWidth: 0.4, pointerEvents: "none" })}
          {hd(hx, hy, 5, { fill: "transparent", style: { cursor: "grab" },
            onPointerDown: e => handleDown(e, { kind: "release", pkId: pk.id, origin: here, aimField, distField, relKind: kind }) })}
        </g>
      );
    };
    if (pk.chipAt != null && chain[last] === p.id)
      release(pk.chipAt, "chip", pk.chipAim, pk.chipDist != null ? pk.chipDist : REL_DEFAULT.chipAt, "chipAim", "chipDist");
    if (pk.rimAt != null && chain[last] === p.id)
      release(pk.rimAt, "rim", pk.rimAim, pk.rimDist != null ? pk.rimDist : REL_DEFAULT.rimAt, "rimAim", "rimDist");

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
  function labelNode(key, x, y, text, size, color, sel, onDown, resizeDown) {
    const fx = iconXf({ x, y, a: 0 });
    const lines = String(text || " ").split("\n");
    // the icon frame bakes in ICON_SCALE (0.8), so on-ice height ≈ fs·0.8;
    // fs≈6.5 → ~5 ft tall at size 1 (readable as words on a full-sheet phone)
    const fs = 6.5 * (size || 1) / ICON_SCALE;
    const lh = fs * 1.16;
    const w = Math.max(1, ...lines.map(l => l.length)) * fs * 0.56 + fs * 0.7;
    const h = lines.length * lh + fs * 0.34;
    return (
      <g key={key} transform={fx.t}>
        <g transform={`rotate(${-fx.th})`}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={fs * 0.28}
            fill="rgba(246,251,253,0.95)" stroke={sel ? "#ffd447" : "rgba(20,32,43,0.35)"}
            strokeWidth={sel ? 0.7 : 0.4} onPointerDown={onDown}
            style={{ cursor: onDown ? "grab" : "default" }} />
          <text textAnchor="middle" fontSize={fs} fontWeight={800} fill={color || "#14202b"}
            pointerEvents="none" style={{ fontFamily: "system-ui, sans-serif", userSelect: "none",
              paintOrder: "stroke", stroke: "rgba(246,251,253,0.9)", strokeWidth: fs * 0.06 }}>
            {lines.map((l, k) => (
              <tspan key={k} x={0} y={(k - (lines.length - 1) / 2) * lh + fs * 0.34}>{l || " "}</tspan>
            ))}
          </text>
          {sel && resizeDown && (
            <>
              <rect x={w / 2 - fs * 0.42} y={h / 2 - fs * 0.42} width={fs * 0.84} height={fs * 0.84}
                rx={fs * 0.15} fill="#ffd447" stroke="#7a5c00" strokeWidth={0.3} pointerEvents="none" />
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
  // sample a smooth Catmull-Rom curve through the mark's control points so a
  // stroke reads as a curve (and stays smooth when its points are re-shaped)
  const markCurve = cp => {
    if (!cp || cp.length < 3) return cp || [];
    const segs = catmullToBezier(cp);
    let prev = cp[0]; const out = [{ x: cp[0].x, y: cp[0].y }];
    segs.forEach(s => {
      const n = Math.max(2, Math.round(Math.hypot(s.x - prev.x, s.y - prev.y) / 0.6));
      for (let k = 1; k <= n; k++) out.push(evalSeg(prev, s, k / n));
      prev = { x: s.x, y: s.y };
    });
    return out;
  };
  function renderMark(m, hit) {
    if (!m.pts || m.pts.length < 2) return null;
    const base = markCurve(m.pts);
    const pts = m.style === "wavy" ? wavyPts(base, Math.max(0.5, m.width * 0.9), 2.8) : base;
    const w = m.width || 1.1;
    const dash = m.style === "dashed" ? `${(w * 2.6).toFixed(2)} ${(w * 1.9).toFixed(2)}`
      : m.style === "dotted" ? `0.02 ${(w * 2).toFixed(2)}` : undefined;
    const line = pts.map(q => `${clampX(q.x)},${clampY(q.y)}`).join(" ");
    return (
      <g key={`mk-${m.id}`}>
        <polyline points={line} fill="none" stroke={m.color} strokeWidth={w} strokeDasharray={dash}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.94}
          pointerEvents={hit ? "none" : undefined} />
        {m.id === selectedId && (
          <polyline points={line} fill="none" stroke="#ffd447" strokeWidth={w + 1.1}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.35} pointerEvents="none" />
        )}
        {hit && editing && !markEdit && (
          <polyline points={line} fill="none" stroke="transparent" strokeWidth={Math.max(4, w + 3)}
            strokeLinecap="round" strokeLinejoin="round" style={{ cursor: "grab" }}
            onPointerDown={e => pieceDown(e, m.id)} />
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
        {hdot(clampX(q.x), clampY(q.y), 1.7, {
          fill: "#ffd447", stroke: "#14171a", strokeWidth: 0.35, pointerEvents: "none" }, yf)}
        {/* a larger transparent target so a fingertip can grab the point */}
        {hdot(clampX(q.x), clampY(q.y), 4.5, {
          fill: "transparent", style: { cursor: "grab" },
          onPointerDown: e => markPtDown(e, m.id, i) }, yf)}
      </g>
    ));
  }
  function renderLabels() {
    const canEdit = editing && tool !== "draw";
    const els = [];
    pieces.forEach(p => {
      if (p.kind === "label") {
        const sel = canEdit && p.id === selectedId;
        els.push(labelNode(`lbl-${p.id}`, p.x, p.y, p.text, p.size, p.color, sel,
          e => pieceDown(e, p.id),
          canEdit ? e => handleDown(e, { kind: "resize", id: p.id, seg: null, cx: p.x, cy: p.y, size0: p.size || 1 }) : null));
      } else if (p.label && p.kind !== "player") {
        // a name tag under any named prop/piece (players show their jersey instead)
        const off = p.kind === "net" ? 6.5 : 5;
        els.push(labelNode(`nm-${p.id}`, p.x, p.y + off, p.label, 0.5, "#33414f", false, null, null));
      }
      (p.path || []).forEach((s, i) => {
        if (s.dmode !== "label" || !s.desc) return;
        const cx = s.x + (s.dox || 0), cy = s.y + (s.doy != null ? s.doy : -5);
        const sel = canEdit && p.id === selectedId;
        els.push(labelNode(`wl-${p.id}-${i}`, cx, cy, s.desc, s.dsize, "#14202b", sel,
          canEdit ? e => handleDown(e, { kind: "wlabel", id: p.id, seg: i }) : undefined,
          canEdit ? e => handleDown(e, { kind: "resize", id: p.id, seg: i, cx, cy, size0: s.dsize || 1 }) : null));
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
    if (!showResult || aiPlay || animT <= 0) return null;
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
          {hd(pt.x, pt.y, 2, { fill: "#fff", stroke: p.color, strokeWidth: 0.35 })}
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
      return (
        <>
          {rec && rec.path.length >= 2 && (
            <div className="hd-poprow">
              <span style={{ fontSize: 11 }}>{tr.via ? "back at" : "caught at"}</span>
              <button className={`hd-mini${tr.recvAt == null ? " on" : ""}`} onClick={() => setRecvAt(pk.id, st.stage, null)}>auto</button>
              {rec.path.map((s, wi) => <button key={wi} className={`hd-mini${tr.recvAt === wi ? " on" : ""}`} onClick={() => setRecvAt(pk.id, st.stage, tr.recvAt === wi ? null : wi)}>{wi + 1}</button>)}
            </div>
          )}
          <div className="hd-poprow">
            <button className={`hd-mini${isSauce ? " on" : ""}`} onClick={doSauce}><Icon name={isSauce ? "check" : "sauce"} size={14} /> Sauce pass</button>
          </div>
        </>
      );
    };

    const ActionSteps = (p, i) => {
      const steps = stepsAt(p, i);
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
        const holds = pieces.filter(q => {
          if (q.kind !== "puck") return false;
          const ch = puckChain(q);
          return ch[ch.length - 1] === p.id && q.shotAt == null && q.rimAt == null && q.chipAt == null;
        });
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
        const ch = puckChain(pk);
        return { pk, last: ch[ch.length - 1] === p.id };
      };
      const addPass = to => { const h = heldRelease(); if (h) appendTransfer(h.pk.id, { at: i, to, recvAt: null, kind: "pass", ...(h.last ? {} : { by: p.id }) }); };
      // give-and-go: bounce off a passer/tire/bumper back to this player
      const addVia = via => { const h = heldRelease(); if (h) appendTransfer(h.pk.id, { at: i, to: p.id, recvAt: i < 0 ? null : i, kind: "pass", via, ...(h.last ? {} : { by: p.id }) }); };
      const addTerminal = (field, net) => {
        const h = heldRelease(); if (!h) return;
        updateById(h.pk.id, { shotAt: null, rimAt: null, chipAt: null, [field]: i,
          ...(field === "shotAt" ? { net: net || null, rimAim: null, chipAim: null } : {}),
          ...(field === "rimAt" ? { rimDist: h.pk.rimDist || REL_DEFAULT.rimAt } : field === "chipAt" ? { chipDist: h.pk.chipDist || REL_DEFAULT.chipAt } : {}),
          ...(h.last ? {} : { termBy: p.id }) });
      };
      const createType = t => {
        if (t === "receive") { const src = defaultPasser(); if (src) doReceiveFrom(p.id, i, src); else flash("Add another player to pass from"); }
        else if (t === "collect") collectPuckAt(p.id, i);
        else if (t === "pass") { const to = (others[0] || {}).id; if (to) addPass(to); else if (viaTargets[0]) addVia(viaTargets[0].id); else flash("Add a player, passer, tire, or bumper to pass to"); }
        else if (t === "shoot") addTerminal("shotAt", null);
        else if (t === "chip") addTerminal("chipAt");
        else if (t === "rim") addTerminal("rimAt");
      };
      const changeType = (st, t) => {
        if (t === "none") { st.del(); return; }
        const cur = typeOfStep(st);
        if (t === cur) return;
        const pk = st.pk;
        if (!isGain(cur) && !isGain(t)) {                       // release/terminal ↔ release/terminal, same stage/puck
          const stage = st.role === "terminal" ? (pk.transfers || []).length : st.stage;
          if (t === "pass") setTransfer(pk.id, stage, { at: i, to: (others[0] || {}).id, recvAt: null, kind: "pass" });
          else {
            const field = t === "shoot" ? "shotAt" : t === "rim" ? "rimAt" : "chipAt";
            update(q => q.id !== pk.id ? q : { ...q, transfers: (q.transfers || []).slice(0, stage),
              shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null, termBy: null, [field]: i,
              ...(field === "rimAt" ? { rimDist: q.rimDist || REL_DEFAULT.rimAt } : field === "chipAt" ? { chipDist: q.chipDist || REL_DEFAULT.chipAt } : {}) });
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
          return (
            <select className="hd-select on" value={val} onChange={e => { const v = e.target.value;
              if (v[0] === "v") setTransfer(pk.id, st.stage, { at: i, to: p.id, recvAt: i < 0 ? null : i, kind: "pass", via: v.slice(2) });
              else setTransfer(pk.id, st.stage, { ...tr, to: v.slice(2), via: undefined, at: i, kind: "pass" }); }}>
              {others.map(o => <option key={o.id} value={"p:" + o.id}>{nameOf(o.id)}</option>)}
              {viaTargets.map(v => <option key={v.id} value={"v:" + v.id}>{nameOf(v.id)}{v.kind === "tire" ? " (tire)" : v.kind === "bumper" ? " (bumper)" : ""} — give &amp; go ⟲</option>)}
            </select>
          );
        }
        if (t === "shoot") {
          const term = st.role === "terminal";
          const curNet = term ? pk.net : ((pk.transfers || [])[st.stage] || {}).net;
          const setNet = id => term ? updateById(pk.id, { net: id })
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
            <select className="hd-select on" value={src} onChange={e => { const v = e.target.value; st.del(); if (v) doReceiveFrom(p.id, i, v); }}>
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
              onChange={e => { const v = e.target.value; st.del(); collectPuckAt(p.id, i, v === "nearest" ? undefined : v); }}>
              <option value="nearest">Nearest puck</option>
              {pieces.filter(q => q.kind === "puck").map(q => <option key={q.id} value={q.id}>{q.id}</option>)}
            </select>
          );
        }
        return null;                                            // chip / rim → on-ice handle (hint row below)
      };
      // each step's type options come from ITS OWN role (a gain step offers
      // gains, a release step offers releases) — robust to multiple pucks handled
      // at one spot, where a single possession "walk" would mislabel steps.
      const rows = steps.map(st => ({ st,
        opts: (st.role === "receive" || st.role === "collect" || st.role === "pickup") ? GAIN_TYPES : RELEASE_TYPES }));
      // the Add control offers releases when the player is currently holding an
      // un-released puck (the chain's last carrier), else gains
      const holdingHere = pieces.some(q => {
        if (q.kind !== "puck") return false;
        const ch = puckChain(q);
        return ch[ch.length - 1] === p.id && q.shotAt == null && q.rimAt == null && q.chipAt == null;
      });
      const addOpts = holdingHere ? RELEASE_TYPES : GAIN_TYPES;
      const typeSelect = (value, options, onChange, key) => (
        <select key={key} className={`hd-select${value !== "none" ? " on" : ""}`} style={{ flex: "0 1 auto", minWidth: 96 }} value={value} onChange={e => onChange(e.target.value)}>
          <option value="none">No Action</option>
          {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
        </select>
      );
      const addRow = key => (
        <div key={key} className="hd-poprow">
          <span style={{ minWidth: 46, fontSize: 11, color: "#8b99a8" }}>＋ Add</span>
          {typeSelect("none", addOpts, t => t !== "none" && createType(t), key)}
        </div>
      );
      return (
        <div style={{ margin: "6px 0", padding: "7px 8px", background: "rgba(120,140,160,0.12)", borderRadius: 8 }}>
          <div className="hd-mh" style={{ marginBottom: 5 }}>Action — {i < 0 ? "waypoint 0 · start" : `waypoint ${i + 1}`}</div>
          {rows.length > 0 && addRow("addtop")}
          {rows.map(({ st, opts }, n) => {
            const t = typeOfStep(st);
            const accent = t === "shoot" ? "#d7263d" : t === "pass" ? "#1f8a4c" : t === "chip" || t === "rim" ? "#e0731d" : "#2f7fd6";
            return (
              <div key={n} style={{ margin: "5px 0", padding: "5px 7px 5px 8px", borderRadius: 8,
                background: "rgba(20,26,34,0.6)", border: "1px solid #2c3846", borderLeft: `3px solid ${accent}`,
                opacity: st.warn ? 0.7 : 1 }}>
                <div className="hd-poprow">
                  <span style={{ minWidth: 46, fontWeight: 700, color: "#9fb0c0", fontSize: 11.5 }}>Step {n + 1}</span>
                  {typeSelect(t, opts, v => changeType(st, v), n)}
                  {secondary(st)}
                  <button className="hd-mini danger" style={{ padding: "3px 8px", minHeight: 0 }} title="Remove step" onClick={st.del}>✕</button>
                </div>
                {st.warn && <div className="hd-poprow"><span style={{ fontSize: 10.5, color: "#c98a2b" }}>⚠ {st.warn}</span></div>}
                {t === "pass" && passSubRows(p, i, st)}
                {(t === "chip" || t === "rim") && <div className="hd-poprow"><span style={{ fontSize: 10.5, color: "#8b99a8" }}>drag the on-ice handle to aim &amp; set distance</span></div>}
              </div>
            );
          })}
          {rows.length === 0
            ? <div className="hd-poprow"><span style={{ minWidth: 46, fontWeight: 700, color: "#8b99a8", fontSize: 12 }}>Step 1</span>{typeSelect("none", addOpts, t => t !== "none" && createType(t), "s1")}</div>
            : addRow("addbot")}
        </div>
      );
    };

    let anchorPt, body, title;
    if (popup.type === "add") {
      if (!popup.pt) return null;
      anchorPt = popup.pt;
      title = "Add here";
      body = (
        <div className="hd-toolgrid compact">
          <button className="hd-tool" onClick={() => addPieceAt("player", popup.pt)}>{toolImg("player")}<span>Player</span></button>
          <button className="hd-tool" onClick={() => addPlayerWithPuck(popup.pt, true)}>{toolImg("playerpuck")}<span>+ Puck</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("puck", popup.pt)}>{toolImg("puck")}<span>Puck</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("cone", popup.pt)}>{toolImg("cone")}<span>Cone</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("net", popup.pt)}>{toolImg("net")}<span>Net</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("bumper", popup.pt)}>{toolImg("bumper")}<span>Bumper</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("deker", popup.pt)}>{toolImg("deker")}<span>Deker</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("passer", popup.pt)}>{toolImg("passer")}<span>Passer</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("tire", popup.pt)}>{toolImg("tire")}<span>Tire</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("stick", popup.pt)}>{toolImg("stick")}<span>Stick</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("light", popup.pt)}>{toolImg("light")}<span>Light</span></button>
          <button className="hd-tool" onClick={() => addPieceAt("label", popup.pt)}><span className="hd-toolglyph"><Icon name="label" size={22} /></span><span>Label</span></button>
        </div>
      );
    } else if (popup.type === "piece") {
      anchorPt = { x: p.x, y: p.y };
      title = p.kind === "player" ? `Player ${p.id}` : p.kind === "puck" ? `Puck ${p.id}`
        : p.kind === "net" ? `Net ${p.id}` : p.kind === "bumper" ? `Bumper ${p.id}`
        : p.kind === "deker" ? `Deker ${p.id}` : p.kind === "passer" ? `Passer ${p.id}`
        : p.kind === "label" ? `Label ${p.id}` : p.kind === "tire" ? `Tire ${p.id}` : p.kind === "stick" ? `Stick ${p.id}`
        : p.kind === "light" ? `Light ${p.id}` : p.kind === "mark" ? `Mark ${p.id}` : `Cone ${p.id}`;
      body = (
        <>
          {p.kind === "label" && (
            <>
              <div className="hd-poprow">
                <span>Text</span>
                <input className="hd-input" style={{ flex: 1, minWidth: 120 }} value={p.text || ""}
                  placeholder="Label text" autoFocus
                  onChange={e => updateById(p.id, { text: e.target.value })} />
              </div>
              <div className="hd-poprow">
                <span>Size</span>
                <Stepper value={+(p.size || 1).toFixed(2)} onChange={v => updateById(p.id, { size: Math.max(0.4, v) })} step={0.2} min={0.4} suffix="×" />
                <span style={{ fontSize: 11, color: "#8b99a8" }}>drag to move · corner to resize</span>
              </div>
              <div className="hd-poprow">
                {LABEL_COLORS.map(c => (
                  <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                    onClick={() => updateById(p.id, { color: c })} />
                ))}
              </div>
            </>
          )}
          {p.kind === "net" && (
            <>
              <div className="hd-poprow">
                <button className={`hd-mini${p.goalie ? " on" : ""}`}
                  onClick={() => updateById(p.id, { goalie: !p.goalie })}>
                  {p.goalie ? "✓ Goalie in net" : "🥅 Goalie in net"}
                </button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>drag to move · ring to rotate</span>
              </div>
              <div className="hd-poprow">
                <button className={`hd-mini${p.crease ? " on" : ""}`}
                  onClick={() => updateById(p.id, { crease: !p.crease })}>
                  {p.crease ? "✓ Crease drawn" : "◗ Draw crease"}
                </button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>an arc in front — for a net off the goal line</span>
              </div>
              <div className="hd-poprow">
                <span>Size</span>
                <button className={`hd-mini${(p.size || 1) >= 0.85 ? " on" : ""}`}
                  onClick={() => updateById(p.id, { size: 1 })}>NHL</button>
                <button className={`hd-mini${(p.size || 1) < 0.85 ? " on" : ""}`}
                  onClick={() => updateById(p.id, { size: 0.62 })}>Mite</button>
              </div>
            </>
          )}
          {p.kind === "tire" && (
            <>
              <div className="hd-poprow">
                <button className={`hd-mini${p.goalie ? " on" : ""}`}
                  onClick={() => updateById(p.id, { goalie: !p.goalie })}>
                  {p.goalie ? "✓ Keeper on the tire" : "🥅 Keeper on the tire"}
                </button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>defends shots all the way around</span>
              </div>
              <div className="hd-poprow">
                <span>Size</span>
                <button className={`hd-mini${(p.size || 1) >= 0.8 ? " on" : ""}`}
                  onClick={() => updateById(p.id, { size: 1 })}>Large</button>
                <button className={`hd-mini${(p.size || 1) < 0.8 ? " on" : ""}`}
                  onClick={() => updateById(p.id, { size: 0.55 })}>Small</button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>drag to move</span>
              </div>
            </>
          )}
          {p.kind === "light" && (() => {
            const cues = p.cues || [];
            const nextColor = c => LIGHT_COLORS[(LIGHT_COLORS.indexOf(c) + 1) % LIGHT_COLORS.length];
            const setCues = next => updateById(p.id, { cues: next });
            return (
              <>
                <div className="hd-poprow">
                  <span>Idle</span>
                  {LIGHT_COLORS.map(c => (
                    <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                      onClick={() => updateById(p.id, { color: c })} />
                  ))}
                </div>
                <div className="hd-poprow">
                  <button className={`hd-mini${p.rand !== false ? " on" : ""}`}
                    onClick={() => updateById(p.id, { rand: p.rand === false ? true : false })}>
                    {p.rand !== false ? "✓ Reactive (random + loop)" : "Fixed sequence"}
                  </button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>
                    {p.rand !== false ? "shuffles + loops the cues, different each run" : "plays the cues in order, once"}
                  </span>
                </div>
                <div className="hd-poprow">
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>Cue timeline — the colours the screen shows{p.rand !== false ? " (order randomised per run)" : ""}</span>
                </div>
                {cues.map((c, i) => (
                  <div className="hd-poprow" key={i}>
                    <div className="hd-swatch on" title="tap to change colour" style={{ background: c.color, cursor: "pointer" }}
                      onClick={() => setCues(cues.map((q, j) => j === i ? { ...q, color: nextColor(q.color) } : q))} />
                    <Stepper value={+(c.dur || 0).toFixed(1)} step={0.5} min={0.5}
                      onChange={v => setCues(cues.map((q, j) => j === i ? { ...q, dur: v } : q))} />
                    <button className="hd-mini" onClick={() => setCues(cues.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <div className="hd-poprow">
                  <button className="hd-mini" onClick={() => setCues([...cues, { color: LIGHT_COLORS[cues.length % LIGHT_COLORS.length], dur: 2 }])}>
                    + Add cue
                  </button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>cognitive-training light · drag to move · ring to rotate</span>
                </div>
              </>
            );
          })()}
          {(p.kind === "bumper" || p.kind === "deker" || p.kind === "passer") && (
            <div className="hd-poprow">
              <span style={{ fontSize: 11, color: "#8b99a8" }}>
                {p.kind === "deker" ? "stickhandle under the stick · " : p.kind === "passer" ? "pucks rebound off the face · " : ""}drag to move · ring to rotate
              </span>
            </div>
          )}
          {p.kind === "mark" && (
            <>
              <div className="hd-poprow">
                {["#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#ffffff", "#14202b"].map(c => (
                  <div key={c} className={`hd-swatch${p.color === c ? " on" : ""}`} style={{ background: c }}
                    onClick={() => updateById(p.id, { color: c })} />
                ))}
              </div>
              <div className="hd-poprow">
                <span>Style</span>
                {[["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]].map(([s, lbl]) => (
                  <button key={s} className={`hd-mini${(p.style || "solid") === s ? " on" : ""}`} onClick={() => updateById(p.id, { style: s })}>{lbl}</button>
                ))}
              </div>
              <div className="hd-poprow">
                <span>Thickness</span>
                <input type="range" min={0.5} max={3} step={0.1} value={p.width || 1.1} style={{ flex: 1, minWidth: 80 }}
                  onChange={e => updateById(p.id, { width: parseFloat(e.target.value) })} />
              </div>
              <div className="hd-poprow">
                <button className={`hd-mini${markEdit ? " on" : ""}`} onClick={() => setMarkEdit(v => !v)}>
                  {markEdit ? "Done editing" : "Edit points"}
                </button>
                {markEdit && <span style={{ fontSize: 11, color: "#8b99a8" }}>drag a dot to re-shape</span>}
              </div>
            </>
          )}
          {p.kind === "player" && (
            <>
              {/* the player is waypoint 1 (the start) — step into the route */}
              {p.path.length > 0 && (
                <div className="hd-poprow">
                  <button className="hd-mini" disabled style={{ opacity: 0.4 }}>‹ Prev</button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>1 / {p.path.length + 1}</span>
                  <button className="hd-mini" onClick={() => navPopup({ type: "point", id: p.id, seg: 0 })}>Next ›</button>
                </div>
              )}
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
                {(() => {
                  // a carried puck now sits under the player, so surface a
                  // direct route to its popup here instead of tapping the blade
                  const carried = pieces.find(q => q.kind === "puck" && q.carrier === p.id);
                  return carried ? (
                    <button className="hd-mini" onClick={() => {
                      setSelectedId(carried.id);
                      setPopup({ type: "piece", id: carried.id });
                    }}>● Edit puck</button>
                  ) : (
                    <button className="hd-mini" onClick={() => {
                      const pk = makePiece("puck", { x: p.x, y: p.y });
                      pk.carrier = p.id;
                      setPieces(ps => [...ps, pk]);
                    }}>● Give puck</button>
                  );
                })()}
              </div>
              {p.path.length > 0 && !p.defense && (
                <div className="hd-poprow">
                  <button className={`hd-mini${p.holdLine ? " on" : ""}`}
                    onClick={() => updateById(p.id, { holdLine: !p.holdLine })}>
                    {p.holdLine ? "✓ Hold at blue line" : "Hold at blue line"}
                  </button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>waits for the puck to enter the zone</span>
                </div>
              )}
              {/* light reactions live on the branch waypoint (route end, nearest the
                  light); a route-less player branches from its start, so show them here */}
              {!p.path.length && renderLightReactions(p)}
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
                    if (v.mode === "timer") { updateById(p.id, { wait: null }); updateSeg(p.id, 0, { stop: v.secs || 0 }); }
                    else if (v.on) { updateById(p.id, { wait: { on: v.on, at: v.at, mode: v.mode } }); updateSeg(p.id, 0, { stop: 0 }); }
                    else updateById(p.id, { wait: null });
                  }}
                />
              )}
              <div className="hd-poprow">
                <button className={`hd-mini${p.defense ? " on" : ""}`}
                  onClick={() => updateById(p.id, { defense: !p.defense })}>
                  {p.defense ? "✓ Auto defense" : "🛡 Auto defense"}
                </button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>holds the slot, tracks the puck goal-side</span>
              </div>
              {/* collect a loose puck at the player's standing spot */}
              {/* the unified Action panel at the player's standing/start spot */}
              {ActionSteps(p, -1)}
            </>
          )}
          {p.kind === "puck" && chainEvents(p).length > 0 && chainList(p, null)}
          {p.kind === "puck" && (
            <div className="hd-poprow">
              <button className="hd-mini" onClick={() => makePuckPile(p.id)}>
                <Icon name="puck" size={13} /> Make a pile
              </button>
              <span style={{ fontSize: 11, color: "#8b99a8" }}>scatters a few loose pucks here</span>
            </div>
          )}
          {p.kind === "puck" && pieces.some(q => q.kind === "player") && (
            <>
              <div className="hd-poprow">
                <span>On stick of</span>
                {pieces.filter(q => q.kind === "player").map(pl => (
                  <button key={pl.id} className={`hd-mini${p.carrier === pl.id ? " on" : ""}`}
                    onClick={() => updateById(p.id, { carrier: p.carrier === pl.id ? null : pl.id })}>
                    {nameOf(pl.id)}
                  </button>
                ))}
              </div>
              {p.carrier && p.path.length > 0 && (
                <div className="hd-poprow" style={{ fontSize: 11.5, color: "#8b99a8" }}>
                  Rides the blade, releases when the carrier reaches the puck's
                  spot (dashed ring), then runs its own route.
                </div>
              )}
              {(() => {
                // a route-less carrier hosts its chain on the player popup, so
                // point the user there rather than duplicating it here
                const head = p.carrier || (p.pickup && p.pickup.to);
                const hp = head && pieces.find(q => q.id === head && q.kind === "player");
                if (!hp || hp.path.length) return null;
                return (
                  <div className="hd-poprow" style={{ fontSize: 11.5, color: "#8b99a8" }}>
                    {hp.id} has no route — set its pass / shoot / rebound from the
                    {hp.id} player popup.
                  </div>
                );
              })()}
            </>
          )}
          {(p.kind === "player" || p.kind === "puck") && (
            <div className="hd-poprow">
              <span>Speed ×{(p.speed || 1).toFixed(2)}</span>
              <input type="range" min={0.5} max={2} step={0.05} value={p.speed || 1} style={{ flex: 1, minWidth: 80 }}
                onChange={e => updateById(p.id, { speed: parseFloat(e.target.value) })} />
            </div>
          )}
          {p.kind !== "player" && p.path.length > 0 && (
            <div className="hd-poprow">
              <span>Start delay</span>
              <Stepper value={p.path[0].stop || 0} onChange={v => updateSeg(p.id, 0, { stop: v })} />
            </div>
          )}
          {(p.kind === "player" || p.kind === "puck") && !p.defense && (
            <div className="hd-poprow">
              <span>{p.path.length ? "Extend route" : "Add route"}</span>
              {curveButtons(t => addSegment(p.id, t), () => drawRouteMode(p.id))}
              <span style={{ fontSize: 11, color: "#8b99a8" }}>a waypoint, or draw freehand</span>
            </div>
          )}
          {p.kind !== "player" && p.kind !== "label" && (
            <div className="hd-poprow">
              <span>Name</span>
              <input className="hd-input" style={{ flex: 1, minWidth: 90 }} value={p.label || ""} placeholder={p.id}
                onChange={e => updateById(p.id, { label: e.target.value.replace(/[\s,]+/g, "_") })} />
            </div>
          )}
          {p.group && (
            <div className="hd-poprow">
              <span>◇ {p.group}</span>
              <button className="hd-mini" title="Select the whole group"
                onClick={() => { setPopup(null); setSelectedId(null); setMultiSel(groupMembers(p.group)); }}>Select group</button>
              <button className="hd-mini" title="Remove this piece from the group"
                onClick={() => updateById(p.id, { group: undefined })}>Leave</button>
            </div>
          )}
          <div className="hd-poprow">
            {p.path.length > 0 && (
              <button className="hd-mini" onClick={() => { updateById(p.id, { path: [] }); setPopup(null); }}>Clear route</button>
            )}
            <button className="hd-mini" onClick={() => duplicatePiece(p.id)}><Icon name="duplicate" size={15} /> Duplicate</button>
            <button className="hd-mini danger" onClick={() => deletePiece(p.id)}>
              <Icon name="trash" size={15} /> Delete
            </button>
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
        <div className="hd-poprow">
          <button className="hd-mini" onClick={() => addPointAt(p.id, popup.seg, popup.pt, fork)}>
            ＋ Add point here
          </button>
        </div>
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
      title = fork ? `Reaction · waypoint ${i + 1} of ${route.length}` : `Waypoint ${i + 1} of ${route.length}`;
      // Prev at waypoint 0: a fork steps back to its branch (the base route's end);
      // a base route steps back to the player/start popup.
      const branchNav = () => p.path.length ? { type: "point", id: p.id, seg: p.path.length - 1 } : { type: "piece", id: p.id };
      const goSeg = j => navPopup(j < 0 ? (fork ? branchNav() : { type: "piece", id: p.id })
        : { type: "point", id: p.id, seg: j, ...(fork ? { fork } : {}) });
      body = (
        <>
          {route.length > 0 && (
            <div className="hd-poprow">
              <button className="hd-mini" onClick={() => goSeg(i - 1)}>‹ {fork && i === 0 ? "Branch" : "Prev"}</button>
              <span style={{ fontSize: 11, color: "#8b99a8" }}>{i + 1} / {route.length}</span>
              <button className="hd-mini" disabled={i >= route.length - 1} style={{ opacity: i >= route.length - 1 ? 0.4 : 1 }}
                onClick={() => goSeg(i + 1)}>Next ›</button>
            </div>
          )}
          {/* the branch waypoint carries the reaction controls: the base route's end
              (light reactions), or a SKATE reaction's end (chain another reaction) */}
          {p.kind === "player" && i === route.length - 1 && (!fork
            ? renderLightReactions(p, null)
            : (forkAt(p, fork)?.action || "skate") === "skate" ? renderLightReactions(p, fork) : null)}
          <div className="hd-poprow">
            <span>Note</span>
            <input className="hd-input" style={{ flex: 1, minWidth: 90 }}
              value={s.desc != null ? s.desc : (s.name || "")}
              placeholder={zoneAt(s.x, s.y) || "describe this spot"}
              onChange={e => uSeg(i, { desc: e.target.value || undefined, name: undefined })} />
          </div>
          {(s.desc != null ? s.desc : s.name) && (
            <div className="hd-poprow">
              <span>Show as</span>
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
          )}
          {s.dmode === "label" && (s.desc != null ? s.desc : s.name) && (
            <div className="hd-poprow">
              <span>Label size</span>
              <Stepper value={+(s.dsize || 1).toFixed(2)} onChange={v => uSeg(i, { dsize: Math.max(0.4, v) })} step={0.2} min={0.4} suffix="×" />
              <span style={{ fontSize: 11, color: "#8b99a8" }}>drag it to move</span>
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
                    if (v.mode === "timer") uSeg(i + 1, { waitOn: null, stop: v.secs || 0 });
                    else if (v.on) uSeg(i + 1, { waitOn: { on: v.on, at: v.at, mode: v.mode }, stop: 0 });
                    else uSeg(i + 1, { waitOn: null });
                  }}
                />
              ) : (
                <div className="hd-poprow">
                  <span>Pause here for</span>
                  <Stepper value={next.stop || 0} onChange={v => uSeg(i + 1, { stop: v })} />
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>seconds</span>
                </div>
              )}
              {p.kind === "player" && (
                <div className="hd-poprow">
                  <button className={`hd-mini${next.jump ? " on" : ""}`}
                    onClick={() => uSeg(i + 1, { jump: !next.jump })}>
                    <Icon name={next.jump ? "check" : "sauce"} size={15} /> Jump here
                  </button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>hops as they pass this spot</span>
                </div>
              )}
              <div className="hd-poprow">
                <span>Speed after ×{(next.rate || 1).toFixed(2)}</span>
                <input type="range" min={0.5} max={2} step={0.05} value={next.rate || 1} style={{ flex: 1, minWidth: 70 }}
                  onChange={e => uSeg(i + 1, { rate: parseFloat(e.target.value) })} />
              </div>
              <div className="hd-poprow">
                <span>Next leg</span>
                {[["L", "segLine", "Straight"], ["Q", "segQuad", "Curve"], ["C", "segCubic", "S-curve"]].map(([t, ic, lbl]) => (
                  <button key={t} className={`hd-mini${next.type === t ? " on" : ""}`} title={lbl}
                    onClick={() => changeSegType(p.id, i + 1, t, fork)}><Icon name={ic} /></button>
                ))}
              </div>
              {/* point type — only when both adjoining legs are curves (there's a
                  handle on each side to link). Corner = independent handles;
                  Smooth = handles kept collinear (auto-smooths); Sym = collinear + equal */}
              {s.type !== "L" && next.type !== "L" && (
                <div className="hd-poprow">
                  <span>Point</span>
                  {[["corner", "ptCorner", "Corner — independent handles"],
                    ["smooth", "ptSmooth", "Smooth — linked handles, auto-smooths"],
                    ["sym", "ptSym", "Symmetric — linked, equal-length handles"]].map(([j, ic, lbl]) => (
                    <button key={j} className={`hd-mini${(s.join || "corner") === j ? " on" : ""}`} title={lbl}
                      onClick={() => setJoint(p.id, i, j, fork)}><Icon name={ic} /></button>
                  ))}
                </div>
              )}
              {p.kind === "player" && (
                <div className="hd-poprow">
                  <span>Then skate</span>
                  <button className={`hd-mini${(next.dir || "fwd") === "fwd" ? " on" : ""}`}
                    onClick={() => uSeg(i + 1, { dir: "fwd" })}>Fwd</button>
                  <button className={`hd-mini${next.dir === "bwd" ? " on" : ""}`}
                    onClick={() => uSeg(i + 1, { dir: "bwd" })}>Bwd</button>
                </div>
              )}
              {p.kind === "puck" && (
                <div className="hd-poprow">
                  <span>Then</span>
                  {["carry", "pass", "shot"].map(m => (
                    <button key={m} className={`hd-mini${(next.mode || "carry") === m ? " on" : ""}`}
                      onClick={() => uSeg(i + 1, { mode: m })}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (p.kind === "player" || p.kind === "puck") && !p.defense ? (
            <div className="hd-poprow">
              <span>Extend {fork ? "reaction" : "route"}</span>
              {curveButtons(t => addSegment(p.id, t, fork), () => drawRouteMode(p.id, fork))}
              <span style={{ fontSize: 11, color: "#8b99a8" }}>a waypoint, or draw freehand</span>
            </div>
          ) : (
            <div className="hd-poprow" style={{ color: "#8b99a8", fontSize: 12 }}>End of {fork ? "reaction" : "route"}</div>
          )}
          {/* route end: mark that the player stops here → a ‖ stop mark replaces
              the direction arrowhead (skating-diagram convention) */}
          {!next && p.kind === "player" && !fork && (
            <div className="hd-poprow">
              <button className={`hd-mini${s.endStop ? " on" : ""}`}
                onClick={() => uSeg(i, { endStop: s.endStop ? undefined : true })}>
                {s.endStop ? "✓ Stops here" : "Stops here"}
              </button>
              <span style={{ fontSize: 11, color: "#8b99a8" }}>ends with a ‖ stop mark, not an arrow</span>
            </div>
          )}
          {p.kind === "player" && !fork && ActionSteps(p, i)}
          <div className="hd-poprow">
            <button className="hd-mini danger" onClick={() => deleteSeg(p.id, i, fork)}>Delete point</button>
          </div>
        </>
      );
    }

    // a positioned popup keeps its own px spot, so a briefly off-screen anchor
    // (e.g. a far waypoint during Prev/Next) must not blank it out
    const a = popoutAnchor(anchorPt) || (popPos ? { lx: 50, ty: 50 } : null);
    if (!a) return null;
    // EVERY popup pins to the edge OPPOSITE the item it belongs to so it opens
    // completely clear of what's being selected/edited (and its handles) — no
    // need to move or minimize just to see the item. Item in the top half →
    // popup pins along the bottom (above the play bar); item in the bottom half →
    // pins along the top (below the floating play dock). All popups carry a
    // minimize (header only) + maximize (fill the height) control, and drag the
    // header to move it (bounded — it can't leave the screen).
    const collapsed = popState === "min";
    const maxed = popState === "max";
    const lx = Math.max(16, Math.min(84, a.lx));
    const atBottom = a.ty < 50;
    const common = { left: `${lx}%`, transform: `translateX(-50%) translate(${popOff.x}px, ${popOff.y}px)` };
    const style = atBottom
      ? { ...common, bottom: `calc(var(--hd-b) + 60px)`,
          maxHeight: collapsed ? "none"
            : maxed ? "calc(100% - var(--hd-b) - 60px - env(safe-area-inset-top) - var(--hd-pintop, 78px))"
            : "38%" }
      : { ...common, top: `calc(env(safe-area-inset-top) + var(--hd-pintop, 78px))`,
          maxHeight: collapsed ? "none"
            : maxed ? "calc(100% - env(safe-area-inset-top) - var(--hd-pintop, 78px) - var(--hd-b) - 60px)"
            : "38%" };
    // layer explicit position (popPos) and size (popDim) over the anchor style —
    // they're independent, so a placed/frozen popup can still carry the user's
    // resize, and an auto-height (popDim.h == null) freeze grows to fit content
    const finalStyle = { ...style };
    if (!collapsed && popPos) {
      finalStyle.left = `${popPos.left}px`;
      finalStyle.top = `${popPos.top}px`;
      finalStyle.bottom = "auto";
      finalStyle.transform = `translate(${popOff.x}px, ${popOff.y}px)`;   // px position: no centering
    }
    if (!collapsed && popDim) {
      finalStyle.width = `${popDim.w}px`;
      if (popDim.h != null) { finalStyle.height = `${popDim.h}px`; finalStyle.maxHeight = "none"; }
    }
    const boxed = !collapsed && (popPos || popDim);
    const usePreset = () => { setPopPos(null); setPopDim(null); };   // presets re-anchor at default size
    return (
      <div className="hd-pop pinned" style={finalStyle} ref={popRef}
        onScroll={syncPopScroll} onPointerDown={e => e.stopPropagation()}>
        {/* always-visible scrollbar thumb: sticky rail pinned to the viewport
            top, thumb positioned/sized imperatively in syncPopScroll */}
        <div className="hd-sbrail" aria-hidden="true"><div className="hd-sbthumb" ref={sbThumbRef} /></div>
        <div className="hd-pophead"
          onPointerDown={popDragStart} onPointerMove={popDragMove}
          onPointerUp={popDragEnd} onPointerCancel={popDragEnd}>
          <span className="hd-grip"><Icon name="grip" size={14} /></span>
          <span className="hd-poptitle">{title}</span>
          {!collapsed && (
            <button className="hd-x" onPointerDown={e => e.stopPropagation()} title="Minimize"
              onClick={() => { usePreset(); setPopState("min"); }}><Icon name="chevronUp" size={15} /></button>
          )}
          <button className="hd-x" onPointerDown={e => e.stopPropagation()} title={maxed ? "Restore" : "Maximize"}
            onClick={() => { usePreset(); setPopState(maxed && !boxed ? "mid" : collapsed ? "mid" : "max"); }}>
            <Icon name={collapsed ? "chevronDown" : (maxed && !boxed) ? "restore" : "expand"} size={15} /></button>
          <button className="hd-x" onPointerDown={e => e.stopPropagation()}
            onClick={() => setPopup(null)}><Icon name="close" size={15} /></button>
        </div>
        {!collapsed && body}
        {!collapsed && (
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
  function puckPathNodes(flat) {
    if (!showPuckPaths) return null;
    const W = w => (flat ? w : sw(w));
    const D = d => (flat ? d : sdash(d));
    const ve = flat ? undefined : "non-scaling-stroke";
    const { plans } = getIntentPlan();   // draw the shot's intent (on net), not a realistic miss
    const z = 1 / (view.s || 1);
    return pieces
      .filter(q => q.kind === "puck" && plans[q.id])
      .map(q => plans[q.id].legs.map((L, k, legs) => {
        if (L.type !== "fly") return null;
        const nxt = legs[k + 1];
        const runEnd = !nxt || nxt.type !== "fly";   // last fly leg of a pass/shot/rim/chip run
        const dx = L.x1 - L.x0, dy = L.y1 - L.y0;
        // a shot's grey path points AT the net but stops short of it (the arrow
        // sits just in front of the goal, not buried in the cage)
        const len = Math.hypot(dx, dy) || 1;
        const gap = L.shot && runEnd ? 4.5 : 0;
        const ex = L.x1 - (dx / len) * gap, ey = L.y1 - (dy / len) * gap;
        return (
          <g key={`pf-${q.id}-${k}`} pointerEvents="none" opacity={0.62}>
            <line x1={L.x0} y1={L.y0} x2={ex} y2={ey} vectorEffect={ve}
              stroke="#14171a" strokeWidth={W(L.shot ? 1.1 : 0.55)}
              strokeDasharray={L.shot ? undefined : D("2.4 1.8")} />
            {runEnd && (dx || dy) && (flat
              ? <circle cx={ex} cy={ey} r={1.1} fill="none" vectorEffect={ve} stroke="#14171a" strokeWidth={W(0.3)} />
              : (() => { const fx = iconXf({ x: ex, y: ey, a: (Math.atan2(dy, dx) * 180) / Math.PI });
                  return <g transform={fx.t}><g transform={`scale(${z})`}>
                    {L.shot
                      // double chevron ">>" for a shot
                      ? <path d="M -3.4 -2.2 L 0 0 L -3.4 2.2 M -6.8 -2.2 L -3.4 0 L -6.8 2.2" fill="none" stroke="#14171a" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
                      : <path d="M 0 0 L -3.6 -2.1 L -3.6 2.1 Z" fill="#14171a" stroke="#14171a" strokeWidth={0.5} strokeLinejoin="round" />}
                  </g></g>; })())}
          </g>
        );
      }));
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
              const style = segStroke(p, s, i === p.path.length - 1, true);
              return p.kind === "player" && s.dir === "bwd"
                ? <polyline key={`${p.id}${i}`} points={zigzagPoints(from, s)} {...style} strokeLinejoin="round" />
                : <path key={`${p.id}${i}`} d={d} {...style} />;
            });
          })}
          {pieces.map(p => <g key={`ls${p.id}`}>{renderStops(p, 1)}</g>)}
          {drawPreview && drawPreview.length > 1 && (
            <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")}
              fill="none" stroke="#ffd447" strokeWidth={0.6} strokeDasharray="1.4 1" opacity={0.9} />
          )}
          {puckPathNodes(true)}
          {selected && renderHandles(selected, 1)}
          {renderMarkHandles(1)}
          {selected && renderRotateHandle(selected, 1)}
          {pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p, true, 1)}</g>)}
          {pieces.filter(p => p.kind !== "label" && p.kind !== "mark").map(p => {
            const dp = displayPos(p);
            return (
              <PieceIcon key={`lp${p.id}`} p={p} pos={dp} thDeg={(dp.a || 0) + screenRot}
                selected={p.id === selectedId} dim={animT > 0} onDown={() => {}} swing={displaySwing(p)} />
            );
          })}
          {/* labels are their own kind — render them as text, not the player fallback */}
          {pieces.filter(p => p.kind === "label" && p.text).map(p =>
            labelNode(`lp-lbl-${p.id}`, p.x, p.y, p.text, p.size, p.color, p.id === selectedId, null, null))}
          <circle cx={loupe.x} cy={loupe.y} r={1.1} fill="none" stroke="#d7263d" strokeWidth={0.25} />
          <line x1={loupe.x - 2} y1={loupe.y} x2={loupe.x + 2} y2={loupe.y} stroke="#d7263d" strokeWidth={0.18} />
          <line x1={loupe.x} y1={loupe.y - 2} x2={loupe.x} y2={loupe.y + 2} stroke="#d7263d" strokeWidth={0.18} />
          </g>
        </svg>
      </div>
    );
  }

  const toolHint =
    editingFork && tool === "select"
      ? `Editing the reaction — drag waypoints · tap the line to add · “✓ Editing” to finish`
      : tool === "draw" && forkDrawColor
      ? `Drawing the reaction — drag from the route's end`
      : tool === "draw"
      ? (selected ? `Drawing ${selected.id}'s route — drag across the ice` : "Drag on the ice — creates a player")
      : tool === "marker" ? "Marker — drag on the ice to draw"
      : tool !== "select" ? "Tap the ice to place" : null;

  const mbtn = { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 34, height: 34,
    padding: "0 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)",
    color: "#eaf0f6", fontSize: 14, fontWeight: 700, cursor: "pointer" };

  const togglePlay = () => { if (animT >= 1) resetAnim(); if (!playing && animT === 0) setPlaySeed(s => s + 1); setPopup(null); setOpenMenu(null); setHoldStep(null); setPlacingStep(null); holdRef.current = 0; setPlaying(p => !p); };
  const resetPlay = () => { setPlaying(false); resetAnim(); };

  // during playback the "Routes on play" setting controls what stays visible;
  // while editing everything shows regardless
  const showRoutes = !aiPlay && (editing || playRoutes !== "hide");   // player route lines + stops
  const showPuckPaths = !aiPlay && (editing || playRoutes === "all"); // planned pass / shot lines

  return (
    <div className={`hd-root${aiPlay ? "" : " scrub-on"}`} ref={rootRef}>
      <style>{STYLES}</style>

      {/* ---------- the ice, filling the screen ---------- */}
      <div className="hd-stage" ref={stageRef}>
        <div className="hd-canvas" style={{ width: canvasW, height: canvasH }}>
          <svg ref={svgRef} className="hd-ice"
            viewBox={rotated ? `0 0 ${vhF} ${vwF}` : vb(rink)}
            preserveAspectRatio="none"
            onPointerDown={onSvgDown} onPointerMove={onSvgMove}
            onPointerUp={onSvgUp} onPointerCancel={onSvgUp}>
            <defs>
              <clipPath id="boards"><rect x={0.5} y={0.5} width={199} height={84} rx={27.5} ry={27.5 * yFix} /></clipPath>
            </defs>

            <g transform={zoomXf}>
            <g ref={sceneRef} transform={sceneTransform}>
            <RinkMarkings yFix={yFix} />

            {/* freehand marker annotations sit on the ice, under the drill */}
            {pieces.filter(p => p.kind === "mark").map(m => renderMark(m, true))}

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
                {[{ x: 17, y: 42.5, a: 0 }, { x: 183, y: 42.5, a: 180 }].map((n, i) => {
                  const fx = iconXf(n);
                  return <PieceIcon key={`ainet-${i}`} p={{ kind: "net", color: "#c81e33" }}
                    pos={n} xf={fx.t} thDeg={fx.th} onDown={() => {}} />;
                })}
                {aiRef.current.goalies.map((gl, i) => {
                  const fx = iconXf({ x: gl.x, y: gl.y, a: gl.a });
                  const col = "#2f9e57", dark = "#1d2126";
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
                  <g transform={fx.t}><circle cx={0} cy={0} r={1.5} fill="#14171a" stroke="#fff" strokeWidth={0.4} /></g>); })()}
                {aiRef.current.players.map(pl => {
                  const dp = { x: pl.x, y: pl.y, a: pl.a };
                  const fx = iconXf(dp);
                  return (
                    <g key={`aip-${pl.id}`} opacity={pl.stun > 0 ? 0.4 : 1}>
                      <PieceIcon p={{ kind: "player", color: pl.color, hand: "R", label: "" }}
                        pos={dp} xf={fx.t} thDeg={fx.th} onDown={() => {}} />
                    </g>
                  );
                })}
              </g>
            )}


            {!aiPlay && pieces.map(p => {
              const rd = showRoutes ? routeDetour(p) : null;   // arc detour around a crossed net
              const bent = rd && rd.pts;
              const carry = p.kind === "player" ? carrySegs(p) : null;   // segments skated with the puck
              const acts = showRoutes && p.kind === "player" ? actionWaypoints(p) : new Map();
              let prev = { x: p.x, y: p.y };
              return (
                <g key={`rt-${p.id}`}>
                  {p.path.map((s, i) => {
                    const d = segD(prev, s);
                    const from = prev;
                    prev = { x: s.x, y: s.y };
                    const isLast = i === p.path.length - 1;
                    const style = segStroke(p, s, isLast);
                    // line style: zigzag skating backward · wiggle with the puck ·
                    // straight otherwise (hockey diagram convention)
                    const bwd = p.kind === "player" && s.dir === "bwd";
                    const wig = !bwd && carry && carry.has(i);
                    // the VISIBLE line leaves a gap at the player start and around any
                    // action badge (before this waypoint / after the previous one);
                    // the ref path + hit area below still use the full segment
                    const startGap = i === 0 && p.kind === "player" ? ROUTE_START_GAP : acts.has(i - 1) ? ACT_GAP : 0;
                    const endGap = acts.has(i) ? ACT_GAP : 0;
                    let vFrom = from, vSeg = s;
                    if (startGap) { const t = trimSegStart(vFrom, vSeg, startGap); if (t) { vFrom = t.from; vSeg = t.seg; } }
                    if (endGap) { const t = trimSegEnd(vFrom, vSeg, endGap); if (t) vSeg = t.seg; }
                    const vD = (startGap || endGap) ? segD(vFrom, vSeg) : d;
                    return (
                      <g key={`${p.id}/${i}`}>
                        {/* invisible ref path is always present — timing measures it */}
                        <path d={d} fill="none" stroke="none"
                          ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />
                        {showRoutes && !bent && (bwd
                          ? <polyline points={zigzagPoints(vFrom, vSeg, strokeAR)} {...style} strokeLinejoin="round" pointerEvents="none" />
                          : wig
                          ? <polyline points={wigglePoints(vFrom, vSeg, strokeAR, isLast || acts.has(i))} {...style} strokeLinejoin="round" pointerEvents="none" />
                          : <path d={vD} {...style} pointerEvents="none" />)}
                        {showRoutes && (
                          <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                            onPointerDown={e => lineDown(e, p.id, i)} style={{ cursor: "pointer" }} />
                        )}
                      </g>
                    );
                  })}
                  {bent && (
                    <polyline points={(p.kind === "player" ? trimPolyStart(bent, ROUTE_START_GAP) : bent).map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(" ")}
                      {...segStroke(p, p.path[p.path.length - 1] || {}, false)}
                      strokeLinejoin="round" pointerEvents="none" />
                  )}
                  {/* arrow + action badges last so they sit ON TOP of the line */}
                  {showRoutes && p.path.length > 0 && renderArrow(p, bent, acts)}
                  {showRoutes && renderActionMarks(p, bent, acts)}
                </g>
              );
            })}

            {/* light-reaction forks: invisible ref paths so timing can measure the
                spliced fork segments, plus visible tinted guide lines (the chosen
                reaction solid, the others dashed/faint) */}
            {!aiPlay && effPieces.map(p => {
              const rawP = pieces.find(q => q.id === p.id);
              const baseLen = rawP && rawP.path ? rawP.path.length : 0;
              if (!p.path || p.path.length <= baseLen) return null;
              let prev = baseLen ? { x: p.path[baseLen - 1].x, y: p.path[baseLen - 1].y } : { x: p.x, y: p.y };
              return (
                <g key={`fkm-${p.id}`}>
                  {p.path.slice(baseLen).map((s, k) => {
                    const i = baseLen + k, d = segD(prev, s);
                    prev = { x: s.x, y: s.y };
                    return <path key={i} d={d} fill="none" stroke="none"
                      ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />;
                  })}
                </g>
              );
            })}
            {showRoutes && !aiPlay && pieces.map(p => {
              if (p.kind !== "player" || !(p.forks || []).length) return null;
              const chosen = chosenForkRefs(p);
              // draw each reaction from where it forks; recurse into nested reactions
              // (a skate reaction's end) so a whole chained tree renders
              const renderLevel = (forks, origin, prefix) => (forks || []).map(f => {
                if (!f.path || !f.path.length) return null;
                const ref = prefix ? prefix + "/" + f.color : f.color;
                const editThis = editingFork && editingFork.id === p.id && forkEq(editingFork.color, ref);
                const active = chosen.has(String(ref).toLowerCase());
                const end = f.path[f.path.length - 1];
                let prev = origin;
                return (
                  <g key={ref}>
                    {f.path.map((s, i) => {
                      const d = segD(prev, s);
                      prev = { x: s.x, y: s.y };
                      return (
                        <g key={i}>
                          <path d={d} fill="none" stroke={f.color}
                            strokeWidth={sw(editThis || active ? 0.55 : 0.42)} vectorEffect="non-scaling-stroke"
                            strokeDasharray={editThis || active ? undefined : sdash("1.6 1.1")}
                            strokeLinecap="round" strokeLinejoin="round"
                            opacity={editThis ? 1 : active ? 0.95 : 0.5} pointerEvents="none" />
                          {editing && !playing && (
                            <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                              onPointerDown={e => lineDown(e, p.id, i, ref)} style={{ cursor: "pointer" }} />
                          )}
                        </g>
                      );
                    })}
                    {(f.action || "skate") === "skate" ? renderLevel(f.forks, { x: end.x, y: end.y }, ref) : null}
                  </g>
                );
              });
              return <g key={`fkv-${p.id}`}>{renderLevel(p.forks, branchPoint(p), "")}</g>;
            })}

            {showRoutes && pieces.map(p => <g key={`s-${p.id}`}>{renderStops(p)}</g>)}

            {editing && pieces.map(p =>
              p.kind === "puck" && p.carrier && p.path.length > 0
                ? hdot(p.x, p.y, 2.1, { key: `rel-${p.id}`, fill: "none", stroke: "#14171a",
                    strokeWidth: 0.35, strokeDasharray: "0.9 0.7", opacity: 0.6, pointerEvents: "none" })
                : null
            )}

            {puckPathNodes(false)}

            {drawPreview && drawPreview.length > 1 && (
              tool === "marker"
                ? <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={markColor}
                    strokeWidth={markWidth} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} pointerEvents="none" />
                : <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")} vectorEffect="non-scaling-stroke"
                    fill="none" stroke="#ffd447" strokeWidth={sw(0.6)} strokeDasharray={sdash("1.4 1")} opacity={0.9} />
            )}

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

            {pieces.map(p => (
              <g key={`h-${p.id}`}>
                {renderHandles(p)}
                {/* a reaction fork open for editing gets its own handles */}
                {editingFork && editingFork.id === p.id && forkOf(p, editingFork.color)
                  ? renderHandles(p, yFix, editingFork.color) : null}
              </g>
            ))}
            {renderMarkHandles()}

            {/* nets sit on the ice (bottom); players paint above pucks so a
               carried puck can't steal the grab; rotate ring is drawn last. A
               puck IN the net (a goal) sinks below the cage (rank −1). */}
            {!aiPlay && [
                ...pieces.filter(p => p.kind !== "label" && p.kind !== "mark"),
                // goalies ride at rank 0.5 — above their net + drawn crease, below the action
                ...pieces.filter(q => (q.kind === "net" || q.kind === "tire") && q.goalie).map(n => ({ goalieOf: n })),
              ]
              .sort((a, b) => {
                const goalE = animT <= 0 ? 0 : animT * totalTime;
                const rank = p => (p.goalieOf ? 0.5
                  : p.kind === "puck" && puckInGoal(p, goalE) ? -1
                  : p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || p.kind === "tire" || p.kind === "stick" || p.kind === "light" ? 0 : p.kind === "player" ? 2 : 1);
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
                      <PieceIcon p={p} pos={lp} xf={lfx.t} thDeg={lfx.th} noShadow={isJump}
                        selected={p.id === selectedId} swing={isJump ? displaySwing(p) : 0} dim={animT > 0} onDown={e => pieceDown(e, p.id)} />
                    </g>
                  </g>
                );
              }
              const fx = iconXf(dp);
              return (
                <PieceIcon key={p.id} p={p} pos={dp} xf={fx.t} thDeg={fx.th}
                  selected={p.id === selectedId} swing={displaySwing(p)}
                  dim={animT > 0} onDown={e => pieceDown(e, p.id)}
                  onStickDown={editing && tool !== "draw" && p.kind === "player" && !p.path.length
                    ? e => stickDown(e, p) : undefined} />
              );
            })}
            {selected && renderRotateHandle(selected)}
          {pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p)}</g>)}
            {!aiPlay && renderLabels()}
            {renderResultSplash()}
            </g>
            </g>
          </svg>
          {renderPopout()}
          {renderLoupe()}
          {multiSel && multiSel.size > 0 && !playing && (
            <div style={{ position: "absolute", left: "50%", bottom: "calc(74px + env(safe-area-inset-bottom))",
              transform: "translateX(-50%)", zIndex: 48, display: "flex", alignItems: "center", justifyContent: "center",
              flexWrap: "wrap", gap: 5, maxWidth: "calc(100vw - 16px)", boxSizing: "border-box",
              padding: "7px 9px", background: "rgba(20,24,30,0.94)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 16, boxShadow: "0 6px 22px rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
              <span style={{ color: "#cdd6df", fontSize: 12, fontWeight: 700, padding: "0 4px", whiteSpace: "nowrap" }}>
                {selGroupName() ? `◇ ${selGroupName()}` : `${multiSel.size} selected`}
              </span>
              <button style={mbtn} onClick={() => rotateGroup(-15)} title="Rotate left 15°"><Icon name="rotateCcw" /></button>
              <button style={mbtn} onClick={() => rotateGroup(15)} title="Rotate right 15°"><Icon name="rotateCw" /></button>
              <button style={{ ...mbtn, fontSize: 12 }} onClick={() => rotateGroup(90)} title="Rotate 90°">90°</button>
              <button style={mbtn} onClick={duplicateGroup} title="Duplicate the selection"><Icon name="duplicate" /></button>
              {/* named-group controls: name the selection, or ungroup it */}
              {groupInput != null ? (
                <>
                  <input autoFocus value={groupInput} onChange={e => setGroupInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { createGroup(groupInput); setGroupInput(null); } if (e.key === "Escape") setGroupInput(null); }}
                    placeholder="group name" style={{ width: 96, padding: "5px 7px", fontSize: 12, borderRadius: 7, border: "1px solid #33404f", background: "#0f141a", color: "#e8edf2" }} />
                  <button style={{ ...mbtn, color: "#7fe0a3" }} title="Create group"
                    onClick={() => { createGroup(groupInput); setGroupInput(null); }}><Icon name="check" size={15} /></button>
                </>
              ) : selGroupName() ? (
                <button style={{ ...mbtn, fontSize: 11.5 }} title="Ungroup" onClick={() => { ungroup(selGroupName()); }}>Ungroup</button>
              ) : (
                <button style={{ ...mbtn, fontSize: 11.5 }} title="Group the selection" onClick={() => setGroupInput(selGroupName() || "")}>◇ Group</button>
              )}
              <button style={{ ...mbtn, color: "#ff7a7a", borderColor: "rgba(255,90,90,0.35)" }} onClick={deleteGroup} title="Delete the selection"><Icon name="trash" /></button>
              <button style={mbtn} onClick={() => { setMultiSel(null); setGroupInput(null); }} title="Clear selection"><Icon name="close" /></button>
            </div>
          )}
          {view.s > 1.02 && (
            <button onClick={resetView} title="Reset zoom"
              style={{ position: "absolute", top: "calc(8px + env(safe-area-inset-top))", right: 8, zIndex: 46,
                display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 40,
                font: "600 13px system-ui, sans-serif", color: "#e8edf2",
                background: "rgba(23,29,37,.92)", border: "1px solid #33404f", borderRadius: 999,
                boxShadow: "0 2px 10px rgba(0,0,0,.4)", cursor: "pointer" }}>
              ⤢ Fit · {view.s.toFixed(1)}×
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
          <button className="hd-preso-btn" onClick={() => setAiPlay(false)}>■ Stop</button>
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

      {/* ---------- draggable play dock (mobile) ---------- */}
      <div className="hd-playdock" ref={playRef} style={{
        ...(playPos ? { left: playPos.x, top: playPos.y, transform: "none" } : {}),
        ...(aiPlay || playHide ? { display: "none" } : {}),
      }}>
        <span className="hd-grip" onPointerDown={playDragStart} onPointerMove={playDragMove}
          onPointerUp={playDragEnd} onPointerCancel={playDragEnd}><Icon name="grip" size={16} /></span>
        <button className={`hd-fab small${loopMode ? " on" : ""}`} title="Loop"
          onClick={() => setLoopMode(v => !v)}><Icon name="loop" size={19} /></button>
        <button className="hd-fab small play" onClick={togglePlay}><Icon name={playing ? "pause" : "play"} size={22} /></button>
        <button className="hd-fab small" title={playing ? "Stop" : "Reset"} onClick={resetPlay}><Icon name={playing ? "stop" : "reset"} size={19} /></button>
        <button className="hd-fab small hd-playhide" title="Hide controls" onClick={hidePlayDock}><Icon name="close" size={18} /></button>
      </div>
      {/* collapsed tab: tucked to the nearest edge, tap to bring the dock back */}
      {!aiPlay && playHide && (() => {
        const { edge, cross } = playHide;
        const horiz = edge === "top" || edge === "bottom";
        const rot = { top: 0, bottom: 180, left: -90, right: 90 }[edge];
        // keep the bottom tab clear of the menu bar
        const anchor = edge === "bottom" ? { bottom: "calc(56px + var(--hd-b))" } : { [edge]: 0 };
        const pos = horiz
          ? { ...anchor, left: `clamp(30px, ${cross}px, calc(100% - 30px))`, transform: "translateX(-50%)" }
          : { ...anchor, top: `clamp(30px, ${cross}px, calc(100% - 30px))`, transform: "translateY(-50%)" };
        return (
          <button className={`hd-playtab ${edge}`} style={pos} title="Show play controls"
            onClick={() => setPlayHide(null)}>
            <Icon name="chevronDown" size={18} style={{ transform: `rotate(${rot}deg)` }} />
          </button>
        );
      })()}

      {/* ---------- timeline scrubber ---------- */}
      {!aiPlay && !holdStep && (
        <div className="hd-scrub">
          <div className="hd-scrubtrack">
            {wpTicks.map((f, k) => <span key={"w" + k} className="hd-tick wp" style={{ left: f * 100 + "%" }} />)}
            {stepTicks.map((f, k) => <span key={"s" + k} className="hd-tick step" style={{ left: f * 100 + "%" }} />)}
            <input className="hd-scrubrange" type="range" min={0} max={1} step={0.001} value={animT}
              onPointerDown={() => { if (playing) setPlaying(false); setHoldStep(null); holdRef.current = 0; }}
              onChange={e => scrubTo(+e.target.value)} />
          </div>
          <span className="hd-scrubtime">{(animT * totalTime).toFixed(1)}/{totalTime.toFixed(1)}s</span>
          <button className="hd-scrubadd" disabled={playing} onClick={addStepHere}
            title="Add a description at this point">＋ note</button>
        </div>
      )}

      {/* ---------- bottom menu bar ---------- */}
      <div className="hd-bar">
        <button className={`hd-barbtn${openMenu === "settings" ? " on" : ""}`} title="Menu"
          onClick={() => setOpenMenu(m => (m === "settings" ? null : "settings"))}><Icon name="menu" /></button>
        <button className={`hd-barbtn${openMenu === "rinkmenu" ? " on" : ""}`}
          onClick={() => setOpenMenu(m => (m === "rinkmenu" ? null : "rinkmenu"))}>
          <small>{rink === "full" ? "FULL" : rink === "half" ? "½" : "¼"}</small>
        </button>
        <button className={`hd-barbtn${tool === "draw" ? " draw-on" : openMenu === "tools" ? " on" : ""}`} title="Add / draw"
          onClick={() => setOpenMenu(m => (m === "tools" ? null : "tools"))}><Icon name="pencil" /></button>
        <button className={`hd-barbtn${openMenu === "prefs" ? " on" : ""}`} title="Settings"
          onClick={() => setOpenMenu(m => (m === "prefs" ? null : "prefs"))}><Icon name="sliders" /></button>
        <button className="hd-barbtn" title="Undo last change" disabled={!undoCount}
          onClick={undoLast} style={undoCount ? undefined : { opacity: 0.4 }}><Icon name="undo" /></button>
        <button className="hd-barbtn" title="Redo" disabled={!redoCount}
          onClick={redoLast} style={redoCount ? undefined : { opacity: 0.4 }}><Icon name="redo" /></button>
        {/* play controls live in the bar on desktop (hidden on mobile via CSS) */}
        {!aiPlay && <>
          <button className={`hd-barbtn hd-barplay${loopMode ? " on" : ""}`} title="Loop"
            onClick={() => setLoopMode(v => !v)}><Icon name="loop" /></button>
          <button className="hd-barbtn hd-barplay play" onClick={togglePlay}><Icon name={playing ? "pause" : "play"} size={19} /></button>
          <button className="hd-barbtn hd-barplay" title={playing ? "Stop" : "Reset"} onClick={resetPlay}><Icon name={playing ? "stop" : "reset"} /></button>
        </>}
        <div className="hd-barhint">{toolHint || ""}</div>
        <div className="hd-ver"><span className="hd-vernum">v{APP_VERSION}</span><span className="hd-verstamp">&nbsp;· {BUILD_STAMP}</span></div>
      </div>

      {/* ---------- menus ---------- */}
      {openMenu === "settings" && (
        <div className="hd-menu tl">
          <div className="hd-mh">Drill</div>
          <input className="hd-input" placeholder="Drill name" value={drillTitle}
            onChange={e => setDrillTitle(e.target.value)} />
          <textarea className="hd-input" style={{ minHeight: 46, resize: "vertical", fontFamily: "inherit" }}
            placeholder="Description" value={drillDesc} onChange={e => setDrillDesc(e.target.value)} spellCheck={false} />
          <button className="hd-item" onClick={() => setOpenMenu("notes")}><Icon name="keyboard" size={16} /> Notes / writeup…{drillNotes.trim() ? " ✓" : ""}</button>
          <button className="hd-item" onClick={() => setOpenMenu("inventory")}><Icon name="grid" size={16} /> Inventory / gear…</button>
          <button className="hd-item" onClick={() => { printSheet(); setOpenMenu(null); }}><Icon name="image" size={16} /> Print sheet…</button>
          <button className="hd-item" onClick={openText}><Icon name="keyboard" size={16} /> Text editor</button>
          <button className="hd-item" onClick={() => { exportTxt(); setOpenMenu(null); }}><Icon name="download" size={16} /> Export .txt</button>
          <button className="hd-item" onClick={() => { exportMd(); setOpenMenu(null); }}><Icon name="download" size={16} /> Export .md</button>
          <button className="hd-item" onClick={() => { exportImage(); setOpenMenu(null); }}><Icon name="image" size={16} /> Export image</button>
          <button className="hd-item" onClick={() => { copyMd(); setOpenMenu(null); }}><Icon name="duplicate" size={16} /> Copy markdown</button>
          <button className="hd-item" onClick={() => { previewLink(); setOpenMenu(null); }}><Icon name="share" size={16} /> Share preview link</button>
          <button className="hd-item" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Load .txt / .md</button>
          <button className="hd-item danger"
            onClick={() => {
              if (!pieces.length || window.confirm("Clear all pieces from the board?")) {
                setPlaying(false); resetAnim();
                setPieces([]); setSelectedId(null); setPopup(null); setOpenMenu(null);
              }
            }}><Icon name="trash" size={16} /> Clear all</button>
          <button className={`hd-item${showZones ? " on" : ""}`}
            onClick={() => setShowZones(s => !s)}>
            <Icon name="grid" size={16} /> Ice zones {showZones ? "(on)" : ""}
          </button>
          <button className={`hd-item${showDiag ? " on" : ""}`}
            onClick={() => { setShowDiag(s => !s); setOpenMenu(null); }}>
            <Icon name="gauge" size={16} /> Diagnostics {showDiag ? "(on)" : ""}
          </button>
          <button className="hd-item" onClick={() => setOpenMenu("prefs")}>
            <Icon name="sliders" size={16} /> App &amp; drill settings…
          </button>
          <div className="hd-mh" style={{ marginTop: 4 }}>Let AI play</div>
          <div className="hd-poprow">
            <span>5v5 for</span>
            <Stepper value={aiMins} onChange={setAiMins} step={1} min={1} suffix="m" />
            <button className="hd-mini" onClick={startAiPlay}>▶ Start</button>
          </div>
          <div className="hd-mh" style={{ marginTop: 4 }}>Presentation</div>
          <div className="hd-poprow">
            <button className={`hd-mini${presentation ? " on" : ""}`}
              onClick={() => setPresentation(v => !v)}>{presentation ? "✓ On" : "Off"}</button>
            <span>Pause</span>
            <Stepper value={presoDelay} onChange={setPresoDelay} step={0.5} min={0} />
          </div>
          <div className="hd-poprow">
            <button className={`hd-mini${minorDesc ? " on" : ""}`}
              onClick={() => setMinorDesc(v => !v)}>{minorDesc ? "✓ Minor steps" : "Minor steps"}</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>describe areas skated through</span>
          </div>
          <div className="hd-poprow">
            <button className="hd-mini" onClick={() => setOpenMenu("steps")}>✎ Edit steps</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>{drillSteps.length ? `${drillSteps.length} step${drillSteps.length > 1 ? "s" : ""} — play pauses at each` : "scrub, pause, add your own"}</span>
          </div>
          <div className="hd-note">
            Tap a piece, route point, or line for its settings.
            Double-tap a line to add a point. Drag to move; touch drags show a magnifier.
          </div>
        </div>
      )}

      {openMenu === "prefs" && (
        <div className="hd-menu tl">
          <div className="hd-mh">App &amp; drill settings</div>
          <div className="hd-poprow">
            <button className={`hd-mini${realisticShots ? " on" : ""}`}
              onClick={() => setRealisticShots(v => !v)}>{realisticShots ? "✓ Realistic shots" : "Realistic shots"}</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>random goal / post / wide / over + air — off buries flat</span>
          </div>
          <div className="hd-poprow">
            <button className={`hd-mini${showResult ? " on" : ""}`}
              onClick={() => setShowResult(v => !v)}>{showResult ? "✓ Goal splashes" : "Goal splashes"}</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>GOAL! / SAVE! / POST! calls over the net</span>
          </div>
          <div className="hd-poprow">
            <button className={`hd-mini${detailAnim ? " on" : ""}`}
              onClick={() => setDetailAnim(v => !v)}>{detailAnim ? "✓ Detailed animations" : "Detailed animations"}</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>skater stride, stick swing, puck cradle, airborne shots</span>
          </div>
          <div className="hd-poprow">
            <button className={`hd-mini${collisions ? " on" : ""}`}
              onClick={() => setCollisions(v => !v)}>{collisions ? "✓ Route avoidance" : "Route avoidance"}</button>
            <span style={{ fontSize: 11, color: "#8b99a8" }}>curve routes around nets / goalie / players</span>
          </div>
          <div className="hd-mh" style={{ marginTop: 4 }}>Routes on play</div>
          <div className="hd-poprow">
            {[["player", "Routes"], ["hide", "Hide"], ["all", "All +puck"]].map(([v, lab]) => (
              <button key={v} className={`hd-mini${playRoutes === v ? " on" : ""}`}
                onClick={() => setPlayRoutes(v)}>{lab}</button>
            ))}
          </div>
          <div className="hd-poprow" style={{ marginTop: 4 }}>
            <span>Line thickness</span>
            <Stepper value={lineScale} onChange={setLineScale} step={0.25} min={0.5} max={3} suffix="×" />
          </div>
          <div className="hd-poprow">
            <span>New player speed</span>
            <Stepper value={defaultSpeed} onChange={setDefaultSpeed} step={0.1} min={0.5} max={3} suffix="×" />
          </div>
          <div className="hd-poprow">
            <span>Loop end pause</span>
            <Stepper value={loopPause} onChange={setLoopPause} step={0.5} min={0} suffix="s" />
          </div>
          <div className="hd-mh" style={{ marginTop: 4 }}>Default drill pace</div>
          <div style={{ fontSize: 12, color: "#8b99a8" }}>
            {pace} ft/s · run {totalTime.toFixed(1)}s
            <input type="range" min={6} max={30} step={1} value={pace} style={{ width: "100%" }}
              onChange={e => setPace(parseFloat(e.target.value))} />
          </div>
          <button className={`hd-item${showAdvanced ? " on" : ""}`} style={{ marginTop: 4 }}
            onClick={() => setShowAdvanced(v => !v)}>
            <Icon name="target" size={16} /> {showAdvanced ? "▾" : "▸"} Advanced · shot odds
          </button>
          {showAdvanced && (() => {
            const pct = v => Math.round(v * 100);
            const goalPct = Math.max(0, 1 - shotOdds.post - shotOdds.wide - shotOdds.over);
            const odd = (label, key, hint) => (
              <div style={{ fontSize: 11, color: "#8b99a8", marginTop: 2 }}>
                {label} <b style={{ color: "#c8d2dc" }}>{pct(shotOdds[key])}%</b>{hint ? ` · ${hint}` : ""}
                <input type="range" min={0} max={1} step={0.05} value={shotOdds[key]} style={{ width: "100%" }}
                  onChange={e => setShotOdds(o => ({ ...o, [key]: parseFloat(e.target.value) }))} />
              </div>
            );
            return (
              <div style={{ opacity: realisticShots ? 1 : 0.5 }}>
                {!realisticShots && <div style={{ fontSize: 11, color: "#c98b3a", marginTop: 2 }}>Turn on “Realistic shots” for these to apply.</div>}
                {odd("Goalie save", "save", "else a goal on net")}
                <div className="hd-mh" style={{ marginTop: 4 }}>Empty net · miss odds</div>
                {odd("Off the post", "post")}
                {odd("Wide", "wide")}
                {odd("Over the net", "over")}
                <div style={{ fontSize: 11, color: "#8b99a8", marginTop: 2 }}>
                  Goal <b style={{ color: goalPct > 0 ? "#3ecf7a" : "#e05a5a" }}>{pct(goalPct)}%</b>
                  {goalPct > 0 ? " — the remainder" : " — misses exceed 100%"}
                </div>
                <div className="hd-mh" style={{ marginTop: 4 }}>Any shot</div>
                {odd("Airborne", "air", "sauce-style rise + shadow")}
                <div className="hd-mh" style={{ marginTop: 4 }}>Miss physics</div>
                {odd("Board / post bounce", "bounce", "speed kept per carom — lower absorbs more")}
                <button className="hd-mini" style={{ marginTop: 4 }}
                  onClick={() => setShotOdds({ save: SAVE_PROB, post: MISS_POST, wide: MISS_WIDE, over: MISS_OVER, air: SHOT_AIR_PROB, bounce: BOUNCE_REST })}>Reset to defaults</button>
              </div>
            );
          })()}
          <div className="hd-note">Preferences apply to this session and to how new pieces are added.</div>
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
          <div className="hd-toolgrid">
            {[["player", "Player"], ["playerpuck", "+ Puck"], ["puck", "Puck"], ["cone", "Cone"],
              ["net", "Net"], ["bumper", "Bumper"], ["deker", "Deker"], ["passer", "Passer"], ["tire", "Tire"], ["stick", "Stick"], ["light", "Light"]].map(([k, lbl]) => (
              <button key={k} className={`hd-tool${tool === k ? " on" : ""}`} onClick={() => { setTool(k); setOpenMenu(null); }}>
                {toolImg(k)}<span>{lbl}</span>
              </button>
            ))}
            <button className={`hd-tool${tool === "label" ? " on" : ""}`} onClick={() => { setTool("label"); setOpenMenu(null); }}>
              <span className="hd-toolglyph"><Icon name="label" size={22} /></span><span>Label</span>
            </button>
          </div>
          <button className="hd-item" onClick={() => { resetAnim(); setPlaying(false); setPopup(null); setTool("draw"); setOpenMenu(null); }}>
            <Icon name="pencil" size={16} /> Draw a route
          </button>
          <button className={`hd-item${tool === "marker" ? " on" : ""}`} onClick={() => { resetAnim(); setPlaying(false); setPopup(null); setTool("marker"); }}>
            <Icon name="marker" size={16} /> Marker — draw on the ice
          </button>
          {/* marker style/colour/thickness, shown once the marker is picked */}
          {tool === "marker" && (
            <>
              <div className="hd-poprow">
                {["#ffd447", "#d7263d", "#1f8a4c", "#3a8dff", "#e0731d", "#ffffff", "#14202b"].map(c => (
                  <div key={c} className={`hd-swatch${markColor === c ? " on" : ""}`} style={{ background: c }}
                    onClick={() => setMarkColor(c)} />
                ))}
              </div>
              <div className="hd-poprow">
                <span>Style</span>
                {[["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]].map(([s, lbl]) => (
                  <button key={s} className={`hd-mini${markStyle === s ? " on" : ""}`} onClick={() => setMarkStyle(s)}>{lbl}</button>
                ))}
              </div>
              <div className="hd-poprow">
                <span>Thickness</span>
                <input type="range" min={0.5} max={3} step={0.1} value={markWidth} style={{ flex: 1, minWidth: 80 }}
                  onChange={e => setMarkWidth(parseFloat(e.target.value))} />
              </div>
              <span style={{ fontSize: 11, color: "#8b99a8", padding: "0 2px" }}>drag on the ice to draw; tap a mark to restyle or delete</span>
            </>
          )}
          {tool !== "select" && (
            <button className="hd-item" onClick={() => { setTool("select"); setOpenMenu(null); }}><Icon name="close" size={16} /> Cancel tool</button>
          )}
        </div>
      )}

      {openMenu === "notes" && (
        <div className="hd-sheet">
          <div className="hd-mh">Coaching notes <span style={{ fontWeight: 400, color: "#8b99a8", textTransform: "none", letterSpacing: 0 }}>· markdown</span></div>
          <textarea className="hd-ta" value={drillNotes} placeholder={"# Setup\n\n1. F1 carries out of the corner\n2. **Chip** off the glass past the D\n\n- Coach cue: head up through the neutral zone"}
            onChange={e => setDrillNotes(e.target.value)} spellCheck={false} />
          {drillNotes.trim() && (
            <div className="hd-mdprev" dangerouslySetInnerHTML={{ __html: mdBlock(drillNotes) }} />
          )}
          <div className="hd-row">
            <button className="hd-btn primary" onClick={() => setOpenMenu(null)}>Done</button>
            <button className="hd-btn" onClick={() => setDrillNotes("")}>Clear</button>
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
            <div className="hd-mh">Inventory <span style={{ fontWeight: 400, color: "#8b99a8", textTransform: "none", letterSpacing: 0 }}>· what you need</span></div>
            <div className="hd-steplist">
              {rows.length === 0 ? (
                <div className="hd-note">No pieces yet. Add players, pucks, cones… and they’re counted here — or add gear below.</div>
              ) : rows.map(r => (
                <div key={(r.custom ? "c:" : "k:") + r.key} className="hd-poprow" style={{ opacity: r.hide ? 0.5 : 1 }}>
                  {r.custom
                    ? <input className="hd-input" style={{ flex: 1, minWidth: 0 }} value={r.label}
                        placeholder="Gear…" onChange={e => setCustomItem(r, { label: e.target.value })} />
                    : <span style={{ flex: 1, minWidth: 0 }}>{r.label}
                        {r.count !== r.autoCount && <span style={{ color: "#8b99a8", fontSize: 11 }}> · {r.autoCount} on ice</span>}</span>}
                  <Stepper value={r.count} min={0} step={1} suffix=""
                    onChange={n => (r.custom ? setCustomItem(r, { count: n }) : setCanonItem(r, { count: n }))} />
                  {r.custom
                    ? <button className="hd-mini" title="Remove gear row" onClick={() => setCustomItem(r, { remove: true })}>✕</button>
                    : <button className={`hd-mini${r.hide ? " on" : ""}`} title={r.hide ? "Hidden from the sheet — show it" : "Hide from the sheet (piece stays on the ice)"}
                        onClick={() => setCanonItem(r, { hide: !r.hide })}>{r.hide ? "hidden" : "hide"}</button>}
                </div>
              ))}
            </div>
            <div className="hd-row">
              <button className="hd-btn" onClick={addCustomItem}>＋ Add gear</button>
              <button className="hd-btn primary" onClick={() => setOpenMenu(null)}>Done</button>
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
          <div className="hd-row">
            <button className="hd-btn primary" onClick={applyText}>Apply</button>
            <button className="hd-btn" title="Copy text" aria-label="Copy text" onClick={copyText}><Icon name="duplicate" size={15} /></button>
            <button className="hd-btn" title="Erase text" onClick={() => setTextDraft("")}>Erase</button>
            <button className="hd-btn" title="Share drill" onClick={shareDrill}>Share</button>
            <button className="hd-btn" onClick={() => fileRef.current?.click()}>Load</button>
            <button className="hd-btn" onClick={() => setOpenMenu(null)}>Close</button>
          </div>
          <div className="hd-row" style={{ alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#8b99a8" }}>Export</span>
            <button className="hd-btn" onClick={exportTxt}>.txt</button>
            <button className="hd-btn" onClick={exportMd}>.md</button>
            <button className="hd-btn" onClick={exportImage}>Image</button>
          </div>
          <div className="hd-note">
            Feet: x 0–200, y 0–85. <b>RINK</b> full|half|quarter ·
            <b> PIECE</b> id player|puck|cone|net|bumper|deker|passer|label|tire x y [#color] [label] [speed=1.2] [hand=L] [on=F1]
            (a <b>bumper</b> is a solid barrier — players skate around it and pucks carom off it; a <b>deker</b> a stickhandling gate, a <b>passer</b> a rebounder box — all take <code>face=deg</code>)
            (a <b>tire</b> is an agility prop — <code>size=1</code> large / <code>size=0.55</code> small; add <code>goalie</code> for a keeper that works the full circle to defend shots at it)
            (a <b>label</b> is a movable/resizable text note: <code>PIECE L1 label 100 40 size=1.2 "Regroup here"</code>)
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
            re-rolls every replay.
            <code> rim=4~90*80</code> hard-rims around the
            boards and <code>chip=4~-45*30</code> chips into space; the <code>~deg</code> is the direction and
            <code>*ft</code> the distance — or just drag the on-ice <b>handle</b> at the end of the release
            to set both. Any player then uses <b>Collect puck</b> (in their popup, or at a waypoint) to
            grab the nearest loose puck at that spot. <b>Collect puck</b> defaults to <b>Nearest puck</b> —
            a live pick that re-resolves to whichever loose puck is closest each time you play or edit
            (serialized as a trailing <code>*</code>); choose a specific puck id in the dropdown to lock it.
            (The handoff forms <code>chip=4:F1</code> /
            <code>rim=4:F2</code> that carry straight to a collector still load and play.)
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
                    title="Edit when this step pops — a fixed time or a player's waypoint"
                    onClick={() => setEditAnchor(v => v === s.idx ? null : s.idx)}>{s.resolved ? s.label : "⚠ " + s.label}</button>
                  <input className="hd-input" style={{ flex: 1, minWidth: 0 }} value={s.text}
                    placeholder="Describe this beat…" autoFocus={!s.text}
                    onChange={e => setStepText(s.idx, e.target.value)} />
                  <button className={`hd-mini${s.pos ? " on" : ""}`} title="Place the caption on the ice"
                    disabled={!s.resolved} onClick={() => enterPlacing(s.idx)}>⤢</button>
                  <button className="hd-mini" title="delete step" onClick={() => deleteStep(s.idx)}>✕</button>
                </div>
                {editAnchor === s.idx && (
                  <div className="hd-anchoredit">
                    <button className={`hd-mini${s.on ? "" : " on"}`}
                      onClick={() => anchorToTime(s.idx)}>⏱ Time</button>
                    <button className={`hd-mini${s.on ? " on" : ""}`}
                      disabled={!stepPlayers.length}
                      onClick={() => anchorToWaypoint(s.idx)}>📍 Waypoint</button>
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
          <div className="hd-row">
            <button className="hd-btn" disabled={playing} onClick={addStepHere}>＋ Add here</button>
            <button className="hd-btn" onClick={generateSteps}>⚙ Generate from play</button>
          </div>
          <div className="hd-row">
            <button className="hd-btn primary" onClick={() => { setOpenMenu(null); setEditAnchor(null); }}>Done</button>
            <button className={`hd-btn${presentation ? " primary" : ""}`}
              onClick={() => setPresentation(v => !v)}>{presentation ? "Presentation on" : "Turn on"}</button>
          </div>
          <div className="hd-note">
            Scrub the timeline, pause, then “＋ Add here” drops a note — near a waypoint it
            anchors there (and tracks edits); otherwise it pins the time. Type it on the ice and
            drag it clear of the action; ⤢ re-places a caption. Tap the anchor chip to set an
            exact time in seconds, or pin the step to a player's waypoint.
            In Presentation mode, play pauses {presoDelay}s at each step (tap the ice to skip ahead).
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" style={{ display: "none" }} onChange={importTxt} />
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(64px + env(safe-area-inset-bottom))",
          transform: "translateX(-50%)", background: "rgba(20,26,32,0.92)", color: "#eaf2f8",
          padding: "6px 14px", borderRadius: 8, fontSize: 13, zIndex: 9999, pointerEvents: "none" }}>{toast}</div>
      )}
      {showDiag && <DiagPanel drillVersion={drillVersion} />}
    </div>
  );
}
