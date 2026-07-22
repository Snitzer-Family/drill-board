// Piece icons (screen-true frames), stepper control, diagnostics overlay.
import { useState, useRef, useEffect } from "react";
import { APP_VERSION, BUILD_STAMP, ICON_SCALE } from "./constants.js";

/* ---------------- unified action icons ----------------
   One monochrome, stroke-based set drawn on a 24×24 grid in currentColor, so
   every button inherits its text colour and they all read as one family. */
const F = { fill: "currentColor", stroke: "none" };
const ICONS = {
  play: <path d="M7 5.5v13l11-6.5z" {...F} />,
  pause: <><rect x="6.5" y="5" width="3.6" height="14" rx="1.1" {...F} /><rect x="13.9" y="5" width="3.6" height="14" rx="1.1" {...F} /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.8" {...F} />,
  loop: <><path d="M17 3l3.5 3.5L17 10" /><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13" /><path d="M7 21l-3.5-3.5L7 14" /><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13" /></>,
  reset: <><path d="M4 4v5h5" /><path d="M4.5 13a8 8 0 1 0 2-6.5L4 9" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12H9" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h5" /></>,
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,
  pencil: <><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14 8l3 3" /></>,
  duplicate: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.2" /><path d="M4.5 15.5V6a2 2 0 0 1 2-2h9.5" /></>,
  trash: <><path d="M4 6.5h16" /><path d="M8 6.5V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" /><path d="M6.5 6.5l1 13a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-13" /></>,
  rotateCw: <><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 3.5v5h-5" /></>,
  rotateCcw: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 3.5v5h5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  // corner arrows out = maximize; corner arrows in = restore
  expand: <><path d="M9 4.5H4.5V9" /><path d="M15 4.5h4.5V9" /><path d="M9 19.5H4.5V15" /><path d="M15 19.5h4.5V15" /></>,
  restore: <><path d="M4.5 8.5H9V4" /><path d="M19.5 8.5H15V4" /><path d="M4.5 15.5H9V20" /><path d="M19.5 15.5H15V20" /></>,
  // freehand marker: a pen over a wavy stroke
  marker: <><path d="M15.5 4.2l4.3 4.3L11 17.3l-4.3.9.9-4.3z" /><path d="M13.4 6.3l4.3 4.3" /><path d="M3 21c1.4-2 2.8-2 4.2 0" /></>,
  // hockey net (mouth + mesh) for "shoot at"
  net: <><path d="M4 19V8h16v11" /><path d="M4 8l3-2.5h10L20 8" /><path d="M8 8v11M12 8v11M16 8v11M4 13.5h16" /></>,
  // a puck dropping into a tray = collect a loose puck
  collect: <><path d="M12 3.5v9" /><path d="M8.5 9l3.5 3.5L15.5 9" /><path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" /></>,
  // a raised arc + landing = sauce pass
  sauce: <><path d="M3.5 17.5C7 6 17 6 20.5 17.5" /><path d="M16.5 14l4 3.5-5 1.2" {...F} /></>,
  // return loop = give-and-go / rebounder pass
  giveGo: <><path d="M8 8v4a4 4 0 0 0 8 0V7" /><path d="M12.5 10.5L16 7l3.5 3.5" /></>,
  // straight arrow = a plain pass
  pass: <><path d="M4 12h14" /><path d="M13 6l6 6-6 6" /></>,
  chip: <path d="M4 16C8 7 16 7 20 16" />,
  rim: <path d="M4 5v8a6 6 0 0 0 6 6h10" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /></>,
  label: <><path d="M5 6h14" /><path d="M12 6v13" /></>,
  puck: <ellipse cx="12" cy="12" rx="8" ry="4.4" {...F} />,
  check: <path d="M5 12.5l4.5 4.5L19 6.5" />,
  grip: <><circle cx="9" cy="7" r="1.4" {...F} /><circle cx="15" cy="7" r="1.4" {...F} /><circle cx="9" cy="12" r="1.4" {...F} /><circle cx="15" cy="12" r="1.4" {...F} /><circle cx="9" cy="17" r="1.4" {...F} /><circle cx="15" cy="17" r="1.4" {...F} /></>,
  share: <><circle cx="6" cy="12" r="2.6" /><circle cx="17.5" cy="6" r="2.6" /><circle cx="17.5" cy="18" r="2.6" /><path d="M8.3 10.8l7-3.6M8.3 13.2l7 3.6" /></>,
  download: <><path d="M12 3.5v11" /><path d="M7.5 10l4.5 4.5L16.5 10" /><path d="M4.5 19.5h15" /></>,
  upload: <><path d="M12 20.5v-11" /><path d="M7.5 14l4.5-4.5L16.5 14" /><path d="M4.5 4.5h15" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M20 16l-5-5-8 8" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M7.5 14h9" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>,
  gauge: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-5" /></>,
  sliders: <><path d="M5 5v14M12 5v14M19 5v14" /><circle cx="5" cy="9" r="1.9" {...F} /><circle cx="12" cy="14" r="1.9" {...F} /><circle cx="19" cy="8" r="1.9" {...F} /></>,
  // line-segment types (player/waypoint popups)
  segLine: <path d="M4.5 19.5L19.5 4.5" />,
  segQuad: <path d="M4 18Q12 3 20 18" />,
  segCubic: <path d="M4 18C4 10 9.5 10 12 12C14.5 14 20 14 20 6" />,
};
export function Icon({ name, size = 17, style }) {
  const p = ICONS[name];
  if (!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "block", flex: "0 0 auto", ...style }}>{p}</svg>
  );
}

