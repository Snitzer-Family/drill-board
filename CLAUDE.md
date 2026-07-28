# Coach.Vision — project instructions for Claude Code

A monorepo with two deployed apps sharing one drill engine and one colour system:

- **apps/web** — the Coach.Vision website (Next.js App Router + TypeScript +
  Tailwind v4). Drill library, help desk, practice planner, pricing, accounts.
  Production: https://coach.vision
- **apps/board** — the full-screen drill animator (React + Vite), used primarily
  as an iPhone home-screen web app at the bench. Production:
  https://board.coach.vision
- **packages/drill-core** — the DOM-free engine both apps import: the DSL
  parser/serializer, the SVG renderer, rink geometry, and the theme tokens.

Deploys are Vercel (git-connected), one project per app.

## Session start (every new session)

1. **Start in plan mode.** Begin every session in plan mode — investigate and
   propose before touching files. Only leave plan mode once the user approves.
2. **Spin up the dev servers immediately.** At the start of each session, launch
   them (see "Live dev servers" below) without waiting to be asked, so a preview
   is ready the moment there is something to look at.
3. **Keep the dev URLs visible.** Surface the LAN URLs and repeat them in your
   replies so they stay clickable links the user can open at any time.

Rules 1–2 are enforced by `.claude/settings.json`: `permissions.defaultMode:
"plan"` starts every session in plan mode, and a `SessionStart` hook launches
both dev servers on per-session ports (derived from the session id) and injects
the URLs back into context. If you edit that hook, re-open `/hooks` or restart
so the settings watcher reloads it.

## Workflow rules (always)

1. **Verify before committing:** `npm test` from the repo root, plus
   `npm run typecheck`, `npm run build` and `npm run build:board`. `npm test`
   auto-discovers every `tests/*.mjs`, so a new suite is enforced the moment it
   lands — there is no list to update. Both Vercel projects run `npm test` in
   their Build Command, so a failing suite blocks a production deploy.
2. **Bump the version** on every behavioural change: `APP_VERSION` in
   `packages/drill-core/src/constants.js` for the board, `SITE_VERSION` in
   `apps/web/lib/version.ts` for the website. They ship independently, so they
   must not share a number. The board build timestamp is injected by
   `apps/board/vite.config.js` — never hardcode it.
3. **Never merge or push to `main` without explicit permission.** A push to
   `main` deploys **two** production sites, one of which is the bench app.
   Commit on the worktree/session branch freely; the user verifies deploys via
   the version watermark (board: bottom bar; site: footer).
4. `apps/board/vite.config.js` keeps `base: "/"` — the board is served at the
   root of its own origin. The old `/drill-board/` GitHub Pages path is retired;
   do not reintroduce a path prefix without changing the Vercel project to match.
5. **No new dependencies without asking.** drill-core and the board stay
   React-only. The website's budget is exactly: `next`, `react`, `react-dom`,
   `tailwindcss`, `@tailwindcss/postcss`, `typescript`, `@types/*`. Nothing else —
   no component library, no markdown package, no icon package, no date library.
6. **The site never declares a colour.** Every class maps to a `--db-*` token
   from `drill-core/src/theme.js` via Tailwind’s `@theme inline`. This is load
   bearing: `drill-svg.js` paints diagrams with `var(--db-ice-*)`, so a private
   palette would render every drill in the board’s LIGHT fallbacks on a dark
   page. **Never use Tailwind’s `dark:` variant** — there are five themes and it
   understands two. Reaching for it means a token is missing; add it to
   `theme.js`. Enforced by `tests/web-tokens.mjs`.
7. **Design bans** (Rink Chalk, see `/styleguide`): no gradient hero blobs, no
   glassmorphism, no purple/indigo, no `rounded-full` CTAs, no pure-white
   surfaces, no stock 3D illustration.

## Live dev servers (start them every session — see "Session start")

- **LAN-addressed on strict, per-session ports** so concurrent sessions and
  worktrees never collide:
  `npm run dev -w @coachvision/board -- --host --port <PORT> --strictPort`
  `npm run dev -w @coachvision/web -- -H 0.0.0.0 -p <PORT+1>`
  (background both). `--host`/`-H 0.0.0.0` is what lets the phone reach them;
  `--strictPort` fails loudly instead of silently hopping onto another
  session’s port.
