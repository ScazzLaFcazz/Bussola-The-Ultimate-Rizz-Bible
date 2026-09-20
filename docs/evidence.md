# What this tool claims, and what it doesn't

Bussola makes two kinds of statement, and keeps them visually separate in the UI.

## Measured (green badge)

Arithmetic on your own thread, computed in your browser with no model involved:
reply latency and its trend, message-length ratio, volume ratio, question rate,
initiation share, unanswered-run length.

These are facts about your conversation. They can still mislead — someone can be busy
rather than uninterested — but the numbers themselves are not invented.

## Estimated (amber badge)

The response matrix. A language model guessing how one specific person might react to
one specific message, from a short text sample.

This is genuinely uncertain, so the app uses three coarse bands — **likely** (~40–70%),
**possible** (~15–40%), **unlikely** (~5–15%) — and never a precise percentage. It always
includes "no reply" when plausible.

Any tool that gives you "73% chance she replies" about a stranger is selling you a feeling
of control, not a measurement.

---

## On gender and emotion

A reasonable question: why doesn't this model "how women think"?

Partly because it wouldn't work — you are talking to one person, not a population, and
between-group averages tell you almost nothing about an individual. Partly because the
literature usually cited for it doesn't support the claim.

Four papers frequently invoked in this area:

**Markovits, Trémolière & Blanchette (2018),** *Cognition* 170:76–82 — "Reasoning strategies
modulate gender differences in emotion processing." Gender differences in emotional
reactivity appeared **only among participants using a statistical reasoning strategy**, and
were **entirely absent among counterexample reasoners**. Strategy moderates the effect; gender
alone doesn't predict it.

**Chen et al. (2018),** *Frontiers in Human Neuroscience* 12:275 — Females showed greater
sensitivity to opponents' facial emotion in an interpersonal gambling task (reduced RewP and
feedback P300 amplitude). This one *does* report a female-sensitivity effect. It is a lab task
with a student sample, and it measures reaction to face stimuli, not relationship behaviour.

**Barrett, Robin, Pietromonaco & Eyssell (1998),** *Cognition & Emotion* 12(4):555–578 — "Are
Women the 'More Emotional' Sex?" Participants gave global retrospective self-descriptions, then
a week of momentary ratings. Sex differences appeared **in the global self-descriptions but not
in the averaged momentary ratings**. The only context that produced a difference was the sex of
the interaction partner: everyone expressed more emotion in opposite-sex pairs. The authors'
conclusion is that the findings "present certain caveats to the widely held belief that women
are the 'more emotional' sex."

**Kerr (2021),** "Emotions, Rationality, and Gender," in *Gender Equality* (Encyclopedia of the
UN SDGs), Springer, 202–212 — A conceptual argument that the emotion/rationality opposition,
with emotion coded female and rationality male, is a cultural inheritance rather than a finding,
and that emotions are constitutive of rationality for everyone.

**Net effect:** one lab effect, one effect that only exists in half the sample, one that
disappears under real-time measurement, and one arguing the framing is wrong. That is not a
foundation for a targeting system.

The Barrett result is the most interesting one for a tool like this, and it cuts in a useful
direction: **people's global impressions of emotional behaviour are unreliable; the
moment-to-moment record is better.** That is exactly why Bussola computes signals from your
actual thread instead of asking you how it's going.

---

## The honest summary

Things that reliably matter, and that this tool acts on:

- **Specificity.** Reacting to one concrete thing beats a general remark.
- **Unambiguous plans.** A named day and place beats "maybe sometime".
- **Volume discipline.** One message and a wait beats four and a wait.
- **Consistency.** Escalating faster than your own certainty, then testing whether the other
  person means it, is the most reliable way to end something that was working.

None of that is about gender. It's about being legible, specific and steady — which is harder
in a second language, which is the actual problem this tool exists to solve.
