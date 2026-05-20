const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SOPRANO_RECORDER_BEGINNER = {
  name: 'Soprano recorder beginner',
  minMidi: 71, // B4 — slight buffer below range
  maxMidi: 88, // E6 — slight buffer above range
  minFrequency: midiToFrequency(71) * 2 ** (-90 / 1200),
  maxFrequency: midiToFrequency(88) * 2 ** (90 / 1200),
  threshold: 0.35,  // real recorders rarely dip below 0.2 in CMNDF
  minRms: 0.010,    // amplitude gate — ignore breath / silence
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

// ── Normalized Autocorrelation Coefficient at lag tau ─────────────────────────
// Returns a value in [-1, 1].  At the TRUE fundamental period this will be
// higher than at any octave alias — this is the key to octave disambiguation.
function nac(buffer, tau) {
  let num = 0, denA = 0, denB = 0;
  const len = buffer.length - tau;
  for (let i = 0; i < len; i++) {
    num  += buffer[i] * buffer[i + tau];
    denA += buffer[i] * buffer[i];
    denB += buffer[i + tau] * buffer[i + tau];
  }
  const den = Math.sqrt(denA * denB);
  return den < 1e-10 ? 0 : num / den;
}

// ── YIN + NAC octave-robust pitch detector ────────────────────────────────────
//
// Strategy:
//   1. Compute YIN cumulative mean normalised difference function (CMNDF)
//   2. Collect ALL local minima below the threshold (not just the first)
//   3. Score each candidate by its normalized autocorrelation coefficient
//   4. Return the candidate with the BEST NAC score
//
// Why this fixes octave errors:
//   For a recorder playing C5 (τ ≈ 86 samples @ 44100 Hz), the CMNDF has
//   two dips: one near τ≈43 (C6, first alias) and one near τ≈86 (C5, true
//   fundamental).  YIN's "first dip wins" rule picks C6.  The NAC at the
//   TRUE period is always >= the NAC at any sub-harmonic alias, so we
//   correctly prefer τ≈86.
//
export function detectPitchYin(floatBuffer, sampleRate, profile = SOPRANO_RECORDER_BEGINNER) {
  // ── Amplitude gate ──────────────────────────────────────────────────────────
  if (rms(floatBuffer) < (profile.minRms ?? 0.008)) return null;

  const threshold = profile.threshold ?? 0.35;
  const minTau    = Math.max(2, Math.floor(sampleRate / profile.maxFrequency));
  const maxTau    = Math.min(Math.floor(sampleRate / profile.minFrequency), floatBuffer.length - 2);
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

  // ── Cumulative mean normalised difference (CMNDF) ───────────────────────────
  let running = 0;
  yin[0] = 1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    running += yin[tau];
    yin[tau] = yin[tau] * tau / Math.max(running, 1e-9);
  }

  // ── Collect ALL local minima below threshold ────────────────────────────────
  const candidates = [];
  for (let tau = minTau; tau <= maxTau - 1; tau++) {
    if (yin[tau] >= threshold) continue;
    // Walk to the bottom of this dip
    while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++;
    candidates.push(tau);
  }

  if (candidates.length === 0) return null;

  // ── Score each candidate by normalized autocorrelation ─────────────────────
  // The candidate with the highest NAC is the true fundamental.
  let bestTau   = candidates[0];
  let bestScore = -Infinity;

  for (const tau of candidates) {
    const betterTau = parabolicInterpolate(yin, tau);
    const freq      = sampleRate / betterTau;
    const midi      = frequencyToMidi(freq);
    if (midi < (profile.minMidi ?? 0) || midi > (profile.maxMidi ?? 127)) continue;

    const score = nac(floatBuffer, tau);
    if (score > bestScore) {
      bestScore = score;
      bestTau   = tau;
    }
  }

  if (bestScore < 0.2) return null; // no candidate had meaningful self-similarity

  const betterTau  = parabolicInterpolate(yin, bestTau);
  const frequency  = sampleRate / betterTau;
  const midi       = frequencyToMidi(frequency);

  if (midi < (profile.minMidi ?? 0) || midi > (profile.maxMidi ?? 127)) return null;

  // YIN confidence from the dip depth; blended with NAC score
  const yinConf     = Math.max(0, Math.min(1, 1 - yin[bestTau]));
  const confidence  = (yinConf + bestScore) / 2;

  return { frequency, midi, note: midiToName(midi), cents: centsOff(frequency, midi), confidence };
}

export function toleranceForMidi(midi) {
  if (midi <= 74) return 95;  // C5–D5
  if (midi <= 79) return 80;  // E5–G5
  return 70;                  // A5 and above
}

function parabolicInterpolate(values, tau) {
  const left    = values[tau - 1] ?? values[tau];
  const center  = values[tau];
  const right   = values[tau + 1] ?? values[tau];
  const divisor = 2 * (2 * center - right - left);
  if (Math.abs(divisor) < 1e-9) return tau;
  return tau + (right - left) / divisor;
}
