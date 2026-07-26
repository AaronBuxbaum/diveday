# 20260726-abandoned-checkout-recovery — Abandoned pay-at-booking checkout recovery

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

[fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md)
verified this gap: FareHarbor emails a diver who reserved a spot but never finished paying. DiveDay's
seat is held regardless of payment ([20260721-checkout-at-booking](20260721-checkout-at-booking.md)),
so this is a nudge to finish paying, not a "you'll lose your spot" threat. Two corrections landed
during review before this shipped: a stale local `pending` `booking_checkouts` row is not proof of
abandonment (a webhook can legitimately lag a real Stripe payment), and the party-checkout's purchaser
can't be reliably recovered from `booking_checkout_bookings` alone (no lead/ordering marker, several
divers' emails may be linked).

## Decision

- **Store the purchaser's email on the checkout row itself.** `booking_checkouts.customer_email`
  snapshots the `customerEmail` `startBookingCheckout` already sends to Stripe at session-creation
  time. This sidesteps re-deriving "who bought this" from the party's linked bookings entirely — the
  row that needs a recipient now durably has one.
- **Reconcile with Stripe before ever sending.** `sendDueCheckoutRecoveries`
  (`src/db/checkout-recovery.ts`) treats a stale local `pending` row as a lead, not proof: every
  candidate is refreshed via the existing `refreshCheckoutFromStripe` (the same webhook-less fallback
  the confirmation page already uses) immediately before sending. Only a checkout still genuinely
  `pending` afterward — not paid, not expired — gets the email.
- **The due-rule is one framework-free function.** `dueCheckoutRecovery(checkout, now)`
  (`src/lib/checkout-recovery.ts`) is true only for a `pending` checkout, old enough
  (`RECOVERY_DELAY_HOURS` = 2, matching FareHarbor's stated cadence), not already sent, with a Stripe
  session that hasn't itself expired (a dead link helps no one), and a known recipient.
- **Dedup lives on the checkout row, not the shared notification-delivery table.**
  `booking_checkouts.abandoned_recovery_sent_at` is set only after a confirmed send, so a failed
  attempt (no provider configured, a transient error) is retried on the next run. This is deliberately
  separate from `notification_deliveries` (keyed per booking): a party checkout covers several
  bookings with no single "the" booking to key a delivery row on, and the checkout row is the actual
  unit this notification is about.
- **A new `checkout_recovery` notification kind, structurally like the account-lifecycle mail.**
  It carries `checkoutId`, not `bookingId`, so — like `welcome`/`staff_invite` — it's excluded from
  `TrackedNotification` by construction (`Extract<Notification, { bookingId: string }>`); there's no
  per-booking delivery-dashboard row to misattribute to one arbitrary diver in the party.
- **Rides the existing daily cron, not a new schedule.** `sendDueCheckoutRecoveries` is one more call
  in `GET /api/cron/reminders` alongside the pre-trip reminder and recap scans
  ([20260721-scheduled-reminder-cadence](20260721-scheduled-reminder-cadence.md)) — no new Vercel Cron
  slot, no new timer in the app. The honest cost: on a daily cadence, a recovery fires *at least*
  `RECOVERY_DELAY_HOURS` after abandonment but with cron-alignment jitter on top (same-day to
  next-tick), looser than FareHarbor's tighter scheduler-driven ~2 hours. Never duplicated (the dedup
  row) and never sent for a session that already paid or expired (the reconciliation step).

## Alternatives considered

- **Trust the local `pending` status without reconciling** — the original, simpler plan; rejected
  once review pointed out a delayed webhook can leave an already-paid session looking abandoned,
  which would have emailed a diver who already paid.
- **Derive the recipient from the party's linked bookings** — the original plan; rejected because
  `booking_checkout_bookings` has no lead-booking marker, so picking one arbitrarily risks emailing
  the wrong diver in a multi-person party or duplicating the send.
- **A dedicated `checkout_abandoned` cron/table separate from the reminder cadence** — more isolated,
  but this is exactly the same "no in-process timer, an idempotent external-cron-driven scan" shape
  the reminder cadence already established; reusing the one daily endpoint is one fewer moving part.

## Consequences

- A diver who reserves a seat and walks away from Stripe Checkout gets a real nudge to finish paying,
  linking back to their exact still-open session — the abandoned-cart-recovery gap the competitive
  audit flagged.
- The feature is inert until a shop both connects Stripe and takes online payment at booking; nothing
  changes for a book-now-pay-later shop.
- Recovery timing is coarser than FareHarbor's on the shipped daily cron; a future paid-tier scheduler
  running more often would tighten it for free, since `dueCheckoutRecovery`'s rule doesn't change.
