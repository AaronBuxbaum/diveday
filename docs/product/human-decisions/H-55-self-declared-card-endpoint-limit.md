# H-55: How should the self-declared-card endpoint limit repeated declarations?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

How should the self-declared-card endpoint limit repeated declarations? (Issue #612.)

## Minimum outcome to record

A bound that reflects declaration work, remains safe for a batch request, and does not turn a large but valid import into a fixed-request-size failure.

## Unblocks / follow-up

**Decided 2026-08-22 (Aaron Buxbaum):** rate-limit by the number of declarations, not by request count; the endpoint validates and processes each declaration in the batch, with a minimum budget for an empty/small request. The implementation loops the declaration count and keeps the existing transaction/deadlock fix from #654.

Part of the [human decision log](README.md#decision-register).
