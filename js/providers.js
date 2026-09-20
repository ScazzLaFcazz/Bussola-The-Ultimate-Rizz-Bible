/* providers.js — thin adapters over chat APIs.
 * Everything runs in the browser with the user's own key.
 * Nothing is proxied through any server we control, because there isn't one.
 */

export const PROVIDERS = {
  ollama: {
    label: 'Ollama (local)',
    needsKey: false,
    defaultBase: 'http://localhost:11434',
    defaultModel: 'llama3.2-vision',
    note: 'Fully local. Start Ollama with OLLAMA_ORIGINS="*" so the browser can reach it.',
  },
  openrouter: {
    label: 'OpenRouter',
    needsKey: true,
    defaultBase: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    note: 'One key, many models.',
  },
  anthropic: {
    label: 'Anthropic',
    needsKey: true,
    defaultBase: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    note: 'Sends the browser-access header required for direct calls.',
  },
  openai: {
    label: 'OpenAI',
    needsKey: true,
    defaultBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    note: 'Standard CORS support.',
  },
};

/**
 * @param {object} cfg  {provider, base, model, key}
 * @param {object} req  {system, user, image?: {mime, b64}, maxTokens}
 * @returns {Promise<string>} raw assistant text
 */
export async function complete(cfg, req) {
  const p = cfg.provider;
  if (p === 'anthropic') return anthropic(cfg, req);
  if (p === 'ollama') return ollama(cfg, req);
  return openaiCompatible(cfg, req); // openai + openrouter
}

function userContent(req, style) {
  if (!req.image) return req.user;
  if (style === 'anthropic') {
    return [
      { type: 'image', source: { type: 'base64', media_type: req.image.mime, data: req.image.b64 } },
      { type: 'text', text: req.user },
    ];
  }
  return [
    { type: 'text', text: req.user },
    { type: 'image_url', image_url: { url: `data:${req.image.mime};base64,${req.image.b64}` } },
  ];
}

async function anthropic(cfg, req) {
  const res = await fetch(`${cfg.base}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens || 2000,
      system: req.system,
      messages: [{ role: 'user', content: userContent(req, 'anthropic') }],
    }),
  });
  const j = await json(res);
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

async function openaiCompatible(cfg, req) {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.key}`,
  };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Bussola';
  }
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens || 2000,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent(req, 'openai') },
      ],
    }),
  });
  const j = await json(res);
  return (j.choices?.[0]?.message?.content || '').trim();
}

async function ollama(cfg, req) {
  const msg = { role: 'user', content: req.user };
  if (req.image) msg.images = [req.image.b64];
  const res = await fetch(`${cfg.base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [{ role: 'system', content: req.system }, msg],
    }),
  });
  const j = await json(res);
  return (j.message?.content || '').trim();
}

async function json(res) {
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = j.error?.message || j.error || res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return j;
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model response.');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('Malformed JSON in model response.');
}
