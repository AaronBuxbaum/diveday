# disruption-recovery

Records explicit staff follow-up on an existing shop cancellation. Delivery, payment and recovery are independent facts. An unrelated booking never establishes recovery.

`recordRecoveryFollowUp` checks live staff authorization and tenant scope, locks the cancellation-diver row with bounded lock waits, rejects stale forms, and appends an idempotent event. A replacement must already be an active, identity-confirmed booking for the same diver on a different upcoming scheduled departure. This feature never creates or moves bookings, changes readiness, issues credit, or changes refunds.

The reader checks replacement availability live. Canceling or deleting a linked departure, canceling its booking, or changing its identity returns the diver to follow-up; the original association remains in history. The event table contains codes and foreign keys, never names or notes. Actor names resolve through the existing erasure-aware person record. Events stay with the parent cancellation and cascade on its physical deletion, matching the existing cancellation record retention classification.
