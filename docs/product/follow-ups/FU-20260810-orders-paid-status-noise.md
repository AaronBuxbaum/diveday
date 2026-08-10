# FU-20260810-orders-paid-status-noise — Quiet the Orders list's repeated "Paid" status

- **Status:** Open
- **Raised:** 2026-08-10 — settings design-overhaul session (branch `claude/app-design-overhaul-ku5w1z`); noticed while surveying staff surfaces for the pass
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/orders/page.tsx`, `e2e/visual.spec.ts` (orders capture baselines shift)

## What I noticed

The Orders index renders a STATUS column whose value is the plain word "Paid" on nearly every
row — on the seeded demo shop, roughly 45 of 50 visible rows. The exceptional states (an
"Open — awaiting payment" pill, a "⚠ Refunded" badge) already carry distinct treatments, so the
repeated "Paid" is the expected state formatted as information: principle 9's ""None" is not a
status" case, where an all-clear value repeated down a list is noise pretending to be data. A
staffer scanning for the order that needs them has to read past the word forty times.

## Why it isn't already done

Outside the scope of the settings-hub redesign this session shipped, and the Orders index's
visual baselines and `orders-demo.spec.ts` assertions deserve their own focused change rather
than riding along on an unrelated diff.

## Proposed change

In `src/app/shop/[shopSlug]/orders/page.tsx`, render nothing (an empty cell) for the settled
"Paid" state and keep the pills/badges only for the states that need a staffer — open balances,
refunds, failures. The column header can stay so the exceptional values have a home. Not
proposing a filter or a redesign of the table; this is a one-state demotion.

## Prompt

```text
Read docs/design/principles.md (principle 9, ""None" is not a status") and
src/app/shop/[shopSlug]/orders/page.tsx. On the Orders index, the STATUS column repeats the word
"Paid" on nearly every row while the exceptional states (open balance, refunded) already carry
pills/badges. Change the settled "Paid" state to render an empty cell so only rows needing
attention carry a status marker; keep every exceptional state exactly as it renders today. Check
e2e/orders-demo.spec.ts for assertions on the word "Paid" and update them to assert the absence
on settled rows instead. Run pnpm check and pnpm e2e:run e2e/orders-demo.spec.ts
--reporter=line; expect visual diffs on the orders captures and explain them in the PR. Delete
docs/product/follow-ups/FU-20260810-orders-paid-status-noise.md as part of the change.
```
