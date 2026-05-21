import { detectPitchYin, SOPRANO_RECORDER_BEGINNER, toleranceForMidi, rms } from './pitch.js';
import { LEVELS, CONFIRM_SECONDS } from './songs.js';
import { isSongUnlocked, isLevelUnlocked, isLevelCompleted, isSongCompleted, markSongComplete } from './progress.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas          = document.querySelector('#noteLane');
const ctx             = canvas.getContext('2d');
const laneShell       = document.querySelector('#laneShell');
const dynUI           = document.querySelector('.dynamic-ui');
const debugFrameTime  = document.querySelector('#debugFrameTime');
const debugAudioLatency = document.querySelector('#debugAudioLatency');
const debugFrequency  = document.querySelector('#debugFrequency');
const debugConfidence = document.querySelector('#debugConfidence');

// ── Canvas resize ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width  = laneShell.clientWidth  * dpr;
  canvas.height = laneShell.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(() => {
  if (laneShell.classList.contains('active')) { resizeCanvas(); schedulePanelUpdate(); }
}).observe(laneShell);

// ── Fullscreen ────────────────────────────────────────────────────────────────
function enterFS() {
  const el = document.documentElement;
  try { (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)?.call(el); } catch {}
}
function exitFS() {
  try { (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen)?.call(document); } catch {}
}
function isFS() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

function showLane() {
  laneShell.classList.add('active');
  dynUI.style.display = 'none';
  resizeCanvas();
  if (!isFS()) enterFS();
}
function hideLane() {
  laneShell.classList.remove('active');
  dynUI.style.display = '';
  if (isFS()) exitFS();
  document.querySelector('.play-hud')?.remove();
}

// ── Scoring state ─────────────────────────────────────────────────────────────
const scoring = {
  points:       0,
  streak:       0,
  health:       100,   // 0–100
  particles:    [],
  floats:       [],    // floating "+pts ×N" labels
  panelX:       0,     // score panel centre in CSS-px (viewport coords)
  panelY:       0,
  panelPulse:   0,     // 1→0, flash on score
  healthShake:  0,     // >0 shakes bar on miss
  awardedNotes: new Set(),
  touched:      new Set(),
};

function resetScoring() {
  scoring.points       = 0;
  scoring.streak       = 0;
  scoring.health       = 100;
  scoring.particles    = [];
  scoring.floats       = [];
  scoring.panelPulse   = 0;
  scoring.healthShake  = 0;
  scoring.awardedNotes = new Set();
  scoring.touched      = new Set();
}

function streakMultiplier() {
  if (scoring.streak >= 12) return 4;
  if (scoring.streak >= 8)  return 3;
  if (scoring.streak >= 4)  return 2;
  return 1;
}

// ── Note-Y helper (accessible outside render for scoring) ─────────────────────
function noteYCSS(midi) {
  const H  = laneShell.clientHeight;
  const sg = staffGeometry(laneShell.clientWidth, H);
  return sg.noteY(midi);
}

// ── Particle colours ──────────────────────────────────────────────────────────
const P_COLORS = ['#ffd76a','#85ffd0','#74f7ff','#bd8cff','#fff0a7','#ff92bf','#ffffff'];

function spawnParticles(x, y, mult) {
  const count = 10 + mult * 4;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    scoring.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color: P_COLORS[Math.floor(Math.random() * P_COLORS.length)],
      size: 2.5 + Math.random() * 4,
    });
  }
}

function spawnFloat(x, y, pts, mult) {
  scoring.floats.push({
    x,
    y: y - 14,
    label: mult > 1 ? `+${pts} ×${mult}` : `+${pts}`,
    life: 1,
    vy: -55,
  });
}

function schedulePanelUpdate() {
  requestAnimationFrame(() => {
    const el = document.querySelector('#scorePanel');
    if (!el) return;
    const r = el.getBoundingClientRect();
    scoring.panelX = r.left + r.width  / 2;
    scoring.panelY = r.top  + r.height / 2;
  });
}

// Called when a note window closes — award or penalise
function evaluateNote(note) {
  if (scoring.awardedNotes.has(note.start)) return;
  scoring.awardedNotes.add(note.start);

  const W  = laneShell.clientWidth;
  const px = W * 0.22; // playhead x — notes are scored when at the playhead
  const py = noteYCSS(note.midi);

  if (scoring.touched.has(note.start)) {
    const mult = streakMultiplier();
    const pts  = 100 * mult;
    scoring.streak++;
    scoring.points += pts;
    scoring.health  = Math.min(100, scoring.health + 4);
    scoring.panelPulse = 1;
    spawnParticles(px, py, mult);
    spawnFloat(px, py, pts, mult);
  } else {
    scoring.streak  = 0;
    scoring.health  = Math.max(0, scoring.health - 14);
    scoring.healthShake = 0.6;
  }
}

// ── Screen state ──────────────────────────────────────────────────────────────
let screen        = 'home';
let activeLevelIdx = 0;
let activeSongIdx  = 0;

