# 20261028-offline-erasure-loss-notices — Keep actionable erasure notices offline

- **Status:** Accepted (2026-10-28)
- **Date:** 2026-10-28

## Context

Issue #3150 extends the erasure rules in [20260802-diver-data-erasure](20260802-diver-data-erasure.md): stale offline note text is discarded while roll-call and checklist marks and tap times remain. A crew device may be shared across shops; its IndexedDB snapshots do not prove which shop is currently signed in, and no server identity lookup is possible without connectivity. Staff still need to locate each affected saved mark while offline.

## Decision

Keep offline loss notices actionable with short trip and record references, checkpoint or checklist location, and mark disposition. Never include a diver's name or discarded note text. While shop identity is unavailable, show references from the saved device copies and explicitly accept that a shared-device reader may see another shop's references. Once the server verifies the signed-in shop, purge foreign applied snapshots and recompute notices from the retained current-shop copies; never keep a pre-purge reference in UI state. Foreign pending evidence may remain stored for its originating shop but is excluded from verified current-shop notice details. When any such evidence remains, show a tenant-neutral notice on the root list and selected-trip view that staff must sign in to the originating shop to sync or review it, and suppress generic caught-up copy.

## Alternatives considered

- Hide all references until online verification — safer on a shared device but leaves crews unable to locate missing context at the dock.
- Persist a signed tenant credential for offline use — requires expiry, key rotation and revocation rules, and still creates a bounded stale-shop window.

## Consequences

Offline roll call remains usable and each discarded note can be tied to its mark without restoring the erased identity. A shared device can disclose short trip/record references until an online tenant check completes; this is an accepted privacy tradeoff, not tenant confidentiality. Revisit if shops require strict offline tenant confidentiality; doing so requires suppressing references or designing authenticated, expiring offline tenant proof.
