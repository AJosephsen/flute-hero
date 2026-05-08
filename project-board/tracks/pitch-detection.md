# Pitch Detection

Low-latency pitch recognition for recorder and other monophonic instruments using native WebAudio.

## Current focus

Detection is constrained to a beginner soprano recorder profile; next step is real recorder tuning and smoothing.

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
| 2026-05-08 | Added a beginner soprano recorder profile: C5-D6 detection range, 4096-sample analysis buffer, higher YIN threshold, adaptive cents tolerance, and G5/A5/B5 starter exercise. |
| 2026-05-08 | Added a lightweight YIN-style pitch detector with note/cents conversion. |

→ [Back to board](../board.md)
