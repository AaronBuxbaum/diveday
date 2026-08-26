import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export interface PrunerEvent {
  keep?: string;
}

export interface PrunerSummary {
  event: string;
  bucket: string;
  activeBaseline: string;
  keptPrefixesCount: number;
  deletedPrefixesCount: number;
  deletedObjectsCount: number;
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

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
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
      if (item.Key) keys.push(item.Key);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
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

export async function fetchCommits(
  repo: string,
  branch: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=30`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "diveday-visual-pruner-lambda",
      },
    });

    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ sha?: string }>;
    if (!Array.isArray(data)) return [];

    return data
      .map((item) => (item?.sha ? item.sha.trim().toLowerCase() : ""))
      .filter((sha) => COMMIT_SHA.test(sha));
  } catch {
    return [];
  }
}

export async function pruneBucket(
  client: S3Client,
  bucket: string,
  activeBaseline: string,
): Promise<{ keptCount: number; deletedPrefixesCount: number; deletedObjectsCount: number }> {
  const allPrefixes = await listPrefixes(client, bucket);
  const keptPrefixes: string[] = [];
  const stalePrefixes: string[] = [];

  for (const prefix of allPrefixes) {
    const clean = prefix.replace(/\/$/, "").toLowerCase();
    if (clean === activeBaseline) {
      keptPrefixes.push(prefix);
    } else {
      stalePrefixes.push(prefix);
    }
  }

  let totalDeletedObjects = 0;

  for (const prefix of stalePrefixes) {
    const keys = await listObjects(client, bucket, prefix);
    if (keys.length === 0) continue;

    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000).map((k) => ({ Key: k }));
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk, Quiet: true },
        }),
      );
    }

    totalDeletedObjects += keys.length;
    console.log(`Pruned prefix ${prefix} (${keys.length} objects)`);
  }

  return {
    keptCount: keptPrefixes.length,
    deletedPrefixesCount: stalePrefixes.length,
    deletedObjectsCount: totalDeletedObjects,
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

  let activeBaseline = explicitKeep;
  let source = "explicit_event_payload";

  if (!activeBaseline) {
    const candidates = await fetchCommits(repo, branch);
    if (candidates.length === 0) {
      throw new Error(`Could not fetch commit candidates from GitHub API for ${repo}:${branch}`);
    }

    for (const sha of candidates) {
      if (await hasSnapshot(s3, bucket, sha)) {
        activeBaseline = sha;
        source = sha === candidates[0] ? "head_commit" : "recent_main_ancestor";
        break;
      }
    }

    if (!activeBaseline) {
      activeBaseline = candidates[0];
      source = "head_commit_unverified";
    }
  }

  console.log(
    JSON.stringify({
      event: "visual_pruner.baseline_resolved",
      baseline: activeBaseline,
      source,
    }),
  );

  const pruneResult = await pruneBucket(s3, bucket, activeBaseline);

  const summary: PrunerSummary = {
    event: "visual_pruner.summary",
    bucket,
    activeBaseline,
    keptPrefixesCount: pruneResult.keptCount,
    deletedPrefixesCount: pruneResult.deletedPrefixesCount,
    deletedObjectsCount: pruneResult.deletedObjectsCount,
  };

  console.log(JSON.stringify(summary));
  return summary;
}
