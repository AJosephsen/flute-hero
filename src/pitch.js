const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const SOPRANO_RECORDER_BEGINNER = {
  name: 'Soprano recorder beginner',
  minMidi: 72, // C5
  maxMidi: 86, // D6
  minFrequency: midiToFrequency(72) * 2 ** (-80 / 1200),
  maxFrequency: midiToFrequency(86) * 2 ** (80 / 1200),
  threshold: 0.2,
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

export function detectPitchYin(floatBuffer, sampleRate, profile = SOPRANO_RECORDER_BEGINNER) {
  const threshold = profile.threshold ?? 0.12;
  const minFreq = profile.minFrequency ?? 120;
  const maxFreq = profile.maxFrequency ?? 1200;
  const minTau = Math.floor(sampleRate / maxFreq);
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), floatBuffer.length - 2);
  const yin = new Float32Array(maxTau + 1);

  for (let tau = minTau; tau <= maxTau; tau++) {
    let sum = 0;
    const limit = floatBuffer.length - tau;
    for (let i = 0; i < limit; i++) {
      const delta = floatBuffer[i] - floatBuffer[i + tau];
      sum += delta * delta;
    }
    yin[tau] = sum;
  }

  let running = 0;
  yin[0] = 1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    running += yin[tau];
    yin[tau] = yin[tau] * tau / Math.max(running, 1e-9);
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate < 0) return null;

  const betterTau = parabolicInterpolate(yin, tauEstimate);
  const frequency = sampleRate / betterTau;
  const midi = frequencyToMidi(frequency);
  if (profile.minMidi != null && profile.maxMidi != null && (midi < profile.minMidi || midi > profile.maxMidi)) {
    return null;
  }

  const confidence = Math.max(0, Math.min(1, 1 - yin[tauEstimate]));

  return {
    frequency,
    midi,
    note: midiToName(midi),
    cents: centsOff(frequency, midi),
    confidence,
  };
}

export function toleranceForMidi(midi) {
  // Lower beginner recorder notes speak less cleanly; give them a slightly wider gate.
  if (midi <= 74) return 75; // C5-D5
  if (midi <= 79) return 65; // E5-G5
  return 55; // A5-D6
}

function parabolicInterpolate(values, tau) {
  const left = values[tau - 1] ?? values[tau];
  const center = values[tau];
  const right = values[tau + 1] ?? values[tau];
  const divisor = 2 * (2 * center - right - left);
  if (Math.abs(divisor) < 1e-9) return tau;
  return tau + (right - left) / divisor;
}
