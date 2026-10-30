import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PAGE_SIZE,
  chainCoversMainBaselineFloors,
  KEEP_MAIN_BASELINE_AGE_MS,
  KEEP_MAIN_BASELINES,
  MAX_CANDIDATE_PAGES,
  MIN_PRUNE_AGE_MS,
  mainBaselineProbeOrder,
  mainFirstParentChain,
  outsideMainBaselineAgeWindow,
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
