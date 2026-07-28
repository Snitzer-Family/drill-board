---
slug: overview
title: What the drill format is
summary: Every drill is plain text. That is what makes them shareable, diffable and printable.
order: 1
updated: 2026-07-24
---

# What the drill format is

Under the drawing surface, every drill is **plain text** — a short list of
statements in real rink feet. The board reads and writes it, this website
renders diagrams straight from it, and you can paste it into a message.

A small one looks like this:

```
RINK full
TITLE Give-and-Go to the Net
PIECE N2 net 183 42.5 face=180 goalie
PIECE F1 player 120 62 F1
PATH F1 L 142,52 L 158,44
PIECE PK1 puck 120 62 on=F1 pass=1:F2@0 shoot=2:F1
```

## Why it is text

- **Sharing needs no server.** A drill fits in a URL, so a link carries the
  whole thing.
- **Diagrams can't drift.** The rink you see on a drill page here is drawn from
  exactly these lines by the same renderer the animator uses.
- **You can read a change.** Two versions of a drill differ by a line or two,
  and you can see which.

## Coordinates

`x` runs 0 to 200 and `y` runs 0 to 85 — real feet on a full sheet. Goal lines
sit at `x=11` and `x=189`. Everything about timing derives from those distances,
which is why a drill runs at a believable speed without you setting any.

You never have to write this by hand. But when you want to tweak one number, or
send a drill to someone, it helps to know it's just text.
