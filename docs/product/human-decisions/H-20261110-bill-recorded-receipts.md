# H-20261110-bill-recorded-receipts: Bill recorded receipts across payment methods

- **Status:** Resolved
- **Date:** 2026-11-10

## Decision

Aaron: “Yes, 3% of when money is recorded as received, regardless of payment method. Let's do all of this work. There are no existing customers, so you can make sweeping changes here. Also make sure to update the copy. Use Sol 6.1.”

The fee is based on recorded receipts, not unpaid booking value. The default remains no monthly
fee plus 3%. Cash and external methods count alongside online payments. Implementation and the
refund/currency invariants are in
[the collections ADR](../../architecture/decisions/20261110-recorded-collections-own-billing.md).
