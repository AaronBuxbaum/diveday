# Capability telemetry runbook

`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`, `/verify/[token]`,
`/reset-password/[token]`, `/invite/[token]`, `/claim/[token]`, and
`/calendar/[token]` carry a
bearer capability in the path itself — anyone holding the URL has the access it
grants. A ninth capability, the
schedule-confirmation `confirm` purpose (`purpose = 'confirm'` in
`booking_capabilities`), travels as a *query parameter* instead —
`/s/[shopSlug]/trips/[id]?booking=<token>` — not a path segment,
including in the URL Stripe checkout redirects back to.
`src/app/observability.ts` (`redactCapabilityUrl`) redacts both shapes:
`CAPABILITY_ROUTE_PREFIXES` rewrites the path-segment tokens to their
template form (e.g. `/waivers/[token]`), and `CAPABILITY_QUERY_PARAMS`
redacts the `booking` query value on *any* path — before Vercel Analytics or
Speed Insights ever see the event; see `src/app/observability-client.tsx` for
the single mount point both SDKs go through (CR-001, hardened after a
security review found the `confirm` token unprotected in the original fix).
`/forgot-password` carries no token in its URL at all — the email is a POST
body field — so it needs no redaction entry. Ordinary public/staff routes
pass through untouched.

## Auditing existing telemetry for leaked tokens

Events sent before this change (or before the `confirm`-token fix landed)
may still contain raw tokens. To check:

1. Open the project in the Vercel dashboard → **Analytics** → **Pages**, and
   separately **Speed Insights** → **Pages**.
2. Filter/search for `waivers/`, `ready/`, `recap/`, `verify/`,
   `reset-password/`, `invite/`, `claim/`, and `calendar/` path prefixes, **and
   separately** for `/s/*/trips/` paths carrying a `?booking=` query parameter —
   the redaction covers both shapes, but they don't share one filter.
   (`/calendar/[token]` is fetched by calendar clients rather than browsers, so
   it rarely appears in Analytics at all — check it anyway; a staff member who
   opens their own feed URL in a browser once puts it there.)
3. Any row showing a path *longer* than `/waivers/[token]`, `/ready/[token]`,
   `/recap/[token]`, `/verify/[token]`, `/reset-password/[token]`,
   `/invite/[token]`, `/claim/[token]`, or `/calendar/[token]` (i.e. an actual
   token string), or a
   `/s/*/trips/*` row whose `booking` parameter isn't the literal string
   `[token]`, is a historical leak.
   Export or note the affected paths, then rotate/revoke per capability type
   below.
4. Vercel raw analytics data has a fixed retention window; once it rolls
   off there is nothing further to audit for that period.

## Rotating or revoking an exposed capability

| Capability | Storage | Can it be revoked/rotated? |
| --- | --- | --- |
| Waiver link (`/waivers/[token]`) | Hashed, expiring, supersedable row in `waiver_records` (see `src/db/waivers.ts`) | Yes — issuing a new waiver link for the same booking supersedes the old token; the superseded token stops verifying immediately. The diver's self-serve rescue from a dead link (`emailFreshWaiverLink`) refuses to issue while the booking already has a live one (`current_link_live`), so a leaked stale URL can't be used to kill the link its owner is signing in, or to wipe the draft saved against it. |
| Readiness link (`/ready/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'readiness'`; see `src/db/booking-capabilities.ts`, [ADR 20260723-booking-capabilities](../architecture/decisions/20260723-booking-capabilities.md)) | Yes (CR-002) — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "readiness" })`; a cancelled booking's outstanding links also fail closed automatically. Note: reissuing does **not** supersede an earlier still-valid link (both stay valid) — revoke explicitly if the old one must stop working. Bounded, though: one booking holds at most `MAX_LIVE_CAPABILITIES_PER_PURPOSE` (20) live links per purpose, and issuing past that revokes the oldest, newest kept. Tokens are stored only as hashes, so a page render that needs a link must mint one — the cap is what stops a confirmation page that is reloaded fifty times leaving fifty working credentials behind. |
| Seat-claim link (`/claim/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'claim'`; same table/module as readiness, [ADR 20260804-seat-claim-links](../architecture/decisions/20260804-seat-claim-links.md)) | Yes — and treat an exposed one as high stakes while the seat is unclaimed: it lets its holder re-point that seat's identity to themselves (never any other seat, and never after departure). Call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "claim" })`; a successful claim also revokes **every** outstanding capability on the booking (all purposes), so a claim link is one-shot in effect, and a cancelled booking's or trip's links fail closed automatically. Same per-purpose live cap as the readiness link. |
| Confirm link (`/s/[shopSlug]/trips/[id]?booking=[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'confirm'`; same table/module as readiness) | Yes — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "confirm" })`; a cancelled booking's or cancelled trip's outstanding confirm links also fail closed automatically (CR-003, hardened after a security review found trip cancellation alone didn't). Same per-purpose live cap as the readiness link above. |
| Recap link (`/recap/[token]`) | Stateless signed token, no stored row (`src/lib/recap-links.ts`) | Not yet — the token is valid for the life of the booking id and `AUTH_SECRET`. No ticket has moved this onto `booking_capabilities` yet; until it does, an exposed recap link cannot be individually revoked. |
| Verify-email link (`/verify/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'email_verification'`; see `src/db/account-tokens.ts`, [ADR 20260725-account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md)) | Low stakes if exposed (it only confirms an address). Reissuing (a fresh onboarding send) supersedes the old token; it also simply expires after 3 days. |
| Password-reset link (`/reset-password/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'password_reset'`; same table/module) | Yes — issuing a new reset request for the same account supersedes any outstanding one, and a used or expired (1 hour) token stops verifying immediately either way. |
| Staff-invite link (`/invite/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'invite'`; same table/module, [ADR 20260726-staff-invite-accounts](../architecture/decisions/20260726-staff-invite-accounts.md)) | Yes — and treat it as high stakes: an unconsumed invite token creates a *staff* account, so an exposed one is an account-takeover-equivalent path, not a low-stakes confirmation like email verification. Reissuing the invite supersedes the outstanding token; it also expires after 7 days (`INVITE_TTL_MS`, `src/lib/account-tokens.ts`). |
| Staff calendar feed (`/calendar/[token]`) | Hashed, **non-expiring**, revocable row in `calendar_feeds` (`src/features/calendar-sync/feed-store.ts`, [ADR 20260730-calendar-feed-subscriptions](../architecture/decisions/20260730-calendar-feed-subscriptions.md)) | Yes — call `revokeCalendarFeeds` (sets `revoked_at`), or rotate from the staff UI at `shop/[shopSlug]/settings/calendar`, which revokes the old row and issues a new one in the same step. `verifyCalendarFeed` re-derives access on **every** poll — an unknown token, a revoked row, and a person who has since lost their staff role all return the same 404, and `revokeFeedsForFormerStaff` closes outstanding feeds when a role is removed. This is the longest-lived credential of the set by design: no expiry, because a feed that died after 60 days would silently stop updating a captain's calendar. Rotation is the mitigation, so rotate rather than wait it out. |

For a leaked recap link, the only current mitigation is confirming the
redaction above stops further leakage and, for a credible active-abuse
case, rotating `AUTH_SECRET` (which invalidates every outstanding
`recap-links.ts`-signed token — a blunt, shop-wide instrument, not a scoped
revocation, and it does **not** touch `booking_capabilities` rows at all).
