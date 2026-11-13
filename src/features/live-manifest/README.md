# Live manifest

This feature is work in progress. `cache.ts` is an unwired storage experiment; it must not be used as an authorization or freshness boundary. Its public runtime export is limited to client recovery; server-only proofs live in the separate `live-manifest-server` feature.

Its separate IndexedDB database keeps encrypted candidate projections and local request, session, shop and pending-write fences without modifying the offline event ledger. Cache hits are unconfirmed. Cleanup is opportunistic and bounded per activation, not a deletion deadline.

The experimental recovery protocol stores a nonce with a specific erasure tombstone and consumes it atomically. `POST /api/offline-manifests/recovery` reports a recent live staff/session/epoch observation, and `recovery-client.ts` matches that observation to the local challenge. It can reopen only the local write fence; it cannot authorize showing a cached roster. The projection proof helper and the manifest page remain unconnected.

Before integration it still needs server-authenticated projection and session provenance, trip-specific expiry, authorized rebootstrap after erasure, participation by every local writer and worker, and cross-document view invalidation. It cannot detect remote changes while offline. Browser concurrency, identity and erasure tests and independent domain and security reviews are required.
