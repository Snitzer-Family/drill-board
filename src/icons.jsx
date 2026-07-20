// Piece icons (screen-true frames), stepper control, diagnostics overlay.
import { useState, useRef, useEffect } from "react";
import { APP_VERSION, BUILD_STAMP, ICON_SCALE } from "./constants.js";

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

export function PieceIcon({ p, pos, onDown, selected, dim, xf, thDeg = 0, onStickDown, swing = 0, reach = 0 }) {
  const frame = xf || `translate(${pos.x} ${pos.y}) rotate(${pos.a || 0}) scale(${ICON_SCALE})`;
  let body;
  if (p.kind === "puck")
    body = <circle cx={0} cy={0} r={1.5} fill="#14171a" stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.4} pointerEvents="none" />;
  else if (p.kind === "net") {
    // top-down hockey goal: the mouth (goal line) faces local +x, the caged
    // frame bows back toward -x with a rounded back. ~±3.75 ≈ a 6 ft mouth.
    const red = p.color || "#c81e33";
    // mouth (goal line) faces +x at x=0; the cage bows back to a rounded back at -x
    const CAGE = "M 0 -3.75 L -1.7 -3.75 Q -4.15 -3.75 -4.15 -1.5 L -4.15 1.5 Q -4.15 3.75 -1.7 3.75 L 0 3.75";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-4.8} y={-4.5} width={5.4} height={9} rx={1} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
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
  } else if (p.kind === "cone")
    body = (
      <path d="M 0 -2.4 L 2.2 1.8 L -2.2 1.8 Z"
        fill={p.color} stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.35} strokeLinejoin="round" pointerEvents="none" />
    );
  else if (p.kind === "bumper") {
    // foam barrier pad laid on the ice; runs along local +x, rotate with facing
    // (drawn oversize vs true 6 ft so it reads on the full-sheet canvas)
    const foam = p.color || "#4d6fa6";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-7.6} y={-1.5} width={15.2} height={3} rx={1.5} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <rect x={-7} y={-0.95} width={14} height={1.9} rx={0.95} fill={foam} stroke="#fff" strokeWidth={0.3} />
        <path d="M -3.5 -0.75 L -3.5 0.75 M 0 -0.75 L 0 0.75 M 3.5 -0.75 L 3.5 0.75" stroke="#fff" strokeWidth={0.18} opacity={0.4} />
      </g>
    );
  } else if (p.kind === "deker") {
    // stickhandling gate: a stick shaft on two pegs; puck goes under it, across
    // the gap (local x). the shaft runs along local y, rotate with facing.
    const wood = p.color || "#c79a4e";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-2.5} y={-3.1} width={5} height={6.2} rx={0.8} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <line x1={-2.6} y1={0} x2={2.6} y2={0} stroke="#1d2126" strokeWidth={0.22} opacity={0.32} strokeDasharray="0.6 0.5" />
        <circle cx={0} cy={-1.6} r={0.55} fill="#e0731d" stroke="#fff" strokeWidth={0.2} />
        <circle cx={0} cy={1.6} r={0.55} fill="#e0731d" stroke="#fff" strokeWidth={0.2} />
        <rect x={-0.32} y={-2.6} width={0.64} height={5.2} rx={0.32} fill={wood} stroke="#5a4420" strokeWidth={0.2} />
        <path d="M -0.15 -2.5 Q 1.25 -2.85 1.55 -1.7" fill="none" stroke={wood} strokeWidth={0.65} strokeLinecap="round" />
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
        <path d="M 1.3 0 C 1.3 -2.2 0.6 -3.2 -0.5 -3.3 C -2.0 -3.4 -2.8 -2.2 -2.8 -1.1 L -2.8 1.1 C -2.8 2.2 -2.0 3.4 -0.5 3.3 C 0.6 3.2 1.3 2.2 1.3 0 Z"
          fill={p.color} stroke="#fff" strokeWidth={0.32} />
        <path d="M -1.5 -3.15 Q -0.55 0 -1.5 3.15" fill="none" stroke="#fff" strokeWidth={0.42} opacity={0.75} />
        <g transform={`${p.hand === "L" ? "scale(1 -1) " : ""}${swing ? `rotate(${swing} 1 0)` : ""}`.trim() || undefined}>
          <path d="M -0.3 -2.5 C 0.7 -2.3 1.4 -1.4 1.7 -0.5" fill="none" stroke={p.color} strokeWidth={1.05} strokeLinecap="round" />
          <path d="M -0.3 2.5 C 0.9 2.4 1.9 2.0 2.6 1.5" fill="none" stroke={p.color} strokeWidth={1.05} strokeLinecap="round" />
          <circle cx={1.8} cy={-0.3} r={0.75} fill={dark} />
          {/* the stick (shaft + blade + lower hand) pivots around the top hand
             for a stickhandle reach; the arms stay put so nothing detaches */}
          <g transform={reach ? `rotate(${reach} 1.8 -0.3)` : undefined}>
            <path d="M 1.75 -0.35 L 4.35 2.75" stroke={dark} strokeWidth={0.4} strokeLinecap="round" />
            <path d="M 4.2 2.6 L 5.6 2.45" stroke={dark} strokeWidth={0.8} strokeLinecap="round" />
            <circle cx={2.7} cy={1.55} r={0.75} fill={dark} />
          </g>
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

export function Stepper({ value, onChange, step = 0.5, min = 0, suffix = "s" }) {
  return (
    <span className="hd-stepper">
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <span>{value}{suffix}</span>
      <button onClick={() => onChange(+(value + step).toFixed(2))}>+</button>
    </span>
  );
}

