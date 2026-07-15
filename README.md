# DrillBoard — Hockey Drill Animator

**Live app: <https://snitzer-family.github.io/drill-board/>** — open it on a phone
and add it to your home screen; it runs full-screen like a native app.

A single-file React app for designing and animating hockey drills. Built for coaches
working from a phone or iPad at the bench: the ice fills the screen, every setting
lives in a tap-anchored popout, and drills round-trip through a plain-text format
you can write by hand, generate from other tools, or diff in version control.


---

## Core concepts

### Coordinate system

Everything is real rink feet: **x runs 0–200** (goal line axis), **y runs 0–85**
(board to board). Rink landmarks are where they should be — blue lines at x=75/125,
center at x=100, goal lines at x=11/189, end-zone dots at (31|169, 20.5|64.5).
Full / half / quarter views are just different SVG viewBoxes over the same
coordinate space, so a drill authored on half ice renders correctly in any view.

### Drill text format (DSL)

One command per line, `#` for comments:

```
RINK half
PIECE F1 player 112 62 #d7263d F1 hand=L
PIECE D1 player 128 28 #1f4fa3 D1 speed=0.9
PIECE PK1 puck 176 42 on=F1
PATH F1 Q 138,74 158,52 RATE 1.4 C 168,44 172,40 176,42
PATH D1 L 152,28 STOP 1 BWD RATE 0.8 Q 140,34 134,46
PATH PK1 STOP 0.3 SHOT L 188,41
```

- **RINK** `full | half | quarter`
- **PIECE** `id kind x y [#color] [label] [speed=1.2] [hand=L] [on=F1] [face=45]`
  - `speed=` per-piece speed multiplier
  - `hand=L` mirrors the player's stick (default right)
  - `on=F1` attaches a puck to that player's blade
  - `face=45` heading in degrees for a stationary (routeless) player
- **PATH** `id segments…` — SVG-style bezier commands in rink feet:
  - `L x,y` straight · `Q cx,cy x,y` one control point · `C c1x,c1y c2x,c2y x,y` two
  - Modifier words apply to the **next segment only**:
    - `PASS` / `SHOT` / `CARRY` — puck speed class (3× / 6× / 1×), drawn dashed / heavy / dotted
    - `BWD` / `FWD` — skating direction; backward legs draw as the coach-notation zigzag
    - `STOP n` — hold n seconds at that leg's start point ("skate to the dot, stop, then go");
      a STOP on leg 1 delays the piece's start, giving staggered entries for free
    - `RATE n` — speed multiplier for that leg (accelerate out of a stop, grind a backward leg)

Paths always begin at the piece's PIECE position. The serializer and parser
round-trip cleanly; Export/Load work on plain `.txt` files.

### Timing model

The pace slider sets a **base skating speed in ft/s** (not a total duration).
Each leg's time = arc length ÷ (pace × speed class × piece speed × leg rate),
plus stops. The drill runs until the slowest piece finishes; finished pieces hold
at their end point. This means all skaters share one realistic speed, passes
visibly snap, and stops add real time instead of compressing everyone else.

Arc lengths come from hidden per-segment `<path>` elements via
`getTotalLength()` / `getPointAtLength()`, which gives constant speed along the
curve regardless of how tightly it bends.

---

## Feature notes, in build order

**Rink + pieces + bezier routes.** Accurate NHL-proportioned markings drawn in
feet. Pieces (players, pucks, cones) with per-segment editable routes: draggable
anchors (yellow squares) and bezier control handles (white circles).

**Finger drawing with smoothing.** A Draw mode captures the finger trail, thins
jitter, simplifies with Ramer–Douglas–Peucker (1.6 ft tolerance), then fits the
kept points with a Catmull–Rom → cubic-bezier conversion. The output is ordinary
editable C segments — a smoothed sketch, not a frozen scribble. Drawing with no
selection creates a new player at the start point in one gesture.

**Pass / shot mechanics.** Per-segment speed classes for the puck; later, the
`RATE` multiplier generalized "speed changes at a point" to every piece.

**Stops and direction transitions.** Per-leg `STOP` holds and `FWD`/`BWD`
designations. Backward legs render as a zigzag polyline sampled analytically
along the bezier (evaluate the curve polynomial, offset alternate samples
±0.9 ft along the normal) — no DOM measurement needed.

**On-ice popouts.** Tap vs drag is disambiguated by a 1.4 ft movement threshold.
Taps open a settings card anchored at the touch point: pieces get name / color /
handedness / speed / start delay / add-leg / attach; route points get pause,
speed-after, next-leg shape, and Fwd-Bwd or Carry-Pass-Shot; route lines get
"add point here" (double-tap adds instantly). Cards are positioned by
percentages derived from the viewBox, flip above/below near edges, and are
draggable by their header (offset stored separately from the anchor, reset per
target).

**Point insertion without changing the curve.** Splitting a segment uses
de Casteljau subdivision at the parameter nearest the tap (60-sample scan,
clamped to t ∈ [0.08, 0.92]) — the two halves trace exactly the original curve,
so a new anchor appears without any visible kink. Metadata: the first half keeps
the leg's stop/dir/mode/rate; the second half inherits all but the stop.

