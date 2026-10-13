import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { floorMarkersIn, sharedFirstLoadChunks } from "./perf-budget.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The one judgement this guard makes is *which* chunks count as the floor, and
 * it is the judgement the previous version got wrong — it measured a set that
 * did not contain the route-level shared chunks at all, so 83.5 KB of zod
 * entering every route moved the number not at all.
 */
describe("sharedFirstLoadChunks", () => {
  it("is an intersection, not a union", () => {
    // The distinction is the whole guard: a chunk two routes happen to share is
    // their cost, not the floor every route pays.
    expect(
      sharedFirstLoadChunks([
        { route: "/a", firstLoadChunkPaths: ["common.js", "only-a.js"] },
        { route: "/b", firstLoadChunkPaths: ["common.js", "only-b.js"] },
        { route: "/c", firstLoadChunkPaths: ["common.js"] },
      ]),
    ).toEqual(["common.js"]);
  });

  it("ignores routes that ship no client bundle", () => {
    // Route handlers appear in the stats with an empty list. Counting them would
    // make the intersection empty and the floor read as zero — a guard reporting
    // success precisely because it measured nothing.
    expect(
      sharedFirstLoadChunks([
        { route: "/api/x", firstLoadChunkPaths: [] },
        { route: "/a", firstLoadChunkPaths: ["common.js", "only-a.js"] },
        { route: "/b", firstLoadChunkPaths: ["common.js"] },
      ]),
    ).toEqual(["common.js"]);
  });

  it("returns nothing when the routes share nothing", () => {
    expect(
      sharedFirstLoadChunks([
        { route: "/a", firstLoadChunkPaths: ["a.js"] },
        { route: "/b", firstLoadChunkPaths: ["b.js"] },
      ]),
    ).toEqual([]);
  });

  it("returns nothing for an empty build rather than throwing", () => {
    expect(sharedFirstLoadChunks([])).toEqual([]);
  });

  it("keeps a chunk shared by a single route, which is that route's own floor", () => {
    expect(
      sharedFirstLoadChunks([{ route: "/only", firstLoadChunkPaths: ["x.js", "y.js"] }]),
    ).toEqual(["x.js", "y.js"]);
  });
});

describe("floorMarkersIn", () => {
  // The floor fell 4.2 KB of the 18 a fix expected, and the total stayed under
  // its ceiling, so nothing said the staff palette was still in all 107 routes
  // (code review 2026-10-13b, item 7). A floor chunk that carries the staff
  // shell is the regression this guard is named after, whatever it weighs.
  it("names the palette's shortcut and the row menu's open mark", () => {
    expect(floorMarkersIn('e.jsx("button",{"aria-keyshortcuts":"Meta+K Control+K"})')).toEqual([
      "aria-keyshortcuts",
    ]);
    expect(floorMarkersIn('"has-[[data-row-menu-open]]:z-20"')).toEqual(["data-row-menu-open"]);
  });

  it("names the Sentry SDK's global carrier", () => {
    // About 57 KB of the floor until the browser SDK loaded on idle (item 34).
    expect(floorMarkersIn("var c=globalThis.__SENTRY__=globalThis.__SENTRY__||{}")).toEqual([
      "__SENTRY__",
    ]);
  });

  it("leaves a diver chunk alone", () => {
    expect(floorMarkersIn('e.jsx("a",{href:"/s/blue-mantis",children:"Book"})')).toEqual([]);
  });
});

describe("the budget against the real build", () => {
  const stats = path.join(ROOT, ".next/diagnostics/route-bundle-stats.json");

  it.runIf(existsSync(stats))("measures a floor that is not the whole bundle", () => {
    const routeStats = JSON.parse(readFileSync(stats, "utf8"));
    const shared = sharedFirstLoadChunks(routeStats);
    expect(shared.length).toBeGreaterThan(0);

    const floor = shared.reduce(
      (total, chunk) => total + gzipSync(readFileSync(path.join(ROOT, chunk))).length,
      0,
    );
    // Sanity in both directions: a floor of zero means the intersection broke,
    // and a floor equal to the heaviest route means it degenerated into a union.
    const heaviest = Math.max(
      ...routeStats
        .filter((route) => route.firstLoadChunkPaths?.length)
        .map((route) =>
          route.firstLoadChunkPaths.reduce(
            (total, chunk) => total + gzipSync(readFileSync(path.join(ROOT, chunk))).length,
            0,
          ),
        ),
    );
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThanOrEqual(heaviest);
  });

  it.runIf(existsSync(stats))("finds no staff shell and no Sentry SDK on the floor", () => {
    const routeStats = JSON.parse(readFileSync(stats, "utf8"));
    const carrying = sharedFirstLoadChunks(routeStats).filter(
      (chunk) => floorMarkersIn(readFileSync(path.join(ROOT, chunk), "utf8")).length > 0,
    );
    expect(carrying).toEqual([]);
  });
});
