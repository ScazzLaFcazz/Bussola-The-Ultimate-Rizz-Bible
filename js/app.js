/* app.js — wiring. */

import {
  parseConversation, computeSignals, interestRead,
  detectPatterns, safetyGate, ME, THEM,
} from './signals.js';
import { PROVIDERS, complete, extractJson } from './providers.js';
import {
  STAGES, draftSystem, draftUser, matrixSystem, matrixUser, visionSystem,
} from './prompts.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = { thread: null, msgs: [], signals: null, patterns: [], options: [], picked: null };

/* ---------------- views ---------------- */

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    t.classList.add('active');
    $('view-' + t.dataset.view).classList.add('active');
    if (t.dataset.view === 'threads') renderThreads();
    if (t.dataset.view === 'stats') renderStats();
  })
);

/* ---------------- settings ---------------- */

const provSel = $('provider');
Object.entries(PROVIDERS).forEach(([k, p]) =>
  provSel.append(new Option(p.label, k))
);
$('stage').innerHTML = STAGES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');

function loadConfig() {
  const c = store.getConfig();
  provSel.value = c.provider || 'openrouter';
  applyProviderDefaults(false);
  if (c.base) $('base').value = c.base;
  if (c.model) $('model').value = c.model;
  $('key').value = c.key || '';
  $('lang').value = c.lang || '';
}

function applyProviderDefaults(overwrite = true) {
  const p = PROVIDERS[provSel.value];
  $('providerNote').textContent = p.note;
  if (overwrite || !$('base').value) $('base').value = p.defaultBase;
  if (overwrite || !$('model').value) $('model').value = p.defaultModel;
  $('key').disabled = !p.needsKey;
}

provSel.addEventListener('change', () => applyProviderDefaults(true));

$('save').addEventListener('click', () => {
  store.setConfig({
    provider: provSel.value,
    base: $('base').value.trim().replace(/\/$/, ''),
    model: $('model').value.trim(),
    key: $('key').value.trim(),
    lang: $('lang').value.trim(),
  });
  $('saveStatus').textContent = 'Saved to this browser.';
  setTimeout(() => ($('saveStatus').textContent = ''), 2500);
});

$('test').addEventListener('click', async () => {
  const s = $('saveStatus');
  s.textContent = 'Testing…';
  try {
    const out = await complete(cfg(), {
      system: 'Reply with exactly: ok',
      user: 'ping',
      maxTokens: 10,
    });
    s.textContent = out.toLowerCase().includes('ok') ? '✓ Connected.' : `Responded: ${out.slice(0, 60)}`;
  } catch (e) {
    s.textContent = '✗ ' + e.message;
  }
});

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ threads: store.getThreads() }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bussola-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('wipe').addEventListener('click', () => {
  if (!confirm('Delete every thread, note and your API key from this browser?')) return;
  store.wipeAll();
  location.reload();
});

const cfg = () => ({
  provider: provSel.value,
  base: $('base').value.trim().replace(/\/$/, ''),
  model: $('model').value.trim(),
  key: $('key').value.trim(),
});

/* ---------------- threads ---------------- */

function refreshPicker() {
  const list = store.getThreads();
  $('threadPicker').innerHTML =
    '<option value="">— new thread —</option>' +
    list.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  if (state.thread) $('threadPicker').value = state.thread.id;
}

$('threadPicker').addEventListener('change', (e) => {
  const t = store.getThreads().find((x) => x.id === e.target.value);
  state.thread = t || store.newThread('');
  $('threadName').value = state.thread.name === 'Untitled' ? '' : state.thread.name;
  $('convo').value = state.thread.raw || '';
  $('notes').value = state.thread.notes || '';
  $('stage').value = state.thread.stage || 'matched';
  analyse();
});

$('newThread').addEventListener('click', () => {
  state.thread = store.newThread('');
  ['threadName', 'convo', 'notes'].forEach((i) => ($(i).value = ''));
  refreshPicker();
  $('threadPicker').value = '';
});

function persist() {
  if (!state.thread) state.thread = store.newThread('');
  state.thread.name = $('threadName').value.trim() || 'Untitled';
  state.thread.raw = $('convo').value;
  state.thread.notes = $('notes').value;
  state.thread.stage = $('stage').value;
  store.upsertThread(state.thread);
  refreshPicker();
}

function renderThreads() {
  const box = $('threadList');
  const list = store.getThreads();
  box.innerHTML = '';
  if (!list.length) {
    box.append(el('p', 'muted small', 'No threads yet.'));
    return;
  }
  for (const t of list) {
    const row = el('div', 'thread');
    const left = el('div');
    left.append(el('div', 'n', esc(t.name)));
    const st = STAGES.find((s) => s.id === t.stage);
    left.append(
      el('div', 's', `${st ? st.label : t.stage} · ${(t.history || []).length} logged · ${new Date(t.updated).toLocaleDateString()}`)
    );
    const del = el('button', 'btn danger mini', 'Delete');
    del.onclick = () => {
      if (confirm(`Delete "${t.name}"?`)) {
        store.deleteThread(t.id);
        renderThreads();
        refreshPicker();
      }
    };
    row.append(left, del);
    box.append(row);
  }
}

