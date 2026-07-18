# Chip-and-Chase off the Wall

F1 skates the wall, chips off the boards past the defenceman, and skates onto
the loose puck for a look at the net.

Paste this whole file into DrillBoard (**☰ → Text editor → Apply**) or **Load**
it, and it plays. See [drill-dsl.md](./drill-dsl.md) for the full format.

```drill
RINK full
TITLE Chip-and-Chase off the Wall
DESC F1 skates the wall, chips off the boards past the D, and skates onto it.
PIECE N2 net 183 42.5 face=180 goalie
PIECE D1 player 105 26 D1 defense
PIECE F1 player 40 12 F1
PATH F1 L 90,12 L 140,20 L 162,42
PIECE PK1 puck 40 12 on=F1 chip=2:F1@3
```
