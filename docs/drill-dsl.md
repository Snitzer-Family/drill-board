# DrillBoard Drill DSL

A DrillBoard drill is plain text. This document is the full reference for the
format and for the **markdown embed** convention that lets you drop a drill into
a note or a web page.

- Live app: <https://snitzer-family.github.io/drill-board/>
- In the app: **☰ → Text editor** (edit/paste), **Notes / writeup**,
  **Inventory / gear**, **Print sheet**, **Export .txt / .md**, **Copy markdown**,
  **Load .txt / .md**.

---

## Embedding a drill in markdown

Wrap the drill in a fenced code block tagged `drill`:

````markdown
# Neutral-Zone Regroup

Two forwards, delayed entry off the wall.

```drill
RINK full
TITLE Neutral-Zone Regroup
DESC Two forwards, delayed entry off the wall.
PIECE N2 net 189 42.5 face=180 goalie
PIECE F1 player 60 20 F1
PATH F1 L 110,20 L 150,35
```
````

- It renders as a code block in **Obsidian**, GitHub, and most static-site
  renderers — no plugin required.
- **Export .md** / **Copy markdown** produce exactly this shape (a title
  heading, the description, and a fenced `drill` block).
- **Load** a `.md` file, or paste the whole markdown block into the **Text
  editor** and hit Apply — DrillBoard pulls the DSL out of the first fenced
  `drill` block automatically. A plain `.txt` (no fence) still loads as-is.

The `# Heading` and description prose are for humans; on load, the values inside
the block (including `TITLE` / `DESC`) are the source of truth.

---

## File structure

One statement per line. Order is mostly free, but a `PATH` must come after the
`PIECE` it belongs to.

- Blank lines are ignored.
- `#` starts a comment **unless** it's a hex colour (`#c81e33`, `#f80`).
- Coordinates are **rink feet**: `x` 0–200, `y` 0–85.

### Rink landmarks (feet)

| Landmark | x | Landmark | y |
|---|---|---|---|
| Left goal line | 11 | Centre | 42.5 |
| Left blue line | 75 | End-zone dots | 20.5 / 64.5 |
| Centre line | 100 | | |
| Right blue line | 125 | Nets default to (11, 42.5) and (189, 42.5) |
| Right goal line | 189 | End-zone faceoff dots at x = 31 / 169 |

---

## Statements

### `DSL <n>`
The DSL schema version this drill was written in, stamped as the first line on
every save (e.g. `DSL 1`). Optional on input — if omitted, a reader assumes the
current version. Lets a production build eventually render a drill according to
the version that wrote it. Bumped only on a **breaking** DSL change; there is no
compatibility gating yet, so today it is informational.

### `RINK full | half | quarter`
The ice surface shown. Defaults to `full`.

### `TITLE <text>` · `DESC <text>`
Drill name and description (everything to the end of the line). Optional.

### `NOTES … END NOTES`
A **multi-line markdown coaching writeup** — headings, numbered/bulleted steps,
bold/italic, inline `code`, links. Shown on the **print sheet** and the standalone
**preview page** (and included in `Export .md` / `Copy markdown`). In the app:
**☰ → Notes / writeup…** (with a live preview).

Every body line is stored with a leading `| ` (a blank line is just `|`). The
block opens on a line that is exactly `NOTES` and closes on a line that is exactly
`END NOTES`. The pipe prefix is what makes the block **collision-proof**: a coach's
own `END NOTES` line is serialized as `| END NOTES` and read back as content, so it
can never truncate the block. The format round-trips byte-for-byte.

```drill
NOTES
| ## Coaching points
|
| A **delayed** neutral-zone entry that beats a standing-up D.
|
| 1. F1 carries hard up the wall to draw the D up.
| 2. **Chip** off the glass past the D (aim `~-60`).
|
| - Cue: *sell the carry* before the chip.
END NOTES
```

