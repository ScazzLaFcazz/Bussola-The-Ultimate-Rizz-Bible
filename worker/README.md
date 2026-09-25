# Ollama Cloud proxy

Optional. Only needed if you want to use **Ollama Cloud** with Bussola.

## Why this exists

`ollama.com` sends no CORS headers and returns `405` to the preflight, so a browser
cannot call it at all — the request is blocked before it leaves. Verified directly:

| | curl (server-side) | browser |
|---|---|---|
| `POST /v1/chat/completions` | `200`, real completion | `TypeError: Failed to fetch` |

The key is not the problem and no client-side setting works around it. Ollama's own docs
say to keep the key out of browser code, so this is deliberate on their side.

This worker sits in between: it holds the Ollama key as an encrypted secret, so the key
never reaches the browser.

## Not an open relay

A proxy that holds your key and answers anyone is a proxy that spends your quota for
strangers. So the browser must present a **gate token** of your own choosing. The worker
checks it, then swaps in the real Ollama key.

That token is what you type into Bussola's *API key* field — **not** your Ollama key.

Three further limits: only `/chat/completions` and `/models` are proxied, requests over
256 KB are refused, and `ALLOWED_ORIGINS` restricts which sites may call it.

## Deploy

```bash
cd worker
npx wrangler secret put OLLAMA_API_KEY
npx wrangler secret put GATE_TOKEN
npx wrangler deploy
```

For `GATE_TOKEN` use a long random string — for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Neither secret goes in `wrangler.toml` or in git. `wrangler secret put` stores them
encrypted on Cloudflare.

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to match where you host Bussola. Remove the
line to allow any origin — the gate token is the real protection; the origin check is a
weaker second layer.

## Point Bussola at it

In **Settings**:

| Field | Value |
|---|---|
| Provider | Ollama Cloud (via proxy) |
| Base URL | `https://bussola-ollama-proxy.<your-subdomain>.workers.dev` |
| Model | `gpt-oss:20b`, or any model from https://ollama.com/search?c=cloud |
| API key | your `GATE_TOKEN` |

No trailing slash on the Base URL — the app appends `/chat/completions` itself.

## What this changes about privacy

The rest of Bussola has no backend: your key goes only to the provider you picked. With
this worker, conversations pass through infrastructure you run. That is strictly more
exposure than calling a provider directly, and it is the reason this is optional rather
than built in.

Local Ollama remains the option where nothing leaves your machine at all.

## Testing it

```bash
curl -i -X POST https://<your-worker>.workers.dev/chat/completions \
  -H "authorization: Bearer $GATE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-oss:20b","messages":[{"role":"user","content":"say ok"}]}'
```

`401` means the gate token does not match. `500` means a secret was never set.
