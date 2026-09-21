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

/** Every logged send across all threads, newest first, with its thread attached. */
export function allSends() {
  return getThreads()
    .flatMap((t) => (t.history || []).map((h) => ({ ...h, threadId: t.id, threadName: t.name })))
    .sort((a, b) => b.ts - a.ts);
}

/** Sends you haven't marked yet. These are the ones the dashboard chases you about. */
export function pendingSends() {
  return allSends().filter((r) => !r.outcome);
}

/** Mark a send as replied / no_reply, or back to pending with null. */
export function setOutcome(threadId, ts, outcome) {
  const all = getThreads();
  const t = all.find((x) => x.id === threadId);
  if (!t) return false;
  const entry = (t.history || []).find((h) => h.ts === ts);
  if (!entry) return false;
  entry.outcome = outcome;
  t.updated = Date.now();
  setThreads(all);
  return true;
}

export function deleteSend(threadId, ts) {
  const all = getThreads();
  const t = all.find((x) => x.id === threadId);
  if (!t) return false;
  t.history = (t.history || []).filter((h) => h.ts !== ts);
  setThreads(all);
  return true;
}

/**
 * Reply rate by hour-of-day sent. Answers a question the profile raises directly:
 * do messages sent late at night do worse?
 */
export function hourStats() {
  const rows = allSends().filter((r) => r.outcome);
  const buckets = [
    { id: 'morning', label: 'Morning 06–12', test: (h) => h >= 6 && h < 12 },
    { id: 'afternoon', label: 'Afternoon 12–18', test: (h) => h >= 12 && h < 18 },
    { id: 'evening', label: 'Evening 18–23', test: (h) => h >= 18 && h < 23 },
    { id: 'latenight', label: 'Late night 23–06', test: (h) => h >= 23 || h < 6 },
  ].map((b) => ({ ...b, n: 0, replied: 0 }));

  for (const r of rows) {
    const h = new Date(r.ts).getHours();
    const b = buckets.find((x) => x.test(h));
    if (!b) continue;
    b.n++;
    if (r.outcome === 'replied') b.replied++;
  }
  return buckets.filter((b) => b.n > 0);
}

/** How many threads sit at each stage — a funnel, not a vanity metric. */
export function stageStats() {
  const counts = {};
  for (const t of getThreads()) counts[t.stage || 'matched'] = (counts[t.stage || 'matched'] || 0) + 1;
  return counts;
}

/**
 * Rows where the app predicted a band before you sent, paired with what
 * actually happened. This is what lets the app grade its own forecasts
 * instead of asking you to trust them.
 */
export function predictionRows() {
  return getThreads()
    .flatMap((t) => t.history || [])
    .filter((r) => r.outcome && r.predictedBand)
    .map((r) => ({ band: r.predictedBand, replied: r.outcome === 'replied' }));
}

/** Your measured base reply rate, fed to the model as a prior. Null until n>=10. */
export function baseReplyRate() {
  const rows = getThreads().flatMap((t) => t.history || []).filter((r) => r.outcome);
  if (rows.length < 10) return null;
  return {
    rate: rows.filter((r) => r.outcome === 'replied').length / rows.length,
    n: rows.length,
  };
}
