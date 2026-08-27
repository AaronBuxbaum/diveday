// Shared logic for pruning stale visual regression testing snapshots in S3
// while preserving the active main baseline.
//
// Consumed by:
//   - `scripts/prune-visual-bucket.mjs` (CLI tool / local / CI)
//   - Unit tests (`scripts/prune-visual-bucket-lib.test.mjs`)
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export const DEFAULT_BUCKET = "diveday-vrt";
export const DEFAULT_REPO = "AaronBuxbaum/diveday";
export const DEFAULT_BRANCH = "main";
export const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/**
 * How many recent main baselines to keep, not one. reg-suit's expected key is
 * the *parent* on a push to main and the *fork point* on a pull request
 * (`scripts/reg-suit-keys.mjs`), so keeping only the newest leaves every open
 * branch comparing against a prefix that was deleted overnight — and a run with
 * no baseline reports nothing changed, which reads exactly like nothing broke.
 */
export const KEEP_MAIN_BASELINES = 10;

/**
 * Nothing published inside this window is pruned, whatever branch it came from.
 * A stacked pull request's baseline is the layer below's head commit, which is
 * never on main and so can never be found by the walk above (ADR
 * 20260821-stacked-pull-requests). Age is the only thing that knows about it.
 */
export const MIN_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";

/**
 * Whether a reg-suit report exists for a commit.
 *
 * Asked through the same authenticated S3 client that does the deleting, and
 * deliberately not over `https://<bucket>.s3.amazonaws.com/...`: the bucket
 * blocks public access, so an anonymous probe answers 403 for every commit —
 * "no baseline anywhere", which is the input that makes the caller delete the
 * most. The probe and the delete must share credentials or the failure mode is
 * destruction.
 */
export async function snapshotExists(bucket, commitSha, { s3Client } = {}) {
  if (!s3Client) throw new Error("snapshotExists needs the authenticated s3Client");
  const res = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `${commitSha}/out.json`, MaxKeys: 1 }),
  );
  return (res.Contents?.length ?? 0) > 0;
}

/**
 * Fetches recent commit SHAs from GitHub REST API for a branch.
 */
export async function fetchGitHubBranchCommits({
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  limit = 30,
} = {}) {
  const url = `${GITHUB_API}/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`;
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "diveday-visual-pruner",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  try {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => (typeof item?.sha === "string" ? item.sha.trim() : ""))
      .filter((sha) => COMMIT_SHA.test(sha));
  } catch {
    return [];
  }
}

/**
 * Reads recent commit SHAs using local git if available.
 */
export function fetchGitBranchCommits({ git, branch = DEFAULT_BRANCH, limit = 30 } = {}) {
  if (typeof git !== "function") return [];
  const refsToTry = [`origin/${branch}`, branch, "HEAD"];
  for (const ref of refsToTry) {
    try {
      const output = git(["log", ref, "-n", String(limit), "--format=%H"]);
      const shas = output
        .split("\n")
        .map((line) => line.trim())
        .filter((sha) => COMMIT_SHA.test(sha));
      if (shas.length > 0) return shas;
    } catch {
      // Continue to next ref
    }
  }
  return [];
}

/**
 * Resolves the active main baseline commit SHA that should be preserved.
 *
 * Algorithm:
 * 1. If explicitCommit is supplied, validate and use it directly.
 * 2. Fetch candidate commit SHAs on main (via GitHub API, falling back to git).
 * 3. Walk candidates newest-to-oldest, testing whether `<sha>/out.json` exists in S3.
 * 4. Return every recent main commit that actually has a published snapshot,
 *    newest first, so a push to main can still resolve its parent and a branch
 *    cut a few commits back can still resolve its fork point.
 * 5. If no candidate has one, say so (`verified: false`) rather than nominating
 *    a prefix that is not in the bucket — see `pruneVisualBucket`.
 */
export async function resolveActiveBaseline({
  bucket = DEFAULT_BUCKET,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  explicitCommit,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  s3Client,
  git,
} = {}) {
  if (explicitCommit) {
    const trimmed = explicitCommit.trim();
    if (!COMMIT_SHA.test(trimmed)) {
      throw new Error(
        `Invalid explicit commit SHA: "${explicitCommit}". Must be 40 hex characters.`,
      );
    }
    return {
      activeBaseline: trimmed.toLowerCase(),
      keepShas: [trimmed.toLowerCase()],
      verified: true,
      headCommit: trimmed.toLowerCase(),
      source: "explicit",
      candidatesChecked: [trimmed.toLowerCase()],
    };
  }

  let candidates = await fetchGitHubBranchCommits({ repo, branch, token, fetchImpl });
  if (candidates.length === 0 && git) {
    candidates = fetchGitBranchCommits({ git, branch });
  }

  if (candidates.length === 0) {
    throw new Error(
      `Could not resolve any commit candidates for ${repo}:${branch} via GitHub API or git.`,
    );
  }

  const candidatesChecked = [];
  const keepShas = [];
  for (const sha of candidates) {
    const normalizedSha = sha.toLowerCase();
    candidatesChecked.push(normalizedSha);
    if (await snapshotExists(bucket, normalizedSha, { s3Client })) {
      keepShas.push(normalizedSha);
      if (keepShas.length >= KEEP_MAIN_BASELINES) break;
    }
  }

  if (keepShas.length > 0) {
    return {
      activeBaseline: keepShas[0],
      keepShas,
      verified: true,
      headCommit: candidates[0].toLowerCase(),
      source: keepShas[0] === candidates[0].toLowerCase() ? "head_commit" : "recent_main_ancestor",
      candidatesChecked,
    };
  }

  // Not a baseline: a name for what we could not find. `pruneVisualBucket`
  // refuses to delete on this, because "no main commit in the last 30 has a
  // snapshot" is far more likely to mean the probe is broken than that every
  // baseline is genuinely gone.
  return {
    activeBaseline: candidates[0].toLowerCase(),
    keepShas: [],
    verified: false,
    headCommit: candidates[0].toLowerCase(),
    source: "head_commit_unverified",
    candidatesChecked,
  };
}

