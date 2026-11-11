# 20261110-recorded-collections-own-billing — Bill recorded collections, not payment methods

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [20261108-configured-pricing](20261108-configured-pricing.md)

## Context

Aaron chose 3% when money is recorded received, regardless of payment method, and confirmed there
are no existing customers. The old fee base excluded cash and external payments, reread mutable
balances, and displayed every amount as USD. Those behaviors cannot describe the new offer.

## Decision

- Append native-currency collection lots and linked reversals in `collection_entries`, atomically
  with the source writer. An order or checkout owns its receipt; a hand-marked seat owns its cash.
  Receipt-to-seat cascades, package redemptions and imported history create no second collection.
- Require a known amount and currency. Quotes are not settlement evidence. Incomplete or
  contradictory checkout settlement evidence blocks closing that shop's affected month. Include
  deposits when recorded and only incremental balances later. A replay with the same source
  balance appends nothing under the source lock.
- Exclude separately recorded tax, tips and pass-through charges. Prorate partial receipts and
  reversals in integer minor units. Unknown counter tax is not invented: the full recorded amount
  counts, disclosed in Billing and terms. Retain the original tax split through refund failures.
- Reverse newest collection lots first. Closed statements and their lot allocations are
  immutable. Late refunds credit the original statement's rate and rounding; credits carry as
  currency amounts, not volume repriced at a later rate. Failed refunds reverse those credits.
- Serialize closes per shop and refuse backwards or unfinished closes. Keep currencies separate.
  The existing meter is USD-only; non-USD statements remain unreported until native billing is
  configured. No exchange rate or USD equivalent is inferred.
- A mixed seat keeps its Stripe pointer and a separate manual-held amount. Paid-webhook
  replays cannot erase it. External return amounts cannot exceed manual-held money and require
  refund rights and a current payment version. Mixed refunds route to staff; never ask Stripe to return cash.
- Keep this fee evidence while the billing record exists. It contains source references and
  amounts, not names or contact details. Existing source records retain their erasure treatment.
  A source exceeding the close's explicit 50,000-entry bound fails visibly rather than truncating.

## Alternatives considered

- Sum current paid rows: loses partial-payment timing and rewrites earlier evidence.
- Charge every seat: double-bills packages and checkout/order cascades.
- Carry refunded volume: changes the credit when the rate changes.
- Convert to USD using a guessed or current rate: invents a financial fact.

## Consequences

Billing and pricing/terms copy now describe recorded collections across methods. Operators must
verify test-mode money, refunds and currency handling before enabling live billing. An ended
subscription retains its credit statements; unused credit after cancellation requires settlement,
not expiration. Revisit the bounded reader before a shop reaches its entry ceiling; incremental
statement checkpoints can replace historical scans without changing immutable evidence.
