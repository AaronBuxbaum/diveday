# H-61: Is a bigger party the right answer for a group, or is a group…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

**Is a bigger party the right answer for a group, or is a group its own concept?** The public booking form capped a party at six with nothing written down saying why (issue #725); it is now 20, set from a measurement of what `createBookingParty`'s atomic transaction costs against real Postgres (6 seats 102ms / 12 seats 154ms / 20 seats 303ms — per-seat cost flat, so the work is linear and twenty holds the trip row for about a third of a second). Twenty because it is the largest size measured, not because twenty is a meaningful group size. That clears a dive club of nine, a family of eight and most course cohorts, and it is deliberately still a bound — a field that lets somebody type 200 into a capacity transaction is a denial of service on a shop's Saturday. What it does **not** answer is what a group *is*. Three shapes: **(a)** just a bigger party — one payer for everyone, which for a club is usually wrong, because clubs split; **(b)** a group spanning bookings, one organiser and several payers — seat claims already do most of this (ADR [20260804-seat-claim-links](../../architecture/decisions/20260804-seat-claim-links.md)) and the brainstorm's "Group organizer surface" names pay-your-own-share as the remaining half, waiting on the credit ledger; **(c)** a buyout — the unscheduled "Private / buyout charters" entry, blocked on the boat-resource model. Nine divers on a twelve-seat boat is (a) or (b), never (c).

## Minimum outcome to record

Which shape a group takes, so the choice is made once rather than drifted into.

## Unblocks / follow-up

Nothing is blocked: (a) has shipped as far as it goes. (b) is the real feature and should not start without this answer — it decides whether a group is a column on `bookings` or a table of its own.

Part of the [human decision log](README.md#decision-register).
