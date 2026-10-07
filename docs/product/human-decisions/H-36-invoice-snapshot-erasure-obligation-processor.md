# H-36: The invoice-snapshot erasure obligation (processor_erasure_obligations) has no API behind it and is never auto-retried…

- **Status:** Open
- **Human owner:** Product owner (with counsel, alongside H-02)

## Decision or approval needed

The invoice-snapshot erasure obligation (`processor_erasure_obligations`) has no API behind it and is never auto-retried — it closes only when an owner attests they filed Stripe's own data-deletion request for the name/email Stripe snapshotted onto a finalized invoice (`comprehensive-review-20260802` HD-11, second half).

## Minimum outcome to record

Who files that request, and on what cadence (per-erasure, batched monthly, or on demand).

## Unblocks / follow-up

Rides with H-02's retention-window review; the mechanism side is built — see [20260803-processor-erasure-obligations](../../architecture/decisions/20260803-processor-erasure-obligations.md).

Part of the [human decision log](README.md#decision-register).