function renderStats() {
  const s = store.outcomeStats();
  const box = $('stats');
  box.innerHTML = '';
  if (!s.total) {
    box.append(el('p', 'muted small', 'Nothing logged yet. Send a draft, then mark whether it got a reply.'));
    return;
  }
  const rate = Math.round((s.replied / s.total) * 100);
  box.append(el('div', 'sig', `<span>Messages logged</span><span class="v">${s.total}</span>`));
  box.append(el('div', 'sig good', `<span>Got a reply</span><span class="v">${s.replied} (${rate}%)</span>`));
  for (const [reg, d] of Object.entries(s.byRegister)) {
    const r = Math.round((d.replied / d.n) * 100);
    box.append(el('div', 'sig', `<span>${esc(reg)}</span><span class="v">${d.replied}/${d.n} (${r}%)</span>`));
  }
  if (s.total < 15) {
    box.append(el('p', 'muted small', `Only ${s.total} logged — treat these as a hint, not a finding. Differences need a few dozen sends to mean anything.`));
  }
}

/* ---------------- analysis ---------------- */

function analyse() {
  const raw = $('convo').value;
  state.msgs = parseConversation(raw);
  if (!state.msgs.length) {
    $('signalsCard').hidden = true;
    return;
  }
  state.signals = computeSignals(state.msgs);
  state.patterns = detectPatterns(state.signals, state.msgs);
  renderSignals();
  persist();
}

$('analyze').addEventListener('click', analyse);
$('convo').addEventListener('blur', analyse);

function renderSignals() {
  const s = state.signals;
  const read = interestRead(s);
  const box = $('signals');
  box.innerHTML = '';
  $('signalsCard').hidden = false;

  box.append(
    el('div', 'sig', `<span><b>Read</b></span><span class="v">${esc(read.band)}</span>`)
  );

  const pct = (x) => `${Math.round(x * 100)}%`;
  const mins = (x) => (x < 60 ? `${Math.round(x)} min` : `${(x / 60).toFixed(1)} h`);
  const add = (label, val, cls) =>
    box.append(el('div', 'sig ' + (cls || ''), `<span>${label}</span><span class="v">${val}</span>`));

  add('Messages (you / them)', `${s.myCount} / ${s.theirCount}`);
  if (s.volumeRatio !== null)
    add('Volume ratio', s.volumeRatio.toFixed(2), s.volumeRatio >= 0.7 ? 'good' : 'bad');
  if (s.lengthRatio !== null)
    add('Length ratio', s.lengthRatio.toFixed(2), s.lengthRatio >= 0.8 ? 'good' : 'bad');
  if (s.theirQuestionRate !== null)
    add('They ask questions', pct(s.theirQuestionRate), s.theirQuestionRate >= 0.12 ? 'good' : 'bad');
  if (s.theirMedianLatency !== null) add('Their median reply', mins(s.theirMedianLatency));
  if (s.latencyTrend !== null)
    add('Reply trend', s.latencyTrend > 0 ? `slowing ~${mins(s.latencyTrend)}` : 'steady / faster',
      s.latencyTrend <= 30 ? 'good' : 'bad');
  if (s.initiationShare !== null)
    add('They start the day', pct(s.initiationShare), s.initiationShare >= 0.3 ? 'good' : 'bad');
  if (s.maxBurst >= 2) add('Your longest unanswered run', `${s.maxBurst} msgs`, s.maxBurst >= 4 ? 'bad' : '');
  if (!s.hasTimestamps)
    box.append(el('p', 'muted small', 'No timestamps found — timing signals unavailable. Paste an export with times for more.'));

  const pb = $('patterns');
  pb.innerHTML = '';
  for (const p of state.patterns) {
    pb.append(el('div', 'warn', `<div class="t">${esc(p.label)}</div><div>${esc(p.why)}</div><div class="muted small" style="margin-top:4px">${esc(p.advice)}</div>`));
  }
}

/* ---------------- screenshot ---------------- */

