# 20261028-returning-diver-device-memory — Remember a booker only by shop and opt-in

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The public booking form can reduce repeat typing, but it handles a name and email on a shared
device. A `?booked=1` URL is editable and readiness links are shareable, so neither proves that the
current browser just made the booking. The memory must be an explicit, scoped convenience and must
not change the successful booking confirmation.

## Decision

1. Offer an unchecked opt-in on non-embedded public bookings. Only after the booking transaction
   succeeds, the lead identity is confirmed, and the booking is not refused, issue a random
   one-use receipt. It is bound to the exact shop, booking, person, trip, and the undelivered
   readiness capability issued to the redirecting browser. The distinct emailed readiness
   capability cannot redeem it.
2. Store only a hash of that receipt in `booking_capabilities`; store its opaque value in a short
   lived HttpOnly, SameSite=Lax cookie scoped to `/ready`. No name or email enters the receipt,
   cookie, or URL. An explicit post-hydration Server Action atomically redeems it; page rendering
   and RSC prefetch never consume it. Failed redemption cannot change a successful booking.
3. After redemption, the browser may write name/email to local storage under a per-shop key for
   30 days. The checkbox is off by default, embeds never offer it, and the existing "Not you?"
   control clears this shop's memory. Old global memory is removed without migration.
4. The confirmation remains server-rendered and immediate. Device memory is best-effort: leaving
   before hydration or receipt redemption can miss the convenience. We do not delay or hide the
   confirmation to close that race.

## Alternatives considered

- **Trust `?booked=1` or the emailed readiness capability** — both are replayable/shareable and do
  not prove an opted-in booking from this browser.
- **Persist identity in a server session or cookie** — adds a PII persistence surface and changes
  the existing boundary.
- **Wait to show success until storage completes** — hides accurate confirmation when JavaScript,
  storage, or the network fails.

## Consequences

Receipt rows contain no PII and expire within 24 hours; the existing capability-row retention
policy prunes them 90 days after expiry. Device memory is local to a browser profile and shop,
expires after 30 days, and remains clearable. If product later requires guaranteed memory across
pre-hydration navigation, it needs a separately reviewed browser proof design.
