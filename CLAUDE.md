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
   to `main` on **Forgejo**, which mirrors to GitHub, where Actions builds and
   publishes to Pages (~90s total), so it goes live. Always confirm and get the
   user's go-ahead before merging to `main` or pushing. Commit on the
   worktree/session branch freely; the user verifies deploys via the version
   watermark, which lives at the foot of the ☰ menu (it also opens About) — it
   left the bottom bar so that bar could be controls only.
4. `vite.config.js` must keep `base: "/drill-board/"` (matches repo name).
5. No new dependencies without asking — the app is deliberately React-only.

## Remotes: Forgejo is primary, GitHub is a mirror

- `origin` is **Forgejo**, self-hosted on the LAN:
  `ssh://git@10.5.1.63:2222/Snitzer/drill-board.git`
  (web UI `https://git.home.snitzer.space/Snitzer/drill-board`, CT 110). Push
  here and nowhere else. The `github` remote is fetch-only by construction —
  its push URL is set to a bogus string, so `git push github` fails loudly
  instead of silently diverging the two sides.
- **GitHub is a push mirror, not a place to push.** Forgejo syncs
  `Snitzer-Family/drill-board` on every push (plus an 8h fallback interval).
  That sync is a **force-push of all refs**: a branch deleted on Forgejo is
  deleted on GitHub next sync. GitHub is a backup and a build host, never a
  source of truth — never commit there directly, or the mirror will overwrite
  it and the work is gone.
- **The deploy still runs on GitHub.** `.github/workflows/deploy.yml` is what
  builds and publishes Pages, because Pages only deploys from github.com. So
  the live site depends on the mirror working: if the mirror is broken, a push
  to Forgejo `main` looks successful and never reaches the bench phone. When a
  deploy doesn't appear, check the mirror's last-sync in Forgejo
  (Settings → Repository) **before** debugging Actions.
- **The mirror's GitHub PAT needs `workflow` scope**, not just `repo`. Any
  mirrored push that touches `.github/workflows/` is rejected outright without
  it — and since the mirror force-pushes all refs together, that one rejection
  fails the whole sync, not just that file.
- **Two CI systems now run on every push, deliberately.**
  `.forgejo/workflows/ci.yml` runs `npm test` + `npm run build` on
  `homelab-runner` (CT 111); GitHub then runs the same suites before deploying.
  Forgejo is the fast local gate, GitHub is the gate on the deploy itself.
- **Never delete `.forgejo/workflows/`.** Forgejo picks the first workflow
  directory that exists, checking `.forgejo/workflows` before
  `.github/workflows`. With it gone, `homelab-runner` picks up the Pages
  workflow instead and fails every push on `actions/configure-pages`, which
  only works on github.com.
- Credentials live in `config/secrets.env` (gitignored, mode 600);
  `config/secrets.env.example` is the tracked template. **This repo is public
  on GitHub** — check `git check-ignore` before adding anything secret-shaped,
  and treat a token committed even briefly as burned.

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
- `icons.jsx` — PieceIcon (screen-true matrix frames), Stepper, DiagPanel
- `app-icon.js` — the app icon artwork (an end zone with a route driving at the
  net), the sole source for everything in `public/`. Not imported at runtime
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
- `hockey-drill-animator.jsx` — App shell: state, pointer interaction, popouts,
  loupe, menus

## App icon (`public/`, generated — never hand-edit)

- The art lives in `src/app-icon.js`; `node scripts/build-icons.mjs` renders it
  to `public/icon.svg` + the three PNGs, and those are **committed**. CI runs on
  ubuntu with no browser, so they can't be built there — the script rasterises
  with the system Chrome (via `CHROME=`) so the no-dependencies rule holds.
