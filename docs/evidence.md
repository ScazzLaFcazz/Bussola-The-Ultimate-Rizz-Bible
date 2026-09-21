# What this tool claims, and what it doesn't

Bussola is built on two kinds of observation: measured signals from real conversations, and evidence from relationship science. It's also calibrated to someone real — a 24-year-old Italian expat dating abroad in English. His patterns are woven throughout.

## What is computed, and what is judged

Reply latency, message-length and volume ratios, question rate, initiation share and
unanswered-run length are computed in your browser by arithmetic. They are handed to the
model as reference figures rather than displayed as a verdict of their own, because a
language model asked to count reply gaps across dozens of timestamps will drift.

Three things that arithmetic does, which stop the reading being built on noise:

**Sleep is subtracted from reply times.** A histogram of when someone is active locates
the longest run of hours holding under 2% of their messages, and latency is measured in
waking hours only. Without this, going to bed looks like a nine-hour snub — the single
largest source of false coldness in raw message data.

**Proportions carry confidence intervals.** "She asks questions 25% of the time" means
nothing if that is 2 messages out of 8. Every proportion is a Wilson score interval.

**Trends need a significance test.** Reply-time drift uses Mann-Kendall — non-parametric,
so one 20-hour outlier cannot manufacture a slope. Below n=8 it reports no trend.

The interpretation on top of all of this is the model's, and is labelled as an estimate.

## The reading itself (amber badge)

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

## The user this was built for

Bussola is calibrated to someone specific: an Italian living abroad, writing in English (his second language), dating across Europe. His patterns appear throughout the code.

**His register:** Direct, teasing, lowercase. Short sentences. Mock-accusatory when opening. Emoji like 🥀 to soften something blunt. Never apologizing before being asked.

**How he opens:** His successful openers react to one concrete thing in a profile, not a general compliment. **Specific beats clever. Always.** The ones that introduce him and wait for a response reliably fail.

**How he escalates:** He commits fast — within hours of first contact, he's framing things in terms of commitment and conditions. This pattern repeats consistently, suggesting it's his baseline rather than situational.

**The pattern that recurs:** He asks questions to test whether something is real, then immediately undermines the answer. This creates a cycle: escalate → test → destabilise → escalate harder. This pattern shows up across multiple relationships at different scales, proving it's portable and stable.

**Why text reads different from voice:** He's warm and articulate in voice — capable of extended, unguarded, funny monologue. But text in English at night (when tired, writing in his second language) compresses his register to blunt statements. This gap between channels is measurable in the data but invisible to him.

**The load problem:** Analysis of his broader messaging shows everything goes into whoever he's dating. That person becomes the sole recipient of his expressive output, which loads her with the entire emotional weight before week three.

**Why the tool works for him:** The specificity rule (react to one concrete thing) matches his successful openers exactly. The "no burst" rule (stop after one unanswered message) contradicts his instinct to send multiple, which is when things break. The pattern warnings catch the exact moves that recur. The response matrix uses bands instead of false precision, which suits someone who overthinks odds but needs to act anyway.

---

## The honest summary

Things that reliably matter, and that this tool acts on:

- **Specificity.** Reacting to one concrete thing beats a general remark.
- **Unambiguous plans.** A named day and place beats "maybe sometime".
- **Volume discipline.** One message and a wait beats four and a wait.
- **Consistency.** Escalating faster than your own certainty, then testing whether the other person means it, is the most reliable way to end something that was working.

None of that is about gender. It's about being legible, specific and steady — which is harder
in a second language, which is the actual problem this tool exists to solve.
