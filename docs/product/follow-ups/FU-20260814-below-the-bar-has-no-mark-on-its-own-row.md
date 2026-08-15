# FU-20260814-below-the-bar-has-no-mark-on-its-own-row — Decide whether a recipient row that ranks below the departure's requirement should say so on the row

- **Status:** Open
- **Raised:** 2026-08-14 — making the last-minute-deal recipient list readable at the moment of the
  send (the `dive-domain-expert` finding about `LastMinuteDealSection.tsx`). The four things that
  review asked for are done; this is a fifth thing the finished screen made visible.
- **Kind:** question
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/_components/LastMinuteDealSection.tsx`,
  `src/i18n/readiness-labels.ts`, `src/i18n/locales/en-US/staff/trips.json`,
  `src/i18n/locales/es-ES/staff/trips.json`

## What I noticed

On the new phone-width capture `trip-guests-deal-below-requirement`, the reef charter requires
Advanced Open Water and the list reads:

| row | right-hand phrase | tone |
| --- | --- | --- |
| Ravi Menon | Open Water | muted |
| Tess Alvarez | Open Water — diver's word, no card | warning |
| Wes Toledo | Level not said | muted |

Ravi is **below the departure's bar** — he holds a verified Open Water card on a trip that asks for
Advanced Open Water — and his row is the calmest thing on the screen. Tess, who is below the bar by
exactly the same rung, is warning-toned, but only because her level is unverified. So the colour on
these rows answers "has anybody seen a card?" and says nothing at all about "can this person board
this boat?", while the two questions look identical to someone scanning quickly.

Nothing is wrong today: the ordering lifts both of them to the top, and the summary line underneath
counts them ("2 of 3 said a level below this departure's requirement"). A staffer who reads the
sentence gets the right answer. A staffer who only scans the colours gets "one of these three is
iffy", which is not the same list.

## Why it isn't already done

The row's tone is load-bearing and was argued carefully. ADR 20260814-self-declared-cards spends a
paragraph on it: the warning tone exists so a claim is *never* scanned as an ordinary card, and it
cites the imported-specialty precedent ("certified · confirm to clear") as the shape to match.
Adding a second reason for a row to be warning-toned makes that mark ambiguous — a warm row would
then mean "unverified, or under-certified, or both", which is exactly the collapse the ADR was
avoiding. Reaching for a third tone instead invites the "colour carries the meaning" failure that
design/principles.md #6 forbids.

It is therefore a design call about one visual vocabulary, not a defect, and it sits close enough to
an accepted ADR that it should be made deliberately rather than in passing.

## Proposed change

Under "yes, mark it": add a short **word** to the row rather than a tone — the level phrase becomes
something like "Open Water · below this trip's bar", built in `declaredDiveProfileText`'s neighbour
in `src/i18n/readiness-labels.ts` (a new function; do not widen `declaredDiveProfileText`, which the
wait-list rows share and where there is no trip and so no bar). The comparison is already computed:
`reviewLastMinuteRecipients` in `src/lib/last-minute-list.ts` knows which recipients are below, and
would return the flag per row instead of only counting them. Both locales, and the visual capture
above re-shot.

Under "no, leave it": say so in ADR 20260814-self-declared-cards, so the next reviewer reading that
screen does not re-raise it — the reasoning being that the ordering plus the summary sentence carry
"below the bar", and the row's one mark stays reserved for "nobody has seen this".

**Not** proposed: filtering, disabling the send, or removing anyone from the list. Nothing about
this blast gates, and that is decision 4 of the ADR.

## Prompt

```text
Decide whether the last-minute-deal recipient rows should say on the row itself that a diver ranks
below the departure's certification requirement, and implement the decision.

Read first, in this order:
  - docs/product/follow-ups/FU-20260814-below-the-bar-has-no-mark-on-its-own-row.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — especially the paragraph arguing
    why a claim renders warning-toned as "diver's word, no card"; that tone is the thing at risk
  - src/app/shop/[shopSlug]/trips/[id]/_components/LastMinuteDealSection.tsx and its test
  - src/lib/last-minute-list.ts (`reviewLastMinuteRecipients` already computes who is below)
  - src/i18n/readiness-labels.ts (`declaredDiveProfileText`, shared with the wait-list rows)

Look at e2e/screenshots/trip-guests-deal-below-requirement-light-vw-390.png first if it exists, or
regenerate it: pnpm e2e:build then
pnpm e2e:run e2e/visual.spec.ts --reporter=line --grep "the deal panel weighs the list against the bar"
The finding is only visible as a picture — a verified Open Water diver on an Advanced Open Water
departure sits in calm muted text while an unverified Open Water diver beside him is warm.

Constraints that make this non-obvious:
  - The warning tone on a row currently means exactly one thing ("nobody has seen this card"), and
    the ADR argues for that meaning. Do not overload it. Colour must never be the only carrier of
    meaning (docs/design/principles.md #6), so if you mark it, mark it in words.
  - `declaredDiveProfileText` is shared with the wait-list rows, where there is no trip and so no
    bar to be below. Do not give it a trip-shaped parameter; write a sibling.
  - Every string goes in src/i18n/locales/<locale>/staff/, both en-US and es-ES, in the same change
    (pnpm check:locale). Read src/i18n/locales/es-ES/README.md before writing Spanish.
  - Nothing here may filter, reorder the mail, or disable the send button. Informing is the design.

Done when: either the row states it and there are unit tests for the new phrase plus a re-shot
visual capture, or ADR 20260814-self-declared-cards records the decision not to and why; pnpm check
is green either way; and docs/product/follow-ups/FU-20260814-below-the-bar-has-no-mark-on-its-own-row.md
is deleted as part of the change.
```