### `PIECE <id> <kind> <x> <y> [modifiers…]`
Places a piece. `id` is any unique token (e.g. `F1`, `PK1`, `N2`).

**Kinds:** `player` · `puck` · `cone` · `net` · `bumper` (solid barrier — players route around it, pucks carom off it) ·
`deker` (stickhandling gate) · `passer` (rebounder box) · `tire` (agility prop) ·
`stick` (a stick laid on the ice) · `light` (cognitive-training light — an iPad on a tripod whose screen shows a cue colour) ·
`label` (a movable, resizable on-ice text note).

**Modifiers** (any order):

| Modifier | Applies to | Meaning |
|---|---|---|
| `#RRGGBB` / `#RGB` | any | Colour. On a `light` this is the idle screen colour (shown before/without a cue timeline). |
| `cues=<hex>:<dur>;…` | light | Cue timeline: the colours the screen shows, each for `<dur>` seconds (hex has no leading `#`; steps separated by `;`). The drill runs at least as long as one cycle. e.g. `cues=2ea043:3;e5342b:2`. |
| `mode=<mode>` | light | How a "read the light" fork picks its route. `reactive` (**default**, may be omitted): cue order **shuffled each cycle and looped**, seeded per run → unpredictable, differs every replay, still keyed to *when* the player reaches the branch. `sequence`: cues in **authored order, once**, holding the last → the route is **consistent** every run. `random`: a **random route each play** (independent of cue durations) — the screen flashes through cues, then snaps to the chosen route's colour just as the player reaches the branch, so the cut reads as a reaction to the light. `always:<hex>`: the route for the designated cue colour **always** runs, no matter what (hex has no leading `#`, e.g. `mode=always:e5342b`). |
| `rand=off` | light | *Legacy* alias for `mode=sequence` (still parsed for older drills). |
| `light=<id>` | player | The reaction `light` this branching player reads (overrides the default nearest-light pick when several cue-lights exist). Covers its base and chained branches. |
| *bare word* | player | Jersey label (e.g. `F1`) |
| `"quoted text"` | label | The label's text (spaces and commas allowed) |
| `size=<n>` | label, net, tire | label: font scale · **net**: `1` NHL / `0.62` mite · **tire**: `1` large / `0.55` small |
| `bg=none` / `bg=<hex>[:<op>]` | label | Background box: `none` removes it, or a colour (no leading `#` needed) with optional opacity `0.05–1`. Default `f6fbfd:0.95` (the sticky-note paper) — omitted when at the default. |
| `border=none` / `border=<hex>[:<op>]` | label | Border: `none` removes it, or a colour with optional opacity. Default `14202b:0.35` (faint ink) — omitted when at the default. |
| `textop=<op>` | label | Text opacity `0.1–1` (default `1`, omitted then). Fades the text and its halo together. |
| `goalie` | net | A goalie who tracks the puck (pucks also enter only from the front — the sides/back are solid) |
| `speed=<n>` | player, puck | Pace multiplier (1 = default; players default 1.5) |
| `hand=L` / `hand=R` | player, stick | Shooting hand — mirrors the player's stick, or flips the on-ice stick prop's blade for a left/right-handed stick |
| `sym=<text>` | player | Whiteboard-mode symbol (≤3 chars, e.g. `X`, `O`, `F`, `LW`, `RD`; underscores read as spaces). `△`, `○`, `□` render as drawn shapes rather than text. Shown instead of the skater when **Whiteboard mode** is on (Settings). Unset falls back to the player's name (the popup offers the same shorthand list under *Name*), or `X` if the name is still the auto id (`P1`, `P2`…). |
| `face=<deg>` | route-less player, net, bumper, deker, passer | Facing angle (0 = +x / toward the right) |
| `defense` | player | Auto-reacting defenceman (holds the slot, stays goal-side) |
| `lock` | any | Pin the piece in place — it can't be dragged, rotated, or edited until unlocked. Toggle *🔒 Lock* on the piece popup, or lock/unlock everything via **☰ → Lock board**. (Bare word, parsed before the jersey-label catch-all.) |
| `hold=line` | player | Wait at the blue line until the puck enters the zone |
| `wait=<player>[@<pt>]` | player | Hold at the start until `<player>` **reaches** point `<pt>`, then run the route. Chains resolve (A waits for B waits for C). In the app: *Delay trigger → Waypoint* on the player popup. |
| `act=<player>[@<pt>]` | player | Hold at the start until `<player>` **releases the puck** (pass/chip/rim/shot) at point `<pt>`; omit `@<pt>` to fire at any of their actions. Correct for stationary passers / held passes where arrival time is wrong. In the app: *Delay trigger → Action*. |
| `net=<id>` | puck | **Legacy (read-only).** What a shot targets; on load it is applied to any `shoot=` terminal lacking its own `>net`. The app now writes each shot's target inline (`shoot=<pt>>N2`) so every terminal aims independently — absence of `>net` means nearest net/passer. The target can be a `bumper` id (the puck mirror-deflects off its face) or a `tire` id (deflects off the round rubber by where it strikes) — bumpers/tires never auto-attract a shot; they must be named. |
| `goalie` | net, tire | A keeper defends shots. On a net it plays post-to-post; on a `tire` it works the full circle — a save stops the puck out front, a beaten keeper lets it deflect off the rubber. |
| `on=<playerId>` | puck | The puck starts on that player's blade (carried) |

