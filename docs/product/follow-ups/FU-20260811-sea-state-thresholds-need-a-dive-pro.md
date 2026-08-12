# FU-20260811-sea-state-thresholds-need-a-dive-pro — Have a working captain check the numbers behind the sea-state reading

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/trip-pages-ui-cleanup-44l54k`, which replaced the raw
  marine-model output on the diver-facing trip page with a plain-language reading
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/marine-forecast.ts`, `src/i18n/locales/en-US/diver.json`,
  `src/i18n/locales/es-ES/diver.json`

## What I noticed

The diver-facing conditions card used to print the marine model's own output —
"0.6 m seas from SE · 5 s period". That is three correct numbers and close to no help to the
person deciding whether to take a seasickness tablet, so it now prints a reading instead: a band
("Light chop") plus what that band means for the day ("Small waves — most divers stop noticing
them once they're under").

The mapping is `seaStateReading` in `src/lib/marine-forecast.ts`. It bands on significant wave
height:

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

**I made those numbers up.** They are reasoned — they deliberately split 0.2–1.5 m finely, because
that is the range where a Keys morning goes from pleasant to a boat full of sick divers, and they
collapse everything above 2.5 m because no recreational trip sails in it — but they are not
sourced from anything, and I am not a captain. The Douglas and WMO sea-state scales exist and were
rejected for being coarse exactly where a dive day is decided (WMO "slight" spans 0.5–1.25 m,
which is the whole interesting range) and for running to states no reef boat sees.

The words matter as much as the thresholds. "The kind of sea that often keeps boats at the dock"
at ≥ 2.5 m is a claim about how shops actually operate, and if that is wrong for, say, a
liveaboard or a cold-water shop with a bigger boat, the card is telling their divers the trip is
in doubt when it isn't.

## Why it isn't already done

It needs a judgement I can't make and a test I can't run: whether a working dive professional
reading these six bands against their own water agrees that the boundaries fall in the right
places, and whether the sentences are right for more than a Florida reef boat. `AGENTS.md` routes
dive-domain judgement to a `dive-domain-expert` review, and the numbers should have one before
they harden into something shops plan around. Nothing here gates anything — the card says the crew
makes the final call at the dock, and no readiness or admission decision reads it — so this is a
credibility question rather than a safety one, which is why it shipped rather than blocked.

## Proposed change

Take the table above (and the six `trip.seaState*` message pairs) to a dive professional and ask
three questions:

1. Are the six boundaries in the right places for a recreational reef/wreck boat day?
2. Is the period correction the right size, and are 5 s / 9 s the right pivots? One band in each
   direction is a guess at the magnitude, not just the direction.
3. Do the detail sentences over- or under-claim — particularly `rough` ("getting in and out takes
   more care") and `very_rough` ("often keeps boats at the dock")?

Then move the numbers if they are wrong. `SEA_STATE_THRESHOLDS_M`, `SHORT_PERIOD_SECONDS`, and
`LONG_PERIOD_SECONDS` are three named constants in one file, and `src/lib/marine-forecast.test.ts`
pins the boundaries — so a correction is an edit to the table plus the matching test rows.

What I am **not** proposing: making the bands shop-configurable. Six thresholds per shop is a
settings page nobody will fill in, and the difference between a Keys boat and a Monterey boat is
better handled by getting the general case right than by asking every shop to calibrate a wave
scale.

## Prompt

```text
Sanity-check and, if needed, correct the sea-state thresholds DiveDay uses to turn Open-Meteo's
marine forecast into plain language on the diver-facing trip page.

Read first:
- docs/product/follow-ups/FU-20260811-sea-state-thresholds-need-a-dive-pro.md (this file — it has
  the current table and the three questions to answer)
- src/lib/marine-forecast.ts — `SEA_STATES`, `SEA_STATE_THRESHOLDS_M`, `SHORT_PERIOD_SECONDS`,
  `LONG_PERIOD_SECONDS`, `seaStateReading`
- src/lib/marine-forecast.test.ts — the boundary cases that pin the current mapping
- src/i18n/locales/en-US/diver.json and es-ES/diver.json — `trip.seaState.*` and
  `trip.seaStateDetail.*`
- src/app/s/[shopSlug]/trips/[id]/_components/ForecastSection.tsx — where it renders

The constraint that makes this non-obvious: significant wave height is the mean of the highest
third of waves, so individual sets run roughly 1.5–2x the number being banded — a threshold that
reads right against "the waves I can see" is wrong against this statistic. And the same height
feels different by period, which is what the ±1-band correction is for; check the magnitude of
that correction, not only its direction.

Done means: the thresholds and the six message pairs reflect a dive professional's read (use the
dive-domain-expert reviewer agent), src/lib/marine-forecast.test.ts pins the new boundaries with
the reasoning in its comments, both locales are updated together, and this follow-up file is
deleted. Nothing here may become a gate — the conditions card is a planning outlook and the crew
make the call at the dock; do not wire it into readiness or trip admission.

Checks: pnpm check, plus pnpm test src/lib/marine-forecast --reporter=dot and
pnpm test src/i18n/unit-labels --reporter=dot.
```
