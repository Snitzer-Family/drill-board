# DrillBoard — project instructions for Claude Code

Full-screen hockey drill animator (React + Vite) for a youth hockey coach,
used primarily as an iPhone home-screen web app at the bench.
Live: https://snitzer-family.github.io/drill-board/

## Session start (every new session)

1. **Start in plan mode.** Begin every session in plan mode — investigate and
   propose before touching files. Only leave plan mode once the user approves.
2. **Spin up the dev server immediately.** At the start of each session, launch
   the LAN dev server (see "Live dev server" below) without waiting to be asked,
   so a preview is ready the moment there's something to look at.
3. **Keep the dev server URL visible.** Once the server is up, surface its LAN
   URL (`http://<lan-ip>:<PORT>/drill-board/`) and repeat it in your replies so
   it stays a clickable link the user can open at any time to check visually
   what's going on.

Rules 1–2 are enforced by `.claude/settings.json`: `permissions.defaultMode:
"plan"` starts every session in plan mode, and a `SessionStart` hook launches
the LAN dev server on a per-session port (derived from the session id) and
injects the URL back into context. If you edit that hook, re-open `/hooks` or
restart so the settings watcher reloads it.

## Workflow rules (always)

1. **Verify before committing:** run `npm test` and `npm run build`; both must
   pass. `npm test` auto-discovers every `tests/*.mjs`, so a new suite is
   enforced the moment it lands — there is no list to update. CI runs the tests
   before the build, so a failing suite blocks the deploy.
2. **Bump the version** on every behavioral change: `APP_VERSION` in
   `src/constants.js`. The build timestamp is injected automatically by
   `vite.config.js` — never hardcode it.
3. **Never merge or push to `main` without explicit permission.** Deploy = push
   to `main` (GitHub Actions builds and publishes to Pages, ~90s), so it goes
   live. Always confirm and get the user's go-ahead before merging to `main` or
   pushing. Commit on the worktree/session branch freely; the user verifies
   deploys via the version watermark, which lives at the foot of the ☰ menu
   (it also opens About) — it left the bottom bar so that bar could be
   controls only.
4. `vite.config.js` must keep `base: "/drill-board/"` (matches repo name).
5. No new dependencies without asking — the app is deliberately React-only.

## Live dev server (start it every session — see "Session start")

- **Always LAN-addressed on a strict, per-session port** so multiple concurrent
  Claude sessions/worktrees never collide. Launch with:
  `npx vite --host --port <PORT> --strictPort` (background it). `--host` binds
  `0.0.0.0` so the phone can reach it; `--strictPort` fails loudly instead of
  silently hopping to another port (which would hijack/alias another session).
