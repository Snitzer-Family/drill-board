# DrillBoard — project instructions for Claude Code

Full-screen hockey drill animator (React + Vite) for a youth hockey coach,
used primarily as an iPhone home-screen web app at the bench.
Live: https://snitzer-family.github.io/drill-board/

## Workflow rules (always)

1. **Verify before committing:** run `npm run build` and confirm it passes.
2. **Bump the version** on every behavioral change: `APP_VERSION` in
   `src/constants.js`. The build timestamp is injected automatically by
   `vite.config.js` — never hardcode it.
3. **Deploy = push to `main`.** GitHub Actions builds and publishes to Pages
   (~90s). The user verifies deploys via the version watermark in the app's
   bottom bar (bottom-right).
4. `vite.config.js` must keep `base: "/drill-board/"` (matches repo name).
5. No new dependencies without asking — the app is deliberately React-only.

## Module map (src/)

- `constants.js` — rink dims, views, colors, speeds, APP_VERSION, ICON_SCALE,
  DEFAULT_TEXT
- `drill-format.js` — the drill text DSL parser/serializer (round-trips)
- `geometry.js` — bezier eval/subdivision, zigzags, RDP + Catmull-Rom fitting
- `rink.jsx` — rink markings (goal lines at x=17/183, end-zone dots at 42/158
  — intentionally NOT regulation; yFix prop counter-corrects fill-stretch so
  circles render round)
- `icons.jsx` — PieceIcon (screen-true matrix frames), Stepper, DiagPanel
- `styles.js` — ALL CSS, including the hard-won safe-area layout rules
- `timing.js` — createTiming() factory: leg timing, pass/shot/pickup planner,
  receiver time-warps, warp-aware positions
- `hockey-drill-animator.jsx` — App shell: state, pointer interaction, popouts,
  loupe, menus

## Domain model (don't break these invariants)

- Coordinates are real rink feet: x 0–200, y 0–85. All timing derives from
  arc length ÷ (pace × speed class × piece speed × leg rate); drill timing
  must NEVER depend on screen geometry.
- DSL round-trip: any model change needs parser + serializer + help-text
  updates together (`pass=`, `shoot=`, `pickup=`, `on=`, `face=`, `hand=`).
- Puck chains: carrier/pickup head → transfers[] → optional shotAt. UI stage
  resolution is possession-aware (players can repeat in a chain — give-and-go).
- The fill-mode stretch is cosmetic-only: positions stretch, rink circles are
  counter-corrected (yFix), icons render in stretch-cancelling matrix frames
  (iconXf). Keep that separation.

## Platform lessons (learned painfully — do not relearn)

- Never size full-screen layout with vh/dvh on iOS; anchor with
  `position:fixed; inset:0` and safe-area insets via the `--hd-b` variable.
- iOS 26 standalone had a translucent-status-bar viewport bug; the app uses
  an opaque status-bar meta (`black`) + a JS "theft detector" that zeroes the
  bottom inset if the bug's signature returns. Don't remove either without
  testing on-device.
- Safari's hidden-toolbar band is browser-reserved and unfixable; standalone
  (Add to Home Screen) is the primary target platform.
- Diagnostics: ☰ → Diagnostics shows live viewport/inset/rect numbers — use
  it (via user screenshots) before theorizing about layout on-device.
- iOS touch scrolling is suppressed with native non-passive touchstart/
  touchmove listeners on the SVG (React synthetic handlers can't preventDefault).

## Testing reality

There is no automated test suite. The build is the gate; the user tests on
an iPhone 15 (standalone). For risky changes, prefer small commits so the
watermark + Actions history make bisection trivial.
