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
export function outsideMainBaselineAgeWindow(commit, now, keepAgeMs = KEEP_MAIN_BASELINE_AGE_MS) {
  return commit.committedAtMs !== null && now - commit.committedAtMs > keepAgeMs;
}

/** Whether fetched history already reaches beyond both retention floors. */
export function chainCoversMainBaselineFloors(chain, now, policy = {}) {
  const { keepBaselines = KEEP_MAIN_BASELINES, keepAgeMs = KEEP_MAIN_BASELINE_AGE_MS } = policy;
  return (
    chain.length >= keepBaselines &&
    outsideMainBaselineAgeWindow(chain[chain.length - 1], now, keepAgeMs)
  );
}

/** Shared page stop rule for GitHub ancestry fetchers. */
export function shouldFetchAnotherCandidatePage(page, returnedCount, candidates, now, policy) {
  if (page >= MAX_CANDIDATE_PAGES || returnedCount < CANDIDATE_PAGE_SIZE) return false;
  return !chainCoversMainBaselineFloors(mainFirstParentChain(candidates), now, policy);
}

/** Whether probing should stop before this older main tip. */
export function shouldStopMainBaselineProbes(verifiedKeepCount, commit, now, policy = {}) {
  const { keepBaselines = KEEP_MAIN_BASELINES, keepAgeMs = KEEP_MAIN_BASELINE_AGE_MS } = policy;
  return verifiedKeepCount >= keepBaselines && outsideMainBaselineAgeWindow(commit, now, keepAgeMs);
}

/** Chain-first snapshot probe order, with the compatibility fallback for malformed parent data. */
export function mainBaselineProbeOrder(candidates) {
  const chain = mainFirstParentChain(candidates);
  return {
    chain,
    fallback: chain.length <= 1 && candidates.length > 1 ? candidates : [],
  };
}

/**
 * Unreferenced content-addressed blobs (`blobs/<sha256>.png`) are kept this long
 * after they were written. A blob is uploaded before the report that names it,
 * and a superseded main capture is exactly what a repeated-capture (flake)
 * comparison wants, so recent history stays comparable. Referenced blobs are
 * kept at any age.
 */
export const BLOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const BLOB_KEY = /^blobs\/([0-9a-f]{64})\.png$/u;
const BLOB_HASH = /^[0-9a-f]{64}$/u;

/** The hash a blob key is named for, or null for anything else under `blobs/`. */
export function blobHashFromKey(key) {
  return BLOB_KEY.exec(key)?.[1] ?? null;
}

/**
 * The blob hashes one reg-suit report (`out.json`) references, or null when the
 * report is not something to trust. A report with no `actualBlobs` (every
 * snapshot from before blobs existed) references none; a malformed map
 * references an unknown set, which is why it is null rather than empty.
 */
export function blobHashesFromReport(report) {
  if (report === null || typeof report !== "object" || Array.isArray(report)) return null;
  const map = report.actualBlobs;
  if (map === undefined) return new Set();
  if (map === null || typeof map !== "object" || Array.isArray(map)) return null;
  const hashes = new Set();
  for (const hash of Object.values(map)) {
    if (typeof hash !== "string" || !BLOB_HASH.test(hash)) return null;
    hashes.add(hash);
  }
  return hashes;
}

/**
 * Decides which blobs may go. Deletes only a blob that is named by no kept main
 * manifest AND is older than the retention window, and refuses to decide at all
 * (`safe: false`, nothing to delete) unless every kept manifest was read and
 * parsed and together they name at least one blob. "Could not read main's
 * manifest" and "main references nothing" are both far more likely to be a
 * broken read than the truth, and either would otherwise condemn every blob.
 * An unknown write time counts as new, and a key that is not a blob is left alone.
 */
export function planBlobPrune({ manifests, blobs, now, retentionMs = BLOB_RETENTION_MS }) {
  const refuse = (reason) => ({ safe: false, reason, referenced: 0, keep: [...blobs], remove: [] });
  if (manifests.length === 0) return refuse("no kept manifest to read");
  const referenced = new Set();
  for (const manifest of manifests) {
    const hashes = blobHashesFromReport(manifest);
    if (hashes === null) return refuse("a kept manifest is unreadable or malformed");
    for (const hash of hashes) referenced.add(hash);
  }
  if (referenced.size === 0) return refuse("kept manifests reference no blobs");

  const keep = [];
  const remove = [];
  for (const blob of blobs) {
    const hash = blobHashFromKey(blob.key);
    const young =
      blob.lastModifiedMs === null ||
      blob.lastModifiedMs === undefined ||
      now - blob.lastModifiedMs < Math.max(retentionMs, MIN_PUBLICATION_GRACE_MS);
    if (hash === null || referenced.has(hash) || young) keep.push(blob);
    else remove.push(blob);
  }
  return { safe: true, reason: "", referenced: referenced.size, keep, remove };
}

/**
 * Runs the blob pass through injected adapters, so the CLI and the Lambda share
 * one flow and differ only in how they talk to S3. Never throws on a refusal: a
 * skipped pass is a result (`skipped`), because the snapshot prune beside it has
 * already done its job.
 *
 * `readManifest(sha)` resolves a parsed report or null; `listBlobs()` resolves
 * `{ key, size, etag, lastModifiedMs }` rows; `deleteBlobs(rows)` resolves
 * `{ deleted, errors }`.
 */
export async function pruneBlobs({
  keepShas,
  readManifest,
  listBlobs,
  deleteBlobs,
  now = Date.now(),
  retentionMs = BLOB_RETENTION_MS,
  dryRun = false,
}) {
  const manifests = [];
  for (const sha of keepShas) {
    try {
      manifests.push(await readManifest(sha));
    } catch {
      manifests.push(null);
    }
  }
  const blobs = await listBlobs();
  const plan = planBlobPrune({ manifests, blobs, now, retentionMs });
  const result = {
    skipped: plan.safe ? null : plan.reason,
    referenced: plan.referenced,
    keptCount: plan.keep.length,
    wouldDeleteCount: plan.remove.length,
    deletedCount: 0,
    deletedBytes: 0,
    wouldDeleteBytes: plan.remove.reduce((sum, blob) => sum + (blob.size ?? 0), 0),
    errors: [],
    dryRun,
  };
  if (!plan.safe || dryRun || plan.remove.length === 0) return result;
  const outcome = await deleteBlobs(plan.remove);
  result.deletedCount = outcome.deleted.length;
  result.errors = outcome.errors;
  const gone = new Set(outcome.deleted);
  result.deletedBytes = plan.remove
    .filter((blob) => gone.has(blob.key))
    .reduce((sum, blob) => sum + (blob.size ?? 0), 0);
  return result;
}
