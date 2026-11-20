# 20261119-offline-roll-call-review — Hold unavailable offline observations for review

- **Status:** Accepted
- **Date:** 2026-11-19

## Current implementation

The later witnessed sync protocol 3 supersedes the protocol-2 rollout described below. New seat observations reconcile only when their signed meeting, assignment and causal context remains current; other observations remain for review. Snapshot and medical readers retain protocol 1. A previously accepted unbound offline mark is not proof of the current meeting. The restore stop remains in the [runbook](../../engineering/backup-and-restore-runbook.md).

Crew observations use the same meeting witness and a continuous crew-assignment identity. A held crew observation stays on the device: staff open the current live roll call, record a fresh count, and explicitly discard the saved observation. If retained server evidence has an unknown meeting day, a witnessed current count can record the person while the earlier observation remains unresolved. Ask an owner to inspect the departure log and keep a separate manual record; the app cannot assign or resolve the unknown day. Automatic replay after a restore remains unsupported.

## Context

An offline observation can return after its subject is unavailable. A per-event rejection is treated as settled by the device, allowing the only copy to expire. The reconnect batch can also contain independent observations and causal descendants. See #4787.

## Decision

Sync protocol 2 keeps an unavailable roll-call observation pending with a review marker. Its causal descendants are held for review; independent observations may sync. Held notes still receive the existing server erasure and unverified-snapshot dispositions. Staff are told to use manual roll call and review the observation; this is not an automatic reconciliation or a server receipt.

IndexedDB version 2 preserves existing stores but prevents a cached version-1 shell from rewriting review state. A blocked upgrade fails rather than continuing later. Protocol 1 sync is refused on updated servers; protocol 2 is refused by old servers. Cached old shells require an update before they can use upgraded storage. This does not fence old deployments or already-running requests.

Existing expiry and its 28-day pending grace remain. At the ceiling the device deletes the envelope and records a loss notice, not the original observation. Review does not guarantee indefinite retention.

## Alternatives considered

- **Settle the rejection** — may discard the only offline evidence.
- **Refuse the whole batch** — blocks unrelated observations and can hide note-erasure dispositions.
- **Retain the whole roster indefinitely** — retains shared-device contact and medical data beyond its privacy boundary.

## Consequences

The current device can display unresolved observations without reporting them as accepted; a separate device or old deployment is not fenced by its local marker. The current schedule can still differ after an edit and revert, and recovery across restore, older provider writers, and rare erasure races are not solved. Use manual roll call; keep the restore cutover stop. Revisit when a durable review receipt, meeting generation, minimized retention and provider writer drain are available; migrating devices then requires an explicit protocol and storage transition.