- **Pick a fixed unused port per session** (don't reuse the default 5173). Check
  it's free first (`lsof -iTCP:<PORT> -sTCP:LISTEN`); keep the same port for the
  life of the session. The LAN URL to hand the user is
  `http://<lan-ip>:<PORT>/drill-board/` (get the IP via `ipconfig getifaddr en0`).
- The `base` is `/drill-board/`, so the path segment is required.

## Loading a sample drill via URL (the `#d=` hash)

- The app boots straight into a drill from a URL **hash**: `#d=<enc>` where `<enc>`
  is the drill DSL, UTF-8 → base64 → **url-safe** (`+`→`-`, `/`→`_`). Parsed in
  the `linkDrill` IIFE (`hockey-drill-animator.jsx` ~245, regex `/[#&]d=([^&]+)/`
  on `location.hash`) and produced by `previewLink()` (~3643). It wins over the
  autosave and doesn't overwrite the saved board until the user edits.
- So to demo a feature with a sample drill, write the DSL (see `docs/drill-dsl.md`),
  url-safe-base64-encode it, and give the user
  `http://<lan-ip>:<PORT>/drill-board/#d=<enc>` (or append `#d=<enc>` to the live
  Pages URL). Encode in Node exactly as `previewLink()` does:
  `Buffer.from(dsl,'utf8').toString('base64').replace(/\+/g,'-')
  .replace(/\//g,'_').replace(/=+$/,'')` (strip trailing `=`).

## Module map (src/)

- `constants.js` — rink dims, views, colors, speeds, APP_VERSION, ICON_SCALE,
  DEFAULT_TEXT
- `drill-format.js` — the drill text DSL parser/serializer (round-trips) +
  `extractDrill()` (pulls the DSL out of a markdown ```drill fence)
- `docs/drill-dsl.md` — the full DSL reference + markdown embed format; keep it
  in sync with the parser/serializer on any DSL change
- `geometry.js` — bezier eval/subdivision, zigzags, RDP + Catmull-Rom fitting
- `rink.jsx` — rink markings (goal lines at x=11/189 (regulation 11ft from the boards), end-zone dots at 31/169 (20ft from the goal line)
  — intentionally NOT regulation; yFix prop counter-corrects fill-stretch so
  circles render round)
- `icons.jsx` — PieceIcon (screen-true matrix frames), Stepper, the icon set
- `styles.js` — ALL CSS, including the hard-won safe-area layout rules. Colours
  are `var(--db-*)` tokens only — a raw hex here fails `tests/theme-contrast.mjs`
- `theme.js` — the colour system: semantic tokens per theme, the CSS emitter,
  the pre-paint boot script, and the declared contrast pairs. Plain ESM with NO
  imports so `vite.config.js`, `scripts/*.mjs` and `node tests/*.mjs` can load it
- `theme-react.jsx` — `useTheme()` (tokens for the SVG, which can't use `var()`
  in presentation attributes) and `useInk()` (stored piece colour → painted)
- `storage.js` — autosave key + the crash-recovery stash, shared with `main.jsx`
  (which renders outside the app and must not hardcode the key)
- `possession.js` — the possession ledger: pure, condition-aware possession
  stints + loose-puck intervals per puck (branch-choice atom conjunctions prove
  cross-player mutual exclusion); node-testable, no seed/DOM
- `route-dir.js` — the sticky write rule for skate direction: `dir` is stored on
  every leg, but setting one waypoint backwards means "and everything after it,
  down the branches too" until a later one flips. Pure, node-tested
- `timing.js` — createTiming() factory: leg timing, pass/shot/pickup planner,
  receiver time-warps, warp-aware positions
- `diag-report.js` — the diagnostics payload builders, and the only part of the
  panel worth testing: the plan-vs-renderer agreement rule and its noise guards,
  possession verdicts as prose, plan health, the `#diag` hash, the
  Infinity/Map sanitizer, and the test-fixture emitter. Pure, node-tested
- `diagnostics.jsx` — the three-tab view. `memo()`'d and polling a thunk off a
  ref at 5Hz, so it never re-renders from the animator (see below)
- `hockey-drill-animator.jsx` — App shell: state, pointer interaction, popouts,
  loupe, menus

## Domain model (don't break these invariants)

- Coordinates are real rink feet: x 0–200, y 0–85. All timing derives from
  arc length ÷ (pace × speed class × piece speed × leg rate); drill timing
  must NEVER depend on screen geometry.
- DSL round-trip: any model change needs parser + serializer + help-text +
  `docs/drill-dsl.md` updates together (`pass=`, `shoot=`, `rebound=`, `rim=`,
  `chip=`/`~deg` aim, `pickup=`, `on=`, `net=`, `face=`, `hand=`, `hold=`,
  `goalie`, `defense`).
- Puck chains: carrier/pickup head → transfers[] → optional shotAt. UI stage
  resolution is possession-aware (players can repeat in a chain — give-and-go).
- The fill-mode stretch is cosmetic-only: positions stretch, rink circles are
  counter-corrected (yFix), icons render in stretch-cancelling matrix frames
  (iconXf). Keep that separation.

## Editor chrome: three flows, one action bar

- `mode` is `"draw" | "edit" | "play"`, set only by `setMode()` and shown by the
  `.hd-mode` segment in the bottom bar. `penMode` is derived (`mode === "draw"`),
  not stored. Mode is **not** persisted and **not** in the DSL.
- `.hd-act` is ONE element whose contents swap per mode. It is `height:
  var(--hd-barh)` and `flex-wrap:nowrap`, and the ice's reserved band
  (`--hd-act`) is computed from the same `--hd-barh` — never a literal, never a
  second variable. Each mode's contents must have exactly one flexible child.
- `DENSE_MIN` (700) is the app's main width breakpoint. It drives the bar's
  layout tier AND the corner-menu anchoring, and JS owns it: the `.dense` class
  on `.hd-root` is what the stylesheet keys off, so there is no media query to
  drift against. Below it, groups collapse into popovers — that's a different
  render tree, which is why it can't be pure CSS.
- `ROOMY_MIN` (1000) is the second and only other one, for the Edit palette
  alone: above it the Shapes group inlines too. It exists because the five
  shape tools cost ~204px more than the popover button they replace, and the
  bar's flexible child is the standing hint — so "the bar fits" stays true long
  after the hint has become a stub. 1000 keeps it at 136px, no worse than the
  130px it already has at 768. Landscape iPad and up; portrait iPad stays
  grouped. Width-only, deliberately NOT `isWide`'s `pointer:fine` — an iPad
  reports a coarse pointer even with a Pencil attached.
- `setMode()` must never disturb the pen: it commits buffered ink (`flushPen`,
  not `clearInk`) and leaves ink colour/width/style and the pen's read mode
  alone, so draw → edit → draw stays a free round trip.
- Never give `.hd-act` `overflow:hidden` — the line-settings popovers are its
  children and spring upward out of its box.
- `ADD_GROUPS` is the single table of everything placeable. The Edit bar, its
  group popovers and the double-tap quick-add all read it; that grid used to be
  written out twice and the two copies drifted.
- `src/styles.js` is one template literal. A backtick in a comment ends it, the
  build then blames the next odd character, and on a clean tree the
  copy-preview plugin's ENOENT hides the error entirely. Guarded by a test.

## Platform lessons (learned painfully — do not relearn)

- Never size full-screen layout with vh/dvh on iOS; anchor with
  `position:fixed; inset:0` and safe-area insets via the `--hd-b` variable.
- iOS 26 standalone had a translucent-status-bar viewport bug; the app uses
  an opaque status-bar meta (`black`) + a JS "theft detector" that zeroes the
  bottom inset if the bug's signature returns. Don't remove either without
  testing on-device.
- Safari's hidden-toolbar band is browser-reserved and unfixable; standalone
  (Add to Home Screen) is the primary target platform.
- Diagnostics ships in the production build, because the bugs it exists for
  happen on the phone against the live Pages build. Open it from ☰ → About →
  Open diagnostics, or with `#diag` (`#diag=pen` / `#diag=layout`) appended to
  the URL — an independent key on the same hash the share link uses. Three tabs:
  - **Drill** — the plan-vs-renderer puck agreement (the app answers "who has
    the puck" twice, independently; when those disagree the puck is on the wrong
    stick), possession.js's transfer verdicts as prose, leg tables with each
    leg's `dir`, and a frame-step scrubber.
  - **Pen** — the recogniser's decision trace: which branch decided, the
    resolved threshold table (`SCALED` vs the rink-feet fallback answers half of
    "converts in the test, not on my phone"), every guard pass and fail, and the
    cluster contest.
  - **Layout** — viewport/inset/rect numbers, plus `.hd-act`'s scrollWidth vs
    clientWidth, so `bar-fit`'s invariant is checkable on the actual device.
  Each tab copies as JSON. **Ask for that paste before theorizing** — it is
  strictly more than a screenshot can carry.
- iOS touch scrolling is suppressed with native non-passive touchstart/
  touchmove listeners on the SVG (React synthetic handlers can't preventDefault).

## Testing reality

`npm test` runs every `tests/*.mjs` (auto-discovered, one process each) and CI
runs it before the build, so a failing suite blocks the deploy. They cover the
pure, node-testable cores — possession ledger, drill fit, auto-net, sketch
recogniser, theme contrast, crash-recovery stash — plus drift guards that pin
invariants a reader can't verify by eye (no raw hex in `styles.js`, `MENU_W` vs
`--hd-menu-w`, `drill-svg.js` fallbacks tracking `THEMES.light`).

**`npm run build` exits 0 on a JSX warning**, so "the build passed" never meant
the JSX was sound. `tests/jsx-warnings.mjs` runs the compiler's own check and
fails on any warning — it caught a merge that added a class as a *second*
attribute (`className="hd-poprow" className="hd-stephint"`), where JSX keeps the
last one and the layout class vanished silently. Read the build's output too;
don't trust its exit code alone.

Nothing covers the rendered UI. That still means an iPhone 15 (standalone) and
the user's eyes, and it is where the real bugs have been — a stated `height:40px`
that renders 50, a menu centred on a width it doesn't have. **Measure the DOM in
a browser rather than reasoning from the CSS**; there is no global box-sizing
reset, so any padded element lies about its size. For risky changes prefer small
commits, so the watermark + Actions history make bisection trivial.

## Verifying pen / UI changes (browser harness)

The node suite (`node tests/sketch-recognize.mjs`, ~1s, 316 tests) is free —
run it on every change. The browser suites live outside the repo in
`/tmp/db-verify` (puppeteer-core, no repo dep) and drive real pointer/touch
input against the dev server. Run them with the parallel runner, not one at a
time:

- `node /tmp/db-verify/run.mjs ui <url>` — bar fit, palette, modes, cursor,
  convert, extend, diagnostics. Use for UI/markup/CSS changes.
- `node /tmp/db-verify/run.mjs recog <url>` — the recognition suites. Use when
  `sketch-recognize.js` or the capture path changes.
- `node /tmp/db-verify/run.mjs '' <url>` — everything. Before a deploy, or after
  a change that touches both.

**Always pass this session's LAN URL.** The suites build their own `#d=` links,
so the runner hands the base down as `DB_URL`; a suite run without it silently
falls back to a hardcoded port and can report a green sweep for a *different
worktree's* dev server. That has happened — a full `ui` pass once validated
markup this branch had already deleted.

`bar-fit.mjs` is the single-line guarantee: at eight widths × three modes it
asserts `scrollWidth <= clientWidth`, that the bar's height still equals
`--hd-barh`, and that the ice ends above the bar. Layout arithmetic in this app
has been wrong three times; measure with this, don't reason from the CSS.

`diag.mjs` drives the diagnostics surface end to end and is the only suite that
asserts a drill's *behaviour* rather than its markup — that the puck is on the
right stick, that an unfireable pass is reported, that `at()` reads another time
without moving the UI. It re-checks bar-fit **through the app's own Layout
report**: if that report and the DOM ever disagree, a screenshot of the panel on
a phone stops being trustworthy, which is the only reason the tab exists.

### Getting real ink into the node suite

The Pen tab is the intended path now, and it replaces hand-transcribing a
clipboard dump (which is how every `REAL` block in `tests/sketch-recognize.mjs`
got there, with the `[[x,y]] → [{x,y}]` adapter written out ten times):

1. Draw it on the device, or tap **Read board ink** to re-run the recogniser
   over ink already on the board — it reports and materializes nothing, so the
   loop is draw → read → adjust with no undo in between.
2. **Copy as fixture** emits a paste-ready case. The assertion it writes pins
   what the classifier does *today*; if what you drew was the bug, change the
   expectation by hand.

`window.__pen` is unchanged and still what five recog suites read. `window.__db`
is the richer, lazily-computed API — `get(tab)`, `json(tab)`, `at(f, tab)`,
`seekT`, `play`, `open`/`close` — and everything on it is a function, so a page
with the panel shut pays nothing.

**Don't edit `src/` while a sweep is running.** Vite hot-reloads the app under
the running Chromes, so the suites measure a moving target: a full sweep once
came back `70 pass, 123 fail` with 16 suites "crashed", and every one of them
passed on a quiet tree minutes later. A sweep takes ~18 minutes — start it when
the tree is settled, and re-run rather than interpret one that overlapped edits.
Pipe it to a file, too: `| tail` hides the failure lines you actually need.

Scope the group to what changed; a full sweep on a CSS tweak is waste. But do
run `ui` on markup changes: the suites select by class/title, and layout
changes have twice broken them (and once shifted the ice geometry other suites
draw into).
