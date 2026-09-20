/* signals.js — local, deterministic conversation analysis.
 * No model involved. Pure arithmetic on the parsed thread.
 * These are the most trustworthy numbers in the app.
 */

export const ME = 'me';
export const THEM = 'them';

/* ---------- parsing ---------- */

const WA_LINE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?\s*(?:[ap]m)?\s*[-–]\s*([^:]{1,60}):\s?([\s\S]*)$/i;

const SIMPLE_LINE = /^\s*(me|you|io|lei|lui|her|him|them)\s*[:>-]\s*([\s\S]*)$/i;

/**
 * Parse pasted text into messages. Supports:
 *  - WhatsApp export lines
 *  - "me: ..." / "her: ..." simple format
 *  - bare alternating lines (fallback, best effort)
 */
export function parseConversation(raw, myNameHint = '') {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out = [];
  let mode = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const wa = line.match(WA_LINE);
    if (wa) {
      mode = 'wa';
      const [, date, time, name, text] = wa;
      out.push({
        who: guessWho(name, myNameHint),
        name: name.trim(),
        ts: parseTs(date, time),
        text: text.trim(),
      });
      continue;
    }

    const sim = line.match(SIMPLE_LINE);
    if (sim && mode !== 'wa') {
      mode = 'simple';
      const tag = sim[1].toLowerCase();
      out.push({
        who: ['me', 'io'].includes(tag) ? ME : THEM,
        name: tag,
        ts: null,
        text: sim[2].trim(),
      });
      continue;
    }

    // continuation of previous message
    if (out.length && mode) {
      out[out.length - 1].text += '\n' + line.trim();
    } else {
      out.push({ who: null, name: '', ts: null, text: line.trim() });
    }
  }

  // fallback: unlabelled lines alternate
  if (out.length && out.every((m) => m.who === null)) {
    out.forEach((m, i) => (m.who = i % 2 === 0 ? THEM : ME));
  }
  return out.filter((m) => m.text);
}

function guessWho(name, hint) {
  const n = name.trim().toLowerCase();
  if (hint && n === hint.trim().toLowerCase()) return ME;
  if (['me', 'io', 'you'].includes(n)) return ME;
  return THEM;
}

function parseTs(date, time) {
  const parts = date.split('/').map(Number);
  if (parts.length !== 3) return null;
  let [a, b, y] = parts;
  if (y < 100) y += 2000;
  // try month/day first, fall back to day/month
  const [hh, mm] = time.split(':').map(Number);
  let d = new Date(y, a - 1, b, hh, mm);
  if (isNaN(d) || a > 12) d = new Date(y, b - 1, a, hh, mm);
  return isNaN(d) ? null : d;
}

/* ---------- signals ---------- */

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;

/**
 * Compute observable signals. Every field is either a number or null
 * (null = not enough data). Never invents a value.
 */
export function computeSignals(msgs) {
  const mine = msgs.filter((m) => m.who === ME);
  const theirs = msgs.filter((m) => m.who === THEM);
  const haveTs = msgs.some((m) => m.ts);

  const s = {
    total: msgs.length,
    myCount: mine.length,
    theirCount: theirs.length,
    myWords: mine.reduce((a, m) => a + words(m.text), 0),
    theirWords: theirs.reduce((a, m) => a + words(m.text), 0),
    lengthRatio: null,
    volumeRatio: null,
    myQuestionRate: null,
    theirQuestionRate: null,
    myMedianLatency: null,
    theirMedianLatency: null,
    latencyTrend: null,
    initiationShare: null,
    maxBurst: 0,
    burstCount: 0,
    hasTimestamps: haveTs,
  };

  if (mine.length && theirs.length) {
    const myAvg = s.myWords / mine.length;
    s.lengthRatio = myAvg > 0 ? (s.theirWords / theirs.length) / myAvg : null;
    s.volumeRatio = theirs.length / mine.length;
    s.myQuestionRate = mine.filter((m) => m.text.includes('?')).length / mine.length;
    s.theirQuestionRate = theirs.filter((m) => m.text.includes('?')).length / theirs.length;
  }

  // bursts: consecutive runs from me with no reply
  let run = 0;
  for (const m of msgs) {
    if (m.who === ME) {
      run++;
      s.maxBurst = Math.max(s.maxBurst, run);
      if (run === 4) s.burstCount++;
    } else run = 0;
  }

  if (haveTs) {
    const lat = { [ME]: [], [THEM]: [] };
    for (let i = 1; i < msgs.length; i++) {
      const a = msgs[i - 1], b = msgs[i];
      if (!a.ts || !b.ts || a.who === b.who) continue;
      const mins = (b.ts - a.ts) / 60000;
      if (mins >= 0 && mins <= 60 * 48) lat[b.who].push(mins);
    }
    s.myMedianLatency = median(lat[ME]);
    s.theirMedianLatency = median(lat[THEM]);

    // trend: median of last third vs first third of their replies
    const t = lat[THEM];
    if (t.length >= 6) {
      const k = Math.floor(t.length / 3);
      const early = median(t.slice(0, k));
      const late = median(t.slice(-k));
      if (early !== null && late !== null) {
        s.latencyTrend = late - early; // positive = slowing down
      }
    }

    // initiation: first message of each calendar day
    const byDay = new Map();
    for (const m of msgs) {
      if (!m.ts) continue;
      const key = m.ts.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, m.who);
    }
    if (byDay.size >= 2) {
      const themFirst = [...byDay.values()].filter((w) => w === THEM).length;
      s.initiationShare = themFirst / byDay.size;
    }
  }

  return s;
}

/* ---------- interest read ---------- */

