# 20260727-diver-self-service-cancel — Diver self-service cancel/reschedule

- **Status:** Superseded by 20260820-shop-handles-plan-changes
- **Date:** 2026-07-27

## Context

[fareharbor-feature-gaps-20260726.md](../../product/archive/fareharbor-feature-gaps-20260726.md)
named diver self-service cancel/reschedule as a real FareHarbor gap, with an explicit caveat: a
diver-triggered cancel/reschedule mutates manifest and payment/refund state through a new
diver-facing surface, which AGENTS.md's hard rules place in the same safety-critical/security-
sensitive bucket as roll call and cert gating — a `dive-domain-expert` and `security-reviewer`
review, not routine growth work. The diver's existing `/ready/[token]` page (readiness capability,
`docs ADR` — see `src/db/booking-capabilities.ts`) is already the transactional self-serve surface
for waiver, payment, and rental fit; this slice extends the same page and the same token rather than
inventing a new one.

The one design requirement that shaped the whole mechanism: a diver going back to `/ready/[token]`
to rebook is not guaranteed to find a seat they want on the new trip. A "cancel first, then browse to
rebook" design can strand a diver with neither their original seat nor a new one if the destination
trip fills, or was never actually available, between page load and submit.

## Decision

- **Reuses the existing readiness capability, not a new token purpose.** Cancel and reschedule are
  both server actions gated by `contextFor()` in `src/app/ready/[token]/actions.ts`, which verifies
  the same `"readiness"`-purpose token every other action on that page already uses. A bearer of the
  link can only ever touch the one booking the token resolves to.
- **Reschedule is atomic book-then-cancel, not cancel-then-rebook.** `rescheduleBooking`
  (`src/db/bookings.ts`) runs inside one `db.transaction`: it books the destination trip first —
  reusing every existing capacity/course/ratio gate via the same private booking-creation path a
  staff or public booking goes through — and only cancels the source booking once that succeeds. A
  full or newly-unavailable destination trip leaves the original booking completely untouched; the
  diver is never left holding neither seat. This was an explicit design correction mid-build: an
  earlier draft cancelled the old booking first and sent the diver back to browse, which is exactly
  the strandable sequence this decision rejects.
- **Reschedule is offered only for an unpaid booking — and `waived` counts as settled too (Codex
  finding).** A paid, deposit-paid, or waived booking's reschedule picker doesn't render at all
  (`ReadyPageData.rescheduleCandidates` is `null` whenever a payment is settled), and
  `rescheduleBooking` re-enforces the same rule server-side. Moving captured money to a new trip is a
  staff-mediated operation this slice doesn't attempt to automate; a waived booking is the same kind
  of staff decision — rescheduling it into a fresh, unpaid booking would silently drop that decision
  and offer the diver a card checkout for a fee staff already excused. An unpaid, non-waived booking
  has nothing to move, so the diver-driven path is safe to leave self-service.
- **Cancel and refund stay two independent steps, same as the staff cancellation path (H-07).**
  `cancelMyBookingAction` calls `selfCancelBooking` to free the seat first, then
  `refundBookingOnCancellation` separately; a refund failure after a successful cancel never re-opens
  the seat or blocks the cancellation notice the diver already sees. The diver-facing notice mirrors
  the refund outcome (`refunded` / `forfeit` / `manual` / no payment owed) the same way the staff
  roster's own refund notice does.
- **The post-cancel refund notice is read through a revocation-relaxed token resolution, not the
  strict verifier.** `cancelBooking` revokes every outstanding capability for the booking it just
  cancelled — including the exact token `cancelMyBookingAction` is about to redirect back to with
  `?cancelled=...` — so the strict `verifyBookingCapability` can never see that redirect land; every
  self-cancel would otherwise show the generic "this link isn't available" notice instead of the
  refund-specific one, silently dropping the one piece of information the diver most needs right after
  cancelling. `resolveRevokedBookingCapability` (`src/db/booking-capabilities.ts`) relaxes only the
  revocation and cancelled-booking checks — the token hash must still genuinely match a real,
  correctly-scoped, unexpired capability row for the right purpose, the same guessing-resistance bar
  as the strict verifier — so this can't be used to fabricate a cancellation notice for a booking the
  bearer never had a real link to. Never used to authorize a read or a write, only this one
  confirmation render.
