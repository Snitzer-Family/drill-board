// Live mini-boards for the settings sheet.
//
// Several settings describe a PICTURE — five themes you can't see without
// applying one, "Stretch to fill", "Tidy arrowheads", "Circled symbols" — and a
// sentence is the wrong medium for a picture. Each of those rows renders its
// options as small boards instead, and tapping the picture is how you choose.
//
// Two rules keep these honest:
//
//   1. Reuse the REAL renderer wherever one exists. Themes come from tokens(),
//      the rink from RinkMarkings, the pieces from PieceIcon, the zone overlay
//      from ZONES. A sample drawn from the same source as the board can't
//      describe a board that no longer looks like that.
//   2. Where no reusable renderer exists — routes and ink, whose real drawing is
//      welded to timing refs and hit paths in the animator — the scene is openly
//      SCHEMATIC: the idea, exaggerated to read at 44px, not a pixel copy. Line
//      weights here are chosen for legibility at thumbnail size, so they are not
//      the board's weights and are not meant to be.
//
// Node budget matters: this is a scrolling sheet on a bench phone, and
// RinkMarkings alone is ~40 elements. Only the scene whose subject IS the whole
// sheet (Theme) draws it; the rest draw the one or two markings they need. That
// is the difference between ~250 nodes and ~1200. The tile's ice is the SVG's
// CSS background, so no scene has to paint one.

import { useId } from "react";
import { RinkMarkings } from "./rink.jsx";
import { PieceIcon, ICONS } from "./icons.jsx";
import { ACT_GAP, ACT_R, ICON_SCALE } from "./constants.js";
import { ThemeCtx } from "./theme-react.jsx";
import { tokens, resolveTheme } from "./theme.js";
import { ZONES } from "./zones.js";

// A scene's window into the rink, in rink feet: [x, y, w, h]. Tiles are wider
// than they are tall (a full-width row is ~7:1, a three-across theme tile ~2:1),
// so every window is cut to roughly the shape of the tile it lands in.
// A tile is about 4:1, and it is the HEIGHT that binds — a window twice as tall
// as the tile's shape halves the scale, and 3 ft of label becomes 3 unreadable
// pixels. So windows here are short and wide even when the interesting thing is
// square: crop to a band across the subject rather than a box around it.
// the whole sheet, its surround, and a strip of bar beneath it. The bar is not
// decoration: Sheet and Light share an ice and a surround and differ only in
// their chrome, so without it two of the six tiles are the same picture.
const FULL_PAD = [-5, -5, 210, 105];
const WIDE = [0, 0, 120, 18];          // one tile spanning the row
const PAIR = [0, 0, 64, 34];           // one of two tiles side by side

// The six team colours are DSL data, not chrome (see the DATA vs CHROME note in
// theme.js), so a sample piece carries a literal exactly as a real piece would.
const RED = "#d7263d", BLUE = "#1f4fa3", PUCK = "#14171a", NET = "#c81e33";

const piece = (kind, extra) => ({ kind, color: RED, label: "", hand: "R", size: 1, path: [], ...extra });

/* ---------------- scene helpers ---------------- */

// A route line. Schematic: `w` is a thumbnail weight in rink feet, not segStroke's.
const Route = ({ d, color, w = 0.7, dash, ghost }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
    strokeDasharray={dash} opacity={ghost ? 0.3 : 1} />
);
// An arrowhead pointing along (ux, uy), sized off the line weight.
const Head = ({ x, y, ux, uy, color, w = 0.7 }) => {
  const s = 2.6 * Math.max(1, w / 0.7), px = -uy, py = ux;
  return (
    <path d={`M ${x - ux * s + px * s * 0.55} ${y - uy * s + py * s * 0.55} L ${x} ${y} L ${x - ux * s - px * s * 0.55} ${y - uy * s - py * s * 0.55}`}
      fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  );
};

/* ---------------- the scenes ---------------- */

