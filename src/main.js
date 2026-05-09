import { detectPitchYin, SOPRANO_RECORDER_BEGINNER, toleranceForMidi } from './pitch.js';
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
  const MIDI_MIN = 72, MIDI_MAX = 86;
  const H          = laneShell.clientHeight;
  const laneTop    = H * 0.10;
  const laneBottom = H * 0.88;
  return laneBottom - ((midi - MIDI_MIN) / (MIDI_MAX - MIDI_MIN)) * (laneBottom - laneTop);
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
  if (!audio.analyser) { game.pitch = null; return; }
  audio.analyser.getFloatTimeDomainData(audio.buffer);
  const p = detectPitchYin(audio.buffer, audio.ctx.sampleRate, SOPRANO_RECORDER_BEGINNER);
  game.pitch = (p?.confidence >= 0.68) ? p : null;
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
function renderCanvas() {
  const W = laneShell.clientWidth;
  const H = laneShell.clientHeight;
  ctx.clearRect(0, 0, W, H);
  drawStars(W, H);
  if (screen !== 'playing' && screen !== 'complete') return;

  const notes      = game.song.notes;
  const SPEED      = W * 0.14;
  const playheadX  = W * 0.22;
  const MIDI_MIN   = 72, MIDI_MAX = 86;
  const MIDI_RANGE = MIDI_MAX - MIDI_MIN;
  const laneTop    = H * 0.10;
  const laneBottom = H * 0.88;
  const laneH      = laneBottom - laneTop;
  const t          = performance.now() / 1000;

  function noteY(midi) {
    return laneBottom - ((midi - MIDI_MIN) / MIDI_RANGE) * laneH;
  }

  // Subtle lane lines
  ctx.save();
  ctx.strokeStyle = 'rgba(189,140,255,.07)';
  ctx.lineWidth   = 1;
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const y = noteY(midi);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();

  // Notes
  const cur = currentNote(game.songTime, notes);
  for (const note of notes) {
    const noteX    = playheadX + (note.start - game.songTime) * SPEED;
    const noteEndX = playheadX + (note.start + note.duration - game.songTime) * SPEED;
    if (noteEndX < -60 || noteX > W + 60) continue;

    const y         = noteY(note.midi);
    const done      = game.completed.has(note.start) || scoring.awardedNotes.has(note.start);
    const isActive  = cur === note;
    const hit       = isActive && isHit(note);
    const holdSecs  = game.heldCorrectFor.get(note.start) ?? 0;

    // Bar
    const barX = Math.max(0, noteX);
    const barW = noteEndX - barX;
    if (barW > 2) {
      ctx.save();
      ctx.fillStyle = done
        ? 'rgba(102,86,142,.38)'
        : hit ? 'rgba(133,255,208,.22)' : 'rgba(189,140,255,.14)';
      roundRect(ctx, barX, y - 9, barW, 18, 9);
      ctx.fill();
      // Burning bar highlight while hitting
      if (hit) {
        const gBar = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        gBar.addColorStop(0, 'rgba(255,180,30,.5)');
        gBar.addColorStop(1, 'rgba(133,255,208,.1)');
        ctx.fillStyle = gBar;
        ctx.fill();
      }
      ctx.restore();
    }

    // Burn effect under node
    if (hit) {
      const burnIntensity = Math.min(1, 0.35 + holdSecs * 1.8);
      drawBurn(ctx, noteX, y, t, burnIntensity);
    }

    // Node
    if (noteX > -30 && noteX < W + 30) {
      drawNoteNode(ctx, noteX, y, hit, done, note.note, W, t, holdSecs);
    }
  }

  drawPlayhead(ctx, playheadX, H, t);

  if (game.pitch) drawPitchIndicator(ctx, game.pitch, playheadX, H, noteY, W);

  // Particles & floats
  drawParticles(ctx);
  drawFloats(ctx, W);
}