/**
 * Combine signals into a coarse interest read.
 * Deliberately coarse: three bands, not a score out of 100.
 * A fake precise number would be worse than an honest vague one.
 */
export function interestRead(s) {
  const pos = [], neg = [], unknown = [];

  const put = (cond, good, bad, label) => {
    if (cond === null || cond === undefined) unknown.push(label);
    else (cond ? pos : neg).push(cond ? good : bad);
  };

  put(
    s.theirQuestionRate === null ? null : s.theirQuestionRate >= 0.12,
    'asks you questions',
    'rarely asks you anything',
    'question rate'
  );
  put(
    s.volumeRatio === null ? null : s.volumeRatio >= 0.7,
    'matches your message volume',
    'writes noticeably less than you',
    'volume'
  );
  put(
    s.lengthRatio === null ? null : s.lengthRatio >= 0.8,
    'writes messages as long as yours',
    'replies much shorter than your messages',
    'length'
  );
  put(
    s.initiationShare === null ? null : s.initiationShare >= 0.3,
    'starts conversations too',
    'almost never messages first',
    'initiation'
  );
  put(
    s.latencyTrend === null ? null : s.latencyTrend <= 30,
    'reply speed is steady or improving',
    'replies are slowing down over time',
    'latency trend'
  );

  let band;
  if (pos.length >= 4) band = 'engaged';
  else if (pos.length >= 2) band = 'warm but unclear';
  else band = 'low signal';

  if (pos.length + neg.length < 2) band = 'not enough data';

  return { band, pos, neg, unknown };
}

/* ---------- pattern warnings ---------- */

const PATTERNS = [
  {
    id: 'burst',
    label: 'Message burst',
    test: (s) => s.maxBurst >= 4,
    why: (s) => `${s.maxBurst} messages in a row without a reply.`,
    advice: 'Stop at one and wait. Nothing after the third message helps.',
  },
  {
    id: 'ultimatum',
    label: 'Ultimatum',
    test: (s, msgs) => reText(msgs, ME, /(let'?s end|end this|we should stop|i'?m done|paths divide|forget about me|block you)/i),
    why: () => 'You threatened to end things.',
    advice:
      'This asks for reassurance in a form that cannot produce it. Say the feeling instead: "I felt second, and it made me sad."',
  },
  {
    id: 'destabilise',
    label: 'Destabilising',
    test: (s, msgs) =>
      reText(msgs, ME, /(can it work|it can work out|are you happy with me|do you think we)/i) &&
      reText(msgs, ME, /(we'?re so different|we are so different|not on the same page|i'?m not sure about)/i),
    why: () => 'You asked whether it can work, then undercut the answer.',
    advice:
      'When someone accepts the escalation, let it stand. Testing it is the most reliable way to end it.',
  },
  {
    id: 'ledger',
    label: 'Keeping score',
    test: (s, msgs) => reText(msgs, ME, /(i (do|did|am doing) everything|after all i|i'?m the only one who|it'?s not fair)/i),
    why: () => 'You presented an account of your own effort.',
    advice: 'This measures your effort, not their feeling. Ask for the thing you want instead.',
  },
  {
    id: 'latenight',
    label: 'Late-night defining',
    test: (s, msgs) =>
      msgs.some(
        (m) =>
          m.who === ME &&
          m.ts &&
          (m.ts.getHours() >= 23 || m.ts.getHours() <= 3) &&
          /(us|relationship|serious|future|what are we|feelings)/i.test(m.text)
      ),
    why: () => 'Relationship-defining messages sent after 23:00.',
    advice: 'Draft it, sleep, send at noon. Judgement and warmth are both worse at 01:00.',
  },
  {
    id: 'litigation',
    label: 'Litigating',
    test: (s, msgs) =>
      reText(msgs, ME, /(we were clear|i already told you|as i said|that'?s a logical fallacy|by definition|technically)/i),
    why: () => 'You cited prior agreements or corrected a definition mid-conversation.',
    advice:
      'Being right is not the goal here. This reads as contempt even when the facts are on your side.',
  },
];

function reText(msgs, who, re) {
  return msgs.some((m) => m.who === who && re.test(m.text));
}

export function detectPatterns(signals, msgs) {
  return PATTERNS.filter((p) => {
    try {
      return p.test(signals, msgs);
    } catch {
      return false;
    }
  }).map((p) => ({
    id: p.id,
    label: p.label,
    why: p.why(signals, msgs),
    advice: p.advice,
  }));
}

/* ---------- safety gate ---------- */

const STOP_SIGNALS = [
  /\bnot interested\b/i,
  /\bstop (messaging|texting|writing)\b/i,
  /\bleave me alone\b/i,
  /\bdon'?t (message|text|contact) me\b/i,
  /\bi said no\b/i,
  /\bplease stop\b/i,
  /\bi need space\b/i,
  /\blose my number\b/i,
  /\bnie pisz\b/i,
  /\bnon scrivermi\b/i,
  /\blasciami in pace\b/i,
];

/**
 * Returns a blocking reason string, or null if it's fine to draft.
 * This is checked before any model call and cannot be overridden in the UI.
 */
export function safetyGate(msgs) {
  const theirs = msgs.filter((m) => m.who === THEM);
  for (const m of theirs) {
    if (STOP_SIGNALS.some((re) => re.test(m.text))) {
      return `They asked you to stop or said they're not interested ("${m.text.slice(0, 60)}…"). Bussola won't help you write past that.`;
    }
  }
  // sustained silence after repeated sends
  const tail = msgs.slice(-6);
  if (tail.length === 6 && tail.every((m) => m.who === ME)) {
    return 'The last six messages are all yours with no reply. Another message is not the missing piece.';
  }
  return null;
}
