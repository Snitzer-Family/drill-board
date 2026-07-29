// Rink markings, with yFix roundness correction for fill-mode stretch.
//
// Every colour here is a --db-ice-* token: these are the rink SURFACE, not
// drill data, so they follow the theme. Player/implement colours are stored on
// the piece and stay literal — see the DATA vs CHROME note in theme.js.

import { useTheme } from "./theme-react.jsx";

/* ---------------- rink markings ---------------- */

// clipId names the boards clipPath to cut against. It exists because that
// reference is document-global: the settings sheet's preview tiles render AFTER
// the main board, so with one hardcoded "boards" every tile would silently clip
// against the app's — which carries the fill-mode stretch in its ry.
export function RinkMarkings({ yFix = 1, clipId = "boards" }) {
  const T = useTheme();
  const red = T["ice-line-red"], blue = T["ice-line-blue"];
  const dots = [];
  // end-zone faceoff spots: regulation 20' from the goal line (x=31/169),
  // 44' apart (y=20.5/64.5), 15' circles with hash marks (2' long, ~5'7" apart).
  // Plus the four L-shaped player restraint brackets: a 4' leg parallel to the
  // side boards (x±2 → x±6, i.e. starting 1' outside the spot) with a 3' leg
  // parallel to the goal line rising at its INNER end (the one nearest the
  // spot) and flaring away from the dot's centre line. Regulation puts
  // the long legs 18" apart, but at full-rink zoom on a phone that gap is ~3px
  // between two ~2px lines and the pair smears into one — so they sit 3' apart.
  [[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]].forEach(([x, y]) =>
    dots.push(
      <g key={`fo${x}-${y}`}>
        <ellipse cx={x} cy={y} rx={15} ry={15 * yFix} fill="none" stroke={red} strokeWidth={0.4} opacity={0.8} />
        <ellipse cx={x} cy={y} rx={1} ry={yFix} fill={red} />
        <path d={`M ${x - 2.8} ${y - 17 * yFix} V ${y - 15 * yFix} M ${x + 2.8} ${y - 17 * yFix} V ${y - 15 * yFix} M ${x - 2.8} ${y + 15 * yFix} V ${y + 17 * yFix} M ${x + 2.8} ${y + 15 * yFix} V ${y + 17 * yFix}`}
          stroke={red} strokeWidth={0.4} opacity={0.8} fill="none" />
        <path d={`M ${x + 6} ${y - 1.5 * yFix} H ${x + 2} V ${y - 4.5 * yFix} M ${x + 6} ${y + 1.5 * yFix} H ${x + 2} V ${y + 4.5 * yFix} M ${x - 6} ${y - 1.5 * yFix} H ${x - 2} V ${y - 4.5 * yFix} M ${x - 6} ${y + 1.5 * yFix} H ${x - 2} V ${y + 4.5 * yFix}`}
          stroke={red} strokeWidth={0.4} opacity={0.8} fill="none" />
      </g>
    ));
  [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]].forEach(([x, y]) =>
    dots.push(<ellipse key={`nz${x}-${y}`} cx={x} cy={y} rx={1} ry={yFix} fill={red} />));
  const cr = 6 / Math.max(0.2, yFix);   // crease arc depth corrected to stay round
  const rr = 10 / Math.max(0.2, yFix);  // referee crease radius, same correction
  return (
    <g clipPath={`url(#${clipId})`}>
      <rect x={0} y={0} width={200} height={85} fill={T.ice} />
      {/* regulation goalie crease: 8' wide, 4.5' straight sides, 6' arc.
          Its own token, not the blue LINE colour: it's a filled region, so dark
          mode has to hold it back from the lifted line blue or the crease reads
          as a glowing slab. */}
      <path d={`M 11 38.5 L 15.5 38.5 A ${cr} 6 0 0 1 15.5 46.5 L 11 46.5 Z`} fill={T["ice-crease"]} stroke={red} strokeWidth={0.3} />
      <path d={`M 189 38.5 L 184.5 38.5 A ${cr} 6 0 0 0 184.5 46.5 L 189 46.5 Z`} fill={T["ice-crease"]} stroke={red} strokeWidth={0.3} />
      {/* referee crease: 10' semicircle at the scorekeeper's bench */}
      <path d={`M ${100 - rr} 85 A ${rr} 10 0 0 1 ${100 + rr} 85`} fill="none" stroke={red} strokeWidth={0.3} opacity={0.8} />
      <line x1={11} y1={0} x2={11} y2={85} stroke={red} strokeWidth={0.4} />
      <line x1={189} y1={0} x2={189} y2={85} stroke={red} strokeWidth={0.4} />
      <line x1={75} y1={0} x2={75} y2={85} stroke={blue} strokeWidth={1} />
      <line x1={125} y1={0} x2={125} y2={85} stroke={blue} strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke={red} strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke={T["ice-dash"]} strokeWidth={0.25} strokeDasharray="1.6 1.6" />
      <ellipse cx={100} cy={42.5} rx={15} ry={15 * yFix} fill="none" stroke={blue} strokeWidth={0.4} />
      {/* centre dot: regulation is a 12" (r=0.5) blue spot, but that lands on a
          1'-wide red line and vanishes at full-rink zoom — sized to match every
          other faceoff dot instead */}
      <ellipse cx={100} cy={42.5} rx={1} ry={yFix} fill={blue} />
      {dots}
      <rect x={0.5} y={0.5} width={199} height={84} rx={28} ry={28 * yFix} fill="none" stroke={T["ice-boards"]} strokeWidth={1} />
    </g>
  );
}

