# FU-20260815-the-gear-light-promises-a-reservation-diveday-never-made — Reword the rental-fit indicator so it states what is recorded, not what is packed

- **Status:** Open
- **Raised:** 2026-08-15 — the `SectionCard` migration of the diver-facing and bearer-token pages
  (branch `follow-ups/round-two`, cluster 4 of
  FU-20260815-section-card-migration-beyond-settings). A `dive-domain-expert` review of that diff
  found the copy; the refactor did not write it, but it did briefly raise the panel carrying it
  onto the app's canonical raised card, which is what made it visible.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`,
  `src/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm.tsx`, `docs/product/glossary.md`

## What I noticed

The rental-fit form's status indicator tells a diver their gear is set aside for them. Two keys,
both under `rental` in `diver.json`:

```
"matched": "Gear matched and pre-packed.",
"sizesLocked": "The crew has your sizes locked in and ready.",
```

The glossary says the opposite, in as many words: a rental fit *"is a storage concept: DiveDay
tracks no equipment inventory, so a fit never reserves an item, is never evidence, and never
replaces a dock-side fit check."* Nothing in `src/db` reserves a wetsuit, a BCD or a set of fins;
saving a fit writes sizes onto the booking and nothing else.

The case that goes wrong: a diver picks L wetsuit and M BCD on `/ready` the night before, sees a
green light reading "Gear matched and pre-packed", and arrives at the counter expecting to collect
it. The shop has three L wetsuits and four divers who chose L. The diver meets "Needs staff fit" —
which is exactly the fallback that exists *because* the shop could not fill the size — after having
been told the opposite by the page they read at breakfast.

The same card already says the true thing twice, in its own footer: "We'll confirm at the dock" and
"check the fit with you at the dock". So the indicator contradicts the paragraph beneath it.

## Why it isn't already done

Two reasons, and neither is scope laziness.

It is a **wording** change on a diver-facing safety-adjacent surface, and this repo's rule is that
a sentence lands in every locale in the same change — so it is `en-US` plus `es-ES` (whose register
and terminology are already decided; read `src/i18n/locales/es-ES/README.md` first). That is a
translation call, not a refactor.

And the right replacement wording is a product decision, not an obvious mechanical fix. "Sizes
recorded" is accurate but flat, and the indicator exists to give the diver a small win for
finishing the form. Someone has to decide how to keep the warmth without claiming the reservation.

The migration that raised this took the pressure off in the meantime: `RentalFitForm` now carries
`elevated={false}`, so the panel no longer reads as the peer of `/ready`'s readiness checklist —
where a `medical_review` row (a physician referral, the strongest block the product has) renders as
a muted grey bullet. It is quieter than it was. It still says the wrong thing.

## Proposed change

Reword `rental.matched` and `rental.sizesLocked` (and check their neighbours `rental.ownGear`,
`rental.noCharge`, `rental.addSizes`, `rental.selectSizes` while in there) so the indicator states
what actually happened — the shop has the diver's sizes — and what happens next — the crew confirms
the fit at the dock. Both locales, same change.

Do **not** solve it by hiding the indicator, and do not add an inventory or reservation concept to
make the copy true: that is a much larger product decision and the glossary's position on it is
deliberate. Do not "soften" it with a qualifier appended to the existing sentence either — "Gear
matched and pre-packed (subject to availability)" is a worse lie than the plain one, because it
reads as fine print on a promise rather than as a statement of fact.

While there: `RentalFitForm.tsx`'s `elevated={false}` carries a comment explaining that it is there
because a fit reserves nothing. If the copy stops over-claiming, that reasoning is weaker but not
wrong — the panel is still supporting material beside a readiness checklist — so leave the
elevation alone unless a design review says otherwise.

## Prompt

```text
DiveDay's rental-fit indicator tells a diver their gear is "matched and pre-packed" and that the
crew has their sizes "locked in and ready". Neither is true: docs/product/glossary.md states that
a rental fit reserves nothing, is never evidence, and never replaces the dock-side fit check, and
nothing in src/db reserves an item. A diver reads this on /ready the night before a dive and meets
"Needs staff fit" at the counter.

Read first: the "rental fit" entry in docs/product/glossary.md; the `rental` block of
src/i18n/locales/en-US/diver.json; src/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm.tsx
(the indicator is the `gear-status-indicator` div, and note that the card's own footer already
says the true thing — "We'll confirm at the dock"); and src/i18n/locales/es-ES/README.md before
writing a word of Spanish.

Reword rental.matched and rental.sizesLocked, and audit their neighbours in the same block, so the
indicator states what is recorded and what still happens at the dock. It has to keep being a small
win for finishing the form — this is not a downgrade to a grey "saved" line — it just may not
claim a reservation. Every string lands in BOTH locales in the same change or pnpm check:locale
fails.

Do NOT add inventory or reservation state to make the copy true, and do not append a "subject to
availability" qualifier — fine print on a promise is worse than the plain claim.

Done when: the indicator no longer asserts anything is set aside; `pnpm check` is green;
`pnpm test src/app/s --reporter=dot` passes; and the visual captures that include this panel
(the trip-page confirmation and /ready) are reviewed with the new words. Delete
docs/product/follow-ups/FU-20260815-the-gear-light-promises-a-reservation-diveday-never-made.md
as part of the change.
```
