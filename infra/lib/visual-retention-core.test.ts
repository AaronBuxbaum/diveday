import { describe, expect, it, vi } from "vitest";
import {
  BLOB_RETENTION_MS,
  blobHashesFromReport,
  CANDIDATE_PAGE_SIZE,
  chainCoversMainBaselineFloors,
  KEEP_MAIN_BASELINE_AGE_MS,
  KEEP_MAIN_BASELINES,
  MAX_CANDIDATE_PAGES,
  MIN_PRUNE_AGE_MS,
  MIN_PUBLICATION_GRACE_MS,
  mainBaselineProbeOrder,
  mainFirstParentChain,
  outsideMainBaselineAgeWindow,
  planBlobPrune,
  pruneBlobs,
  shouldFetchAnotherCandidatePage,
  shouldStopMainBaselineProbes,
} from "./visual-retention-core.mjs";

const NOW = Date.UTC(2026, 7, 26, 4);
const sha = (index: number) => index.toString(16).padStart(40, "0");
const commit = (index: number, parent: number, ageMs: number | null) => ({
  sha: sha(index),
  parentSha: parent < 0 ? "" : sha(parent),
  committedAtMs: ageMs === null ? null : NOW - ageMs,
});

describe("visual retention core", () => {
  it("owns the exact count, age, candidate and branch floors", () => {
    expect(KEEP_MAIN_BASELINES).toBe(10);
    expect(KEEP_MAIN_BASELINE_AGE_MS).toBe(72 * 60 * 60 * 1000);
    expect(MIN_PRUNE_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(MIN_PUBLICATION_GRACE_MS).toBe(30 * 60 * 1000);
    expect(CANDIDATE_PAGE_SIZE).toBe(100);
    expect(MAX_CANDIDATE_PAGES).toBe(4);
  });

  it("walks first parents only and stops at missing parents or cycles", () => {
    const rows = [commit(1, 2, 0), commit(3, 4, 0), commit(2, 1, 0)];
    expect(mainFirstParentChain(rows).map((row) => row.sha)).toEqual([sha(1), sha(2)]);
    expect(mainFirstParentChain([commit(5, 99, 0)])).toEqual([commit(5, 99, 0)]);
  });

  it("keeps unknown timestamps inside the age floor and respects the exact boundary", () => {
    expect(outsideMainBaselineAgeWindow(commit(1, -1, null), NOW)).toBe(false);
    expect(outsideMainBaselineAgeWindow(commit(1, -1, KEEP_MAIN_BASELINE_AGE_MS), NOW)).toBe(false);
    expect(outsideMainBaselineAgeWindow(commit(1, -1, KEEP_MAIN_BASELINE_AGE_MS + 1), NOW)).toBe(
      true,
    );
  });

  it("pages until the first-parent chain reaches beyond both floors, capped at four", () => {
    const young = Array.from({ length: 100 }, (_, i) => commit(i + 1, i + 2, i * 60_000));
    const deep = [...young, commit(101, 102, KEEP_MAIN_BASELINE_AGE_MS + 1)];
    expect(chainCoversMainBaselineFloors(deep, NOW)).toBe(true);
    expect(shouldFetchAnotherCandidatePage(1, CANDIDATE_PAGE_SIZE, young, NOW)).toBe(true);
    expect(shouldFetchAnotherCandidatePage(2, CANDIDATE_PAGE_SIZE, deep, NOW)).toBe(false);
    expect(
      shouldFetchAnotherCandidatePage(MAX_CANDIDATE_PAGES, CANDIDATE_PAGE_SIZE, young, NOW),
    ).toBe(false);
  });

  it("stops baseline probing only after both floors and provides malformed-parent fallback", () => {
    const aged = commit(1, -1, KEEP_MAIN_BASELINE_AGE_MS + 1);
    expect(shouldStopMainBaselineProbes(KEEP_MAIN_BASELINES - 1, aged, NOW)).toBe(false);
    expect(shouldStopMainBaselineProbes(KEEP_MAIN_BASELINES, aged, NOW)).toBe(true);
    const rows = [commit(1, -1, 0), commit(2, -1, 0)];
    expect(mainBaselineProbeOrder(rows)).toEqual({ chain: [rows[0]], fallback: rows });
  });
});

describe("blob keep set", () => {
  const DAYMS = 24 * 60 * 60 * 1000;
  const hash = (c: string) => c.repeat(64);
  const blob = (c: string, ageMs: number | null) => ({
    key: `blobs/${hash(c)}.png`,
    size: 100,
    etag: '"e"',
    lastModifiedMs: ageMs === null ? null : NOW - ageMs,
  });
  const report = (...cs: string[]) => ({
    actualBlobs: Object.fromEntries(cs.map((c, i) => [`shot-${i}`, hash(c)])),
  });

  it("deletes only old blobs that no kept manifest names", () => {
    const plan = planBlobPrune({
      manifests: [report("a"), report("b")],
      blobs: [
        blob("a", 90 * DAYMS),
        blob("b", 90 * DAYMS),
        blob("c", 90 * DAYMS),
        blob("d", DAYMS),
      ],
      now: NOW,
    });
    expect(plan.safe).toBe(true);
    expect(plan.remove.map((b) => b.key)).toEqual([`blobs/${hash("c")}.png`]);
    expect(plan.keep).toHaveLength(3);
  });

  it("keeps a referenced blob at any age and an unreferenced one inside the retention window", () => {
    const plan = planBlobPrune({
      manifests: [report("a")],
      blobs: [
        blob("a", 400 * DAYMS),
        blob("b", BLOB_RETENTION_MS - 1),
        blob("c", BLOB_RETENTION_MS),
      ],
      now: NOW,
    });
    expect(plan.remove.map((b) => b.key)).toEqual([`blobs/${hash("c")}.png`]);
  });

  it("treats an unknown write time as new and leaves non-blob keys alone", () => {
    const plan = planBlobPrune({
      manifests: [report("a")],
      blobs: [blob("b", null), { key: "blobs/notes.txt", lastModifiedMs: NOW - 400 * DAYMS }],
      now: NOW,
    });
    expect(plan.remove).toEqual([]);
  });

  it("never lets a caller shrink the window below the publication grace", () => {
    const plan = planBlobPrune({
      manifests: [report("a")],
      blobs: [blob("b", 60_000)],
      now: NOW,
      retentionMs: 0,
    });
    expect(plan.remove).toEqual([]);
  });

  it.each([
    ["no manifests", []],
    ["an unreadable manifest", [report("a"), null]],
    ["a manifest that is not an object", [report("a"), "oops"]],
    ["a malformed actualBlobs map", [report("a"), { actualBlobs: { x: "nothex" } }]],
    ["manifests that name no blobs", [{}, { actualBlobs: {} }]],
  ])("fails closed with %s", (_name, manifests) => {
    const plan = planBlobPrune({ manifests, blobs: [blob("z", 400 * DAYMS)], now: NOW });
    expect(plan.safe).toBe(false);
    expect(plan.remove).toEqual([]);
  });

  it("reads a pre-blob report as referencing nothing, not as malformed", () => {
    expect(blobHashesFromReport({ items: [] })).toEqual(new Set());
    expect(blobHashesFromReport(null)).toBeNull();
    expect(blobHashesFromReport([])).toBeNull();
  });

  describe("pruneBlobs", () => {
    const base = () => ({
      keepShas: [sha(1)],
      readManifest: async () => report("a"),
      listBlobs: async () => [blob("a", 90 * DAYMS), blob("c", 90 * DAYMS)],
      deleteBlobs: vi.fn(async (rows: { key: string }[]) => ({
        deleted: rows.map((r) => r.key),
        errors: [] as string[],
      })),
      now: NOW,
    });

    it("dry run reports the plan and deletes nothing", async () => {
      const input = base();
      const result = await pruneBlobs({ ...input, dryRun: true });
      expect(result.wouldDeleteCount).toBe(1);
      expect(result.deletedCount).toBe(0);
      expect(input.deleteBlobs).not.toHaveBeenCalled();
    });

    it("deletes the unreferenced old blob and reports bytes", async () => {
      const input = base();
      const result = await pruneBlobs(input);
      expect(input.deleteBlobs).toHaveBeenCalledWith([
        expect.objectContaining({ key: `blobs/${hash("c")}.png` }),
      ]);
      expect(result).toMatchObject({ deletedCount: 1, deletedBytes: 100, skipped: null });
    });

    it("fails closed, deleting nothing, when a manifest read throws", async () => {
      const input = base();
      const result = await pruneBlobs({
        ...input,
        readManifest: async () => {
          throw new Error("AccessDenied");
        },
      });
      expect(result.skipped).toMatch(/unreadable/);
      expect(input.deleteBlobs).not.toHaveBeenCalled();
    });

    it("fails closed when the manifest names nothing", async () => {
      const input = base();
      const result = await pruneBlobs({
        ...input,
        readManifest: async () => ({ actualBlobs: {} }),
      });
      expect(result.skipped).toMatch(/no blobs/);
      expect(input.deleteBlobs).not.toHaveBeenCalled();
    });
  });
});
