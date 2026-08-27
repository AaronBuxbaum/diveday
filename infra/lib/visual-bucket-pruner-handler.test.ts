import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  fetchCommits,
  hasSnapshot,
  listObjects,
  listPrefixes,
  pruneBucket,
} from "./visual-bucket-pruner-handler";

const SHA_1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_3 = "cccccccccccccccccccccccccccccccccccccccc";

const NOW = Date.UTC(2026, 7, 26, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const OLD = new Date(NOW - 30 * DAY);
const RECENT = new Date(NOW - 2 * DAY);

describe("visual-bucket-pruner-handler", () => {
  describe("fetchCommits", () => {
    it("parses valid commit SHAs from GitHub API", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        json: async () => [{ sha: SHA_1 }, { sha: SHA_2 }, { sha: "invalid-sha" }],
      })) as unknown as typeof fetch;

      const commits = await fetchCommits("AaronBuxbaum/diveday", "main", fetchImpl);
      expect(commits).toEqual([SHA_1, SHA_2]);
    });

    it("returns empty array on API error or malformed response", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as typeof fetch;

      const commits = await fetchCommits("AaronBuxbaum/diveday", "main", fetchImpl);
      expect(commits).toEqual([]);
    });
  });

  describe("hasSnapshot", () => {
    it("returns true when out.json is listed", async () => {
      const client = {
        send: vi.fn(async () => ({
          Contents: [{ Key: `${SHA_1}/out.json` }],
        })),
      } as unknown as S3Client;

      const exists = await hasSnapshot(client, "test-bucket", SHA_1);
      expect(exists).toBe(true);
    });

    it("returns false when prefix is empty", async () => {
      const client = {
        send: vi.fn(async () => ({
          Contents: [],
        })),
      } as unknown as S3Client;

      const exists = await hasSnapshot(client, "test-bucket", SHA_1);
      expect(exists).toBe(false);
    });
  });

  describe("listPrefixes", () => {
    it("collects prefixes across paginated responses", async () => {
      let call = 0;
      const client = {
        send: vi.fn(async () => {
          call++;
          if (call === 1) {
            return {
              CommonPrefixes: [{ Prefix: "prefix-1/" }],
              IsTruncated: true,
              NextContinuationToken: "tok",
            };
          }
          return {
            CommonPrefixes: [{ Prefix: "prefix-2/" }],
            IsTruncated: false,
          };
        }),
      } as unknown as S3Client;

      const prefixes = await listPrefixes(client, "test-bucket");
      expect(prefixes).toEqual(["prefix-1/", "prefix-2/"]);
      expect(client.send).toHaveBeenCalledTimes(2);
    });
  });

  describe("listObjects", () => {
    it("collects object keys under prefix", async () => {
      const client = {
        send: vi.fn(async () => ({
          Contents: [{ Key: "prefix/1.png" }, { Key: "prefix/2.png" }],
          IsTruncated: false,
        })),
      } as unknown as S3Client;

      const objects = await listObjects(client, "test-bucket", "prefix/");
      expect(objects.map((object) => object.key)).toEqual(["prefix/1.png", "prefix/2.png"]);
    });
  });

  describe("pruneBucket", () => {
    /**
     * `objectsByPrefix` maps a snapshot prefix to the objects the fake bucket
     * holds under it, so each test states only the ages it cares about.
     */
    function fakeBucket(
      objectsByPrefix: Record<string, Array<{ Key: string; LastModified?: Date }>>,
      deleteErrors: Array<{ Key: string; Code: string }> = [],
    ) {
      const sent: Array<{ input?: Record<string, unknown> }> = [];
      const client = {
        send: vi.fn(async (cmd: { input?: Record<string, unknown> }) => {
          sent.push(cmd);
          if (cmd.input?.Delimiter === "/") {
            return {
              CommonPrefixes: Object.keys(objectsByPrefix).map((Prefix) => ({ Prefix })),
              IsTruncated: false,
            };
          }
          if (cmd.input?.Delete) return { Errors: deleteErrors };
          const prefix = cmd.input?.Prefix as string | undefined;
          return { Contents: (prefix && objectsByPrefix[prefix]) || [], IsTruncated: false };
        }),
      } as unknown as S3Client;
      return { client, sent };
    }

    const deletedKeys = (sent: Array<{ input?: Record<string, unknown> }>) =>
      sent
        .flatMap((cmd) => {
          const request = cmd.input?.Delete as { Objects: Array<{ Key: string }> } | undefined;
          return request ? request.Objects : [];
        })
        .map((object) => object.Key);

    it("preserves every kept baseline and deletes the stale prefixes", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
        [`${SHA_2}/`]: [
          { Key: `${SHA_2}/out.json`, LastModified: OLD },
          { Key: `${SHA_2}/index.html`, LastModified: OLD },
        ],
      });

      const result = await pruneBucket(client, "test-bucket", [SHA_1], { now: NOW });
      expect(result.keptCount).toBe(1);
      expect(result.deletedPrefixesCount).toBe(1);
      expect(result.deletedObjectsCount).toBe(2);
      expect(deletedKeys(sent)).toEqual([`${SHA_2}/out.json`, `${SHA_2}/index.html`]);
    });

    it("keeps more than one baseline when more than one is named", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, LastModified: OLD }],
        [`${SHA_3}/`]: [{ Key: `${SHA_3}/out.json`, LastModified: OLD }],
      });

      const result = await pruneBucket(client, "test-bucket", [SHA_1, SHA_2], { now: NOW });
      expect(result.keptCount).toBe(2);
      expect(deletedKeys(sent)).toEqual([`${SHA_3}/out.json`]);
    });

    /**
     * A stacked pull request's baseline is the layer below's head commit, which
     * is on no branch the main-history walk can see. Age is what protects it.
     */
    it("never deletes a prefix younger than the prune floor", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, LastModified: RECENT }],
      });

      const result = await pruneBucket(client, "test-bucket", [SHA_1], { now: NOW });
      expect(result.keptRecentCount).toBe(1);
      expect(result.deletedPrefixesCount).toBe(0);
      expect(deletedKeys(sent)).toEqual([]);
    });

    it("keeps a prefix whose objects carry no timestamp", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json` }],
      });

      const result = await pruneBucket(client, "test-bucket", [SHA_1], { now: NOW });
      expect(result.keptRecentCount).toBe(1);
      expect(deletedKeys(sent)).toEqual([]);
    });

    it("refuses to prune when nothing is named to keep", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
      });

      await expect(pruneBucket(client, "test-bucket", [], { now: NOW })).rejects.toThrow(
        /no verified baseline/i,
      );
      expect(deletedKeys(sent)).toEqual([]);
    });

    /** DeleteObjects reports per-key failures in the body instead of throwing. */
    it("reports the keys S3 refused to delete", async () => {
      const { client } = fakeBucket(
        {
          [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
          [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, LastModified: OLD }],
        },
        [{ Key: `${SHA_2}/out.json`, Code: "AccessDenied" }],
      );

      const result = await pruneBucket(client, "test-bucket", [SHA_1], { now: NOW });
      expect(result.deleteErrors).toEqual([`${SHA_2}/out.json: AccessDenied`]);
    });
  });
});
