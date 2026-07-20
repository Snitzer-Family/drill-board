# DrillBoard Drill DSL

A DrillBoard drill is plain text. This document is the full reference for the
format and for the **markdown embed** convention that lets you drop a drill into
a note or a web page.

- Live app: <https://snitzer-family.github.io/drill-board/>
- In the app: **☰ → Text editor** (edit/paste), **Export .txt / .md**,
  **Copy markdown**, **Load .txt / .md**.

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
PIECE N2 net 183 42.5 face=180 goalie
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
| Left goal line | 17 | Centre | 42.5 |
| Left blue line | 75 | End-zone dots | 20.5 / 64.5 |
| Centre line | 100 | | |
| Right blue line | 125 | Nets default to (17, 42.5) and (183, 42.5) |
| Right goal line | 183 | End-zone faceoff dots at x = 45 / 155 |

---

## Statements

### `RINK full | half | quarter`
The ice surface shown. Defaults to `full`.

### `TITLE <text>` · `DESC <text>`
Drill name and description (everything to the end of the line). Optional.

### `PIECE <id> <kind> <x> <y> [modifiers…]`
Places a piece. `id` is any unique token (e.g. `F1`, `PK1`, `N2`).

**Kinds:** `player` · `puck` · `cone` · `net` · `bumper` (foam barrier) ·
`deker` (stickhandling gate) · `passer` (rebounder box) · `tire` (agility prop) ·
`label` (a movable, resizable on-ice text note).

**Modifiers** (any order):

| Modifier | Applies to | Meaning |
|---|---|---|
| `#RRGGBB` / `#RGB` | any | Colour |
| *bare word* | player | Jersey label (e.g. `F1`) |
| `"quoted text"` | label | The label's text (spaces and commas allowed) |
| `size=<n>` | label, net, tire | label: font scale · **net**: `1` NHL / `0.62` mite · **tire**: `1` large / `0.55` small |
| `goalie` | net | A goalie who tracks the puck (pucks also enter only from the front — the sides/back are solid) |
| `speed=<n>` | player, puck | Pace multiplier (1 = default; players default 1.5) |
| `hand=L` / `hand=R` | player | Shooting hand |
| `face=<deg>` | route-less player, net, bumper, deker, passer | Facing angle (0 = +x / toward the right) |
| `defense` | player | Auto-reacting defenceman (holds the slot, stays goal-side) |
| `hold=line` | player | Wait at the blue line until the puck enters the zone |
| `net=<id>` | puck | Which net/passer a shot targets (default: nearest) |
| `on=<playerId>` | puck | The puck starts on that player's blade (carried) |

**Puck chain** (modifiers on the puck; points are 1-based, see below):

| Modifier | Meaning |
|---|---|
| `pass=<pt>:<to>[@<recv>]` | Pass at point `pt` to player `to`, caught at their point `recv` |
| `shoot=<pt>` | Terminal shot at point `pt` — the puck caroms off the net and lands loose |
| `rim=<pt>[~<deg>][*<ft>]` | Hard-rim **release** around the boards. `~<deg>` sets the direction, `*<ft>` the distance — or drag the on-ice handle at the end of the rim to set both. The puck lands loose. |
| `chip=<pt>[~<deg>][*<ft>]` | Chip **release** into space (banks off the boards). `~<deg>` sets the direction (default: the chipper's facing), `*<ft>` the distance — or drag the on-ice handle. The puck lands loose. |
| `pickup=<to>@<pt>` | A loose puck hops onto player `to`'s blade at their point `pt` |

**Releases + Collect puck.** `shoot` / `rim` / `chip` are *releases*: the puck
travels and lands loose. Any player then **collects** it — in the app, *Collect
puck* (on the player's popup, or at a route waypoint) grabs the nearest loose
puck at that spot. Under the hood a collected release is stored as a handoff:

| Handoff form | Meaning |
|---|---|
| `rebound=<pt>:<to>[@<recv>]` | Shoot at `pt`; `to` collects the carom at their point `recv` |
| `rim=<pt>:<to>[@<recv>][~<deg>]` | Rim from `pt`; `to` collects it at their point `recv` |
| `chip=<pt>:<to>[@<recv>][~<deg>]` | Chip from `pt`; `to` (self for a give-and-go) collects it at `recv` |

These handoff forms carry the puck straight to the collector; they still load
and play, and are what the app writes when you use *Collect puck*.

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
| `STOP <n>` | Pause `n` seconds at the start of this leg |
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
`PIECE L1 label 100 40 size=1.2 "Regroup here"`.

---

## Worked example

````markdown
```drill
RINK full
TITLE Chip Off the Boards, Behind the D
DESC F1 banks a chip off the boards past the standing-up D and picks it up behind him in the neutral zone.
PIECE N2 net 183 42.5 face=180 goalie
PIECE D1 player 110 20 #1f4fa3 D1 defense
PIECE F1 player 46 26 F1
PATH F1 L 80,14 L 100,12 L 120,26
PIECE PK1 puck 46 26 on=F1 chip=2:F1@3~-60
```
````

- `F1` carries from `(46,26)` up the wall.
- At **point 2** `(100,12)` — in the neutral zone at `D1` — the chip is aimed
  into the boards (`~-60`); it **banks off the glass** past the D.
- The chip carries exactly as far as **point 3** `(120,26)`, where `F1` — having
  slipped past D1 — **collects it behind him**, still in the neutral zone.
- `D1` is an auto-defenceman; `N2` has a goalie.

---

## Notes

- Angles are degrees, `0` = toward +x (right), `90` = toward +y (down / bottom
  boards), measured clockwise on screen.
- A chip follows the chipping player's facing unless you append `~<deg>`; in the
  app you can also drag the on-ice **aim ring** at the chip's release point.
- The format round-trips: what you Export is what Loads back.
