# Chip Past the D (Neutral Zone)

F1 carries up the middle and, in the neutral zone right at the standing-up
defenceman, chips the puck past D1 and skates onto it in the offensive zone.

Paste this whole file into DrillBoard (**☰ → Text editor → Apply**) or **Load**
it, and it plays. See [drill-dsl.md](./drill-dsl.md) for the full format.

```drill
RINK full
TITLE Chip Past the D (Neutral Zone)
DESC F1 chips past the standing-up D in the neutral zone and skates onto it.
PIECE N2 net 183 42.5 face=180 goalie
PIECE D1 player 116 40 D1 defense
PIECE F1 player 45 20 F1
PATH F1 L 80,22 L 102,30 L 150,46
PIECE PK1 puck 45 20 on=F1 chip=2:F1@3
```