// key -> { view, fit, bg(v, c), render(v, c, id) }
//   v  = the value this tile stands for
//   c  = live app context { T, ink, prefersDark, lineScale, markOpacity, rinkDim }
//   id = a document-unique id stem, for clipPath refs
// `fit` is "meet" everywhere: the tile's background is already the ice, so a
// letterboxed scene simply sits on more ice rather than showing a gutter, and
// nothing gets cropped away at the narrowest phone width.
export const SCENES = {

  // Every palette, rendered in its own palette. The whole point: you compare six
  // boards side by side without leaving the one you are on.
  theme: {
    view: FULL_PAD, fit: "meet",
    bg: (v, c) => themeOf(v, c)["surface-app"],
    render: (v, c, id) => {
      const T2 = themeOf(v, c);
      return (
        <ThemeCtx.Provider value={T2}>
          <defs><clipPath id={id}><rect x={0.5} y={0.5} width={199} height={84} rx={28} ry={28} /></clipPath></defs>
          <RinkMarkings clipId={id} />
          <PieceIcon p={piece("player", { label: "C" })} pos={{ x: 62, y: 42.5, a: 0 }} hitOff />
          <PieceIcon p={piece("puck", { color: PUCK })} pos={{ x: 78, y: 42.5, a: 0 }} hitOff />
          <rect x={0} y={90} width={200} height={13} rx={3} fill={T2["surface-bar"]} stroke={T2.border} strokeWidth={0.8} />
          {[0, 1, 2, 3].map(i => (
            <rect key={i} x={7 + i * 15} y={93} width={11} height={7} rx={2}
              fill={i === 0 ? T2.accent : T2["surface-raised"]} />
          ))}
          <rect x={70} y={95} width={122} height={3} rx={1.5} fill={T2["surface-sunken"]} />
        </ThemeCtx.Provider>
      );
    },
  },

  // Chrome, not ice: which end of the bar the controls sit at. The rink is drawn
  // only to say that it does NOT move — the commonest misreading of this setting.
  hand: {
    view: [0, 0, 64, 22], fit: "meet",
    bg: (v, c) => c.T["surface-app"],
    render: (v, c) => {
      const left = v === "left";
      return (
        <g>
          <rect x={2} y={1} width={60} height={11} rx={2.5} fill={c.T.ice} stroke={c.T["ice-boards"]} strokeWidth={0.6} />
          <line x1={32} y1={1} x2={32} y2={12} stroke={c.T["ice-line-red"]} strokeWidth={0.8} />
          <rect x={2} y={14} width={60} height={7} rx={1.8} fill={c.T["surface-bar"]} stroke={c.T.border} strokeWidth={0.4} />
          {[0, 1, 2].map(i => (
            <rect key={i} x={(left ? 3.4 : 41.4) + i * 6.4} y={15.2} width={5.2} height={4.6} rx={1.2}
              fill={i === 0 ? c.T.accent : c.T["surface-raised"]} />
          ))}
          {/* the flexible child of the real bar: the standing hint */}
          <rect x={left ? 24 : 3.4} y={16.7} width={36} height={1.8} rx={0.9} fill={c.T["surface-sunken"]} />
        </g>
      );
    },
  },

  // The one setting that is purely about proportion, so the sample has to be
  // about proportion: the same screen, the sheet filling it or letterboxed in it.
  // The circles are the tell — they go oval the moment the ice stretches.
  stretch: {
    view: [0, 0, 100, 58], fit: "meet",
    bg: (v, c) => c.T["surface-app"],
    render: (v, c) => {
      const bw = 88, bh = v === true ? 46 : bw * 85 / 200;
      const by = 6 + (46 - bh) / 2;
      const fx = bw / 200, fy = bh / 85;
      const X = f => 6 + f * fx, Y = f => by + f * fy;
      return (
        <g>
          <rect x={2} y={2} width={96} height={54} rx={4} fill={c.T["surface-app"]} stroke={c.T.border} strokeWidth={0.7} />
          <rect x={6} y={by} width={bw} height={bh} rx={5} fill={c.T.ice} stroke={c.T["ice-boards"]} strokeWidth={0.7} />
          <line x1={X(75)} y1={Y(0)} x2={X(75)} y2={Y(85)} stroke={c.T["ice-line-blue"]} strokeWidth={0.6} />
          <line x1={X(125)} y1={Y(0)} x2={X(125)} y2={Y(85)} stroke={c.T["ice-line-blue"]} strokeWidth={0.6} />
          <line x1={X(100)} y1={Y(0)} x2={X(100)} y2={Y(85)} stroke={c.T["ice-line-red"]} strokeWidth={0.6} />
          <ellipse cx={X(100)} cy={Y(42.5)} rx={15 * fx} ry={15 * fy} fill="none" stroke={c.T["ice-line-blue"]} strokeWidth={0.5} />
          <ellipse cx={X(31)} cy={Y(20.5)} rx={15 * fx} ry={15 * fy} fill="none" stroke={c.T["ice-line-red"]} strokeWidth={0.5} opacity={0.8} />
          <ellipse cx={X(169)} cy={Y(64.5)} rx={15 * fx} ry={15 * fy} fill="none" stroke={c.T["ice-line-red"]} strokeWidth={0.5} opacity={0.8} />
        </g>
      );
    },
  },

  // The shot call over the net. Colours are the splash's own literals.
  splash: {
    view: [4, 30.5, 40, 16], fit: "meet",
    render: (v, c) => (
      <g>
        <line x1={11} y1={20} x2={11} y2={65} stroke={c.T["ice-line-red"]} strokeWidth={0.4} />
        <path d="M 11 38.5 L 15.5 38.5 A 6 6 0 0 1 15.5 46.5 L 11 46.5 Z"
          fill={c.T["ice-crease"]} stroke={c.T["ice-line-red"]} strokeWidth={0.3} />
        <PieceIcon p={piece("net", { color: NET })} pos={{ x: 11, y: 42.5, a: 0 }} hitOff />
        <PieceIcon p={piece("puck", { color: PUCK })} pos={{ x: 24, y: 42.5, a: 0 }} hitOff />
        {v === true && (
          <text x={24} y={35.4} textAnchor="middle" fontSize={5} fontWeight={900} fill="#ff3b52"
            stroke="#fff" strokeWidth={0.25} paintOrder="stroke"
            style={{ userSelect: "none", fontFamily: "system-ui, sans-serif" }}>GOAL!</text>
        )}
      </g>
    ),
  },

  // The named-areas overlay, from the same ZONES table the board draws. A band
  // across the middle of the left end, which is the three zones whose labels sit
  // on the centre line — any taller a window and the names stop being readable.
  // Set larger than the board sets them: 2.7 ft is 3px at this scale.
  zones: {
    // the window runs past the goal line on the left because "Behind the net" is
    // labelled at x=6.5 and its name is wider than the ice it names
    view: [-11, 31, 95, 21], fit: "meet",
    render: (v, c) => {
      const shown = ZONES.filter(z => z.label && z.label.x < 78 && z.label.y > 33 && z.label.y < 50);
      return (
        <g>
          <line x1={11} y1={20} x2={11} y2={65} stroke={c.T["ice-line-red"]} strokeWidth={0.4} />
          <line x1={75} y1={20} x2={75} y2={65} stroke={c.T["ice-line-blue"]} strokeWidth={1} />
          <ellipse cx={31} cy={20.5} rx={15} ry={15} fill="none" stroke={c.T["ice-line-red"]} strokeWidth={0.4} opacity={0.8} />
          {v === true && (
            <g>
              {shown.map((z, i) => (
                <rect key={`r${i}`} x={z.x} y={z.y} width={z.w} height={z.h} rx={2}
                  fill="none" stroke="#3f74c8" strokeWidth={0.4} strokeDasharray="1.6 1.2" opacity={0.75} />
              ))}
              {shown.map((z, i) => (
                <text key={`t${i}`} x={z.label.x} y={z.label.y} textAnchor="middle" dominantBaseline="middle"
                  fontSize={4} fontWeight={700} fill="#8fb4e8"
                  style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
                    paintOrder: "stroke", stroke: "rgba(8,12,18,0.7)", strokeWidth: 0.9 }}>{z.name}</text>
              ))}
            </g>
          )}
        </g>
      );
    },
  },

  // Live, single tile: the stepper's value applied to a route, a fork and a mark.
  thickness: {
    view: WIDE, fit: "meet",
    render: (v, c) => {
      const w = 0.62 * c.lineScale;
      return (
        <g>
          <Route d="M 8 12 C 34 12 40 5 64 5" color={c.T["ice-ink"]} w={w} />
          <Head x={64} y={5} ux={1} uy={0} color={c.T["ice-ink"]} w={w} />
          <Route d="M 76 5 L 112 5" color={RED} w={w} dash={`${2.4 * c.lineScale} ${1.8 * c.lineScale}`} />
          <Route d="M 8 15 L 112 15" color={BLUE} w={w} />
        </g>
      );
    },
  },

  // Live, single tile, and the ONE scene that draws the real RinkMarkings at a
  // width worth the node cost: the thing being dimmed is the sheet itself, so a
  // schematic of it would be describing the setting rather than showing it. A
  // band from goal line to goal line — creases, dots, centre circle — with a
  // route over it, because what you are really judging is whether the drill
  // still reads against the rink.
  rinkdim: {
    // a 20ft strip across the waist of the sheet, which is 10:1 — the shape of a
    // full-width tile. Both creases, both goal lines, both blue lines and the
    // centre line fall inside it at nearly 2px per foot.
    view: [0, 32.5, 200, 20], fit: "meet",
    render: (v, c, id) => (
      <g>
        <defs><clipPath id={id}><rect x={0.5} y={0.5} width={199} height={84} rx={28} ry={28} /></clipPath></defs>
        <RinkMarkings clipId={id} dim={v} />
        <Route d="M 168 48 C 132 48 126 37 92 37" color={c.T["ice-ink"]} w={1.1} />
        <Head x={92} y={37} ux={-1} uy={0} color={c.T["ice-ink"]} w={1.1} />
      </g>
    ),
  },

  // The icon discs at a pass / shoot / pickup. Off is not just the discs hidden:
  // the route's gap closes to meet the arrow, which is the whole reason this is
  // a render choice and not a CSS one — so both tiles draw their own gap.
  badges: {
    view: [0, 0, 52, 13], fit: "meet",
    render: (v) => {
      const on = v === true, gap = on ? ACT_GAP : 0.8;
      const X = 27, Y = 7;   // where the player acts on the puck
      return (
        <g>
          <PieceIcon p={piece("player", { color: RED, label: "F1" })} pos={{ x: 5, y: 10, a: 0 }} hitOff />
          <Route d={`M 10 10 C 18 10 19 ${Y} ${X - gap} ${Y}`} color={RED} w={0.7} />
          <Head x={X - gap} y={Y} ux={1} uy={0} color={RED} w={0.7} />
          {on && (
            // the app's own badge geometry: the ICON_SCALE frame, an ACT_R disc,
            // and the icon on the same scale(0.178) translate(-12 -12) footing
            <g transform={`translate(${X} ${Y}) scale(${ICON_SCALE})`}>
              <circle cx={0} cy={0} r={ACT_R} fill="#fff" stroke={RED} strokeWidth={0.5} />
              <g style={{ color: RED }} transform="scale(0.178) translate(-12 -12)"
                fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                {ICONS.pass}
              </g>
            </g>
          )}
          {/* the pass leaving that waypoint, so the disc is marking something */}
          <Route d={`M ${X + (on ? gap : 1.6)} ${Y} L 49 ${Y}`} color={RED} w={0.6} dash="2 1.5" />
          <Head x={49} y={Y} ux={1} uy={0} color={RED} w={0.6} />
        </g>
      );
    },
  },

  // Live, single tile: the slider's value, over markings, so you can see how much
  // of the rink reads through the ink.
  opacity: {
    view: WIDE, fit: "meet",
    render: (v, c) => (
      <g>
        <line x1={38} y1={0} x2={38} y2={18} stroke={c.T["ice-line-blue"]} strokeWidth={2.2} />
        <line x1={82} y1={0} x2={82} y2={18} stroke={c.T["ice-line-red"]} strokeWidth={2.2} />
        <ellipse cx={60} cy={9} rx={17} ry={8} fill="none" stroke={c.T["ice-line-red"]} strokeWidth={0.6} opacity={0.8} />
        <g opacity={c.markOpacity}>
          <Route d="M 8 14 C 30 14 34 4 56 4 C 80 4 84 14 112 12" color={RED} w={2.2} />
        </g>
      </g>
    ),
  },

  // Whiteboard: the symbol sitting on a rink line, which is the case the disc
  // exists for. Real PieceIcon, so the disc is the board's disc.
  wbcircle: {
    view: [26, 37.5, 16, 10], fit: "meet",
    render: (v, c) => (
      <g>
        <line x1={34} y1={30} x2={34} y2={55} stroke={c.T["ice-line-red"]} strokeWidth={1} />
        <PieceIcon p={piece("player", { color: BLUE, label: "C", sym: "X" })}
          pos={{ x: 34, y: 42.5, a: 0 }} wb wbCircle={v === true} hitOff />
      </g>
    ),
  },

  // Whiteboard: the name tag under the symbol. Schematic — the board rotates the
  // tag to the clearest spot around the symbol, and there are no routes here for
  // it to dodge.
  wbnames: {
    view: [26, 37, 16, 10], fit: "meet",
    render: (v, c) => (
      <g>
        <PieceIcon p={piece("player", { color: BLUE, label: "LW", sym: "X" })}
          pos={{ x: 34, y: 40.4, a: 0 }} wb hitOff />
        {v === true && (
          <text x={34} y={45.6} textAnchor="middle" fontSize={3} fontWeight={700} fill={c.ink(BLUE)}
            style={{ userSelect: "none", fontFamily: "system-ui, sans-serif",
              paintOrder: "stroke", stroke: "rgba(255,255,255,0.9)", strokeWidth: 0.7 }}>LW</text>
        )}
      </g>
    ),
  },

  // Pressure: a varying stroke is an outline that swells and thins, a flat one is
  // the same path at one weight.
  pressure: {
    view: WIDE, fit: "meet",
    render: (v, c) => (
      <g>
        {v === true
          ? <path d="M 10 9 C 34 3 42 15 62 12 C 84 9 96 4 112 8 C 96 6.5 84 11.5 62 14.8 C 42 18.1 34 4.9 10 9 Z"
              fill={c.T["ice-ink"]} />
          : <path d="M 10 9 C 34 3 42 15 62 12 C 84 9 96 4 112 8" fill="none"
              stroke={c.T["ice-ink"]} strokeWidth={1.5} strokeLinecap="round" />}
      </g>
    ),
  },

  // A skater meeting a net: through it, or around it.
  avoid: {
    view: PAIR, fit: "meet",
    render: (v, c) => (
      <g>
        <PieceIcon p={piece("net", { color: NET })} pos={{ x: 34, y: 17, a: 180 }} hitOff />
        <Route d={v === true ? "M 6 17 C 20 17 22 4 34 4 C 46 4 48 17 58 17" : "M 6 17 L 58 17"}
          color={c.T["ice-ink"]} w={0.9} />
        <Head x={58} y={17} ux={1} uy={0} color={c.T["ice-ink"]} w={0.9} />
      </g>
    ),
  },

  // Whether the bend the skater takes is DRAWN. Off still avoids — the skater
  // just travels a line you can't see, which is the bit the sentence has to
  // explain and the picture can't.
  detour: {
    view: PAIR, fit: "meet",
    render: (v, c) => (
      <g>
        <PieceIcon p={piece("net", { color: NET })} pos={{ x: 34, y: 17, a: 180 }} hitOff />
        {v === true && <Route d="M 6 17 L 58 17" color={c.T["ice-ink"]} w={0.9} dash="2.4 1.8" ghost />}
        <Route d={v === true ? "M 6 17 C 20 17 22 4 34 4 C 46 4 48 17 58 17" : "M 6 17 L 58 17"}
          color={c.T["ice-ink"]} w={0.9} />
        <Head x={58} y={17} ux={1} uy={0} color={c.T["ice-ink"]} w={0.9} />
      </g>
    ),
  },

  // Three routes finishing in the same corner: nudged apart, or piled up.
  arrows: {
    view: PAIR, fit: "meet",
    render: (v, c) => {
      const starts = [[6, 6], [6, 17], [6, 28]];
      const ends = v === true ? [[50, 9], [55, 17], [50, 25]] : [[52, 16.2], [53, 17], [52, 17.8]];
      return (
        <g>
          {ends.map(([ex, ey], i) => {
            const [sx, sy] = starts[i];
            const dx = ex - sx, dy = ey - sy, d = Math.hypot(dx, dy) || 1;
            return (
              <g key={i}>
                <Route d={`M ${sx} ${sy} L ${ex} ${ey}`} color={c.T["ice-ink"]} w={0.8} />
                <Head x={ex} y={ey} ux={dx / d} uy={dy / d} color={c.T["ice-ink"]} w={0.8} />
              </g>
            );
          })}
        </g>
      );
    },
  },

  // A cue with three answers: all of them ghosted at once, or one picked at random.
  branches: {
    view: PAIR, fit: "meet",
    render: (v, c) => (
      <g>
        <Route d="M 6 17 L 26 17" color={c.T["ice-ink"]} w={0.9} />
        {v === true && (
          <g>
            <Route d="M 26 17 C 40 17 44 6 58 6" color={c.T["ice-ink"]} w={0.9} ghost />
            <Head x={58} y={6} ux={1} uy={0} color={c.T["ice-ink"]} w={0.9} />
            <Route d="M 26 17 C 40 17 44 28 58 28" color={c.T["ice-ink"]} w={0.9} ghost />
            <Head x={58} y={28} ux={1} uy={0} color={c.T["ice-ink"]} w={0.9} />
          </g>
        )}
        <Route d="M 26 17 L 58 17" color={c.T["ice-ink"]} w={0.9} ghost={v === true} />
        <Head x={58} y={17} ux={1} uy={0} color={c.T["ice-ink"]} w={0.9} />
        <circle cx={26} cy={17} r={1.7} fill={c.T.ice} stroke={c.T["ice-ink"]} strokeWidth={0.7} />
      </g>
    ),
  },
};