- **ONE picture, in two wrappers that differ only in what the platform needs.**
  The art is an end zone holding nothing but the blue crease. `favicon` keeps
  transparent corners (`icon.svg` + the `.ico` frames); `bleed` is **opaque**,
  full-bleed, art inset 7.5% (`apple-touch-icon` + the manifest's 192/512),
  because iOS composites a transparent home-screen icon against **black** and
  then applies its own squircle mask — the dark surround is what the mask eats
  into instead of the sheet.
- **A drill plan used to be the large rendition and is deleted, not disabled.**
  It was an end zone with a route driving at the net; nothing draws it now, so
  keeping it would be tuned art that rots. It's in git history if wanted back.
  Also gone: the size media query that swapped renditions at 40px, and the
  embedded stylesheet it needed.
- The plan couldn't be the favicon anyway: at 16px one rink foot is 0.19 device
  px, so the goal line lands on half a pixel and the fine markings don't shrink,
  they average into mud. Shrinking it was tried three ways (fewer marks, thicker
  strokes, a scaled crease) and all three were indistinct.
- **The favicon variant must stay free of `<style>` and `@media`, and a test
  asserts it.** The `.ico` frames are rasterised from that exact string, and a
  raster can't evaluate a media query — so any conditional rule reintroduced
  there would apply in the SVG and silently not in the `.ico`: different
  pictures on different browsers, which iOS Safari's lack of SVG favicon support
  already makes hard to spot.
- **Nothing adapts to the OS colour scheme, and that's measured.** Flipping the
  sheet to dark ice puts the crease at **2.2:1** against it; the light sheet
  reads on a dark tab strip as-is, because a white tile is exactly what stands
  out there. Blue on ice is 7.5:1, and the slate ring is what keeps the tile
  from dissolving into a light browser chrome, which is nearly the same colour
  as ice.
- **The crease reads as a letter D, and that is accepted** — it doubles as a
  monogram for the app's initial. A flat-backed D is a D, and the context that
  would disambiguate it is exactly what has to go at 16px. Adding the goal line
  back makes it read as a lowercase "b", which is worse; that was tried. Don't
  "fix" it toward rink accuracy — accuracy is what makes it illegible here.
- Geometry is in rink feet but **the stroke weights are icon weights**, and the
  goal line is at x=20, not the regulation 11. Don't reconcile them with
  `rink.jsx`.
- `tests/app-icon.mjs` is the drift guard. It byte-matches `icon.svg` and
  compares a sha256 of the `bleed` variant that the script stamps into that
  file's first line — without it, changing only the bleed field colour or inset
  (neither of which touches `icon.svg`) would ship stale bitmaps invisibly. The
  favicon needs no stamp: `icon.svg` IS that variant, byte-matched, and the
  `.ico` frames come from the same string in the same run. It can't check pixels;
  nothing can, without a rasteriser in CI.
- **iOS Safari does not support SVG favicons.** With only `icon.svg` linked it
  has no candidate at all and shows a blank tab icon — this bit once. So
  `favicon.ico` ships too, holding 16/32/48 of the same crease picture. The
  `.ico` is listed first and the SVG carries `sizes="any"`, which is what keeps
  Chrome/Firefox on the scalable one. The container is hand-built in
  `build-icons.mjs` — PNG payloads inside an `.ico` are legal and need no bitmap
  encoder — and `tests/app-icon.mjs` parses it, because a malformed `.ico` fails
  silently and looks exactly like the bug it's there to fix.
- **An installed iOS home-screen icon does not update**, and Safari caches
  favicons hard. After deploying, the phone keeps the old one until the
  home-screen icon is deleted and re-added; a stale tab favicon needs
  Settings → Safari → Clear History and Website Data. Expect to debug this as a
  non-bug at least once.

## Domain model (don't break these invariants)

- Coordinates are real rink feet: x 0–200, y 0–85. All timing derives from
  arc length ÷ (pace × speed class × piece speed × leg rate); drill timing
  must NEVER depend on screen geometry.
- DSL round-trip: any model change needs parser + serializer + help-text +
  `docs/drill-dsl.md` updates together (`pass=`, `shoot=`, `rebound=`, `rim=`,
  `chip=`/`~deg` aim, `pickup=`, `on=`, `net=`, `face=`, `hand=`, `hold=`,
  `&f`/`&b` release hand, `goalie`, `defense`).
- Puck chains: carrier/pickup head → transfers[] → optional shotAt. UI stage
  resolution is possession-aware (players can repeat in a chain — give-and-go).
- The fill-mode stretch is cosmetic-only: positions stretch, rink circles are
  counter-corrected (yFix), icons render in stretch-cancelling matrix frames
  (iconXf). Keep that separation.

## Editor chrome: three flows, one action bar

- `mode` is `"draw" | "edit" | "play"`, set only by `setMode()` and shown by the
  `.hd-mode` segment in the bottom bar. `penMode` is derived (`mode === "draw"`),
  not stored. Mode is **not** persisted and **not** in the DSL.
- That segment is the app's primary control, and the chrome says so: it holds
  the **centre** of `.hd-bar`, it's the one thing there taller than a bar button
  (48 vs 44), it is **icon-only** — the only bar control without a `.hd-blbl`
  caption, so `aria-label` carries each cell's name — and its knob wears a
  colour per flow (Draw `--db-mode-draw`, Edit `--db-accent`, Play
  `--db-brand-red`). It is centred by *construction*, not measurement: undo+redo
  and rink+menu weigh exactly the same (92px, 106 dense), so it lands on the
  centre line and the lefty `row-reverse` mirror leaves it there. Change a width
  on either side and it silently stops being centred.
- `.hd-mode` and the draw bar's `.hd-penseg` share the knob maths in
  `styles.js`, but **not** their size — each overrides `--mw`/`height` on its own
  selector. Never resize one by editing the shared block.
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
- Diagnostics: ☰ → Diagnostics shows live viewport/inset/rect numbers — use
  it (via user screenshots) before theorizing about layout on-device.
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

The node suite (`node tests/sketch-recognize.mjs`, ~1s, 216 tests) is free —
run it on every change. The browser suites live outside the repo in
`/tmp/db-verify` (puppeteer-core, no repo dep) and drive real pointer/touch
input against the dev server. Run them with the parallel runner, not one at a
time:

- `node /tmp/db-verify/run.mjs ui <url>` — bar fit, palette, modes, cursor,
  convert, extend. Use for UI/markup/CSS changes.
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
