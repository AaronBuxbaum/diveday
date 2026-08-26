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

describe("prune-visual-bucket-lib", () => {
  describe("snapshotExists", () => {
    it("returns true when HEAD request succeeds", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      const result = await snapshotExists("test-bucket", SHA_1, { fetchImpl });
      expect(result).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        `https://test-bucket.s3.amazonaws.com/${SHA_1}/out.json`,
        { method: "HEAD" },
      );
    });

    it("returns false when HEAD request returns 404 or throws", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const result = await snapshotExists("test-bucket", SHA_1, { fetchImpl });
      expect(result).toBe(false);

      const throwingFetch = vi.fn().mockRejectedValue(new Error("Network failure"));
      expect(await snapshotExists("test-bucket", SHA_1, { fetchImpl: throwingFetch })).toBe(false);
    });
  });

  describe("resolveActiveBaseline", () => {
    it("returns explicit commit when provided", async () => {
      const result = await resolveActiveBaseline({
        explicitCommit: SHA_1,
      });
      expect(result.activeBaseline).toBe(SHA_1);
      expect(result.source).toBe("explicit");
    });

    it("throws when explicit commit is invalid", async () => {
      await expect(resolveActiveBaseline({ explicitCommit: "not-a-sha" })).rejects.toThrow(
        /Invalid explicit commit SHA/,
      );
    });

    it("resolves head commit when HEAD has snapshot in S3", async () => {
      const fetchImpl = vi.fn(async (url) => {
        if (new URL(url).host === "api.github.com") {
          return {
            ok: true,
            json: async () => [{ sha: SHA_1 }, { sha: SHA_2 }],
          };
        }
        if (url.includes(SHA_1)) {
          return { ok: true, status: 200 };
        }
        return { ok: false, status: 404 };
      });

      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl,
      });

      expect(result.activeBaseline).toBe(SHA_1);
      expect(result.source).toBe("head_commit");
    });

    it("walks back to recent ancestor when HEAD has no snapshot in S3", async () => {
      const fetchImpl = vi.fn(async (url) => {
        if (new URL(url).host === "api.github.com") {
          return {
            ok: true,
            json: async () => [{ sha: SHA_1 }, { sha: SHA_2 }, { sha: SHA_3 }],
          };
        }
        if (url.includes(SHA_1)) {
          return { ok: false, status: 404 };
        }
        if (url.includes(SHA_2)) {
          return { ok: true, status: 200 };
        }
        return { ok: false, status: 404 };
      });

      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl,
      });

      expect(result.activeBaseline).toBe(SHA_2);
      expect(result.headCommit).toBe(SHA_1);
      expect(result.source).toBe("recent_main_ancestor");
    });

    it("falls back to git when GitHub API is unreachable", async () => {
      const fetchImpl = vi.fn(async (url) => {
        if (new URL(url).host === "api.github.com") {
          return { ok: false, status: 500 };
        }
        if (url.includes(SHA_2)) {
          return { ok: true, status: 200 };
        }
        return { ok: false, status: 404 };
      });

      const git = vi.fn(() => `${SHA_1}\n${SHA_2}\n${SHA_3}`);

      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl,
        git,
      });

      expect(git).toHaveBeenCalled();
      expect(result.activeBaseline).toBe(SHA_2);
      expect(result.source).toBe("recent_main_ancestor");
    });

    it("falls back to unverified HEAD if no candidates have snapshots in S3", async () => {
      const fetchImpl = vi.fn(async (url) => {
        if (new URL(url).host === "api.github.com") {
          return {
            ok: true,
            json: async () => [{ sha: SHA_1 }, { sha: SHA_2 }],
          };
        }
        return { ok: false, status: 404 };
      });

      const result = await resolveActiveBaseline({
        bucket: "test-bucket",
        fetchImpl,
      });

      expect(result.activeBaseline).toBe(SHA_1);
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
        { Key: "prefix/out.json", Size: 100 },
        { Key: "prefix/index.html", Size: 200 },
      ]);
    });
  });

  describe("pruneVisualBucket", () => {
    it("keeps target prefixes and deletes stale prefixes", async () => {
      const sentCommands = [];
      const s3Client = {
        send: vi.fn(async (cmd) => {
          sentCommands.push(cmd);
          if (cmd.input?.Delimiter === "/") {
            return {
              CommonPrefixes: [{ Prefix: `${SHA_1}/` }, { Prefix: `${SHA_2}/` }],
              IsTruncated: false,
            };
          }
          if (cmd.input?.Prefix === `${SHA_2}/`) {
            return {
              Contents: [
                { Key: `${SHA_2}/out.json`, Size: 50 },
                { Key: `${SHA_2}/index.html`, Size: 150 },
              ],
              IsTruncated: false,
            };
          }
          return { IsTruncated: false };
        }),
      };

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        dryRun: false,
        log: () => {},
      });

      expect(result.keptPrefixes).toEqual([`${SHA_1}/`]);
      expect(result.deletedPrefixes).toEqual([`${SHA_2}/`]);
      expect(result.deletedObjectsCount).toBe(2);
      expect(result.deletedBytesTotal).toBe(200);

      const deleteCmd = sentCommands.find((cmd) => cmd.input?.Delete);
      expect(deleteCmd).toBeDefined();
      expect(deleteCmd.input.Delete.Objects).toEqual([
        { Key: `${SHA_2}/out.json` },
        { Key: `${SHA_2}/index.html` },
      ]);
    });

    it("does not delete objects when dryRun is true", async () => {
      const sentCommands = [];
      const s3Client = {
        send: vi.fn(async (cmd) => {
          sentCommands.push(cmd);
          if (cmd.input?.Delimiter === "/") {
            return {
              CommonPrefixes: [{ Prefix: `${SHA_1}/` }, { Prefix: `${SHA_2}/` }],
              IsTruncated: false,
            };
          }
          if (cmd.input?.Prefix === `${SHA_2}/`) {
            return {
              Contents: [{ Key: `${SHA_2}/out.json`, Size: 50 }],
              IsTruncated: false,
            };
          }
          return {};
        }),
      };

      const result = await pruneVisualBucket({
        s3Client,
        bucket: "test-bucket",
        keepShas: [SHA_1],
        dryRun: true,
        log: () => {},
      });

      expect(result.dryRun).toBe(true);
      expect(result.deletedObjectsCount).toBe(1);
      const deleteCmd = sentCommands.find((cmd) => cmd.input?.Delete);
      expect(deleteCmd).toBeUndefined();
    });
  });
});
