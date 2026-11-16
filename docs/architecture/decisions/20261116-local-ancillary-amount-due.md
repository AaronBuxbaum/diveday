# 20261116-local-ancillary-amount-due — Record named ancillary amounts due without a provider

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The recorded-purchase workflow captures money already received. Creating an unpaid order previously required a connected payment provider. Aaron requested front-desk additions and reconciliation without external accounts.

## Decision

Use the existing orders ledger with an explicit `local_invoice` collection for a named diver's unpaid rentals and purchases. Creation requires billing permission, a positive native-currency total, no booking link, no provider ids, zero paid amount, and a live payer locked against erasure. It does not settle a booking fare, reserve rental inventory, or charge a card.

Live staff can record the full amount actually received elsewhere, with its actual method, optional reference, and included tax/tip facts. Person and order locks serialize collection with erasure and concurrent receipts. Equal-payload request retries return the original result; changed or competing receipts fail. Collection uses the existing fee-basis journal and paid-order outbox. `counterReceipt` remains explicit receipt provenance after payment and payer erasure. Existing external-return permission, step-up and arithmetic remain authoritative. Managers may void an unpaid local order.

Day summaries read original gross from orders with explicit recorded-receipt provenance, never fee-basis collection entries. Receipt groups name the original receipt method. Returns are reported separately: their existing audit does not record the actual return method. Missing redacted return amounts are incomplete, never zero; dates outside audit retention warn that return history may be missing. Included tax/tip are recorded facts, not a tax calculation or compliance promise.

## Consequences

Walk-in received purchases remain available; unpaid amounts require a named diver. No provider account is necessary. Local orders have no online payment link. The summary supports checking receipts against external records but cannot claim net cash movement without return-method evidence. Source and unit checks cover the workflow; rendered verification and real PostgreSQL concurrency require an allowed execution environment.

## Alternatives considered

Requiring a provider account leaves offline payments and unpaid ancillary balances unavailable. A separate balance ledger duplicates order, refund and collection accounting. Treating an amount due as a received receipt invents payment; linking it to a booking risks clearing the trip fare.