- **A successful reschedule mints a fresh capability rather than reusing the old token.** Booking
  capabilities are revoked when a booking is cancelled (`revokeBookingCapabilities`, called on the
  source booking inside the same reschedule transaction), so the diver's old `/ready/[token]` link
  dies with it. There is no way to hand back an existing token for a booking id that changed, so
  `rescheduleMyBookingAction` issues a new `"readiness"` capability for the destination booking and
  redirects the diver straight to it.
- **Rate-limited harder than the rest of the readiness page.** `RATE_LIMITS.bookingSelfCancel` (5/hr,
  `src/lib/rate-limit.ts`) gates both actions, tighter than the general `capabilityAction` bucket
  (60/hr) every other `/ready` action uses — cancel and reschedule are irreversible and, when paid,
  move money, so they get their own tighter ceiling on top of the token-verification rate limit
  `contextFor()` already applies.
- **A departed trip is never cancellable or reschedulable.** Both `selfCancelBooking` and
  `rescheduleBooking` check the source trip's `startsAt` against the current time and refuse once it
  has passed — matching the same "a trip never leaves `scheduled` status on its own departure" rule
  the checkout-recovery and reminder cadences already apply.
- **The source booking is row-locked for the whole transaction (`security-reviewer` finding).** Both
  functions open with `SELECT ... FOR UPDATE` on the booking being cancelled/moved and re-guard the
  terminal `status = "cancelled"` write with a `status = "booked"` precondition. Without this, two
  concurrent reschedule calls for the same booking to two *different* destination trips could each
  read `"booked"` before either wrote, each book its own uncontended destination, and both then
  unconditionally cancel the same source row — leaving the diver double-booked off one original seat.
  The lock serializes that: the second caller blocks until the first commits, then sees the row
  already cancelled and refuses cleanly. (PGlite is single-connection, so the unit suite can't exhibit
  the underlying race directly; the lock's correctness is a code-review property here, not something a
  test asserts.)
- **Reschedule refuses a booking still flagged `identity_unconfirmed` (`dive-domain-expert` finding,
  H-13).** `createBookingRecord`'s known-`personId` path — the one reschedule always uses, since the
  diver's identity is already resolved via the bearer token — never sets that flag on the new booking,
  so rescheduling would otherwise silently clear a deliberate, staff-only-clearable readiness blocker
  raised when an earlier public booking's name didn't match its email's existing person record. Rather
  than carry the flag forward onto a booking whose "identity" is now doubly once-removed, self-service
  reschedule simply refuses while it's set (`identity_unconfirmed`, folded into the same generic
  `error=reschedule` notice) — staff resolve it the same way they always have, then the diver can move
  their own booking once cleared.
- **Reschedule carries a nitrox request forward (`dive-domain-expert` finding).** `wantsNitrox` isn't
  part of `createBookingRecord`'s insert, so without an explicit copy a diver's enriched-air request
  would silently reset to plain air on the new trip with no on-screen indication it happened.
  `rescheduleBooking` copies it onto the destination booking inside the same transaction — a request,
  not a grant, so this doesn't bypass the separate verified-card check nitrox fills already require.
