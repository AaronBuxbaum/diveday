# 20261114-unresolved-offline-roll-call — Preserve ambiguous offline roll call for review

- **Status:** Proposed
- **Date:** 2026-11-14

## Context

An offline tap may name an old ordinal after a schedule change, attaching evidence to the wrong day. A device-only refusal faces the offline retention ceiling, while a batch-wide refusal blocks unrelated work. Missing-person evidence cannot silently become a reassuring count.

## Decision

The following is a proposed target contract, not a claim that the prototype implements or verifies it.

When an authorized sync cannot establish the meeting, store the original observation in a tenant-scoped unresolved ledger, separate from confirmed roll call. Bound and retain its identity, subject, checkpoint, capture context, causal dependencies, instants and reason. A database-enforced shop-and-client-event claim is shared transactionally by accepted, unresolved and resolved states. Check duplicate or conflict against immutable intent before current eligibility and again under lock; different intent cannot reuse an identity. Do not retain sensitive payloads or hashes after erasure solely for replay.

Authenticate staff; validate tenant ownership and the subject’s trip relationship, including removed subjects. Apply the offline note gate even to deferred dependencies. Persist and replay note-disposal receipts; the device applies them before snapshot merging even if refresh fails. Notes may contain health information and follow roll-call authorization, erasure, export and retention rules. Minimized safety facts retained after erasure may remain linkable through trip, event and receipt identifiers; do not describe them as anonymous or claim selective erasure without proof.

A committed handoff receipts the original event and disposal outcome, without confirming roll call. The device retains the event until that receipt is merged transactionally. Dependent chains remain pending or durably linked until their predecessor's actual accepted or reviewed outcome is known. Older clients receive a conservative refusal; capable clients can sync independent work.

Show unresolved claims and uncertainty on live and offline manifests and print; no uncertain positive or cleared claim confirms a count or hides a missing-person alarm. Review shows the original claim and current frontier. An unknown/deferred decision cannot resolve an alarm. A factual resolution explicitly selects a valid meeting and all affected standing evidence, then appends an attributed, idempotent decision under the trip lock and version check; concurrent new evidence reopens review. Never rewrite or backdate evidence, infer a meeting or invent credentials. Restrict or archive referenced meetings; removed or changed subjects and meetings remain visible as uncertainty rather than being reassigned.

Register ledger and decisions for subject, author and reviewer export, merge and erasure. Apply the existing unbounded safety-evidence retention classification for roll-call history and its erasure sweep, including note scrubbing. Before a proven durable handoff, preserve unsent evidence, including unreadable ciphertext; a loss notice is not a handoff or permission to delete it. Authentication and tenant scope still govern any recovery. Do not assume an old key is recoverable merely because ciphertext remains.

### Unresolved reset and intake contract

A reset or reap must not delete a committed sighting, its immutable client identity, or the trip and booking context needed to review it. It must also not acknowledge an intake that it can subsequently orphan. A physical tap must have a durable, tenant-scoped and authenticated destination that does not depend on a long schedule or reset transaction releasing its locks. A timeout, refusal, in-memory retry, or success response before durable handoff does not meet this requirement.

The current preflight, delete rollback and final reset checks protect particular committed orderings but do not serialize intake with reset commit. A PostgreSQL regression holds a reset before commit and shows the sighting insert can time out waiting for its author foreign-key lock, leaving no server observation. The current form does not establish a durable device queue for that attempt. An exclusive shop-wide intake fence has the same starvation problem and is not an accepted resolution.

Any locking design must define a consistent order for every intake, move, reset, erasure and settlement writer. It must not require durable intake to wait behind a long schedule transaction.

Until a reviewed non-starving protocol and its mixed-server cutover are proven, destructive reset/reap and sighting intake cannot be treated as safe concurrently. Either retain the original evidence through a separately durable handoff independent of reset-held locks, or establish a coordinated exclusion that preserves every refused or uncertain tap before it can be lost. Neither option is implemented by this proposal. Do not enable the offline capture, settlement or delivery prototype on the basis of these checks.

Acceptance requires real PostgreSQL tests with reset held before intake and with intake committed before the check, between check and delete, after delete, and around the final check and commit. Tests must verify the original client key, meeting, booking and trip context; retries after response loss; authorization revocation and erasure; and both reset and reap paths. Browser and mixed-version tests must show that a device keeps evidence until an authenticated receipt is durably applied. A passing single ordering does not establish the contract.

## Alternatives considered

- **Infer a meeting from ordinal or clock** — may move an observation to another day.
- **Rely on the device alone as handoff** — does not establish durable server acceptance or authenticated recovery. Preserve unsent ciphertext until a proven safe disposition without assuming it can be decrypted.
- **Discard an ambiguous event** — loses safety evidence and its causal history.

## Consequences

This requires a migration, lifecycle integration, authenticated review and PostgreSQL/browser race tests. A replacement must preserve claims and audit decisions.
