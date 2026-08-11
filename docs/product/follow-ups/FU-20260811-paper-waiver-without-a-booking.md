# FU-20260811-paper-waiver-without-a-booking — Decide whether a shop can record a signed release for a diver who has nothing booked

- **Status:** Open
- **Raised:** 2026-08-11 — branch `claude/diver-page-ui-refinements-rn50sm`, which added "Mark signed on paper" to the diver record
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/waivers.ts`, `src/app/shop/[shopSlug]/divers/[personId]/_components/PaperWaiver.tsx`, `src/app/shop/[shopSlug]/divers/[personId]/_components/shared.ts`, `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`

## What I noticed

The diver record now carries "Mark signed on paper", under the Waiver stat card, for a diver whose
release is missing or lapsed. It renders **only when that diver has a still-scheduled departure
ahead of them** (`paperWaiverBookingId`, `_components/shared.ts`). A diver with nothing on the board
— someone who walked into the shop in March to hand over their paperwork for a trip they have not
booked yet, or a returning customer whose last boat sailed in October — sees the Waiver card say
"Not signed" and no way to do anything about it from this page.

The reason is the write path, not the model. `shopWaiverStatus` already treats a signature as a fact
about a person and a shop: one current record clears every booking the diver holds here. But
`recordInPersonWaiver` (`src/db/waivers.ts`) takes a `bookingId`, looks the booking up, and refuses
if its trip is not `scheduled` — so there has to be a seat to file against, and the diver record
picks the soonest one.

## Why it isn't already done

Two reasons, and the first is the real one.

`waiver_records.bookingId` is already nullable, but the only writer that leaves it null today is the
contact importer (`src/db/import.ts`), whose records are marked `signatureMethod: "imported"` and
are deliberately *weaker* evidence — they are not staff attestations. Making
`recordInPersonWaiver` accept a booking-less, person-only attestation means deciding what that
record means for readiness, for the signature audit at `/shop/[slug]/waivers/signatures`, and for
the incident export — none of which is a call an agent should make unreviewed on the surface that
gates who boards a boat. It wants a `dive-domain-expert` and a `security-reviewer` pass.

Second, it may simply not be worth it. The paper a diver hands over is usually *for* a trip, and the
two older doors onto this control (the trip roster and the check-in queue) are both departure-shaped
for that reason. This might be a case where the honest answer is "you book them first", and the fix
is a sentence rather than a schema behaviour.

## Proposed change

Pick one of three, in preference order:

1. **Say so.** Leave the write path alone and have `PaperWaiver` render, for a diver with no
   upcoming seat and an outstanding release, one muted line naming what is missing and linking to
   the "Book an activity" section already on the page. Smallest change, no new evidence shape,
   and it turns a silent absence into an explanation. This is my recommendation unless a shop
   says otherwise.
2. **Allow it, narrowly.** Give `recordInPersonWaiver` an input union — `{bookingId}` or
   `{personId}` — and let the person-only branch write the same `in_person_attested` record with a
   null `bookingId`. Then check every reader of `waiver_records.bookingId` (`effectiveWaiverForBooking`
   in `src/lib/waivers.ts`, the signature audit, `src/lib/waiver-integrity.ts`, the incident export)
   for a null it has never seen.
3. **Do nothing.** Close this entry if the shops in the pilot never ask for it.

Not proposed: having the diver record create a placeholder booking to hang the waiver on. That
invents a seat on a boat, which is the one thing a manifest must never contain.

## Prompt

```text
Read docs/product/follow-ups/FU-20260811-paper-waiver-without-a-booking.md, then
src/db/waivers.ts (recordInPersonWaiver and its callers), src/lib/waivers.ts
(shopWaiverStatus, effectiveWaiverForBooking), and
src/app/shop/[shopSlug]/divers/[personId]/_components/PaperWaiver.tsx.

Decide and implement option 1, 2, or 3 from that document. The constraint that makes this
non-obvious: a signed release is already a person-and-shop fact for *reading* purposes, but every
staff-attested record ever written is anchored to one real booking, and several readers assume that
anchor. Option 2 is only correct if you check every one of them for a null bookingId.

Done means: a diver with no upcoming departure and an outstanding release either gets a working
control or gets an explanation on the page, with a test for whichever you chose. If you take option
2, launch dive-domain-expert and security-reviewer subagents on the diff before finishing.

Run `pnpm check`, and `pnpm e2e e2e/waivers.spec.ts --reporter=line` since a waiver flow changed.
Delete docs/product/follow-ups/FU-20260811-paper-waiver-without-a-booking.md as part of the change.
```
