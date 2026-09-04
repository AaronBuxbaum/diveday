import { resolve } from "node:path";
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

  /**
   * **The gap the path rule alone left open**, and the reason it is now two
   * rules. These are real files, resolved from the repository root, because the
   * second rule reads them — a made-up path proves only that an unreadable file
   * answers false.
   */
  it("gives a db-backed test that lives beside its feature the longer ceiling", () => {
    // Six `seededShopContext()` hydrations, nowhere near `src/db`. It timed out
    // at 20s on a contended runner, which is what added this rule.
    expect(needsDatabaseTimeout(resolve("src/app/api/test/seed-evening/route.test.ts"))).toBe(true);
  });

  it("leaves a real file that touches no database on the suite's own ceiling", () => {
    // This file. It is named for the db layer and reads none, which is exactly
    // the case the path rule alone gets wrong in the other direction.
    expect(needsDatabaseTimeout(resolve("src/test/db-timeout.test.ts"))).toBe(false);
  });

  it("answers false rather than throwing when Vitest hands back no path", () => {
    expect(needsDatabaseTimeout(undefined)).toBe(false);
  });

  it("answers false rather than throwing for a path that is not on disk", () => {
    // The predicate runs in setup, before anything else; one that threw would
    // take the whole run down rather than one test.
    expect(needsDatabaseTimeout("/nowhere/at/all/ghost.test.ts")).toBe(false);
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
