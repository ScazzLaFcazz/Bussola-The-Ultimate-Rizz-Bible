/* stats.js — statistical primitives.
 *
 * The point of this file is to stop the app from claiming things the data
 * cannot support. Three specific failures it exists to prevent:
 *
 *   1. Counting someone's sleep as a slow reply.
 *   2. Reporting "25% question rate" when that is 2 messages out of 8.
 *   3. Calling a trend from noise.
 */

/* ---------- proportions ---------- */

/**
 * Wilson score interval. Correct for small n, unlike the normal approximation,
 * which happily returns negative lower bounds on the sample sizes we actually have.
 * @returns {{p:number, lo:number, hi:number, n:number, wide:boolean}}
 */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null, n: 0, wide: true };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  const lo = Math.max(0, (centre - spread) / denom);
  const hi = Math.min(1, (centre + spread) / denom);
  return { p, lo, hi, n, wide: hi - lo > 0.35 };
}

/**
 * Does the interval sit clearly on one side of a threshold?
 * Returns true / false / null, where null means "the data can't say".
 */
export function decide(ci, threshold) {
  if (ci.p === null) return null;
  if (ci.lo > threshold) return true;
  if (ci.hi < threshold) return false;
  return null;
}

/* ---------- trend ---------- */

/**
 * Mann-Kendall trend test. Non-parametric, so it tolerates the outliers
 * that reply-time data is full of, and it works on small samples.
 * @returns {{S:number, z:number, direction:'up'|'down'|'flat', significant:boolean, n:number}}
 */
export function mannKendall(xs) {
  const n = xs.length;
  if (n < 8) return { S: 0, z: 0, direction: 'flat', significant: false, n };

  let S = 0;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) S += Math.sign(xs[j] - xs[i]);

  // tie-corrected variance
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  let tieAdj = 0;
  for (const t of counts.values()) if (t > 1) tieAdj += t * (t - 1) * (2 * t + 5);

  const varS = (n * (n - 1) * (2 * n + 5) - tieAdj) / 18;
  if (varS <= 0) return { S, z: 0, direction: 'flat', significant: false, n };

  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const significant = Math.abs(z) > 1.96;
  return {
    S,
    z,
    direction: !significant ? 'flat' : z > 0 ? 'up' : 'down',
    significant,
    n,
  };
}

/* ---------- latency ---------- */

/**
 * Infer someone's quiet hours from when they never send anything.
 * Finds the longest circular run of hours holding < 2% of their messages.
 * Needs a decent sample; returns null rather than guessing.
 * @returns {{start:number, end:number, hours:number}|null}
 */
export function inferQuietHours(dates, minSample = 25) {
  if (dates.length < minSample) return null;

  const hist = new Array(24).fill(0);
  for (const d of dates) hist[d.getHours()]++;
  const floor = dates.length * 0.02;
  const quiet = hist.map((c) => c <= floor);
  if (!quiet.some(Boolean) || quiet.every(Boolean)) return null;

  let best = { start: -1, hours: 0 };
  for (let s = 0; s < 24; s++) {
    if (!quiet[s] || quiet[(s + 23) % 24]) continue; // only run starts
    let len = 0;
    while (len < 24 && quiet[(s + len) % 24]) len++;
    if (len > best.hours) best = { start: s, hours: len };
  }
  if (best.hours < 4) return null; // too short to be sleep
  return { start: best.start, end: (best.start + best.hours) % 24, hours: best.hours };
}

/**
 * Minutes between two times, excluding any part falling inside the quiet window.
 * An overnight gap stops looking like a cold shoulder.
 */
export function activeMinutes(from, to, quiet) {
  const total = (to - from) / 60000;
  if (!quiet || total <= 0) return total;

  let asleep = 0;
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  for (let t = cursor.getTime(); t < to.getTime(); t += 3600000) {
    const h = new Date(t).getHours();
    const inQuiet =
      quiet.start < quiet.end
        ? h >= quiet.start && h < quiet.end
        : h >= quiet.start || h < quiet.end;
    if (!inQuiet) continue;
    const slotStart = Math.max(t, from.getTime());
    const slotEnd = Math.min(t + 3600000, to.getTime());
    asleep += (slotEnd - slotStart) / 60000;
  }
  return Math.max(0, total - asleep);
}

/** Reply times are log-normal, so summarise on a log scale. */
export function logStats(xs) {
  const v = xs.filter((x) => x > 0);
  if (v.length < 3) return null;
  const logs = v.map(Math.log);
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
  return {
    n: v.length,
    geoMean: Math.exp(mean),
    median: median(v),
    logSd: sd,
    /** how unusual is this value against their own baseline? */
    zOf: (x) => (x > 0 && sd > 0 ? (Math.log(x) - mean) / sd : null),
  };
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ---------- calibration ---------- */

/** Midpoint of each band, used to score the model's own predictions. */
export const BAND_P = { likely: 0.55, possible: 0.27, unlikely: 0.1 };

/**
 * Brier score over logged predictions. 0 is perfect, 0.25 is a coin flip,
 * and anything above that means the estimates are worse than guessing.
 * @param {Array<{band:string, replied:boolean}>} rows
 */
export function calibration(rows) {
  const scored = rows.filter((r) => BAND_P[r.band] !== undefined);
  if (!scored.length) return null;

  const brier =
    scored.reduce((a, r) => a + (BAND_P[r.band] - (r.replied ? 1 : 0)) ** 2, 0) / scored.length;

  const byBand = {};
  for (const r of scored) {
    byBand[r.band] = byBand[r.band] || { n: 0, replied: 0, predicted: BAND_P[r.band] };
    byBand[r.band].n++;
    if (r.replied) byBand[r.band].replied++;
  }
  for (const b of Object.values(byBand)) {
    b.actual = b.replied / b.n;
    b.ci = wilson(b.replied, b.n);
  }

  const base = scored.filter((r) => r.replied).length / scored.length;
  return {
    n: scored.length,
    brier,
    base,
    byBand,
    // Brier for always predicting the base rate — the bar the model has to clear
    baseline: scored.reduce((a, r) => a + (base - (r.replied ? 1 : 0)) ** 2, 0) / scored.length,
    reliable: scored.length >= 30,
  };
}
