// The app icon: an end zone holding nothing but the goalie crease.
//
// ONE picture, in two wrappers that differ only in what the platform needs:
//
//   favicon — transparent outside the rounded corners. icon.svg, and the
//             16/32/48 frames inside favicon.ico.
//   bleed   — OPAQUE and full-bleed, art inset 7.5%. apple-touch-icon and the
//             manifest's 192/512.
//
// Two things used to live here and are deliberately gone. A drill plan — an end
// zone with a route driving at the net — was the large rendition; it is now
// unused and deleted rather than kept as art nothing draws (it is in git history
// if it is ever wanted back). And the two renditions used to be swapped inside
// one svg by a size media query, which took an embedded stylesheet with it.
//
// Why the plan is not the icon at any size: at 16px one rink foot is 0.19 device
// px, so the goal line lands on half a pixel and the fine markings don't shrink,
// they average into mud. Shrinking it was tried three ways — fewer marks,
// thicker strokes, a scaled crease — and all three were indistinct. Filled
// shapes survive downsampling; outlines on near-white ice do not.
//
// This is the ONLY definition of the artwork. scripts/build-icons.mjs turns it
// into public/icon.svg, favicon.ico and the three PNGs; tests/app-icon.mjs pins
// the two together. Nothing here is imported by the app at runtime.
//
// Plain ESM importing ONLY ./theme.js, for the same reason drill-svg.js is:
// node has to be able to load it with no bundler.
//
// COLOURS ARE LITERAL ON PURPOSE. A favicon, and an SVG rasterised to PNG, get
// no host cascade at all — var(--db-*) resolves to nothing and the icon renders
// blank. So the values are read out of THEMES here and baked in, exactly as
// drill-svg.js bakes its fallbacks. Never hardcode one; the test greps for it.
//
// NOTHING HERE ADAPTS TO THE OS COLOUR SCHEME, and that is measured rather than
// forgotten. Flipping the sheet to dark ice puts the crease at 2.2:1 against it;
// the light sheet reads on a dark tab strip as it is, because a white tile is
// exactly what stands out there. There is no stylesheet in either wrapper — see
// the note on the favicon variant below for why that is load-bearing.
//
// GEOMETRY IS IN RINK FEET: 1 unit = 1 foot, and the square is the 85ft width of
// the sheet. STROKE WEIGHTS ARE NOT — they are icon weights. Don't reconcile
// them with rink.jsx.

import { THEMES } from "./theme.js";

// The tile is the boards: the app's 28ft corner radius, scaled to the crop.
// A 6-wide stroke centred on this rect puts its outer edge at exactly 0 and 85,
// so the silhouette fills the viewBox with nothing clipped.
const TILE = `x="3" y="3" width="79" height="79" rx="26"`;
const BOARDS_W = 6;

const indent = (s, n) => s.split("\n").map(l => " ".repeat(n) + l).join("\n");
const round = n => String(Math.round(n * 100) / 100);

/* ---------------- the sheet ---------------- */

// The crease: flat back where the goal line would be, short straight sides, then
// the arc bulging out into the ice. rink.jsx's shape at icon weight, with no
// goal line and no red outline — a 1.6 stroke is sub-pixel noise at 16px.
//
// IT READS AS A LETTER D, AND THAT IS THE ACCEPTED TRADE. A flat-backed D IS a
// D, and the context that would disambiguate it is exactly what has to go to
// survive 16px — adding the goal line back makes it read as a lowercase "b",
// which is worse; that was tried. So it doubles as a monogram for the app's own
// initial. Don't "fix" this toward rink accuracy; accuracy is what makes it
// illegible at this size.
//
// Blue on ice is 7.5:1. The slate boards ring is not decoration: ice #f5fafd and
// a light browser chrome are within a hair of each other, so without the ring
// the tile dissolves and the crease floats unframed.
//
// Centred on its own mass, not on its flat back: the shape runs bx → bx+SIDE+r,
// so bx is set to put the midpoint of THAT span on 42.5. Centring the flat edge
// instead leaves the whole D sitting visibly left of centre.
const CR_H = 40, CR_SIDE = 12;

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

/* ---------------- the two wrappers ---------------- */

// iOS applies its own squircle mask to a home-screen icon and composites any
// transparency against BLACK, so "bleed" is opaque edge to edge and the sheet is
// inset to leave the mask something to cut into other than the rink.
const BLEED_INSET = 7.5;

// "favicon" — MUST stay free of <style> and @media, and a test asserts it. The
//             .ico frames are rasterised from this exact string, and a raster
//             cannot evaluate a media query, so any conditional rule here would
//             apply in the SVG and silently not in the .ico: different pictures
//             on different browsers. iOS Safari has no SVG favicon support at
//             all, which already makes that class of bug hard to see.
// "bleed"   — opaque, full-bleed, inset. Rasterised to PNG, so a stylesheet
//             would be inert here anyway.
export function appIconSvg(variant) {
  if (variant !== "favicon" && variant !== "bleed")
    throw new Error(`appIconSvg: unknown variant ${variant}`);
  const T = THEMES.light;

  if (variant === "favicon")
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 85" role="img" aria-label="DrillBoard">`,
      creaseSheet(T),
      `</svg>`,
      ``,
    ].join("\n");

  // The field is the dark app surface, not the light one: a near-white icon
  // vanishes on a light wallpaper, and a dark surround is what the iOS mask eats
  // into instead of the sheet.
  const span = round(100 - BLEED_INSET * 2);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="DrillBoard">`,
    `<rect width="100" height="100" fill="${THEMES.dark["surface-app"]}"/>`,
    `<g transform="translate(${BLEED_INSET} ${BLEED_INSET}) scale(${round(span / 85)})">`,
    indent(creaseSheet(T), 2),
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}
