# Bussola

**A conversation compass for dating in a language and culture that isn't yours.**

Bussola is a static, browser-only assistant for people dating abroad — built for Italian
expats, useful to anyone writing in a second language. You paste a conversation, and it gives
you three ways to reply, an estimate of how each is likely to land,
and a running read of where the conversation actually stands.

It runs entirely in your browser. No backend, no accounts, no telemetry. Your API key and
your conversations stay in `localStorage` on your own machine.

---

## Why this exists

Most "dating assistant" tools write openers. Openers are rarely the problem.

If you're dating in a second language, the failure mode is different and much more specific:
**your written register is narrower than you are.** You're funny, curious and warm in your own
language, and in a five-word English text message you read as blunt or cold. The gap widens
exactly when it matters — during a disagreement, late at night, when you're tired.

Bussola is built around three things that actually move outcomes:

1. **Specificity beats cleverness.** Messages that react to one concrete thing outperform
   messages that introduce you.
2. **Ambiguity kills plans.** "Maybe we could get a coffee sometime if you want" is a
   different message from "coffee Thursday, I know a place in Kazimierz."
3. **The middle is where things break.** Escalating faster than your own certainty, then
   testing whether the other person really means it, is the most reliable way to end
   something that was working.

---

## What it does

### 1. Read the conversation
Paste the text. It is parsed locally in your browser.

### 2. Local signal analysis — measured, not guessed
Computed in your browser with no model involved:

| Signal | What it measures |
|---|---|
| Reply latency trend | Is she replying faster or slower than her own baseline? |
| Message length ratio | Who is writing more, and is that changing? |
| Initiation share | Who starts conversations? |
| Question rate | Is she asking about you, or only answering? |
| Escalation response | What happens when warmth goes up? |
| Burst ratio | How often do you send multiple unanswered messages? |

These are arithmetic on your own thread. They are the most trustworthy numbers in the app.

### 3. Three drafts
Three replies in genuinely different registers, each with a one-line note on what it is doing
and when it is the wrong choice:

- **Flirty** — teasing, mock-outrage, playful tension. Accuses her of something small and specific.
- **Direct** — the joke removed. Names a day and a place. This is the one that gets plans made.
- **Sincere** — the armour off. Plain, no bit, no defending. Right more often than it feels like.

### 4. Response matrix — clearly labelled as an estimate
Pick a draft and you get likely response categories with rough likelihood bands and a suggested
follow-up for each. **These are model estimates, not measurements.** The app labels them as such
everywhere they appear. Anyone selling you calibrated percentages for one stranger's behaviour
is selling you a feeling of control.

### 5. Outcome dashboard
Log what you sent, then mark whether it got an answer — sends start as **pending**, because at
send time you do not know yet. The Stats tab then shows:

- Reply rate with a confidence interval, not a bare percentage
- Per-register performance, with an explicit **"too close to call"** when the intervals overlap
- Reply rate by time of day, which will tell you if late-night sending is costing you
- **Forecast accuracy** — a Brier score for the response matrix against a base-rate baseline,
  so you can see whether the estimates are informative or merely confident
- A log of recent sends, with undo

Once you have logged ten sends, your measured reply rate is passed to the model as a prior.

### 6. Arc tracking
Stage (matched → talking → plans → met → dating → defining), plus pattern warnings for the
things that reliably end promising conversations:

- **Burst** — 4+ unanswered messages in a row
- **Ultimatum** — threatening to end it as a way of asking for reassurance
- **Destabilise** — asking whether it can work, then undercutting the answer
- **Ledger** — "I do everything and you don't even…"
- **Late-night define** — relationship-defining messages after 23:00
- **Litigation** — citing prior agreements or correcting definitions mid-conflict

Warnings are advisory. You can ignore them.

---

## What it will not do

Hard-coded refusals, not preferences:

- Draft anything to someone who has said no, asked for space, or stopped replying
- Manufacture jealousy, urgency or scarcity as leverage
- Draft anything for or about a minor
- Impersonate anyone, or write messages for someone else's account

It also won't pretend to model "how women think." It models **your conversation** — latency,
length, initiation, specificity. Those are observable. Group psychology is not a targeting tool,
and the literature on gender and emotion is considerably more equivocal than the internet
suggests (see `docs/evidence.md`).

---

## Privacy

- 100% client-side. Deployable to GitHub Pages as-is.
- API key stored in `localStorage`, sent only to the provider you pick.
- Conversations stored in `localStorage`. "Delete all data" wipes it.
- No analytics, no cookies, no third-party requests except your chosen model API.
- **Ollama** keeps everything on your own machine.

Other people's messages are other people's. Keep the export local; don't publish it.

---

## Providers

| Provider | Notes |
|---|---|
| Ollama | Local, private. Needs `OLLAMA_ORIGINS` set for browser access |
| OpenRouter | Easiest for trying several models |
| Anthropic | Requires `anthropic-dangerous-direct-browser-access` |
| OpenAI | Standard browser CORS support |

---

## Run it

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. To deploy: push to GitHub, enable Pages on the repo root.
`.nojekyll` is included.

---

## Licence

MIT. See `LICENSE`.
