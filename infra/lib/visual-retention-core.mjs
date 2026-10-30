/** Shared, runtime-neutral visual snapshot retention policy. */
export const KEEP_MAIN_BASELINES = 10;
export const KEEP_MAIN_BASELINE_AGE_MS = 72 * 60 * 60 * 1000;
export const CANDIDATE_PAGE_SIZE = 100;
export const MAX_CANDIDATE_PAGES = 4;
export const MIN_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;
/** Keep in-flight publications safe even when a caller lowers the normal age floor. */
export const MIN_PUBLICATION_GRACE_MS = 30 * 60 * 1000;

/** Main's own tips, newest first, following only first-parent links. */
export function mainFirstParentChain(candidates) {
  const positionBySha = new Map(candidates.map((commit, index) => [commit.sha, index]));
  const chain = [];
  const seen = new Set();
  let cursor = candidates[0];
  while (cursor && !seen.has(cursor.sha)) {
    seen.add(cursor.sha);
    chain.push(cursor);
    const next = cursor.parentSha ? positionBySha.get(cursor.parentSha) : undefined;
    cursor = next === undefined ? undefined : candidates[next];
  }
  return chain;
}

/** Unknown commit dates stay inside the keep window. */
export function outsideMainBaselineAgeWindow(commit, now) {
  return commit.committedAtMs !== null && now - commit.committedAtMs > KEEP_MAIN_BASELINE_AGE_MS;
}

/** Whether fetched history already reaches beyond both retention floors. */
export function chainCoversMainBaselineFloors(chain, now) {
  return (
    chain.length >= KEEP_MAIN_BASELINES &&
    outsideMainBaselineAgeWindow(chain[chain.length - 1], now)
  );
}

/** Shared page stop rule for GitHub ancestry fetchers. */
export function shouldFetchAnotherCandidatePage(page, returnedCount, candidates, now) {
  if (page >= MAX_CANDIDATE_PAGES || returnedCount < CANDIDATE_PAGE_SIZE) return false;
  return !chainCoversMainBaselineFloors(mainFirstParentChain(candidates), now);
}

/** Whether probing should stop before this older main tip. */
export function shouldStopMainBaselineProbes(verifiedKeepCount, commit, now) {
  return verifiedKeepCount >= KEEP_MAIN_BASELINES && outsideMainBaselineAgeWindow(commit, now);
}

/** Chain-first snapshot probe order, with the compatibility fallback for malformed parent data. */
export function mainBaselineProbeOrder(candidates) {
  const chain = mainFirstParentChain(candidates);
  return {
    chain,
    fallback: chain.length <= 1 && candidates.length > 1 ? candidates : [],
  };
}
