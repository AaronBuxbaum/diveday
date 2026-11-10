# 20261110-whatsapp-delivered-usage — Count verified deliveries by sending account

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

ENG-04 replaces the obsolete conversation-based WhatsApp cost model. Meta's
[platform pricing](https://whatsappbusiness.com/products/platform-pricing/) charges by delivery,
category and market. A subscribed Meta app is not evidence that DiveDay pays every connected
WABA's invoice. Notification tracking misses secondary courtesy sends.

## Decision

The signed webhook records each observed `delivered` status in `whatsapp_delivered_usage`,
scoped to the shop, sending number and WABA verified in the same database statement. A unique
shop/number/message fingerprint makes duplicate and out-of-order delivery callbacks one unit.
Missing classification may be enriched by a repeated callback without moving its delivery time.
`sent`, `failed` and read receipts do not add units. Missing, future or expired event times are
not assigned to the current billing period. A separate number-assignment timestamp changes only
when the number or WABA changes; pre-assignment deliveries cannot cross to a new tenant. The
first partial second is conservatively omitted because Meta timestamps have second precision.

Keep only allowlisted `pricing` fields: model, category, type and billable. Missing or unfamiliar
fields stay unknown independently. No monetary estimate is made: recipient market, rate/version,
currency, volume tier and invoice payer need verified account evidence. A billable flag is not a
price. Remove the 1,000-conversation guardrail rather than relabeling it as a message allowance.

Store a SHA-256 fingerprint of shop, number and opaque provider message id, never the raw id,
recipient, body, conversation id or read time. This is account-level operational accounting,
not a new person record. It has no person reference or new recipient association for diver export
or erasure. The full shop export includes the ledger. Shop deletion cascades it; schedule reset
leaves it alone. The existing delivery-trail retention window of 400 days also governs this ledger;
rejecting older callbacks prevents expired replay from creating new units after pruning.

## Alternatives considered

Counting sends overstates delivered usage; joining only tracked notifications misses
courtesy sends; copying recipient numbers to infer rates creates personal data without proving a
market or billing tier; inventing an app-level allowance misrepresents account responsibility.

## Consequences

`readWhatsAppDeliveredUsage` returns tenant-scoped counts grouped by account and classification,
with an explicit verified-webhook source and null monetary evidence. These are deliveries observed
since deployment, not complete historical usage or an invoice. Webhook gaps and disconnected
accounts can leave missing usage; reconciliation must expose that limit.

Revisit when verified rate cards, billing markets and account invoices are available. Adding a
versioned rate/reconciliation source is then a separate schema and authorization change; the
original delivery evidence need not be rewritten. No live credentials, account settings or
production migration are changed by this decision.
