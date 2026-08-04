# 20260804-seat-claim-links — Give every party seat a claimable bearer link

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

Group trips are how dive shops fill boats, and in every incumbent the organizer does everyone's
paperwork: they book the party, then relay waivers, contact details, and prep for people the shop
has never met. DiveDay's party booking (`createBookingParty`) already holds the seats atomically
under one purchaser, but the non-organizer seats are just names the organizer typed — no email, no
own waiver, no own prep. This is the first slice of the brainstorm's group-organizer bet
(docs/product/features/brainstorm.md); pay-your-own-share is explicitly out of scope. The
capability-telemetry runbook requires any new bearer-token type to answer shape, lifetime, and
revocation up front.

## Decision

**Token.** A third `booking_capabilities` purpose, `claim` — same hashed-only storage, same
`capabilityExpiryFor` lifetime (trip end + 30 days grace, ≥24 h, ≤2 y backstop), same per-purpose
live cap of `MAX_LIVE_CAPABILITIES_PER_PURPOSE`. The URL `/claim/<token>` *is* the capability;
`redactCapabilityUrl` redacts the prefix before telemetry, like its siblings.

**Party linkage.** Two `bookings` columns: `party_lead_booking_id` (member seats point at the
organizer's booking; stamped by `createBookingParty`, cleared on any reactivation of a cancelled
row so stale membership can't leak a claim link over someone's fresh booking) and `claimed_at`.

**Minting.** Only the organizer's verified surfaces mint claim links — the confirmation panel
(via the lead's `confirm` capability) and the lead's `/ready` page (via their `readiness`
capability) — and only for still-unclaimed, non-cancelled member seats on a not-yet-departed trip
(`issuePartySeatClaims`, the one authorization seam).

**Claiming** (`claimPartySeat`, one transaction): verify token → lock the seat → resolve the
claimant by email with `findOrCreatePerson` semantics — an email match reuses that person row, and
a non-matching name stamps `identity_unconfirmed_at` exactly as the public booking form does
(H-13), so nobody inherits verified evidence by typing an email — refuse `already_booked` if the
claimant already holds a live seat on the trip, re-run the gates a fresh booking would face (on a
course session the course's own card gate, fail-closed exactly as `createBookingRecord`'s
`course_prerequisite`; otherwise `tripAdmissionFor` on the claimant's own evidence; course
minimum age deliberately not re-checked — an age refusal keyed to a typed email is an oracle
about someone else's record (H-22), and readiness still catches it), then re-point `person_id`,
stamp `claimed_at`, supersede any current waiver record on
the booking that belongs to a different person (readiness's booking-scoped waiver join would
otherwise let the claimant board on the placeholder's signature), and revoke **every** outstanding
capability on the booking. Consequences after commit mirror `seatDiver`: waiver-on-join to the
claimant, activity trail, analytics. Payment rows stay with the booking (the organizer paid for
the seat, not the identity); the placeholder person row is left behind, unbooked, for staff to
tidy.

**Revocation.** Claiming revokes all live claim links for the seat (one-shot in effect); booking
cancellation already revokes every capability; trip cancellation fails closed at verify; staff can
call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "claim" })` for a leaked link.

**Unclaimed at departure**: nothing happens — the seat boards under the organizer's party exactly
as today. Claiming never weakens a gate: admission and readiness evaluate the claimant like any
diver.

## Alternatives considered

- **A new claim-token table** — duplicates `booking_capabilities`' hashing, expiry, revocation,
  and cap machinery for no isolation gain; the runbook's questions are already answered there.
- **Stateless signed tokens (recap-style)** — the runbook itself records that recap links can't be
  individually revoked; a seat-takeover credential must be.
- **Emailing members directly instead of organizer-shared links** — members usually have no email
  on file (that's the problem); the organizer's group chat is the real distribution channel.
- **Accounts for claimants** — against the product's no-account diver posture; the URL is the
  capability everywhere else.

## Consequences

Organizers share links; each claimant becomes a real person record with their own waiver, prep,
locale, and readiness — the shop meets its divers before the dock. Course cohorts can reuse the
same mechanics later. It commits us to the placeholder-vs-person duality: surfaces that assume a
booking's person never changes must tolerate the re-point (capabilities and waivers are handled
here; rental fit written for a placeholder stays on the placeholder). Escape hatch: dropping the
feature means ignoring the two columns and the `claim` enum value — nothing else depends on them;
migrating to per-member payment later extends this token, not replaces it.
