# Pitch Detection

Low-latency pitch recognition for recorder and other monophonic instruments using native WebAudio.

## Current focus

Initial YIN-style detector is implemented; it needs real recorder tuning.

## Next steps

1. Tune confidence/hysteresis against real recorder input.
2. Add note smoothing so the display does not flicker between adjacent notes.
3. Add calibration controls for tolerance in cents and instrument range.

## Key files

- `src/pitch.js`
- `src/main.js`

## Work log

| Date | What was done |
|---|---|
| 2026-05-08 | Added a lightweight YIN-style pitch detector with note/cents conversion. |

→ [Back to board](../board.md)
