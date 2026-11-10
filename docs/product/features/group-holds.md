# Expiring group holds and organizer ledger

Issue #4209. A public organizer can choose **Hold seats while everyone pays** when booking a
priced party at a Stripe-connected shop. The existing per-seat claims and checkout remain the
only payment model. Ordinary book-and-pay and pay-at-shop bookings are unchanged.

The hold lasts 24 hours, capped at the departure. The ready page shows a paid-or-covered count,
each companion's payment state, and the deadline in the shop's time zone. A deposit, captured
payment, partly refunded payment, or explicit waiver keeps the seat. New companions added while
a party still has an unpaid hold inherit that deadline; claiming never extends it.

Due unpaid seats are cancelled through the existing cancellation machinery under the departure
and booking locks. Their capabilities and local pending checkouts close, rental reservations
release, and the rows remain in the organizer ledger. An hourly shop tick catches up; capacity
checks release due seats before selling replacements. A genuinely in-flight provider call keeps
its short claim fence, but an abandoned claim cannot keep the seat forever. Aboard-at-sea
protection still wins.

Hosted checkouts expire no later than the hold. Stripe requires at least 30 minutes, so a new
checkout is not opened inside the final 31 minutes. Timely captured payment clears the deadline;
a payment arriving after a local quote was withdrawn uses the existing paid-after-close staff
refund workflow and never reinstates a sold seat.

If the organizer's own unpaid hold expires, their original readiness link opens a read-only
ledger until that link's normal expiry. It cannot pay, claim, sign a waiver, add seats, or change
any booking. A link revoked before hold expiry stays dead. No separate seat cap is introduced.

This is core booking/capacity behavior on the existing public booking and readiness surfaces,
not a new staff destination or optional subsystem (`BOOKING_FLOW_COVERAGE` in
`src/lib/feature-coverage.ts`).
