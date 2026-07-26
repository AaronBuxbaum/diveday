# Capability telemetry runbook

`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`, `/verify/[token]`, and
`/reset-password/[token]` carry a bearer capability in the path itself —
anyone holding the URL has the access it grants. A sixth capability, the
schedule-confirmation `confirm` purpose (`purpose = 'confirm'` in
`booking_capabilities`), travels as a *query parameter* instead —
`/shop/[shopSlug]/schedule/[id]?booking=<token>` — not a path segment,
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
2. Filter/search for `waivers/`, `ready/`, `recap/`, `verify/`, and
   `reset-password/` path prefixes, **and separately** for `schedule/` paths
   carrying a `?booking=` query parameter — the redaction covers both
   shapes, but they don't share one filter.
3. Any row showing a path *longer* than `/waivers/[token]`, `/ready/[token]`,
   `/recap/[token]`, `/verify/[token]`, or `/reset-password/[token]` (i.e. an
   actual token string), or a `/shop/*/schedule/*` row whose `booking`
   parameter isn't the literal string `[token]`, is a historical leak.
   Export or note the affected paths, then rotate/revoke per capability type
   below.
4. Vercel raw analytics data has a fixed retention window; once it rolls
   off there is nothing further to audit for that period.

## Rotating or revoking an exposed capability

| Capability | Storage | Can it be revoked/rotated? |
| --- | --- | --- |
| Waiver link (`/waivers/[token]`) | Hashed, expiring, supersedable row in `waiver_records` (see `src/db/waivers.ts`) | Yes — issuing a new waiver link for the same booking supersedes the old token; the superseded token stops verifying immediately. |
| Readiness link (`/ready/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'readiness'`; see `src/db/booking-capabilities.ts`, [ADR 20260723-booking-capabilities](../architecture/decisions/20260723-booking-capabilities.md)) | Yes (CR-002) — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "readiness" })`; a cancelled booking's outstanding links also fail closed automatically. Note: reissuing does **not** supersede an earlier still-valid link (both stay valid) — revoke explicitly if the old one must stop working. |
| Confirm link (`/shop/[shopSlug]/schedule/[id]?booking=[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'confirm'`; same table/module as readiness) | Yes — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "confirm" })`; a cancelled booking's or cancelled trip's outstanding confirm links also fail closed automatically (CR-003, hardened after a security review found trip cancellation alone didn't). |
| Recap link (`/recap/[token]`) | Stateless signed token, no stored row (`src/lib/recap-links.ts`) | Not yet — the token is valid for the life of the booking id and `AUTH_SECRET`. No ticket has moved this onto `booking_capabilities` yet; until it does, an exposed recap link cannot be individually revoked. |
| Verify-email link (`/verify/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'email_verification'`; see `src/db/account-tokens.ts`, [ADR 20260725-account-lifecycle-emails](../architecture/decisions/20260725-account-lifecycle-emails.md)) | Low stakes if exposed (it only confirms an address). Reissuing (a fresh onboarding send) supersedes the old token; it also simply expires after 3 days. |
| Password-reset link (`/reset-password/[token]`) | Hashed, expiring, one-time row in `account_tokens` (`purpose = 'password_reset'`; same table/module) | Yes — issuing a new reset request for the same account supersedes any outstanding one, and a used or expired (1 hour) token stops verifying immediately either way. |

For a leaked recap link, the only current mitigation is confirming the
redaction above stops further leakage and, for a credible active-abuse
case, rotating `AUTH_SECRET` (which invalidates every outstanding
`recap-links.ts`-signed token — a blunt, shop-wide instrument, not a scoped
revocation, and it does **not** touch `booking_capabilities` rows at all).
