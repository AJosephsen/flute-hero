import { detectPitchYin, SOPRANO_RECORDER_BEGINNER, toleranceForMidi } from './pitch.js';
import { LEVELS, CONFIRM_SECONDS } from './songs.js';
import { isSongUnlocked, isLevelUnlocked, isLevelCompleted, isSongCompleted, markSongComplete } from './progress.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas     = document.querySelector('#noteLane');
const ctx        = canvas.getContext('2d');
const laneShell  = document.querySelector('#laneShell');
const dynUI      = document.querySelector('.dynamic-ui');
const debugFrameTime   = document.querySelector('#debugFrameTime');
const debugAudioLatency= document.querySelector('#debugAudioLatency');
const debugFrequency   = document.querySelector('#debugFrequency');
const debugConfidence  = document.querySelector('#debugConfidence');

// ── Canvas resize (fills laneShell at device pixel ratio) ────────────────────
function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const w = laneShell.clientWidth;
  const h = laneShell.clientHeight;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(() => {
  if (laneShell.classList.contains('active')) resizeCanvas();
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
  // remove play HUD
  document.querySelector('.play-hud')?.remove();
}

// ── Screen state ──────────────────────────────────────────────────────────────
let screen = 'home';
let activeLevelIdx = 0;
let activeSongIdx  = 0;

// ── Audio state ───────────────────────────────────────────────────────────────
const audio = { ctx: null, analyser: null, buffer: null };

// ── Game state ────────────────────────────────────────────────────────────────
const game = {
  pitch: null,
  songTime: 0,
  lastFrame: performance.now(),
  heldCorrectFor: new Map(),
  completed: new Set(),
  song: null,
  songFinished: false,
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
  renderCanvas();
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
  activeLevelIdx = levelIdx;
  activeSongIdx  = songIdx;
  game.song          = LEVELS[levelIdx].songs[songIdx];
  game.songTime      = 0;
  game.heldCorrectFor = new Map();
  game.completed     = new Set();
  game.songFinished  = false;
  screen = 'playing';
  showLane();
  buildHUD();
}

function updateGame(dt) {
  if (game.songFinished) return;
  const notes  = game.song.notes;
  const current = currentNote(game.songTime, notes);

  if (current) {
    const hit = isHit(current);
    const key = current.start;
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
        <button id="btnStart">
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
  const cards = LEVELS.map((level, li) => {
    const unlocked = isLevelUnlocked(li, LEVELS);
    const complete  = isLevelCompleted(li, level.songs.length);
    const songs = level.songs.map((song, si) => {
      const su   = isSongUnlocked(li, si, LEVELS);
      const done = isSongCompleted(li, si);
      const badge = done ? '⭐' : su ? '♪' : '🔒';
      return `<button class="song-btn ${done ? 'done' : ''}"
        data-level="${li}" data-song="${si}" ${su ? '' : 'disabled'}>
        <span class="song-badge">${badge}</span>
        <span class="song-title">${song.title}</span>
        <span class="song-tempo">${song.tempo} bpm</span>
      </button>`;
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
        <div class="song-list">${songs}</div>
      </div>`;
  }).join('');

  setMain(`
    <section class="levels-screen">
      <div class="levels-header">
        <h2>Choose a Song</h2>
        <p class="muted">Complete songs in order to unlock the next</p>
      </div>
      ${cards}
    </section>
  `);

  dynUI.querySelectorAll('.song-btn:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => startSong(+btn.dataset.level, +btn.dataset.song))
  );
}

// Play HUD — fixed overlay on top of canvas
function buildHUD() {
  document.querySelector('.play-hud')?.remove();
  const song = game.song;
  const hud = document.createElement('div');
  hud.className = 'play-hud';
  hud.innerHTML = `
    <button class="hud-back" id="hudBack">← Back</button>
    <span class="hud-title">${LEVELS[activeLevelIdx].name} · ${song.title}</span>
    <div class="hud-meters">
      <div class="hud-pill"><span class="label">Detected</span><strong id="detectedNote">—</strong></div>
      <div class="hud-pill"><span class="label">Target</span><strong id="targetNote">—</strong></div>
      <div class="hud-pill"><span class="label">Status</span><strong id="accuracy">—</strong></div>
    </div>
    <button class="hud-fs" id="hudFS" title="Toggle fullscreen">⛶</button>
  `;
  document.body.appendChild(hud);
  document.querySelector('#hudBack').addEventListener('click', () => {
    screen = 'levels';
    hideLane();
    buildLevelsScreen();
  });
  document.querySelector('#hudFS').addEventListener('click', () => {
    if (isFS()) exitFS(); else enterFS();
  });
}

function buildCompleteScreen() {
  const next = activeSongIdx + 1;
  const levelDone = isLevelCompleted(activeLevelIdx, LEVELS[activeLevelIdx].songs.length);
  const nextLvl   = activeLevelIdx + 1;
  const hasNext   = next < LEVELS[activeLevelIdx].songs.length;
  const hasNextLvl= nextLvl < LEVELS.length;
  const nextBtn   = hasNext
    ? `<button id="btnNext">Next song →</button>`
    : (levelDone && hasNextLvl ? `<button id="btnNextLevel">Start Level ${nextLvl + 1} →</button>` : '');

  setMain(`
    <section class="complete-screen">
      <img class="mascot mascot-celebrate" src="./art/ui/raccoon-mascot.svg" alt="" />
      <h2>⭐ Song Complete!</h2>
      <p class="complete-song">${game.song.title}</p>
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

  const notes = game.song.notes;
  // Scroll speed scales with screen width so notes feel consistent
  const SPEED = W * 0.14; // px/s — ~134px/s at 960px wide
  const playheadX = W * 0.22;

  // Note rows: span from bottom 10% to top 88% of height
  const MIDI_MIN = 72; // C5
  const MIDI_MAX = 86; // D6
  const MIDI_RANGE = MIDI_MAX - MIDI_MIN;
  const laneTop    = H * 0.10;
  const laneBottom = H * 0.88;
  const laneH      = laneBottom - laneTop;

  function noteY(midi) {
    const t = (midi - MIDI_MIN) / MIDI_RANGE;
    return laneBottom - t * laneH;
  }

  // Lane guide lines
  ctx.save();
  ctx.strokeStyle = 'rgba(189,140,255,.08)';
  ctx.lineWidth = 1;
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const y = noteY(midi);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();

  // Note bars + nodes
  for (const note of notes) {
    const noteX    = playheadX + (note.start - game.songTime) * SPEED;
    const noteEndX = playheadX + (note.start + note.duration - game.songTime) * SPEED;
    if (noteEndX < -60 || noteX > W + 60) continue;

    const y    = noteY(note.midi);
    const done = game.completed.has(note.start);
    const cur  = currentNote(game.songTime, notes);
    const hit  = cur === note && isHit(note);

    // bar
    const barX = Math.max(0, noteX);
    const barW = noteEndX - barX;
    if (barW > 2) {
      ctx.save();
      ctx.fillStyle = done
        ? 'rgba(102,86,142,.45)'
        : hit ? 'rgba(133,255,208,.20)' : 'rgba(189,140,255,.14)';
      roundRect(ctx, barX, y - 9, barW, 18, 9);
      ctx.fill();
      ctx.restore();
    }

    // node circle
    if (noteX > -30 && noteX < W + 30) drawNoteNode(ctx, noteX, y, hit, done, note.note, W);
  }

  drawPlayhead(ctx, playheadX, H);

  if (game.pitch) drawPitchIndicator(ctx, game.pitch, playheadX, H, noteY, W);

  // HUD meter text update
  if (screen === 'playing') {
    const cur = currentNote(game.songTime, game.song.notes);
    const hit = isHit(cur);
    const el = (id) => document.querySelector(id);
    const dn = el('#detectedNote');
    const tn = el('#targetNote');
    const ac = el('#accuracy');
    if (dn) dn.textContent = game.pitch ? `${game.pitch.note} ${game.pitch.cents > 0 ? '+' : ''}${game.pitch.cents.toFixed(0)}¢` : '—';
    if (tn) tn.textContent = cur ? cur.note : game.songFinished ? 'done' : '—';
    if (ac) ac.textContent = cur ? (hit ? 'hit ✓' : 'searching…') : game.songFinished ? 'finished!' : '—';
  }
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────
function drawPitchIndicator(ctx, pitch, playheadX, H, noteY, W) {
  const y     = Math.max(18, Math.min(H - 18, noteY(pitch.midi)));
  const close = Math.abs(pitch.cents) <= 35;
  ctx.save();
  ctx.shadowColor = close ? 'rgba(116,247,255,.9)' : 'rgba(255,215,106,.5)';
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = close ? '#85ffd0' : '#ffd76a';
  ctx.strokeStyle = '#fff8ff';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.arc(playheadX, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  const lx = playheadX + 22;
  ctx.fillStyle = 'rgba(17,10,39,.86)';
  roundRect(ctx, lx, y - 18, 86, 34, 17);
  ctx.fill();
  ctx.strokeStyle = close ? 'rgba(133,255,208,.72)' : 'rgba(255,215,106,.65)';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff8ff';
  ctx.font = `800 ${Math.round(W * 0.014)}px Inter, system-ui, sans-serif`;
  ctx.fillText(pitch.note, lx + 10, y - 4);
  ctx.fillStyle = close ? '#85ffd0' : '#ffd76a';
  ctx.font = `700 ${Math.round(W * 0.011)}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${pitch.cents > 0 ? '+' : ''}${pitch.cents.toFixed(0)}¢`, lx + 10, y + 10);
  ctx.restore();
}

function drawNoteNode(ctx, x, y, hit, done, label, W) {
  const r = hit ? 13 : 10;
  const g = ctx.createRadialGradient(x - 2, y - 3, 2, x, y, r);
  g.addColorStop(0, '#fff8ff');
  g.addColorStop(0.5, hit ? '#85ffd0' : done ? '#9978d2' : '#fff0a7');
  g.addColorStop(1,   done ? '#66568e' : '#bd8cff');
  ctx.save();
  ctx.shadowColor = hit ? 'rgba(116,247,255,.9)' : 'rgba(255,215,106,.45)';
  ctx.shadowBlur  = hit ? 16 : 8;
  ctx.fillStyle   = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = 'rgba(255,248,255,.72)';
  ctx.lineWidth   = 2;
  ctx.stroke();
  ctx.fillStyle   = done ? 'rgba(189,170,255,.5)' : 'rgba(255,248,255,.9)';
  ctx.font        = `700 ${Math.round(W * 0.012)}px Inter, system-ui, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.fillText(label, x, y - r - 4);
  ctx.restore();
}

function drawPlayhead(ctx, x, H) {
  ctx.save();
  ctx.shadowColor = 'rgba(116,247,255,.9)';
  ctx.shadowBlur  = 20;
  ctx.strokeStyle = '#a7f8ff';
  ctx.lineWidth   = 3;
  ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, H - 12); ctx.stroke();
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = '#fff0a7';
  ctx.strokeStyle = '#fff8ff';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(x - 2, 24, 12, Math.PI * 0.42, Math.PI * 1.62, false);
  ctx.arc(x + 5, 24, 9,  Math.PI * 1.68, Math.PI * 0.35, true);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  drawSparkle(ctx, x + 18, 42, 7);
  ctx.restore();
}

function drawSparkle(ctx, x, y, size) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle  = '#fff0a7';
  ctx.shadowColor= 'rgba(255,240,167,.8)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? size : size * 0.38;
    i === 0 ? ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
            : ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawStars(W, H) {
  const stars = [[104,38,1.4],[184,246,1.0],[314,72,1.2],[472,282,1.1],[612,46,1.5],[744,238,1.0],[872,88,1.3],[924,292,1.0]];
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
