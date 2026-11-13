/** offline-manifest-snapshots public contract. Internals are imported only within this module. */

export { buildOfflineManifestCopies } from "./payload";
export { signRosterConfirmation, verifyRosterConfirmation } from "./roster-confirmation";
export type { IssuedOfflineManifestSnapshot, OfflineManifestReadAt } from "./store";
export {
  issueOfflineManifestSnapshot,
  latestOfflineManifestSnapshotRevisions,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";
export { offlineSyncInstants } from "./sync-instants";
