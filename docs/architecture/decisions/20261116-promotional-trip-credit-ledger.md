# 20261116-promotional-trip-credit-ledger — Settle plain booking fares with promotional value

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Aaron requested durable spendable trip credit without provider accounts or live-shop validation ([#4245](https://github.com/AaronBuxbaum/diveday/issues/4245)). Existing shop cancellations owe captured money back; promotional value must never replace that refund guarantee or prepaid dive entitlements.

## Decision

Owners and managers explicitly grant goodwill or promotional value to a live diver in the shop’s current currency. Append-only economic entries record grant, full-fare redemption, and exactly one restoration per debit, with UUID payload-equality replay checks, actor, booking, native currency, integer amount, and time. Balances sum the entire journal, independently of the history page limit, and refuse unsafe integer totals. Other currencies remain visible after a shop changes currency.

The initial redemption covers an existing identity-confirmed unpaid future plain departure. It reuses authoritative participant fare/deposit arithmetic and refuses course, package, provider/mixed/history, charter, tax, pass-through fee, nitrox, and rental ambiguity. Trip, booking, and beneficiary serialization make the debit and the existing payment gate’s `paid` entry one transaction. The payment amount is zero cash, provider `trip_credit`; no collection lot or percentage fee is created. Direct atomic settlement needs no asynchronous reservation state.

Grant/redemption recheck live authorization and beneficiary state. NOWAIT beneficiary locks avoid inversion against audited identity merges, which lock people before their bookings. Identity merge may repoint only the beneficiary; amounts, currencies, kinds, booking/reference identities, timestamps, and UUID payload history never change. Erasure retains the anonymous economic record without restoring personal data. No journal entries are age-pruned because removing a balance component changes outstanding value.

Staff, self-service, shop, and sweep cancellations return only the debit’s promotional amount, once, independently of cash refund windows. Equal/lower-price participant-type corrections preserve the original paid credit coverage; increases and credit-covered moves are refused until allocation is modeled. A cancelled seat’s current `trip_credit_returned` payment marker is backed by ledger evidence; reactivation explicitly retires it. Later cash/provider/package state supersedes that marker. This keeps old credit history from overriding current refunds. Cash refunds retain their existing policy and provider evidence.

Staff records and capability-scoped diver receipts identify promotional coverage and remaining balances. This slice promises no purchased credit, expiry, transfer, cash redemption, mixed tender, or automatic refund-to-credit conversion.

## Alternatives considered

- Generic credit in the cash collection ledger would bill promotional grants or confuse cash refunds.
- Replacing cancellation refunds with credit would violate the current refund guarantee.
- Partial/mixed allocation needs a source-allocation model and is refused until one is reviewed.

## Consequences

The common plain unpaid seat can spend real promotional value without a provider call. Unsupported fares remain on existing payment paths. PostgreSQL contention tests are required for no-double-spend claims; local PGlite proves transactional behavior but not lock contention. Revisit mixed tender only with allocation and reversal proofs; no journal migration is needed for the current source boundaries.
