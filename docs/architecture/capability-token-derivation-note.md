# Design note: derive a capability's token from its row (#2711)

**Status:** proposal, no code. Waiting on a `security-reviewer` run to confirm the derivation and on
Aaron's approval (decision 48 to 52, 2026-11-02). Safety surface: tokens.

## The premise holds

Checked against main on 2026-11-02:

- `src/db/booking-capabilities.ts` still mints per request and caps the pile with
  `MAX_LIVE_CAPABILITIES_PER_PURPOSE = 20`, because "an existing row's plaintext can never be
  re-derived".
- `booking_capabilities.token_sealed` exists beside `waiver_records.token_sealed`, both under
  `SECRET_ENCRYPTION_KEY`, to hand the same link back twice.
- `src/app/s/[shopSlug]/trips/[id]/ready/route.ts` exists only so a page render does not mint a row.
- `src/db/readiness-link-rescue.ts` exists to re-issue a link nobody can read back.

Each is a workaround for the same fact: a hash cannot be turned back into a URL.

## Proposal

URL segment `<id>.<sig>`: the row's uuid, then `base64url(HMAC-SHA256(subkey, id))` (43 characters).

- `subkey = HKDF-SHA256(ikm = CAPABILITY_SIGNING_KEY[key_version], info = "diveday/capability/" + purpose)`.
  A separate env var, not `SECRET_ENCRYPTION_KEY`, so sealing and signing rotate on their own
  (registered in `config/env-registry.mjs`). One subkey per purpose, so a key leaked for one use
  proves nothing about another.
- New column `key_version smallint not null`; `token_hash` and `token_sealed` go.
- Verify: parse, check `sig` with `timingSafeEqual` over equal-length buffers, load the row by id,
  then today's predicate (purpose, expiry, revocation, booking status, subject not anonymized)
  without the hash lookup. Every failure is the same refusal.
- Issue becomes get-or-create: one live row per subject and purpose, so email, reminder, "Copy
  link" and the confirmation page all recompute one URL. `MAX_LIVE_CAPABILITIES_PER_PURPOSE`,
  supersede and the cap collapse into "revoke the row, mint a new id".

## What the issue text does not say

1. **The key becomes the credential store.** Today a database dump yields nothing replayable and
   dump plus `SECRET_ENCRYPTION_KEY` yields only the sealed waiver and course-forms links. With
   derivation, dump plus the signing key yields every live link of every purpose. The dump alone is
   still safe, so the claim holds, but the blast radius of the key grows. Mitigations to review:
   per-purpose subkeys (above), the key never in the database or in logs, and `key_version` so a
   suspected leak is a rotation that kills the old version's rows on a schedule, not at once.
2. **"One live row per (booking, purpose)" is wrong for `readiness`.** `delivered` splits it in two
   on purpose (security review r5-4, F1): the link a redirect hands the booking browser proves only
   a typed name, the mailed one opens "Your days". Recomputing one URL for both would collapse that
   line. The unique index is (booking, purpose, delivered). `claim` is per seat, so it also needs
   the seat in the key.
3. **Some purposes must stay random and one-use.** `returning_diver_receipt` is a one-use,
   browser-only receipt and `handoff` lives ten minutes; neither is a reusable link. Derivation
   applies to `readiness`, `confirm`, `claim` and `course_forms`; the other two keep
   `createBearerToken`. So `bearer-tokens.ts` keeps both shapes and the table keeps a nullable
   `token_hash` for them.
4. **A leaked link is no longer retired by volume.** The cap of 20 quietly expired forwarded links.
   With one stable URL, a leaked link lives to trip end plus 30 days unless staff or the diver
   revokes the row. That needs a visible act ("Send a new link") that revokes and mints, and the
   diver's older copies then stop working, as they do for a waiver link today.
5. **Existing rows cannot be converted.** There is no plaintext to sign. Under H-20260815-no-legacy
   the cutover revokes live rows and the next send mints derived ones; emailed links already in
   inboxes stop working. Aaron decides whether that is acceptable before the first pilot shop.
6. **`opens` and `last_used_at` do not exist** on `booking_capabilities`. Adding them puts a write
   on every bearer GET. Cheaper: a counter updated at most once a minute, or skip it.
7. **The exchange route goes away** only if the confirmation page can recompute the undelivered
   readiness URL from the booking. It can, but `confirm` then proves the same thing it does now
   (you booked this seat), so the trust line in the route's comment does not move.
8. **Waivers are a second slice.** `waiver_records.token_sealed` and its encryption dependency go
   the same way, but the waiver link has its own supersede rules (ADR
   20260820-waiver-links-are-reused-not-reissued), so it is not in the booking slice.

## For the security reviewer

Confirm or change: HMAC-SHA256 over the bare row id (versus id plus purpose plus expiry in the
MAC); full 43-character tag; HKDF info string; whether `key_version` belongs in the URL or only the
row; the revocation-on-leak story in item 4; and whether item 1 is acceptable.

## If approved, the build is

1. ADR (no new dependency: `node:crypto` has HKDF and HMAC).
2. `capabilityToken(id, keyVersion, purpose)` and `capabilityFromToken(token)` in
   `src/lib/bearer-tokens.ts`, adversarial tests first (truncated, padded, wrong purpose, wrong
   version, swapped id, uppercase, replay after revoke).
3. Migration: add `key_version`, drop `token_sealed`, add the partial unique index. Needs
   `pnpm db:merge` consideration.
4. Move `issueBookingCapability` to get-or-create; delete the cap, the exchange route and the
   rescue's re-issue branch.
5. Two `dive-domain-expert` runs and a `security-reviewer` run.
