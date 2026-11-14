# 20261114-unresolved-offline-roll-call — Preserve ambiguous offline roll call for review

- **Status:** Proposed
- **Date:** 2026-11-14

## Context

An offline tap may name an old ordinal after a schedule change, attaching evidence to the wrong day. A device-only refusal faces the offline retention ceiling, while a batch-wide refusal blocks unrelated work. Missing-person evidence cannot silently become a reassuring count.

## Decision

The following is a proposed target contract, not a claim that the prototype implements or verifies it.

When an authorized sync cannot establish the meeting, store the original observation in a tenant-scoped unresolved ledger, separate from confirmed roll call. Bound and retain its identity, subject, checkpoint, capture context, causal dependencies, instants and reason. A database-enforced shop-and-client-event claim is shared transactionally by accepted, unresolved and resolved states. Check duplicate or conflict against immutable intent before current eligibility and again under lock; different intent cannot reuse an identity. Do not retain sensitive payloads or hashes after erasure solely for replay.

Authenticate staff, enforce tenant and subject scope, and apply note, export and erasure rules to deferred dependencies. Preserve disposal receipts and avoid claiming selectively erased or anonymous data without proof.

A committed handoff receipts the original event and disposal outcome, without confirming roll call. The device retains the event until that receipt is merged transactionally. Dependent chains remain pending or durably linked until their predecessor's actual accepted or reviewed outcome is known. Older clients receive a conservative refusal; capable clients can sync independent work.

Show unresolved claims and uncertainty on live and offline manifests and print; no uncertain positive or cleared claim confirms a count or hides a missing-person alarm. Review shows the original claim and current frontier. An unknown/deferred decision cannot resolve an alarm. A factual resolution explicitly selects a valid meeting and all affected standing evidence, then appends an attributed, idempotent decision under the trip lock and version check; concurrent new evidence reopens review. Never rewrite or backdate evidence, infer a meeting or invent credentials. Restrict or archive referenced meetings; removed or changed subjects and meetings remain visible as uncertainty rather than being reassigned.

Register ledger and decisions for export, merge and erasure. Preserve unsent evidence, including unreadable ciphertext, until a proven safe disposition; retention does not prove key recovery.

The unresolved reset, intake and move requirements, proposed ledger slice, and acceptance matrix are preserved in the [reset and intake investigation](../../engineering/offline-roll-call-reset-intake-investigation.md). None of those proposals establishes a safe cutover or authorizes enabling capture, settlement or delivery.

## Alternatives considered

- **Infer a meeting from ordinal or clock** — may move an observation to another day.
- **Rely on the device alone as handoff** — does not establish durable server acceptance or authenticated recovery. Preserve unsent ciphertext until a proven safe disposition without assuming it can be decrypted.
- **Discard an ambiguous event** — loses safety evidence and its causal history.

## Consequences

This requires a migration, lifecycle integration, authenticated review and PostgreSQL/browser race tests. A replacement must preserve claims and audit decisions.
