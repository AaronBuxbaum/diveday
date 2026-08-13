# FU-20260813-reviews-and-tips-look-unseeded — Find the surface where reviews and tips read as empty

- **Status:** Open
- **Raised:** 2026-08-13 — dive-site configurability branch (`claude/dive-site-config-ui-20u5si`); the
  request listed "we still have some elements that are not actually seeded (eg. reviews, tips)"
- **Kind:** question
- **Effort:** S
- **Touches:** `src/db/seed-history.ts`, `src/app/s/[shopSlug]/page.tsx`,
  `src/app/shop/[shopSlug]/reviews/page.tsx`, `src/app/recap/[token]/page.tsx`

## What I noticed

Both tables **are** seeded, and generously. Counting rows after `seedDemo` on a fresh database:

| Table | Rows |
| --- | --- |
| `trip_reviews` | 84 |
| `tips` | 330 |
| `recap_photos` | 2 |

Both are written by `seed-history.ts` (search `tipRows` and `reviewRows` in that file), and
`seed.test.ts` already asserts the tip rows exist. So the report is real but the diagnosis in it
isn't: something *renders* as empty, and it is not the seed.

The most likely candidate, unverified: **both are attached only to history bookings.** `seedHistory`
walks the trailing quarter of already-sailed trips, and it is deliberately disjoint from today's
board (see the long comment above `historicalDivers` — booking a current customer onto a sailed trip
would sign their waiver and change today's exactly-asserted readiness counts). So a recap opened from
*today's* boat has no review and no tip on it, and any surface scoped to the current week shows
neither. `recap_photos` at 2 is the same shape and much starker.

## Why it isn't already done

I could not reproduce an empty surface, and guessing which one was meant would mean either seeding
rows onto today's departures — which the comment above `historicalDivers` says breaks the readiness
counts three e2e specs assert exactly — or changing a surface's query on a hunch. Both are the kind
of change that wants the actual screen in front of you.

## Proposed change

Ask which screen looked empty, then one of:

- **A recap page.** Seed one review and one paid tip against a booking on a *recent past* trip that
  is still inside whatever window the recap surfaces read, in a new `seed-recap-moments.ts` rather
  than by widening `seedHistory` (ADR 20260803-seed-scenario-modules). Keep it off today's board.
- **The public shop page's review block.** Check `listPublishedShopReviews`'s window and ordering
  against what the seed publishes — two of the seeded written reviews are deliberately left
  unpublished, so a narrow window could leave the block with nothing to show.
- **Reports/analytics.** Check whether the tip figures are scoped to a period the seeded tips fall
  outside of.

Not proposing a second tip/review seeder before that answer: there is no shortage of rows, and adding
more would make the real problem harder to see.

## Prompt

```text
Read src/db/seed-history.ts (the `tipRows` and `reviewRows` blocks near the end) and the comment
above `historicalDivers` explaining why history is disjoint from today's board. Both tables are
seeded — 84 reviews and 330 tips on a fresh `seedDemo` — so this is a rendering or scoping question,
not a missing seeder. Start `pnpm dev` and walk the surfaces that show them: /s/blue-mantis (the
public review block), /shop/blue-mantis/reviews, /shop/blue-mantis/reports, and a /recap/<token>
page for a past booking. Find the one that reads as empty and fix the cause. If the cause is that
nothing recent enough carries a review or a tip, add a new src/db/seed-<scenario>.ts module plus one
line in seed.ts's orchestrator rather than widening seedHistory — and keep it off today's departures,
since seeding a current customer onto a sailed trip signs their waiver and changes the readiness
counts e2e/check-in.spec.ts and e2e/today.spec.ts assert exactly. Done when the surface shows real
rows and `pnpm check` plus the affected e2e spec are green. Delete
docs/product/follow-ups/FU-20260813-reviews-and-tips-look-unseeded.md as part of the change.
```