**Puck chain** (modifiers on the puck; points are 1-based, see below):

| Modifier | Meaning |
|---|---|
| `pass=<pt>:<to>[@<recv>]` | Pass at point `pt` to player `to`, caught at their point `recv` |
| `pass=<pt>:<to>[@<recv>]%<by>` | …released by a specific player. Any transfer form (`pass=`/`rebound=`/`rim=`/`chip=` handoffs) takes a `%<by>` suffix pinning WHO performs it — required after sibling-branch receivers, where several players each hold the puck on their own mutually-exclusive run and the releaser can't be inferred. Written only when it differs from the inferred holder, so linear chains are unchanged. (For `pass=`, `%<by>` sits after `^<passer>` and before the sauce `!`.) |
| `pass=<pt>:<to>[@<recv>]^<passer>` | Give-and-go: pass at `pt` into passer `<passer>`, which returns it to `to` (usually the passer themselves) at their point `recv`. In the app, tap a passer's id in the *Pass to* row (marked ⟲). |
| `pass=<pt>:<to>[@<recv>]!` | Sauce (raised) pass — a trailing `!`. The puck arcs up over ice obstacles and bounces on landing (with a shadow under it in flight). Toggle *Sauce pass ⤴* on the pass. |
| `shoot=<pt>[^<shooter>][>net]` | Terminal shot at point `pt` — the puck caroms off the net and lands loose. `>net` targets a specific net (absent = nearest). If a drill has a shot but **no net or passer at all**, loading it auto-places an empty net in the crease nearest the shooter — (11, 42.5) or (189, 42.5), one per end as needed (a shot pinned `>` to an existing bumper/tire doesn't trigger this). Several `shoot=` tokens may coexist on one puck: each is an independent chain end tied to its own shooter/branch, and exactly one fires per run (the resolved final holder's). |
| `shoot=<pt>^<shooter>` | …by a specific player. Needed when two conditional receivers (on mutually-exclusive branches) could each be the final holder — `^<shooter>` says which one shoots, so the shot lands on that player's run only, not both. The app always pins `^<shooter>` on newly authored shots. |
| `rim=<pt>[^<shooter>][~<deg>][*<ft>]` | Hard-rim **release** around the boards. `~<deg>` sets the direction, `*<ft>` the distance — or drag the on-ice handle at the end of the rim to set both. The puck lands loose. `^<shooter>` pins the acting player when several conditional receivers could each be the final holder (as with `shoot=`). |
| `chip=<pt>[^<shooter>][~<deg>][*<ft>]` | Chip **release** into space (banks off the boards). `~<deg>` sets the direction (default: the chipper's facing), `*<ft>` the distance — or drag the on-ice handle. The puck lands loose. `^<shooter>` pins the acting player as above. |
| `pickup=<to>@<pt>[*]` | A loose puck hops onto player `to`'s blade at their point `pt`. A trailing `*` marks a **nearest** collect: instead of binding to this specific puck, it re-resolves to whichever loose puck sits closest to `to`'s gather spot each time the drill plays or is edited (the app's default *Collect puck → Nearest puck*). |

**Releases + Collect puck.** `shoot` / `rim` / `chip` are *releases*: the puck
travels and lands loose. Any player then **collects** it — in the app, *Collect
puck* (on the player's popup, or at a route waypoint) grabs the nearest loose
puck at that spot. Under the hood a collected release is stored as a handoff:

| Handoff form | Meaning |
|---|---|
| `rebound=<pt>:<to>[@<recv>][>net]` | Shoot at `pt`; `to` collects the carom at their point `recv`. `>net` gives THIS rebound shot its own target — independent of a later terminal `shoot=`'s `net=`, so P1 can shoot N1 and a collector then fling it at N2. |
| `rim=<pt>:<to>[@<recv>][~<deg>]` | Rim from `pt`; `to` collects it at their point `recv` |
| `chip=<pt>:<to>[@<recv>][~<deg>]` | Chip from `pt`; `to` (self for a give-and-go) collects it at `recv` |

These handoff forms carry the puck straight to the collector; they still load
and play, and are what the app writes when you use *Collect puck*.

**Actions on a branch route.** A waypoint index in any of the forms above may be
qualified by the branch route it lives on: `<ref>.<pt>`, where `<ref>` is the branch
colour-path (hex, no `#`; `.` not `#`, since `#` starts a comment) and `<pt>` is the
1-based waypoint on *that* branch. Unqualified = the base route. So a player who
reacts to the green cue and shoots at the 3rd waypoint of that reaction writes
`shoot=2ea043.3`; a pass released on the green branch and caught on the receiver's red
branch is `pass=2ea043.2:F2@e5342b.1`; a nested branch is `rim=2ea043/e5342b.2`. At
playback `resolveForks` lowers each `(ref, pt)` to a flat index on the chosen run and
**drops** actions that live on a branch the run didn't take. This is how a reaction
route behaves like a normal route — its waypoints carry the ordinary puck actions,
rather than a single action declared on the fork. (The legacy per-`BRANCH` `action`
still loads.)

**Conditional terminals (cross-player possession).** A terminal (`shoot=`/`rim=`/
`chip=`) may be authored by a player who only *receives* the puck on some upstream
branch — e.g. a puck `on=P1 pass=2ea043.2:P3@1 shoot=2` passes to P3 **only** on P1's
green branch, and P3 shoots at their own waypoint 2. Authoring sees possession as a
*possibility* (P3 is offered the shot because the pass could reach them), but the
terminal **fires only on runs whose resolved final holder is that shooter**: on P1's
green run the pass lands, P3 is the holder, and P3's shot fires; on P1's red run the
pass is dropped (branch not taken), P1 keeps the puck, and P3's `shoot=2` is
suppressed while P1's own red-branch terminal fires instead. The shooter is inferred
from the terminal's branch ref (a base — unqualified — terminal belongs to the chain's
natural final holder), so no extra token is needed and existing single-chain drills
are unaffected.

### `PATH <id> <segments…>`
The route for a player or puck. Points are numbered **1…N** in order; **point 0**
is the piece's starting spot (so `shoot=0` / `chip=0` releases before skating).

**Segments:**

| Segment | Shape |
|---|---|
| `L <x>,<y>` | Straight line to a point |
| `Q <cx>,<cy> <x>,<y>` | Quadratic bézier (one control point) |
| `C <c1x>,<c1y> <c2x>,<c2y> <x>,<y>` | Cubic bézier (two control points) |

**Leg modifiers** — placed *before* a segment, apply to that leg:

| Modifier | Meaning |
|---|---|
| `CARRY` / `PASS` / `SHOT` | Puck speed class for a puck's own route leg |
| `FWD` / `BWD` | Skate forward / backward |
| `STOP <n>` | Pause `n` seconds at the start of this leg (*Delay trigger → Timer*) |
| `WAIT <player> <pt>` | Pause at the start of this leg until `<player>` **reaches** point `<pt>`. In the app: *Delay trigger → Waypoint* on the waypoint popup. |
| `WACT <player> <pt>` | Pause at the start of this leg until `<player>` **releases the puck** (pass/chip/rim/shot) at point `<pt>` (`0` = at any of their actions). In the app: *Delay trigger → Action*. |
| `JUMP` | The player jumps as they pass this waypoint — a hop (grow then shrink over a sticky ground shadow) in the animation. Toggle *Jump here* on the waypoint popup. |
| `JOIN smooth\|sym` | Links this waypoint's two bézier handles so re-editing keeps them collinear (**smooth**) or collinear **and** equal length (**sym**). Omitted = a **corner** (independent handles). Purely an editing aid — the rendered curve is unchanged. Set via *Point* on the waypoint popup; on-ice a linked point shows a round node, a corner a square one. |
| `ENDSTOP` | On a player route's **last** leg: the player stops here, so the route ends in a `‖` **stop mark** instead of a direction arrowhead (skating-diagram convention). Toggle *Stops here* on the last waypoint's popup. |
| `LOCK` | Pin this waypoint — its handle can't be dragged or edited until unlocked (locking the whole piece locks every waypoint too). Toggle *🔒 Lock point* on the waypoint popup. |
| `RATE <n>` | Speed multiplier for this leg |
| `NAME <word>` | Name this waypoint (underscores → spaces) for presentation text |
| `DESC "<text>"` | A free-text description for this waypoint |
| `SHOW auto\|preso\|label` | How the description is used (see below) — defaults to `auto` |
| `SIZE <n>` | Font scale for a `SHOW label` description (default 1) |
| `OFF <dx>,<dy>` | Offset (feet) of a `SHOW label` label from its waypoint (default `0,-5`, i.e. just above) |

A waypoint **description** (`DESC "…"`) can be surfaced three ways via `SHOW`:

- **`auto`** — names the waypoint in the play's generated captions
  (*"F1 skates to the top of the circle"*). This is the default.
- **`preso`** — read out verbatim as its own caption during **presentation mode**.
- **`label`** — pinned on the ice as a text note at that spot; it's movable
  (drag it, or `OFF dx,dy`) and resizable (drag its corner, or `SIZE n`).

Standalone text notes use the `label` **piece** instead:
`PIECE L1 label 100 40 size=1.2 "Regroup here"`, styled with
`bg=`/`border=`/`textop=`, e.g.
`PIECE L2 label 100 60 #1f4fa3 bg=none textop=0.6 "Neutral zone"`.

### `BRANCH <player> <ref> [at=<pt>] [<cond>] [<action>[:target]] <segments…>`
A **conditional route branch** for a player ("multiple routes off one waypoint"): a
continuation route (same segment grammar as `PATH`) that begins at a **branch point**
and continues when its condition fires. Optional `at=<pt>` (1-based) is the parent
waypoint the branch departs from; omit it for the parent route's end (the default).

Optional `<cond>` selects **how** the branch is chosen at that waypoint (default = a
reaction-light cue matching the ref colour, i.e. today's behavior):
- *(none)* / `if=<hex>` — a reaction-**light** cue (the governing cue-light's mode
  decides; `if=` sets an explicit cue colour when it differs from the ref colour).
- `rand` / `rand=<weight>` — **random** each run, weighted; needs no light at all.
- `seq=<n>` — **sequence**: cycles branches on successive runs, ordered by `n`.
- `always` — an unconditional **override**: if present it wins over every other
  condition at that waypoint (use it for "no matter what, run this route").
- `has` — **possession**: taken when *this* player is holding the puck at the branch
  point on the resolved run (e.g. after a conditional pass reached them). Its sibling
  branch is the "didn't get it" route.
- `has=<player>` — **another player's possession**: taken when `<player>` is holding
  a puck on the resolved run (e.g. a defender collapses while the attacker still has
  it). In the app: condition *If holding…* → pick the player.
- `link=<player>/<route>` — **route link**: taken when `<player>` skated `<route>`
  (a cue colour-path, `#`-less, `/`-separated; ancestor-or-self match). Models "if P1
  went the *other* way, I do this instead." Routes are numbered R1, R2, … in the
  order their `BRANCH` lines appear in the DSL — the app's route picker uses these
  numbers and, while a route condition is being edited, overlays them faintly on the
  ice over each branch.
- `when=<player>@<pt>` / `when=<player>!<pt>` — **event**: taken when `<player>`
  reached waypoint `pt` (`@`) or released the puck (`!`, trailing `pt` optional) on
  the resolved run.

These last three select on **resolved state** (routes, possession, releases), so the
run is solved with a bounded, seed-deterministic fixpoint (routes → possession →
routes); an unmet condition falls through to its sibling default, and a cyclic/unstable
case settles on that safe default. Selection stays a pure function of geometry + seed +
the other players' resolved routes — no animation-time state.

When several branches leave one waypoint, an `always` branch (if any) overrides
everything. Otherwise every condition that **succeeds** is raced by the time its
trigger fires and the **earliest-firing** one wins ("first successful condition
wins"; ties break to authored order) — a cue/possession is read at the reactor's own
arrival, a link/event fires when the watched player gets there, and a link/event
winner makes the reactor **wait** at the branch until its trigger. If none succeed,
`sequence` + `random` split the run. A branch's puck actions are authored on **its own waypoints** like any route
(see the `<ref>.<pt>` action forms under PIECE) — a reaction route is just a normal
route. A legacy optional **action** right after `cond` (`shoot[:<net>]` · `chip` ·
`rim` · `pass:<player>`, applied to the carried puck at the branch's end) still
loads for older drills, but new drills leave it off (`skate`).

> `FORK` is the **legacy keyword** for this statement and is still read for
> backward compatibility (old drills load unchanged); the serializer now writes
> `BRANCH`.

**Chaining.** A `skate` reaction can chain **another** light reaction off its end,
recursively. The `ref` is therefore a **slash-path of cue colours** (hex, no `#`):
`2ea043` is a top-level reaction to green; `2ea043/e5342b` is the reaction to red
*after* taking the green (skate) one. At playback the player reads the nearest
cue-light at each branch (the base route's end, then each skate reaction's end),
takes the matching reaction, and repeats until a non-skate action ends the chain.
Branch arrival times depend only on the chosen prefix, so the whole chain is
deterministic. Parent reactions are emitted before their children.

```drill
BRANCH P1 2ea043 skate C 100,30 120,30 130,42     # green → skate to the slot…
BRANCH P1 2ea043/e5342b shoot L 165,42            #   …then red → shoot
BRANCH P1 2ea043/2f6df6 skate L 160,60            #   …or blue → skate to the corner (chains again)
BRANCH P1 e5342b chip L 120,20                     # red at the first branch → chip
``` Give a player one `BRANCH` per cue
colour of the governing light — the nearest `light` with a `cues=` timeline, or the
one the player names via `light=<id>` when several exist. The hex has no leading `#`.

At playback the player skates their base route and, **on arrival at the branch**,
takes the fork the light's `mode=` picks — modelling a "skate in, read the light,
react" drill. In the timing-based modes (`reactive`, `sequence`) the fork whose
colour matches the light's cue **at that instant** wins; `random` picks a fork at
random each play; `always:<hex>` always takes the designated colour's fork. Branch
arrival time depends only on the base route (never on screen geometry). The branch
waypoint carries its own reaction-light action circle. In the app the controls live
on the **branch waypoint** (the route's end, nearest the light — tap that waypoint;
a route-less player shows them on its own popup): a **Light reactions** row with
*Draw* / *Redraw* / *Edit* / *Clear* per cue colour. *Draw* sketches the reaction
from the branch; *Edit* opens its waypoints in the full point editor (drag points,
add/delete, curve, per-leg speed/pause). The chosen reaction renders solid, the
others dashed.

```drill
PIECE LT1 light 100 30 #2ea043 cues=2ea043:2;e5342b:2;2f6df6:3
PIECE F1 player 55 42 #d7263d F1
PATH F1 L 95,42
BRANCH F1 2ea043 L 150,20    # green → drive the far dot
BRANCH F1 e5342b L 150,65    # red   → cut low
BRANCH F1 2f6df6 L 175,42    # blue  → straight to the net
```

> Note: a fork's segments are stored in absolute coordinates from where the base
> route ended when it was drawn; heavily reshaping the base route afterwards can
> require redrawing the forks. Per-point handle editing of forks is not yet
> supported — *Redraw* to change one.

### `STEP at=<sec> "<text>"` · `STEP on=<pieceId>:<pt> "<text>"`
A **presentation step** — an authored caption shown during **presentation mode**,
where playback pauses on each so viewers can read along. Each step is anchored one
of two ways (exactly one per step):

- **`at=<seconds>`** — a fixed point on the animation clock (e.g. `at=8.4`). Simple,
  but the caption can drift relative to the play if you later change pace/`RATE`/`STOP`.
- **`on=<pieceId>:<pt>`** — a player's **waypoint activation** (1-based point number,
  like `pass=`/`WAIT`). The time is resolved live, so the caption **tracks edits and
  retiming**, and follows the point if you insert/delete route points before it. This
  is the preferred anchor.

An optional **`pos=<x>:<y>`** saves where the caption sits during playback (its
centre), in **rink feet** (`x` 0–200, `y` 0–85 — the same coordinates as pieces), so
it holds the same area of the ice across portrait and landscape. Omit it and the
caption defaults to bottom-centre.

```drill
STEP at=0 "Play begins — F1 carries out of the corner"
STEP on=F1:3 pos=150:20 "F1 hits the far blue line and cuts to the net"
STEP at=9.2 "Shot on goal — crash for the rebound"
```

Author steps in the app by **scrubbing the timeline, pausing, and tapping ＋ note**
(☰ → *Presentation* → *Edit steps*, or the scrubber's ＋ note button). The caption
then appears on the ice: **type it and drag it** (by the *drag to place* grip) clear
of the action, then **Done** — its spot saves as `pos`. A note dropped near a waypoint
anchors to it (`on=`) automatically; elsewhere it pins the time (`at=`). Tap a step's
anchor chip to switch, or the ⤢ button in the steps list to re-place its caption.
*Generate from play* seeds editable steps from the auto-derived beats.

When a drill has **no** `STEP` lines, presentation mode falls back to the
auto-generated captions (including per-waypoint `SHOW preso`); the first authored
step switches it fully to authored captions.

Caption text accepts **inline markdown** (`**bold**`, `*italic*`, `` `code` ``,
`[links](https://…)`) — rendered in the caption bubble and on the print sheet.

### `ITEM <key> [count=<n>] [hide] ["Label"]`
A row of the drill's **inventory** — the "what you need to run this" recipe. The
table is **auto-counted** from the pieces on the ice (players, pucks, cones, nets,
goalies, tires, sticks, bumpers, deker gates, rebounders, lights); a goalie-flagged
`net`/`tire` counts as a **goalie**, not a net/tire. In the app: **☰ → Inventory /
gear…**. Shown on the print sheet and preview page.

`ITEM` lines are written **only for what you change** — a pristine drill has none:

| Form | Meaning |
|---|---|
| `ITEM <key> count=<n>` | Override the auto count for a canonical row (`player` · `goalie` · `puck` · `cone` · `net` · `tire` · `stick` · `bumper` · `deker` · `passer` · `light`) |
| `ITEM <key> hide` | Hide that row from the sheet — the piece **stays on the ice** |
| `ITEM <key> count=<n> "Label"` | A **custom** off-ice gear row (any non-canonical `<key>`), e.g. whistles, pinnies, water |

```drill
ITEM puck count=8        # 8 pucks even though 1 is drawn
ITEM net hide            # keep the net on the ice, off the sheet
ITEM whistle count=1 "Whistle"
```

---

## Worked example

````markdown
```drill
RINK full
TITLE Chip Off the Boards, Behind the D
DESC F1 banks a chip off the boards past the standing-up D and picks it up behind him in the neutral zone.
NOTES
| ## Coaching points
|
| 1. F1 carries hard up the wall to draw the D up.
| 2. **Chip** off the glass past the D (aim `~-60`).
| 3. Slip inside and re-gather behind him — still onside.
END NOTES
PIECE N2 net 189 42.5 face=180 goalie
PIECE D1 player 110 20 #1f4fa3 D1 defense
PIECE F1 player 46 26 F1
PATH F1 L 80,14 L 100,12 L 120,26
PIECE PK1 puck 46 26 on=F1 chip=2:F1@3~-60
STEP on=F1:2 "Chip off the glass past the D — `~-60`"
ITEM puck count=8
ITEM whistle count=1 "Whistle"
```
````

- `F1` carries from `(46,26)` up the wall.
- At **point 2** `(100,12)` — in the neutral zone at `D1` — the chip is aimed
  into the boards (`~-60`); it **banks off the glass** past the D.
- The chip carries exactly as far as **point 3** `(120,26)`, where `F1` — having
  slipped past D1 — **collects it behind him**, still in the neutral zone.
- `D1` is an auto-defenceman; `N2` has a goalie.
- The **`NOTES`** block is the coach's writeup; **`ITEM`** rows tune the inventory
  (8 pucks on the sheet though one is drawn, plus a `Whistle`). Both show on the
  print sheet / preview page.

---

## Notes

- Angles are degrees, `0` = toward +x (right), `90` = toward +y (down / bottom
  boards), measured clockwise on screen.
- A chip follows the chipping player's facing unless you append `~<deg>`; in the
  app you can also drag the on-ice **aim ring** at the chip's release point.
- The format round-trips: what you Export is what Loads back.

## Marker annotations

`MARK <id> <color> <width> <style> [fill=<hex>[:<opacity>]] x1,y1 x2,y2 …`
draws a freehand ink line on the ice (not part of the drill logic). `style` is
`solid` · `dashed` · `dotted` · `wavy` (may be omitted — defaults to `solid`;
the app always writes it back); `width` is in feet. The optional
**`fill=`** gives the enclosed area an independent translucent fill (hex colour
without the `#`, opacity 0..1, default 0.25) — used for shaded coaching zones
and the preset square/circle/triangle shape markers. The optional
**`corners=<i>;<j>;…`** flags points (0-based) as **sharp corners**: the
smoothing breaks there instead of rounding through, so straight-sided shapes
keep crisp vertices. In the app: *Edit points* → tap a point to toggle sharp
(square node) ↔ smooth (round node), matching route waypoint kinds. In the app: **☰ tools → Marker**, pick a colour /
style / thickness, then drag on the ice. Tap a mark to restyle or delete it.
