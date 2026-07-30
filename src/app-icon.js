// The app icon: TWO renditions of one idea, switched by size.
//
// Large, it is an end zone with a route driving at the net — a drill plan, which
// is what the app makes. Small, it is the same sheet holding nothing but the
// goalie crease, because a diagram cannot be a favicon.
//
// That second rendition is not a compromise, it is the whole lesson: at 16px one
// rink foot is 0.19 device px, so the goal line lands on half a pixel and the
// faceoff ring on half a pixel, and the detail tier does not shrink — it SMEARS,
// three sub-pixel marks averaging into mud. Shrinking the diagram was tried
// three ways (thinning the mark set, thickening the strokes, scaling the crease)
// and all three were indistinct. Filled shapes survive downsampling; outlines on
// near-white ice do not. So below 40px the icon inverts to a filled tile and
// draws its own geometry. Do not try to reunify them.
//
// This is the ONLY definition of the artwork. scripts/build-icons.mjs turns it
// into public/icon.svg and the three PNGs; tests/app-icon.mjs pins the two
// together. Nothing here is imported by the app at runtime.
//
// Plain ESM importing ONLY ./theme.js, for the same reason drill-svg.js is:
// node has to be able to load it with no bundler.
//
// COLOURS ARE LITERAL ON PURPOSE. A favicon, and an SVG rasterised to PNG, get
// no host cascade at all — var(--db-*) resolves to nothing and the icon renders
// blank. So the values are read out of THEMES here and baked in, exactly as
// drill-svg.js bakes its fallbacks. Never hardcode one; the test greps for it.
//
// GEOMETRY IS IN RINK FEET: 1 unit = 1 foot, and the square is the 85ft width
// of the sheet. STROKE WEIGHTS ARE NOT — every weight here is an icon weight,
// and the positions are moved for composition (the goal line sits at x=20, not
// the regulation 11, to leave the crease room to read). Do not "correct" them
// against rink.jsx.

import { THEMES } from "./theme.js";

// The tile is the boards: the app's 28ft corner radius, scaled to the crop.
// A 6-wide stroke centred on this rect puts its outer edge at exactly 0 and 85,
// so the silhouette fills the viewBox with nothing clipped.
const TILE = `x="3" y="3" width="79" height="79" rx="26"`;
const BOARDS_W = 6;

// Below this the small rendition takes over. 40 rather than 24 because 32px is a
// retina 16 and the diagram was no better there than at 16.
const SMALL_MAX = 40;

/* ---------------- the route: a cubic, and an arrowhead aimed down its tangent ---------------- */

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// de Casteljau: the sub-curve from 0..t, plus the point and tangent at t
function split(c, t) {
  const [p0, p1, p2, p3] = c;
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t);
  const e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
  return { sub: [p0, a, e, g], at: g, dir: [f[0] - e[0], f[1] - e[1]] };
}
const round = n => String(Math.round(n * 100) / 100);
const P = p => `${round(p[0])} ${round(p[1])}`;

// The arrowhead is what makes this a DRILL rather than a swoosh, so it is much
// wider than the shaft, and the shaft stops short of the tip so the two read as
// one arrow instead of a line with a triangle parked on it. The head is derived
// from the curve's own end tangent — move the curve and the head follows.
function route(c, colour, { shaft, head, halfW, trim }) {
  const { sub } = split(c, trim);
  const { at: tip, dir } = split(c, 1);
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const u = [dir[0] / len, dir[1] / len];
  const n = [-u[1], u[0]];
  const back = [tip[0] - u[0] * head, tip[1] - u[1] * head];
  const wing = s => [back[0] + n[0] * halfW * s, back[1] + n[1] * halfW * s];
  return [
    `<path d="M ${P(sub[0])} C ${P(sub[1])} ${P(sub[2])} ${P(sub[3])}"`,
    `      fill="none" stroke="${colour}" stroke-width="${shaft}" stroke-linecap="round"/>`,
    `<path d="M ${P(tip)} L ${P(wing(1))} L ${P(wing(-1))} Z" fill="${colour}"/>`,
  ].join("\n");
}

/* ---------------- large: the drill plan ---------------- */

