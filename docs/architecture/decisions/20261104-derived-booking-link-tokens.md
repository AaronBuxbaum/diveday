# 20261104-derived-booking-link-tokens — Derive a booking link's token from its row

- **Status:** Accepted
- **Date:** 2026-11-04
- **Issue:** #2711
- **Amends:** [20260723-booking-capabilities](20260723-booking-capabilities.md), [20260804-seat-claim-links](20260804-seat-claim-links.md), [20260820-one-page-after-booking](20260820-one-page-after-booking.md), [20261008-course-forms](20261008-course-forms.md), [20261016-fresh-link-per-booking-row](20261016-fresh-link-per-booking-row.md)

## Context

`booking_capabilities` stored only a hash of each link, so a row could not give back its URL, and
four workarounds grew around that: a cap of twenty live links per purpose, a sealed copy for
course-forms links, an exchange route so the confirmation page would not mint on render, and taking
back an unsent link. The security review (#2711) asked for one live link per booking, purpose and
audience, with the tag checked before any row is read.

## Decision

- **Token `c<v>.<id>.<tag>`** (`src/lib/booking-link-token.ts`): `v` is the key version (1 to 9),
  `id` is the row's uuid in 22 base64url characters (canonical only), and `tag` is
  HMAC-SHA256 over version, id and purpose under an HKDF key. Only `src/db/booking-capabilities.ts`
  turns a token into a row (a guard test enforces it), and a wrong tag costs no query.
- **Keys.** Version 1 comes from `AUTH_SECRET`; it signs while `BOOKING_LINK_SECRET` is unset and
  verifies while `BOOKING_LINK_SECRET_PREVIOUS` is unset. `BOOKING_LINK_SECRET=v<n>:<secret>` (n
  2 to 9, 32+ bytes, not `AUTH_SECRET`) signs; `_PREVIOUS` (lower n) only verifies. To rotate,
  move the current value into `_PREVIOUS` and set `v<n+1>:…`; the first rotation retires v1
  without signing staff out. A malformed or development secret fails the send.
- **One live row per booking, purpose and audience**: a partial unique index on
  `(booking_id, purpose, delivered)` where unrevoked and not a receipt. Issuing locks, reuses a
  live row only under the signing version with a day left (else revokes and mints), and inserts
  with `ON CONFLICT DO NOTHING`. Moving a trip or seat moves its links' expiry. Handoff links are
  never reused; receipts stay one-use.
- **Identity is fixed.** A trigger refuses changing id, shop, booking, purpose, audience, version or
  source, and un-revoking; CHECKs keep a version on link rows only.
- The confirmation page reads the live browser link, never mints on GET, and is
  `private, no-store`. The rescue re-sends the live mailed link, once per 15 minutes.

## Alternatives considered

- **Keep hashes and the sealed copy**: keeps all four workarounds and a second secret store.

## Consequences

- The migration deletes every booking link; holders land on the dead-link page and its rescue mail.
- `token_hash` and `token_sealed` stayed declared, unused, for one release (the expand/contract
  guard); #3901 dropped them. Waiver links are #3903.
- In the deploy window an old instance's link inserts fail the new CHECK and index.
- Dropping a version from both variables kills its links. Versions stop at 9.
- A contact change revokes links sent to the old one (#3902, #3950; `revokeLinksSentToOldContact`).

## Amendment 2026-11-05 (#3954)

Two mechanisms. A booking link keeps its trip-relative expiry and has no `CAPABILITY_POLICY` row.
Every other link is a stored `capabilities` row; one that expires names `ttlMs` in the policy, the
mint sets `expires_at` from it, and opening or spending checks it.
