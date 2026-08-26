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

const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";

/**
 * Checks if a reg-suit report exists for a given commit in S3.
 */
export async function snapshotExists(bucket, commitSha, { fetchImpl = fetch } = {}) {
  const url = `https://${bucket}.s3.amazonaws.com/${commitSha}/out.json`;
  try {
    const res = await fetchImpl(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
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
 * 4. Return the newest commit that actually has a published snapshot.
 * 5. If no candidates have a published snapshot (e.g. empty bucket), return the newest candidate.
 */
export async function resolveActiveBaseline({
  bucket = DEFAULT_BUCKET,
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  explicitCommit,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
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
  for (const sha of candidates) {
    const normalizedSha = sha.toLowerCase();
    candidatesChecked.push(normalizedSha);
    const exists = await snapshotExists(bucket, normalizedSha, { fetchImpl });
    if (exists) {
      return {
        activeBaseline: normalizedSha,
        headCommit: candidates[0].toLowerCase(),
        source:
          normalizedSha === candidates[0].toLowerCase() ? "head_commit" : "recent_main_ancestor",
        candidatesChecked,
      };
    }
  }

  // Fallback: If no candidate has out.json in S3, preserve the newest HEAD candidate
  return {
    activeBaseline: candidates[0].toLowerCase(),
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
        if (item.Key) objects.push({ Key: item.Key, Size: item.Size ?? 0 });
      }
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Prunes all stale prefixes in the bucket, preserving the provided keepShas.
 */
export async function pruneVisualBucket({
  s3Client,
  bucket = DEFAULT_BUCKET,
  keepShas = [],
  dryRun = false,
  batchSize = 1000,
  log = console.log,
} = {}) {
  const keepSet = new Set(keepShas.map((sha) => sha.trim().toLowerCase().replace(/\/$/, "")));

  const allPrefixes = await listBucketPrefixes({ s3Client, bucket });
  const keptPrefixes = [];
  const stalePrefixes = [];

  for (const prefix of allPrefixes) {
    const cleanPrefix = prefix.replace(/\/$/, "").toLowerCase();
    if (keepSet.has(cleanPrefix)) {
      keptPrefixes.push(prefix);
    } else {
      stalePrefixes.push(prefix);
    }
  }

  let deletedObjectsCount = 0;
  let deletedBytesTotal = 0;

  for (const prefix of stalePrefixes) {
    const objects = await listPrefixObjects({ s3Client, bucket, prefix });
    if (objects.length === 0) continue;

    if (!dryRun) {
      for (let i = 0; i < objects.length; i += batchSize) {
        const chunk = objects.slice(i, i + batchSize).map((o) => ({ Key: o.Key }));
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk, Quiet: true },
          }),
        );
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

  return {
    bucket,
    keptPrefixes,
    deletedPrefixes: stalePrefixes,
    deletedObjectsCount,
    deletedBytesTotal,
    dryRun,
  };
}
