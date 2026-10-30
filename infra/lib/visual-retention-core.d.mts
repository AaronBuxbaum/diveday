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
export function outsideMainBaselineAgeWindow(commit: RetentionCommit, now: number): boolean;
export function chainCoversMainBaselineFloors(
  chain: readonly RetentionCommit[],
  now: number,
): boolean;
export function shouldFetchAnotherCandidatePage(
  page: number,
  returnedCount: number,
  candidates: readonly RetentionCommit[],
  now: number,
): boolean;
export function shouldStopMainBaselineProbes(
  verifiedKeepCount: number,
  commit: RetentionCommit,
  now: number,
): boolean;
export function mainBaselineProbeOrder<T extends RetentionCommit>(
  candidates: readonly T[],
): { chain: T[]; fallback: readonly T[] };
