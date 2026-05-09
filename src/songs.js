// ── Song builder ──────────────────────────────────────────────────────────────
// seq items: [noteName, midiVal, durationBeats]  or  a plain number = rest beats

const GAP = 0.08; // silence gap between consecutive notes (seconds)

function buildSong(title, bpm, mode, seq) {
  const beat = 60 / bpm;
  let cursor = 0;
  const notes = [];
  for (const item of seq) {
    if (typeof item === 'number') {
      cursor += item * beat;
      continue;
    }
    const [note, midi, beats] = item;
    notes.push({ note, midi, start: cursor, duration: beats * beat - GAP, mode });
    cursor += beats * beat;
  }
  return { title, tempo: bpm, notes };
}

// ── Level 1 — First Notes ─────────────────────────────────────────────────────
// Mode: timed — song auto-scrolls; just try to match each note as it passes.
// Range: G5, A5, B5  (+C6, D6 in later songs)

const hotCrossBuns = buildSong('Hot Cross Buns', 80, 'timed', [
  ['B5', 83, 1], ['A5', 81, 1], ['G5', 79, 2],
  2,
  ['B5', 83, 1], ['A5', 81, 1], ['G5', 79, 2],
  2,
  ['G5', 79, 1], ['G5', 79, 1], ['G5', 79, 1], ['G5', 79, 1],
  ['A5', 81, 1], ['A5', 81, 1], ['A5', 81, 1], ['A5', 81, 1],
  ['B5', 83, 1], ['A5', 81, 1], ['G5', 79, 4],
]);

// Same melody as Mary Had a Little Lamb, transposed to G (B A G D)
const merrilyWeRollAlong = buildSong('Merrily We Roll Along', 80, 'timed', [
  ['B5', 83, 1], ['A5', 81, 1], ['G5', 79, 1], ['A5', 81, 1],
  ['B5', 83, 1], ['B5', 83, 1], ['B5', 83, 2],
  ['A5', 81, 1], ['A5', 81, 1], ['A5', 81, 2],
  ['B5', 83, 1], ['D6', 86, 1], ['D6', 86, 2],
  ['B5', 83, 1], ['A5', 81, 1], ['G5', 79, 1], ['A5', 81, 1],
  ['B5', 83, 1], ['B5', 83, 1], ['B5', 83, 1], ['B5', 83, 1],
  ['A5', 81, 1], ['A5', 81, 1], ['B5', 83, 1], ['A5', 81, 1],
  ['G5', 79, 4],
]);

// Classic French folk tune, G major version (G A B C D)
const auClairDeLaLune = buildSong('Au Clair de la Lune', 80, 'timed', [
  // Phrase 1
  ['G5', 79, 1], ['G5', 79, 1], ['G5', 79, 1], ['A5', 81, 1],
  ['B5', 83, 2], ['A5', 81, 2],
  ['G5', 79, 1], ['B5', 83, 1], ['A5', 81, 1], ['A5', 81, 1],
  ['G5', 79, 4],
  // Phrase 2
  ['D6', 86, 1], ['D6', 86, 1], ['C6', 84, 1], ['C6', 84, 1],
  ['B5', 83, 4],
  ['D6', 86, 1], ['C6', 84, 1], ['B5', 83, 1], ['A5', 81, 1],
  ['G5', 79, 4],
]);

// ── Level 2 — New Sounds ──────────────────────────────────────────────────────
// Mode: hold — song waits at each note until you hold it correctly.
// Range: C5 D5 E5 F5 G5 A5

const maryHadALittleLamb = buildSong('Mary Had a Little Lamb', 75, 'hold', [
  ['E5', 76, 1], ['D5', 74, 1], ['C5', 72, 1], ['D5', 74, 1],
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 2],
  ['D5', 74, 1], ['D5', 74, 1], ['D5', 74, 2],
  ['E5', 76, 1], ['G5', 79, 1], ['G5', 79, 2],
  ['E5', 76, 1], ['D5', 74, 1], ['C5', 72, 1], ['D5', 74, 1],
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 1],
  ['D5', 74, 1], ['D5', 74, 1], ['E5', 76, 1], ['D5', 74, 1],
  ['C5', 72, 4],
]);

// Beethoven's Ode to Joy (simplified, C major)
const odeToJoy = buildSong('Ode to Joy', 75, 'hold', [
  ['E5', 76, 1], ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 1],
  ['G5', 79, 1], ['F5', 77, 1], ['E5', 76, 1], ['D5', 74, 1],
  ['C5', 72, 1], ['C5', 72, 1], ['D5', 74, 1], ['E5', 76, 1],
  ['E5', 76, 1.5], ['D5', 74, 0.5], ['D5', 74, 2],
  ['E5', 76, 1], ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 1],
  ['G5', 79, 1], ['F5', 77, 1], ['E5', 76, 1], ['D5', 74, 1],
  ['C5', 72, 1], ['C5', 72, 1], ['D5', 74, 1], ['E5', 76, 1],
  ['D5', 74, 1.5], ['C5', 72, 0.5], ['C5', 72, 4],
]);

