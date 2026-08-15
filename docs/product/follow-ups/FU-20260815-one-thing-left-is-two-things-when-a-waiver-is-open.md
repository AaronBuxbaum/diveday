# FU-20260815-one-thing-left-is-two-things-when-a-waiver-is-open — Stop the payment panel claiming exclusivity when the diver still owes a waiver

- **Status:** Open
- **Raised:** 2026-08-15 — the `SectionCard` migration of the diver-facing and bearer-token pages
  (branch `follow-ups/round-two`, cluster 4 of
  FU-20260815-section-card-migration-beyond-settings), via a `dive-domain-expert` review of that
  diff. The copy predates the refactor; the refactor put the two panels it concerns into matching
  cards, which is what made the contradiction legible.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`,
  `src/app/s/[shopSlug]/trips/[id]/_components/BookingConfirmation.tsx`

## What I noticed

On the booking confirmation (`/s/<slug>/trips/<id>` once `confirm` resolves), an unpaid diver who
also owes a waiver sees two panels, stacked, in this order:

1. **"One thing left: payment"** (`booking.paymentOneThingLeft`)
2. **"Next: sign your waiver"** (`booking.nextStep`, resolved from the readiness checklist)

The first sentence is false whenever the second panel renders anything. And the pair it is wrong
about is the most common diver-side failure a dock actually sees: a paid diver with no signed
waiver, turning up at 6:45 AM to be told they cannot board.

The panels' *buttons* are already correct — `paymentHoldsThePrimary` in `BookingConfirmation.tsx`
demotes the waiver button to secondary while a Stripe session is open, on the sound reasoning that
the session is the thing that expires. This is only about the two headings. A diver who reads "one
thing left", pays, and closes the tab has been told they are finished.

## Why it isn't already done

It is a copy change across two locales on a post-purchase surface, which is a wording call rather
than a refactor — and the obvious mechanical fix (make the heading conditional on how many
checklist items are open) needs someone to decide what the alternative sentence *is*, in a
register that does not turn a confirmation into a list of chores.

There is also a real question underneath it about which of the two panels should exist at all in
that state, which is why this is not simply "change a string": the readiness checklist below
already enumerates everything outstanding, including the payment. The payment panel may be the
duplicate rather than the waiver panel being the omission.

## Proposed change

Make `booking.paymentOneThingLeft` stop asserting exclusivity — either by rewording it so it names
the payment without counting what is left ("Finish paying for your seat"), or by branching the
heading on whether the diver's checklist holds anything besides the payment. Both locales in the
same change.

Prefer the reword. The branch costs a second key in both locales and a condition in
`BookingConfirmation.tsx`, and it only pays for itself if someone has decided the count is worth
stating at all — which the panel below already does, item by item.

Do **not** solve it by dropping the waiver panel or by re-raising the payment button to primary in
both cases: the button weighting is right and was reasoned out (a Stripe session expires; a waiver
link does not, and `/waivers/[token]` can be reissued). Do not solve it with elevation either —
these are two things a diver must do, and both are cards on purpose.

## Prompt

```text
On DiveDay's booking confirmation, the payment panel is headed "One thing left: payment"
(booking.paymentOneThingLeft in src/i18n/locales/*/diver.json) even when the panel directly
beneath it says the diver still has to sign a waiver. A diver who reads it, pays, and closes the
tab has been told they are done, and they are not — an unsigned waiver stops them boarding.

Read first: src/app/s/[shopSlug]/trips/[id]/_components/BookingConfirmation.tsx (the
PaymentSection component and the next-step SectionCard under it — note `paymentHoldsThePrimary`,
whose button weighting is correct and must not change), the `booking.payment*` and
`booking.nextStep` keys in src/i18n/locales/en-US/diver.json, and
src/i18n/locales/es-ES/README.md before writing any Spanish.

Reword the payment heading so it names the payment without claiming it is the only thing
outstanding. A conditional second key is acceptable if you can justify it, but the checklist panel
below already enumerates every open item, so a plain reword is likely the right answer. Both
locales in the same change or pnpm check:locale fails.

Do NOT remove either panel and do NOT change which button is primary.

Done when: no heading on that page counts what is left unless it counts correctly; `pnpm check` is
green; `pnpm test src/app/s --reporter=dot` passes; and `pnpm e2e e2e/booking.spec.ts
--reporter=line` still passes. Delete
docs/product/follow-ups/FU-20260815-one-thing-left-is-two-things-when-a-waiver-is-open.md as part
of the change.
```
