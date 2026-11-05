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
- **Keys.** Version 1 is derived from `AUTH_SECRET` and is used to sign only while
  `BOOKING_LINK_SECRET` is unset. `BOOKING_LINK_SECRET=v<n>:<secret>` (n from 2 to 9, the secret
  at least 32 bytes) signs new rows. `BOOKING_LINK_SECRET_PREVIOUS` (same format, lower n) only
  verifies. To rotate, move the current value into `_PREVIOUS` and set `v<n+1>:…`. Production
  refuses the development fallback and short secrets. A malformed value fails the send rather than
  falling back to version 1.
- **One live row per booking, purpose and audience**: a partial unique index on
  `(booking_id, purpose, delivered)` where unrevoked and not a receipt. Issuing locks, reuses the
  live row and moves its expiry to the trip's, and inserts with `ON CONFLICT DO NOTHING` and a
  re-read. A row with under a day left is revoked and replaced. Handoff links are never reused,
  and `returning_diver_receipt` stays one-use.
- **Identity is fixed.** A trigger refuses any change to id, shop, booking, purpose, audience, key
  version or source, so an old URL never opens a different row.
- The confirmation page reads the live browser link, never creates one on GET, and is
  `private, no-store`. The exchange route, the cap, readiness take-back and the sealed copy go.

## Alternatives considered

- **Keep hashes and the sealed copy**: keeps all four workarounds and a second secret store.
- **One env var per purpose**: more rotation steps; the purpose is already in the tag.

## Consequences

- The migration deletes every booking link; holders land on the dead-link page and its rescue mail.
- `token_hash` and `token_sealed` stay declared but unused for one release, because the
  expand/contract guard refuses a column drop while the previous release still declares it. The
  next release drops them.
- In the deploy window an old instance's insert can meet the new index and fail one send.
- Rotating `AUTH_SECRET` kills every version-1 link; dropping a version from both variables kills
  its links (the mass-revocation lever).
- Delivered links are not yet revoked when a diver's contact address changes (review item 10,
  follow-up).
