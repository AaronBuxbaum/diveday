import { describe, expect, it, vi } from "vitest";
import {
  listBucketPrefixes,
  listPrefixObjects,
  pruneVisualBucket,
  resolveActiveBaseline,
  snapshotExists,
} from "./prune-visual-bucket-lib.mjs";

const SHA_1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_3 = "cccccccccccccccccccccccccccccccccccccccc";

const NOW = Date.UTC(2026, 7, 26, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OLD = new Date(NOW - 30 * DAY);
const RECENT = new Date(NOW - 2 * HOUR);
/** Older than the one-day floor, younger than anything anyone would call stale. */
const TWO_DAYS_OLD = new Date(NOW - 2 * DAY);

/** Readable stand-ins for a main tip (a merge commit) and a pull request's head commit. */
const hex = (n) => n.toString(16).padStart(2, "0");
const tipSha = (i) => `${"a".repeat(38)}${hex(i)}`;
const headSha = (tip, n) => `${"b".repeat(36)}${hex(tip)}${hex(n)}`;

/**
 * `main` shaped the way this repository's actually is: every pull request lands
 * as a merge commit, so main's own tips are the merges — and each merge drags
 * that pull request's head commits into main's ancestry with dates a minute
 * either side of the tip they landed on.
 *
 * GitHub's `/commits?sha=main` returns that whole set newest-first, which is
 * the list the pruner reads. Measured on this repository, only 5 of the newest
 * 30 rows and 11 of the newest 100 are main tips; the rest are those head
 * commits (issue #1662).
 */
function mainHistory({ tips, headsPerTip = 4, tipSpacingMs = 2 * HOUR, now = NOW }) {
  const rows = [];
  for (let i = 0; i < tips; i++) {
    const tipAtMs = now - (i + 1) * tipSpacingMs;
    rows.push({
      sha: tipSha(i),
      parents: [{ sha: tipSha(i + 1) }, { sha: headSha(i, 0) }],
      commit: { committer: { date: new Date(tipAtMs).toISOString() } },
    });
    for (let n = 0; n < headsPerTip; n++) {
      rows.push({
        sha: headSha(i, n),
        parents: [{ sha: headSha(i, n + 1) }],
        commit: { committer: { date: new Date(tipAtMs - (n + 1) * 60_000).toISOString() } },
      });
    }
  }
  return rows;
}

const mainTips = (rows) => rows.map((row) => row.sha).filter((sha) => sha.startsWith("a"));

/** Serves `rows` the way the commits API does: pages of `pageSize`, newest first. */
function githubPages(rows, pageSize = 100) {
  return vi.fn(async (url) => {
    const page = Number(new URL(url).searchParams.get("page") || "1");
    return { ok: true, json: async () => rows.slice((page - 1) * pageSize, page * pageSize) };
  });
}

/** An S3 client that answers `out.json` probes for exactly `shasWithSnapshots`. */
function probeClient(shasWithSnapshots) {
  return {
    send: vi.fn(async (cmd) => {
      const prefix = cmd.input?.Prefix ?? "";
      const sha = prefix.replace("/out.json", "");
      return { Contents: shasWithSnapshots.includes(sha) ? [{ Key: prefix }] : [] };
    }),
  };
}

/** A fake bucket: prefix -> objects, plus the per-key errors DeleteObjects returns. */
function fakeBucket(objectsByPrefix, deleteErrors = []) {
  const sent = [];
  const s3Client = {
    send: vi.fn(async (cmd) => {
      sent.push(cmd);
      if (cmd.input?.Delimiter === "/") {
        return {
          CommonPrefixes: Object.keys(objectsByPrefix).map((Prefix) => ({ Prefix })),
          IsTruncated: false,
        };
      }
      if (cmd.input?.Delete) return { Errors: deleteErrors };
      return { Contents: objectsByPrefix[cmd.input?.Prefix] ?? [], IsTruncated: false };
    }),
  };
  const deletedKeys = () =>
    sent.flatMap((cmd) => cmd.input?.Delete?.Objects ?? []).map((object) => object.Key);
  return { s3Client, sent, deletedKeys };
}

describe("prune-visual-bucket-lib", () => {
  describe("snapshotExists", () => {
    it("asks the authenticated client, so a private bucket cannot read as empty", async () => {
      const s3Client = probeClient([SHA_1]);
      expect(await snapshotExists("test-bucket", SHA_1, { s3Client })).toBe(true);
      expect(await snapshotExists("test-bucket", SHA_2, { s3Client })).toBe(false);
      expect(s3Client.send.mock.calls[0][0].input).toMatchObject({
        Bucket: "test-bucket",
        Prefix: `${SHA_1}/out.json`,
      });
    });

    it("refuses to guess without a client", async () => {
      await expect(snapshotExists("test-bucket", SHA_1)).rejects.toThrow(/authenticated s3Client/);
    });
  });

  describe("resolveActiveBaseline", () => {
    const githubFetch = (shas) =>
      vi.fn(async () => ({ ok: true, json: async () => shas.map((sha) => ({ sha })) }));

    it("returns explicit commit when provided", async () => {
      const result = await resolveActiveBaseline({ explicitCommit: SHA_1 });
      expect(result.activeBaseline).toBe(SHA_1);
      expect(result.keepShas).toEqual([SHA_1]);
      expect(result.verified).toBe(true);
      expect(result.source).toBe("explicit");
    });

    it("throws when explicit commit is invalid", async () => {
      await expect(resolveActiveBaseline({ explicitCommit: "not-a-sha" })).rejects.toThrow(
        /Invalid explicit commit SHA/,
      );
    });

    it("keeps every recent main commit that has a snapshot, not only the newest", async () => {
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubFetch([SHA_1, SHA_2, SHA_3]),
        s3Client: probeClient([SHA_1, SHA_3]),
      });

      expect(result.activeBaseline).toBe(SHA_1);
      expect(result.keepShas).toEqual([SHA_1, SHA_3]);
      expect(result.verified).toBe(true);
      expect(result.source).toBe("head_commit");
    });

    it("walks back to a recent ancestor when HEAD has no snapshot", async () => {
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubFetch([SHA_1, SHA_2, SHA_3]),
        s3Client: probeClient([SHA_2]),
      });

      expect(result.activeBaseline).toBe(SHA_2);
      expect(result.headCommit).toBe(SHA_1);
      expect(result.source).toBe("recent_main_ancestor");
    });

    it("falls back to git when the GitHub API is unreachable", async () => {
      const git = vi.fn(() => `${SHA_1}\n${SHA_2}\n${SHA_3}`);
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: vi.fn(async () => ({ ok: false, status: 500 })),
        s3Client: probeClient([SHA_2]),
        git,
      });

      expect(git).toHaveBeenCalled();
      expect(result.activeBaseline).toBe(SHA_2);
      expect(result.source).toBe("recent_main_ancestor");
    });

    /**
     * The reverse of what this used to do. Nominating an unverified HEAD meant
     * pruning kept a prefix that was not in the bucket -- so every real
     * baseline became stale and one scheduled run emptied it.
     */
    it("reports no verified baseline rather than nominating one that is not there", async () => {
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubFetch([SHA_1, SHA_2]),
        s3Client: probeClient([]),
      });

      expect(result.verified).toBe(false);
      expect(result.keepShas).toEqual([]);
      expect(result.source).toBe("head_commit_unverified");
    });

    /**
     * The bug this file is the regression test for (issue #1662). The candidate
     * list is every ancestor of `main` newest-first, and four of every five
     * rows in it is a pull request's head commit — so "keep the ten newest
     * published ancestors" kept two main tips and spent the other eight slots
     * on head commits that `MIN_PRUNE_AGE_MS` was already holding. A branch cut
     * three merges ago then had no fork point left in the bucket, and a run
     * with no baseline compares nothing.
     */
    it("keeps main's own tips, not whatever ancestor published most recently", async () => {
      const rows = mainHistory({ tips: 6 });
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubPages(rows),
        s3Client: probeClient(rows.map((row) => row.sha)),
        now: NOW,
      });

      expect(result.keepShas).toEqual(mainTips(rows));
      expect(result.verified).toBe(true);
      expect(result.source).toBe("head_commit");
    });

    it("keeps a fork point the ten newest published ancestors would have evicted", async () => {
      const rows = mainHistory({ tips: 6 });
      // Flat position 10 or worse: outside every slot the old walk had to give.
      const forkPoint = tipSha(2);
      expect(rows.findIndex((row) => row.sha === forkPoint)).toBeGreaterThanOrEqual(10);

      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubPages(rows),
        s3Client: probeClient(rows.map((row) => row.sha)),
        now: NOW,
      });

      expect(result.keepShas).toContain(forkPoint);
      expect(result.keepShas).not.toContain(headSha(0, 0));
    });

    /**
     * A count alone re-files the bug it fixes: ten main tips is about twenty
     * hours at the measured merge rate, and a fork point has been measured at
     * 34.3 hours old when its branch's visual run published.
     */
    it("keeps every main tip inside the age window, past the count", async () => {
      // Tips six hours apart, so tip 11 lands on the 72-hour edge and tip 12
      // is outside it: twelve kept where the count alone would have kept ten.
      const rows = mainHistory({ tips: 20, tipSpacingMs: 6 * HOUR });
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubPages(rows),
        s3Client: probeClient(rows.map((row) => row.sha)),
        now: NOW,
      });

      expect(result.keepShas).toHaveLength(12);
      expect(result.keepShas).toContain(tipSha(11));
      expect(result.keepShas).not.toContain(tipSha(12));
    });

    it("keeps the count as a floor when main has gone quiet for a month", async () => {
      const rows = mainHistory({ tips: 14, tipSpacingMs: 2 * DAY });
      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl: githubPages(rows),
        s3Client: probeClient(rows.map((row) => row.sha)),
        now: NOW,
      });

      expect(result.keepShas).toEqual(mainTips(rows).slice(0, 10));
    });

    it("reads more than one page when one does not reach back far enough", async () => {
      const rows = mainHistory({ tips: 30 });
      const fetchImpl = githubPages(rows);
      await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl,
        s3Client: probeClient(rows.map((row) => row.sha)),
        now: NOW,
      });

      // 100 rows is 20 tips, which is 40 hours: short of the 72-hour window.
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
      expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("per_page")).toBe("100");
    });
  });

  describe("listBucketPrefixes", () => {
    it("lists all prefixes and handles pagination", async () => {
      let callCount = 0;
      const s3Client = {
        send: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              CommonPrefixes: [{ Prefix: "prefix-1/" }, { Prefix: "prefix-2/" }],
              IsTruncated: true,
              NextContinuationToken: "tok-1",
            };
          }
          return {
            CommonPrefixes: [{ Prefix: "prefix-3/" }],
            IsTruncated: false,
          };
        }),
      };

      const prefixes = await listBucketPrefixes({ s3Client, bucket: "test-bucket" });
      expect(prefixes).toEqual(["prefix-1/", "prefix-2/", "prefix-3/"]);
      expect(s3Client.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("listPrefixObjects", () => {
    it("lists objects under a prefix with sizes", async () => {
      const s3Client = {
        send: vi.fn(async () => ({
          Contents: [
            { Key: "prefix/out.json", Size: 100 },
            { Key: "prefix/index.html", Size: 200 },
          ],
          IsTruncated: false,
        })),
      };

      const objects = await listPrefixObjects({
        s3Client,
        bucket: "test-bucket",
        prefix: "prefix/",
      });
      expect(objects).toEqual([
        { Key: "prefix/out.json", Size: 100, LastModified: null },
        { Key: "prefix/index.html", Size: 200, LastModified: null },
      ]);
    });
  });

  describe("pruneVisualBucket", () => {
    it("keeps the named baselines and deletes the stale prefixes", async () => {
      const { s3Client, deletedKeys } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, Size: 20, LastModified: OLD }],
        [`${SHA_3}/`]: [{ Key: `${SHA_3}/out.json`, Size: 30, LastModified: OLD }],
      });

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1, SHA_2],
        now: NOW,
        log: () => {},
      });

      expect(result.keptPrefixes).toEqual([`${SHA_1}/`, `${SHA_2}/`]);
      expect(result.deletedPrefixes).toEqual([`${SHA_3}/`]);
      expect(deletedKeys()).toEqual([`${SHA_3}/out.json`]);
      expect(result.deletedBytesTotal).toBe(30);
    });

    /** A stacked layer's baseline is on no branch the main walk can enumerate. */
    it("never deletes a prefix younger than the prune floor", async () => {
      const { s3Client, deletedKeys } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, Size: 20, LastModified: RECENT }],
      });

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        now: NOW,
        log: () => {},
      });

      expect(result.keptRecentPrefixes).toEqual([`${SHA_2}/`]);
      expect(deletedKeys()).toEqual([]);
    });

    /**
     * The floor is a day, not a week: a branch that published two days ago and
     * is not a main baseline is captures nobody is comparing against any more.
     */
    it("deletes a prefix published two days ago", async () => {
      const { s3Client, deletedKeys } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, Size: 20, LastModified: TWO_DAYS_OLD }],
      });

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        now: NOW,
        log: () => {},
      });

      expect(result.keptRecentPrefixes).toEqual([]);
      expect(result.deletedPrefixes).toEqual([`${SHA_2}/`]);
      expect(deletedKeys()).toEqual([`${SHA_2}/out.json`]);
    });

    it("refuses to prune when nothing is named to keep", async () => {
      const { s3Client, deletedKeys } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
      });

      await expect(
        pruneVisualBucket({ s3Client, bucket: "test-bucket", keepShas: [], now: NOW }),
      ).rejects.toThrow(/no verified baseline/i);
      expect(deletedKeys()).toEqual([]);
    });

    it("does not delete objects when dryRun is true", async () => {
      const { s3Client, deletedKeys } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, Size: 20, LastModified: OLD }],
      });

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        dryRun: true,
        now: NOW,
        log: () => {},
      });

      expect(result.dryRun).toBe(true);
      expect(result.deletedPrefixes).toEqual([`${SHA_2}/`]);
      expect(deletedKeys()).toEqual([]);
    });

    /** DeleteObjects reports per-key failures in the body instead of throwing. */
    it("reports the keys S3 refused to delete", async () => {
      const { s3Client } = fakeBucket(
        {
          [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, Size: 10, LastModified: OLD }],
          [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, Size: 20, LastModified: OLD }],
        },
        [{ Key: `${SHA_2}/out.json`, Code: "AccessDenied" }],
      );

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        now: NOW,
        log: () => {},
      });

      expect(result.deleteErrors).toEqual([`${SHA_2}/out.json: AccessDenied`]);
    });
  });
});