**Top-down skaters.** Players are vector skaters traced from a reference photo:
splayed skates, jersey torso with shoulder stripe, arms to gloved hands on a
diagonal stick, darkened-jersey helmet. The jersey is a plain `fill`, so
recoloring is exact. Heading follows the route tangent (sampled just ahead of
the current arc position), flips 180° on backward legs (defensemen skate
backward facing the play), pre-pivots toward the next leg during stops, and
stays put via `facing` for stationary players. Jersey numbers counter-rotate to
remain upright on screen.

**Handedness + puck attachment.** `hand=L` mirrors the arms/stick/gloves group.
An attached puck (`on=F1`) rides the carrier's blade — position computed from
the carrier's pose, heading, and handedness. If the attached puck also has a
route, its **placed position is the release point** (dashed ring while
editing): the puck rides until the carrier's blade first comes within 3 ft of
that spot, then detaches and runs its own route on a fresh clock. Release time
is found by sampling the carrier's blade trajectory (~200 steps) and cached,
invalidated on any pieces / pace / measured-geometry change. This removes the
need to hand-duplicate the carrier's path for the puck, and timing stays synced
automatically when the carrier's route changes.

**Touch loupe.** During touch/pencil drags, a circular magnifier bubble appears
beside the fingertip showing a live zoomed view with a crosshair at the true
touch point. It's simply a second `<svg>` rendering the same scene with a small
viewBox centered on the finger — SVG does the magnification, React state keeps
it live, and `url(#id)` marker/clip references resolve document-wide so it
borrows the main SVG's defs.

**Full-screen layout.** The ice fills the viewport; chrome floats in the
corners: ☰ settings (text editor sheet, export/load, pace), rink-size menu,
tools FAB (add pieces / draw), and always-visible Play/Reset, all respecting
`env(safe-area-inset-*)`. A ResizeObserver measures the stage and sizes the
canvas div to exactly the rink's fitted dimensions — the rink edge *is* the
container edge, which keeps all percentage-anchored overlays exact.

**Auto orientation.** The fit scale is computed both ways
(`min(W/rinkW, H/rinkH)` vs rotated) and the scene rotates 90° whenever rotated
wins (2% hysteresis). The rotation is one `<g transform="rotate(90) …">`
wrapping the scene: the model, DSL, and animation never know the screen is
rotated. Pointer input inverts the *scene group's* `getScreenCTM()` (which
carries the rotation), overlay anchors get a rotated mapping branch, the loupe's
contents rotate to match, and jersey numbers counter-rotate by the screen
rotation.

**Rotating stationary players.** Desktop: grab the stick blade and drag — the
blade's ~28° angular offset from the body axis is measured on grab and
subtracted, so the blade tracks the cursor with no jump. Touch: selecting a
routeless player shows a dashed rotation ring with a knob at the current
facing; drag the knob (fat hit target, visible in the loupe). Both persist to
`face=` in the DSL. Attached pucks sweep with the rotation live.

**Double-click to add.** Double-click (or double-tap) empty ice opens an
"Add here" popout — Player / Puck / Cone — placing at that exact spot and
flowing straight into the new piece's settings card. Same 350 ms / 3 ft
double-tap grammar as adding a point on a line.

---

## Implementation notes worth stealing

- **Constant-speed path animation:** hidden per-segment paths +
  `getPointAtLength(fraction × length)`; time per segment derived from length ÷
  effective speed, walked against a global elapsed clock (holds consume time at
  a fixed position).
- **De Casteljau subdivision** for lossless point insertion; **Catmull–Rom
  fitting** for sketch smoothing; **analytic bezier evaluation** (the polynomial
  directly) wherever geometry is needed without a DOM element (zigzags,
  tangents, nearest-point scans).
- **Touch scroll suppression on iOS:** `touch-action: none` on the SVG and all
  descendants is *not* reliably honored when the touch starts on an SVG child.
  The dependable fix is native `touchstart`/`touchmove` listeners registered
  with `{ passive: false }` calling `preventDefault()` (React's synthetic
  handlers can't — React registers passively), plus
  `overscroll-behavior: none` and `-webkit-touch-callout: none`.
- **Rotation as a scene transform:** keep the whole model in rink coordinates
  and rotate one `<g>`; map pointer input through that group's screen CTM so
  every interaction works unchanged in either orientation.
- **HTML overlays anchored by viewBox percentages:** no pixel math, no resize
  listeners; anchors survive view switches and window resizes because the
  canvas div is sized to exactly match the rink.
- **First-paint measurement:** `getTotalLength()` needs committed DOM, so one
  post-mount re-render tick refreshes anything derived from path lengths (run
  time, release-time cache — the cache is additionally keyed on a
  sum-of-lengths signature).

## Running locally

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

The component (`src/hockey-drill-animator.jsx`) default-exports `DrillAnimator`
and expects nothing — it drops into any React 18+ setup, or runs directly as a
Claude artifact. Styling is scoped in a `<style>` tag; no Tailwind or CSS
imports required.

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml`, which builds with
Vite and publishes `dist/` to GitHub Pages at
<https://snitzer-family.github.io/drill-board/>. If the very first run fails on
Pages enablement, flip **Settings → Pages → Source: GitHub Actions** once and
re-run the workflow. Note `vite.config.js` sets `base: "/drill-board/"` — keep
it in sync if the repo is ever renamed.

## Ideas on the shelf

Per-piece color accents (yoke / socks / home-away), backward legs inherently
slower, timed attachment transfers (puck hops F1 → pass → rides F2), multi-drill
playlists, and export-to-GIF for team handouts.
