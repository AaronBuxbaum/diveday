# 20260723-booking-capabilities — Revocable, expiring capabilities for public booking links

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md) (CR-002,
CR-003) found that `/ready/[token]` granted write authority — issue waivers, overwrite emergency
contacts and rental fit, toggle nitrox, start payment — through a stateless HMAC-signed token
(`src/lib/readiness-links.ts`) with no expiry and no way to revoke it: a leaked historical URL kept
full write authority indefinitely. The public schedule-confirmation page
(`/shop/[shopSlug]/schedule/[id]?booking=<bookingId>`) was worse — its "credential" was the raw
booking UUID itself, not even signed.

The waiver flow already had the right shape (`waiver_records.token_hash`, an expiry, and
supersession on reissue), but it's single-purpose and tied to the waiver record's own lifecycle. Both
CR-002 and CR-003 need the same primitive, so this is one decision, not two.

## Decision

- **A new `booking_capabilities` table**, not a bolt-on to `bookings` or a copy of the waiver
  pattern. Columns: `shop_id`, `booking_id`, `purpose` (`readiness` | `confirm`), `token_hash`
  (unique, SHA-256, no secret — the token's own randomness is the security property, matching
  `waiver_records`), `issued_at`, `expires_at`, `revoked_at`. Only the hash is ever stored; the raw
  32-byte random token exists solely in the response that issued it.
- **Purpose-bound, not booking-bound.** A `readiness` token and a `confirm` token for the same
  booking are different credentials with independent verification — a token minted for one purpose
  never authorizes the other, mirroring the recap/readiness purpose separation
  ([20260723-post-trip-recap](20260723-post-trip-recap.md)).
- **Expiry is derived, not fixed:** `min(tripEndsAt + 48h, issuedAt + 60d)`, floored at
  `issuedAt + 24h` (`capabilityExpiryFor`, `src/lib/booking-capabilities.ts`). A capability outlives
  the trip by a short grace window for post-trip follow-up (a late payment, a missed waiver) but
  never runs indefinitely, and a same-day booking still gets a usable link.
- **No supersession on reissue.** Unlike a waiver link, minting a new capability for the same
  booking+purpose does not invalidate an earlier still-valid one. A diver may be holding an earlier
  confirmation email's link and a later reminder email's link at once; both keep working until they
  individually expire or are explicitly revoked. Multiple valid rows per booking+purpose is the
  accepted cost of that UX guarantee.
- **Fail-closed on cancellation without depending on proactive revocation.**
  `verifyBookingCapability` re-checks the booking's live status on every verify, so a since-cancelled
  booking's outstanding links stop working immediately even if nothing ever wrote `revoked_at`.
  `cancelBooking` also revokes outright (`src/db/bookings.ts`) so the capability table's own audit
  trail stays honest — belt-and-suspenders, not the only guard.
- **One purpose, one lifetime — not split read/write tokens.** Both `readiness` and `confirm`
  authorize read and write together: neither purpose's read and write authority has a different
  natural lifetime in this product, so a second token per purpose would add surface area without a
  matching security benefit.
- **A public verify never distinguishes *why* a token failed.** Unknown, wrong-purpose, expired,
  revoked, and cancelled-booking all return `null` from `verifyBookingCapability`; every caller
  renders the same generic "this link isn't available" — no booking-existence oracle.

## Alternatives considered

- **Extend `readiness-links.ts`'s stateless HMAC scheme with an expiry claim** — keeps it
  DB-free, but a signed claim can't be revoked before it expires without rotating the shared secret
  for every outstanding token of every kind (which is exactly the blunt instrument the CR-001
  telemetry runbook already documents as the fallback). A stored, hashed token is the only way to
  revoke one credential without touching every other one.
- **Reuse `waiver_records`'s exact shape (supersede-on-reissue)** — simpler, one fewer concept, but
  it would silently break a diver's earlier bookmarked readiness link the moment staff resend a
  reminder. Waivers can supersede because a diver only ever needs the *current* pending link;
  readiness/confirm links are meant to be revisited over weeks from whichever email the diver still
  has open.
- **A single `shop_id`-less capabilities table keyed only by token** — `shop_id` is denormalized onto
  every row anyway (AGENTS.md's tenant-row rule) and used as a defense-in-depth cross-check against
  the booking's own `shop_id` at verify time, not trusted alone.

## Consequences

- CR-002 (readiness) and CR-003 (schedule confirmation) share one migration, one verification
  function, and one revocation seam instead of two independent one-off implementations.
- A future "revoke this link" staff action is a single `revokeBookingCapabilities` call away; none
  exists yet because no ticket asked for the UI, but the seam is there and tested.
- Every call site that used to build a readiness link synchronously from a bare booking id
  (`src/db/reminders.ts`, `src/db/notifications.ts`, the booking-confirmation email, the waiver
  completion page) now issues a capability from the database instead, and the removed
  `src/lib/readiness-links.ts` no longer depends on `AUTH_SECRET` for this flow at all.
- **Escape hatch:** if concurrent-link proliferation ever becomes a real cost (many outstanding rows
  per booking), an idle-row cleanup job can prune expired/revoked rows past a retention window —
  purely additive, no verification-path change required.
