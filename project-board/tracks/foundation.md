# Foundation

Establish the zero-dependency browser prototype: one static page, separated JS modules, playable locally with microphone access.

## Current focus

Canvas stays for the realtime note lane; DOM/CSS owns the surrounding moonlit classroom chrome.

## Next steps

1. Re-run verification with a physical recorder/microphone and capture tolerance notes.
2. Add a manual calibration/tolerance control for live recorder testing.
3. Extract moonlit UI tokens into a small documented style palette.

## Key files

- `index.html`
- `src/main.js`
- `src/styles.css`

## Work log

| Date | What was done |
|---|---|
| 2026-05-08 | Chose a hybrid rendering direction: Canvas for the scrolling lane, DOM/CSS for moonlit classroom UI chrome; applied the first moonlit visual pass. |
| 2026-05-08 | Added a debug overlay for frame time, audio latency, detected frequency, and pitch confidence; browser verification now asserts it populates. |
| 2026-05-08 | Added Playwright browser smoke verification with a synthetic microphone stream; Chromium detected A4 and rendered the lane without browser errors. |
| 2026-05-08 | Scaffolded static HTML/CSS/JS prototype with mic button, note lane, and modular source files. |

→ [Back to board](../board.md)