- **Reschedule books the destination as `actor: "staff"`, not `"public"` (Codex finding).**
  `createBookingRecord`'s minimum-age gate is deliberately skipped for `actor: "public"` — that
  exception exists so the anonymous booking form can't be used as an age-guessing oracle against a
  person record the submitter may have no relationship to (`BookingRequest.actor`'s own docs). That
  rationale doesn't apply to a reschedule: `row.personId` is the token-verified diver's own identity,
  not a free-typed guess, so passing `"staff"` here applies the real commit-time age check instead of
  relying solely on the fail-open readiness blocker to catch it after the fact.
- **The reschedule picker names the destination trip, not just its date/time (Codex finding).** Two
  trips can share a departure slot (concurrent boats, a course running alongside open trips); a
  date/time-only option label made them indistinguishable, risking a diver confirming onto the wrong
  trip's manifest. Each `<option>` now leads with `candidate.title`.
- **A no-policy cancellation gets its own honest notice, not the generic "cancelled" one (Codex
  finding).** `refundBookingOnCancellation` only returns `no_policy` after confirming the booking was
  genuinely captured — the trip simply states no cancellation window, so automation stays out and
  nothing gets refunded. Folding that into the same notice as `unpaid` ("nothing was owed") would tell
  a diver who *did* pay that their cancellation was free. `cancelRefundNotice` now maps it to its own
  `cancelled-no-policy` copy: paid, no automated refund, the shop handles it directly.
- **A checkout completed after its booking is already cancelled never marks that booking paid (Codex
  finding, echoing an independent `security-reviewer` finding on this same surface).** A diver can
  leave a Stripe Checkout open in one tab (e.g. from `payFromReady`) and cancel or reschedule the same
  booking in another; the session stays payable, and completing it later would otherwise let
  `markCheckoutPaidBySessionId` attribute captured money to a booking that no longer exists. The
  webhook handler now checks each linked booking's current status before writing a payment record: a
  `cancelled` booking is skipped (logged for staff reconciliation) while the checkout itself still
  completes, so a retried webhook delivery doesn't reprocess it. This doesn't prevent the diver from
  completing the stale session (Stripe still takes the card, and this codebase has no seam to actively
  expire a live Checkout Session server-side) — it prevents the app from lying about which booking that
  money belongs to. A rescheduled-away checkout is caught the same way; the destination booking simply
  stays unpaid, exactly as `payFromReady` would require them to pay fresh for the new trip.

## Alternatives considered

- **Cancel-then-rebook** (send the diver back to the schedule to book a new trip after cancelling the
  old one) — rejected per the explicit design requirement above: nothing guarantees a seat exists by
  the time the diver gets there, and a diver who started with a seat could end up with none.
- **A new capability purpose for this surface** — rejected; the readiness token already proves
  ownership of exactly this booking, and every other transactional action on the page (pay, save fit,
  sign waiver) already uses it. A new purpose would add a parallel token lifecycle for no additional
  guarantee.
- **Allowing reschedule on a paid booking, with an automated balance adjustment** — real value for a
  shop whose trips are priced identically, but a materially larger feature (proration, partial
  refund/charge, tax implications) than this slice's scope. Deferred to a staff-mediated flow, same
  as any other paid-booking change today.

## Consequences

- A diver can move their own unpaid seat to a different upcoming trip, or cancel outright (with the
  same refund logic the staff cancellation path already uses), without contacting the shop —
  answering the self-service gap named in the FareHarbor audit.
- The atomic book-then-cancel sequence means a shop's manifest is never observably short a diver
  mid-reschedule: the new seat exists before the old one is released.
- A paid booking still requires staff to reschedule — accepted for this slice; revisit if shops ask
  for self-service reschedule on paid seats.
- Reviewed by `dive-domain-expert` (manifest-mutating diver-triggered surface) and `security-reviewer`
  (new mutation surface behind an existing token) before merge, per AGENTS.md's hard rules for
  safety-critical and security-sensitive changes.
- Known gap (Codex finding, accepted for now): the reschedule picker (`rescheduleCandidates` in
  `src/db/ready.ts`) filters candidate trips by raw capacity only, not by the course
  prerequisite/instructor-ratio/minimum-age gates `rescheduleBooking`'s `createBookingRecord` call
  enforces at commit time. An ineligible trip can therefore appear as a clickable option (and could
  crowd out an eligible one, since the list is capped) — but selecting it always fails safely, since
  the commit-time gate independently refuses it. This is a UX rough edge, not a reachable invalid
  state; not fixed here because it would mean keeping two independent copies of eligibility logic in
  sync for a cosmetic gap. Revisit if this trips up divers in practice.
- `rescheduleBooking`'s `destination_already_paid` refusal (a diver moving back onto a trip they
  previously booked, paid, and cancelled) needed `tx.rollback()` rather than a plain early return,
  because `createBookingRecord` had already written the destination reactivation earlier in the same
  transaction — a bare `return` only stops further writes, it doesn't undo ones already made. Fixed
  using the same `tx.rollback()` + outer-variable idiom `inviteStaffMember` already established
  (docs ADR 20260726-staff-invite-accounts); caught by this function's own regression test
  (Codex finding).
