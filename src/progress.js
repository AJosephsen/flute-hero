// Persistent progress stored in localStorage.
// Keys are "levelIdx:songIdx" strings, e.g. "0:0".

const STORAGE_KEY = 'flute-hero-progress';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { completed: [] };
  } catch {
    return { completed: [] };
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable; progress will not persist
  }
}

export function isSongCompleted(levelIdx, songIdx) {
  return load().completed.includes(`${levelIdx}:${songIdx}`);
}

export function isLevelCompleted(levelIdx, songCount) {
  for (let i = 0; i < songCount; i++) {
    if (!isSongCompleted(levelIdx, i)) return false;
  }
  return true;
}

export function isLevelUnlocked(levelIdx, levels) {
  if (levelIdx === 0) return true;
  return isLevelCompleted(levelIdx - 1, levels[levelIdx - 1].songs.length);
}

export function isSongUnlocked(levelIdx, songIdx, levels) {
  if (!isLevelUnlocked(levelIdx, levels)) return false;
  if (songIdx === 0) return true;
  return isSongCompleted(levelIdx, songIdx - 1);
}

export function markSongComplete(levelIdx, songIdx) {
  const data = load();
  const key = `${levelIdx}:${songIdx}`;
  if (!data.completed.includes(key)) {
    data.completed.push(key);
    save(data);
  }
}
