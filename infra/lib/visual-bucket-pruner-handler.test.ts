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

      const keys = await listObjects(client, "test-bucket", "prefix/");
      expect(keys).toEqual(["prefix/1.png", "prefix/2.png"]);
    });
  });

  describe("pruneBucket", () => {
    it("preserves active baseline prefix and deletes stale prefixes", async () => {
      const sentCommands: Array<{
        input?: {
          Delimiter?: string;
          Prefix?: string;
          Delete?: { Objects: Array<{ Key: string }> };
        };
      }> = [];
      const client = {
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
              Contents: [{ Key: `${SHA_2}/out.json` }, { Key: `${SHA_2}/index.html` }],
              IsTruncated: false,
            };
          }
          return { IsTruncated: false };
        }),
      } as unknown as S3Client;

      const result = await pruneBucket(client, "test-bucket", SHA_1);
      expect(result.keptCount).toBe(1);
      expect(result.deletedPrefixesCount).toBe(1);
      expect(result.deletedObjectsCount).toBe(2);

      const deleteCmd = sentCommands.find((cmd) => cmd.input?.Delete);
      expect(deleteCmd).toBeDefined();
      expect(deleteCmd?.input?.Delete?.Objects).toEqual([
        { Key: `${SHA_2}/out.json` },
        { Key: `${SHA_2}/index.html` },
      ]);
    });
  });
});
