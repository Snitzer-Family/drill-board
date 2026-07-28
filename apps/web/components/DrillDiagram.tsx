// drillSvg() returns a complete <svg…> document string, so it goes in with
// dangerouslySetInnerHTML. Four things make that safe here, and all four are
// required — not three:
//
//   1. The DSL is repo-authored. The trust boundary is code review.
//   2. Untrusted DSL is NEVER server-rendered. The `#d=` share path is
//      client-side and lives on the board's own origin.
//   3. drill-format.js validates colour tokens at parse time, so the renderer's
//      unescaped `fill="${color}"` interpolations cannot be broken out of.
//   4. tests/content-drills.mjs asserts the generated SVG contains no <script
//      and no on* handler, for every drill, on every build.
//
// If user-submitted drills ever get a page, they render inside the board (an
// iframe or a redirect), not through this component.

const RATIO: Record<string, string> = {
  full: "200 / 85",
  half: "100 / 85",
  quarter: "100 / 42.5",
};

export function DrillDiagram({
  svg,
  title,
  rink = "full",
  className = "",
}: {
  svg: string;
  title: string;
  rink?: string;
  className?: string;
}) {
  return (
    <figure
      role="img"
      aria-label={`Rink diagram: ${title}`}
      style={{ aspectRatio: RATIO[rink] ?? RATIO.full }}
      className={
        "overflow-hidden rounded-rink border border-line bg-ice " +
        "[&>svg]:block [&>svg]:h-full [&>svg]:w-full " +
        className
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * A diagram sized to a uniform 200:85 band, for grids.
 *
 * The obvious version of this — force the figure to 200:85 and let
 * preserveAspectRatio sort it out — is wrong, and measurably so. `meet`
 * letterboxes the VIEWBOX, but drill-svg draws the whole rink and only crops it
 * with the viewBox; the surplus geometry still paints inside the element box.
 * A half-ice drill in a 200:85 figure therefore painted 469px of rink starting
 * 77px outside the left edge, clipped rather than fitted.
 *
 * So the band is a separate element: it owns the uniform height, and the figure
 * inside keeps the drill's TRUE ratio and is centred. Full ice fills the band;
 * half ice is a narrower panel of the same height. Nothing is cropped and the
 * rows line up.
 */
export function DrillDiagramBand({
  svg,
  title,
  rink = "full",
  className = "",
}: {
  svg: string;
  title: string;
  rink?: string;
  className?: string;
}) {
  return (
    // The band is `raised` and the sheet carries a hairline: with the band the
    // same colour as the ice, a half-ice drill reads as one full-width sheet
    // with a small rink floating in it, which misrepresents the drill.
    // `sunken` is not enough separation — it is within a point or two of `ice`
    // in both light and dark.
    <div className={`rink-ratio flex items-center justify-center bg-raised ${className}`}>
      <figure
        role="img"
        aria-label={`Rink diagram: ${title}`}
        style={{ aspectRatio: RATIO[rink] ?? RATIO.full }}
        className="h-full max-w-full overflow-hidden border-x border-x-hair bg-ice [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
