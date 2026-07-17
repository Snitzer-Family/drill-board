import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { VIEWS, COLORS, vb, APP_VERSION, ICON_SCALE, BUILD_STAMP, DEFAULT_TEXT } from "./constants.js";
import { parseDrill, serializeDrill } from "./drill-format.js";
import { clampX, clampY, segEnd, segD, nearestT, splitSeg, zigzagPoints, convertSeg, fitRoute } from "./geometry.js";
import { RinkMarkings } from "./rink.jsx";
import { PieceIcon, Stepper, DiagPanel } from "./icons.jsx";
import { createTiming } from "./timing.js";
import { STYLES } from "./styles.js";

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

   UI: the rink fills the screen. Corner controls: ☰ settings
   (text/export/load/pace), rink size, tools (+pieces / draw),
   play/reset. Tap pieces/points/lines for on-ice popouts;
   drag to move; touch drags show a magnifier loupe.
   ============================================================ */

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
  // routes shown during playback: "player" (routes only), "hide", "all" (+puck/shots)
  const [playRoutes, setPlayRoutes] = useState("player");
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

  // keep popouts fully inside the ice box: after every render, measure the
  // card against its container and pull it back in with a corrective margin
  // (margins compose with the anchor transform without fighting it)
  const popRef = useRef(null);
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
  const canvasW = Math.max(50, stageSize.w);
  const canvasH = Math.max(20, stageSize.h);
  // maps rink coords into the rotated viewBox: (x,y) -> (my+vh-y, x-mx)
  const sceneTransform = rotated ? `rotate(90) translate(${-mxF} ${-(myF + vhF)})` : undefined;
  const screenRot = rotated ? 90 : 0;
  // roundness correction: the fill-mode stretch scales the two rink axes
  // differently; circles are drawn as ellipses with ry scaled by yFix so
  // they render perfectly round on screen after the stretch
  const yFix = (() => {
    const sx = rotated ? canvasH / vwF : canvasW / vwF;
    const sy = rotated ? canvasW / vhF : canvasH / vhF;
    return sy > 0 ? Math.max(0.2, Math.min(5, sx / sy)) : 1;
  })();
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

  /* ----- timing & pass planning (see timing.js) ----- */
  const planCache = useRef({ key: null, pace: 0, sig: -1, warp: {}, plans: {}, rel: {} });
  const { getPlan, pieceTime, displayPosAt, stickSwing } = createTiming({ pieces, pace, segRefs, planCache });

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
  function displayPos(p) {
    const dp = displayPosAt(p, animT <= 0 ? 0 : animT * totalTime);
    if (p.kind !== "player" || !(dp.smul > 0.02)) return dp;
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
      id, kind, x: pt.x, y: pt.y, speed: kind === "player" ? 1.5 : 1, hand: "R", carrier: null, facing: 0, transfers: [], shotAt: null, pickup: null, net: null,
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
    const head = pk.carrier || (pk.pickup && pk.pickup.to) || null;
    return [head, ...(pk.transfers || []).map(t => t.to)].filter(Boolean);
  }
  function setTransfer(pkId, stage, tr) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).slice(0, stage);
      if (tr) ts[stage] = tr;
      return { ...q, transfers: ts, shotAt: null };
    });
  }
  function setRecvAt(pkId, trIdx, idx) {
    update(q => {
      if (q.id !== pkId) return q;
      const ts = (q.transfers || []).map((t, k) => (k === trIdx ? { ...t, recvAt: idx } : t));
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
        if (d.line == null) {
          // dragging the piece itself moves only the route's start point —
          // the piece is waypoint zero; the rest of the route stays anchored
          return { ...p, x: clampX(p.x + dx), y: clampY(p.y + dy) };
        }
        // dragging a route line slides the whole piece + route together
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

    // which net a shot aims at (default: nearest to the shooter)
    const netRow = pk => (
      <div className="hd-poprow">
        <span>Net</span>
        {[["auto", "Nearest"], ["left", "◄ Left"], ["right", "Right ►"]].map(([v, lab]) => (
          <button key={v} className={`hd-mini${(pk.net || "auto") === v ? " on" : ""}`}
            onClick={() => updateById(pk.id, { net: v === "auto" ? null : v })}>{lab}</button>
        ))}
      </div>
    );
    // pass/shoot/collect controls for player p at possession point i. Used at
    // route points (point popup) and, with i=0, in a stationary player's popup
    // (a route-less carrier releases immediately, so its "point" is just 0).
    const chainControls = (p, i) => {
      const pk = pieces.find(q => q.kind === "puck" && puckChain(q).includes(p.id));
      if (!pk) return null;
      const chain = puckChain(pk);
      const ts = pk.transfers || [];
      // resolve which POSSESSION this point belongs to: a player can hold the
      // puck several times in one chain (give-and-go), so prefer an exact match
      // on an existing action here, else the latest window that can contain it
      let stage = -1;
      for (let s = 0; s < chain.length; s++) {
        if (chain[s] !== p.id) continue;
        const out = ts[s];
        if (out && out.at === i) { stage = s; break; }
        if (!out || i <= out.at) stage = s;
      }
      if (stage < 0) return null;
      const from = ts[stage];
      const incoming = stage >= 1 ? ts[stage - 1] : null;
      const others = pieces.filter(q => q.kind === "player" && q.id !== p.id);
      const canAct = !from || from.at === i;              // release point (or unset)
      const isPass = t => from && from.kind !== "shot" && from.at === i && from.to === t;
      const isShot = t => from && from.kind === "shot" && from.at === i && from.to === t;
      return (
        <>
          {canAct && others.length > 0 && (
            <div className="hd-poprow">
              <span>Pass {pk.id} to</span>
              {others.map(o => (
                <button key={o.id} className={`hd-mini${isPass(o.id) ? " on" : ""}`}
                  onClick={() => setTransfer(pk.id, stage,
                    isPass(o.id) ? null : { at: i, to: o.id, recvAt: null, kind: "pass" })}>
                  {o.id}
                </button>
              ))}
            </div>
          )}
          {canAct && others.length > 0 && (
            <div className="hd-poprow">
              <span>Shoot, rebound to</span>
              {others.map(o => (
                <button key={o.id} className={`hd-mini${isShot(o.id) ? " on" : ""}`}
                  onClick={() => setTransfer(pk.id, stage,
                    isShot(o.id) ? null : { at: i, to: o.id, recvAt: null, kind: "shot" })}>
                  {o.id}
                </button>
              ))}
            </div>
          )}
          {stage === (pk.transfers || []).length && (
            <div className="hd-poprow">
              <button className={`hd-mini${pk.shotAt === i ? " on" : ""}`}
                onClick={() => updateById(pk.id, pk.shotAt === i ? { shotAt: null } : { shotAt: i })}>
                {pk.shotAt === i ? "✓ Shooting at net" : "🥅 Shoot at net"}
              </button>
            </div>
          )}
          {(pk.shotAt === i || (from && from.kind === "shot" && from.at === i)) && netRow(pk)}
          {incoming && (
            <div className="hd-poprow">
              <button className={`hd-mini${incoming.recvAt === i ? " on" : ""}`}
                onClick={() => setRecvAt(pk.id, stage - 1, incoming.recvAt === i ? null : i)}>
                {incoming.kind === "shot"
                  ? (incoming.recvAt === i ? "✓ Collecting rebound here" : "Collect rebound here")
                  : (incoming.recvAt === i ? "✓ Receiving here" : "Receive pass here")}
              </button>
              {incoming.recvAt === i && incoming.kind !== "shot" && p.path.length > 0 && (
                <span style={{ fontSize: 11, color: "#8b99a8" }}>
                  {pk.shotAt === i ? "one-timer — pace auto-syncs" : "pace auto-syncs"}
                </span>
              )}
            </div>
          )}
        </>
      );
    };
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
              {(() => {
                // assign a loose puck for this player to gather — works for a
                // stationary player (e.g. parked by the net for a rebound) too
                const loose = pieces.filter(q => q.kind === "puck" && !q.carrier
                  && !(q.pickup && q.pickup.to === p.id));
                if (!loose.length) return null;
                return (
                  <div className="hd-poprow">
                    <span>Pick up</span>
                    {loose.map(q => (
                      <button key={q.id} className="hd-mini"
                        onClick={() => updateById(q.id, { carrier: null,
                          pickup: { to: p.id, at: Math.max(0, p.path.length - 1) } })}>
                        {q.id}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* host the chain (pass / shoot / rebound) on the player itself
                  for a route-less player, and for any puck head so the option
                  stays put here even after a route is added (head holds from pt 0) */}
              {(p.path.length === 0
                || pieces.some(q => q.kind === "puck"
                  && (q.carrier === p.id || (q.pickup && q.pickup.to === p.id))))
                && chainControls(p, 0)}
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
            const free = pieces.filter(q => q.kind === "puck" && !q.carrier);
            if (!free.length) return null;
            return (
              <div className="hd-poprow">
                <span>Get puck</span>
                {free.map(q => {
                  const on = q.pickup && q.pickup.to === p.id && q.pickup.at === i;
                  const same = q.pickup && q.pickup.to === p.id;
                  return (
                    <button key={q.id} className={`hd-mini${on ? " on" : ""}`}
                      onClick={() => updateById(q.id, on
                        ? { pickup: null, transfers: [], shotAt: null }
                        : { pickup: { to: p.id, at: i },
                            ...(same ? {} : { transfers: [], shotAt: null }) })}>
                      {q.id}
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {p.kind === "player" && chainControls(p, i)}
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
      <div className={`hd-pop${up ? " up" : ""}`} style={style} ref={popRef}
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
          {pieces.map(p => {
            const dp = displayPos(p);
            return (
              <PieceIcon key={`lp${p.id}`} p={p} pos={dp} thDeg={(dp.a || 0) + screenRot}
                selected={p.id === selectedId} dim={animT > 0} onDown={() => {}} swing={displaySwing(p)} />
            );
          })}
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

  const togglePlay = () => { if (animT >= 1) resetAnim(); setPopup(null); setOpenMenu(null); setPlaying(p => !p); };
  const resetPlay = () => { setPlaying(false); resetAnim(); };

  // during playback the "Routes on play" setting controls what stays visible;
  // while editing everything shows regardless
  const showRoutes = editing || playRoutes !== "hide";      // player route lines + stops
  const showPuckPaths = editing || playRoutes === "all";    // planned pass / shot lines

  return (
    <div className="hd-root" ref={rootRef}>
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
              {pieces.map(p => (
                <marker key={p.id} id={`arr-${p.id}`} viewBox="0 0 10 10" refX="8" refY="5"
                  markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={p.color} />
                </marker>
              ))}
            </defs>

            <g ref={sceneRef} transform={sceneTransform}>
            <RinkMarkings yFix={yFix} />

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
                    {/* invisible ref path is always present — timing measures it */}
                    <path d={d} fill="none" stroke="none"
                      ref={el => { if (el) segRefs.current[`${p.id}/${i}`] = el; }} />
                    {showRoutes && (p.kind === "player" && s.dir === "bwd"
                      ? <polyline points={zigzagPoints(from, s)} {...style} strokeLinejoin="round" pointerEvents="none" />
                      : <path d={d} {...style} pointerEvents="none" />)}
                    {showRoutes && (
                      <path d={d} fill="none" stroke="transparent" strokeWidth={4}
                        onPointerDown={e => lineDown(e, p.id, i)} style={{ cursor: "pointer" }} />
                    )}
                  </g>
                );
              });
            })}

            {showRoutes && pieces.map(p => <g key={`s-${p.id}`}>{renderStops(p)}</g>)}

            {editing && pieces.map(p =>
              p.kind === "puck" && p.carrier && p.path.length > 0 ? (
                <circle key={`rel-${p.id}`} cx={p.x} cy={p.y} r={2.1} fill="none"
                  stroke="#14171a" strokeWidth={0.35} strokeDasharray="0.9 0.7"
                  opacity={0.6} pointerEvents="none" />
              ) : null
            )}

            {showPuckPaths && (() => {
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

            {/* players paint above pucks so a carried puck can't steal the
               player's body / stick-rotate grab; rotate ring is drawn last */}
            {[...pieces]
              .sort((a, b) => (a.kind === "player" ? 1 : 0) - (b.kind === "player" ? 1 : 0))
              .map(p => {
              const dp = displayPos(p);
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
            </g>
          </svg>
          {renderPopout()}
          {renderLoupe()}
        </div>
      </div>

      {/* ---------- draggable play dock (mobile) ---------- */}
      <div className="hd-playdock" ref={playRef}
        style={playPos ? { left: playPos.x, top: playPos.y, transform: "none" } : undefined}>
        <span className="hd-grip" onPointerDown={playDragStart} onPointerMove={playDragMove}
          onPointerUp={playDragEnd} onPointerCancel={playDragEnd}>⠿</span>
        <button className="hd-fab small play" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
        <button className="hd-fab small" onClick={resetPlay}>⟲</button>
      </div>

      {/* ---------- bottom menu bar ---------- */}
      <div className="hd-bar">
        <button className={`hd-barbtn${openMenu === "settings" ? " on" : ""}`}
          onClick={() => setOpenMenu(m => (m === "settings" ? null : "settings"))}>☰</button>
        <button className={`hd-barbtn${openMenu === "rinkmenu" ? " on" : ""}`}
          onClick={() => setOpenMenu(m => (m === "rinkmenu" ? null : "rinkmenu"))}>
          <small>{rink === "full" ? "FULL" : rink === "half" ? "½" : "¼"}</small>
        </button>
        <button className={`hd-barbtn${tool === "draw" ? " draw-on" : openMenu === "tools" ? " on" : ""}`}
          onClick={() => setOpenMenu(m => (m === "tools" ? null : "tools"))}>✎</button>
        {/* play controls live in the bar on desktop (hidden on mobile via CSS) */}
        <button className="hd-barbtn hd-barplay play" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
        <button className="hd-barbtn hd-barplay" onClick={resetPlay}>⟲</button>
        <div className="hd-barhint">{toolHint || ""}</div>
        <div className="hd-ver">v{APP_VERSION} · {BUILD_STAMP}</div>
      </div>

      {/* ---------- menus ---------- */}
      {openMenu === "settings" && (
        <div className="hd-menu tl">
          <div className="hd-mh">Drill</div>
          <button className="hd-item" onClick={openText}>⌨ Text editor</button>
          <button className="hd-item" onClick={() => { exportTxt(); setOpenMenu(null); }}>⇩ Export .txt</button>
          <button className="hd-item" onClick={() => fileRef.current?.click()}>⇧ Load .txt</button>
          <button className="hd-item danger"
            onClick={() => {
              if (!pieces.length || window.confirm("Clear all pieces from the board?")) {
                setPlaying(false); resetAnim();
                setPieces([]); setSelectedId(null); setPopup(null); setOpenMenu(null);
              }
            }}>🗑 Clear all</button>
          <button className={`hd-item${showDiag ? " on" : ""}`}
            onClick={() => { setShowDiag(s => !s); setOpenMenu(null); }}>
            ◫ Diagnostics {showDiag ? "(on)" : ""}
          </button>
          <div className="hd-mh" style={{ marginTop: 4 }}>Routes on play</div>
          <div className="hd-poprow">
            {[["player", "Routes"], ["hide", "Hide"], ["all", "All +puck"]].map(([v, lab]) => (
              <button key={v} className={`hd-mini${playRoutes === v ? " on" : ""}`}
                onClick={() => setPlayRoutes(v)}>{lab}</button>
            ))}
          </div>
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
            <code> pickup=F2@3</code> — a loose puck hops onto F2's blade at their point 3.
            <code> face=45</code> sets a stationary player's heading (degrees).
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={importTxt} />
      {showDiag && <DiagPanel />}
    </div>
  );
}
