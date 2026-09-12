import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * The floor under how many main baselines survive, however quiet main gets.
 * Counted over main's own first-parent chain -- its tips -- and not over
 * whatever ancestors of main happen to be newest, which is what it counted
 * until 2026-09-12 and the whole of issue #1662: every pull request lands as a
 * merge commit that drags its head commits into main's ancestry, so only 5 of
 * the newest 30 rows in that list are main tips and ten slots bought about two.
 * Measured over every merged pull request in this repository's history, a fork
 * point sat at most 7 main tips back (p50 2, p95 7), so ten is the right floor.
 *
 * The two copies of this and of the three constants below must move together:
 * scripts/prune-visual-bucket-lib.mjs is the other one, and
 * visual-bucket-pruner-handler.test.ts pins them to each other.
 */
export const KEEP_MAIN_BASELINES = 10;

/**
 * And the floor under how much of main's history survives, however fast main
 * moves: every main tip younger than this keeps its snapshot, past the count.
 * A count alone re-files the bug it fixes -- at the measured 11.7 merges a day
 * ten main tips is about twenty hours, and the measured fork-point age at the
 * moment a branch's visual run published was p50 2.5h, p95 23.8h, max 34.3h.
 * Seventy-two hours is a little over twice that tail. Replayed over this
 * repository's real history it keeps 29 tips covering 71.4 hours of main, where
 * the ten-slot rule it replaces covered 5.4: ~6 GB at this bucket's ~213 MB a
 * snapshot, or ~$0.14/month.
 */
export const KEEP_MAIN_BASELINE_AGE_MS = 72 * 60 * 60 * 1000;

/** GitHub's per_page maximum, and the ceiling on pages one run will read. */
export const CANDIDATE_PAGE_SIZE = 100;

/**
 * Four pages is ~44 main tips, or ~3.7 days at the measured merge rate. A run
 * stops paging the moment its chain reaches past both floors, so in steady
 * state this is one or two calls.
 */
export const MAX_CANDIDATE_PAGES = 4;

/**
 * Nothing published inside this window is pruned, whatever branch it came from.
 * A stacked pull request's baseline is the layer below's head commit, which is
 * on no branch this walk can enumerate; age is the only thing that knows about
 * it.
 *
 * One day, not seven: the floor covers only a baseline the walk cannot name,
 * and a stack's lower layer republishes well inside a day of the layer above
 * running. KEEP_MAIN_BASELINES carries the main history; this carries the
 * in-flight work, and nothing else has to be paid for by the week.
 */
export const MIN_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

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
 * Main's own tips, newest first: the candidate list walked along first-parent
 * links, which drops every pull-request head commit the list is otherwise full
 * of. Stops where the links leave the fetched set.
 */
export function mainFirstParentChain(candidates: readonly PrunerCommit[]): PrunerCommit[] {
  const positionBySha = new Map(candidates.map((commit, index) => [commit.sha, index]));
  const chain: PrunerCommit[] = [];
  const seen = new Set<string>();
  let cursor: PrunerCommit | undefined = candidates[0];
  while (cursor && !seen.has(cursor.sha)) {
    seen.add(cursor.sha);
    chain.push(cursor);
    const next: number | undefined = cursor.parentSha
      ? positionBySha.get(cursor.parentSha)
      : undefined;
    cursor = next === undefined ? undefined : candidates[next];
  }
  return chain;
}

/** Whether a main tip is beyond the age window and so held only by the count. */
function outsideAgeWindow(commit: PrunerCommit, now: number): boolean {
  // An unknown commit date counts as inside it: erring towards keeping a
  // baseline costs storage, erring the other way costs a branch its baseline.
  return commit.committedAtMs !== null && now - commit.committedAtMs > KEEP_MAIN_BASELINE_AGE_MS;
}

/** Whether what has been fetched already reaches past both floors. */
function chainCoversBothFloors(chain: readonly PrunerCommit[], now: number): boolean {
  return chain.length >= KEEP_MAIN_BASELINES && outsideAgeWindow(chain[chain.length - 1], now);
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
    if (rows.length < CANDIDATE_PAGE_SIZE) break;
    if (chainCoversBothFloors(mainFirstParentChain(candidates), now)) break;
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

  const chain = mainFirstParentChain(candidates);
  for (const commit of chain) {
    if (keepShas.length >= KEEP_MAIN_BASELINES && outsideAgeWindow(commit, now)) break;
    await probe(commit);
  }

  // A chain of one out of a list of many means the rows carried no parent links
  // at all -- a payload shape this did not expect, not a history one commit
  // long. Fall back to the flat newest-first walk this replaced, so a surprise
  // in the response can never make the pruner keep *less* than it used to.
  if (chain.length <= 1 && candidates.length > 1) {
    for (const commit of candidates) {
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
