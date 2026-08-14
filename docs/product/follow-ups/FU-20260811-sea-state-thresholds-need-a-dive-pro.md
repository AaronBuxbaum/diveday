# FU-20260811-sea-state-thresholds-need-a-dive-pro — Have a working captain check the numbers behind the sea-state reading

- **Status:** Parked
- **Raised:** 2026-08-11 — branch `claude/trip-pages-ui-cleanup-44l54k`, which replaced the raw
  marine-model output on the diver-facing trip page with a plain-language reading. Narrowed
  2026-08-14 after the product owner ruled the numbers ship as they are and the provenance is now
  documented in code.
- **Parked:** un-parked when a working dive professional is available to read the six bands against
  their own water. Nothing an agent can do moves this — the numbers ship as they are and the code
  now says whose estimates they are.
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/marine-forecast.ts`, `src/lib/marine-forecast.test.ts`,
  `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

The diver-facing conditions card prints a reading rather than the marine model's own output — a
band ("Light chop") plus what that band means for the day. The mapping is `seaStateReading` in
`src/lib/marine-forecast.ts`, banding on significant wave height:

| Significant wave height | Band |
| --- | --- |
| < 0.2 m | glassy |
| 0.2–0.5 m | calm |
| 0.5–0.9 m | light chop |
| 0.9–1.5 m | choppy |
| 1.5–2.5 m | rough |
| ≥ 2.5 m | very rough |

…then shifts one band rougher when the wave period is ≤ 5 s (steep wind chop) and one band calmer
when it is ≥ 9 s (travelled swell), never softening below `calm`.

**Nobody who runs a boat has read those numbers.** They are reasoned — they split 0.2–1.5 m finely
because that is where a Keys morning goes from pleasant to a boat full of sick divers, and collapse
everything above 2.5 m because no recreational trip sails in it — but they are DiveDay's working
estimates, not a published scale and not a captain's call. The Douglas and WMO scales were
considered and rejected for being coarse exactly where a dive day is decided.

## Why it isn't already done

The remaining question needs a judgement no agent can make: whether a working dive professional,
reading these six bands against their own water, agrees the boundaries fall in the right places and
that the period correction is the right *size*. That is a conversation with a person, not a task.

Everything an agent could do here is done. The product owner's call (2026-08-14) is that the
thresholds stay exactly as they are and their provenance is stated honestly in the code: the
comments above `SEA_STATE_THRESHOLDS_M`, `SHORT_PERIOD_SECONDS` and `LONG_PERIOD_SECONDS` now say
these are DiveDay's own estimates, unreviewed by a captain, and that a dive professional's read is
what would move them. The one over-claiming string was also fixed — `very_rough` used to say the
sea "often keeps boats at the dock", a claim about how shops operate that told a liveaboard's
divers the trip was in doubt when it wasn't; it now describes the water and attributes the decision
to the crew, in both locales.

Nothing here gates anything, and nothing may: the card is a planning outlook, the crew make the
call at the dock, and no readiness or admission path reads it. So this stays a credibility question
rather than a safety one — which is why it shipped, and why it can sit here until a captain is in
the room.

## Proposed change

Put the table above, and the six `trip.seaState*` / `trip.seaStateDetail.*` pairs, in front of a
working dive professional and ask three questions:

1. Are the six boundaries in the right places for a recreational reef/wreck boat day?
2. Is the period correction the right size, and are 5 s / 9 s the right pivots? One band in each
   direction is a guess at the magnitude, not just the direction.
3. Do the detail sentences read true on their water — particularly `rough` and `very_rough`?

If they move the numbers, it is a small edit: three named constants in one file plus the matching
boundary rows in `src/lib/marine-forecast.test.ts`, and any copy change lands in both locales
together. If they confirm them, the win is being able to drop the "unreviewed" caveats from the
comments and say the bands have a captain behind them.

What is **not** proposed: making the bands shop-configurable. Six thresholds per shop is a settings
page nobody will fill in.

## Prompt

```text
A working dive professional has now reviewed (or is about to review) DiveDay's sea-state bands.
Apply their answers.

Context you need before reading anything: these numbers are already shipped and their provenance is
already documented honestly in the code — the comments above SEA_STATE_THRESHOLDS_M,
SHORT_PERIOD_SECONDS and LONG_PERIOD_SECONDS state plainly that they are DiveDay's own working
estimates for a recreational reef/wreck day, reviewed by no captain, and that a dive professional's
read is what would change them. The copy has also been checked for over-claim: no band asserts what
a shop will do (cancel, stay at the dock, delay), only what the water is like. So this task is NOT
"write a caveat" and NOT "soften the copy" — both are done. It is: take a captain's specific
answers and move the numbers, or, if they confirm them, drop the "unreviewed" hedging from those
comments.

Read first:
- docs/product/follow-ups/FU-20260811-sea-state-thresholds-need-a-dive-pro.md (this file — the
  current table and the three questions the captain was asked)
- src/lib/marine-forecast.ts — SEA_STATES, SEA_STATE_THRESHOLDS_M, SHORT_PERIOD_SECONDS,
  LONG_PERIOD_SECONDS, seaStateReading
- src/lib/marine-forecast.test.ts — the boundary cases that pin the current mapping
- src/i18n/locales/en-US/diver.json and es-ES/diver.json — trip.seaState.* and trip.seaStateDetail.*
- src/app/s/[shopSlug]/trips/[id]/_components/ForecastSection.tsx — where it renders

The constraint that makes this non-obvious: significant wave height is the mean of the highest
third of waves, so individual sets run roughly 1.5-2x the number being banded — a threshold that
reads right against "the waves I can see" is wrong against this statistic. And the same height
feels different by period, which is what the +/-1-band correction is for; check the magnitude of
that correction, not only its direction.

If you do not have a captain's actual answers in hand, stop and say so rather than guessing — a
second agent-authored estimate is worth nothing here and the current one is already honest about
what it is.

Done means: the thresholds and the six message pairs reflect a real dive professional's read (run
it past the dive-domain-expert reviewer agent too), src/lib/marine-forecast.test.ts pins whatever
boundaries result with the reasoning in its comments, both locales moved together, the comments in
marine-forecast.ts describe the numbers' new provenance accurately, and this follow-up file is
deleted. Nothing here may become a gate — the conditions card is a planning outlook and the crew
make the call at the dock; do not wire it into readiness or trip admission.

Checks: pnpm check, plus pnpm test src/lib/marine-forecast --reporter=dot.
```
