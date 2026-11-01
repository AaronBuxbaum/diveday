# H-20261005-one-interest-table-names: What is the interest table called, which mail class does an offer take, and where does the discount live?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Issue #2656 (option 4, chosen 2026-10-17) merges the wait list, invitations, the last-minute list and date requests into one table. Three calls inside it were Aaron's; the build shipped a default for each so the stack was not blocked.**

- **D-1, the name.** The build's default, `leads`, collides with the *party lead* of a booking (`bookings.party_lead_booking_id`). The roadmap's word was Interest (`interests`).
- **D-2, the mail class of an offer.** A wait-list invite was commercial even though the diver asked, and a reply to a date request was service mail (H-20261006-staff-trip-invitation-service). (a) keep those answers by mapping them; (b) unify on H-20261006-staff-trip-invitation-service's own test, "did the diver ask for this?", which makes a diver-asked wait-list invite service mail and so reaches people who turned off courtesy email.
- **D-3, the deal sender.** Aaron moved it to the Details tab on 2026-10-05. One act needs one door: the default put the discount on the Divers tab's Who wants in panel, with Details keeping the history of deals sent.

## Decision

**Decided 2026-10-17 (Aaron Buxbaum, on issue #2656):**

- **D-1: Interest.** The table is `interests`, and the code, file names and glossary say Interest; staff still see **Who wants in**, never the word.
- **D-2: option (b).** A seat offered on the departure the diver joined the wait list for, or the reply to their own date request, is service mail; everything the shop chose (a cold invitation, a carried or rolled row, the last-minute list, any offer carrying a deal) is commercial. `offerMailClass` in `src/lib/interests.ts`; ADR [20260902-sender-standards-for-ses](../../architecture/decisions/20260902-sender-standards-for-ses.md) is amended.
- **D-3: the Divers tab.** The discount is sent from Who wants in; Details keeps only the history.

The backup export's interest files are one `interests.csv` with a `scope` column. ADR: [20261017-one-interest-with-a-scope](../../architecture/decisions/20261017-one-interest-with-a-scope.md).

## Unblocks / follow-up

#2656. H-20261006-staff-trip-invitation-service (mail class), H-20260815-no-legacy (no backfill).
