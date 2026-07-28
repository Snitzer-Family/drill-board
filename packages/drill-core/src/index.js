// Convenience barrel for @coachvision/web ONLY.
//
// Do NOT import this from apps/board/vite.config.js, tests/*.mjs or scripts/*.mjs
// — use the matching subpath (`@coachvision/drill-core/theme.js`) instead.
// theme.js has zero imports on purpose so a config file can load it as a leaf;
// importing the barrel would drag drill-svg -> drill-format -> possession into
// that graph and quietly undo the property.
export * from "./theme.js";
export * from "./drill-format.js";
export { drillSvg } from "./drill-svg.js";
export { mdEscape, mdInline, mdBlock } from "./md.js";
