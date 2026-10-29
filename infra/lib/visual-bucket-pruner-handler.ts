import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  CANDIDATE_PAGE_SIZE,
  KEEP_MAIN_BASELINES,
  MAX_CANDIDATE_PAGES,
  MIN_PRUNE_AGE_MS,
  mainBaselineProbeOrder,
  shouldFetchAnotherCandidatePage,
  shouldStopMainBaselineProbes,
} from "./visual-retention-core.mjs";

export {
  CANDIDATE_PAGE_SIZE,
  KEEP_MAIN_BASELINE_AGE_MS,
  KEEP_MAIN_BASELINES,
  MAX_CANDIDATE_PAGES,
  MIN_PRUNE_AGE_MS,
  mainFirstParentChain,
} from "./visual-retention-core.mjs";

const s3 = new S3Client({});

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export interface PrunerEvent {
  keep?: string;
}

export interface PrunerSummary {
  event: string;
  bucket: string;
  activeBaseline: string;
  source: string;
  keptPrefixesCount: number;
  keptRecentPrefixesCount: number;
  deletedPrefixesCount: number;
  deletedObjectsCount: number;
  deleteErrorCount: number;
}

export async function listPrefixes(client: S3Client, bucket: string): Promise<string[]> {
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of res.CommonPrefixes ?? []) {
      if (entry.Prefix) prefixes.push(entry.Prefix);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return prefixes;
}

export interface PrunerObject {
  key: string;
  lastModifiedMs: number | null;
}

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<PrunerObject[]> {
  const objects: PrunerObject[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of res.Contents ?? []) {
      if (item.Key) {
        objects.push({
          key: item.Key,
          lastModifiedMs: item.LastModified ? item.LastModified.getTime() : null,
        });
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

export async function hasSnapshot(client: S3Client, bucket: string, sha: string): Promise<boolean> {
  try {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${sha}/out.json`,
        MaxKeys: 1,
      }),
    );
    return (res.Contents && res.Contents.length > 0) || false;
  } catch {
    return false;
  }
}

/**
 * A row of main's history. Beyond the sha it carries the two things the keep
 * rule needs: the first parent, which is what reconstructs main's own chain out
 * of a list that is mostly pull-request head commits, and the commit date,
 * which is what the age window is measured against.
 */
export interface PrunerCommit {
  sha: string;
  parentSha: string;
  committedAtMs: number | null;
}

interface CommitPayload {
  sha?: string;
  parents?: Array<{ sha?: string }>;
  commit?: { committer?: { date?: string }; author?: { date?: string } };
}

/** A commit date the API may not have sent. Unknown is null, never a guess. */
function commitDateMs(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchCommits(
  repo: string,
  branch: string,
  fetchImpl: typeof fetch = fetch,
  page = 1,
): Promise<PrunerCommit[]> {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${CANDIDATE_PAGE_SIZE}&page=${page}`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "diveday-visual-pruner-lambda",
      },
    });

    if (!res.ok) return [];
    const data = (await res.json()) as CommitPayload[];
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => ({
        sha: item?.sha ? item.sha.trim().toLowerCase() : "",
        parentSha: item?.parents?.[0]?.sha ? String(item.parents[0].sha).trim().toLowerCase() : "",
        committedAtMs: commitDateMs(item?.commit?.committer?.date ?? item?.commit?.author?.date),
      }))
      .filter((commit) => COMMIT_SHA.test(commit.sha));
  } catch {
    return [];
  }
}

/**
 * Pages main's history until what has been fetched reaches past both floors, or
 * the pages run out.
 */
