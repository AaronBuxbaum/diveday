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
 * The floor under how *many* main baselines survive, however quiet main gets.
 *
 * reg-suit's expected key is the *parent* on a push to main and the *fork
 * point* on a pull request (`scripts/reg-suit-keys.mjs`), so this is the number
 * that decides whether an open branch has anything to compare against at all.
 *
 * It counts commits on main's **first-parent chain** — main's own tips, which
 * are the only commits a fork point can be — and not, as it did until
 * 2026-09-12, whatever ancestors of main happened to be newest. That
 * distinction was the whole of issue #1662. The candidate list is every
 * ancestor of main newest-first, and because every pull request lands as a
 * merge commit that drags its head commits into main's ancestry, only 5 of the
 * newest 30 rows — and 11 of the newest 100 — are main tips. So ten slots
 * bought about two main tips, and the other eight went to head commits that
 * `MIN_PRUNE_AGE_MS` was already holding for as long as anyone was iterating on
 * them. Measured over every merged pull request in this repository's history,
 * 11 of 28 had a fork point outside the ten newest published ancestors, and 4
 * of 28 were deeper than the candidate list even reached.
 *
 * Ten is the right floor: over the same 28, a fork point sat at most **7** main
 * tips back (p50 2, p95 7). What a count cannot cover is the clock — see
 * `KEEP_MAIN_BASELINE_AGE_MS`.
 */
export const KEEP_MAIN_BASELINES = 10;

/**
 * And the floor under how much of main's *history* survives, however fast main
 * moves: every main tip whose commit is younger than this keeps its snapshot,
 * on top of the count above.
 *
 * A count on its own re-files the bug it fixes. At the measured 11.7 merges a
 * day ten main tips is about twenty hours, so a branch cut in the evening and
 * pushed the next afternoon is already past it — and the measured fork-point
 * age at the moment a branch's visual run published was p50 2.5h, p95 23.8h,
 * max 34.3h. Seventy-two hours is a little over twice that measured tail.
 *
 * It costs almost nothing: about 35 main tips at the measured merge rate, or
 * ~7 GB at this bucket's ~213 MB a snapshot, which is ~$0.17/month against a
 * ~$12 bill that is request-shaped rather than storage-shaped (ADR
 * 20260826-prune-visual-bucket's second amendment). And
 * `scripts/wait-for-baseline.mjs` walks 40 first-parent ancestors behind it —
 * a walk that can only resolve anything *because* the kept baselines are now a
 * contiguous run along the very chain it walks. Before this, the keeps were the
 * newest prefixes by date, so every ancestor of a pruned fork point was pruned
 * too and the walk found nothing.
 */
export const KEEP_MAIN_BASELINE_AGE_MS = 72 * 60 * 60 * 1000;

/** GitHub's `per_page` maximum, and the ceiling on pages one run will read. */
export const CANDIDATE_PAGE_SIZE = 100;

/**
 * Four pages is ~44 main tips, or ~3.7 days at the measured merge rate: enough
 * to satisfy the age window with margin. A run stops paging the moment its
 * chain reaches past the window, so in steady state this is one or two calls.
 */
export const MAX_CANDIDATE_PAGES = 4;

/**
 * Nothing published inside this window is pruned, whatever branch it came from.
 * A stacked pull request's baseline is the layer below's head commit, which is
 * never on main and so can never be found by the walk above (ADR
 * 20260821-stacked-pull-requests). Age is the only thing that knows about it.
 *
 * One day, not seven: the floor exists to cover a baseline the walk cannot
 * name, and a stack's lower layer is re-pushed — and so re-published — far
 * inside a day of the layer above running. A week of every branch's captures
 * was paying for that safety many times over, so the count-based
 * `KEEP_MAIN_BASELINES` carries the main history and this carries only the
 * in-flight work.
 */
export const MIN_PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

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
 * One page of a branch's history from the GitHub REST API, newest first.
 *
 * A row carries the two things the keep rule needs beyond the sha: the **first
 * parent**, which is what reconstructs main's own chain out of a list that is
 * mostly pull-request head commits, and the **commit date**, which is what the
 * age window is measured against.
 */
export async function fetchGitHubBranchCommits({
  repo = DEFAULT_REPO,
  branch = DEFAULT_BRANCH,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  limit = CANDIDATE_PAGE_SIZE,
  page = 1,
} = {}) {
  const url = `${GITHUB_API}/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}&page=${page}`;
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
      .map((item) => ({
        sha: typeof item?.sha === "string" ? item.sha.trim().toLowerCase() : "",
        parentSha:
          typeof item?.parents?.[0]?.sha === "string"
            ? item.parents[0].sha.trim().toLowerCase()
            : "",
        committedAtMs: commitDateMs(item?.commit?.committer?.date ?? item?.commit?.author?.date),
      }))
      .filter((commit) => COMMIT_SHA.test(commit.sha));
  } catch {
    return [];
  }
}

/** A commit date the API may not have sent. Unknown is null, never a guess. */
function commitDateMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The same rows from local git, for when the API is unreachable.
 *
 * `--first-parent` because that is the history the keep rule is about; `%P`
 * still lists every parent, so the chain walk reads the same field either way.
 */
