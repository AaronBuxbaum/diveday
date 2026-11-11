# 20261111-square-receipt-evidence — Square is read-only receipt evidence, not a second payment path

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Aaron asked for recording purchases already paid at the counter, including merchandise, and
Square integration that keeps DiveDay simple. He explicitly deferred POS/card acceptance, not
integrations. [Issue #4298](https://github.com/AaronBuxbaum/diveday/issues/4298) owns this slice.

The [provider connector decision](20260827-shop-authorized-provider-connectors.md) allows private,
shop-authorized apps but prohibits inbound provider truth. This decision adds one narrow
exception: authenticated payment evidence explicitly associated by staff with an existing
recorded purchase. It does not authorize automatic imports or inventory/customer synchronization.

## Decision

- Square is optional. Without explicit environment, app credentials and the existing sealing
  key, it makes no network calls and offers no connection. No new runtime dependency.
- An owner/manager authorizes `PAYMENTS_READ` and `MERCHANT_PROFILE_READ`, then chooses an active
  Square location in the shop's currency. OAuth state is single-use, shop/person/environment
  bound; access and refresh tokens use the existing encrypted envelope.
- Staff enter a payment ID on a recorded counter purchase. DiveDay reads only that payment and
  requires completed status, selected location, original gross total, original tip, currency and
  recorded refund total to match. Tax/pass-through classification remains the staff record, not
  something inferred from Square. Mixed/split payments are not automatically apportioned.
- One `(environment, merchant, payment)` can evidence one DiveDay order across the installation.
  The existing sync-map row survives disconnect/reconnect. Rechecks update minimal evidence,
  never balances. Deleting a mistaken link retains the evidence as released history and changes no money. No card, customer, address, contact or provider error payload is retained.
- The collection ledger remains the sole source of the 3% share. Matching cannot append a second
  collection or reverse one. Refunds happen in Square first and are recorded through DiveDay's
  existing manual-return action. A disagreement is visible, never silently reconciled.
- No scheduled sync, webhook, historical import, Square payment/refund write, marketplace listing
  or production connection is introduced. Connections may be removed locally without revoking
  the merchant-wide Square grant used by another DiveDay shop.

## Alternatives considered

- Auto-import every sale: rejected; it would silently decide which unrelated/history sales incur
  DiveDay's fee and could duplicate manually recorded purchases.
- Square application fees: rejected for existing POS receipts; fees attach while the application
  processes a payment, not retroactively to an observed sale.
- Build a POS/terminal: deferred by Aaron's simplicity constraint.

## Consequences

The first slice confirms a receipt rather than removing all re-keying. Connection setup and
rechecks use bounded provider calls. Staff can still record purchases when Square is unavailable.
OAuth credentials require maintenance, and a refresh race may ask staff to retry.

Revisit for explicit receipt import or automatic refund updates only with a defined matching,
split-tender and historical billing policy. Leaving Square means disconnecting the optional
connection; existing purchases, receipts and fee accounting remain intact. Activation and current
API evidence are in the [runbook](../../engineering/square-receipts-runbook.md).
