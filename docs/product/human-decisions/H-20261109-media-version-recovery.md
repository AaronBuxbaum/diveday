# H-20261109-media-version-recovery: How long should older media versions remain recoverable?

- **Status:** Chosen
- **Human owner:** Aaron Buxbaum

## Decision or approval needed

Choose a recovery window for superseded or accidentally deleted media objects without retaining
personal or medical documents after an authorized erasure.

## Minimum outcome to record

Recovery duration, deletion semantics, and the relationship to the existing evidence-retention
policy.

## Unblocks / follow-up

**Chosen 2026-11-09 (Aaron Buxbaum):** retain older media object versions for 30 days. An authorized erasure deletes every version immediately, rather than waiting for that recovery window. This is an object-recovery policy, not a new expiry for current media, customer records, or signed evidence. It does not change incident/legal holds or the broader [evidence-retention decision](H-20260730-evidence-retention-period-deletion.md). Implementation must make failed provider erasures visible and retryable; a provider outage cannot be described as completed erasure. No deployment or live deletion was authorized by this design approval.

Part of the [human decision log](README.md#decision-register).
