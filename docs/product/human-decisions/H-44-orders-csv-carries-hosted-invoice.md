# H-44: orders.csv carries hosted_invoice_url and invoice_pdf_url — unauthenticated, long-lived, publicly reachable Stripe-hosted pages rendering a…

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

`orders.csv` carries `hosted_invoice_url` and `invoice_pdf_url` — unauthenticated, long-lived, publicly reachable Stripe-hosted pages rendering a diver's name, email, address and line items. `anonymize.ts` already nulls both on erasure for that reason, so a leaked export bundle is a folder of live links to named divers' billing pages (`comprehensive-review-20260802`, found during the 2026-08-06 security review of the export work). `stripe_invoice_id` alone is enough for a leaving shop to reconcile against its own Stripe account.

## Minimum outcome to record

Approve dropping the two URL columns from the published export contract (a diver-privacy improvement with no loss of reconcilable data), or state why they should stay.

## Unblocks / follow-up

Once approved, dropping the columns is a small, contained change to `src/db/export-shop-files.ts` and the export README's documented schema.

Part of the [human decision log](README.md#decision-register).
