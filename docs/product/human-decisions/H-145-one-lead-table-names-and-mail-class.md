# H-145: What is the lead table called, which mail class does an offer take, and where does the discount live?

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

**Issue #2656 (option 4, chosen 2026-10-17) merges the wait list, invitations, the last-minute list and date requests into one `leads` table. Three calls inside it are Aaron's, and the build ships a default for each so the stack is not blocked.**

- **D-1, the name.** `leads` collides with the *party lead* of a booking (`bookings.party_lead_booking_id`). The roadmap's word was Interest (`interests`). **Built as `leads`**; the glossary keeps the two apart and staff never see the word. Renaming later is one migration.
- **D-2, the mail class of an offer.** Today a wait-list invite is commercial even though the diver asked, and a reply to a date request is service mail (H-96). (a) keep today's three answers by mapping them; (b) unify on H-96's own test, "did the diver ask for this?", which makes a diver-asked wait-list invite service mail and so reaches people who turned off courtesy email. **Built as (a)**, `offerMailClass` in `src/lib/leads.ts`. (b) is the plan's recommendation and amends ADR 20260902-sender-standards-for-ses; it is a one-function change.
- **D-3, the deal sender.** Aaron moved it to the Details tab on 2026-10-05. One act needs one door, so **built with the discount on the Divers tab's Who wants in panel**, and Details keeps the history of deals sent.

## Decision

Open. Layer notes: the ADR is [20261017-one-lead-with-a-scope](../../architecture/decisions/20261017-one-lead-with-a-scope.md).

## Unblocks / follow-up

#2656. H-96 (mail class), H-49 (no backfill).
