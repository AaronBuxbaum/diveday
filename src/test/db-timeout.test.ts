import { describe, expect, it } from "vitest";

import { DB_TEST_TIMEOUT_MS, needsDatabaseTimeout } from "./db-timeout";

/**
 * The judgement this makes is invisible from a green run — a file either gets
 * 20s or 60s and nothing on screen says which — so it is pinned here rather
 * than left to be re-derived the next time a db test times out (issue #1306).
 */
describe("needsDatabaseTimeout", () => {
  it.each([
    "/home/runner/work/diveday/src/db/closeout.test.ts",
    "/home/runner/work/diveday/src/db/today.test.ts",
    "C:\\work\\diveday\\src\\db\\orders.test.ts",
  ])("gives %s the longer ceiling", (path) => {
    expect(needsDatabaseTimeout(path)).toBe(true);
  });

  it.each([
    "/home/runner/work/diveday/src/lib/readiness.test.ts",
    "/home/runner/work/diveday/src/components/Pager.test.tsx",
    // Named for the subject, not the layer: a pure test *about* the db layer
    // is still pure, and the path is all this predicate has to go on.
    "/home/runner/work/diveday/src/test/db-timeout.test.ts",
    "/home/runner/work/diveday/scripts/check-agents.test.mjs",
  ])("leaves %s on the suite's own ceiling", (path) => {
    expect(needsDatabaseTimeout(path)).toBe(false);
  });

  it("answers false rather than throwing when Vitest hands back no path", () => {
    expect(needsDatabaseTimeout(undefined)).toBe(false);
  });

  it("stays well above the eight hydrations closeout.test.ts pays for", () => {
    // Eight `seededShopContext()` calls at ~1.2s each on a contended runner is
    // ~10s of setup before a single assertion runs. The ceiling has to leave
    // room for the work *after* that, and still fail a genuinely hung test in
    // under a CI job's patience.
    expect(DB_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
    expect(DB_TEST_TIMEOUT_MS).toBeLessThanOrEqual(90_000);
  });
});