- Check a port is free first (`lsof -iTCP:<PORT> -sTCP:LISTEN`) and keep it for
  the life of the session. Hand the user
  `http://<lan-ip>:<PORT>/` (get the IP via `ipconfig getifaddr en0`).
- **Never run `next dev` and `next build` against apps/web at the same time** —
  they share `.next`, and the build clobbers the dev server’s assets, which
  shows up as a page with no CSS at all. Stop one before running the other.

## Loading a sample drill via URL (the `#d=` hash)

- The app boots straight into a drill from a URL **hash**: `#d=<enc>` where `<enc>`
  is the drill DSL, UTF-8 → base64 → **url-safe** (`+`→`-`, `/`→`_`). Parsed in
  the `linkDrill` IIFE (`hockey-drill-animator.jsx` ~245, regex `/[#&]d=([^&]+)/`
  on `location.hash`) and produced by `previewLink()` (~3643). It wins over the
  autosave and doesn't overwrite the saved board until the user edits.
- So to demo a feature with a sample drill, write the DSL (see `packages/drill-core/docs/drill-dsl.md`),
  url-safe-base64-encode it, and give the user
  `http://<lan-ip>:<PORT>/#d=<enc>` (or append `#d=<enc>` to
  https://board.coach.vision/). Encode in Node exactly as `previewLink()` does:
  `Buffer.from(dsl,'utf8').toString('base64').replace(/\+/g,'-')
  .replace(/\//g,'_').replace(/=+$/,'')` (strip trailing `=`).

## Module map

### `packages/drill-core/` — the shared engine (DOM-free, no build step)

Plain ESM with extensionful imports, consumed by Vite, Next and `node tests/`
alike. Import via **subpaths** (`@coachvision/drill-core/theme.js`); the `.`
barrel is for `apps/web` only — see `src/index.js` for why.

- `constants.js` — rink dims, views, colours, speeds, APP_VERSION, ICON_SCALE
- `drill-format.js` — the DSL parser/serializer (round-trips), `extractDrill()`
  (pulls the DSL out of a markdown ```drill fence), `deriveInventory()`,
  `ensureShotNet()`. Colour tokens are validated here — see the domain model
- `drill-svg.js` — DSL → standalone SVG string, DOM-free, so both the static
  drill pages and the board’s PNG export use one renderer
- `geometry.js` — bezier eval/subdivision, zigzags, RDP + Catmull-Rom fitting
- `boards.js` / `net-collide.js` — board perimeter maths; net/bumper collision
- `possession.js` — the possession ledger: pure, condition-aware possession
  stints + loose-puck intervals per puck; node-testable, no seed/DOM
- `md.js` — dependency-free markdown for a small fixed subset (escape-first,
  scheme-allowlisted links). Renders NOTES and STEP captions in both apps
- `theme.js` — the colour system: semantic tokens per theme, the CSS emitter
  (`themeCss({appShell})`), the pre-paint boot script, the declared contrast
  pairs. **Zero imports on purpose** so `vite.config.js`, `scripts/*.mjs` and
  `node tests/*.mjs` can load it as a leaf
- `docs/drill-dsl.md` — the full DSL reference + markdown embed format. Keep in
  sync with the parser/serializer on any DSL change. Also `?raw`-imported into
  the vision system prompt, which is why it lives in the package
- `types/*.d.ts` — hand-written, thin; they describe what apps/web consumes

### `apps/board/` — the animator

- `hockey-drill-animator.jsx` — App shell: state, pointer interaction, popouts,
  loupe, menus (~10k lines)
- `styles.js` — ALL app CSS, including the hard-won safe-area layout rules.
  Colours are `var(--db-*)` only — a raw hex fails `tests/theme-contrast.mjs`
- `theme-react.jsx` — `useTheme()` (tokens for the SVG, which can’t use `var()`
  in presentation attributes) and `useInk()` (stored piece colour → painted)
- `rink.jsx` — rink markings (goal lines at x=11/189, end-zone dots at 31/169 —
  intentionally NOT regulation; `yFix` counter-corrects fill-stretch so circles
  render round)
- `icons.jsx` — PieceIcon (screen-true matrix frames), Stepper, DiagPanel
- `timing.js` — createTiming(): leg timing, pass/shot/pickup planner, receiver
  time-warps, warp-aware positions
- `storage.js` — autosave key + crash-recovery stash, shared with `main.jsx`
  (which renders outside the app and must not hardcode the key)
- `drill-vision.js` — photo → DSL via the Claude API, bring-your-own-key,
  called straight from the browser so the app ships no secrets
- `sketch-recognize.js` / `drill-fit.js` / `route-dir.js` / `ai-game.js` /
  `zones.js` — pen recognition, pixel→feet fitting, skate-direction inference,
  reactive defence/goalie, zone lookup

### `apps/web/` — the website

- `app/` — App Router. Everything outside `(app)` is `force-static`, so a
  broken content file fails the BUILD rather than 500ing at the rink
- `app/globals.css` — the `@theme inline` token bridge and the Rink Chalk
  primitives (`blueprint`, `rink-ratio`, `puck-shadow`, `.prose-rink`)
- `app/styleguide/` — every token and component across all five themes. Look
  here first when something feels off; it is the visual-regression surface
- `components/ui.tsx` — Eyebrow, Display, Button, Card, Chip, StepNumber,
  Section. Pages compose these rather than restyling
- `components/DrillDiagram.tsx` — the two ways to place a diagram, and the
  measured reason they differ (read the comment before "simplifying" it)
- `lib/content/` — the ~40-line frontmatter reader and the drill loader
- `content/` — drills as `# H1` + prose + ```drill fence + frontmatter;
  `taxonomy.json` allow-lists every facet value
- `lib/config.ts` — `BOARD_URL`, the single place the site points at the board

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

`npm test` from the repo root runs every `tests/*.mjs` (auto-discovered, one
process each). Both Vercel Build Commands run it, so a failing suite blocks a
production deploy. They cover the pure, node-testable cores — possession ledger,
drill fit, auto-net, route direction, sketch recogniser, theme contrast,
crash-recovery stash — plus drift guards that pin invariants a reader can't
verify by eye:

- `theme-contrast.mjs` — WCAG AA on every declared token pair in every theme,
  no raw hex in `styles.js`, `MENU_W` vs `--hd-menu-w`, `drill-svg.js` fallbacks
  tracking `THEMES.light`
- `drill-core-safety.mjs` — the `themeCss({appShell})` seam, and that colour
  tokens are validated at parse time
- `web-tokens.mjs` — no raw hex / arbitrary Tailwind colours / `dark:` in
  apps/web, and every token surfaced to the Tailwind theme
- `content-drills.mjs` — every drill parses, renders, round-trips its share
  hash, and stays inside `taxonomy.json`

**`tests/paths.mjs` is the only file that knows the layout.** Its `src()` helper
asserts a minimum byte size as well as existence, because most drift guards are
"assert the bad pattern is absent" and would pass VACUOUSLY on a wrong path. If
you add a guard of that shape, plant a violation once and confirm it actually
fails.

Nothing covers the rendered UI. That still means an iPhone 15 (standalone) and
the user's eyes, and it is where the real bugs have been — a stated `height:40px`
that renders 50, a menu centred on a width it doesn't have, an SVG that paints
77px outside the box that was supposed to clip it. **Measure the DOM in a browser
rather than reasoning from the CSS**; there is no global box-sizing reset, so any
padded element lies about its size. Note that `getBoundingClientRect()` reports
*layout*, not paint — it ignores ancestor clipping, so it will happily tell you
something overflows when it is visually fine. For risky changes prefer small
commits, so the watermark + Actions history make bisection trivial.

## Verifying pen / UI changes (browser harness)

The node suite (`node tests/sketch-recognize.mjs`, ~1s, 216 tests) is free —
run it on every change. The browser suites live outside the repo in
`/tmp/db-verify` (puppeteer-core, no repo dep) and drive real pointer/touch
input against the dev server. Run them with the parallel runner, not one at a
time:

- `node /tmp/db-verify/run.mjs ui` — palette, modes, cursor, convert, extend.
  Use for UI/markup/CSS changes (~45s).
- `node /tmp/db-verify/run.mjs recog` — the recognition suites. Use when
  `sketch-recognize.js` or the capture path changes.
- `node /tmp/db-verify/run.mjs` — everything. Before a deploy, or after a
  change that touches both.

Scope the group to what changed; a full sweep on a CSS tweak is waste. But do
run `ui` on markup changes: the suites select by class/title, and layout
changes have twice broken them (and once shifted the ice geometry other suites
draw into).
