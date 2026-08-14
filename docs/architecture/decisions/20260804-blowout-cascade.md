# 20260804-blowout-cascade — One-tap weather blow-out cancellation cascade

- **Status:** Accepted
- **Amended by:** [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md) — the cascade refunds now.
- **Date:** 2026-08-04

## Context

The brainstorm's biggest operational bet ([features/brainstorm.md](../../product/features/brainstorm.md),
Revenue And Recovery): a dive shop sells perishable seats under weather risk, and the blow-out
morning — captain calls it, phone rings, every booked diver needs the same three facts — was
DiveDay's worst hour, handled per booking by hand. What existed before this slice: `cancelTripAction`
flips `trips.status` to `cancelled` through `setTripStatus` and **stops there** — no diver is told,
no rebooking is offered, no record tracks who is still stranded. The refund machinery
([20260721-automated-cancellation-refund](20260721-automated-cancellation-refund.md)) exists but is
built for a *diver-initiated* cancel: its `refundOnCancellation` window arithmetic returns `forfeit`
past the stated deadline, which is exactly when a weather call happens.

## Decision

- **One tap, one confirm, two phases.** A "Weather blow-out…" control on the trip page (open to all
  staff — the go/no-go is the crew's call, same gate as `cancelTripAction`) leads to a confirm page
  at `/shop/[shopSlug]/schedule/blowout/[tripId]`. Confirming runs `callTripBlowout`
  (`src/db/blowouts.ts`): **phase one**, a transaction — cancel the trip through the same
  `setTripStatus` seam the plain cancel uses, insert a `trip_blowouts` row (unique per trip), and
  snapshot every active booking into `trip_blowout_divers` as `pending`; **phase two**, outside the
  transaction — walk the pending rows, compute each diver's offers, send each one message, settle
  each row's status.
- **Send once, resume always.** A crash or provider failure mid-walk leaves unsent rows `pending`;
  calling the blow-out again (the same action — it is idempotent) picks up exactly those rows. The
  notification kind `trip_blowout` is keyed by the diver row's own id
  (`trip-blowout/{blowoutDiverId}`), so even a racing double-tap converges on one send per diver. A
  *retryable* provider failure settles the row as `queued` — the durable retry queue
  (`notification_send_queue`) owns that send and a resume never races it; a non-retryable failure
  settles as `failed`, which the cascade surface's "Retry unsent messages" control flips back to
  pending. A diver with no email lands `no_email` with their phone surfaced — the honest phone-list
  fallback, never a silent skip.
- **Offers come from the real admission gate.** `qualifyingAlternatives` (`src/lib/blowout.ts`,
  pure, test-first) filters near-future scheduled departures through the *same* `decideTripAdmission`
  every booking runs ([20260803-trip-admission-at-booking]) — plus seats-available, a 30-day
  horizon, never the cancelled trip, never a course session, never a boat the diver already holds a
  seat on, capped at three, soonest first. Zero survivors is a legitimate answer: the message still
  goes out, pointing at the public schedule. Offers are links to the public booking pages
  (`publicTripPath`) — **no new token flow**; the diver books a fresh seat exactly as any visitor
  would.
- **No money moves.** *(Withdrawn 2026-08-13 — see
  [20260813-shop-cancellation-refunds-itself](20260813-shop-cancellation-refunds-itself.md). The
  cascade now refunds each claimed row before composing its message, through a second refund arm
  with the window arithmetic removed. The reasoning below about `refundBookingOnCancellation` being
  the wrong function is still correct, and is why the new arm exists rather than a reuse of it.)*
  The message carries a money *story* as a code (`none`/`deposit`/`paid`; the
  template picks the words: "your payment is safe, the shop will be in touch"), and the cascade
  surface shows each diver's payment status to staff. `refundBookingOnCancellation` is deliberately
  **not** invoked: its window/forfeit arithmetic answers "may this *diver* cancel free?", and
  applying it to a *shop-called* cancel would forfeit paid seats on the shop's own weather call.
  Refunds continue through the existing per-booking staff path, which also keeps the H-14 refund
  role gate intact — whoever is on the dock at 6am can call the blow-out without acquiring the
  power to move money. What a shop-initiated cancellation *should* do with money automatically is a
  policy question adjacent to H-07, left for its owner.
- **The cascade is a surface, not a log line.** The same route renders the record once called: per
  diver — message state, money position, the offers their message carried (snapshotted in
  `offered_trip_ids`, the audit answer to "what did we tell them?"), and a live **rebooked /
  unresolved** state (an active seat on another upcoming scheduled departure). The blow-out isn't
  over until the unresolved column is empty.

## Alternatives considered

- **Auto-refund through `refundOnCancellation`** — wrong arithmetic for a shop-called cancel
  (forfeit past the window); invoking it would move money under actors H-14 doesn't allow.
- **Cancel every booking row too** — the plain trip cancel has never done this; keeping bookings
  alive keeps reinstate cheap (weather improves) and keeps the manifest's history honest.
- **Offer links to `/ready/[token]` for one-tap reschedule** — a new bearer-token surface in a mass
  email, and self-service reschedule only covers unpaid seats; public booking pages carry no
  capability and already work for everyone.
- **A courtesy SMS/WhatsApp alongside the email** — the reminders pipeline's pattern would fit, but
  it doubles the delivery surface of a first slice; the cascade record's phone-number fallback
  covers the gap. Named follow-on below.

## Consequences

- The blow-out morning becomes: one tap, one confirm, then working a shrinking list — instead of
  per-booking manual messaging at the exact moment the phone is ringing.
- One blow-out per trip, ever (`trip_blowouts.trip_id` unique): a reinstated-then-re-cancelled trip
  resumes the same cascade rather than double-messaging the roster. If a real shop hits
  reinstate-then-second-blow-out, the unique constraint is the thing to revisit (cost: key the
  cascade by `(trip_id, called_at)` and re-point the booking-unique index).
- Follow-ons deliberately out of scope, in order of value: **alternative-day salvage** (offer a pool
  session / shore dive / classroom day the shop can still run — the brainstorm's named quick win on
  top of this cascade), a courtesy SMS/WhatsApp channel for the blow-out message, and trip-credit
  offers once the credit ledger exists.
- No marketing surface gains a "handles weather" claim from this slice (claims policy, HD-25).

[20260803-trip-admission-at-booking]: 20260803-trip-admission-at-booking.md