// ── Burn effect ───────────────────────────────────────────────────────────────
function drawBurn(ctx, x, y, t, intensity) {
  const n = 7;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const base    = (i / n) * Math.PI * 2;
    const angle   = base + t * 2.8 + Math.sin(t * 5.1 + i * 1.9) * 0.4;
    const flicker = 0.6 + 0.4 * Math.sin(t * 9.3 + i * 2.3);
    const len     = (20 + 16 * flicker) * intensity;
    const ex      = x + Math.cos(angle) * len;
    const ey      = y + Math.sin(angle) * len;

    const g = ctx.createLinearGradient(x, y, ex, ey);
    g.addColorStop(0,    `rgba(255,255,180,${0.95 * intensity})`);
    g.addColorStop(0.38, `rgba(255,140,20,${0.80 * intensity})`);
    g.addColorStop(1,    'rgba(255,40,0,0)');

    const cx1 = x + Math.cos(angle + 0.55) * len * 0.48;
    const cy1 = y + Math.sin(angle + 0.55) * len * 0.48;

    ctx.strokeStyle = g;
    ctx.lineWidth   = (3 + 2 * flicker) * intensity;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(255,110,0,.75)';
    ctx.shadowBlur  = 14 * intensity;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx1, cy1, ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Note node ─────────────────────────────────────────────────────────────────
function drawNoteNode(ctx, x, y, hit, done, label, W, t, holdSecs) {
  const r = hit ? 13 : 10;

  // Extra pulse ring while burning
  if (hit) {
    const pulseR = r + 6 + 4 * Math.sin(t * 9);
    ctx.save();
    ctx.strokeStyle = `rgba(255,200,50,${0.3 + 0.2 * Math.sin(t * 7)})`;
    ctx.lineWidth   = 2;
    ctx.shadowColor = 'rgba(255,150,0,.6)';
    ctx.shadowBlur  = 12;
    ctx.beginPath(); ctx.arc(x, y, pulseR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  const g = ctx.createRadialGradient(x - 2, y - 3, 2, x, y, r);
  if (hit) {
    g.addColorStop(0,   '#ffffff');
    g.addColorStop(0.3, '#85ffd0');
    g.addColorStop(0.8, '#00c8a0');
    g.addColorStop(1,   '#009070');
  } else if (done) {
    g.addColorStop(0, '#c8b4ff');
    g.addColorStop(1, '#66568e');
  } else {
    g.addColorStop(0, '#fff8ff');
    g.addColorStop(0.5, '#fff0a7');
    g.addColorStop(1,   '#bd8cff');
  }

  ctx.save();
  ctx.shadowColor = hit ? 'rgba(116,247,255,.95)' : done ? 'rgba(189,140,255,.3)' : 'rgba(255,215,106,.45)';
  ctx.shadowBlur  = hit ? 22 : 8;
  ctx.fillStyle   = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = hit ? 'rgba(200,255,240,.9)' : 'rgba(255,248,255,.65)';
  ctx.lineWidth   = 2;
  ctx.stroke();
  ctx.fillStyle   = done ? 'rgba(189,170,255,.5)' : hit ? 'rgba(0,40,30,.9)' : 'rgba(255,248,255,.9)';
  ctx.font        = `700 ${Math.round(W * 0.012)}px Inter, system-ui, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.fillText(label, x, y - r - 4);
  ctx.restore();
}

// ── Pitch indicator ───────────────────────────────────────────────────────────
function drawPitchIndicator(ctx, pitch, playheadX, H, noteY, W) {
  const y     = Math.max(18, Math.min(H - 18, noteY(pitch.midi)));
  const close = Math.abs(pitch.cents) <= 35;
  ctx.save();
  ctx.shadowColor = close ? 'rgba(116,247,255,.9)' : 'rgba(255,215,106,.5)';
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = close ? '#85ffd0' : '#ffd76a';
  ctx.strokeStyle = '#fff8ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(playheadX, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur  = 0;
  const lx = playheadX + 22;
  ctx.fillStyle = 'rgba(17,10,39,.86)';
  roundRect(ctx, lx, y - 18, 86, 34, 17); ctx.fill();
  ctx.strokeStyle = close ? 'rgba(133,255,208,.72)' : 'rgba(255,215,106,.65)'; ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff8ff';
  ctx.font = `800 ${Math.round(W * 0.014)}px Inter, system-ui, sans-serif`;
  ctx.fillText(pitch.note, lx + 10, y - 4);
  ctx.fillStyle = close ? '#85ffd0' : '#ffd76a';
  ctx.font = `700 ${Math.round(W * 0.011)}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${pitch.cents > 0 ? '+' : ''}${pitch.cents.toFixed(0)}¢`, lx + 10, y + 10);
  ctx.restore();
}

// ── Particles ─────────────────────────────────────────────────────────────────
function drawParticles(ctx) {
  for (const p of scoring.particles) {
    const alpha = Math.min(1, p.life * 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 10;
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
    ctx.shadowColor = 'rgba(255,215,106,.9)';
    ctx.shadowBlur  = 16;
    ctx.fillStyle   = '#ffd76a';
    ctx.fillText(f.label, f.x, f.y);
    ctx.restore();
  }
}

// ── Playhead ──────────────────────────────────────────────────────────────────
function drawPlayhead(ctx, x, H, t) {
  ctx.save();
  ctx.shadowColor = 'rgba(116,247,255,.9)'; ctx.shadowBlur = 20;
  ctx.strokeStyle = '#a7f8ff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, H - 12); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff0a7'; ctx.strokeStyle = '#fff8ff'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x - 2, 24, 12, Math.PI * 0.42, Math.PI * 1.62, false);
  ctx.arc(x + 5, 24, 9,  Math.PI * 1.68, Math.PI * 0.35, true);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  drawSparkle(ctx, x + 18, 42, 7);
  ctx.restore();
}

// ── Sparkle / stars ───────────────────────────────────────────────────────────
function drawSparkle(ctx, x, y, size) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#fff0a7'; ctx.shadowColor = 'rgba(255,240,167,.8)'; ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? size : size * 0.38;
    i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
            : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawStars(W, H) {
  const stars = [[104,38,1.4],[184,246,1],[314,72,1.2],[472,282,1.1],[612,46,1.5],[744,238,1],[872,88,1.3],[924,292,1]];
  ctx.fillStyle = 'rgba(255,240,167,.65)';
  for (const [sx, sy, r] of stars) {
    ctx.beginPath(); ctx.arc(sx % W, sy % H, r, 0, Math.PI * 2); ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
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
  if (debugConfidence)   debugConfidence.textContent   = game.pitch ? `${Math.round(game.pitch.confidence * 100)}%` : '—';
}