// ── Audio ─────────────────────────────────────────────────────────────────────
const audio = { ctx: null, analyser: null, buffer: null };

// ── Pitch smoothing ───────────────────────────────────────────────────────────
// Require SMOOTH_FRAMES consecutive frames on same MIDI before reporting.
// Kills single-frame flickers and harmonic octave jumps from real instruments.
const SMOOTH_FRAMES = 3;
const smooth = { history: [], stable: null };

function smoothedPitch(raw) {
  smooth.history.push(raw ? raw.midi : null);
  if (smooth.history.length > SMOOTH_FRAMES) smooth.history.shift();
  if (smooth.history.length < SMOOTH_FRAMES) return null;
  const first = smooth.history[0];
  if (first === null) { smooth.stable = null; return null; }
  if (smooth.history.every(m => m === first)) {
    smooth.stable = raw; return smooth.stable;
  }
  return smooth.stable; // mid-transition: hold last stable
}


// ── Game state ────────────────────────────────────────────────────────────────
const game = {
  pitch:         null,
  songTime:      0,
  lastFrame:     performance.now(),
  heldCorrectFor: new Map(),
  completed:     new Set(),
  song:          null,
  songFinished:  false,
  prevNote:      null,   // for detecting note transitions
};

// ── Boot ──────────────────────────────────────────────────────────────────────
buildHomeScreen();
requestAnimationFrame(frame);

// ── Frame loop ────────────────────────────────────────────────────────────────
function frame(now) {
  const dt = Math.min(0.05, (now - game.lastFrame) / 1000);
  game.lastFrame = now;
  updatePitch();
  if (screen === 'playing') updateGame(dt);
  updateScoringPhysics(dt);
  renderCanvas();
  updateHUDDOM();
  updateDebug(dt);
  requestAnimationFrame(frame);
}

// ── Mic / pitch ───────────────────────────────────────────────────────────────
async function startMic() {
  if (audio.ctx) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  audio.ctx      = new AudioContext({ latencyHint: 'interactive' });
  audio.analyser = audio.ctx.createAnalyser();
  audio.analyser.fftSize = 4096;
  audio.analyser.smoothingTimeConstant = 0;
  audio.ctx.createMediaStreamSource(stream).connect(audio.analyser);
  audio.buffer   = new Float32Array(audio.analyser.fftSize);
}

function updatePitch() {
  if (!audio.analyser) { game.pitch = null; smooth.history = []; smooth.stable = null; return; }
  audio.analyser.getFloatTimeDomainData(audio.buffer);
  // Lower confidence gate for real instruments (0.45 vs 0.68 for synth)
  const raw = detectPitchYin(audio.buffer, audio.ctx.sampleRate, SOPRANO_RECORDER_BEGINNER);
  const candidate = (raw?.confidence >= 0.45) ? raw : null;
  game.pitch = smoothedPitch(candidate);
}

// ── Game logic ────────────────────────────────────────────────────────────────
function startSong(levelIdx, songIdx) {
  activeLevelIdx  = levelIdx;
  activeSongIdx   = songIdx;
  game.song       = LEVELS[levelIdx].songs[songIdx];
  game.songTime   = 0;
  game.heldCorrectFor = new Map();
  game.completed  = new Set();
  game.songFinished = false;
  game.prevNote   = null;
  resetScoring();
  screen = 'playing';
  showLane();
  buildHUD();
  schedulePanelUpdate();
}

