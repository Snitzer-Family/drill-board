---
slug: wheel-breakout-strong-side
summary: D1 retrieves behind the net, wheels with speed and hits the winger breaking up the strong-side wall.
zone: defensive-zone
level: u12
tags: [breakout]
skills: [skating, passing, support]
duration: 12
players: 8
featured: true
updated: 2026-07-20
---

# Wheel Breakout, Strong Side

The retrieval is the drill. D1 arrives at the puck with his head already up,
wheels behind the net instead of stopping, and uses the speed he carries out of
the turn to make the wall pass an easy one. F1 times the route so the puck
arrives on his forehand, moving north.

```drill
RINK full
TITLE Wheel Breakout, Strong Side
DESC D1 retrieves behind the net, wheels with speed and hits F1 breaking up the strong-side wall.
NOTES
| ## Coaching points
|
| 1. **Head up before the puck.** Shoulder-check on the way back, not after.
| 2. Wheel — do not stop. Speed out of the turn is what makes the pass easy.
| 3. F1 times his route so the puck arrives moving *north*, on the forehand.
|
| - Cue: *eyes up, feet moving.*
| - Progression: add a forechecker on the second rep.
END NOTES
PIECE N1 net 17 42.5 face=0 goalie
PIECE D1 player 11 55 #1f4fa3 D1 defense
PIECE F1 player 30 12 F1
PATH D1 L 14,68 DESC "Wheel" SHOW label OFF -14,10 L 34,70 L 48,60
PATH F1 L 52,10 L 82,16
PIECE PK1 puck 11 55 on=D1 pass=3:F1@1
STEP at=0 "**D1** arrives with his head already up"
ITEM puck count=6
ITEM cone count=2
```
