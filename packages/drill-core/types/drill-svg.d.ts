/** Renders a drill DSL string to a complete standalone <svg…> string. DOM-free —
 *  safe to call at build time in a Next server component. Colours emit as
 *  var(--db-ice-*, <light fallback>), so a host that emits themeCss() themes the
 *  diagram for free and an <img>-loaded copy still renders correctly. */
export function drillSvg(dsl: string, opts?: { width?: number }): string;
