import { detectPitchYin, midiToName, SOPRANO_RECORDER_BEGINNER, toleranceForMidi } from './pitch.js';
import { LEVELS, CONFIRM_SECONDS } from './songs.js';
import { isSongUnlocked, isLevelUnlocked, isLevelCompleted, isSongCompleted, markSongComplete } from './progress.js';

// ── Canvas + DOM refs ────────────────────────────────────────────────────────
const canvas = document.querySelector('#noteLane');
const ctx = canvas.getContext('2d');
const debugFrameTime = document.querySelector('#debugFrameTime');
const debugAudioLatency = document.querySelector('#debugAudioLatency');
const debugFrequency = document.querySelector('#debugFrequency');
const debugConfidence = document.querySelector('#debugConfidence');

// ── Screen state ─────────────────────────────────────────────────────────────
// screens: 'home' | 'levels' | 'playing' | 'complete'
let screen = 'home';
let activeLevelIdx = 0;
let activeSongIdx = 0;

// ── Audio state ──────────────────────────────────────────────────────────────
const audio = { ctx: null, analyser: null, buffer: null };

// ── Game state ───────────────────────────────────────────────────────────────
const game = {
  pitch: null,
  songTime: 0,
  lastFrame: performance.now(),
  heldCorrectFor: new Map(),
  completed: new Set(),
  song: null,
  songFinished: false,
};

// ── Boot ─────────────────────────────────────────────────────────────────────
buildHomeScreen();
requestAnimationFrame(frame);

// ── Frame loop ───────────────────────────────────────────────────────────────
function frame(now) {
  const dt = Math.min(0.05, (now - game.lastFrame) / 1000);
  game.lastFrame = now;

  updatePitch();
  if (screen === 'playing') updateGame(dt);
  renderCanvas();
  updateDebug(dt);
  requestAnimationFrame(frame);
}

// ── Audio / pitch ────────────────────────────────────────────────────────────
async function startMic() {
  if (audio.ctx) return; // already started
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  audio.ctx = new AudioContext({ latencyHint: 'interactive' });
  const source = audio.ctx.createMediaStreamSource(stream);
  audio.analyser = audio.ctx.createAnalyser();
  audio.analyser.fftSize = 4096;
  audio.analyser.smoothingTimeConstant = 0;
  source.connect(audio.analyser);
  audio.buffer = new Float32Array(audio.analyser.fftSize);
}

function updatePitch() {
  if (!audio.analyser) { game.pitch = null; return; }
  audio.analyser.getFloatTimeDomainData(audio.buffer);
  const p = detectPitchYin(audio.buffer, audio.ctx.sampleRate, SOPRANO_RECORDER_BEGINNER);
  game.pitch = p?.confidence >= 0.68 ? p : null;
}

// ── Game logic ───────────────────────────────────────────────────────────────
function startSong(levelIdx, songIdx) {
  activeLevelIdx = levelIdx;
  activeSongIdx = songIdx;
  game.song = LEVELS[levelIdx].songs[songIdx];
  game.songTime = 0;
  game.heldCorrectFor = new Map();
  game.completed = new Set();
  game.songFinished = false;
  screen = 'playing';
  buildPlayingScreen();
}

function updateGame(dt) {
  if (game.songFinished) return;
  const song = game.song;
  const notes = song.notes;

  const current = currentNote(game.songTime, notes);

  if (current) {
    const hit = isHit(current);
    const key = current.start;

    if (hit) {
      game.heldCorrectFor.set(key, (game.heldCorrectFor.get(key) ?? 0) + dt);
    }

    const held = game.heldCorrectFor.get(key) ?? 0;

    if (current.mode === 'timed') {
      // Song time always flows — note auto-completes when it leaves the window
      game.songTime += dt;
    } else if (current.mode === 'hold') {
      // Song only advances while the note is held
      if (hit) {
        game.songTime += dt;
        game.completed.add(key);
      }
    } else if (current.mode === 'confirm') {
      // Song only advances after holding the note long enough
      if (hit && held >= CONFIRM_SECONDS) {
        game.completed.add(key);
        game.songTime += dt;
      } else if (hit) {
        game.songTime += dt;
      }
    }
  } else {
    // Between notes or after all notes: advance normally
    const lastNote = notes[notes.length - 1];
    const songEnd = lastNote ? lastNote.start + lastNote.duration + 1.5 : 0;

    if (game.songTime >= songEnd) {
      finishSong();
      return;
    }
    game.songTime += dt;
  }
}

