# Chip Off the Boards, Behind the D

F1 carries up the wall and, in the neutral zone, banks a chip off the boards
past the standing-up defenceman — then slips past D1 and picks the puck up
behind him, still in the neutral zone. The chip is aimed into the boards
(`~-60`) and carries exactly as far as F1's pickup point.

Paste this whole file into DrillBoard (**☰ → Text editor → Apply**) or **Load**
it, and it plays. See [drill-dsl.md](./drill-dsl.md) for the full format.

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
