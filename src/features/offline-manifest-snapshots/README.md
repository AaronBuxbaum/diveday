# offline-manifest-snapshots

This module owns the offline manifest snapshots use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
  - `readOfflineManifestRoster`: the manifest page's read, on the pool and writing nothing: the
    manifests and the shop erasure epoch they were read at (epoch first, rows after).
  - `issueOfflineManifestSnapshot`: a device's save of those rows, under the shared erasure fence:
    the snapshot id, the next revision and the signed epoch, refused before any write when the epoch
    moved since the read (issue #4391). Served by `POST /api/offline-manifests/[tripId]/snapshot`.
  - `nextOfflineManifestSnapshotRevision`: the per-trip revision counter both savers share.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. A saved copy's token never carries an epoch newer than the erasures its rows reflect.
