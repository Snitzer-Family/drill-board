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

export function PieceIcon({ p, pos, onDown, selected, dim, xf, thDeg = 0, onStickDown, swing = 0 }) {
  const frame = xf || `translate(${pos.x} ${pos.y}) rotate(${pos.a || 0}) scale(${ICON_SCALE})`;
  let body;
  if (p.kind === "puck")
    body = <circle cx={0} cy={0} r={1.5} fill="#14171a" stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.4} pointerEvents="none" />;
  else if (p.kind === "net") {
    // top-down goal: mouth opens toward local +x, frame behind toward -x (units
    // are icon-scaled, so ~±3.75 ≈ a 6 ft goal mouth)
    const red = p.color || "#c81e33";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-5.4} y={-4.6} width={6.2} height={9.2} rx={1} fill="none" stroke="#ffd447" strokeWidth={0.4} strokeDasharray="1.2 0.9" />}
        <path d="M 0 -3.75 L -4.6 -3 L -4.6 3 L 0 3.75 Z" fill="rgba(210,225,240,0.16)" stroke={red} strokeWidth={0.5} strokeLinejoin="round" />
        <path d="M 0 -3.75 L -4.6 3 M 0 3.75 L -4.6 -3 M 0 -1.3 L -4.6 -1 M 0 1.3 L -4.6 1" stroke={red} strokeWidth={0.18} opacity={0.5} />
        <circle cx={0} cy={-3.75} r={0.7} fill={red} />
        <circle cx={0} cy={3.75} r={0.7} fill={red} />
      </g>
    );
  } else if (p.kind === "cone")
    body = (
      <path d="M 0 -2.4 L 2.2 1.8 L -2.2 1.8 Z"
        fill={p.color} stroke={selected ? "#ffd447" : "#fff"} strokeWidth={0.35} strokeLinejoin="round" pointerEvents="none" />
    );
  else if (p.kind === "bumper") {
    // ~6 ft foam pad laid on the ice; runs along local +x, rotate with facing
    const foam = p.color || "#4d6fa6";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-4.3} y={-1.05} width={8.6} height={2.1} rx={1.05} fill="none" stroke="#ffd447" strokeWidth={0.35} strokeDasharray="1.2 0.9" />}
        <rect x={-3.75} y={-0.6} width={7.5} height={1.2} rx={0.6} fill={foam} stroke="#fff" strokeWidth={0.28} />
        <path d="M -1.85 -0.5 L -1.85 0.5 M 0 -0.5 L 0 0.5 M 1.85 -0.5 L 1.85 0.5" stroke="#fff" strokeWidth={0.16} opacity={0.4} />
      </g>
    );
  } else if (p.kind === "deker") {
    // ~2 ft stickhandling gate: a stick shaft on two pegs; puck goes under it,
    // across the gap (local x). the shaft runs along local y, rotate with facing.
    const wood = p.color || "#c79a4e";
    body = (
      <g pointerEvents="none">
        {selected && <rect x={-1.5} y={-1.7} width={3} height={3.4} rx={0.6} fill="none" stroke="#ffd447" strokeWidth={0.35} strokeDasharray="1.2 0.9" />}
        <line x1={-1.35} y1={0} x2={1.35} y2={0} stroke="#1d2126" strokeWidth={0.18} opacity={0.32} strokeDasharray="0.4 0.35" />
        <circle cx={0} cy={-0.8} r={0.4} fill="#e0731d" stroke="#fff" strokeWidth={0.16} />
        <circle cx={0} cy={0.8} r={0.4} fill="#e0731d" stroke="#fff" strokeWidth={0.16} />
        <rect x={-0.26} y={-1.3} width={0.52} height={2.6} rx={0.26} fill={wood} stroke="#5a4420" strokeWidth={0.18} />
        <path d="M -0.1 -1.25 Q 0.85 -1.5 1.05 -0.75" fill="none" stroke={wood} strokeWidth={0.5} strokeLinecap="round" />
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
  return (
    <g opacity={dim ? 0.92 : 1} transform={frame}>
      {body}
      {p.kind === "net"
        ? <rect x={-5} y={-4.2} width={5.5} height={8.4} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
        : p.kind === "bumper"
        ? <rect x={-4} y={-1.2} width={8} height={2.4} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
        : p.kind === "deker"
        ? <rect x={-1.6} y={-1.8} width={3.2} height={3.6} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />
        : <circle cx={0} cy={0} r={p.kind === "puck" ? 3.4 : 6.8} fill="transparent" onPointerDown={onDown} style={{ cursor: "grab" }} />}
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