// Bowed, so it reads as a skated path rather than a generic arrow, and it
// crosses the faceoff circle as a CHORD. Two near-misses are baked into these
// numbers: an arc that stays concentric with the circle reads as a spiral or an
// "@", and one that cuts the circle through its centre reads as a "no" slash.
const DRIVE = [[76, 72], [64, 70], [46, 52], [33, 42]];

// Hierarchy is the whole design. Ranked loudest to quietest: the boards carry
// the silhouette, the route is the hero, the goal line and crease support it,
// and the faceoff circle is texture. An earlier cut drew all four at the same
// weight and the result read as a face — two round eyes and an eyebrow.
function markings(T) {
  const red = T["ice-line-red"];
  return [
    // the far blue line, clipped to a sliver by the corner radius. Red line
    // left + blue line right is the two-glance signature of a rink.
    `<line class="blue" x1="79" y1="0" x2="79" y2="85" stroke="${T["ice-line-blue"]}" stroke-width="4"/>`,
    `<line class="red" x1="20" y1="0" x2="20" y2="85" stroke="${red}" stroke-width="3"/>`,
    `<path class="crease" d="M 20 33.5 L 23 33.5 A 7 9 0 0 1 23 51.5 L 20 51.5 Z"`,
    `      fill="${T["ice-crease"]}" stroke="${red}" stroke-width="1.6"/>`,
    `<g opacity="0.75">`,
    `  <circle class="red" cx="52" cy="64" r="16" fill="none" stroke="${red}" stroke-width="3"/>`,
    `  <circle class="dot" cx="52" cy="64" r="2.8" fill="${red}"/>`,
    `</g>`,
    route(DRIVE, T["mode-draw"], { shaft: 8, head: 14, halfW: 9.5, trim: 0.78 }),
  ].join("\n");
}

function plan(T, clipId) {
  return [
    `<defs><clipPath id="${clipId}"><rect ${TILE}/></clipPath></defs>`,
    `<g clip-path="url(#${clipId})">`,
    `  <rect class="ice" ${TILE} fill="${T.ice}"/>`,
    indent(markings(T), 2),
    `</g>`,
    `<rect class="boards" ${TILE} fill="none" stroke="${T["ice-boards"]}" stroke-width="${BOARDS_W}"/>`,
  ].join("\n");
}

/* ---------------- small: the same sheet, holding only the crease ---------------- */

// Deliberately built from the plan's own TILE and BOARDS_W, so the small mark is
// not a different picture wearing the same colours — it is literally the large
// icon's rink with everything but the crease taken out of it. One set of
// silhouette numbers, one place to change them.
//
// Blue on ice is 7.5:1, better than any inverted tile managed, and the slate
// boards ring is what gives the sheet an edge on a light tab strip: ice #f5fafd
// and a light browser chrome are within a hair of each other, so without the
// ring the tile dissolves and the crease floats unframed.
//
// NO CLASSES INSIDE THIS GROUP, and that is load-bearing: reusing `.ice`,
// `.boards` and `.crease` would drag the dark-mode block onto it and flip the
// sheet dark, which puts the crease at 2.2:1 against dark ice. Measured, not
// guessed. A white sheet already reads on a dark tab strip, so this rendition
// wants no dark variant at all.
//
// The crease is the plan's shape at icon weight with no goal line and no red
// outline — a 1.6 stroke is sub-pixel noise at 16px.
//
// IT READS AS A LETTER D, AND THAT IS THE ACCEPTED TRADE. A flat-backed D IS a
// D, and the context that would disambiguate it is exactly what has to go to
// survive 16px — adding the goal line back makes it read as a lowercase "b",
// which is worse; that was tried. So it doubles as a monogram for the app's own
// initial. Don't "fix" this toward rink accuracy; accuracy is what makes it
// illegible at this size.
//
// Centred on its own mass, not on its flat back: the shape runs bx → bx+SIDE+r,
// so bx is set to put the midpoint of THAT span on 42.5. Centring the flat edge
// instead leaves the whole D sitting visibly left of centre.
const CR_H = 40, CR_SIDE = 12;

