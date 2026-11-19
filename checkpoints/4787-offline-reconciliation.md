# Offline reconciliation checkpoint

This branch preserves executable investigation only; it is not a proposed application change or pull request. It is based on main `d358df4483acc8265c405d6f3fef6c29107f3898`.

- `src/app/api/offline-manifests/sync/route.provisional.test.ts` contains two intentionally failing route regressions: an authentic snapshot is replayed after an end-time edit and revert, changing the manifest or signing off a checklist.
- `src/db/offline-version-fence-prototype.postgres.test.ts` uses an isolated PostgreSQL test database and installs test-only triggers and synthetic HMAC proof. It exercises old offline writers, live writers, no-op, edit/revert, move/back, subject move/back, same-subject and unrelated changes, idempotent replay, and gated writer/intake orderings. Its two intentionally failing checks are the old checklist undo's false duplicate and the accepted offline aboard mark remaining authoritative after a subsequent schedule edit. The test-only session setting is cooperative, not cryptographic database authority; the synthetic signer is not the application snapshot issuer.

Use a disposable PostgreSQL 16 instance and set `DIVEDAY_TEST_POSTGRES_URL` to its connection URL before running the `*.postgres.test.ts` file. The helper creates and drops its own migrated scratch database. The route regression uses the repository's PGlite test fixture. Do not run these tests against production.

The experiment does not implement a generation-scoped manifest projection, update partner readers, provide a review UI, or establish a mixed-version production drain. Issue #4787 remains open; #4797 tracks the checklist duplicate, and #4794 is the separate arrival collision.
