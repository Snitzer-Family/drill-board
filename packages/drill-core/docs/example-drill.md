# Chip Off the Boards, Behind the D

F1 carries up the wall and, in the neutral zone, banks a chip off the boards
past the standing-up defenceman — then slips past D1 and picks the puck up
behind him, still in the neutral zone. The chip is aimed into the boards
(`~-60`) and carries exactly as far as F1's pickup point. On-ice **labels**
call out the two key beats (`SHOW label`), plus a free-standing note down low.

Paste this whole file into DrillBoard (**☰ → Text editor → Apply**) or **Load**
it, and it plays. See [drill-dsl.md](./drill-dsl.md) for the full format.

```drill
RINK full
TITLE Chip Off the Boards, Behind the D
DESC F1 banks a chip off the boards past the standing-up D and picks it up behind him in the neutral zone.
NOTES
| ## Coaching points
|
| A **delayed** neutral-zone entry that beats a standing-up D with a chip.
|
| 1. F1 carries hard up the wall to draw the D up.
| 2. **Chip** off the glass past the D (aim `~-60`).
| 3. Slip inside and re-gather behind him — still onside.
|
| - Cue: *sell the carry* before the chip.
| - Reps: 3 each side, then add a backchecker.
END NOTES
PIECE N2 net 183 42.5 face=180 goalie
PIECE D1 player 110 20 #1f4fa3 D1 defense
PIECE F1 player 46 26 F1
PATH F1 L 80,14 DESC "Chip off glass" SHOW label OFF -22,16 L 100,12 DESC "Pickup behind D" SHOW label OFF 8,13 L 120,26
PIECE L1 label 100 73 "Neutral-zone regroup"
PIECE PK1 puck 46 26 on=F1 chip=2:F1@3~-60
STEP at=0 "**F1** carries hard up the wall"
STEP on=F1:2 "Chip off the glass past the D — `~-60`"
ITEM puck count=8
ITEM whistle count=1 "Whistle"
```