/* ---------------- diagnostics overlay (toggled from ☰ menu) ---------------- */

export function DiagPanel() {
  const probeRef = useRef(null);
  const [txt, setTxt] = useState("");
  useEffect(() => {
    const tick = () => {
      const cs = probeRef.current ? getComputedStyle(probeRef.current) : null;
      const vv = window.visualViewport;
      const g = sel => {
        const el = document.querySelector(sel);
        if (!el) return "n/a";
        const b = el.getBoundingClientRect();
        return `${Math.round(b.height)} bot${Math.round(b.bottom)}`;
      };
      const standalone = navigator.standalone === true ||
        (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
      setTxt(
        `v${APP_VERSION} · ${BUILD_STAMP}\n` +
        `mode   ${standalone ? "standalone" : "browser"}\n` +
        `inner  ${window.innerWidth}x${window.innerHeight}\n` +
        `vv     ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) + " ot" + Math.round(vv.offsetTop) : "n/a"}\n` +
        `screen ${screen.width}x${screen.height}\n` +
        `safe   t${cs ? cs.paddingTop : "?"} b${cs ? cs.paddingBottom : "?"}\n` +
        `root   ${g(".hd-root")}\n` +
        `stage  ${g(".hd-stage")}\n` +
        `ice    ${g(".hd-canvas")}`
      );
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      <div ref={probeRef} style={{ position: "fixed", visibility: "hidden",
        paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }} />
      <div style={{ position: "fixed", left: 8, top: 120, zIndex: 9999,
        background: "rgba(0,0,0,.78)", color: "#7CFC00",
        font: "11px ui-monospace, monospace", padding: "6px 8px",
        borderRadius: 6, pointerEvents: "none", whiteSpace: "pre" }}>
        {txt}
      </div>
    </>
  );
}

/* ---------------- piece icon ---------------- */

export function PieceIcon({ p, pos, onDown, selected, dim, xf, thDeg = 0, onStickDown, swing = 0, noShadow = false }) {
  const frame = xf || `translate(${pos.x} ${pos.y}) rotate(${pos.a || 0}) scale(${ICON_SCALE})`;
  let body;
  if (p.kind === "puck")
    body = (
      <g pointerEvents="none">
        {!noShadow && <ellipse cx={0.22} cy={0.58} rx={1.48} ry={1.3} fill="#05080b" opacity={0.22} />}
        <circle cx={0} cy={0} r={1.3} fill="#14171a" stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.38} />
      </g>
    );
  else if (p.kind === "net") {
    // top-down hockey goal: the mouth (goal line) faces local +x, the caged
    // frame bows back toward -x with a rounded back. ~±3.75 ≈ a 6 ft mouth.
    const red = p.color || "#c81e33";
    // mouth (goal line) faces +x at x=0; the cage bows back to a rounded back at -x
    const CAGE = "M 0 -3.75 L -1.7 -3.75 Q -4.15 -3.75 -4.15 -1.5 L -4.15 1.5 Q -4.15 3.75 -1.7 3.75 L 0 3.75";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-4.8} y={-4.5} width={5.4} height={9} rx={1} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        {/* a drawn goalie crease: an unfilled arch in front of the mouth (for a
            net placed away from the standard crease). ~6 ft radius (7.5 local). */}
        {p.crease && <path d="M 0 -7.5 A 7.5 7.5 0 0 1 0 7.5" fill="none" stroke="#d7263d" strokeWidth={0.42} opacity={0.85} strokeLinecap="round" />}
        {/* mesh backing + crosshatch netting + centre seam */}
        <path d={CAGE + " Z"} fill="rgba(230,238,246,0.3)" stroke="none" />
        <g stroke="#9fb0c0" strokeWidth={0.13} opacity={0.85} fill="none">
          <path d="M -0.4 -2.9 L -3.7 -1.7 M -0.4 -1.45 L -3.95 -0.85 M -0.4 1.45 L -3.95 0.85 M -0.4 2.9 L -3.7 1.7" />
          <path d="M -1.2 -3.3 L -1.2 3.3 M -2.4 -3.1 L -2.4 3.1 M -3.4 -2 L -3.4 2" />
          <path d="M -0.2 0 L -4.0 0" stroke="#8ea0b2" strokeWidth={0.16} />
        </g>
        {/* red pipe frame + the goal-line pipe (with a slight overhang) + posts */}
        <path d={CAGE} fill="none" stroke={red} strokeWidth={0.55} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={0} y1={-4.05} x2={0} y2={4.05} stroke={red} strokeWidth={0.8} strokeLinecap="round" />
        <circle cx={0} cy={-3.75} r={0.82} fill={red} />
        <circle cx={0} cy={3.75} r={0.82} fill={red} />
      </g>
    );
  } else if (p.kind === "tire") {
    // agility tire, top-down: a black rubber ring with tread ticks (~r 2.6 ≈ 4 ft)
    const rub = p.color || "#1c1c1e";
    const ticks = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      ticks.push(<line key={k} x1={c * 1.45} y1={s * 1.45} x2={c * 2.55} y2={s * 2.55}
        stroke="#3a3a3e" strokeWidth={0.28} strokeLinecap="round" />);
    }
    body = (
      <g pointerEvents="none">
        {selected && <circle cx={0} cy={0} r={3.1} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <circle cx={0} cy={0} r={2.0} fill="none" stroke={rub} strokeWidth={1.55} />
        <circle cx={0} cy={0} r={2.78} fill="none" stroke="#000" strokeWidth={0.2} opacity={0.55} />
        <circle cx={0} cy={0} r={1.22} fill="none" stroke="#000" strokeWidth={0.2} opacity={0.55} />
        {ticks}
        <path d="M -1.5 -1.5 A 2.1 2.1 0 0 1 1.5 -1.5" fill="none" stroke="#5a5a5e" strokeWidth={0.28} opacity={0.6} strokeLinecap="round" />
      </g>
    );
  } else if (p.kind === "light") {
    // cognitive-training light, top-down: an iPad on a tripod. Three legs splay
    // out beneath a portrait tablet whose screen shows the current cue colour;
    // the ice around it takes a soft wash of that colour.
    const lit = p.color || "#2ea043";
    const legs = [];
    for (let k = 0; k < 3; k++) {
      const a = (-90 + k * 120) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      legs.push(<line key={k} x1={c * 0.55} y1={s * 0.55} x2={c * 3.3} y2={s * 3.3}
        stroke="#4a4f57" strokeWidth={0.4} strokeLinecap="round" />);
    }
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-2.55} y={-3.35} width={5.1} height={6.7} rx={0.9} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        {/* the coloured light the screen casts on the ice */}
        <circle cx={0} cy={0} r={3.5} fill={lit} opacity={0.16} />
        {/* tripod legs + centre hub */}
        {legs}
        <circle cx={0} cy={0} r={0.62} fill="#3a3f47" />
        {/* the tablet: dark bezel, a colour-filled screen, and a glass highlight */}
        <rect x={-1.85} y={-2.7} width={3.7} height={5.4} rx={0.55} fill="#15181c" stroke="#0a0d10" strokeWidth={0.18} />
        <rect x={-1.42} y={-2.25} width={2.84} height={4.5} rx={0.32} fill={lit} />
        <rect x={-1.42} y={-2.25} width={2.84} height={1.5} rx={0.32} fill="#ffffff" opacity={0.16} />
      </g>
    );
  } else if (p.kind === "cone")
    body = (
      <path d="M 0 -2.4 L 2.2 1.8 L -2.2 1.8 Z"
        fill={p.color} stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.35} strokeLinejoin="round" pointerEvents="none" />
    );
  else if (p.kind === "bumper") {
    // solid barrier laid on the ice — a black rectangle; runs along local +x,
    // rotate with facing (drawn oversize vs true 6 ft so it reads on the sheet)
    const foam = p.color && p.color !== "#4d6fa6" ? p.color : "#1b1e22";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-8.1} y={-1.9} width={16.2} height={3.8} rx={0.9} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <ellipse cx={0} cy={1.55} rx={7.6} ry={0.7} fill="#0a0f14" opacity={0.22} />
        <rect x={-7.7} y={-1.35} width={15.4} height={2.7} rx={0.45} fill={foam} stroke="#40464e" strokeWidth={0.3} />
        <rect x={-7.7} y={-1.35} width={15.4} height={0.9} rx={0.45} fill="#ffffff" opacity={0.06} />
        <path d="M -3.9 -1 L -3.9 1 M 0 -1 L 0 1 M 3.9 -1 L 3.9 1" stroke="#565c64" strokeWidth={0.18} opacity={0.5} />
      </g>
    );
  } else if (p.kind === "stick") {
    // a hockey stick laid on the ice: shaft along local +x, blade angled off the
    // toe end; rotate with facing. A subtle ground shadow for depth.
    const wood = p.color || "#20242a";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-6.2} y={-2.5} width={12.6} height={5} rx={0.8} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <ellipse cx={0.5} cy={0.35} rx={6} ry={0.7} fill="#0a0f14" opacity={0.16} />
        {/* butt knob */}
        <rect x={-5.85} y={-0.5} width={0.7} height={1} rx={0.3} fill="#e7ebef" stroke="#9aa2ab" strokeWidth={0.1} />
        {/* shaft */}
        <rect x={-5.3} y={-0.32} width={9} height={0.64} rx={0.3} fill={wood} stroke="#0c1014" strokeWidth={0.12} />
        {/* heel + blade angled off the toe (with a slight curve) */}
        <path d="M 3.5 -0.32 L 6.3 -1.85 Q 6.95 -1.6 6.85 -0.95 L 4.3 0.32 Z" fill={wood} stroke="#0c1014" strokeWidth={0.12} strokeLinejoin="round" />
        <path d="M 4 -0.05 L 6.2 -1.25" stroke="#4a5058" strokeWidth={0.12} opacity={0.6} />
      </g>
    );
  } else if (p.kind === "deker") {
    // stickhandling gate: a hockey stick laid across two pegs — the puck goes
    // UNDER the shaft. The stick runs along local x; rotate with facing.
    const wood = p.color || "#c79a4e";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-3.6} y={-2.4} width={7.2} height={4.8} rx={0.8} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        {/* two pegs the stick rests on (with a small ground shadow) */}
        <ellipse cx={-2.25} cy={2.05} rx={1} ry={0.42} fill="#0a0f14" opacity={0.28} />
        <ellipse cx={2.25} cy={2.05} rx={1} ry={0.42} fill="#0a0f14" opacity={0.28} />
        <rect x={-2.7} y={-0.5} width={0.9} height={2.4} rx={0.32} fill="#3a3f47" stroke="#20242a" strokeWidth={0.16} />
        <rect x={1.8} y={-0.5} width={0.9} height={2.4} rx={0.32} fill="#3a3f47" stroke="#20242a" strokeWidth={0.16} />
        {/* the stick shaft across the pegs, blade hooking down off the right end */}
        <rect x={-3.35} y={-1.2} width={6.1} height={0.82} rx={0.4} fill={wood} stroke="#5a4420" strokeWidth={0.2} />
        <path d="M 2.55 -1.1 Q 3.75 -0.95 3.8 0.25" fill="none" stroke={wood} strokeWidth={0.75} strokeLinecap="round" />
      </g>
    );
  } else if (p.kind === "passer") {
    // a rectangular rebounder box; pucks carom off the face (local +x)
    const col = p.color || "#57636f";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-2.1} y={-3.1} width={4.4} height={6.2} rx={0.7} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <rect x={-1.6} y={-2.6} width={3.2} height={5.2} rx={0.5} fill="rgba(210,225,240,0.14)" stroke={col} strokeWidth={0.5} />
        <path d="M -1.6 -1.3 L 1.6 -1.3 M -1.6 1.3 L 1.6 1.3" stroke={col} strokeWidth={0.16} opacity={0.5} />
        <rect x={0.85} y={-2.6} width={0.75} height={5.2} rx={0.3} fill={col} />
      </g>
    );
  } else {
    const dark = "#1d2126";
    body = (
      <g pointerEvents="none">
        {selected && <circle cx={0} cy={0} r={4.6} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        {/* a soft shadow on the ice for a little depth (skipped mid-jump — the
            sticky ground shadow is drawn separately then) */}
        {!noShadow && <ellipse cx={-0.5} cy={0} rx={3.6} ry={3.9} fill="#0a1016" opacity={0.16} />}
        <path d="M 1.3 0 C 1.3 -2.2 0.6 -3.2 -0.5 -3.3 C -2.0 -3.4 -2.8 -2.2 -2.8 -1.1 L -2.8 1.1 C -2.8 2.2 -2.0 3.4 -0.5 3.3 C 0.6 3.2 1.3 2.2 1.3 0 Z"
          fill={p.color} stroke="#fff" strokeWidth={0.32} />
        <path d="M -1.5 -3.15 Q -0.55 0 -1.5 3.15" fill="none" stroke="#fff" strokeWidth={0.42} opacity={0.75} />
        <g transform={`${p.hand === "L" ? "scale(1 -1) " : ""}${swing ? `rotate(${swing} 1 0)` : ""}`.trim() || undefined}>
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
        <text x={-1.7} y={0.92} transform={`rotate(${-thDeg} -1.7 0)`}
          textAnchor="middle" fontSize={2.5} fontWeight={800} fill="#fff"
          style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
            paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 0.3 }}>
          {p.label}
        </text>
      </g>
    );
  }
  // nets and tires come in sizes — scale the drawn body + its grab area
  const sz = (p.kind === "net" || p.kind === "tire") && p.size ? p.size : 1;
  const grab = p.kind === "net"
    ? <rect x={-5} y={-4.2} width={5.5} height={8.4} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : p.kind === "tire"
    ? <circle cx={0} cy={0} r={2.9} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : p.kind === "bumper"
    ? <rect x={-7.2} y={-1.7} width={14.4} height={3.4} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : p.kind === "deker"
    ? <rect x={-2.5} y={-3.2} width={5} height={6.4} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : p.kind === "passer"
    ? <rect x={-1.9} y={-2.9} width={3.8} height={5.8} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : p.kind === "light"
    ? <rect x={-2.4} y={-3.1} width={4.8} height={6.2} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
    : <circle cx={0} cy={0} r={p.kind === "puck" ? 3.4 : 6.8} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />;
  return (
    <g opacity={dim ? 0.92 : 1} transform={frame}>
      {sz !== 1 ? <g transform={`scale(${sz})`}>{body}{grab}</g> : <>{body}{grab}</>}
      {onStickDown && p.kind === "player" && (
        <circle cx={4.7} cy={p.hand === "L" ? -2.55 : 2.55} r={3.3} fill="transparent"
          style={{ cursor: "grab" }} onPointerDown={onStickDown} />
      )}
    </g>
  );
}

/* ---------------- stepper ---------------- */

export function Stepper({ value, onChange, step = 0.5, min = 0, max = Infinity, suffix = "s" }) {
  return (
    <span className="hd-stepper">
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <span>{value}{suffix}</span>
      <button onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
    </span>
  );
}

