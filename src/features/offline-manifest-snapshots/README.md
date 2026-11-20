# offline-manifest-snapshots

This module owns the offline manifest snapshots use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
  - `readOfflineManifestRosterWithWindows`: the manifest page's read. It reads the erasure epoch
    first, then the revision, roster, and meeting windows in one read-only repeatable-read snapshot.
  - `issueOfflineManifestSnapshotAtSchedule`: a device's save of those rows, under the shared erasure fence:
    the snapshot id, the next revision and the signed epoch. Refused before any write when the
    epoch moved since the read (`erasure_epoch_moved`) or another snapshot was issued since
    (`snapshot_superseded`, an atomic compare-and-increment on the counter) (issue #4391). Served
    by `POST /api/offline-manifests/[tripId]/snapshot/v2`. It also compares the trip times and
    meeting windows after locking the live, tenant-owned trip; a mismatch refuses the save.
    The client-supplied schedule is a concurrency check, not proof of capture or historical identity.
    The old route refuses claims on updated servers. New clients do not fall back when an old server
    lacks v2. Old clients reaching old servers retain the old behavior until those servers are drained.
  - `nextOfflineManifestSnapshotRevision`: the unconditional increment for the background board,
    which reads its rows after taking the revision in the same fenced transaction.

  - `latestOfflineManifestSnapshotRevisions`: each departure's latest issued revision, returned by
    the offline sync route with its results. A tap settled at revision `r` is in every copy of
    revision `r + 2` or later, which is what lets a device stop reading its own synced tap ahead
    of the copy. This holds only while every issuer reads its rows after taking or reading its
    revision.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their
existing tenant and authorization checks. A saved copy's token never carries an epoch newer than
the erasures its rows reflect, and a higher revision always belongs to a later read of the rows,
so a newer copy on a device is never replaced by an older read.

## Committed instants at sync

A client requesting `includeStoredInstants` gets the committed timestamp for successful event ids, including duplicates. `offlineSyncInstants` reads these timestamps after the writers commit; a retry never invents a new stored time. The browser preserves raw `occurredAt` for local queue ordering and keeps `storedOccurredAt` for comparisons with server snapshots. An unsynced missing-diver mark following the same device's saved applied mark remains visible even when its raw clock is behind the server.

This does not infer cross-device chronology. Fast and slow clocks, a clock corrected between taps, and late sync remain unresolved in #4418. A send/receive offset was investigated and rejected: transport delay can shift an old aboard mark past a newer missing-diver mark. Resolving that needs causal conflict handling, not a guessed wall-clock offset. The automated route/database and IndexedDB tests simulate devices; they are not a physical two-device rehearsal.

## Generations survive a restore

Meeting and seat generations are random fingerprints (`src/db/offline-generation.ts`): only equality is compared. A restore rewinds the database, and a sequential counter would hand the lost branch's number to a different edit; a random step makes the rewound branch draw a new one, so evidence captured on the lost branch is held for review. `restore-drill.postgres.test.ts` demonstrates this on a real server.
