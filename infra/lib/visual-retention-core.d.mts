export interface RetentionCommit {
  sha: string;
  parentSha: string;
  committedAtMs: number | null;
}

export const KEEP_MAIN_BASELINES: number;
export const KEEP_MAIN_BASELINE_AGE_MS: number;
export const CANDIDATE_PAGE_SIZE: number;
export const MAX_CANDIDATE_PAGES: number;
export const MIN_PRUNE_AGE_MS: number;
export const MIN_PUBLICATION_GRACE_MS: number;
export function mainFirstParentChain<T extends RetentionCommit>(candidates: readonly T[]): T[];
export interface RetentionPolicy {
  keepBaselines?: number;
  keepAgeMs?: number;
}
export function outsideMainBaselineAgeWindow(
  commit: RetentionCommit,
  now: number,
  keepAgeMs?: number,
): boolean;
export function chainCoversMainBaselineFloors(
  chain: readonly RetentionCommit[],
  now: number,
  policy?: RetentionPolicy,
): boolean;
export function shouldFetchAnotherCandidatePage(
  page: number,
  returnedCount: number,
  candidates: readonly RetentionCommit[],
  now: number,
  policy?: RetentionPolicy,
): boolean;
export function shouldStopMainBaselineProbes(
  verifiedKeepCount: number,
  commit: RetentionCommit,
  now: number,
  policy?: RetentionPolicy,
): boolean;
export function mainBaselineProbeOrder<T extends RetentionCommit>(
  candidates: readonly T[],
): { chain: T[]; fallback: readonly T[] };

export const BLOB_RETENTION_MS: number;
export interface BlobRow {
  key: string;
  size?: number;
  etag?: string | null;
  lastModifiedMs?: number | null;
}
export function blobHashFromKey(key: string): string | null;
export function blobHashesFromReport(report: unknown): Set<string> | null;
export function planBlobPrune(input: {
  manifests: readonly unknown[];
  blobs: readonly BlobRow[];
  now: number;
  retentionMs?: number;
}): { safe: boolean; reason: string; referenced: number; keep: BlobRow[]; remove: BlobRow[] };
export interface BlobPruneResult {
  skipped: string | null;
  referenced: number;
  keptCount: number;
  wouldDeleteCount: number;
  deletedCount: number;
  deletedBytes: number;
  wouldDeleteBytes: number;
  errors: string[];
  dryRun: boolean;
}
export function pruneBlobs(input: {
  keepShas: readonly string[];
  readManifest: (sha: string) => Promise<unknown>;
  listBlobs: () => Promise<BlobRow[]>;
  deleteBlobs: (rows: BlobRow[]) => Promise<{ deleted: string[]; errors: string[] }>;
  now?: number;
  retentionMs?: number;
  dryRun?: boolean;
}): Promise<BlobPruneResult>;
