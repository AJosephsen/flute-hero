# flute-hero

Browser-native rhythm game for learning recorder / flute-style monophonic instruments.

The player controls the game with live microphone pitch detection: hit the target note, hold it while it scrolls, and earn musical backing as accuracy improves.

## Prototype goals

- Low-latency mic input via WebAudio.
- Pitch detection tuned for monophonic recorder notes.
- Scrolling note lane with a fixed playhead.
- Per-note completion modes:
  - `timed`: scrolls past whether hit or missed.
  - `hold`: progress only while the target pitch is held.
  - `confirm`: a short correct hit completes the note.
- First exercise: a few long beginner-friendly notes.

## Run

Serve the folder locally; microphone access requires a secure context or localhost.

```bash
python3 -m http.server 8765
# open http://127.0.0.1:8765/flute-hero/
```

No build step. No runtime dependencies.

## Browser verification

A Playwright smoke test launches a real Chromium instance, injects a synthetic microphone stream, clicks the mic button, and verifies that WebAudio pitch detection reports `A4` without browser errors.

```bash
npm install
npm run verify:browser
```
