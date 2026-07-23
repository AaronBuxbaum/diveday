# Capability telemetry runbook

`/waivers/[token]`, `/ready/[token]`, and `/recap/[token]` carry a bearer
capability in the path itself — anyone holding the URL has the access it
grants. `src/app/observability.ts` (`redactCapabilityUrl`) rewrites those
paths to their template form (e.g. `/waivers/[token]`) before Vercel
Analytics or Speed Insights ever see the event; see
`src/app/observability-client.tsx` for the single mount point both SDKs go
through (CR-001). Ordinary public/staff routes pass through untouched.

## Auditing existing telemetry for leaked tokens

Events sent before this change may still contain raw tokens. To check:

1. Open the project in the Vercel dashboard → **Analytics** → **Pages**, and
   separately **Speed Insights** → **Pages**.
2. Filter/search for `waivers/`, `ready/`, and `recap/` path prefixes.
3. Any row showing a path *longer* than `/waivers/[token]`,
   `/ready/[token]`, or `/recap/[token]` (i.e. an actual token string) is a
   historical leak. Export or note the affected paths, then rotate/revoke
   per capability type below.
4. Vercel raw analytics data has a fixed retention window; once it rolls
   off there is nothing further to audit for that period.

## Rotating or revoking an exposed capability

| Capability | Storage | Can it be revoked/rotated? |
| --- | --- | --- |
| Waiver link (`/waivers/[token]`) | Hashed, expiring, supersedable row in `waiver_records` (see `src/db/waivers.ts`) | Yes — issuing a new waiver link for the same booking supersedes the old token; the superseded token stops verifying immediately. |
| Readiness link (`/ready/[token]`) | Hashed, expiring, revocable row in `booking_capabilities` (`purpose = 'readiness'`; see `src/db/booking-capabilities.ts`, [ADR 20260723-booking-capabilities](../architecture/decisions/20260723-booking-capabilities.md)) | Yes (CR-002) — call `revokeBookingCapabilities(db, { shopId, bookingId, purpose: "readiness" })`; a cancelled booking's outstanding links also fail closed automatically. Note: reissuing does **not** supersede an earlier still-valid link (both stay valid) — revoke explicitly if the old one must stop working. |
| Recap link (`/recap/[token]`) | Stateless signed token, no stored row (`src/lib/recap-links.ts`) | Not yet — the token is valid for the life of the booking id and `AUTH_SECRET`. No ticket has moved this onto `booking_capabilities` yet; until it does, an exposed recap link cannot be individually revoked. |

For a leaked recap link, the only current mitigation is confirming the
redaction above stops further leakage and, for a credible active-abuse
case, rotating `AUTH_SECRET` (which invalidates every outstanding
`recap-links.ts`-signed token — a blunt, shop-wide instrument, not a scoped
revocation, and it does **not** touch `booking_capabilities` rows at all).
