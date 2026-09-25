/* app.js — wiring. Control-room edition. */

import {
  parseConversation, computeSignals,
  detectPatterns, safetyGate, ME, THEM,
} from './signals.js';
import { PROVIDERS, complete, extractJson } from './providers.js';
import {
  STAGES, draftSystem, draftUser, matrixSystem, matrixUser,
  loadRubric, readingSystem, readingUser,
} from './prompts.js';
import * as store from './store.js';
import { wilson, calibration } from './stats.js';
import { cacheKey, cacheGet, cacheSet, cacheClear, cacheSize } from './cache.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const spinner = (label) => `<div class="loading"><span class="spinner"></span>${esc(label)}</div>`;

/** Put a button into a spinner state and hand back the undo. */
function busy(btn) {
  const was = btn.textContent;
  btn.classList.add('loading-btn');
  btn.disabled = true;
  return () => {
    btn.classList.remove('loading-btn');
    btn.disabled = false;
    btn.textContent = was;
  };
}

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

$('clearCache').addEventListener('click', () => {
  const n = cacheSize();
  cacheClear();
  $('saveStatus').textContent = n
    ? `Cleared ${n} cached reading${n === 1 ? '' : 's'}.`
    : 'Cache was already empty.';
  setTimeout(() => ($('saveStatus').textContent = ''), 2500);
});