$('shot').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const st = $('shotStatus');
  st.textContent = 'Reading screenshot…';
  try {
    const b64 = await toB64(f);
    const out = await complete(cfg(), {
      system: visionSystem(),
      user: 'Transcribe this screenshot.',
      image: { mime: f.type || 'image/png', b64 },
      maxTokens: 2000,
    });
    const j = extractJson(out);
    const lines = (j.messages || []).map((m) => `${m.who === 'me' ? 'me' : 'her'}: ${m.text}`);
    if (!lines.length) {
      st.textContent = 'No messages found in that image.';
      return;
    }
    $('convo').value = ($('convo').value ? $('convo').value.trimEnd() + '\n' : '') + lines.join('\n');
    st.textContent = `Added ${lines.length} messages. Check them — transcription is not perfect.`;
    analyse();
  } catch (err) {
    st.textContent = '✗ ' + err.message;
  } finally {
    e.target.value = '';
  }
});

const toB64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

/* ---------------- drafting ---------------- */

$('draft').addEventListener('click', async () => {
  analyse();
  const btn = $('draft');
  $('gate').hidden = true;
  $('matrixCard').hidden = true;
  $('options').innerHTML = '';
  $('read').hidden = true;

  if (!state.msgs.length) {
    $('gate').hidden = false;
    $('gate').textContent = 'Paste a conversation first.';
    return;
  }

  const blocked = safetyGate(state.msgs);
  if (blocked) {
    $('gate').hidden = false;
    $('gate').textContent = blocked;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const out = await complete(cfg(), {
      system: draftSystem(),
      user: draftUser({
        conversation: asText(state.msgs),
        stage: $('stage').value,
        signals: state.signals,
        patterns: state.patterns,
        notes: $('notes').value,
        lang: store.getConfig().lang,
      }),
      maxTokens: 1600,
    });
    const j = extractJson(out);
    state.options = j.options || [];
    $('read').hidden = false;
    $('read').textContent = j.read || '';
    renderOptions();
  } catch (e) {
    $('gate').hidden = false;
    $('gate').textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suggest three replies';
  }
});

function asText(msgs) {
  return msgs
    .map((m) => `${m.who === ME ? 'ME' : 'THEM'}${m.ts ? ` [${m.ts.toLocaleString()}]` : ''}: ${m.text}`)
    .join('\n');
}

function renderOptions() {
  const box = $('options');
  box.innerHTML = '';
  state.options.forEach((o, i) => {
    const n = el('div', 'opt');
    n.innerHTML =
      `<div class="reg">${esc(o.register || 'option ' + (i + 1))}</div>` +
      `<div class="msg">${esc(o.text || '')}</div>` +
      `<div class="meta"><b>Does:</b> ${esc(o.does || '')}<br><b>Wrong when:</b> ${esc(o.wrong_when || '')}</div>`;
    const bar = el('div', 'row');
    const copy = el('button', 'btn ghost mini', 'Copy');
    copy.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(o.text || '');
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    };
    const log = el('button', 'btn ghost mini', 'I sent this');
    log.onclick = (e) => {
      e.stopPropagation();
      logSend(o);
    };
    bar.append(copy, log);
    n.append(bar);
    n.onclick = () => pick(i, n);
    box.append(n);
  });
}

async function pick(i, node) {
  document.querySelectorAll('.opt').forEach((x) => x.classList.remove('picked'));
  node.classList.add('picked');
  state.picked = state.options[i];

  const card = $('matrixCard');
  card.hidden = false;
  $('matrix').innerHTML = '<p class="muted small">Estimating…</p>';
  $('matrixCaveat').textContent = '';
  try {
    const out = await complete(cfg(), {
      system: matrixSystem(),
      user: matrixUser({
        conversation: asText(state.msgs),
        chosen: state.picked.text,
        stage: $('stage').value,
        signals: state.signals,
      }),
      maxTokens: 1400,
    });
    const j = extractJson(out);
    $('matrixCaveat').textContent = j.caveat || '';
    const box = $('matrix');
    box.innerHTML = '';
    for (const o of j.outcomes || []) {
      const n = el('div', 'out');
      n.innerHTML =
        `<div><span class="band ${esc(o.band)}">${esc(o.band)}</span><b>${esc(o.response)}</b></div>` +
        `<div class="ex">“${esc(o.example || '')}”</div>` +
        `<div class="mv">${esc(o.means || '')} <b>→</b> ${esc(o.your_move || '')}</div>`;
      box.append(n);
    }
  } catch (e) {
    $('matrix').innerHTML = `<p class="muted small">✗ ${esc(e.message)}</p>`;
  }
}

function logSend(o) {
  persist();
  const t = state.thread;
  t.history = t.history || [];
  const entry = { ts: Date.now(), sent: o.text, register: o.register, outcome: null };
  t.history.push(entry);
  store.upsertThread(t);

  const answer = confirm(
    'Logged.\n\nOK  = she replied\nCancel = no reply (you can change this later by re-logging)'
  );
  entry.outcome = answer ? 'replied' : 'no_reply';
  store.upsertThread(t);
  renderStats();
}

/* ---------------- boot ---------------- */

loadConfig();
state.thread = store.newThread('');
refreshPicker();
