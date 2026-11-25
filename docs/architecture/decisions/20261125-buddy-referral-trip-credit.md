# 20261125-buddy-referral-trip-credit — Credit a referrer once per friend who dived

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Issue [#4260](https://github.com/AaronBuxbaum/diveday/issues/4260) (Aaron, option A): a diver whose Bring a buddy link brings a friend earns promotional trip credit once the friend has dived, on the ledger from [20261116-promotional-trip-credit-ledger](20261116-promotional-trip-credit-ledger.md). That ledger's grants need an owner or manager actor. A referral is earned, not chosen, so nobody is at a keyboard when it is due. No cap until real use shows a problem.

## Decision

- **A third grant reason, `referral`, written only by the system.** `trip_credit_entries_shape` admits it exactly as `kind = 'grant'`, `reason = 'referral'`, `booking_id` set to the friend's seat, no restored entry, no actor. Staff forms offer only `goodwill` and `promotion` (`STAFF_TRIP_CREDIT_REASONS`); `grantTripCredit` refuses `referral`.
- **The amount is a shop setting**, `shops.buddy_credit_cents`, from 0 (default, off) to 1,000,000 minor units, in the shop's currency at grant time. It sits on Settings → Money and the Features page's Bring a buddy row links to it. Switching Bring a buddy off earns nothing new; earned credit stays.
- **"Dived" is the shared dive-day rule**, `numberedDiveDay` (a live diver seat with confirmed identity, not `no_show`). It is narrowed by: the seat is still held (`booked`), the departure is scheduled and not a rehearsal, it is past the `back_grace_over` rung, and no standing departure roll call says `not_boarded` for the seat. The friend must be a different person from the referrer, and the referrer must be live (not erased, removed or merged).
- **Once per friend.** A referrer earns one credit per distinct friend, the same count `friendsBroughtBy` shows. Every seat a friend books again on the same link earns nothing more. The entry id is a version-5 UUID of the friend's booking id (`buddyCreditEntryId`). A partial unique index, `trip_credit_entries_referral_once` on `(shop_id, booking_id) where reason = 'referral'`, means a re-read or a racing tick inserts nothing (`ON CONFLICT DO NOTHING`).
- **Where it runs:** the hourly shop tick's `buddy-credits` scan, at most 200 referrals a run. Each runs in its own transaction, locking the shop row (share) and then the referrer (`lockTripCreditPerson`), both NOWAIT, in `grantTripCredit`'s order. It rechecks eligibility under that lock. A busy lock is retried next hour.

## Alternatives considered

- **Grant at booking time, reverse on cancel**: credit before the dive would need reversal entries, and the ledger has none for grants.
- **One credit per seat**: a friend booking five cheap trips on one link would earn five credits.
- **Require a departure `boarded` roll call**: shops do not always take one. The dive-day rule already treats an unmarked held seat on a finished departure as dived.

## Consequences

Referral credit spends, restores, exports, merges and survives erasure exactly like any grant. Nothing caps the total. If abuse appears, add a per-referrer cap or require boarded evidence in the eligibility query; no journal change is needed. The scan's limit bounds one tick. A backlog drains at 200 an hour.
