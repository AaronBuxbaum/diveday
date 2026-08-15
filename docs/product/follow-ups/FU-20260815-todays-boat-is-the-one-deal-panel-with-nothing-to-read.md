# FU-20260815-todays-boat-is-the-one-deal-panel-with-nothing-to-read — Decide whether the demo's headline departure should carry a marked recipient too

- **Status:** Open
- **Raised:** 2026-08-15 — seeding the self-declared marks into blue-mantis
  (`src/db/seed-self-declared.ts`, closing
  FU-20260815-no-seeded-diver-ever-declared-anything).
- **Kind:** question
- **Effort:** S
- **Touches:** `src/db/seed-self-declared.ts`, `e2e/visual.spec.ts`

## What I noticed

The demo shop now seeds two last-minute-list joiners who said something about themselves — Rowan
Feld claiming Open Water and enriched air, Selah Mbeki saying they hold no card at all — so the
warning-toned marks a staffer reads before mailing a discount are finally rendered somewhere real.

Both state a window that starts **tomorrow**. So they appear on the night charter, the Benwood boat,
the Christ of the Abyss morning, and every other departure inside the month — but *not* on
"Two-Tank Reef — Molasses & French", the departure that sails today.

Today's boat is the one a demo visitor actually opens. Today's queue nudges "3 seats open with no
last-minute deal sent yet", its "Open trip" link lands on that departure's `#last-minute-deal`
panel, and what renders there is a single row: Ravi Menon, Open Water, plain muted text. A shop
owner walking the demo along its most obvious path still sees a list with nothing on it worth
pausing over, and has to reach a departure further down the board to see the safeguard at all.

## Why it isn't already done

Deliberately, and it is a trade rather than an oversight. Today's reef departure is the fixture two
visual baselines are pinned to — `trip-guests-deal-recipients` and
`trip-guests-deal-below-requirement` in `e2e/visual.spec.ts`. Both drive the public form themselves
and then wait on an exact sentence; the second waits on the literal string
`"2 of 3 are below this departure's requirement."`. Seeding two more recipients onto that departure
rewrites both baselines and that count (to "4 of 5"), which is somebody else's capture saying the
same thing this one already says everywhere else on the board.

It is also a **product** question rather than a mechanical one, which is why it is a question and
not a cleanup: the demo shop is a sales surface. Two marked rows on a list of ten reads as a real
shop's list. Two marked rows on a list of *three*, on the one departure every visitor opens, reads
closer to "this shop does not know who its divers are" — and `src/db/seed-front-desk.ts` already
makes that argument at the row it deliberately seeds `succeeded`.

## Proposed change

If the answer is "yes, today's boat should carry one too": change `AVAILABLE_FROM_DAYS` in
`src/db/seed-self-declared.ts` from `1` to `0` for **one** of the two joiners (Selah, the "not
certified yet" answer, is the one worth seeing — it is below every bar there is and is lifted above
the cap), leave the other where it is, and update the wait in
`the deal panel weighs the list against the bar` to the new count. Then review both reef baselines
and say in the PR why they moved.

If the answer is "no": nothing to do but delete this file. The marks are seeded, captured
(`trip-guests-deal-seeded`) and covered end to end
(`e2e/last-minute-fill.spec.ts`, "an uncertified joiner reaches the send list, above the ten-name
cap"); this is only about which departure a visitor meets them on first.

**Not** proposed: seeding both joiners onto today's departure (three recipients, two of them
marked, is the alarming-demo shape), or moving the two existing captures onto a different
departure to free today's up — they are the baselines for the form-driven journey and repointing
them trades one blind spot for another.

## Prompt

```text
Decide whether the seeded demo shop's *today* departure should carry a self-declared recipient on
its last-minute-deal panel, and either make it so or delete this entry.

Read first:
  - docs/product/follow-ups/FU-20260815-todays-boat-is-the-one-deal-panel-with-nothing-to-read.md
    (this file)
  - src/db/seed-self-declared.ts, especially the comment on AVAILABLE_FROM_DAYS
  - e2e/visual.spec.ts, the three `deal panel` captures — two drive the public form and one
    photographs the seed
  - src/lib/last-minute-list.ts (reviewLastMinuteRecipients: the cap, and why anyone below the
    requirement is lifted above it)

The question is a product one: the demo is a sales surface, and the difference between "two marked
rows on a list of ten" and "two marked rows on a list of three" is the difference between a
realistic list and a shop that looks like it does not know its divers.

If yes: move ONE joiner's window to start today (Selah Mbeki, the "not certified yet" answer),
leave the other, and update the exact-count wait in `the deal panel weighs the list against the
bar` — it currently waits on "2 of 3 are below this departure's requirement." Then review the reef
baselines that move and say why in the PR.

Done when: pnpm check is green, `pnpm e2e:run e2e/last-minute-fill.spec.ts --reporter=line` and the
three deal-panel captures pass, the visual diffs are explained, and
docs/product/follow-ups/FU-20260815-todays-boat-is-the-one-deal-panel-with-nothing-to-read.md is
deleted as part of the change.
```
