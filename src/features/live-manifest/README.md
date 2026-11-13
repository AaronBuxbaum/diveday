# Live manifest

This feature is work in progress and has no public contract. `cache.ts` is an unwired storage experiment; it must not be used as an authorization or freshness boundary.

Its separate IndexedDB database keeps encrypted candidate projections and local request, session, shop and pending-write fences without modifying the offline event ledger. Cache hits are unconfirmed. Cleanup is opportunistic and bounded per activation, not a deletion deadline.

Before integration it still needs server-authenticated projection and session provenance, trip-specific expiry, authorized rebootstrap after erasure, participation by every local writer and worker, and cross-document view invalidation. It cannot detect remote changes while offline. Browser concurrency, identity and erasure tests and independent domain and security reviews are required.
