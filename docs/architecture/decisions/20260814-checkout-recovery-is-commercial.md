# 20260814-checkout-recovery-is-commercial — The abandoned-checkout nudge is a commercial message, and carries a way out of it

- **Status:** Accepted
- **Date:** 2026-08-14
- **Extends:** [20260726-abandoned-checkout-recovery](20260726-abandoned-checkout-recovery.md) — the
  send itself, its two-hour delay, and its Stripe reconciliation are unchanged. What changes is what
  rides along with the message and who it is allowed to reach.
- **Owner decision:** H-09, extended 2026-08-14.

## Context

Three DiveDay sends go to somebody with no confirmed booking behind them. Two of them had a way out;
one did not, and it was the one that most resembles marketing.

As their schemas defined them in `src/lib/notifications/kinds.ts`:

- `waitlist_invite` — carried `unsubscribeUrl`.
- `last_minute_deal` — carried `unsubscribeUrl`.
- `checkout_recovery` — did not. Its schema ended at `checkoutUrl`.

The send path matched. `src/db/checkout-recovery.ts` never read `people.courtesyEmailOptOutAt`, so a
diver who had explicitly opted out of courtesy email — the self-serve opt-out the other two honour,
with `opted_out` as a first-class outcome — still received this one. There was no per-recipient
suppression of any kind on the path.

H-09 recorded the basis on which DiveDay sends without an opt-in: *"Email is transactional/service
messaging (booking, waiver, trip logistics), so no marketing opt-in is required to send it."* Every
example in that sentence is attached to a booking that exists. This is the one send where, by
definition, it does not: the recipient started a checkout and did not finish, and may have abandoned
it precisely because they changed their mind about the shop.

In direct-marketing terms this is a cart-recovery email — the textbook case that sits on the line
between transactional and commercial, and every major regime draws that line somewhere (CAN-SPAM's
primary-purpose test, CASL's implied-consent window, GDPR/ePrivacy's soft opt-in).

## Decision

**Classify abandoned-checkout recovery as commercial.** It carries an unsubscribe link and honours
the courtesy-email opt-out, exactly like the two sends beside it, and H-09's transactional basis is
recorded as *not* reaching it.

The judgement is not that the transactional reading is unreasonable — a single nudge about a checkout
the person themselves started, linking to their own live Stripe session, has a real claim to being
service messaging. It is that the two errors are not symmetric. Being wrong in the permissive
direction costs a compliance finding on a live shop's sending domain and SES reputation damage that
lands on DiveDay's *shared* sender, hurting every other shop on it. Being wrong in the restrictive
direction costs one line in a Zod schema, one query, and one string per locale.

Mechanically:

- `checkoutRecoverySchema` gains `unsubscribeUrl` in the same `z.url().max(2_000)` shape as its two
  siblings — **required**, not optional, because an optional field is one a future caller forgets.
- The send resolves the recipient through `findCourtesyEmailRecipientByAddress`
  (`src/db/courtesy-email.ts`) and skips an opted-out person with a new `optedOut` outcome.
- The email renders the footer link with `notifications.common.courtesyUnsubscribe` — the same words
  and the same flag the wait-list invite uses, so a diver who turns courtesy email off turns off all
  of it rather than discovering a second switch later.

**The address is the handle, and where it resolves to nobody the mail does not go.** This send is
keyed to a checkout, not a booking: its recipient is `booking_checkouts.customer_email`, the address
the submitter typed, and a party checkout covers several bookings with no lead marker to re-derive a
purchaser from. So consent is resolved by matching that address against `people` within the shop,
case-insensitively, mirroring the `lower(email)` unique index. When no person answers to it there is
no opt-out to honour and no token to mint against, and a commercial message with no working way out
of it is not sent — counted as `unaddressable` so it is visible in the run summary rather than
silently dropped. It is never treated as a consent check that passed.

That row is deliberately left `pending` rather than resolved. A person row can appear later (the
diver books again, staff add them), and the Stripe session ages out of the scan on its own expiry
either way — so the retryable state is the honest one, and the starvation concern the module already
documents is bounded by that expiry.

**A public origin is now required to send.** The unsubscribe link needs somewhere to point, so a
deployment with no `publicAppUrl` stops sending recovery mail instead of sending it without an exit.
The wait-list invite already behaves this way.

## Alternatives considered

**Keep it transactional and change nothing.** Defensible on the merits, and it is what the code did.
Rejected as the asymmetric bet described above: it leaves an open compliance question sitting on a
live shop's sending domain to save a day's work.

**Transactional, but honour an existing opt-out** — no footer link, but never send to someone who
already unsubscribed. Half the protection and the more confusing half: the recipient has no way to
reach that state from this message, so the opt-out only helps people who already found another one.

**Delete the feature.** Recovery emails work and 20260726 made a sound case for them; the question
was what rides along with the message, not whether it goes.

**A shop-scoped email suppression list**, so an address with no person row could still be given a
working unsubscribe link and sent to. The general answer, and probably the right one eventually — it
is what would let this send reach a purchaser who is not themselves a diver. Rejected as scope: it is
a new table with its own erasure, export, and staff-surface consequences, and the case it unlocks is
narrow enough to be worth deciding on its own rather than inside a consent fix.

## Consequences

Easy: the three no-booking sends now behave identically, which is one rule to hold rather than three
to remember. The `unaddressable` and `optedOut` counters make both new refusals visible in the cron
summary.

Hard: a purchaser who is not a diver on their own party's booking now receives no recovery mail at
all, where before they received one. That is a real, if narrow, loss of a legitimate nudge, and it is
the price of not sending a commercial message nobody can unsubscribe from. The suppression-list
alternative above is the fix if it turns out to matter.

Also worth knowing: this decides the *rule*, not just this send. The next message DiveDay adds that
reaches someone without a confirmed booking has a precedent to be read against — H-09's transactional
basis covers messages attached to a booking that exists, and nothing else.
