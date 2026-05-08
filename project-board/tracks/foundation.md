# Foundation

Establish the zero-dependency browser prototype: one static page, separated JS modules, playable locally with microphone access.

## Current focus

Debug telemetry is visible in-browser; next step is deciding whether Canvas remains the right renderer for note editing.

## Next steps

1. Decide whether the first renderer should stay Canvas or split into DOM/SVG for easier note editing.
2. Re-run verification with a physical recorder/microphone and capture tolerance notes.
3. Add a manual calibration/tolerance control for live recorder testing.

## Key files

- `index.html`
- `src/main.js`
- `src/styles.css`

## Work log

| Date | What was done |
|---|---|
| 2026-05-08 | Added a debug overlay for frame time, audio latency, detected frequency, and pitch confidence; browser verification now asserts it populates. |
| 2026-05-08 | Added Playwright browser smoke verification with a synthetic microphone stream; Chromium detected A4 and rendered the lane without browser errors. |
| 2026-05-08 | Scaffolded static HTML/CSS/JS prototype with mic button, note lane, and modular source files. |

→ [Back to board](../board.md)
