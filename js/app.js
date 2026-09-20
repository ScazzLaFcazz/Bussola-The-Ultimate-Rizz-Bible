/* app.js — wiring. Control-room edition. */

import {
  parseConversation, computeSignals, interestRead,
  detectPatterns, safetyGate, ME, THEM,
} from './signals.js';
import { PROVIDERS, complete, extractJson } from './providers.js';
import {
  STAGES, draftSystem, draftUser, matrixSystem, matrixUser,
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
  updateStatusRack();
});

function persist() {
  if (!state.thread) state.thread = store.newThread('');
  state.thread.name = $('threadName').value.trim() || 'Untitled';
  state.thread.raw = $('convo').value;
  state.thread.notes = $('notes').value;
  state.thread.stage = $('stage').value;
  store.upsertThread(state.thread);
  refreshPicker();
  updateStatusRack();
}

function renderThreads() {
  const box = $('threadList');
  const list = store.getThreads();
  box.innerHTML = '';
  if (!list.length) {
    box.append(el('p', 'muted small', 'No threads yet.'));
    return;
  }
  list.forEach((t, i) => {
    const row = el('div', 'thread');
    row.style.animationDelay = `${i * 40}ms`;
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
        updateStatusRack();
      }
    };
    row.append(left, del);
    box.append(row);
  });
}

/* ---------------- stats (SVG diagrams) ---------------- */

function renderStats() {
  const s = store.outcomeStats();
  const box = $('stats');
  box.innerHTML = '';
  if (!s.total) {
    box.append(el('p', 'muted small', 'Nothing logged yet. Send a draft, then mark whether it got a reply.'));
    return;
  }
  const rate = Math.round((s.replied / s.total) * 100);

  // --- donut + bars grid ---
  const grid = el('div', 'stats-grid');
  grid.append(donutSVG(rate));
  grid.append(barsBlock(s));
  box.append(grid);

  // --- telemetry rows ---
  const tele = el('div', 'telemetry');
  tele.append(teleRow('Messages logged', s.total));
  tele.append(teleRow('Got a reply', `${s.replied} (${rate}%)`, true));
  for (const [reg, d] of Object.entries(s.byRegister)) {
    const r = Math.round((d.replied / d.n) * 100);
    tele.append(teleRow(`${esc(reg)} register`, `${d.replied}/${d.n} (${r}%)`));
  }
  box.append(tele);

  if (s.total < 15) {
    box.append(el('p', 'muted small', `Only ${s.total} logged — treat these as a hint, not a finding. Differences need a few dozen sends to mean anything.`));
  }

  // animate bars in on next frame
  requestAnimationFrame(() => {
    box.querySelectorAll('.bar-fill').forEach((b) => {
      b.style.width = b.dataset.w;
    });
  });
}

function teleRow(k, v, accent) {
  const row = el('div', 'tele-row');
  row.innerHTML = `<span class="k">${k}</span><span class="v${accent ? ' accent' : ''}">${v}</span>`;
  return row;
}

/* donut/gauge SVG showing overall reply % */
function donutSVG(pct) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (pct / 100) * c;
  const gap = c - filled;
  const wrap = el('div', 'donut-wrap');
  const svg = `
<svg width="140" height="140" viewBox="0 0 140 140" aria-label="Overall reply rate ${pct} percent">
  <circle class="svg-track" cx="70" cy="70" r="${r}" fill="none" stroke-width="8"/>
  <circle class="svg-accent-stroke" cx="70" cy="70" r="${r}" fill="none" stroke-width="8"
    stroke-dasharray="${filled.toFixed(2)} ${gap.toFixed(2)}"
    stroke-dashoffset="${(c / 4).toFixed(2)}"
    stroke-linecap="round"
    transform="rotate(-90 70 70)"
    style="transition: stroke-dasharray .8s cubic-bezier(.2,.7,.3,1); filter: drop-shadow(0 0 6px var(--accent-glow));"/>
  <text class="svg-text" x="70" y="68" text-anchor="middle" font-size="26" font-weight="700">${pct}<tspan font-size="13" dx="1">%</tspan></text>
  <text class="svg-text-dim" x="70" y="88" text-anchor="middle" font-size="9" letter-spacing="2">REPLY RATE</text>
</svg>`;
  wrap.innerHTML = svg + `<div class="donut-label">overall</div>`;
  return wrap;
}

/* horizontal bar chart of reply rate per register */
function barsBlock(s) {
  const block = el('div', 'bars');
  const entries = Object.entries(s.byRegister);
  entries.forEach(([reg, d], i) => {
    const r = Math.round((d.replied / d.n) * 100);
    const row = el('div', 'bar-row');
    row.style.animationDelay = `${i * 80}ms`;
    row.innerHTML =
      `<span class="bar-label">${esc(reg)}</span>` +
      `<span class="bar-track"><span class="bar-fill${r < 40 ? ' low' : ''}" data-w="${r}%"></span></span>` +
      `<span class="bar-val">${d.replied}/${d.n} · ${r}%</span>`;
    block.append(row);
  });
  return block;
}

/* ---------------- analysis ---------------- */