- The `destination_already_paid` refusal also has to cover a `refunded` destination payment, not just
  `paid`/`deposit_paid`/`waived` (Codex finding): `refunded` is a `FINAL_PAYMENT_STATUSES` entry, so a
  real payment on a reactivated seat left in that state would be silently swallowed by
  `setBookingPaymentIfNotFinal`'s own refusal to regress a final status — the diver charged while the
  booking still reads refunded. A reactivated destination row can separately still be linked to a
  *pending* (never completed) Checkout from its earlier life; `rescheduleBooking` now retires
  (`expired`) any such session in the same transaction. That local write alone doesn't reach Stripe,
  though — the hosted session stays genuinely completable there on its own, longer clock, so an old tab
  really can still complete it afterward (Codex finding: an earlier version of this fix, and this ADR
  entry, overclaimed that retiring the local row was sufficient). What actually closes the loophole is
  `markCheckoutPaidBySessionId` (`src/db/checkouts.ts`) refusing to process a completion for any
  checkout whose local status isn't `pending` or already `completed` (a replay after a prior partial
  run — checkout marked completed but the payment write never landed — still needs to fall through and
  repair itself, not be refused) — so a completion arriving for the retired row is ignored rather than
  attributing a stale, wrong-trip price to the reactivated seat. This also generalizes past
  the reschedule case: the same local-`expired`-but-Stripe-still-payable gap existed for every terminal
  disqualification `sendDueCheckoutRecoveries` makes (departed trip, cancelled booking/trip, settled
  elsewhere) — this fix closes it for all of them, not just reactivation.
- `setBookingPaymentIfNotFinal` (`src/db/payments.ts`) now re-checks the booking isn't `cancelled`
  under the same row lock that guards its write, not from an earlier unlocked read by the caller
  (Codex finding) — `markCheckoutPaidBySessionId` used to read booking status via a plain `SELECT`
  before that lock was acquired, leaving a window where a concurrent self-cancellation could commit in
  between and the webhook would still write a phantom "paid" onto the now-cancelled seat.
- `sendDueCheckoutRecoveries`'s in-loop freshness re-check (added for the settlement race, round 4)
  now also re-reads trip and linked-booking cancellation state immediately before sending, not just
  payment settlement (Codex finding) — staff cancelling mid-batch, after this checkout's batch-start
  snapshot but before its own turn in the loop, is the same class of staleness as a mid-batch
  settlement.
- The reschedule confirmation email now sets a `confirmedAt` timestamp that becomes part of its
  provider idempotency key (`src/lib/notifications/index.ts`), instead of reusing the plain
  per-booking key every "booking_confirmation" send shares (Codex finding). Without it, a reschedule
  reactivating a booking id that already had an earlier confirmation sent could fall inside the
  provider's own idempotency window and have that earlier response replayed — the diver's new,
  correct readiness link silently dropped in favor of the old, now-dead one.
- `cancelMyBookingAction` now catches a `refundBookingOnCancellation` failure instead of letting it
  propagate (Codex finding): the cancellation itself already committed and the token is already
  revoked by that point, so a refund-step failure must redirect to the same confirmation as a
  successful refund, not surface as an error page with no way for the diver to tell the (already
  irreversible) cancellation succeeded.
- The "Need to change your plans?" section is now gated on `canManageBooking` — a plain `booked` seat
  on a trip that hasn't started (`src/db/ready.ts`) — not shown unconditionally (Codex finding). A
  `checked_in`/`no_show` booking or a departed trip always fails `rescheduleBooking`/
  `selfCancelBooking` server-side (`not_cancellable`/`trip_departed`), so a diver who hasn't opened
  the page since boarding no longer sees change/cancel controls that can only ever fail.
