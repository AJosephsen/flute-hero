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
  ctx.fillStyle = '#0c1020';
  ctx.fillRect(0, 0, width, height);

  const playheadX = width * 0.28;
  const pxPerSecond = 118;
  const rows = [64, 65, 67, 69, 71, 72, 74];
  const rowHeight = height / rows.length;

  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  rows.forEach((midi, index) => {
    const y = rowY(index, rowHeight);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.fillText(midiToName(midi), 18, y - 8);
  });

  for (const note of exercise.notes) {
    const index = rows.indexOf(note.midi);
    if (index < 0) continue;
    const x = playheadX + (note.start - state.songTime) * pxPerSecond;
    const w = note.duration * pxPerSecond;
    const y = rowY(index, rowHeight) - rowHeight * 0.32;
    const hit = isHit(note);
    const done = state.completed.has(note.start) || state.songTime > note.start + note.duration;
    ctx.fillStyle = done ? '#3a476f' : hit ? '#72f5b4' : '#ffca72';
    roundRect(ctx, x, y, w, rowHeight * 0.6, 16);
    ctx.fill();
    ctx.fillStyle = '#06101f';
    ctx.fillText(`${note.note} · ${note.mode}`, x + 12, y + 25);
  }

  ctx.strokeStyle = '#8bd7ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(playheadX, 0);
  ctx.lineTo(playheadX, height);
  ctx.stroke();
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