export async function fetchMainCandidates(
  repo: string,
  branch: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<PrunerCommit[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const candidates: PrunerCommit[] = [];
  const known = new Set<string>();

  for (let page = 1; page <= MAX_CANDIDATE_PAGES; page += 1) {
    const rows = await fetchCommits(repo, branch, fetchImpl, page);
    for (const commit of rows) {
      if (known.has(commit.sha)) continue;
      known.add(commit.sha);
      candidates.push(commit);
    }
    // The end of the branch's history, or a chain that already reaches past
    // both floors: either way there is nothing more worth asking for.
    if (!shouldFetchAnotherCandidatePage(page, rows.length, candidates, now)) break;
  }

  return candidates;
}

/**
 * The baselines to preserve: every main tip with a published snapshot, newest
 * first, until both floors are satisfied -- KEEP_MAIN_BASELINES of them, and
 * none left inside KEEP_MAIN_BASELINE_AGE_MS.
 *
 * Comes back empty when no tip has one, which the handler refuses to prune on.
 */
export async function resolveKeepShas(
  client: S3Client,
  bucket: string,
  candidates: readonly PrunerCommit[],
  options: { now?: number } = {},
): Promise<string[]> {
  const now = options.now ?? Date.now();
  const keepShas: string[] = [];
  const checked = new Set<string>();
  const probe = async (commit: PrunerCommit) => {
    if (checked.has(commit.sha)) return;
    checked.add(commit.sha);
    if (await hasSnapshot(client, bucket, commit.sha)) keepShas.push(commit.sha);
  };

  const { chain, fallback } = mainBaselineProbeOrder(candidates);
  for (const commit of chain) {
    if (shouldStopMainBaselineProbes(keepShas.length, commit, now)) break;
    await probe(commit);
  }

  // A chain of one out of a list of many means the rows carried no parent links
  // at all -- a payload shape this did not expect, not a history one commit
  // long. Fall back to the flat newest-first walk this replaced, so a surprise
  // in the response can never make the pruner keep *less* than it used to.
  if (fallback.length > 0) {
    for (const commit of fallback) {
      if (keepShas.length >= KEEP_MAIN_BASELINES) break;
      await probe(commit);
    }
  }

  return keepShas;
}

export async function pruneBucket(
  client: S3Client,
  bucket: string,
  keepShas: readonly string[],
  options: { now?: number; minAgeMs?: number } = {},
): Promise<{
  keptCount: number;
  keptRecentCount: number;
  deletedPrefixesCount: number;
  deletedObjectsCount: number;
  deleteErrors: string[];
}> {
  const now = options.now ?? Date.now();
  const minAgeMs = options.minAgeMs ?? MIN_PRUNE_AGE_MS;
  const keepSet = new Set(keepShas.map((sha) => sha.trim().toLowerCase()));
  // There is no state in which deleting every baseline is the right answer, so
  // it is not reachable from here. See the handler's unverified branch.
  if (keepSet.size === 0) {
    throw new Error("Refusing to prune with no verified baseline to keep.");
  }

  const allPrefixes = await listPrefixes(client, bucket);
  const keptPrefixes: string[] = [];
  const keptRecentPrefixes: string[] = [];
  const stale: Array<{ prefix: string; objects: PrunerObject[] }> = [];

  for (const prefix of allPrefixes) {
    const clean = prefix.replace(/\/$/, "").toLowerCase();
    if (keepSet.has(clean)) {
      keptPrefixes.push(prefix);
      continue;
    }
    const objects = await listObjects(client, bucket, prefix);
    const newestMs = objects.reduce(
      (newest, object) => Math.max(newest, object.lastModifiedMs ?? 0),
      0,
    );
    // An unknown timestamp counts as new: keeping a prefix costs storage,
    // dropping one costs a branch its baseline without saying so.
    if (newestMs === 0 || now - newestMs < minAgeMs) {
      keptRecentPrefixes.push(prefix);
      continue;
    }
    stale.push({ prefix, objects });
  }

  let totalDeletedObjects = 0;
  const deleteErrors: string[] = [];

  for (const { prefix, objects } of stale) {
    if (objects.length === 0) continue;

    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = objects.slice(i, i + 1000).map((object) => ({ Key: object.key }));
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk, Quiet: true },
        }),
      );
      // DeleteObjects reports per-key failures in the body instead of throwing,
      // so an unread response turns a partial delete into a clean success line.
      for (const error of res.Errors ?? []) {
        deleteErrors.push(`${error.Key ?? "(unknown key)"}: ${error.Code ?? "unknown"}`);
      }
    }

    totalDeletedObjects += objects.length;
    console.log(`Pruned prefix ${prefix} (${objects.length} objects)`);
  }

  return {
    keptCount: keptPrefixes.length,
    keptRecentCount: keptRecentPrefixes.length,
    deletedPrefixesCount: stale.length,
    deletedObjectsCount: totalDeletedObjects,
    deleteErrors,
  };
}

export async function handler(event?: PrunerEvent): Promise<PrunerSummary> {
  const bucket = process.env.BUCKET;
  if (!bucket) {
    throw new Error("Missing required BUCKET environment variable.");
  }

  const repo = process.env.GITHUB_REPO || "AaronBuxbaum/diveday";
  const branch = process.env.DEFAULT_BRANCH || "main";
  const explicitKeep = event?.keep ? event.keep.trim().toLowerCase() : null;
  if (explicitKeep && !COMMIT_SHA.test(explicitKeep)) {
    throw new Error(`Invalid keep sha in event payload: "${event?.keep}".`);
  }

  const keepShas: string[] = explicitKeep ? [explicitKeep] : [];
  let source = "explicit_event_payload";

  if (keepShas.length === 0) {
    const candidates = await fetchMainCandidates(repo, branch);
    if (candidates.length === 0) {
      throw new Error(`Could not fetch commit candidates from GitHub API for ${repo}:${branch}`);
    }

    keepShas.push(...(await resolveKeepShas(s3, bucket, candidates)));
    source = keepShas[0] === candidates[0].sha ? "head_commit" : "recent_main_ancestor";

    // Every earlier version nominated `candidates[0]` here and pruned against
    // it, so a bucket holding no snapshot for any recent main commit -- which
    // is far more likely to mean the probe is broken than that every baseline
    // is genuinely gone -- was emptied in one scheduled run. Do nothing instead.
    if (keepShas.length === 0) {
      const summary: PrunerSummary = {
        event: "visual_pruner.summary",
        bucket,
        activeBaseline: "",
        source: "no_verified_baseline",
        keptPrefixesCount: 0,
        keptRecentPrefixesCount: 0,
        deletedPrefixesCount: 0,
        deletedObjectsCount: 0,
        deleteErrorCount: 0,
      };
      console.log(JSON.stringify(summary));
      return summary;
    }
  }

  console.log(
    JSON.stringify({
      event: "visual_pruner.baseline_resolved",
      baseline: keepShas[0],
      keeping: keepShas.length,
      source,
    }),
  );

  const pruneResult = await pruneBucket(s3, bucket, keepShas);

  const summary: PrunerSummary = {
    event: "visual_pruner.summary",
    bucket,
    activeBaseline: keepShas[0],
    source,
    keptPrefixesCount: pruneResult.keptCount,
    keptRecentPrefixesCount: pruneResult.keptRecentCount,
    deletedPrefixesCount: pruneResult.deletedPrefixesCount,
    deletedObjectsCount: pruneResult.deletedObjectsCount,
    deleteErrorCount: pruneResult.deleteErrors.length,
  };

  console.log(JSON.stringify(summary));
  return summary;
}
