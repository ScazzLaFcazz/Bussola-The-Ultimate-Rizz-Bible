/**
 * Bussola proxy for Ollama Cloud.
 *
 * ollama.com sends no CORS headers and does not answer the preflight, so a
 * browser cannot call it directly — that is a decision on their side, and no
 * client-side configuration works around it. This worker sits in between.
 *
 * It holds the real Ollama key as a secret, so the key never reaches the
 * browser. To stop it being an open relay for anyone who learns the URL, the
 * browser must present a gate token of your own choosing, which you type into
 * Bussola's API key field. The worker checks that, then swaps in the real key.
 *
 * Deploy:
 *   npx wrangler secret put OLLAMA_API_KEY     # the key from ollama.com
 *   npx wrangler secret put GATE_TOKEN         # any long random string
 *   npx wrangler deploy
 */

const UPSTREAM = 'https://ollama.com/v1';

/* Only what Bussola actually calls. Keeps this from becoming a general proxy. */
const ALLOWED_PATHS = new Set(['/chat/completions', '/models']);

const MAX_BODY_BYTES = 256 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowList = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // With no allowlist configured, echo the caller's origin. The gate token is
    // what actually protects the key; the origin check is a second, weaker layer.
    const originAllowed = allowList.length === 0 || allowList.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originAllowed && origin ? origin : allowList[0] || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!originAllowed) return fail(403, 'origin not allowed', cors);
    if (request.method !== 'POST') return fail(405, 'method not allowed', cors);

    if (!env.OLLAMA_API_KEY || !env.GATE_TOKEN) {
      return fail(500, 'worker is missing OLLAMA_API_KEY or GATE_TOKEN', cors);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (!ALLOWED_PATHS.has(path)) return fail(404, `path not proxied: ${path}`, cors);

    const presented = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(presented, env.GATE_TOKEN)) {
      return fail(401, 'bad gate token — this is the value you put in Bussola\'s API key field', cors);
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return fail(413, 'request too large', cors);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.OLLAMA_API_KEY}`,
        },
        body,
      });
    } catch (e) {
      return fail(502, `upstream unreachable: ${e.message}`, cors);
    }

    // Pass the upstream response through unchanged apart from the CORS headers,
    // so provider errors still reach the app with their original status and text.
    const headers = new Headers(cors);
    headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function fail(status, message, cors) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

/** Length-independent comparison, so timing does not leak the token. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
