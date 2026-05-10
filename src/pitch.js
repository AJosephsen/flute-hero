const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SOPRANO_RECORDER_BEGINNER = {
  name: 'Soprano recorder beginner',
  minMidi: 71, // B4 — just below range so slightly low notes still register
  maxMidi: 88, // E6 — just above range for the same reason
  minFrequency: midiToFrequency(71) * 2 ** (-90 / 1200),
  maxFrequency: midiToFrequency(88) * 2 ** (90 / 1200),
  // Higher threshold: real recorders rarely get a clean YIN dip below 0.2.
  // 0.35 lets noisy/breathy tone through; confidence gate in main.js filters junk.
  threshold: 0.35,
  // RMS amplitude gate: below this level we skip detection entirely (breath noise, silence)
  minRms: 0.010,
};

export function frequencyToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

export function centsOff(freq, midi) {
  return 1200 * Math.log2(freq / midiToFrequency(midi));
}

export function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export function detectPitchYin(floatBuffer, sampleRate, profile = SOPRANO_RECORDER_BEGINNER) {
  // ── Amplitude gate ──────────────────────────────────────────────────────────
  const minRms = profile.minRms ?? 0.008;
  if (rms(floatBuffer) < minRms) return null;

  const threshold = profile.threshold ?? 0.30;
  const minFreq   = profile.minFrequency;
  const maxFreq   = profile.maxFrequency;
  const minTau    = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau    = Math.min(Math.floor(sampleRate / minFreq), floatBuffer.length - 2);
  const yin       = new Float32Array(maxTau + 1);

  // ── Difference function ─────────────────────────────────────────────────────
  for (let tau = minTau; tau <= maxTau; tau++) {
    let sum = 0;
    const limit = floatBuffer.length - tau;
    for (let i = 0; i < limit; i++) {
      const d = floatBuffer[i] - floatBuffer[i + tau];
      sum += d * d;
    }
    yin[tau] = sum;
  }

  // ── Cumulative mean normalised difference ───────────────────────────────────
  let running = 0;
  yin[0] = 1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    running += yin[tau];
    yin[tau] = yin[tau] * tau / Math.max(running, 1e-9);
  }

  // ── Find first dip below threshold ─────────────────────────────────────────
  // Walk to local minimum once we cross the threshold, then stop
  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return null;

  // ── Parabolic interpolation for sub-sample accuracy ────────────────────────
  const betterTau = parabolicInterpolate(yin, tauEstimate);
  const frequency = sampleRate / betterTau;
  const midi      = frequencyToMidi(frequency);

  // Clamp to declared MIDI range, but use the wider minMidi/maxMidi here
  if (profile.minMidi != null && midi < profile.minMidi) return null;
  if (profile.maxMidi != null && midi > profile.maxMidi) return null;

  const confidence = Math.max(0, Math.min(1, 1 - yin[tauEstimate]));

  return { frequency, midi, note: midiToName(midi), cents: centsOff(frequency, midi), confidence };
}

export function toleranceForMidi(midi) {
  // Generous cents tolerance for a live beginner player.
  // Lower register notes need more room — they speak less cleanly and pitch
  // tends to sit flat.
  if (midi <= 74) return 95;  // C5–D5  (hardest fingerings)
  if (midi <= 79) return 80;  // E5–G5
  return 70;                  // A5–D6 / upper range
}

function parabolicInterpolate(values, tau) {
  const left    = values[tau - 1] ?? values[tau];
  const center  = values[tau];
  const right   = values[tau + 1] ?? values[tau];
  const divisor = 2 * (2 * center - right - left);
  if (Math.abs(divisor) < 1e-9) return tau;
  return tau + (right - left) / divisor;
}
