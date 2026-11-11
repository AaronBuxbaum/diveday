# offline-manifest-snapshots

This module owns the offline manifest snapshots use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
  - `readOfflineManifestRoster`: the manifest page's read, on the pool and writing nothing: the
    manifests, and the shop erasure epoch and the trip's snapshot revision they were read at (both
    read before any row).
  - `issueOfflineManifestSnapshot`: a device's save of those rows, under the shared erasure fence:
    the snapshot id, the next revision and the signed epoch. Refused before any write when the
    epoch moved since the read (`erasure_epoch_moved`) or another snapshot was issued since
    (`snapshot_superseded`, an atomic compare-and-increment on the counter) (issue #4391). Served
    by `POST /api/offline-manifests/[tripId]/snapshot`.
  - `nextOfflineManifestSnapshotRevision`: the unconditional increment for the background board,
    which reads its rows after taking the revision in the same fenced transaction.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their
existing tenant and authorization checks. A saved copy's token never carries an epoch newer than
the erasures its rows reflect, and a higher revision always belongs to a later read of the rows,
so a newer copy on a device is never replaced by an older read.
