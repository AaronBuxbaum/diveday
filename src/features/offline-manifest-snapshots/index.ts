/** offline-manifest-snapshots public contract. Internals are imported only within this module. */
export type { IssuedOfflineManifestSnapshot } from "./store";
export {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";
