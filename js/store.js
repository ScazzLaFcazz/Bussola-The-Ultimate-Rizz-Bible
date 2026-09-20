/* store.js — localStorage only. No server, no sync, no analytics. */

const K_CFG = 'bussola.config';
const K_THREADS = 'bussola.threads';

const read = (k, fb) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fb;
  } catch {
    return fb;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const getConfig = () =>
  read(K_CFG, { provider: 'openrouter', base: '', model: '', key: '', lang: '' });
export const setConfig = (c) => write(K_CFG, c);

export const getThreads = () => read(K_THREADS, []);
export const setThreads = (t) => write(K_THREADS, t);

export function upsertThread(thread) {
  const all = getThreads();
  const i = all.findIndex((t) => t.id === thread.id);
  thread.updated = Date.now();
  if (i === -1) all.unshift(thread);
  else all[i] = thread;
  setThreads(all);
  return thread;
}

export function deleteThread(id) {
  setThreads(getThreads().filter((t) => t.id !== id));
}

export function newThread(name) {
  return {
    id: 't' + Math.random().toString(36).slice(2, 9),
    name: name || 'Untitled',
    stage: 'matched',
    raw: '',
    notes: '',
    history: [], // {ts, sent, outcome}
    created: Date.now(),
    updated: Date.now(),
  };
}

export function wipeAll() {
  try {
    localStorage.removeItem(K_CFG);
    localStorage.removeItem(K_THREADS);
    return true;
  } catch {
    return false;
  }
}

/** Reply-rate stats across logged sends — your own outcomes, measured. */
export function outcomeStats() {
  const rows = getThreads().flatMap((t) => t.history || []);
  const logged = rows.filter((r) => r.outcome);
  const replied = logged.filter((r) => r.outcome === 'replied').length;
  const byRegister = {};
  for (const r of logged) {
    const k = r.register || 'unknown';
    byRegister[k] = byRegister[k] || { n: 0, replied: 0 };
    byRegister[k].n++;
    if (r.outcome === 'replied') byRegister[k].replied++;
  }
  return { total: logged.length, replied, byRegister };
}
