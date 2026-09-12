import { readFileSync } from "node:fs";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  CANDIDATE_PAGE_SIZE,
  fetchCommits,
  fetchMainCandidates,
  hasSnapshot,
  KEEP_MAIN_BASELINE_AGE_MS,
  KEEP_MAIN_BASELINES,
  listObjects,
  listPrefixes,
  MAX_CANDIDATE_PAGES,
  MIN_PRUNE_AGE_MS,
  type PrunerCommit,
  pruneBucket,
  resolveKeepShas,
} from "./visual-bucket-pruner-handler";

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

/** Readable stand-ins for a main tip (a merge commit) and a pull request's head. */
const hex = (n: number) => n.toString(16).padStart(2, "0");
const tipSha = (i: number) => `${"a".repeat(38)}${hex(i)}`;
const headSha = (tip: number, n: number) => `${"b".repeat(36)}${hex(tip)}${hex(n)}`;

/**
 * main the shape this repository's actually is: every pull request lands as a
 * merge commit, so main's own tips are the merges -- and each merge drags that
 * pull request's head commits into main's ancestry with dates a minute either
 * side of the tip they landed on. GitHub's /commits?sha=main is that whole set
 * newest-first, which is the list the pruner reads: measured on this
 * repository, only 5 of the newest 30 rows are main tips (issue #1662).
 */
function mainHistory({
  tips,
  headsPerTip = 4,
  tipSpacingMs = 2 * HOUR,
  now = NOW,
}: {
  tips: number;
  headsPerTip?: number;
  tipSpacingMs?: number;
  now?: number;
}): PrunerCommit[] {
  const rows: PrunerCommit[] = [];
  for (let i = 0; i < tips; i++) {
    const tipAtMs = now - (i + 1) * tipSpacingMs;
    rows.push({ sha: tipSha(i), parentSha: tipSha(i + 1), committedAtMs: tipAtMs });
    for (let n = 0; n < headsPerTip; n++) {
      rows.push({
        sha: headSha(i, n),
        parentSha: headSha(i, n + 1),
        committedAtMs: tipAtMs - (n + 1) * 60_000,
      });
    }
  }
  return rows;
}

const mainTips = (rows: readonly PrunerCommit[]) =>
  rows.map((row) => row.sha).filter((sha) => sha.startsWith("a"));

/** An S3 client that answers out.json probes for exactly `shasWithSnapshots`. */
function probeClient(shasWithSnapshots: readonly string[]) {
  return {
    send: vi.fn(async (cmd: { input?: Record<string, unknown> }) => {
      const prefix = String(cmd.input?.Prefix ?? "");
      const sha = prefix.replace("/out.json", "");
      return { Contents: shasWithSnapshots.includes(sha) ? [{ Key: prefix }] : [] };
    }),
  } as unknown as S3Client;
}

