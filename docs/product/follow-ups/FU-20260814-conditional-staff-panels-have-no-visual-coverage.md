# FU-20260814-conditional-staff-panels-have-no-visual-coverage — Decide how a panel the demo shop can never reach gets looked at

- **Status:** Open
- **Raised:** 2026-08-14 — branch `claude/decision-workflow-options-2n06b1`, adding the owed-refund
  panel and the review-suppression warning, neither of which any capture can reach.
- **Kind:** question
- **Effort:** M
- **Touches:** `e2e/visual.spec.ts`, `src/db/seed-front-desk.ts`, `src/db/seed.ts`,
  `scripts/route-coverage.json`, `docs/product/follow-ups/` (this file)

## What I noticed

There is a growing class of staff surface that **no screenshot in this repo has ever photographed**,
and it is the class most likely to render badly, because it only appears when something has gone
wrong.

Four of them now, that I can find:

- **Stuck payment operations** — a `danger` panel on the Orders index. `seed-front-desk.ts` seeds a
  payment operation intent with `status: "succeeded"` on purpose, so the panel never renders.
- **Stuck media deletions / owed processor erasures** — panels leading Settings' "Data &
  integrations" group. `seed-demo-lifecycle.ts` only ever deletes those rows.
- **Owed refunds** — the panel added on this branch. The demo shop has no cancelled departure
  carrying paid seats.
- **The review-suppression warning** — added on this branch too. The demo shop has 83 published
  reviews and no hidden ones; it would need 21 hides to cross the line, which no spec is going to do.

And the reason for at least the first one is *deliberate and good*, written down in
`seed-front-desk.ts`: a seeded failure "would put a permanent red row on the dashboard that no amount
of retrying clears, since there is no provider behind it to succeed on the second attempt." A demo
shop permanently shouting that four payments are broken is a worse demo.

So the convention is real, it is defensible, and it is nowhere stated — it lives as one comment on
one seed file. Meanwhile AGENTS.md's hard rule says every important surface a user looks at gets a
screenshot assertion, and four surfaces quietly do not. A reviewer reading either the rule or the
seed comment alone would draw the opposite conclusion from the other.

The concrete failure this permits: any of these panels can be shipped with broken layout, an
untranslated string, or unreadable contrast in dark mode, and nothing in CI would notice. They are
warning-toned blocks of dense text with inline links — exactly the shape that breaks — and they are
what a shop sees on its worst day.

## Why it isn't already done

It is a real question with two defensible answers and I did not want to answer it by inventing a
convention on a branch about something else.

**Option A — a second demo shop for the sad path.** A `blue-mantis-trouble` (or similar) seeded with
every one of these states, captured once per surface. Honest, cheap to extend when the next such
panel appears, and it leaves the real demo pristine. The cost is a second shop in every listing that
enumerates shops, plus seed maintenance.

**Option B — capture these panels through the test API rather than the seed.** `e2e/` already has
guarded `/api/test/*` routes (`check:e2e-fixtures` counts five). A route that puts the *current*
shop into one of these states for the duration of one spec, captured, then reverted, keeps the demo
clean and the coverage real. Cost is a test-only mutation surface per state, which is more machinery
per panel than A.

**Option C — state the exemption and stop pretending.** Extend `scripts/route-coverage.json`'s
`exempt` idea down to the panel level: a registry of "surfaces deliberately outside visual coverage,
and why", so the gap is a decision rather than an oversight. Cheapest, and it fixes the documentation
problem without fixing the coverage one.

**Recommendation: B, falling back to C for anything B cannot reach.** The states are all one row in
one table away, the fixture routes already exist as a pattern, and it keeps the demo shop honest —
which is the property `seed-front-desk.ts`'s comment was protecting in the first place. A is a lot of
seed surface to maintain for four panels.

## Proposed change

Whichever option is chosen, two things should be true at the end:

1. The four panels above have either a capture or a written exemption, in one place a reviewer can
   read.
2. The rule is stated where somebody adding the *fifth* such panel will meet it — a line in
   AGENTS.md's hard rules or in the **e2e-and-visual** skill, pointing at wherever the answer lives.

Do **not** solve this by seeding the failure states into the canonical demo shop. That reverses a
deliberate decision, and `seed-front-desk.ts` explains why it was made.

## Prompt

```text
Decide how DiveDay gets eyes on staff panels that only render when something has gone wrong, then
implement the answer.

Read first:
  - docs/product/follow-ups/FU-20260814-conditional-staff-panels-have-no-visual-coverage.md (this
    file — its "Why it isn't already done" section states the three options and a recommendation)
  - src/db/seed-front-desk.ts — the comment explaining why a stuck payment operation is seeded as
    `succeeded`, which is the decision this must not reverse
  - the four panels: src/app/shop/[shopSlug]/orders/page.tsx (stuck operations, owed refunds),
    src/app/shop/[shopSlug]/settings/SettingsPage.tsx (media deletions, processor erasures),
    src/app/shop/[shopSlug]/reviews/page.tsx (the rating-withheld banner)
  - e2e/visual.spec.ts and the guarded /api/test routes under src/app/api/test/
  - the e2e-and-visual skill

The constraint: do not seed these failure states into the canonical demo shop. A demo that
permanently shows four broken payments is a worse demo, and that call is already written down.

Done means: each of those four panels has either a visual capture or a written exemption in one
place a reviewer can find, and the rule is stated somewhere an agent adding the fifth such panel will
actually meet it (AGENTS.md's hard rules or the e2e-and-visual skill).

Run pnpm check and the visual spec for whatever surfaces you touched.

Delete docs/product/follow-ups/FU-20260814-conditional-staff-panels-have-no-visual-coverage.md as
part of the change.
```