/**
 * Lists all top-level directory prefixes in the S3 bucket.
 */
export async function listBucketPrefixes({ s3Client, bucket }) {
  const prefixes = [];
  let continuationToken;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      }),
    );

    if (res.CommonPrefixes) {
      for (const entry of res.CommonPrefixes) {
        if (entry.Prefix) prefixes.push(entry.Prefix);
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return prefixes;
}

/**
 * Lists all object keys under a prefix in the S3 bucket.
 */
export async function listPrefixObjects({ s3Client, bucket, prefix }) {
  const objects = [];
  let continuationToken;

  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    if (res.Contents) {
      for (const item of res.Contents) {
        if (item.Key) {
          objects.push({
            Key: item.Key,
            Size: item.Size ?? 0,
            LastModified: item.LastModified ?? null,
          });
        }
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Deletes every snapshot prefix that is neither pinned nor recent.
 *
 * Two things keep a prefix: being named in `keepShas` (the recent main
 * baselines), or holding an object newer than `minAgeMs` (which is how an open
 * branch's baseline survives, including a stacked layer's head commit that is
 * on no branch this walk can enumerate).
 *
 * `keepShas` being empty is refused rather than obeyed. Every earlier version
 * of this treated "found no baseline" as "keep nothing", so one broken probe
 * emptied the bucket; there is no state in which deleting every baseline is the
 * right answer, so it is not reachable from here.
 */
export async function pruneVisualBucket({
  s3Client,
  bucket = DEFAULT_BUCKET,
  keepShas = [],
  dryRun = false,
  batchSize = 1000,
  minAgeMs = MIN_PRUNE_AGE_MS,
  now = Date.now(),
  log = console.log,
} = {}) {
  const keepSet = new Set(keepShas.map((sha) => sha.trim().toLowerCase().replace(/\/$/, "")));
  if (keepSet.size === 0) {
    throw new Error(
      "prune-visual-bucket: refusing to prune with no verified baseline to keep. " +
        "Pass --keep <sha> to override once you have confirmed which baseline is live.",
    );
  }

  const allPrefixes = await listBucketPrefixes({ s3Client, bucket });
  const keptPrefixes = [];
  const keptRecentPrefixes = [];
  const stalePrefixes = [];
  const staleObjects = new Map();

  for (const prefix of allPrefixes) {
    const cleanPrefix = prefix.replace(/\/$/, "").toLowerCase();
    if (keepSet.has(cleanPrefix)) {
      keptPrefixes.push(prefix);
      continue;
    }
    const objects = await listPrefixObjects({ s3Client, bucket, prefix });
    const newestMs = objects.reduce(
      (newest, object) => Math.max(newest, object.LastModified ? +object.LastModified : 0),
      0,
    );
    // An unknown timestamp counts as new. Erring towards keeping a prefix costs
    // storage; erring the other way costs a branch its baseline silently.
    if (newestMs === 0 || now - newestMs < minAgeMs) {
      keptRecentPrefixes.push(prefix);
      continue;
    }
    stalePrefixes.push(prefix);
    staleObjects.set(prefix, objects);
  }

  let deletedObjectsCount = 0;
  let deletedBytesTotal = 0;
  const deleteErrors = [];

  for (const prefix of stalePrefixes) {
    const objects = staleObjects.get(prefix) ?? [];
    if (objects.length === 0) continue;

    if (!dryRun) {
      for (let i = 0; i < objects.length; i += batchSize) {
        const chunk = objects.slice(i, i + batchSize).map((o) => ({ Key: o.Key }));
        const res = await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk, Quiet: true },
          }),
        );
        // DeleteObjects reports per-key failures in the body instead of
        // throwing, so an unread response turns a partial delete into a clean
        // success line and a storage bill nobody can explain.
        for (const error of res?.Errors ?? []) {
          deleteErrors.push(`${error.Key ?? "(unknown key)"}: ${error.Code ?? "unknown"}`);
        }
      }
    }

    const prefixBytes = objects.reduce((sum, o) => sum + o.Size, 0);
    deletedObjectsCount += objects.length;
    deletedBytesTotal += prefixBytes;

    if (dryRun) {
      log(
        `[DRY RUN] Would delete prefix ${prefix} (${objects.length} objects, ${Math.round(prefixBytes / 1024)} KB)`,
      );
    } else {
      log(
        `Deleted prefix ${prefix} (${objects.length} objects, ${Math.round(prefixBytes / 1024)} KB)`,
      );
    }
  }

  if (deleteErrors.length > 0) {
    log(
      `S3 refused ${deleteErrors.length} object deletes: ${deleteErrors.slice(0, 10).join(", ")}`,
    );
  }

  return {
    bucket,
    keptPrefixes,
    keptRecentPrefixes,
    deletedPrefixes: stalePrefixes,
    deletedObjectsCount,
    deletedBytesTotal,
    deleteErrors,
    dryRun,
  };
}
