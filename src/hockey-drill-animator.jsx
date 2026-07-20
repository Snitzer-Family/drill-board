import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { VIEWS, COLORS, vb, APP_VERSION, ICON_SCALE, BUILD_STAMP, DEFAULT_TEXT } from "./constants.js";
import { parseDrill, serializeDrill, extractDrill } from "./drill-format.js";
import { clampX, clampY, segEnd, segD, nearestT, splitSeg, zigzagPoints, convertSeg, fitRoute } from "./geometry.js";
import * as boards from "./boards.js";
import { RinkMarkings } from "./rink.jsx";
import { ZONES, zoneAt } from "./zones.js";
import { PieceIcon, Stepper, DiagPanel } from "./icons.jsx";
import { createTiming } from "./timing.js";
import { newGame, stepGame } from "./ai-game.js";
import { STYLES } from "./styles.js";

// swatch palette for on-ice text labels (dark ink first — labels sit on light ice)
const LABEL_COLORS = ["#14202b", "#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#7a3fa8"];

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
  // presentation mode: pause at each described step so viewers can read along
  const [presentation, setPresentation] = useState(false);
  const [presoDelay, setPresoDelay] = useState(2.5);   // seconds held at each step
  const [stepNotes, setStepNotes] = useState({});      // key -> hand-edited text
  const [holdStep, setHoldStep] = useState(null);      // step currently being read
  const [minorDesc, setMinorDesc] = useState(false);   // describe zones skated through
  const [showZones, setShowZones] = useState(false);   // named ice-area overlay
  const [playSeed, setPlaySeed] = useState(0);         // bumps each play → new save/goal rolls
  const [loopMode, setLoopMode] = useState(false);     // replay the routine continuously
  const [loopPause, setLoopPause] = useState(1);       // seconds held on the finished drill
  const [drillTitle, setDrillTitle] = useState(init.title || "");
  const [drillDesc, setDrillDesc] = useState(init.desc || "");
  const [toast, setToast] = useState("");
  const [aiPlay, setAiPlay] = useState(false);         // "Let AI play" 5v5 mode
  const [aiMins, setAiMins] = useState(2);             // duration in minutes
  const [, aiTick] = useState(0);                      // force re-render each sim frame
  const aiRef = useRef(null);
  const aiClockRef = useRef(0);
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
  const { getPlan, pieceTime, displayPosAt, stickSwing, waypointTime } = createTiming({ pieces, pace, segRefs, planCache, seed: playSeed });

  const totalTime = Math.max(0.1, ...pieces.map(pieceTime));
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

  // Auto-describe the play's major beats (puck events) as timed steps; the
  // text is editable and stored per-step in stepNotes.
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
            const out = leg.goal ? " — scores!" : leg.save ? " — save!" : "";
            evs.push({ t: leg.t0, key: `${pk.id}:shot:${i}`, auto: `${nameOf(leg.by)} shoots on net${out}` });
          }
          else {
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
    return steps.map(s => ({ ...s, text: stepNotes[s.key] != null ? stepNotes[s.key] : s.auto }));
  }
  const presoSteps = (presentation || openMenu === "steps") ? buildSteps() : [];
  stepsRef.current = presoSteps;
  presoDelayRef.current = presoDelay;
  presoRef.current = presentation;
  loopRef.current = loopMode;
  loopPauseRef.current = loopPause;

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

  function resetAnim() { animRef.current = 0; setAnimT(0); holdRef.current = 0; loopPendingRef.current = false; nextStepRef.current = 0; setHoldStep(null); }
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
    pucks.forEach(pk => { const d = displayPos(pk); const dist = Math.hypot(d.x - net.x, d.y - net.y); if (dist < best) { best = dist; threat = d; } });
    if (!threat) return { x: home.x, y: home.y, a: p.facing || 0 };
    const dx = threat.x - net.x, dy = threat.y - net.y;
    const dist = Math.hypot(dx, dy) || 1;
    const inFront = dx * fwd > 0;                          // puck on the ice-side of the net
    const gap = Math.max(7, Math.min(20, dist * 0.42));   // gap up with the threat, capped in the slot
    let tx, ty;
    if (inFront) { tx = net.x + (dx / dist) * gap; ty = net.y + (dy / dist) * gap; }
    else { tx = net.x + fwd * 13; ty = net.y; }           // puck behind → hold net-front
    ty = ty + (42.5 - ty) * 0.3;                          // bias to the middle of the ice
    return { x: clampX(tx), y: clampY(ty), a: (Math.atan2(threat.y - ty, threat.x - tx) * 180) / Math.PI };
  }

  function displayPos(p) {
    if (p.kind === "player" && p.defense) return animT > 0 ? dmanPos(p) : { x: p.x, y: p.y, a: p.facing || 0 };
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

  // goalie plays the angle: it slides across the front to cover the puck, comes
  // out to challenge when the puck is far, and backs to the goal line as the
  // play nears. Clamped to the net's front hemisphere so it stays in the crease.
  function goaliePos(net) {
    const f = ((net.facing || 0) * Math.PI) / 180;    // net mouth opens this way
    const e = animT <= 0 ? 0 : animT * totalTime;
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
      const dx = shot.x0 - net.x, dy = shot.y0 - net.y;
      const m = Math.hypot(dx, dy) || 1;
      const R = shot.save ? 2.5 : 2;                   // save depth matches the puck's stop point
      return { x: net.x + (dx / m) * R, y: net.y + (dy / m) * R, a: (Math.atan2(dy, dx) * 180) / Math.PI };
    }
    const pucks = pieces.filter(q => q.kind === "puck");
    let aim = { x: net.x + Math.cos(f) * 20, y: net.y + Math.sin(f) * 20 }, best = Infinity;
    pucks.forEach(pk => {
      const dp = displayPos(pk);
      const d = Math.hypot(dp.x - net.x, dp.y - net.y);
      if (d < best) { best = d; aim = dp; }
    });
    const dist = best === Infinity ? 30 : best;
    // depth: deep on the line when close, out to the top of the crease when far
    const D_NEAR = 9, D_FAR = 45, R_MIN = 0.6, R_MAX = 6;
    const u = Math.max(0, Math.min(1, (dist - D_NEAR) / (D_FAR - D_NEAR)));
    const R = R_MIN + (R_MAX - R_MIN) * (u * u * (3 - 2 * u)); // smoothstep
    // angle: track the puck aggressively, clamped so we never back into the net
    let rel = Math.atan2(aim.y - net.y, aim.x - net.x) - f;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));    // normalize to −π..π
    const MAXREL = (78 * Math.PI) / 180;
    rel = Math.max(-MAXREL, Math.min(MAXREL, rel));
    const a = f + rel;
    return { x: net.x + Math.cos(a) * R, y: net.y + Math.sin(a) * R, a: (a * 180) / Math.PI };
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
    const prefix = kind === "player" ? "P" : kind === "puck" ? "PK" : kind === "net" ? "N"
      : kind === "bumper" ? "B" : kind === "deker" ? "DK" : kind === "passer" ? "PS"
      : kind === "label" ? "L" : "C";
    let n = 1;
    while (pieces.some(p => p.id === prefix + n)) n++;
    return prefix + n;
  }

  function makePiece(kind, pt) {
    const id = nextId(kind);
    const colorIdx = pieces.filter(p => p.kind === "player").length % COLORS.length;
    return {
      id, kind, x: pt.x, y: pt.y, speed: kind === "player" ? 1.5 : 1, hand: "R", carrier: null,
      facing: kind === "net" && pt.x >= 100 ? 180 : 0, transfers: [], shotAt: null, rimAt: null, chipAt: null, chipAim: null, rimAim: null, chipDist: null, rimDist: null, pickup: null, net: null, holdLine: false, goalie: false, defense: false,
      color: kind === "player" ? COLORS[colorIdx] : kind === "cone" ? "#e0731d" : kind === "net" ? "#c81e33"
        : kind === "bumper" ? "#4d6fa6" : kind === "deker" ? "#c79a4e" : kind === "passer" ? "#57636f"
        : kind === "label" ? "#14202b" : "#14171a",
      label: kind === "player" ? id : "", text: kind === "label" ? "Label" : "", size: 1, path: [],
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
      return { ...q, transfers: ts, shotAt: null, rimAt: null, chipAt: null, rimAim: null, chipAim: null };
    });
  }
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
  function collectPuckAt(playerId, at) {
    const player = pieces.find(q => q.id === playerId);
    if (!player) return;
    const spot = at < 0 || !player.path.length ? { x: player.x, y: player.y }
      : segEnd(player, Math.min(at, player.path.length - 1));
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
      return !(released && ch[ch.length - 1] === playerId);       // can't collect your own release
    });
    if (!cands.length) { setToast("No loose puck to collect"); setTimeout(() => setToast(""), 1500); return; }
    const near = q => { const L = landing(q); return Math.hypot(L.x - spot.x, L.y - spot.y); };
    const target = cands.reduce((b, q) => (near(q) < near(b) ? q : b));
    if (target.shotAt != null || target.rimAt != null || target.chipAt != null) {
      const field = target.shotAt != null ? "shotAt" : target.rimAt != null ? "rimAt" : "chipAt";
      const kind = field === "shotAt" ? "shot" : field === "rimAt" ? "rim" : "chip";
      const aim = field === "rimAt" ? target.rimAim : field === "chipAt" ? target.chipAim : null;
      setTransfer(target.id, (target.transfers || []).length,
        { at: target[field], to: playerId, recvAt: at < 0 ? null : at, kind, ...(aim != null ? { aim } : {}) });
    } else {
      updateById(target.id, { pickup: { to: playerId, at: at < 0 ? 0 : at } });
    }
    setSelectedId(playerId);
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
      setPopup(tool === "label" ? { type: "piece", id: np.id } : null);   // labels open for text entry
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
    if (d.kind === "aim") {
      const ang = Math.round((Math.atan2(pt.y - d.origin.y, pt.x - d.origin.x) * 180) / Math.PI);
      setAim(d.pkId, d.target, ang);
      return;
    }
    if (d.kind === "release") {
      const ang = Math.round((Math.atan2(pt.y - d.origin.y, pt.x - d.origin.x) * 180) / Math.PI);
      const raw = Math.hypot(pt.x - d.origin.x, pt.y - d.origin.y);
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
    // snap a dropped net into a standard goal position if it's near one
    if (d.kind === "piece" && d.moved && d.line == null) {
      const pc = pieces.find(q => q.id === d.id);
      if (pc && pc.kind === "net") {
        const spots = [{ x: 17, y: 42.5, facing: 0 }, { x: 183, y: 42.5, facing: 180 }];
        const near = spots.find(s => Math.hypot(s.x - pc.x, s.y - pc.y) < 12);
        if (near) updateById(pc.id, near);
      }
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
    setTextDraft(serializeDrill(rink, pieces, drillTitle, drillDesc));
    setTextError("");
    setOpenMenu("text");
  }
  function applyText() {
    const r = parseDrill(extractDrill(textDraft));   // accepts a pasted ```drill markdown block
    if (r.errors.length) { setTextError(r.errors.join("\n")); return; }
    setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc); setSelectedId(null); setPopup(null);
    resetAnim(); setTextError(""); setOpenMenu(null);
  }
  const slug = () => (drillTitle || "drill").replace(/[^\w-]+/g, "_").toLowerCase();
  // a drill as a markdown doc: title heading + description + a ```drill fenced
  // block that round-trips (renders as a code block in Obsidian / on the web)
  function toMarkdown() {
    const dsl = serializeDrill(rink, pieces, drillTitle, drillDesc).trimEnd();
    const title = (drillTitle || "Drill").trim();
    const desc = drillDesc && drillDesc.trim() ? drillDesc.trim() + "\n\n" : "";
    return `# ${title}\n\n${desc}\`\`\`drill\n${dsl}\n\`\`\`\n`;
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportTxt() { download(`${slug()}.txt`, serializeDrill(rink, pieces, drillTitle, drillDesc), "text/plain"); }
  function exportMd() { download(`${slug()}.md`, toMarkdown(), "text/markdown"); }
  function copyMd() {
    navigator.clipboard?.writeText(toMarkdown());
    setToast("Markdown copied"); setTimeout(() => setToast(""), 1400);
  }
  function importTxt(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result);
      const r = parseDrill(extractDrill(txt));      // .txt or a .md with a ```drill block
      if (r.errors.length) { setTextDraft(txt); setTextError(r.errors.join("\n")); setOpenMenu("text"); return; }
      setRink(r.rink); setPieces(r.pieces); setDrillTitle(r.title); setDrillDesc(r.desc); setSelectedId(null); setPopup(null);
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
    const W = w => (flat ? w : sw(w));
    const D = d => (flat ? d : sdash(d));
    const base = { stroke: p.color, fill: "none", strokeLinecap: "round", opacity: 0.78,
      ...(flat ? {} : { vectorEffect: "non-scaling-stroke" }) };
    if (p.kind !== "puck") return { ...base, strokeWidth: W(0.7) };
    if (s.mode === "pass") return { ...base, strokeWidth: W(0.7), strokeDasharray: D("2.4 1.8") };
    if (s.mode === "shot") return { ...base, strokeWidth: W(1.25) };
    return { ...base, strokeWidth: W(0.75), strokeDasharray: D("0.2 1.5") };
  }

  // Arrowhead at a route's end, drawn in the stretch-cancelling icon frame so it
  // stays a clean triangle (SVG markers get sheared by the fill-mode stretch).
  function renderArrow(p) {
    const n = p.path.length;
    if (!n) return null;
    const last = p.path[n - 1];
    const from = n >= 2 ? segEnd(p, n - 2) : { x: p.x, y: p.y };
    const tail = last.type === "Q" ? { x: last.cx, y: last.cy }
      : last.type === "C" ? { x: last.c2x, y: last.c2y } : from;
    const dx = last.x - tail.x, dy = last.y - tail.y;
    if (!dx && !dy) return null;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const fx = iconXf({ x: last.x, y: last.y, a: ang });
    return (
      <g key={`arw-${p.id}`} transform={fx.t} pointerEvents="none">
        <path d="M 0 0 L -2.7 -1.5 L -1.9 0 L -2.7 1.5 Z" fill={p.color} opacity={0.85} />
      </g>
    );
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
    const rotatable = p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || (p.kind === "player" && !p.path.length);
    if (!editing || tool === "draw" || !rotatable) return null;
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

  // Release handles for a hard rim / chip. A terminal release shows a handle
  // sitting at the puck's landing point: drag it to set BOTH the direction and
  // the distance of the release; the dashed path previews where the puck goes.
  // (Legacy rim/chip transfers keep a simple direction-only aim ring.)
  function renderAim(p) {
    if (!editing || tool === "draw" || p.kind !== "player") return null;
    const pk = pieces.find(q => q.kind === "puck" && puckChain(q).includes(p.id));
    if (!pk) return null;
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

    // terminal release handle (dir + distance) for chip / hard rim
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
      const col = "#3a8dff";
      out.push(
        <g key={`rel-${p.id}-${aimField}`}>
          <polyline points={path.map(q => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col}
            strokeWidth={0.4} strokeDasharray="2 1.4" opacity={0.7} pointerEvents="none" />
          <line x1={here.x} y1={here.y} x2={end.x} y2={end.y} stroke={col} strokeWidth={0.25} opacity={0.4} strokeDasharray="1 1" pointerEvents="none" />
          <circle cx={here.x} cy={here.y} r={1} fill={col} opacity={0.8} pointerEvents="none" />
          <circle cx={end.x} cy={end.y} r={1.9} fill={col} stroke="#fff" strokeWidth={0.4} pointerEvents="none" />
          <circle cx={end.x} cy={end.y} r={5} fill="transparent" style={{ cursor: "grab" }}
            onPointerDown={e => handleDown(e, { kind: "release", pkId: pk.id, origin: here, aimField, distField, relKind: kind })} />
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
      const kx = here.x + Math.cos(a) * R, ky = here.y + Math.sin(a) * R;
      const col = tr.aim != null ? "#3a8dff" : "#9fb4c6";
      out.push(
        <g key={`aim-${p.id}-${s}`}>
          <circle cx={here.x} cy={here.y} r={R} fill="none" stroke={col} strokeWidth={0.25} strokeDasharray="1 1" opacity={0.7} pointerEvents="none" />
          <line x1={here.x} y1={here.y} x2={kx} y2={ky} stroke={col} strokeWidth={0.35} opacity={0.75} pointerEvents="none" />
          <circle cx={kx} cy={ky} r={1.6} fill={col} stroke="#12233a" strokeWidth={0.35} pointerEvents="none" />
          <circle cx={kx} cy={ky} r={4.2} fill="transparent" style={{ cursor: "grab" }}
            onPointerDown={e => handleDown(e, { kind: "aim", pkId: pk.id, target: { stage: s }, origin: here })} />
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
  function renderLabels() {
    const canEdit = editing && tool !== "draw";
    const els = [];
    pieces.forEach(p => {
      if (p.kind === "label") {
        const sel = canEdit && p.id === selectedId;
        els.push(labelNode(`lbl-${p.id}`, p.x, p.y, p.text, p.size, p.color, sel,
          e => pieceDown(e, p.id),
          canEdit ? e => handleDown(e, { kind: "resize", id: p.id, seg: null, cx: p.x, cy: p.y, size0: p.size || 1 }) : null));
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

    // which net or passer a shot aims at (default: nearest to the shooter)
    const netRow = pk => {
      const targets = pieces.filter(q => q.kind === "net" || q.kind === "passer");
      return (
        <div className="hd-poprow">
          <span>Target</span>
          <button className={`hd-mini${!pk.net ? " on" : ""}`}
            onClick={() => updateById(pk.id, { net: null })}>Nearest</button>
          {targets.map(n => (
            <button key={n.id} className={`hd-mini${pk.net === n.id ? " on" : ""}`}
              onClick={() => updateById(pk.id, { net: pk.net === n.id ? null : n.id })}>{n.id}</button>
          ))}
        </div>
      );
    };
    // Unified "Collect puck" toggle for player p at point i (-1 = standing).
    // Grabs the nearest loose puck; toggling off reverts it to a release.
    const collectRow = (p, i) => {
      let hit = null;
      for (const q of pieces) {
        if (q.kind !== "puck") continue;
        if (q.pickup && q.pickup.to === p.id && q.pickup.at === (i < 0 ? 0 : i)) { hit = { pk: q, kind: "pickup" }; break; }
        const ts = q.transfers || [];
        const s = ts.length - 1;
        const t = ts[s];
        if (t && t.to === p.id && (t.recvAt === i || (i < 0 && t.recvAt == null)) && (t.kind === "rim" || t.kind === "chip" || t.kind === "shot")) {
          hit = { pk: q, kind: "tr", stage: s, tr: t }; break;
        }
      }
      const hasLoose = pieces.some(q => q.kind === "puck"
        && (q.shotAt != null || q.rimAt != null || q.chipAt != null || (!q.carrier && !q.pickup && !(q.transfers || []).length))
        && puckChain(q).slice(-1)[0] !== p.id);
      if (!hit && !hasLoose) return null;
      const undo = () => {
        if (hit.kind === "pickup") { updateById(hit.pk.id, { pickup: null }); return; }
        const tr = hit.tr, field = tr.kind === "rim" ? "rimAt" : tr.kind === "chip" ? "chipAt" : "shotAt";
        update(q => q.id !== hit.pk.id ? q : { ...q, transfers: (q.transfers || []).slice(0, hit.stage),
          [field]: tr.at, ...(tr.kind === "rim" ? { rimAim: tr.aim != null ? tr.aim : null } : tr.kind === "chip" ? { chipAim: tr.aim != null ? tr.aim : null } : {}) });
      };
      return (
        <div className="hd-poprow">
          <button className={`hd-mini${hit ? " on" : ""}`}
            onClick={() => (hit ? undo() : collectPuckAt(p.id, i))}>
            {hit ? "✓ Collecting puck" : "⊕ Collect puck"}
          </button>
          <span style={{ fontSize: 11, color: "#8b99a8" }}>grabs the nearest loose puck here</span>
        </div>
      );
    };
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
          {stage === (pk.transfers || []).length && (
            <div className="hd-poprow">
              <button className={`hd-mini${pk.shotAt === i ? " on" : ""}`}
                onClick={() => setTerminal(pk.id, "shotAt", i)}>
                {pk.shotAt === i ? `✓ Shooting at ${pk.net || "nearest"}` : `🥅 Shoot at ${pk.net || "nearest"}`}
              </button>
              <button className={`hd-mini${pk.rimAt === i ? " on" : ""}`}
                onClick={() => setTerminal(pk.id, "rimAt", i)}>
                {pk.rimAt === i ? "✓ Hard rim" : "Hard rim"}
              </button>
              <button className={`hd-mini${pk.chipAt === i ? " on" : ""}`}
                onClick={() => setTerminal(pk.id, "chipAt", i)}>
                {pk.chipAt === i ? "✓ Chip" : "Chip"}
              </button>
            </div>
          )}
          {(pk.rimAt === i || pk.chipAt === i) && (
            <div className="hd-poprow">
              <span style={{ fontSize: 11, color: "#8b99a8" }}>drag the handle on the ice to aim &amp; set distance</span>
            </div>
          )}
          {(pk.shotAt === i || (from && from.kind === "shot" && from.at === i)) && netRow(pk)}
          {incoming && incoming.kind === "pass" && (
            <div className="hd-poprow">
              <button className={`hd-mini${incoming.recvAt === i ? " on" : ""}`}
                onClick={() => setRecvAt(pk.id, stage - 1, incoming.recvAt === i ? null : i)}>
                {incoming.recvAt === i ? "✓ Receiving here" : "Receive pass here"}
              </button>
              {incoming.recvAt === i && p.path.length > 0 && (
                <span style={{ fontSize: 11, color: "#8b99a8" }}>
                  {pk.shotAt === i ? "one-timer — pace auto-syncs" : "pace auto-syncs"}
                </span>
              )}
            </div>
          )}
          {/* give-and-go: this player is also the FINAL possessor, so offer the
              return reception + shot here too (their earlier pass resolved above) */}
          {(() => {
            const finalStage = ts.length;
            if (chain[finalStage] !== p.id || finalStage === stage) return null;
            const inc = ts[finalStage - 1];               // the pass that returns the puck
            return (
              <>
                {inc && inc.kind === "pass" && (
                  <div className="hd-poprow">
                    <button className={`hd-mini${inc.recvAt === i ? " on" : ""}`}
                      onClick={() => setRecvAt(pk.id, finalStage - 1, inc.recvAt === i ? null : i)}>
                      {inc.recvAt === i ? "✓ Receiving here" : "Receive pass here"}
                    </button>
                  </div>
                )}
                <div className="hd-poprow">
                  <button className={`hd-mini${pk.shotAt === i ? " on" : ""}`}
                    onClick={() => setTerminal(pk.id, "shotAt", i)}>
                    {pk.shotAt === i ? `✓ Shooting at ${pk.net || "nearest"}` : `🥅 Shoot at ${pk.net || "nearest"}`}
                  </button>
                  <button className={`hd-mini${pk.rimAt === i ? " on" : ""}`}
                    onClick={() => setTerminal(pk.id, "rimAt", i)}>
                    {pk.rimAt === i ? "✓ Hard rim" : "Hard rim"}
                  </button>
                  <button className={`hd-mini${pk.chipAt === i ? " on" : ""}`}
                    onClick={() => setTerminal(pk.id, "chipAt", i)}>
                    {pk.chipAt === i ? "✓ Chip" : "Chip"}
                  </button>
                </div>
                {pk.shotAt === i && netRow(pk)}
              </>
            );
          })()}
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
          <button className="hd-mini" onClick={() => addPieceAt("net", popup.pt)}>🥅 Net</button>
          <button className="hd-mini" onClick={() => addPieceAt("bumper", popup.pt)}>▬ Bumper</button>
          <button className="hd-mini" onClick={() => addPieceAt("deker", popup.pt)}>π Deker</button>
          <button className="hd-mini" onClick={() => addPieceAt("passer", popup.pt)}>▭ Passer</button>
          <button className="hd-mini" onClick={() => addPieceAt("label", popup.pt)}>🇹 Label</button>
        </div>
      );
    } else if (popup.type === "piece") {
      anchorPt = { x: p.x, y: p.y };
      title = p.kind === "player" ? `Player ${p.id}` : p.kind === "puck" ? `Puck ${p.id}`
        : p.kind === "net" ? `Net ${p.id}` : p.kind === "bumper" ? `Bumper ${p.id}`
        : p.kind === "deker" ? `Deker ${p.id}` : p.kind === "passer" ? `Passer ${p.id}`
        : p.kind === "label" ? `Label ${p.id}` : `Cone ${p.id}`;
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
              <div className="hd-poprow">
                <button className="hd-mini danger"
                  onClick={() => { setPieces(ps => ps.filter(q => q.id !== p.id)); setSelectedId(null); setPopup(null); }}>
                  Delete label
                </button>
              </div>
            </>
          )}
          {p.kind === "net" && (
            <div className="hd-poprow">
              <button className={`hd-mini${p.goalie ? " on" : ""}`}
                onClick={() => updateById(p.id, { goalie: !p.goalie })}>
                {p.goalie ? "✓ Goalie in net" : "🥅 Goalie in net"}
              </button>
              <span style={{ fontSize: 11, color: "#8b99a8" }}>drag to move · ring to rotate</span>
            </div>
          )}
          {(p.kind === "bumper" || p.kind === "deker" || p.kind === "passer") && (
            <div className="hd-poprow">
              <span style={{ fontSize: 11, color: "#8b99a8" }}>
                {p.kind === "deker" ? "stickhandle under the stick · " : p.kind === "passer" ? "pucks rebound off the face · " : ""}drag to move · ring to rotate
              </span>
            </div>
          )}
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
              {p.path.length > 0 && !p.defense && (
                <div className="hd-poprow">
                  <button className={`hd-mini${p.holdLine ? " on" : ""}`}
                    onClick={() => updateById(p.id, { holdLine: !p.holdLine })}>
                    {p.holdLine ? "✓ Hold at blue line" : "Hold at blue line"}
                  </button>
                  <span style={{ fontSize: 11, color: "#8b99a8" }}>waits for the puck to enter the zone</span>
                </div>
              )}
              <div className="hd-poprow">
                <button className={`hd-mini${p.defense ? " on" : ""}`}
                  onClick={() => updateById(p.id, { defense: !p.defense })}>
                  {p.defense ? "✓ Auto defense" : "🛡 Auto defense"}
                </button>
                <span style={{ fontSize: 11, color: "#8b99a8" }}>holds the slot, tracks the puck goal-side</span>
              </div>
              {/* collect a loose puck at the player's standing spot */}
              {collectRow(p, -1)}
              {/* host the chain (pass / shoot / rebound) on the player itself
                  for a route-less player, and for any puck head so the option
                  stays put after a route is added — i=-1 releases from the
                  starting spot, before skating to the first waypoint */}
              {(p.path.length === 0
                || pieces.some(q => q.kind === "puck"
                  && (q.carrier === p.id || (q.pickup && q.pickup.to === p.id))))
                && chainControls(p, -1)}
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
          {(p.kind === "player" || p.kind === "puck") && (
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
          {(p.kind === "player" || p.kind === "puck") && !p.defense && (
            <div className="hd-poprow">
              <span>Add leg</span>
              <button className="hd-mini" onClick={() => addSegment(p.id, "L")}>⎯</button>
              <button className="hd-mini" onClick={() => addSegment(p.id, "Q")}>⌒</button>
              <button className="hd-mini" onClick={() => addSegment(p.id, "C")}>∿</button>
            </div>
          )}
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
          <div className="hd-poprow">
            <span>Note</span>
            <input className="hd-input" style={{ flex: 1, minWidth: 90 }}
              value={s.desc != null ? s.desc : (s.name || "")}
              placeholder={zoneAt(s.x, s.y) || "describe this spot"}
              onChange={e => updateSeg(p.id, i, { desc: e.target.value || undefined, name: undefined })} />
          </div>
          {(s.desc != null ? s.desc : s.name) && (
            <div className="hd-poprow">
              <span>Show as</span>
              {[["auto", "Auto"], ["preso", "Present"], ["label", "Label"]].map(([m, lab]) => (
                <button key={m} className={`hd-mini${(s.dmode || "auto") === m ? " on" : ""}`}
                  onClick={() => updateSeg(p.id, i, {
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
              <Stepper value={+(s.dsize || 1).toFixed(2)} onChange={v => updateSeg(p.id, i, { dsize: Math.max(0.4, v) })} step={0.2} min={0.4} suffix="×" />
              <span style={{ fontSize: 11, color: "#8b99a8" }}>drag it to move</span>
            </div>
          )}
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
          {p.kind === "player" && collectRow(p, i)}
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
              const style = segStroke(p, s, i === p.path.length - 1, true);
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
          {pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p)}</g>)}
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

  const togglePlay = () => { if (animT >= 1) resetAnim(); if (!playing && animT === 0) setPlaySeed(s => s + 1); setPopup(null); setOpenMenu(null); setHoldStep(null); holdRef.current = 0; setPlaying(p => !p); };
  const resetPlay = () => { setPlaying(false); resetAnim(); };

  // during playback the "Routes on play" setting controls what stays visible;
  // while editing everything shows regardless
  const showRoutes = !aiPlay && (editing || playRoutes !== "hide");   // player route lines + stops
  const showPuckPaths = !aiPlay && (editing || playRoutes === "all"); // planned pass / shot lines

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
            </defs>

            <g ref={sceneRef} transform={sceneTransform}>
            <RinkMarkings yFix={yFix} />

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

            {/* goalies track the puck in front of their net (below the action) */}
            {!aiPlay && pieces.filter(q => q.kind === "net" && q.goalie).map(net => {
              const gp = goaliePos(net);
              const fx = iconXf(gp);
              const col = net.color || "#c81e33";
              const dark = "#1d2126";
              // local +x faces the shooter: chest, mask, two leg pads out front,
              // catch glove (top), blocker + goalie stick (bottom)
              return (
                <g key={`goalie-${net.id}`} transform={fx.t} pointerEvents="none">
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
            })}

            {!aiPlay && pieces.map(p => {
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
                      ? <polyline points={zigzagPoints(from, s, strokeAR)} {...style} strokeLinejoin="round" pointerEvents="none" />
                      : <path d={d} {...style} pointerEvents="none" />)}
                    {showRoutes && isLast && renderArrow(p)}
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
                      <line x1={L.x0} y1={L.y0} x2={L.x1} y2={L.y1} vectorEffect="non-scaling-stroke"
                        stroke="#14171a" strokeWidth={sw(L.shot ? 1.1 : 0.55)}
                        strokeDasharray={L.shot ? undefined : sdash("2.4 1.8")} />
                      <circle cx={L.x1} cy={L.y1} r={1.1} fill="none" vectorEffect="non-scaling-stroke"
                        stroke="#14171a" strokeWidth={sw(0.3)} />
                    </g>
                  )));
            })()}

            {drawPreview && drawPreview.length > 1 && (
              <polyline points={drawPreview.map(q => `${q.x},${q.y}`).join(" ")} vectorEffect="non-scaling-stroke"
                fill="none" stroke="#ffd447" strokeWidth={sw(0.6)} strokeDasharray={sdash("1.4 1")} opacity={0.9} />
            )}

            {pieces.map(p => <g key={`h-${p.id}`}>{renderHandles(p)}</g>)}

            {/* nets sit on the ice (bottom); players paint above pucks so a
               carried puck can't steal the grab; rotate ring is drawn last */}
            {!aiPlay && [...pieces]
              .filter(p => p.kind !== "label")
              .sort((a, b) => {
                const rank = k => (k === "net" || k === "bumper" || k === "deker" || k === "passer" ? 0 : k === "player" ? 2 : 1);
                return rank(a.kind) - rank(b.kind);
              })
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
          {pieces.map(p => <g key={`ca-${p.id}`}>{renderAim(p)}</g>)}
            {!aiPlay && renderLabels()}
            </g>
          </svg>
          {renderPopout()}
          {renderLoupe()}
        </div>
      </div>

      {/* ---------- AI game scoreboard ---------- */}
      {aiPlay && aiRef.current && (
        <div className="hd-preso" style={{ bottom: "auto", top: "calc(10px + env(safe-area-inset-top))" }}>
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

      {/* ---------- presentation caption ---------- */}
      {presentation && holdStep && (
        <div className="hd-preso">
          <div className="hd-preso-text">{holdStep.text}</div>
          <button className="hd-preso-btn" onClick={skipHold}>Continue ▶</button>
        </div>
      )}

      {/* ---------- draggable play dock (mobile) ---------- */}
      <div className="hd-playdock" ref={playRef} style={{
        ...(playPos ? { left: playPos.x, top: playPos.y, transform: "none" } : {}),
        ...(aiPlay ? { display: "none" } : {}),
      }}>
        <span className="hd-grip" onPointerDown={playDragStart} onPointerMove={playDragMove}
          onPointerUp={playDragEnd} onPointerCancel={playDragEnd}>⠿</span>
        <button className={`hd-fab small${loopMode ? " on" : ""}`} title="Loop"
          onClick={() => setLoopMode(v => !v)}>🔁</button>
        <button className="hd-fab small play" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
        <button className="hd-fab small" title={playing ? "Stop" : "Reset"} onClick={resetPlay}>{playing ? "■" : "⟲"}</button>
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
        {!aiPlay && <>
          <button className={`hd-barbtn hd-barplay${loopMode ? " on" : ""}`} title="Loop"
            onClick={() => setLoopMode(v => !v)}>🔁</button>
          <button className="hd-barbtn hd-barplay play" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
          <button className="hd-barbtn hd-barplay" title={playing ? "Stop" : "Reset"} onClick={resetPlay}>{playing ? "■" : "⟲"}</button>
        </>}
        <div className="hd-barhint">{toolHint || ""}</div>
        <div className="hd-ver">v{APP_VERSION} · {BUILD_STAMP}</div>
      </div>

      {/* ---------- menus ---------- */}
      {openMenu === "settings" && (
        <div className="hd-menu tl">
          <div className="hd-mh">Drill</div>
          <input className="hd-input" placeholder="Drill name" value={drillTitle}
            onChange={e => setDrillTitle(e.target.value)} />
          <textarea className="hd-input" style={{ minHeight: 46, resize: "vertical", fontFamily: "inherit" }}
            placeholder="Description" value={drillDesc} onChange={e => setDrillDesc(e.target.value)} spellCheck={false} />
          <button className="hd-item" onClick={openText}>⌨ Text editor</button>
          <button className="hd-item" onClick={() => { exportTxt(); setOpenMenu(null); }}>⇩ Export .txt</button>
          <button className="hd-item" onClick={() => { exportMd(); setOpenMenu(null); }}>⬇ Export .md</button>
          <button className="hd-item" onClick={() => { copyMd(); setOpenMenu(null); }}>⧉ Copy markdown</button>
          <button className="hd-item" onClick={() => fileRef.current?.click()}>⇧ Load .txt / .md</button>
          <button className="hd-item danger"
            onClick={() => {
              if (!pieces.length || window.confirm("Clear all pieces from the board?")) {
                setPlaying(false); resetAnim();
                setPieces([]); setSelectedId(null); setPopup(null); setOpenMenu(null);
              }
            }}>🗑 Clear all</button>
          <button className={`hd-item${showZones ? " on" : ""}`}
            onClick={() => setShowZones(s => !s)}>
            ▦ Ice zones {showZones ? "(on)" : ""}
          </button>
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
          <div className="hd-poprow" style={{ marginTop: 4 }}>
            <span>Loop end pause</span>
            <Stepper value={loopPause} onChange={setLoopPause} step={0.5} min={0} />
          </div>
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
            <span style={{ fontSize: 11, color: "#8b99a8" }}>play pauses at each described beat</span>
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
          <button className="hd-item" onClick={() => { setTool("net"); setOpenMenu(null); }}>🥅 Net</button>
          <button className="hd-item" onClick={() => { setTool("bumper"); setOpenMenu(null); }}>▬ Bumper</button>
          <button className="hd-item" onClick={() => { setTool("deker"); setOpenMenu(null); }}>π Deker</button>
          <button className="hd-item" onClick={() => { setTool("passer"); setOpenMenu(null); }}>▭ Passer</button>
          <button className="hd-item" onClick={() => { setTool("label"); setOpenMenu(null); }}>🇹 Label</button>
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
            <b> PIECE</b> id player|puck|cone|net|bumper|deker|passer|label x y [#color] [label] [speed=1.2] [hand=L] [on=F1]
            (a <b>bumper</b> is a foam barrier, a <b>deker</b> a stickhandling gate, a <b>passer</b> a rebounder box — all take <code>face=deg</code>)
            (a <b>label</b> is a movable/resizable text note: <code>PIECE L1 label 100 40 size=1.2 "Regroup here"</code>)
            (a <b>net</b> takes <code>face=deg</code> and <code>goalie</code>; a goalie tracks the puck and
            randomly saves or lets in each shot) ·
            <b> PATH</b> id segments (<b>L</b> x,y · <b>Q</b> cx,cy x,y · <b>C</b> c1x,c1y c2x,c2y x,y).
            Modifiers before a segment: <b>PASS</b>/<b>SHOT</b>, <b>BWD</b>, <b>STOP n</b>, <b>RATE n</b>,
            <b> NAME word</b> (names that waypoint for presentation text; underscores show as spaces),
            <b> DESC "text"</b> (a waypoint description) with <b>SHOW</b> auto|preso|label — <b>auto</b> names it
            in the play's captions, <b>preso</b> reads it out during presentation, <b>label</b> pins it on the
            ice (add <b>SIZE n</b> and <b>OFF dx,dy</b> to resize / move that label).
            <code> on=F1</code> rides that player's blade until the carrier reaches the puck's spot.
            <code> pass=2:F2@3</code> passes at the carrier's point 2 to F2, received at F2's
            point 3 — the receiver's pace auto-syncs (omit <code>@3</code> to lead them instead).
            Point <b>0</b> is the starting spot (release before skating to point 1).
            <b>Shoot</b>, <b>Hard rim</b>, and <b>Chip</b> are terminal <b>releases</b> — the puck goes
            into space and lands loose. <code> shoot=4</code> fires at point 4 (targets the nearest
            net/passer, or <code>net=N2</code>/<code>net=PS1</code>). <code> rim=4~90*80</code> hard-rims around the
            boards and <code>chip=4~-45*30</code> chips into space; the <code>~deg</code> is the direction and
            <code>*ft</code> the distance — or just drag the on-ice <b>handle</b> at the end of the release
            to set both. Any player then uses <b>Collect puck</b> (in their popup, or at a waypoint) to
            grab the nearest loose puck at that spot. (The handoff forms <code>chip=4:F1</code> /
            <code>rim=4:F2</code> that carry straight to a collector still load and play.)
            <code> pickup=F2@3</code> — a loose puck hops onto F2's blade at their point 3.
            <code> face=45</code> sets a stationary player's heading (degrees).
            <code> hold=line</code> makes a player wait at the blue line until the puck enters the zone.
          </div>
        </div>
      )}

      {openMenu === "steps" && (
        <div className="hd-sheet">
          <div className="hd-mh">Presentation steps</div>
          <div className="hd-steplist">
            {presoSteps.length === 0 ? (
              <div className="hd-note">No described beats yet — add pucks, passes, or shots.</div>
            ) : presoSteps.map(s => (
              <div key={s.key} className="hd-steprow">
                <span className="hd-steptime">{s.t.toFixed(1)}s</span>
                <input className="hd-input" style={{ flex: 1, minWidth: 0 }} value={s.text}
                  onChange={e => setStepNotes(n => ({ ...n, [s.key]: e.target.value }))} />
                {stepNotes[s.key] != null && (
                  <button className="hd-mini" title="reset to auto"
                    onClick={() => setStepNotes(n => { const m = { ...n }; delete m[s.key]; return m; })}>↺</button>
                )}
              </div>
            ))}
          </div>
          <div className="hd-row">
            <button className="hd-btn primary" onClick={() => setOpenMenu(null)}>Done</button>
            <button className={`hd-btn${presentation ? " primary" : ""}`}
              onClick={() => setPresentation(v => !v)}>{presentation ? "Presentation on" : "Turn on"}</button>
          </div>
          <div className="hd-note">
            Text is auto-generated from the play — edit any beat; ↺ resets it to auto.
            In Presentation mode, play pauses {presoDelay}s at each step (Continue to skip ahead).
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" style={{ display: "none" }} onChange={importTxt} />
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: "calc(64px + env(safe-area-inset-bottom))",
          transform: "translateX(-50%)", background: "rgba(20,26,32,0.92)", color: "#eaf2f8",
          padding: "6px 14px", borderRadius: 8, fontSize: 13, zIndex: 9999, pointerEvents: "none" }}>{toast}</div>
      )}
      {showDiag && <DiagPanel />}
    </div>
  );
}
