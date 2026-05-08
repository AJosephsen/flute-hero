# Gameplay

Shape the rhythm-game loop: scrolling notes, target matching, completion modes, and useful feedback for beginners.

## Current focus

The note lane now shows the live detected pitch as an in-canvas indicator; next step is richer scoring/feedback.

## Next steps

1. Add simple scoring for hit ratio, hold stability, and streaks.
2. Add pause/restart and exercise completion states.
3. Tune live pitch indicator placement after physical recorder testing.

## Key files

- `src/main.js`
- `src/song.js`

## Work log

| Date | What was done |
|---|---|
| 2026-05-08 | Moved the lane header out of the canvas overlay so it does not cover notes on iPhone/mobile layouts. |
| 2026-05-08 | Added an in-canvas current pitch indicator showing detected note/cents near the playhead. |
| 2026-05-08 | Implemented a fixed-playhead scrolling lane and first-pass note completion modes: timed, hold, confirm. |

→ [Back to board](../board.md)