function currentNote(songTime, notes) {
  return notes.find(n => songTime >= n.start && songTime < n.start + n.duration) ?? null;
}

function isHit(note) {
  if (!note || !game.pitch) return false;
  return game.pitch.midi === note.midi && Math.abs(game.pitch.cents) <= toleranceForMidi(note.midi);
}

function finishSong() {
  game.songFinished = true;
  markSongComplete(activeLevelIdx, activeSongIdx);
  screen = 'complete';
  buildCompleteScreen();
}

// ── Screen builders ──────────────────────────────────────────────────────────

function setMain(html) {
  document.querySelector('.dynamic-ui').innerHTML = html;
}

function buildHomeScreen() {
  screen = 'home';
  setMain(`
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">moonlit music school</p>
        <h1>flute-hero</h1>
        <p class="lede">Follow the glowing music trail, play the recorder note, and wake the little classroom stars.</p>
        <button id="btnStart" type="button">
          <img src="./art/ui/recorder-icon.svg" alt="" /> Let's Play
        </button>
      </div>
      <img class="mascot" src="./art/ui/raccoon-mascot.svg" alt="A cute raccoon recorder student" />
    </section>
  `);
  document.querySelector('#btnStart').addEventListener('click', async () => {
    await startMic();
    buildLevelsScreen();
  });
}

function buildLevelsScreen() {
  screen = 'levels';
  const levelCards = LEVELS.map((level, li) => {
    const unlocked = isLevelUnlocked(li, LEVELS);
    const complete = isLevelCompleted(li, level.songs.length);
    const songItems = level.songs.map((song, si) => {
      const songUnlocked = isSongUnlocked(li, si, LEVELS);
      const songDone = isSongCompleted(li, si);
      const badge = songDone ? '⭐' : songUnlocked ? '♪' : '🔒';
      return `
        <button class="song-btn ${songUnlocked ? '' : 'locked'} ${songDone ? 'done' : ''}"
          data-level="${li}" data-song="${si}" ${songUnlocked ? '' : 'disabled'}>
          <span class="song-badge">${badge}</span>
          <span class="song-title">${song.title}</span>
          <span class="song-tempo">${song.tempo} bpm</span>
        </button>
      `;
    }).join('');

    return `
      <div class="level-card ${unlocked ? '' : 'locked'}">
        <div class="level-header">
          <span class="level-num">Level ${li + 1}</span>
          <span class="level-name">${level.name}</span>
          ${complete ? '<span class="level-badge">✓ Complete</span>' : ''}
          ${!unlocked ? '<span class="level-badge locked-badge">🔒 Locked</span>' : ''}
        </div>
        <p class="level-desc">${level.description}</p>
        <div class="song-list">${songItems}</div>
      </div>
    `;
  }).join('');

  setMain(`
    <section class="levels-screen">
      <div class="levels-header">
        <h2>Choose a Song</h2>
        <p class="muted">Complete songs in order to unlock the next</p>
      </div>
      ${levelCards}
    </section>
  `);

  document.querySelectorAll('.song-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      startSong(+btn.dataset.level, +btn.dataset.song);
    });
  });
}

function buildPlayingScreen() {
  const song = game.song;
  setMain(`
    <section class="playing-screen">
      <div class="playing-header">
        <button id="btnBack" class="back-btn">← Back</button>
        <span class="playing-title">${LEVELS[activeLevelIdx].name} · ${song.title}</span>
        <span class="mic-badge" id="micBadge">${audio.ctx ? '🎙 listening' : ''}</span>
      </div>
      <div class="meters panel">
        <div><span class="label">Detected</span><strong id="detectedNote">—</strong></div>
        <div><span class="label">Target</span><strong id="targetNote">—</strong></div>
        <div><span class="label">Status</span><strong id="accuracy">—</strong></div>
      </div>
    </section>
  `);
  document.querySelector('#btnBack').addEventListener('click', buildLevelsScreen);
}