// display="none" is a PRESENTATION attribute, and the media query below turns it
// back on. That ordering is deliberate: CSS beats presentation attributes, so
// anywhere the <style> is stripped this group stays hidden and the plan renders
// — rather than the small glyph painting over the top of it.
function creaseSheet(L) {
  const r = CR_H / 2;
  const bx = round(42.5 - (CR_SIDE + r) / 2);           // the flat back
  const ax = round(42.5 - (CR_SIDE + r) / 2 + CR_SIDE); // where the arc starts
  const top = round(42.5 - r), bot = round(42.5 + r);
  return [
    `<rect ${TILE} fill="${L.ice}"/>`,
    `<path d="M ${bx} ${top} L ${ax} ${top} A ${r} ${r} 0 0 1 ${ax} ${bot} L ${bx} ${bot} Z"`,
    `      fill="${L["ice-crease"]}"/>`,
    `<rect ${TILE} fill="none" stroke="${L["ice-boards"]}" stroke-width="${BOARDS_W}"/>`,
  ].join("\n");
}

function tiny(L) {
  return [
    `<g class="tiny" display="none">`,
    indent(creaseSheet(L), 2),
    `</g>`,
  ].join("\n");
}

/* ---------------- the stylesheet inside the SVG ---------------- */

// A favicon cannot inherit a stylesheet, so it carries its own. CSS beats
// presentation attributes, so the light values stay the no-CSS default and
// these override.
//
// The route is absent from the dark block on purpose: mode-draw is the same
// value in both themes and clears 3:1 on both sheets, so one amber serves both.
function styles() {
  const D = THEMES.dark;
  return [
    `@media (prefers-color-scheme: dark) {`,
    `  .ice { fill: ${D.ice} }`,
    `  .boards { stroke: ${D["ice-boards"]} }`,
    `  .red { stroke: ${D["ice-line-red"]} }`,
    `  .dot { fill: ${D["ice-line-red"]} }`,
    `  .crease { fill: ${D["ice-crease"]}; stroke: ${D["ice-line-red"]} }`,
    `  .blue { stroke: ${D["ice-line-blue"]} }`,
    `}`,
    // Inside an SVG a width query is evaluated against the SVG's OWN viewport,
    // so this fires when the browser rasterises the icon into a small tab slot
    // and not when it draws it large. Purely additive: a browser that
    // rasterises large and downsamples never matches, and gets the plan.
    `@media (max-width: ${SMALL_MAX}px) {`,
    `  .plan { display: none }`,
    `  .tiny { display: block }`,
    `}`,
  ].join("\n");
}

/* ---------------- the two variants ---------------- */

const indent = (s, n) => s.split("\n").map(l => " ".repeat(n) + l).join("\n");

// "tab"   — the browser favicon. Both renditions, switched by the media query,
//           and the plan adapts to the OS colour scheme.
// "bleed" — the source for the large PNGs. The plan ONLY: these are 180px and
//           up, so the small rendition would be wrong, and a PNG cannot carry a
//           media query anyway. OPAQUE and full-bleed, because iOS composites a
//           transparent apple-touch-icon against BLACK and then applies its own
//           squircle mask, so the art is inset 7.5% and the square is filled
//           edge to edge.
// "small"  — the source for favicon.ico's 16/32/48. The crease sheet on its own,
//           because **iOS Safari does not support SVG favicons at all** and so
//           never sees the media query above. Without a raster fallback carrying
//           this rendition, Safari has no favicon candidate whatsoever and shows
//           nothing. Transparent outside the corners, unlike "bleed": an
//           ordinary favicon is not mask-composited, so alpha is safe here.
export function appIconSvg(variant) {
  if (!["tab", "bleed", "small"].includes(variant))
    throw new Error(`appIconSvg: unknown variant ${variant}`);
  const T = THEMES.light;

  if (variant === "small")
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 85" role="img" aria-label="DrillBoard">`,
      creaseSheet(T),
      `</svg>`,
      ``,
    ].join("\n");

  if (variant === "tab")
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 85" role="img" aria-label="DrillBoard">`,
      `<style>`,
      styles(),
      `</style>`,
      `<g class="plan">`,
      indent(plan(T, "db-boards-tab"), 2),
      `</g>`,
      tiny(T),
      `</svg>`,
      ``,
    ].join("\n");

  // The field is the dark app surface, not the light one: a near-white icon
  // vanishes on a light wallpaper, and the dark surround is what the iOS mask
  // eats into instead of the rink.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="DrillBoard">`,
    `<rect width="100" height="100" fill="${THEMES.dark["surface-app"]}"/>`,
    `<g transform="translate(7.5 7.5)">`,
    indent(plan(T, "db-boards-bleed"), 2),
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}