// "auto" is not a palette — it is whichever one the phone is asking for right
// now, so its tile has to resolve the same way the app does.
function themeOf(v, c) {
  return tokens(v === "auto" ? resolveTheme("auto", c.prefersDark) : v);
}

/* ---------------- the tile ---------------- */

// One board. `id` has to be document-unique because RinkMarkings clips through a
// url(#…) reference and the settings sheet renders AFTER the main board — two
// elements answering to "boards" and every tile would silently inherit the app's
// stretched clip.
function Tile({ scene, value, ctx, id }) {
  const s = SCENES[scene];
  if (!s) return null;
  return (
    <svg className="hd-pvsvg" viewBox={s.view.join(" ")} aria-hidden="true"
      preserveAspectRatio={s.fit === "slice" ? "xMidYMid slice" : "xMidYMid meet"}
      style={s.bg ? { background: s.bg(value, ctx) } : undefined}>
      {s.render(value, ctx, id)}
    </svg>
  );
}

/* ---------------- the rows ---------------- */

// A settings row whose OPTIONS are boards: one tile per value, and the tile is
// the control. This is why these rows can't be a PrefToggle — that makes the
// whole row one button, and a button can't contain buttons. Each tile is its own
// target instead, still comfortably over 44pt, and keeps a text label so the row
// is never picture-only.
// `dim` greys the row where something else has taken the decision away — the
// tiles still work and still show the truth, they just aren't what's on screen
// right now (Action badges under whiteboard mode). Same signal PrefRow uses.
export function PrefPick({ title, desc, scene, value, set, opts, ctx, dim }) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className={`hd-pref${dim ? " dim" : ""}`}>
      <div className="hd-prefhead"><span className="hd-preftitle">{title}</span></div>
      {desc && <div className="hd-prefdesc">{desc}</div>}
      <div className="hd-pvrow" role="radiogroup" aria-label={title}>
        {opts.map(([v, label]) => (
          <button key={String(v)} className={`hd-pvtile${value === v ? " on" : ""}`}
            role="radio" aria-checked={value === v} onClick={() => set(v)}>
            <Tile scene={scene} value={v} ctx={ctx} id={`pv-${uid}-${String(v)}`} />
            <span className="hd-pvlbl">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A settings row that keeps its own control — a stepper or a slider, where the
// value is continuous and a pair of tiles would be a lie — and shows a single
// board of where that control currently stands.
export function PrefSample({ title, desc, scene, value, ctx, control, children }) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className="hd-pref">
      <div className="hd-prefhead">
        <span className="hd-preftitle">{title}</span>
        {control}
      </div>
      {desc && <div className="hd-prefdesc">{desc}</div>}
      <div className="hd-pvrow one">
        <Tile scene={scene} value={value} ctx={ctx} id={`pv-${uid}`} />
      </div>
      {children && <div className="hd-prefctl">{children}</div>}
    </div>
  );
}