function buildCompleteScreen() {
  const nextSongIdx = activeSongIdx + 1;
  const levelComplete = isLevelCompleted(activeLevelIdx, LEVELS[activeLevelIdx].songs.length);
  const nextLevelIdx = activeLevelIdx + 1;
  const hasNextSong = nextSongIdx < LEVELS[activeLevelIdx].songs.length;
  const hasNextLevel = nextLevelIdx < LEVELS.length;

  let nextBtn = '';
  if (hasNextSong) {
    nextBtn = `<button id="btnNext">Next song →</button>`;
  } else if (levelComplete && hasNextLevel) {
    nextBtn = `<button id="btnNextLevel">Start Level ${nextLevelIdx + 1} →</button>`;
  }

  setMain(`
    <section class="complete-screen">
      <img class="mascot mascot-celebrate" src="./art/ui/raccoon-mascot.svg" alt="" />
      <h2>⭐ Song Complete!</h2>
      <p class="complete-song">${game.song.title}</p>
      ${levelComplete && hasNextLevel ? `<p class="level-unlocked">🔓 Level ${nextLevelIdx + 1} — ${LEVELS[nextLevelIdx].name} unlocked!</p>` : ''}
      <div class="complete-actions">
        <button id="btnRetry">↺ Play again</button>
        ${nextBtn}
        <button id="btnMenu">Song list</button>
      </div>
    </section>
  `);

  document.querySelector('#btnRetry').addEventListener('click', () => startSong(activeLevelIdx, activeSongIdx));
  document.querySelector('#btnMenu').addEventListener('click', buildLevelsScreen);
  document.querySelector('#btnNext')?.addEventListener('click', () => startSong(activeLevelIdx, nextSongIdx));
  document.querySelector('#btnNextLevel')?.addEventListener('click', () => startSong(nextLevelIdx, 0));
}

// ── Canvas render ────────────────────────────────────────────────────────────
function renderCanvas() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (screen !== 'playing' && screen !== 'complete') {
    drawStars(width, height);
    return;
  }

  const song = game.song;
  const notes = song.notes;
  drawStars(width, height);

  const SPEED = 120; // px per second
  const playheadX = 200;

  // Draw note lane background
  const rowCount = 7; // C5 D5 E5 F5 G5 A5 B5 (+D6 bonus)
  const rowHeight = height / (rowCount + 1);
  const midiMin = 72; // C5

  // Subtle lane lines
  ctx.save();
  ctx.strokeStyle = 'rgba(189,140,255,.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= rowCount; i++) {
    const y = height - (i + 0.5) * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Note node rows (MIDI → y)
  function noteY(midi) {
    const row = midi - midiMin;
    return height - (row + 0.5) * rowHeight;
  }

  // Draw upcoming + past notes
  for (const note of notes) {
    const dx = (note.start - game.songTime) * SPEED;
    const noteX = playheadX + dx;
    const noteEndX = playheadX + (note.start + note.duration - game.songTime) * SPEED;

    if (noteEndX < -40 || noteX > width + 40) continue;

    const y = noteY(note.midi);
    const done = game.completed.has(note.start);
    const current = currentNote(game.songTime, notes);
    const isActive = current === note;
    const hit = isActive && isHit(note);

    // Draw note bar
    const barX = Math.max(0, noteX);
    const barW = noteEndX - barX;
    if (barW > 0) {
      ctx.save();
      ctx.fillStyle = done
        ? 'rgba(102,86,142,.55)'
        : isActive && hit
        ? 'rgba(133,255,208,.18)'
        : 'rgba(189,140,255,.15)';
      ctx.beginPath();
      roundRect(ctx, barX, y - 8, barW, 16, 8);
      ctx.fill();
      ctx.restore();
    }

    // Draw note circle
    if (noteX > -20 && noteX < width + 20) {
      drawNoteNode(ctx, noteX, y, hit, done, note.note);
    }
  }

  // Playhead
  drawPlayhead(ctx, playheadX, height);

  // Current pitch indicator
  if (game.pitch && screen === 'playing') {
    drawPitchIndicator(ctx, game.pitch, playheadX, height, noteY, midiMin);
  }

  // DOM stat updates
  if (screen === 'playing') {
    const current = currentNote(game.songTime, song.notes);
    const hit = isHit(current);
    const detectedNote = document.querySelector('#detectedNote');
    const targetNote = document.querySelector('#targetNote');
    const accuracy = document.querySelector('#accuracy');
    if (detectedNote) detectedNote.textContent = game.pitch ? `${game.pitch.note} ${game.pitch.cents > 0 ? '+' : ''}${game.pitch.cents.toFixed(0)}¢` : '—';
    if (targetNote) targetNote.textContent = current ? current.note : game.songFinished ? 'done' : '—';
    if (accuracy) accuracy.textContent = current ? (hit ? 'hit ✓' : 'searching…') : game.songFinished ? 'finished!' : '—';
  }
}

