# 20261116-complimentary-classroom-recovery — Keep classroom recovery separate from diving and money

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

A weather cancellation can leave divers ashore who would welcome a classroom activity. A classroom is not a boat, shore or pool departure and must not acquire boarding, certification or payment authority by being encoded as one. The existing shop-cancellation refund guarantee remains in force.

## Decision

Record complimentary classroom arrangements only after the source departure has been cancelled. Staff name a time, location, capacity and active coordinator and attest that arrangements have been checked. These are human arrangements, without external room or credential validation.

Keep immutable prepared-offer facts separate from current place allocations and immutable transition evidence. Preparing never means sending; staff confirm a place after contact. Activity locks serialize allocation and capacity changes; durable attempt IDs and revision checks protect retries and concurrent edits. Erasure never establishes cancellation or releases a promised place. Identity merge reconciles duplicate allocations and preserves provenance.

The public schedule's existing non-bearer inquiry accepts validated nonpersonal activity context. An inquiry neither identifies a customer nor reserves a place. Disabled date requests offer existing shop contacts or an honest manual message. Public facts exclude staff and roster identities.

No booking, boarding, course evidence, entitlement, payment, refund or credit writer participates. The original automatic-refund default remains unchanged. Existing cancellation-record retention and anonymized identity references apply; no new evidence duration is invented.

## Alternatives considered

- **Use a classroom dive mode or course session** — would give an activity unrelated safety and training semantics.
- **Replace the refund with paid classroom credit** — needs a separate commercial and refund-policy design.
- **Automatically confirm from an email reply** — contact information does not establish source-diver identity.

## Consequences

Staff can arrange a useful non-diving outcome while refunds continue independently. This records confirmed places, not attendance or certification. Paid instruction, automatic sending, external scheduling or actual attendance would require explicit additional transitions and a new review of authority and erasure boundaries.
