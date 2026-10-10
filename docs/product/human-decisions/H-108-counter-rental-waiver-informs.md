# H-108: How does a counter rental check the person's waiver?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Does a counter rental check the person's signed waiver, and does it block on it?** A counter rental lends gear to a person with no booking (ADR 20260815-minimal-gear-register, amendment 2026-10-08), and the counter did not read whether they had signed anything: a walk-in who never booked a boat could leave with a regulator and a tank after a verified card, with no release on file. The ADR and the glossary named it a known gap (issue #2261). Waiver policy and wording are human-owned (H-01, H-03). The options were (a) require a current person-level signature before life support leaves the counter, (b) say "Waiver not signed" on the ticket and offer the waiver link, informing only, or (c) leave it to the shop's paper process and say so on the ticket.

## Minimum outcome to record

Which option; whether a rental ever waits on the waiver; where the state is said.

## Outcome

**Decided 2026-10-09 (Aaron Buxbaum, in the project thread on issue #2261): option (b).** A counter rental never blocks on a waiver. The rental ticket and the Rentals list say where the person stands with the shop's release when they hold no current signature, and the ticket offers the person's existing waiver link to send.

- The release is the person's: signed once, on any booking or on a link sent from their record, and read through the same `shopWaiverStatus` the diver record uses (`counterRentalWaiverStandings`, `src/db/gear-counter-rentals.ts`). No fake booking, no second waiver; CR-015 is unchanged.
- The word is the release's own (`waiverRowStateText`): "Waiver: Not signed", "Waiver: Needs signing again", and so on, so one standing never reads two ways on two screens. A current signature says nothing.
- The ticket offers "Send waiver" (the shared person-scoped send, `WaiverSendControl`) when another link is the fix: never signed, lapsed, or a minor's solo signature. A medical hold or a refusal is said, with no link, because the review is the fix (`counterRentalWaiverFlag`, `src/lib/counter-rentals.ts`).
- Screen only: the slip the person carries away stays a receipt for gear.
- Nothing in `createCounterRental` reads it. The life-support gate stays the verified card.

Recorded as a change to the 2026-10-08 amendment of [20260815-minimal-gear-register](../../architecture/decisions/20260815-minimal-gear-register.md) and to the glossary's "Counter rental" entry, neither of which calls it a known gap any more.

## Unblocks / follow-up

Closes #2261. Gating life support on a current signature, option (a), would be a new decision.

Part of the [human decision log](README.md#decision-register).