describe("visual-bucket-pruner-handler", () => {
  /**
   * The four retention constants live in two copies by design -- this handler
   * is bundled into a Lambda and cannot import from scripts/ -- and ADR
   * 20260826-prune-visual-bucket says in prose that they must move together.
   * Nothing enforced it, which is how a value could drift in one copy and be
   * discovered only by a branch finding no baseline. This is the enforcement.
   */
  it("holds the same retention constants as the CLI copy in scripts/", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts/prune-visual-bucket-lib.mjs"),
      "utf8",
    );
    const cliConstant = (name: string) => {
      const match = source.match(new RegExp(`export const ${name} = ([^;]+);`));
      if (!match) throw new Error(`${name} is not exported from prune-visual-bucket-lib.mjs`);
      // Arithmetic literals such as `72 * 60 * 60 * 1000`, and nothing else.
      const expression = match[1].trim();
      if (!/^[\d\s*+]+$/.test(expression)) throw new Error(`${name} is not a plain number`);
      return Number(new Function(`return ${expression}`)());
    };

    expect(cliConstant("KEEP_MAIN_BASELINES")).toBe(KEEP_MAIN_BASELINES);
    expect(cliConstant("KEEP_MAIN_BASELINE_AGE_MS")).toBe(KEEP_MAIN_BASELINE_AGE_MS);
    expect(cliConstant("MIN_PRUNE_AGE_MS")).toBe(MIN_PRUNE_AGE_MS);
    expect(cliConstant("CANDIDATE_PAGE_SIZE")).toBe(CANDIDATE_PAGE_SIZE);
    expect(cliConstant("MAX_CANDIDATE_PAGES")).toBe(MAX_CANDIDATE_PAGES);
  });

  describe("fetchCommits", () => {
    it("parses valid commit SHAs from GitHub API", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        json: async () => [{ sha: SHA_1 }, { sha: SHA_2 }, { sha: "invalid-sha" }],
      })) as unknown as typeof fetch;

      const commits = await fetchCommits("AaronBuxbaum/diveday", "main", fetchImpl);
      expect(commits.map((commit) => commit.sha)).toEqual([SHA_1, SHA_2]);
    });

    /** The chain walk and the age window are both read out of the payload. */
    it("carries the first parent and the commit date of every row", async () => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            sha: SHA_1,
            parents: [{ sha: SHA_2 }, { sha: SHA_3 }],
            commit: { committer: { date: "2026-08-26T02:00:00Z" } },
          },
        ],
      })) as unknown as typeof fetch;

      const commits = await fetchCommits("AaronBuxbaum/diveday", "main", fetchImpl);
      expect(commits).toEqual([
        { sha: SHA_1, parentSha: SHA_2, committedAtMs: Date.UTC(2026, 7, 26, 2, 0, 0) },
      ]);
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

  describe("resolveKeepShas", () => {
    /**
     * The bug this is the regression test for (issue #1662). "Keep the ten
     * newest published ancestors" kept two main tips and spent the other eight
     * slots on pull-request head commits that MIN_PRUNE_AGE_MS was already
     * holding, so a branch cut three merges back had no fork point left in the
     * bucket -- and a run with no baseline compares nothing.
     */
    it("keeps main's own tips, not whatever ancestor published most recently", async () => {
      const rows = mainHistory({ tips: 6 });
      const keep = await resolveKeepShas(
        probeClient(rows.map((row) => row.sha)),
        "test-bucket",
        rows,
        { now: NOW },
      );

      expect(keep).toEqual(mainTips(rows));
      expect(keep).not.toContain(headSha(0, 0));
    });

    it("keeps a fork point the ten newest published ancestors would have evicted", async () => {
      const rows = mainHistory({ tips: 6 });
      const forkPoint = tipSha(2);
      // Flat position 10 or worse: outside every slot the old walk had to give.
      expect(rows.findIndex((row) => row.sha === forkPoint)).toBeGreaterThanOrEqual(10);

      const keep = await resolveKeepShas(
        probeClient(rows.map((row) => row.sha)),
        "test-bucket",
        rows,
        { now: NOW },
      );
      expect(keep).toContain(forkPoint);
    });

    it("keeps every main tip inside the age window, past the count", async () => {
      // Tips six hours apart, so tip 11 lands on the 72-hour edge and tip 12 is
      // outside it: twelve kept where the count alone would have kept ten.
      const rows = mainHistory({ tips: 20, tipSpacingMs: 6 * HOUR });
      const keep = await resolveKeepShas(
        probeClient(rows.map((row) => row.sha)),
        "test-bucket",
        rows,
        { now: NOW },
      );

      expect(keep).toHaveLength(12);
      expect(keep).toContain(tipSha(11));
      expect(keep).not.toContain(tipSha(12));
    });

    it("keeps the count as a floor when main has gone quiet for a month", async () => {
      const rows = mainHistory({ tips: 14, tipSpacingMs: 2 * DAY });
      const keep = await resolveKeepShas(
        probeClient(rows.map((row) => row.sha)),
        "test-bucket",
        rows,
        { now: NOW },
      );

      expect(keep).toEqual(mainTips(rows).slice(0, KEEP_MAIN_BASELINES));
    });

    /** Rows with no parent links leave a chain of one; keep what it used to. */
    it("falls back to the flat walk when the payload carried no parent links", async () => {
      const rows: PrunerCommit[] = [SHA_1, SHA_2, SHA_3].map((sha) => ({
        sha,
        parentSha: "",
        committedAtMs: NOW - HOUR,
      }));

      const keep = await resolveKeepShas(probeClient([SHA_2, SHA_3]), "test-bucket", rows, {
        now: NOW,
      });
      expect(keep).toEqual([SHA_2, SHA_3]);
    });

    it("comes back empty when no main tip has a snapshot", async () => {
      const rows = mainHistory({ tips: 6 });
      expect(await resolveKeepShas(probeClient([]), "test-bucket", rows, { now: NOW })).toEqual([]);
    });
  });

  describe("fetchMainCandidates", () => {
    it("reads more than one page when one does not reach back far enough", async () => {
      const rows = mainHistory({ tips: 30 });
      const fetchImpl = vi.fn(async (url: string) => ({
        ok: true,
        json: async () => {
          const page = Number(new URL(url).searchParams.get("page") || "1");
          return rows
            .slice((page - 1) * CANDIDATE_PAGE_SIZE, page * CANDIDATE_PAGE_SIZE)
            .map((row) => ({
              sha: row.sha,
              parents: [{ sha: row.parentSha }],
              commit: { committer: { date: new Date(row.committedAtMs ?? NOW).toISOString() } },
            }));
        },
      })) as unknown as typeof fetch;

      const candidates = await fetchMainCandidates("AaronBuxbaum/diveday", "main", {
        fetchImpl,
        now: NOW,
      });

      // 100 rows is 20 tips, which is 40 hours: short of the 72-hour window.
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        1,
      );
      expect(candidates.length).toBeGreaterThan(CANDIDATE_PAGE_SIZE);
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

    /**
     * The floor is a day, not a week: a branch that published two days ago and
     * is not a main baseline is captures nobody is comparing against any more.
     */
    it("deletes a prefix published two days ago", async () => {
      const { client, sent } = fakeBucket({
        [`${SHA_1}/`]: [{ Key: `${SHA_1}/out.json`, LastModified: OLD }],
        [`${SHA_2}/`]: [{ Key: `${SHA_2}/out.json`, LastModified: TWO_DAYS_OLD }],
      });

      const result = await pruneBucket(client, "test-bucket", [SHA_1], { now: NOW });
      expect(result.keptRecentCount).toBe(0);
      expect(result.deletedPrefixesCount).toBe(1);
      expect(deletedKeys(sent)).toEqual([`${SHA_2}/out.json`]);
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