$('wipe').addEventListener('click', () => {
  if (!confirm('Delete every thread, note and your API key from this browser?')) return;
  store.wipeAll();
  cacheClear();
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
  const box = $('stats');
  box.innerHTML = '';
  const s = store.outcomeStats();
  const pending = store.pendingSends();
  const sends = store.allSends();
  const pc = (x) => `${Math.round(x * 100)}%`;

  if (!sends.length) {
    box.append(el('p', 'muted small',
      'Nothing logged yet. Draft a reply, hit "I sent this", then come back and mark whether it got an answer.'));
    return;
  }

  /* ---- 1. pending queue: the only actionable panel, so it goes first ---- */
  if (pending.length) {
    const c = el('div', 'card');
    c.innerHTML =
      `<div class="card-head"><h2>Waiting on an outcome</h2>` +
      `<span class="badge estimate">${pending.length} unmarked</span></div>` +
      `<p class="muted small">Every one you mark makes the numbers below mean more.</p>`;
    const list = el('div', 'pending-list');
    for (const r of pending.slice(0, 12)) {
      const row = el('div', 'pending-row');
      const when = new Date(r.ts);
      row.innerHTML =
        `<div class="pending-msg">` +
          `<div class="pending-meta">${esc(r.threadName)} · ${esc(r.register || '—')} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` +
          `<div class="pending-text">${esc((r.sent || '').slice(0, 120))}</div>` +
        `</div>`;
      const actions = el('div', 'pending-actions');
      const yes = el('button', 'btn mini primary', 'Replied');
      const no = el('button', 'btn mini ghost', 'No reply');
      yes.onclick = () => { store.setOutcome(r.threadId, r.ts, 'replied'); renderStats(); };
      no.onclick = () => { store.setOutcome(r.threadId, r.ts, 'no_reply'); renderStats(); };
      actions.append(yes, no);
      row.append(actions);
      list.append(row);
    }
    c.append(list);
    if (pending.length > 12)
      c.append(el('p', 'muted small', `${pending.length - 12} more not shown.`));
    box.append(c);
  }

  if (!s.total) {
    box.append(el('p', 'muted small', 'Mark a few outcomes above and the dashboard fills in.'));
    return;
  }

  const rate = Math.round((s.replied / s.total) * 100);
  const overall = wilson(s.replied, s.total);

  /* ---- 2. headline ---- */
  const head = el('div', 'card');
  head.innerHTML = `<div class="card-head"><h2>Your reply rate</h2><span class="badge measured">measured</span></div>`;
  const grid = el('div', 'stats-grid');
  grid.append(donutSVG(rate));
  grid.append(barsBlock(s));
  head.append(grid);

  const tele = el('div', 'telemetry');
  tele.append(teleRow('Outcomes marked', `${s.total} of ${sends.length}`));
  tele.append(teleRow('Got a reply', `${s.replied} (${rate}%) [${pc(overall.lo)}–${pc(overall.hi)}]`, true));
  head.append(tele);
  box.append(head);

  /* ---- 3. register comparison, with an honest verdict ---- */
  const regs = Object.entries(s.byRegister).map(([reg, d]) => ({ reg, ...d, ci: wilson(d.replied, d.n) }));
  if (regs.length > 1) {
    const c = el('div', 'card');
    const sorted = [...regs].sort((a, b) => b.ci.p - a.ci.p);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    // Only claim a difference when the intervals don't overlap.
    const separated = best.ci.lo > worst.ci.hi;
    c.innerHTML =
      `<div class="card-head"><h2>Which register works</h2>` +
      `<span class="badge ${separated ? 'measured' : 'estimate'}">${separated ? 'clear difference' : 'too close to call'}</span></div>`;
    const t = el('div', 'telemetry');
    for (const r of sorted) {
      t.append(teleRow(esc(r.reg), `${r.replied}/${r.n} · ${pc(r.ci.p)} [${pc(r.ci.lo)}–${pc(r.ci.hi)}]`, r === best && separated));
    }
    c.append(t);
    c.append(el('p', 'muted small', separated
      ? `${esc(best.reg)} is genuinely outperforming ${esc(worst.reg)} — the intervals don't overlap.`
      : `The intervals overlap, so the ranking above is noise so far. Keep logging.`));
    box.append(c);
  }

  /* ---- 4. time of day ---- */
  const hours = store.hourStats();
  if (hours.length > 1) {
    const c = el('div', 'card');
    c.innerHTML = `<div class="card-head"><h2>When you send</h2><span class="badge measured">measured</span></div>`;
    const block = el('div', 'bars');
    hours.forEach((h, i) => {
      const ci = wilson(h.replied, h.n);
      const r = Math.round(ci.p * 100);
      const row = el('div', 'bar-row');
      row.style.animationDelay = `${i * 80}ms`;
      row.innerHTML =
        `<span class="bar-label">${esc(h.label)}</span>` +
        `<span class="bar-track"><span class="bar-fill${r < 40 ? ' low' : ''}" data-w="${r}%"></span></span>` +
        `<span class="bar-val">${h.replied}/${h.n} · ${r}%</span>`;
      block.append(row);
    });
    c.append(block);
    const late = hours.find((h) => h.id === 'latenight');
    if (late && late.n >= 5) {
      const lateCi = wilson(late.replied, late.n);
      const rest = hours.filter((h) => h.id !== 'latenight').reduce((a, h) => ({ n: a.n + h.n, replied: a.replied + h.replied }), { n: 0, replied: 0 });
      const restCi = wilson(rest.replied, rest.n);
      if (lateCi.hi < restCi.lo)
        c.append(el('p', 'muted small', 'Late-night messages are measurably doing worse than the rest. Draft them, sleep, send at noon.'));
    }
    box.append(c);
  }

  /* ---- 5. calibration: is the app's own forecasting any good? ---- */
  const cal = calibration(store.predictionRows());
  if (cal) {
    const c = el('div', 'card');
    const beatsBase = cal.brier < cal.baseline;
    c.innerHTML =
      `<div class="card-head"><h2>Forecast accuracy</h2>` +
      `<span class="badge ${beatsBase ? 'measured' : 'estimate'}">${beatsBase ? 'beating base rate' : 'no better than base rate'}</span></div>` +
      `<p class="muted small">Brier score <b>${cal.brier.toFixed(3)}</b> against a base-rate baseline of ` +
      `<b>${cal.baseline.toFixed(3)}</b>. Lower is better; 0.25 is a coin flip.</p>`;
    const t = el('div', 'telemetry');
    for (const [band, d] of Object.entries(cal.byBand)) {
      t.append(teleRow(`Predicted "${band}"`, `said ${pc(d.predicted)}, actual ${pc(d.actual)} (${d.replied}/${d.n})`));
    }
    c.append(t);
    if (!cal.reliable)
      c.append(el('p', 'muted small', `Only ${cal.n} forecasts scored — needs about 30 before this means anything.`));
    box.append(c);
  }

  /* ---- 6. the log ---- */
  const logCard = el('div', 'card');
  logCard.innerHTML = `<div class="card-head"><h2>Recent sends</h2></div>`;
  const log = el('div', 'pending-list');
  for (const r of sends.filter((x) => x.outcome).slice(0, 20)) {
    const when = new Date(r.ts);
    const row = el('div', 'pending-row');
    row.innerHTML =
      `<div class="pending-msg">` +
        `<div class="pending-meta">${esc(r.threadName)} · ${esc(r.register || '—')} · ${when.toLocaleDateString()}</div>` +
        `<div class="pending-text">${esc((r.sent || '').slice(0, 120))}</div>` +
      `</div>` +
      `<span class="outcome-tag ${r.outcome === 'replied' ? 'ok' : 'no'}">${r.outcome === 'replied' ? 'replied' : 'no reply'}</span>`;
    const undo = el('button', 'btn mini ghost', 'Undo');
    undo.title = 'Move back to pending';
    undo.onclick = () => { store.setOutcome(r.threadId, r.ts, null); renderStats(); };
    row.append(undo);
    log.append(row);
  }
  logCard.append(log);
  box.append(logCard);

  if (s.total < 15)
    box.append(el('p', 'muted small',
      `Only ${s.total} outcomes marked — treat everything above as a hint, not a finding. Differences need a few dozen sends to mean anything.`));

  requestAnimationFrame(() => {
    box.querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.w; });
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

function analyse({ withAI = false } = {}) {
  const raw = $('convo').value;
  state.msgs = parseConversation(raw);
  if (!state.msgs.length) {
    $('aiReadCard').hidden = true;
    updateStatusRack();
    return;
  }
  // Computed but never displayed. Models mis-count reply gaps across dozens of
  // timestamps, so these go to the model as reference figures rather than being
  // left for it to derive. The reading itself is entirely the model's.
  state.signals = computeSignals(state.msgs);
  state.patterns = detectPatterns(state.signals, state.msgs);
  persist();
  if (withAI) aiRead();
}

/** The reading. This is the Signals panel now — there is no local one. */
async function aiRead() {
  const card = $('aiReadCard');
  const box = $('aiRead');
  const c = cfg();

  // The safety gate stays local on purpose: it must not depend on a network call.
  const blocked = safetyGate(state.msgs);
  if (blocked) {
    card.hidden = false;
    box.innerHTML = `<div class="gate">${esc(blocked)}</div>`;
    return;
  }

  if (PROVIDERS[c.provider].needsKey && !c.key) {
    card.hidden = false;
    box.innerHTML =
      '<div class="gate">Signals are read by the model, so this needs an API key. Add one in Settings.</div>';
    return;
  }

  const convo = asText(state.msgs);
  const stage = $('stage').value;
  const key = cacheKey(['read', c.model, stage, convo]);

  // Same thread, same stage, same model: reuse the stored reading rather than
  // asking again and risking a differently-worded answer to an identical question.
  const hit = cacheGet(key);
  if (hit) {
    card.hidden = false;
    renderAIRead(hit, true);
    return;
  }

  card.hidden = false;
  box.innerHTML = spinner('Reading the thread against the rubric…');
  const done = busy($('analyze'));
  try {
    const rubric = await loadRubric();
    if (!rubric) {
      box.innerHTML = '<p class="muted small">Could not load docs/signals.md, so the reading was skipped rather than run without its rubric.</p>';
      return;
    }
    const out = await complete(c, {
      system: readingSystem(rubric),
      user: readingUser({
        conversation: convo,
        stage,
        signals: state.signals,
        patterns: state.patterns,
      }),
      maxTokens: 1800,
    });
    const parsed = extractJson(out);
    cacheSet(key, parsed);
    renderAIRead(parsed);
  } catch (e) {
    box.innerHTML = `<p class="muted small">✗ ${esc(e.message)}</p>`;
  } finally {
    done();
  }
}

function renderAIRead(j, cached = false) {
  const box = $('aiRead');
  box.innerHTML = '';

  const head = el('div', 'read');
  head.textContent = j.read || '';
  box.append(head);

  if (cached) {
    box.append(el('div', 'muted small', 'Same thread as last time — showing the stored reading. Edit the conversation to re-run it.'));
  }

  if (j.confidence) {
    box.append(el('div', 'tele-row',
      `<span class="k">Confidence</span><span class="v">${esc(j.confidence)}${j.confidence_why ? ` — ${esc(j.confidence_why)}` : ''}</span>`));
  }

  for (const s of j.signals || []) {
    const n = el('div', `ai-signal ${esc(s.verdict || 'neutral')}`);
    n.innerHTML =
      `<div class="ai-signal-head">` +
        `<span class="ai-verdict ${esc(s.verdict || 'neutral')}">${esc(s.verdict || '?')}</span>` +
        `<b>${esc(s.name || '')}</b>` +
        `<span class="ai-weight">${esc(s.weight || '')}${s.tier ? ` · tier ${esc(s.tier)}` : ''}</span>` +
      `</div>` +
      `<div class="ai-evidence">${esc(s.evidence || '')}</div>`;
    box.append(n);
  }

  if (j.counter_reading) {
    box.append(el('div', 'counter',
      `<div class="t">The case against this read</div><div>${esc(j.counter_reading)}</div>`));
  }
  if (j.watch && j.watch.length) {
    box.append(el('div', 'muted small', 'Watch for: ' + j.watch.map(esc).join(' · ')));
  }
}

$('analyze').addEventListener('click', () => analyse({ withAI: true }));
$('convo').addEventListener('blur', analyse);


/* ---------------- drafting ---------------- */

$('draft').addEventListener('click', async () => {
  analyse();
  const btn = $('draft');
  $('gate').hidden = true;
  $('matrixCard').hidden = true;
  $('options').innerHTML = '';
  $('read').hidden = true;

  const notes = $('notes').value.trim();
  const opener = !state.msgs.length;

  // No conversation yet is a valid case — it means writing the first message.
  // But then the context field is the only thing to react to, and specificity
  // is the whole game, so it becomes required rather than optional.
  if (opener && !notes) {
    $('gate').hidden = false;
    $('gate').textContent =
      'No conversation yet, so this would be a first message. Describe her profile in the context field below — what her photos show, her bio, anything specific. Without it there is nothing to react to, and a generic opener is the kind that gets no reply.';
    $('notes').focus();
    return;
  }

  const blocked = safetyGate(state.msgs);
  if (blocked) {
    $('gate').hidden = false;
    $('gate').textContent = blocked;
    return;
  }

  const done = busy(btn);
  $('read').hidden = false;
  $('read').innerHTML = spinner(opener ? 'Writing three openers…' : 'Drafting three replies…');
  try {
    const out = await complete(cfg(), {
      system: draftSystem(opener),
      user: draftUser({
        conversation: opener ? '' : asText(state.msgs),
        stage: opener ? 'matched' : $('stage').value,
        signals: state.signals,
        patterns: state.patterns,
        notes,
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
    $('read').hidden = true;
    $('gate').hidden = false;
    $('gate').textContent = '✗ ' + e.message;
  } finally {
    done();
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
  $('matrixCaveat').textContent = '';

  const convo = asText(state.msgs);
  const key = cacheKey(['matrix', cfg().model, $('stage').value, convo, state.picked.text]);
  const hit = cacheGet(key);
  if (hit) {
    renderMatrix(hit);
    return;
  }

  $('matrix').innerHTML = spinner('Estimating how that lands…');
  try {
    const out = await complete(cfg(), {
      system: matrixSystem(),
      user: matrixUser({
        conversation: convo,
        chosen: state.picked.text,
        stage: $('stage').value,
        signals: state.signals,
        prior: store.baseReplyRate(),
      }),
      maxTokens: 1400,
    });
    const j = extractJson(out);
    cacheSet(key, j);
    renderMatrix(j);
  } catch (e) {
    $('matrix').innerHTML = `<p class="muted small">✗ ${esc(e.message)}</p>`;
  }
}

function renderMatrix(j) {
  $('matrixCaveat').textContent = j.caveat || '';

  // Record what was forecast, so the app can be graded against reality later.
  // Reply probability is read off the "no reply" row rather than invented.
  const noReply = (j.outcomes || []).find((o) => /no reply|no response|silence|ignore/i.test(o.response || ''));
  state.predictedBand = !noReply
    ? 'likely'
    : { likely: 'unlikely', possible: 'possible', unlikely: 'likely' }[noReply.band] || null;

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
}

function logSend(o) {
  persist();
  const t = state.thread;
  t.history = t.history || [];
  const entry = {
    ts: Date.now(),
    sent: o.text,
    register: o.register,
    predictedBand: o.text === state.picked?.text ? state.predictedBand || null : null,
    outcome: null,
  };
  t.history.push(entry);
  store.upsertThread(t);
  // Left pending on purpose: at send time you don't know yet. The dashboard
  // collects unmarked sends so the outcome data doesn't become guesswork.
  toast('Logged as pending — mark it in Stats when you know.');
  renderStats();
  updateStatusRack();
}

let toastTimer;
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = el('div', 'toast');
    t.id = 'toast';
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
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