# AGENTS.md — flute-hero

flute-hero is a browser-native music rhythm game for learning recorder / flute-style monophonic instruments using live microphone pitch detection.

## Defaults

- Use plain HTML, CSS, and JavaScript modules.
- Prefer native browser APIs: WebAudio, Canvas/SVG/DOM, requestAnimationFrame.
- Avoid dependencies unless the project board explicitly approves them.
- Keep latency low: small audio buffers, lightweight pitch detection, minimal UI work per frame.
- Design for beginner recorder first, but keep the model generic for monophonic instruments.
- Keep game logic, pitch detection, song data, and rendering separated by small explicit interfaces.

## Required workflow

Before touching code:

1. Read `project-board/board.md`.
2. Read the relevant file in `project-board/tracks/`.
3. Work only on the top item in that track's **Next steps**.
4. Update the board and track work log before stopping.

Nothing gets worked on unless it is on the board.
