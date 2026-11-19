/** offline-manifest-snapshots public contract. Internals are imported only within this module. */

export { buildOfflineManifestCopies } from "./payload";
export {
  signRosterConfirmation,
  signRosterHistoryScope,
  verifyRosterConfirmation,
} from "./roster-confirmation";
export type {
  IssuedOfflineManifestSnapshot,
  OfflineManifestReadAt,
  OfflineManifestSchedule,
} from "./store";
export {
  issueOfflineManifestSnapshot,
  issueOfflineManifestSnapshotAtSchedule,
  latestOfflineManifestSnapshotRevisions,
  nextOfflineManifestSnapshotRevision,
  offlineManifestTripExists,
  readOfflineManifestRoster,
  readOfflineManifestRosterWithWindows,
} from "./store";
export { offlineSyncInstants } from "./sync-instants";
