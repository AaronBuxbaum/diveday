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
const OLD = new Date(NOW - 30 * DAY);
const RECENT = new Date(NOW - 2 * DAY);

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