function analyse() {
  const raw = $('convo').value;
  state.msgs = parseConversation(raw);
  if (!state.msgs.length) {
    $('signalsCard').hidden = true;
    updateStatusRack();
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

  // --- prominent readout band ---
  const readout = $('readBand');
  readout.hidden = false;
  readout.setAttribute('data-band', read.band);
  const chips =
    read.pos.map((p) => `<span class="chip pos">+ ${esc(p)}</span>`).join('') +
    read.neg.map((p) => `<span class="chip neg">− ${esc(p)}</span>`).join('') +
    read.unknown.map((p) => `<span class="chip unk">? ${esc(p)}</span>`).join('');
  readout.innerHTML =
    `<div class="readout-band">${esc(read.band)}</div>` +
    `<div class="readout-detail">${read.pos.length} positive · ${read.neg.length} negative · ${read.unknown.length} unknown</div>` +
    (chips ? `<div class="readout-chips">${chips}</div>` : '');

  const pct = (x) => `${Math.round(x * 100)}%`;
  const mins = (x) => (x < 60 ? `${Math.round(x)} min` : `${(x / 60).toFixed(1)} h`);

  // meter helper: normalize a 0..1-ish value to a 0..100 width
  const meter = (x, max) => Math.max(2, Math.min(100, (x / max) * 100));

  let i = 0;
  const add = (label, val, cls, fillPct, fillCls) => {
    const node = el('div', 'sig ' + (cls || ''));
    node.style.animationDelay = `${i * 50}ms`;
    node.innerHTML =
      `<span class="label">${label}</span>` +
      `<span class="v">${val}</span>` +
      (fillPct !== undefined
        ? `<span class="meter"><span class="meter-fill ${fillCls || ''}" data-w="${fillPct}%"></span></span>`
        : '');
    box.append(node);
    i++;
  };

  add('Messages (you / them)', `${s.myCount} / ${s.theirCount}`, '', meter(s.myCount + s.theirCount, 20), 'neutral');
  if (s.volumeRatio !== null)
    add('Volume ratio', s.volumeRatio.toFixed(2), s.volumeRatio >= 0.7 ? 'good' : 'bad', meter(s.volumeRatio, 1.5));
  if (s.lengthRatio !== null)
    add('Length ratio', s.lengthRatio.toFixed(2), s.lengthRatio >= 0.8 ? 'good' : 'bad', meter(s.lengthRatio, 1.5));
  if (s.theirQuestionRate !== null)
    add('They ask questions', pct(s.theirQuestionRate), s.theirQuestionRate >= 0.12 ? 'good' : 'bad', meter(s.theirQuestionRate, 0.4));
  if (s.theirMedianLatency !== null) add('Their median reply', mins(s.theirMedianLatency), '', meter(Math.max(0, 120 - s.theirMedianLatency), 120), 'neutral');
  if (s.latencyTrend !== null)
    add('Reply trend', s.latencyTrend > 0 ? `slowing ~${mins(s.latencyTrend)}` : 'steady / faster',
      s.latencyTrend <= 30 ? 'good' : 'bad',
      s.latencyTrend <= 30 ? meter(30 - s.latencyTrend, 30) : meter(s.latencyTrend, 120));
  if (s.initiationShare !== null)
    add('They start the day', pct(s.initiationShare), s.initiationShare >= 0.3 ? 'good' : 'bad', meter(s.initiationShare, 0.6));
  if (s.maxBurst >= 2) add('Your longest unanswered run', `${s.maxBurst} msgs`, s.maxBurst >= 4 ? 'bad' : '', meter(s.maxBurst, 6), s.maxBurst >= 4 ? '' : 'neutral');
  if (!s.hasTimestamps)
    box.append(el('p', 'muted small', 'No timestamps found — timing signals unavailable. Paste an export with times for more.'));

  // animate meter fills in
  requestAnimationFrame(() => {
    box.querySelectorAll('.meter-fill').forEach((m) => {
      m.style.width = m.dataset.w;
    });
  });

  // --- pattern warnings as alert lights ---
  const pb = $('patterns');
  pb.innerHTML = '';
  state.patterns.forEach((p, idx) => {
    const w = el('div', 'warn');
    w.style.animationDelay = `${idx * 70}ms`;
    w.innerHTML =
      `<span class="alert-light"></span>` +
      `<div><div class="t">${esc(p.label)}</div><div>${esc(p.why)}</div>` +
      `<div class="muted small" style="margin-top:4px">${esc(p.advice)}</div></div>`;
    pb.append(w);
  });
}

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
    $('read').innerHTML = `<div class="readout-band">${esc(j.read || '')}</div>`;
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
    n.style.animationDelay = `${i * 90}ms`;
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
    let oi = 0;
    for (const o of j.outcomes || []) {
      const n = el('div', 'out');
      n.style.animationDelay = `${oi * 60}ms`;
      n.innerHTML =
        `<div><span class="band ${esc(o.band)}">${esc(o.band)}</span><b>${esc(o.response)}</b></div>` +
        `<div class="ex">“${esc(o.example || '')}”</div>` +
        `<div class="mv">${esc(o.means || '')} <b>→</b> ${esc(o.your_move || '')}</div>`;
      box.append(n);
      oi++;
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
  updateStatusRack();
}

/* ---------------- status rack (live header) ---------------- */

function updateStatusRack() {
  const threadEl = $('statusThread');
  const msgsEl = $('statusMsgs');
  const dot = document.querySelector('.status-dot[data-state="idle"], .status-dot[data-state="active"]');
  const name = state.thread && state.thread.name && state.thread.name !== 'Untitled'
    ? state.thread.name
    : 'no thread';
  if (threadEl) threadEl.textContent = name;
  const count = state.msgs.length;
  if (msgsEl) msgsEl.textContent = `${count} msg${count === 1 ? '' : 's'}`;
  if (dot) {
    dot.setAttribute('data-state', count > 0 ? 'active' : 'idle');
  }
}

/* ---------------- boot ---------------- */

loadConfig();
state.thread = store.newThread('');
refreshPicker();
updateStatusRack();