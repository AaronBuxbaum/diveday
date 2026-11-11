# 20261111-recorded-purchases-not-pos — Record a received purchase, not a POS sale

- **Status:** Accepted
- **Date:** 2026-11-11
- **Amends:** [20261009-counter-payments](20261009-counter-payments.md)

## Context

Aaron asked to record purchases already paid at a counter, including merchandise, and include
eligible receipts in the existing 3% fee. He prefers simplicity over building POS functionality
now, without ruling it out later. Integrations should keep the system itself simple.

## Decision

Reuse paid counter Orders and their immutable source-owned collection ledger. Provide a received
purchase panel inside Money, available without Stripe setup. Recording is any live staff role;
correction and external refund recording retain owner/manager rights and money step-up. No card
acceptance, inventory, catalog, payment instruction or invoice is created by this doorway.

Received-price line items include any tax and gratuity already collected. Staff can state included
tax and tips; pass-through charges have their own line kind. Missing tax is unknown, not zero tax.
Preserve original splits on the receipt and prorate their retained amounts together through
returns, keeping the fee basis exactly equal to the collection ledger's integer proration.

A stable attempt UUID names one receipt. Equal retries return that receipt; a changed payload is
refused. Refund recording uses the receipt lock, an expected refunded total and a distinct request
UUID. It records money already returned outside DiveDay and never calls a provider to move money.
Provider-backed invoices are refused by the local-return writer. Original purchase details remain
on Orders; refund amount, actor, reason and time use the existing staff activity trail and its
existing erasure/retention policy.

Keep native currency frozen on each receipt and reject a form opened before a shop currency
change. The fee ledger records when the receipt is recorded; an earlier receipt date cannot insert
unbilled money into an already closed billing statement. Existing seat payment marks continue to
record bookings and their partial/mixed receipts; creating a second order for the same money is
not a booking-payment shortcut. Square reconciliation must link to an existing economic receipt,
not manufacture a second fee lot for that same purchase.

Walk-ins have null receipt payers, never invented people. Other purchasing pathways remain named.

## Alternatives considered

- Creating Stripe invoices paid out-of-band for every receipt adds provider dependencies and
  invoices to a fact-recording flow. Existing open Stripe invoices still use that established path.
- A separate purchase ledger duplicates Orders, reporting, exports and the fee source.
- Starting a POS inventory or card-acceptance flow exceeds the requested simple receipt record.

## Consequences

Orders retain new tip/original-split facts in exports. Financial summaries exclude included tips
from sales revenue and explicit tax from the unknown-tax disclosure. Recording does not prove a
bank settlement or replace a fiscal receipt. Accounting integrations receive the existing order
sale/refund events; no extra sale is emitted by a provider link.

The existing QuickBooks adapter does not classify included manual tax or gratuity into separate
accounts. Orders and exports preserve that split, but QuickBooks classification still requires
accounting reconciliation. Recording a receipt is not a promise of automated tax accounting.
