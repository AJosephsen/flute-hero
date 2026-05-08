# Foundation

Establish the zero-dependency browser prototype: one static page, separated JS modules, playable locally with microphone access.

## Current focus

Real-browser smoke verification is in place; next step is exposing useful timing/debug information while tuning live input.

## Next steps

1. Add a small debug overlay for frame time, audio context latency, and detected frequency.
2. Decide whether the first renderer should stay Canvas or split into DOM/SVG for easier note editing.
3. Re-run verification with a physical recorder/microphone and capture tolerance notes.

## Key files

- `index.html`
- `src/main.js`
- `src/styles.css`

## Work log

| Date | What was done |
|---|---|
| 2026-05-08 | Added Playwright browser smoke verification with a synthetic microphone stream; Chromium detected A4 and rendered the lane without browser errors. |
| 2026-05-08 | Scaffolded static HTML/CSS/JS prototype with mic button, note lane, and modular source files. |

→ [Back to board](../board.md)