function updateGame(dt) {
  if (game.songFinished) return;
  const notes   = game.song.notes;
  const current = currentNote(game.songTime, notes);

  // Track touches for scoring
  if (current && isHit(current)) scoring.touched.add(current.start);

  // Note transition → evaluate the note that just ended
  if (game.prevNote && game.prevNote !== current) evaluateNote(game.prevNote);
  game.prevNote = current;

  if (current) {
    const hit  = isHit(current);
    const key  = current.start;
    if (hit) game.heldCorrectFor.set(key, (game.heldCorrectFor.get(key) ?? 0) + dt);
    const held = game.heldCorrectFor.get(key) ?? 0;

    if (current.mode === 'timed') {
      game.songTime += dt;
    } else if (current.mode === 'hold') {
      if (hit) { game.songTime += dt; game.completed.add(key); }
    } else if (current.mode === 'confirm') {
      if (hit && held >= CONFIRM_SECONDS) { game.completed.add(key); game.songTime += dt; }
      else if (hit) { game.songTime += dt; }
    }
  } else {
    const last = game.song.notes[game.song.notes.length - 1];
    if (game.songTime >= (last ? last.start + last.duration + 1.5 : 0)) {
      if (last && !scoring.awardedNotes.has(last.start)) evaluateNote(last);
      finishSong(); return;
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
  hideLane();
  buildCompleteScreen();
}

// ── Scoring physics ───────────────────────────────────────────────────────────
function updateScoringPhysics(dt) {
  scoring.panelPulse  = Math.max(0, scoring.panelPulse  - dt * 3.5);
  scoring.healthShake = Math.max(0, scoring.healthShake - dt * 4);

  // Particles: burst outward, then attract toward score panel
  scoring.particles = scoring.particles.filter(p => p.life > 0);
  for (const p of scoring.particles) {
    p.life -= dt * 1.5;
    if (p.life > 0.45) {
      // burst phase
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vx *= 0.88;
      p.vy *= 0.88;
    } else {
      // fly-to-panel phase — accelerate toward panel centre
      const dx   = scoring.panelX - p.x;
      const dy   = scoring.panelY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f    = 380 / dist;
      p.vx += (dx / dist) * f * dt * 60;
      p.vy += (dy / dist) * f * dt * 60;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
    }
  }

  // Floating labels: drift up and fade
  scoring.floats = scoring.floats.filter(f => f.life > 0);
  for (const f of scoring.floats) {
    f.life -= dt * 1.4;
    f.y    += f.vy * dt;
  }
}

// ── HUD DOM updates (called every frame) ─────────────────────────────────────
function updateHUDDOM() {
  if (screen !== 'playing') return;
  const $ = id => document.querySelector(id);

  // Score points
  const ptsEl = $('#scorePoints');
  if (ptsEl) {
    ptsEl.textContent = scoring.points.toLocaleString();
    ptsEl.classList.toggle('pulse', scoring.panelPulse > 0.7);
  }

  // Streak label
  const stEl = $('#scoreStreak');
  if (stEl) {
    const mult = streakMultiplier();
    stEl.textContent = scoring.streak > 2
      ? (mult > 1 ? `🔥 ×${mult}` : `🎵 ${scoring.streak}`)
      : '';
  }

  // Health bar
  const hb = $('#healthBar');
  if (hb) {
    hb.style.width = `${scoring.health}%`;
    const shake = scoring.healthShake > 0
      ? `translateX(${(Math.sin(Date.now() / 28) * 4 * scoring.healthShake).toFixed(1)}px)` : '';
    hb.style.transform = shake;
    // colour shifts red→amber→green
    const g = scoring.health > 60 ? '#44ff88' : scoring.health > 30 ? '#ffaa22' : '#ff3344';
    hb.style.background = `linear-gradient(90deg, #ff3344 0%, ${g} 100%)`;
  }

  // Pitch / target / accuracy pills
  const cur = currentNote(game.songTime, game.song?.notes ?? []);
  const hit = isHit(cur);
  const dn  = $('#detectedNote');
  const tn  = $('#targetNote');
  const ac  = $('#accuracy');
  if (dn) dn.textContent = game.pitch
    ? `${game.pitch.note} ${game.pitch.cents > 0 ? '+' : ''}${game.pitch.cents.toFixed(0)}¢` : '—';
  if (tn) tn.textContent = cur ? cur.note : game.songFinished ? 'done' : '—';
  if (ac) ac.textContent = cur ? (hit ? 'hit ✓' : '…') : game.songFinished ? 'done' : '—';
}

// ── Screen builders ───────────────────────────────────────────────────────────
function setMain(html) { dynUI.innerHTML = html; }

function buildHomeScreen() {
  screen = 'home';
  setMain(`
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">moonlit music school</p>
        <h1>flute-hero</h1>
        <p class="lede">Follow the glowing note trail, play the recorder, and wake the little classroom stars.</p>
        <button id="btnStart"><img src="./art/ui/recorder-icon.svg" alt="" /> Let's Play</button>
      </div>
      <img class="mascot" src="./art/ui/raccoon-mascot.svg" alt="A cute raccoon recorder student" />
    </section>
  `);
  document.querySelector('#btnStart').addEventListener('click', async () => {
    await startMic(); buildLevelsScreen();
  });
}

function buildLevelsScreen() {
  screen = 'levels';
  const cards = LEVELS.map((level, li) => {
    const unlocked = isLevelUnlocked(li, LEVELS);
    const complete  = isLevelCompleted(li, level.songs.length);
    const songs = level.songs.map((song, si) => {
      const su   = isSongUnlocked(li, si, LEVELS);
      const done = isSongCompleted(li, si);
      return `<button class="song-btn ${done ? 'done' : ''}" data-level="${li}" data-song="${si}" ${su ? '' : 'disabled'}>
        <span class="song-badge">${done ? '⭐' : su ? '♪' : '🔒'}</span>
        <span class="song-title">${song.title}</span>
        <span class="song-tempo">${song.tempo} bpm</span>
      </button>`;
    }).join('');
    return `
      <div class="level-card ${unlocked ? '' : 'locked'}">
        <div class="level-header">
          <span class="level-num">Level ${li + 1}</span>
          <span class="level-name">${level.name}</span>
          ${complete  ? '<span class="level-badge">✓ Complete</span>' : ''}
          ${!unlocked ? '<span class="level-badge locked-badge">🔒 Locked</span>' : ''}
        </div>
        <p class="level-desc">${level.description}</p>
        <div class="song-list">${songs}</div>
      </div>`;
  }).join('');
  setMain(`
    <section class="levels-screen">
      <div class="levels-header"><h2>Choose a Song</h2><p class="muted">Complete songs in order to unlock the next</p></div>
      ${cards}
    </section>
  `);
  dynUI.querySelectorAll('.song-btn:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => startSong(+btn.dataset.level, +btn.dataset.song)));
}

function buildHUD() {
  document.querySelector('.play-hud')?.remove();
  const hud = document.createElement('div');
  hud.className = 'play-hud';
  hud.innerHTML = `
    <button class="hud-back" id="hudBack">← Back</button>
    <span class="hud-title">${LEVELS[activeLevelIdx].name} · ${game.song.title}</span>
    <div class="hud-meters">
      <div class="hud-pill"><span class="label">Detected</span><strong id="detectedNote">—</strong></div>
      <div class="hud-pill"><span class="label">Target</span>  <strong id="targetNote">—</strong></div>
      <div class="hud-pill"><span class="label">Status</span>  <strong id="accuracy">—</strong></div>
    </div>
    <div class="score-panel" id="scorePanel">
      <div class="score-top-row">
        <span class="score-streak-lbl" id="scoreStreak"></span>
        <span class="score-pts" id="scorePoints">0</span>
      </div>
      <div class="health-bar-wrap"><div class="health-bar" id="healthBar"></div></div>
    </div>
    <button class="hud-fs" id="hudFS" title="Toggle fullscreen">⛶</button>
  `;
  document.body.appendChild(hud);
  document.querySelector('#hudBack').addEventListener('click', () => {
    screen = 'levels'; hideLane(); buildLevelsScreen();
  });
  document.querySelector('#hudFS').addEventListener('click', () => {
    if (isFS()) exitFS(); else enterFS();
  });
}

function buildCompleteScreen() {
  const next        = activeSongIdx + 1;
  const levelDone   = isLevelCompleted(activeLevelIdx, LEVELS[activeLevelIdx].songs.length);
  const nextLvl     = activeLevelIdx + 1;
  const hasNext     = next < LEVELS[activeLevelIdx].songs.length;
  const hasNextLvl  = nextLvl < LEVELS.length;
  const grade       = scoring.health >= 80 ? '⭐⭐⭐' : scoring.health >= 50 ? '⭐⭐' : '⭐';
  const nextBtn     = hasNext
    ? `<button id="btnNext">Next song →</button>`
    : (levelDone && hasNextLvl ? `<button id="btnNextLevel">Start Level ${nextLvl + 1} →</button>` : '');
  setMain(`
    <section class="complete-screen">
      <img class="mascot mascot-celebrate" src="./art/ui/raccoon-mascot.svg" alt="" />
      <h2>${grade} Song Complete!</h2>
      <p class="complete-song">${game.song.title}</p>
      <p class="complete-score">${scoring.points.toLocaleString()} pts</p>
      ${levelDone && hasNextLvl ? `<p class="level-unlocked">🔓 Level ${nextLvl + 1} — ${LEVELS[nextLvl].name} unlocked!</p>` : ''}
      <div class="complete-actions">
        <button id="btnRetry">↺ Play again</button>
        ${nextBtn}
        <button id="btnMenu">Song list</button>
      </div>
    </section>
  `);
  document.querySelector('#btnRetry').addEventListener('click', () => startSong(activeLevelIdx, activeSongIdx));
  document.querySelector('#btnMenu').addEventListener('click', buildLevelsScreen);
  document.querySelector('#btnNext')?.addEventListener('click', () => startSong(activeLevelIdx, next));
  document.querySelector('#btnNextLevel')?.addEventListener('click', () => startSong(nextLvl, 0));
}

// ── Canvas render ─────────────────────────────────────────────────────────────
//
// Sheet music aesthetic:
//   - Parchment/cream paper background
//   - Real 5-line G staff centred in the canvas
//   - Notes positioned by standard treble-clef staff position (E4 = bottom line)
//   - Note heads: filled oval (quarter/eighth), open oval (half), open large (whole)
//   - Stems, flags (eighth), beams (consecutive eighths), ledger lines
//   - Hit state: gold fill + burn particles still fly
//
// Staff layout (treble clef, our range C5–D6):
//   Bottom line (line 1) = E4 = midi 64
//   Each staff slot (half-step) = lineSpacing/2 px
//   Lines are at midi 64,67,71,74,77 (E4,G4,B4,D5,F5)
//   Our notes C4(60)–D5(74) sit on/around lines 1–4, with ledger lines below for C4/D4

// Staff geometry — computed once per frame from canvas size
function staffGeometry(W, H) {
  const lineSpacing = Math.min(H * 0.085, 38); // space between staff lines
  const staffHeight = lineSpacing * 4;          // 5 lines = 4 gaps
  const staffCentreY = H * 0.50;               // C4-D5 sits on the staff itself, centre it
  const staffTop    = staffCentreY - staffHeight / 2;
  const staffBottom = staffCentreY + staffHeight / 2;

  // midi → Y: E4 (midi 64) = staffBottom, each half-step = lineSpacing/2 up
  // slot = (midi - 64) in chromatic half-steps; but staff positions are diatonic
  // We map by diatonic step: C D E F G A B = 0 1 2 3 4 5 6 within octave
  // Diatonic steps above E4 baseline:
  //   E4=0, F4=1, G4=2, A4=3, B4=4, C5=5, D5=6, E5=7, F5=8, G5=9, A5=10, B5=11, C6=12, D6=13

  const DIATONIC_STEP = lineSpacing / 2; // half a line-space per diatonic step

  // Chromatic midi → diatonic steps above E4
  function midiToDiatonicSteps(midi) {
    // Maps chromatic MIDI note to diatonic steps above E4 (bottom staff line).
    // C/C#/D/D# (pc < 4) cross the MIDI octave boundary but are diatonically
    // still in the group starting from the E below them, so we shift the
    // MIDI octave back by 1 before computing the offset.
    const STEPS_FROM_E = [5,5,6,6, 0,1,1,2,2,3,3,4]; // pc: C=5,C#=5,D=6,D#=6, E=0,F=1,…,B=4
    const pc         = midi % 12;
    const midiOctave = Math.floor(midi / 12) - 1;
    const eOctave    = pc < 4 ? midiOctave - 1 : midiOctave; // adjust for MIDI boundary
    return (eOctave - 4) * 7 + STEPS_FROM_E[pc];
  }

  function noteY(midi) {
    const steps = midiToDiatonicSteps(midi);
    return staffBottom - steps * DIATONIC_STEP;
  }

  // Staff line Y positions (E4,G4,B4,D5,F5)
  const lineYs = [64, 67, 71, 74, 77].map(noteY);

  return { lineSpacing, staffTop, staffBottom, staffCentreY, noteY, lineYs, DIATONIC_STEP, midiToDiatonicSteps };
}

function renderCanvas() {
  const W = laneShell.clientWidth;
  const H = laneShell.clientHeight;
  ctx.clearRect(0, 0, W, H);

  // ── Parchment background ──────────────────────────────────────────────────
  drawParchment(W, H);

  if (screen !== 'playing' && screen !== 'complete') return;

  const notes     = game.song.notes;
  const beat      = 60 / game.song.tempo;
  const SPEED     = W * 0.14;
  const playheadX = W * 0.22;
  const t         = performance.now() / 1000;

  const sg = staffGeometry(W, H);
  const { lineSpacing, staffBottom, noteY, lineYs } = sg;
  const headW = lineSpacing * 0.62; // note head semi-axis horizontal
  const headH = lineSpacing * 0.42; // note head semi-axis vertical

  // ── Staff lines ───────────────────────────────────────────────────────────
  drawStaff(W, lineYs);

  // ── Clef watermark just left of playhead ─────────────────────────────────
  drawTrebleClef(ctx, playheadX - lineSpacing * 1.8, lineYs, lineSpacing);

  // ── Notes ─────────────────────────────────────────────────────────────────
  const cur = currentNote(game.songTime, notes);

  // Group adjacent eighth notes for beaming
  const beamGroups = computeBeamGroups(notes, beat);

  for (const note of notes) {
    const noteX    = playheadX + (note.start - game.songTime) * SPEED;
    const noteEndX = playheadX + (note.start + note.duration - game.songTime) * SPEED;
    if (noteEndX < -80 || noteX > W + 80) continue;

    const y        = noteY(note.midi);
    const done     = game.completed.has(note.start) || scoring.awardedNotes.has(note.start);
    const isActive = cur === note;
    const hit      = isActive && isHit(note);
    const holdSecs = game.heldCorrectFor.get(note.start) ?? 0;

    const beatsLen   = note.duration / beat;
    const noteType   = noteTypeFromBeats(beatsLen);
    const stemUp     = sg.midiToDiatonicSteps(note.midi) < 5; // below middle B4 → stem up
    const beamGroup  = beamGroups.get(note.start);

    // Burn effect behind note
    if (hit) {
      const burnIntensity = Math.min(1, 0.3 + holdSecs * 1.6);
      drawBurn(ctx, noteX, y, t, burnIntensity);
    }

    // Ledger lines
    drawLedgerLines(ctx, noteX, note.midi, noteY, lineYs, lineSpacing, headW, hit, done);

    // Note glyph
    drawSheetNote(ctx, noteX, y, noteType, stemUp, hit, done, headW, headH, lineSpacing, beamGroup, notes, noteY, SPEED, game.songTime, playheadX, beat, t);
  }

  // ── Playhead ──────────────────────────────────────────────────────────────
  drawPlayhead(ctx, playheadX, H, lineYs, t);

  // ── Live pitch cursor ─────────────────────────────────────────────────────
  if (game.pitch) drawPitchCursor(ctx, game.pitch, playheadX, H, noteY, lineYs, lineSpacing, headW, headH, W);

  // ── Particles & floats ────────────────────────────────────────────────────
  drawParticles(ctx);
  drawFloats(ctx, W);
}

// ── Parchment background ───────────────────────────────────────────────────────
function drawParchment(W, H) {
  // Warm cream base
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0,   '#f8f2e2');
  bg.addColorStop(0.5, '#f4ecd4');
  bg.addColorStop(1,   '#efe5c4');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle vignette at edges
  const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.9);
  vig.addColorStop(0, 'rgba(120,90,40,0)');
  vig.addColorStop(1, 'rgba(100,70,20,0.18)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

// ── Staff 5 lines ──────────────────────────────────────────────────────────────
function drawStaff(W, lineYs) {
  ctx.save();
  ctx.strokeStyle = 'rgba(60,40,20,0.55)';
  ctx.lineWidth   = 1.2;
  for (const y of lineYs) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}

// ── Ledger lines ──────────────────────────────────────────────────────────────
function drawLedgerLines(ctx, x, midi, noteY, lineYs, lineSpacing, headW, hit, done) {
  // Staff lines at E4(64),G4(67),B4(71),D5(74),F5(77).
  // Our range C4(60)–D5(74):
  //   C4(60) — below staff, needs ledger line at C4
  //   D4(62) — space below first ledger (no line needed, just space)
  //   E4(64) — bottom staff line, no ledger
  //   D5(74) — top used line (line 4)
  // Ledger lines needed: C4(60) is ON a ledger line below the staff.
  // The C4 ledger sits one step below E4 line.
  const ledgerMidis = [60]; // C4 — middle C ledger line below staff
  const lw = headW * 2.6;
  ctx.save();
  ctx.strokeStyle = hit  ? 'rgba(180,120,0,0.8)'
                  : done ? 'rgba(60,40,20,0.25)'
                  :        'rgba(60,40,20,0.55)';
  ctx.lineWidth = 1.2;
  for (const lm of ledgerMidis) {
    // Draw this ledger line if the note is at or below this midi
    if (midi <= lm + 1) {
      const ly = noteY(lm);
      ctx.beginPath(); ctx.moveTo(x - lw/2, ly); ctx.lineTo(x + lw/2, ly); ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Note type from beat length ─────────────────────────────────────────────────
function noteTypeFromBeats(beats) {
  if (beats >= 3.5)  return 'whole';
  if (beats >= 1.75) return 'half';
  if (beats >= 0.85) return 'quarter';
  return 'eighth';
}

// ── Beam groups: which consecutive eighth notes should be beamed ──────────────
function computeBeamGroups(notes, beat) {
  // Returns a Map: note.start → { first: bool, last: bool, partnerX-offset (not yet known) }
  const groups = new Map();
  const eighths = notes.filter(n => noteTypeFromBeats(n.duration / beat) === 'eighth');
  let i = 0;
  while (i < eighths.length) {
    // Beam runs of 2 consecutive eighth notes
    const a = eighths[i];
    const b = eighths[i + 1];
    if (b && Math.abs((a.start + a.duration) - b.start) < 0.06) {
      groups.set(a.start, { role: 'first',  partner: b.start });
      groups.set(b.start, { role: 'second', partner: a.start });
      i += 2;
    } else {
      groups.set(a.start, { role: 'solo' });
      i++;
    }
  }
  return groups;
}

// ── Draw a single notated note ────────────────────────────────────────────────
function drawSheetNote(ctx, x, y, noteType, stemUp, hit, done, headW, headH, lineSpacing, beamGroup, notes, noteY, SPEED, songTime, playheadX, beat, t) {

  const stemLen   = lineSpacing * 3.2;
  const stemDir   = stemUp ? -1 : 1;
  const stemX     = stemUp ? x + headW * 0.82 : x - headW * 0.82;
  const stemTipY  = y + stemDir * stemLen;

  // colours
  const inkColor   = done ? 'rgba(60,40,20,0.28)'
                   : hit  ? '#7a4a00'
                   :         'rgba(40,25,10,0.88)';
  const fillColor  = hit  ? '#d4900a'
                   : done ? 'rgba(180,150,100,0.3)'
                   :        inkColor;
  const openFill   = hit  ? 'rgba(255,210,80,0.18)' : 'rgba(248,242,226,0.0)'; // transparent centre for half/whole

  ctx.save();

  // ── Note head ──────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.ellipse(x, y, headW, headH, -0.22, 0, Math.PI * 2);

  if (noteType === 'whole' || noteType === 'half') {
    // Open note head
    ctx.strokeStyle = fillColor;
    ctx.lineWidth   = headH * 0.55;
    ctx.stroke();
    ctx.fillStyle   = hit ? 'rgba(255,210,80,0.25)' : 'rgba(248,242,226,1)';
    ctx.fill();
  } else {
    // Filled note head
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Hit glow ring
  if (hit) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,160,0,0.9)';
    ctx.shadowBlur  = 18;
    ctx.strokeStyle = 'rgba(255,200,60,0.8)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, headW + 4, headH + 4, -0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Stem (not for whole notes) ─────────────────────────────────────────────
  if (noteType !== 'whole') {
    ctx.strokeStyle = fillColor;
    ctx.lineWidth   = Math.max(1.2, headH * 0.45);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(stemX, y);
    ctx.lineTo(stemX, stemTipY);
    ctx.stroke();
  }

  // ── Flag (solo eighth note — single flag on stem tip) ─────────────────────
  if (noteType === 'eighth' && (!beamGroup || beamGroup.role === 'solo')) {
    drawFlag(ctx, stemX, stemTipY, stemUp, fillColor, lineSpacing);
  }

  // ── Beam (eighth note pair) ────────────────────────────────────────────────
  // Only draw beam from the FIRST note of the pair, to the partner's stem tip
  if (noteType === 'eighth' && beamGroup && beamGroup.role === 'first') {
    const partnerNote = notes.find(n => n.start === beamGroup.partner);
    if (partnerNote) {
      const px2   = playheadX + (partnerNote.start - songTime) * SPEED;
      const py2   = noteY(partnerNote.midi);
      const sx2   = stemUp ? px2 + headW * 0.82 : px2 - headW * 0.82;
      const sty2  = py2 + stemDir * (lineSpacing * 3.2);
      // Beam: thick horizontal bar connecting the two stem tips
      const beamH = lineSpacing * 0.38;
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      if (stemUp) {
        ctx.moveTo(stemX,  stemTipY - beamH/2);
        ctx.lineTo(sx2,    sty2     - beamH/2);
        ctx.lineTo(sx2,    sty2     + beamH/2);
        ctx.lineTo(stemX,  stemTipY + beamH/2);
      } else {
        ctx.moveTo(stemX,  stemTipY - beamH/2);
        ctx.lineTo(sx2,    sty2     - beamH/2);
        ctx.lineTo(sx2,    sty2     + beamH/2);
        ctx.lineTo(stemX,  stemTipY + beamH/2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

// ── Eighth note flag ───────────────────────────────────────────────────────────
function drawFlag(ctx, sx, sy, stemUp, color, lineSpacing) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(1.2, lineSpacing * 0.12);
  ctx.lineCap     = 'round';
  const dir = stemUp ? 1 : -1;
  const cp1x = sx + lineSpacing * 0.7 * dir;
  const cp1y = sy + lineSpacing * 0.5;
  const cp2x = sx + lineSpacing * 0.65 * dir;
  const cp2y = sy + lineSpacing * 1.1;
  const ex   = sx + lineSpacing * 0.15 * dir;
  const ey   = sy + lineSpacing * (stemUp ? 1.4 : -0.5);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
  ctx.stroke();
  ctx.restore();
}

// ── Treble clef watermark ─────────────────────────────────────────────────────
function drawTrebleClef(ctx, x, lineYs, lineSpacing) {
  // Minimal symbolic treble clef drawn with bezier curves
  // Based on the G-clef curling around the G4 line (lineYs[1])
  const g4y  = lineYs[1]; // G4 line
  const e4y  = lineYs[0]; // E4 line (bottom)
  const f5y  = lineYs[4]; // F5 line (top)
  const size = lineSpacing * 0.72;

  ctx.save();
  ctx.strokeStyle = 'rgba(60,40,20,0.30)';
  ctx.fillStyle   = 'rgba(60,40,20,0.30)';
  ctx.lineWidth   = lineSpacing * 0.13;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  // Vertical spine
  ctx.beginPath();
  ctx.moveTo(x, f5y - lineSpacing * 1.2);
  ctx.bezierCurveTo(
    x + size * 0.1, f5y - lineSpacing * 0.5,
    x + size * 0.1, e4y + lineSpacing * 0.3,
    x - size * 0.1, e4y + lineSpacing * 0.7
  );
  ctx.stroke();

  // Curl around G4
  ctx.beginPath();
  ctx.arc(x + size * 0.04, g4y, size * 0.42, -Math.PI * 0.1, Math.PI * 1.85);
  ctx.stroke();

  ctx.restore();
}

// ── Playhead — clean vertical red line like a conductor mark ─────────────────
function drawPlayhead(ctx, x, H, lineYs, t) {
  const staffTop    = lineYs[4] - 8;
  const staffBottom = lineYs[0] + 8;

  // Faint full-height guide
  ctx.save();
  ctx.strokeStyle = 'rgba(200,80,40,0.10)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  ctx.setLineDash([]);

  // Bold red line over the staff
  ctx.shadowColor = 'rgba(220,60,20,0.55)';
  ctx.shadowBlur  = 8;
  ctx.strokeStyle = 'rgba(210,50,20,0.82)';
  ctx.lineWidth   = 2.2;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x, staffTop); ctx.lineTo(x, staffBottom); ctx.stroke();

  // Triangle pointer at top
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(210,50,20,0.82)';
  ctx.beginPath();
  ctx.moveTo(x,     staffTop - 2);
  ctx.lineTo(x - 6, staffTop - 12);
  ctx.lineTo(x + 6, staffTop - 12);
  ctx.closePath(); ctx.fill();

  ctx.restore();
}

// ── Live pitch cursor ─────────────────────────────────────────────────────────
// Ghost note head following the live detected pitch
function drawPitchCursor(ctx, pitch, playheadX, H, noteY, lineYs, lineSpacing, headW, headH, W) {
  const y     = noteY(pitch.midi);
  const close = Math.abs(pitch.cents) <= 35;

  if (y < -40 || y > H + 40) return;

  // Ghost note head
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.shadowColor = close ? 'rgba(30,160,80,0.8)' : 'rgba(180,100,0,0.7)';
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = close ? 'rgba(40,200,100,0.82)' : 'rgba(200,130,20,0.72)';
  ctx.beginPath();
  ctx.ellipse(playheadX, y, headW * 1.1, headH * 1.1, -0.22, 0, Math.PI * 2);
  ctx.fill();

  // Cents deviation label
  ctx.globalAlpha = 0.88;
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = close ? '#1a6030' : '#7a4000';
  ctx.font        = `700 ${Math.max(11, Math.round(W * 0.012))}px Inter, system-ui, sans-serif`;
  ctx.textAlign   = 'left';
  ctx.fillText(
    `${pitch.note} ${pitch.cents > 0 ? '+' : ''}${pitch.cents.toFixed(0)}¢`,
    playheadX + headW * 1.4, y + 4
  );
  ctx.restore();
}

// ── Burn effect ───────────────────────────────────────────────────────────────
function drawBurn(ctx, x, y, t, intensity) {
  const n = 7;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const base    = (i / n) * Math.PI * 2;
    const angle   = base + t * 2.8 + Math.sin(t * 5.1 + i * 1.9) * 0.4;
    const flicker = 0.6 + 0.4 * Math.sin(t * 9.3 + i * 2.3);
    const len     = (18 + 14 * flicker) * intensity;
    const ex      = x + Math.cos(angle) * len;
    const ey      = y + Math.sin(angle) * len;
    const g = ctx.createLinearGradient(x, y, ex, ey);
    g.addColorStop(0,    `rgba(255,255,180,${0.9 * intensity})`);
    g.addColorStop(0.38, `rgba(255,140,20,${0.75 * intensity})`);
    g.addColorStop(1,    'rgba(255,40,0,0)');
    const cx1 = x + Math.cos(angle + 0.55) * len * 0.48;
    const cy1 = y + Math.sin(angle + 0.55) * len * 0.48;
    ctx.strokeStyle = g;
    ctx.lineWidth   = (2.5 + 2 * flicker) * intensity;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(255,110,0,.7)';
    ctx.shadowBlur  = 12 * intensity;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.quadraticCurveTo(cx1, cy1, ex, ey); ctx.stroke();
  }
  ctx.restore();
}

// ── Particles ─────────────────────────────────────────────────────────────────
function drawParticles(ctx) {
  for (const p of scoring.particles) {
    const alpha = Math.min(1, p.life * 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = p.color; ctx.shadowBlur = 8;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * Math.max(0.3, p.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Floating score labels ─────────────────────────────────────────────────────
function drawFloats(ctx, W) {
  for (const f of scoring.floats) {
    const alpha = Math.min(1, f.life * 2.2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign   = 'center';
    ctx.font        = `900 ${Math.round(W * 0.019)}px Inter, system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(140,80,0,0.9)';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#c47a00';
    ctx.fillText(f.label, f.x, f.y);
    ctx.restore();
  }
}

// ── Debug panel ───────────────────────────────────────────────────────────────
function updateDebug(dt) {
  if (debugFrameTime)    debugFrameTime.textContent    = `${(dt * 1000).toFixed(1)} ms`;
  if (!audio.ctx) {
    if (debugAudioLatency) debugAudioLatency.textContent = 'mic off';
    if (debugFrequency)    debugFrequency.textContent    = '—';
    if (debugConfidence)   debugConfidence.textContent   = '—';
    return;
  }
  const ms = ((audio.ctx.baseLatency ?? 0) + (audio.ctx.outputLatency ?? 0)) * 1000;
  if (debugAudioLatency) debugAudioLatency.textContent = ms > 0 ? `${ms.toFixed(1)} ms` : 'unknown';
  if (debugFrequency)    debugFrequency.textContent    = game.pitch ? `${game.pitch.frequency.toFixed(1)} Hz` : '—';
  if (debugConfidence)   debugConfidence.textContent   = game.pitch
    ? `${Math.round(game.pitch.confidence * 100)}% rms:${audio.buffer ? rms(audio.buffer).toFixed(3) : '—'}`
    : `— rms:${audio.buffer ? rms(audio.buffer).toFixed(3) : '—'}`;
}
