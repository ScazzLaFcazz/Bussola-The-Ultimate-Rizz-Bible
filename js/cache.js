/* cache.js — identical input returns the identical earlier answer.
 *
 * temperature: 0 makes a model *mostly* repeatable, not guaranteed: providers
 * batch requests across varying hardware, and floating-point reduction order
 * shifts with batch composition, so ties break differently run to run. Caching
 * closes that gap completely for the case people actually notice — pressing
 * Analyse twice on the same thread and getting two different readings.
 */

const KEY = 'bussola.cache';
const MAX = 60;

/* Bump when a prompt or the rubric changes, so stale answers are not reused
 * for inputs whose instructions have since moved on. */
export const PROMPT_VERSION = 3;

/** FNV-1a. Not cryptographic — this only needs to separate different inputs. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function cacheKey(parts) {
  return hash(JSON.stringify([PROMPT_VERSION, ...parts]));
}

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};

export function cacheGet(key) {
  const entry = read()[key];
  return entry ? entry.value : null;
}

export function cacheSet(key, value) {
  try {
    const all = read();
    all[key] = { value, ts: Date.now() };
    // Evict oldest first so the store cannot grow without bound.
    const keys = Object.keys(all);
    if (keys.length > MAX) {
      keys
        .sort((a, b) => all[a].ts - all[b].ts)
        .slice(0, keys.length - MAX)
        .forEach((k) => delete all[k]);
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode: caching is an optimisation, never a requirement */
  }
}

export function cacheClear() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export function cacheSize() {
  return Object.keys(read()).length;
}
