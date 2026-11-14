# 20261114-unresolved-offline-roll-call — Preserve ambiguous offline roll call for review

- **Status:** Proposed
- **Date:** 2026-11-14

## Context

An offline tap may name an old ordinal after a schedule change, attaching evidence to the wrong day. A device-only refusal faces the offline retention ceiling, while a batch-wide refusal blocks unrelated work. Missing-person evidence cannot silently become a reassuring count.

## Decision

When an authorized sync cannot establish the meeting, store the original observation in a tenant-scoped unresolved ledger, separate from confirmed roll call. Bound and retain its identity, subject, checkpoint, capture context, causal dependencies, instants and reason. A database-enforced shop-and-client-event claim is shared transactionally by accepted, unresolved and resolved states. Check duplicate or conflict against immutable intent before current eligibility and again under lock; different intent cannot reuse an identity. Do not retain sensitive payloads or hashes after erasure solely for replay.

Authenticate staff; validate tenant ownership and the subject’s trip relationship, including removed subjects. Use the existing erasure fence and trip/subject lock order. Apply the offline note gate even to deferred dependencies. Persist and replay note-disposal receipts; the device applies them before snapshot merging even if refresh fails. Notes may contain health information and follow roll-call authorization, erasure, export and retention rules. Erased subjects retain only permitted de-identified physical evidence.

A committed handoff receipts the original event and disposal outcome, without confirming roll call. The device retains the event until that receipt is merged transactionally. Dependent chains remain pending or durably linked until their predecessor's actual accepted or reviewed outcome is known. Older clients receive a conservative refusal; capable clients can sync independent work.

Show unresolved claims and uncertainty on live and offline manifests and print; no uncertain positive or cleared claim confirms a count or hides a missing-person alarm. Review shows the original claim and current frontier. An unknown/deferred decision cannot resolve an alarm. A factual resolution explicitly selects a valid meeting and all affected standing evidence, then appends an attributed, idempotent decision under the trip lock and version check; concurrent new evidence reopens review. Never rewrite or backdate evidence, infer a meeting or invent credentials. Restrict or archive referenced meetings; removed or changed subjects and meetings remain visible as uncertainty rather than being reassigned.

Register ledger and decisions for subject, author and reviewer export, merge and erasure. Apply the existing unbounded safety-evidence retention classification for roll-call history and its erasure sweep, including note scrubbing. Before a durable handoff, signout, identity switch, purge, revoked access or local expiry may still lose device-only evidence under existing policy; show the limit and loss notice honestly.

## Alternatives considered

- **Infer a meeting from ordinal or clock** — may move an observation to another day.
- **Retain only on the device indefinitely** — conflicts with bounded local retention and tenant rules.
- **Discard an ambiguous event** — loses safety evidence and its causal history.

## Consequences

This requires a migration, lifecycle integration, authenticated review and PostgreSQL/browser race tests. A replacement must preserve claims and audit decisions.
