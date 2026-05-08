import { detectPitchYin, midiToName } from './pitch.js';
import { CONFIRM_SECONDS, HIT_WINDOW_CENTS, exercise } from './song.js';

const startButton = document.querySelector('#startButton');
const detectedNote = document.querySelector('#detectedNote');
const targetNote = document.querySelector('#targetNote');
const accuracy = document.querySelector('#accuracy');
const canvas = document.querySelector('#noteLane');
const ctx = canvas.getContext('2d');
const debugFrameTime = document.querySelector('#debugFrameTime');
const debugAudioLatency = document.querySelector('#debugAudioLatency');
const debugFrequency = document.querySelector('#debugFrequency');
const debugConfidence = document.querySelector('#debugConfidence');

const state = {
  audio: null,
  analyser: null,
  buffer: null,
  pitch: null,
  startedAt: 0,
  songTime: 0,
  lastFrame: performance.now(),
  heldCorrectFor: new Map(),
  completed: new Set(),
};

startButton.addEventListener('click', startMic);
requestAnimationFrame(frame);

async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const audio = new AudioContext({ latencyHint: 'interactive' });
  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  state.audio = audio;
  state.analyser = analyser;
  state.buffer = new Float32Array(analyser.fftSize);
  state.startedAt = performance.now();
  startButton.textContent = 'Listening';
  startButton.classList.add('listening');
}

function frame(now) {
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  updatePitch();
  updateGame(dt);
  render();
  updateDebug(dt);
  requestAnimationFrame(frame);
}

function updatePitch() {
  if (!state.analyser) return;
  state.analyser.getFloatTimeDomainData(state.buffer);
  state.pitch = detectPitchYin(state.buffer, state.audio.sampleRate);

  if (!state.pitch || state.pitch.confidence < 0.72) {
    detectedNote.textContent = '—';
    accuracy.textContent = 'listening';
    return;
  }
  detectedNote.textContent = `${state.pitch.note} ${state.pitch.cents > 0 ? '+' : ''}${state.pitch.cents.toFixed(0)}¢`;
}

function updateGame(dt) {
  const current = currentNote();
  targetNote.textContent = current ? `${current.note} · ${current.mode}` : '—';

  const hit = isHit(current);
  if (current && hit) {
    state.heldCorrectFor.set(current.start, (state.heldCorrectFor.get(current.start) ?? 0) + dt);
  }

  if (current?.mode === 'hold' && !hit) {
    accuracy.textContent = 'hold to move';
    return;
  }

  if (current?.mode === 'confirm' && (state.heldCorrectFor.get(current.start) ?? 0) >= CONFIRM_SECONDS) {
    state.completed.add(current.start);
  }

  state.songTime += dt;
  accuracy.textContent = current ? (hit ? 'hit' : 'search') : 'done';
}

function updateDebug(dt) {
  debugFrameTime.textContent = `${(dt * 1000).toFixed(1)} ms`;

  if (!state.audio) {
    debugAudioLatency.textContent = 'mic off';
    debugFrequency.textContent = '—';
    debugConfidence.textContent = '—';
    return;
  }

  const latencyMs = ((state.audio.baseLatency ?? 0) + (state.audio.outputLatency ?? 0)) * 1000;
  debugAudioLatency.textContent = latencyMs > 0 ? `${latencyMs.toFixed(1)} ms` : 'unknown';
  debugFrequency.textContent = state.pitch ? `${state.pitch.frequency.toFixed(1)} Hz` : '—';
  debugConfidence.textContent = state.pitch ? `${Math.round(state.pitch.confidence * 100)}%` : '—';
}

function currentNote() {
  return exercise.notes.find(note => state.songTime >= note.start && state.songTime <= note.start + note.duration);
}

function isHit(note) {
  if (!note || !state.pitch || state.pitch.confidence < 0.72) return false;
  return Math.abs(state.pitch.midi - note.midi) === 0 && Math.abs(state.pitch.cents) <= HIT_WINDOW_CENTS;
}

function render() {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#22124c');
  gradient.addColorStop(0.55, '#120c2f');
  gradient.addColorStop(1, '#070916');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  drawStars(width, height);

  const playheadX = width * 0.28;
  const pxPerSecond = 118;
  const rows = [64, 65, 67, 69, 71, 72, 74];
  const rowHeight = height / rows.length;

  ctx.font = '15px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  rows.forEach((midi, index) => {
    const y = rowY(index, rowHeight);
    const laneGradient = ctx.createLinearGradient(0, y - rowHeight * 0.34, 0, y + rowHeight * 0.34);
    laneGradient.addColorStop(0, 'rgba(255,255,255,.055)');
    laneGradient.addColorStop(1, 'rgba(116,247,255,.018)');
    ctx.fillStyle = laneGradient;
    roundRect(ctx, 70, y - rowHeight * 0.32, width - 96, rowHeight * 0.64, 18);
    ctx.fill();

    ctx.strokeStyle = 'rgba(189,140,255,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(78, y);
    ctx.lineTo(width - 24, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(236,226,255,.74)';
    ctx.fillText(midiToName(midi), 20, y);
  });

  for (const note of exercise.notes) {
    const index = rows.indexOf(note.midi);
    if (index < 0) continue;
    const x = playheadX + (note.start - state.songTime) * pxPerSecond;
    const w = note.duration * pxPerSecond;
    const y = rowY(index, rowHeight) - rowHeight * 0.32;
    const hit = isHit(note);
    const done = state.completed.has(note.start) || state.songTime > note.start + note.duration;
    const noteGradient = ctx.createLinearGradient(x, y, x + w, y + rowHeight * 0.6);
    if (done) {
      noteGradient.addColorStop(0, '#40315f');
      noteGradient.addColorStop(1, '#2c254c');
    } else if (hit) {
      noteGradient.addColorStop(0, '#e9fff6');
      noteGradient.addColorStop(0.45, '#85ffd0');
      noteGradient.addColorStop(1, '#54d9ff');
      ctx.shadowColor = 'rgba(116,247,255,.72)';
      ctx.shadowBlur = 18;
    } else {
      noteGradient.addColorStop(0, '#ffe8a4');
      noteGradient.addColorStop(0.5, '#cfa4ff');
      noteGradient.addColorStop(1, '#ff93c8');
      ctx.shadowColor = 'rgba(189,140,255,.35)';
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = noteGradient;
    roundRect(ctx, x, y, w, rowHeight * 0.6, 16);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = done ? '#c8bde8' : '#160d2f';
    ctx.fillText(`${note.note} · ${note.mode}`, x + 14, y + rowHeight * 0.3);

    ctx.fillStyle = hit ? '#fff8b4' : 'rgba(255,248,255,.78)';
    ctx.beginPath();
    ctx.arc(x + Math.min(w - 18, 22), y + rowHeight * 0.3, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.shadowColor = 'rgba(116,247,255,.85)';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#a7f8ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#fff0a7';
  ctx.beginPath();
  ctx.arc(playheadX, 24, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawStars(width, height) {
  const stars = [
    [104, 38, 1.4], [184, 246, 1.0], [314, 72, 1.2], [472, 282, 1.1],
    [612, 46, 1.5], [744, 238, 1.0], [872, 88, 1.3], [924, 292, 1.0],
  ];
  ctx.fillStyle = 'rgba(255, 240, 167, .72)';
  for (const [x, y, r] of stars) {
    ctx.beginPath();
    ctx.arc(x % width, y % height, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function rowY(index, rowHeight) {
  return canvas.height - (index + 0.5) * rowHeight;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