export function fetchGitBranchCommits({
  git,
  branch = DEFAULT_BRANCH,
  limit = CANDIDATE_PAGE_SIZE,
} = {}) {
  if (typeof git !== "function") return [];
  const refsToTry = [`origin/${branch}`, branch, "HEAD"];
  for (const ref of refsToTry) {
    try {
      const output = git(["log", ref, "--first-parent", "-n", String(limit), "--format=%H %P %ct"]);
      const commits = output
        .split("\n")
        .map((line) => {
          // `<sha> <parent...> <committed seconds>`, and a parent list that is
          // empty at the root commit.
          const parts = line.trim().split(/\s+/).filter(Boolean);
          const seconds = parts.length > 1 ? Number(parts[parts.length - 1]) : Number.NaN;
          return {
            sha: (parts[0] ?? "").toLowerCase(),
            parentSha: parts.length > 2 ? parts[1].toLowerCase() : "",
            committedAtMs: Number.isFinite(seconds) ? seconds * 1000 : null,
          };
        })
        .filter((commit) => COMMIT_SHA.test(commit.sha));
      if (commits.length > 0) return commits;
    } catch {
      // Continue to next ref
    }
  }
  return [];
}

/**
 * Main's own tips, newest first: the candidate list walked along first-parent
 * links, which drops every pull-request head commit the list is otherwise full
 * of. Stops where the links leave the fetched set.
 */
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

/** Whether a main tip is beyond the age window and so held only by the count. */
function outsideAgeWindow(commit, now) {
  // An unknown commit date counts as inside it: erring towards keeping a
  // baseline costs storage, erring the other way costs a branch its baseline.
  return commit.committedAtMs !== null && now - commit.committedAtMs > KEEP_MAIN_BASELINE_AGE_MS;
}

/** Whether what has been fetched already reaches past both floors. */
function chainCoversBothFloors(chain, now) {
  return chain.length >= KEEP_MAIN_BASELINES && outsideAgeWindow(chain[chain.length - 1], now);
}

/**
 * Resolves the main baselines that should be preserved.
 *
 * Algorithm:
 * 1. If explicitCommit is supplied, validate and use it directly.
 * 2. Fetch pages of main's history (via GitHub API, falling back to git) until
 *    what has been fetched reaches past both floors below, or the pages run out.
 * 3. Reduce that list to main's own tips by walking first-parent links, because
 *    a fork point is a main tip and four of every five rows in the list is not
 *    (issue #1662).
 * 4. Walk those tips newest-to-oldest, testing whether `<sha>/out.json` exists
 *    in S3, and keep every one that does until *both* floors are satisfied:
 *    `KEEP_MAIN_BASELINES` of them, and none left inside
 *    `KEEP_MAIN_BASELINE_AGE_MS`. A push to main then resolves its parent, and a
 *    branch resolves its fork point or an ancestor of it that is still there.
 * 5. If no tip has one, say so (`verified: false`) rather than nominating a
 *    prefix that is not in the bucket — see `pruneVisualBucket`.
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
  now = Date.now(),
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

  const candidates = [];
  const known = new Set();
  const collect = (rows) => {
    for (const commit of rows) {
      if (known.has(commit.sha)) continue;
      known.add(commit.sha);
      candidates.push(commit);
    }
  };

  for (let page = 1; page <= MAX_CANDIDATE_PAGES; page += 1) {
    const rows = await fetchGitHubBranchCommits({ repo, branch, token, fetchImpl, page });
    collect(rows);
    // The end of the branch's history, or a chain that already reaches past
    // both floors: either way there is nothing more worth asking for.
    if (rows.length < CANDIDATE_PAGE_SIZE) break;
    if (chainCoversBothFloors(mainFirstParentChain(candidates), now)) break;
  }

  if (candidates.length === 0 && git) {
    collect(fetchGitBranchCommits({ git, branch }));
  }

  if (candidates.length === 0) {
    throw new Error(
      `Could not resolve any commit candidates for ${repo}:${branch} via GitHub API or git.`,
    );
  }

  const candidatesChecked = [];
  const keepShas = [];
  const probe = async (commit) => {
    if (candidatesChecked.includes(commit.sha)) return;
    candidatesChecked.push(commit.sha);
    if (await snapshotExists(bucket, commit.sha, { s3Client })) keepShas.push(commit.sha);
  };

  const chain = mainFirstParentChain(candidates);
  for (const commit of chain) {
    if (keepShas.length >= KEEP_MAIN_BASELINES && outsideAgeWindow(commit, now)) break;
    await probe(commit);
  }

  // A chain of one out of a list of many means the rows carried no parent links
  // at all — a payload shape this did not expect, not a history one commit
  // long. Fall back to the flat newest-first walk this replaced, so a surprise
  // in the response can never make the pruner keep *less* than it used to.
  if (chain.length <= 1 && candidates.length > 1) {
    for (const commit of candidates) {
      if (keepShas.length >= KEEP_MAIN_BASELINES) break;
      await probe(commit);
    }
  }

  if (keepShas.length > 0) {
    return {
      activeBaseline: keepShas[0],
      keepShas,
      verified: true,
      headCommit: candidates[0].sha,
      source: keepShas[0] === candidates[0].sha ? "head_commit" : "recent_main_ancestor",
      candidatesChecked,
    };
  }

  // Not a baseline: a name for what we could not find. `pruneVisualBucket`
  // refuses to delete on this, because "no recent main tip has a snapshot" is
  // far more likely to mean the probe is broken than that every baseline is
  // genuinely gone.
  return {
    activeBaseline: candidates[0].sha,
    keepShas: [],
    verified: false,
    headCommit: candidates[0].sha,
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