// London Bridge (G major, D E F G A)
const londonBridge = buildSong('London Bridge', 75, 'hold', [
  ['G5', 79, 1], ['A5', 81, 1], ['G5', 79, 1], ['F5', 77, 1],
  ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 2],
  ['D5', 74, 1], ['E5', 76, 1], ['F5', 77, 1],
  ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 2],
  ['G5', 79, 1], ['A5', 81, 1], ['G5', 79, 1], ['F5', 77, 1],
  ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 2],
  ['D5', 74, 1], ['G5', 79, 1], ['G5', 79, 4],
]);

// ── Level 3 — Full Range ──────────────────────────────────────────────────────
// Mode: confirm — hold each note for the full count before it advances.
// Range: C5 through A5

const twinkleTwinkle = buildSong('Twinkle Twinkle', 70, 'confirm', [
  ['C5', 72, 1], ['C5', 72, 1], ['G5', 79, 1], ['G5', 79, 1],
  ['A5', 81, 1], ['A5', 81, 1], ['G5', 79, 2],
  ['F5', 77, 1], ['F5', 77, 1], ['E5', 76, 1], ['E5', 76, 1],
  ['D5', 74, 1], ['D5', 74, 1], ['C5', 72, 2],
  ['G5', 79, 1], ['G5', 79, 1], ['F5', 77, 1], ['F5', 77, 1],
  ['E5', 76, 1], ['E5', 76, 1], ['D5', 74, 2],
  ['G5', 79, 1], ['G5', 79, 1], ['F5', 77, 1], ['F5', 77, 1],
  ['E5', 76, 1], ['E5', 76, 1], ['D5', 74, 2],
  ['C5', 72, 1], ['C5', 72, 1], ['G5', 79, 1], ['G5', 79, 1],
  ['A5', 81, 1], ['A5', 81, 1], ['G5', 79, 2],
  ['F5', 77, 1], ['F5', 77, 1], ['E5', 76, 1], ['E5', 76, 1],
  ['D5', 74, 1], ['D5', 74, 1], ['C5', 72, 4],
]);

// Jingle Bells (chorus, C major)
const jingleBells = buildSong('Jingle Bells', 70, 'confirm', [
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 2],
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 2],
  ['E5', 76, 1], ['G5', 79, 1], ['C5', 72, 1], ['D5', 74, 1],
  ['E5', 76, 4],
  ['F5', 77, 1], ['F5', 77, 1], ['F5', 77, 1], ['F5', 77, 1],
  ['F5', 77, 1], ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 1],
  ['E5', 76, 1], ['D5', 74, 1], ['D5', 74, 1], ['E5', 76, 1],
  ['D5', 74, 2], ['G5', 79, 2],
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 2],
  ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 2],
  ['E5', 76, 1], ['G5', 79, 1], ['C5', 72, 1], ['D5', 74, 1],
  ['E5', 76, 4],
  ['F5', 77, 1], ['F5', 77, 1], ['F5', 77, 1], ['F5', 77, 1],
  ['F5', 77, 1], ['E5', 76, 1], ['E5', 76, 1], ['E5', 76, 1],
  ['G5', 79, 1], ['G5', 79, 1], ['F5', 77, 1], ['D5', 74, 1],
  ['C5', 72, 4],
]);

// When the Saints Go Marching In (C major)
const whenTheSaints = buildSong('When the Saints Go Marching In', 70, 'confirm', [
  ['C5', 72, 1], ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 2],
  ['C5', 72, 1], ['E5', 76, 1], ['F5', 77, 1], ['G5', 79, 2],
  ['C5', 72, 1], ['E5', 76, 1], ['F5', 77, 1],
  ['G5', 79, 1.5], ['E5', 76, 0.5],
  ['C5', 72, 1], ['E5', 76, 1], ['D5', 74, 2],
  ['E5', 76, 1], ['C5', 72, 1], ['E5', 76, 1], ['F5', 77, 2],
  ['E5', 76, 1], ['C5', 72, 1],
  ['C5', 72, 1], ['D5', 74, 1], ['E5', 76, 2], ['C5', 72, 2],
  ['C5', 72, 1], ['D5', 74, 1], ['E5', 76, 4],
]);

// ── Exports ───────────────────────────────────────────────────────────────────

export const LEVELS = [
  {
    name: 'First Notes',
    description: 'B, A, G — the classic first three recorder notes. Song flows at its own pace.',
    songs: [hotCrossBuns, merrilyWeRollAlong, auClairDeLaLune],
  },
  {
    name: 'New Sounds',
    description: 'Lower register: C, D, E, F, G. The song waits for you to hold each note.',
    songs: [maryHadALittleLamb, odeToJoy, londonBridge],
  },
  {
    name: 'Full Range',
    description: 'The whole beginner range. Hold every note for the full count to move on.',
    songs: [twinkleTwinkle, jingleBells, whenTheSaints],
  },
];

// How long (seconds) a note must be held in 'confirm' mode before advancing
export const CONFIRM_SECONDS = 0.3;