function drawPitchIndicator(ctx, pitch, playheadX, height, noteY, midiMin) {
  const y = Math.max(14, Math.min(height - 14, noteY(pitch.midi)));
  const close = Math.abs(pitch.cents) <= 35;

  ctx.save();
  ctx.shadowColor = close ? 'rgba(116,247,255,.9)' : 'rgba(255,215,106,.5)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = close ? '#85ffd0' : '#ffd76a';
  ctx.strokeStyle = '#fff8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(playheadX, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  const labelX = playheadX + 18;
  ctx.fillStyle = 'rgba(17,10,39,.84)';
  roundRect(ctx, labelX, y - 16, 84, 32, 16);
  ctx.fill();
  ctx.strokeStyle = close ? 'rgba(133,255,208,.72)' : 'rgba(255,215,106,.65)';
  ctx.stroke();
  ctx.fillStyle = '#fff8ff';
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(pitch.note, labelX + 10, y - 3);
  ctx.fillStyle = close ? '#85ffd0' : '#ffd76a';
  ctx.font = '700 10px Inter, system-ui, sans-serif';
  ctx.fillText(`${pitch.cents > 0 ? '+' : ''}${pitch.cents.toFixed(0)}¢`, labelX + 10, y + 10);
  ctx.restore();
}

function drawNoteNode(ctx, x, y, hit, done, label) {
  const r = hit ? 11 : 9;
  const gradient = ctx.createRadialGradient(x - 2, y - 3, 2, x, y, r);
  gradient.addColorStop(0, '#fff8ff');
  gradient.addColorStop(0.5, hit ? '#85ffd0' : done ? '#9978d2' : '#fff0a7');
  gradient.addColorStop(1, done ? '#66568e' : '#bd8cff');
  ctx.save();
  ctx.shadowColor = hit ? 'rgba(116,247,255,.9)' : 'rgba(255,215,106,.45)';
  ctx.shadowBlur = hit ? 14 : 7;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,248,255,.72)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Note label above node
  ctx.fillStyle = done ? 'rgba(189,170,255,.55)' : 'rgba(255,248,255,.88)';
  ctx.font = '700 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - r - 3);
  ctx.restore();
}

function drawPlayhead(ctx, x, height) {
  ctx.save();
  ctx.shadowColor = 'rgba(116,247,255,.9)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#a7f8ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, 14);
  ctx.lineTo(x, height - 10);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Moon head
  ctx.fillStyle = '#fff0a7';
  ctx.strokeStyle = '#fff8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x - 2, 22, 11, Math.PI * 0.42, Math.PI * 1.62, false);
  ctx.arc(x + 4, 22, 8, Math.PI * 1.68, Math.PI * 0.35, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawSparkle(ctx, x + 16, 38, 6);
  ctx.restore();
}

function drawSparkle(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#fff0a7';
  ctx.shadowColor = 'rgba(255,240,167,.8)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.28, -size * 0.28);
  ctx.lineTo(size, 0);
  ctx.lineTo(size * 0.28, size * 0.28);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.28, size * 0.28);
  ctx.lineTo(-size, 0);
  ctx.lineTo(-size * 0.28, -size * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStars(width, height) {
  const stars = [
    [104, 38, 1.4], [184, 246, 1.0], [314, 72, 1.2], [472, 282, 1.1],
    [612, 46, 1.5], [744, 238, 1.0], [872, 88, 1.3], [924, 292, 1.0],
  ];
  ctx.fillStyle = 'rgba(255, 240, 167, .72)';
  for (const [sx, sy, r] of stars) {
    ctx.beginPath();
    ctx.arc(sx % width, sy % height, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Debug panel ──────────────────────────────────────────────────────────────
function updateDebug(dt) {
  if (debugFrameTime) debugFrameTime.textContent = `${(dt * 1000).toFixed(1)} ms`;
  if (!audio.ctx) {
    if (debugAudioLatency) debugAudioLatency.textContent = 'mic off';
    if (debugFrequency) debugFrequency.textContent = '—';
    if (debugConfidence) debugConfidence.textContent = '—';
    return;
  }
  const latencyMs = ((audio.ctx.baseLatency ?? 0) + (audio.ctx.outputLatency ?? 0)) * 1000;
  if (debugAudioLatency) debugAudioLatency.textContent = latencyMs > 0 ? `${latencyMs.toFixed(1)} ms` : 'unknown';
  if (debugFrequency) debugFrequency.textContent = game.pitch ? `${game.pitch.frequency.toFixed(1)} Hz` : '—';
  if (debugConfidence) debugConfidence.textContent = game.pitch ? `${Math.round(game.pitch.confidence * 100)}%` : '—';
}
