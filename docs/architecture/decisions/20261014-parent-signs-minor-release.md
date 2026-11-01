# 20261014-parent-signs-minor-release — A parent signs a child's release from the parent's own link

- **Status:** Accepted
- **Date:** 2026-10-14
- **Extends:** [20260907-guardian-co-signature](20260907-guardian-co-signature.md),
  [20260804-seat-claim-links](20260804-seat-claim-links.md); decision H-20261014-parent-signs-minor-release

## Context

A parent books a child "Under 18" (H-20261013-under-18-on-party), often with no email of the child's own. Nothing reached
anyone for that seat. The claim page asked the child for an email, a parent claiming with their own
address was refused, and the release was signed at the counter on dive morning (fourth UX review,
item 1).

## Decision

**The lead may open the release of an unclaimed seat they booked as "Under 18" and sign it, on their
own device, as the child's parent or guardian.**

1. **The door is the party panel on the lead's `/ready`**: "Sign {name}'s waiver", with one
   sentence saying they sign with the child. The confirmation's panel has none.
2. **The authority is the lead's verified `readiness` capability.** The form posts a seat id only.
   `openMinorSeatWaiver` (`src/db/seat-claims.ts`) re-reads that the seat is:
   - in this lead's party and shop, and not cancelled
   - unclaimed, declared a minor, and not held (#2125)
   - a person this booking made (`people.created_by_booking_id`, #2665): no email (or the lead's),
     no other booking, no release elsewhere. The record decides: a merge can point the seat at a known walk-in
   - neither the seat's person nor the lead removed or erased
   - one the page will ask a guardian for (a date of birth saying adult refuses)
   - still claimable
   - owing a release by readiness's rule (`waiver_not_sent`, `waiver_pending`, `waiver_expired`,
     `guardian_signature_missing`)

   Anything else gets one answer. The panel draws the button by the same predicates.
3. **The waiver token is minted on the tap**, never printed into the lead's page. It is the seat's
   booking-scoped `/waivers/[token]`, reused while live (20260820-waiver-links-are-reused-not-reissued).
4. **The release is the child's; the guardian card is the parent's.** The declared minor makes the
   page ask for both signatures (20260907, decision 1). Nothing new is stored, and the seal and
   `guardian_signature_missing` are unchanged.
5. **The seat stays the lead's.** A later claim supersedes a release that is not the claimant's,
   as every claim does.
6. **A minor seat's claim page says a parent or guardian signs with them**, and that the booker can
   sign from their own page only where that door exists. Where it refuses, the lead's panel says to
   send the seat its link; after a medical referral, that a physician's sign-off is needed. The claim refusal stays the neutral `unable` (H-20260724-minimum-age-gate-fail, #2288).

## Consequences

- A signature on another person's legal document is reachable from a bearer link. It is bounded:
  the booker's own link, only to seats they typed and declared minors, and only while unclaimed.
  Typed consent as the assurance level is still H-20260724-current-typed-name-explicit's question.
- A family's child release can be finished before the dock.

## Alternatives considered

- **Only through the child's claim link.** Needs a child's email and a second device.
- **Counter only.** What happened before, on dive morning.
