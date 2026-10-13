import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  captureSpans,
  changedRoutes,
  covers,
  FULL_SHARDS,
  filterReport,
  helperBodies,
  literalPaths,
  parseHunks,
  SMOKE,
  selectCaptures,
  shardCount,
} from "./visual-affected.mjs";

/** A `playwright test --list --reporter=json` report of two describes, as the real one nests. */
const report = {
  suites: [
    {
      title: "visual.spec.ts",
      file: "visual.spec.ts",
      specs: [],
      suites: [
        {
          title: "light mode",
          file: "visual.spec.ts",
          specs: [
            { title: "the gear register renders true to the design (light)", line: 3 },
            { title: "the day spine renders true to the design (light)", line: 7 },
            { title: "a trip's crew renders true to the design (light)", line: 11 },
            { title: "the public course page renders true to the design (light)", line: 15 },
            { title: "the walk-in counter renders true to the design (light)", line: 19 },
          ],
          suites: [],
        },
      ],
    },
  ],
};

const source = [
  'const GEAR = "/shop/blue-mantis/gear";', // 1
  "", // 2
  "test(`the gear register renders true to the design (${scheme})`, async ({ page }) => {", // 3
  "  await page.goto(GEAR);", // 4
  "});", // 5
  "", // 6
  "test(`the day spine renders true to the design (${scheme})`, async ({ page }) => {", // 7
  '  await page.goto("/shop/blue-mantis");', // 8
  "});", // 9
  "", // 10
  "test(`a trip's crew renders true to the design (${scheme})`, async ({ page }) => {", // 11
  "  await openSailedTrip(page);", // 12
  "});", // 13
  "", // 14
  "test(`the public course page renders true to the design (${scheme})`, async ({ page }) => {", // 15
  '  await page.goto("/s/blue-mantis/courses/open-water");', // 16
  "});", // 17
  "", // 18
  "test(`the walk-in counter renders true to the design (${scheme})`, async ({ page }) => {", // 19
  "  await openWalkIn(page);", // 20
  "});", // 21
].join("\n");

const helpersSource = [
  'import { expect } from "@playwright/test";', // 1
  "", // 2
  "async function openSailedTrip(page: Page) {", // 3
  '  await page.goto("/shop/blue-mantis/schedule/board");', // 4
  '  await page.getByRole("link", { name: SAILED }).click();', // 5
  "}", // 6
].join("\n");

const helpers = new Map([...helperBodies(source), ...helperBodies(helpersSource)]);

/** The import graph `e2e-affected.mjs` builds, by hand: two pages and what they import. */
const graph = new Map([
  ["src/app/shop/[shopSlug]/gear/page.tsx", new Set(["src/lib/gear.ts"])],
  ["src/app/s/[shopSlug]/courses/[slug]/page.tsx", new Set(["src/lib/courses.ts"])],
  ["src/lib/gear.ts", new Set()],
  ["src/lib/courses.ts", new Set()],
  ["src/lib/orphan.ts", new Set()],
]);

const picked = (changed) => {
  const result = selectCaptures({ changed, graph, report, source, helpers });
  return result.mode === "all" ? result : [...result.lines].map((line) => line.split(" › ").at(-1));
};

describe("what a pull request captures", () => {
  it("a page change captures the captures that visit it, its ancestors' visitors, and the smoke set", () => {
    expect(picked(["src/app/shop/[shopSlug]/gear/page.tsx"])).toEqual([
      "the gear register renders true to the design (light)",
      "the day spine renders true to the design (light)",
      "the walk-in counter renders true to the design (light)",
    ]);
  });

  it("follows a module's importers to the pages that draw it", () => {
    expect(picked(["src/lib/courses.ts"])).toEqual([
      "the day spine renders true to the design (light)",
      "the public course page renders true to the design (light)",
      "the walk-in counter renders true to the design (light)",
    ]);
  });

  it("reads a route through the helper a capture calls", () => {
    expect(picked(["src/app/shop/[shopSlug]/schedule/board/page.tsx"])).toContain(
      "a trip's crew renders true to the design (light)",
    );
  });

  it("captures what names no route at all, since nothing says what it visits", () => {
    expect(picked(["docs/agents/verifying.md"])).toEqual([
      "the day spine renders true to the design (light)",
      "the walk-in counter renders true to the design (light)",
    ]);
  });

  it("captures everything a layout change sits above", () => {
    expect(picked(["src/app/shop/[shopSlug]/layout.tsx"])).toEqual([
      "the gear register renders true to the design (light)",
      "the day spine renders true to the design (light)",
      "a trip's crew renders true to the design (light)",
      "the walk-in counter renders true to the design (light)",
    ]);
  });

  it("captures everything when the diff cannot be bounded", () => {
    for (const changed of [
      ["e2e/visual.spec.ts"],
      ["e2e/fixtures.ts"],
      ["src/app/globals.css"],
      ["src/i18n/locales/en-US/diver.json"],
      ["src/db/seed-trips.ts"],
      ["src/db/schema/trips.ts"],
      ["public/marine-life/turtle.jpg"],
      ["package.json"],
      ["next.config.ts"],
      ["scripts/visual-compare.mjs"],
      [".github/workflows/ci.yml"],
      ["src/lib/orphan.ts"],
      ["src/lib/deleted.ts"],
    ]) {
      expect(picked(changed).mode, changed[0]).toBe("all");
    }
  });

  it("ignores what no capture can see", () => {
    expect(
      picked([
        "docs/x.md",
        ".claude/skills/verify/SKILL.md",
        "infra/lib/infra-stack.ts",
        "src/lib/gear.test.ts",
        "e2e/booking.spec.ts",
        "scripts/verify-push.mjs",
        ".github/workflows/durations-refresh.yml",
        ".env.example",
        ".coderabbit.yaml",
        ".agents/skills/tdd/SKILL.md",
        "vercel.json",
        ".gitattributes",
      ]),
    ).toHaveLength(2);
    // Imported by next.config.ts and src/, so never inert.
    expect(picked(["config/env-registry.mjs"]).mode).toBe("all");
  });
});

describe("an edit to the visual spec or the helpers, read by its hunks", () => {
  const pickedByHunks = (changed, hunks) => {
    const result = selectCaptures({
      changed,
      graph,
      report,
      source,
      helpers,
      hunks,
      helpersSource,
    });
    return result.mode === "all"
      ? result
      : [...result.lines].map((line) => line.split(" › ").at(-1));
  };
  const ALWAYS = [
    "the day spine renders true to the design (light)",
    "the walk-in counter renders true to the design (light)",
  ];

  it("captures the capture whose own lines a hunk touches", () => {
    expect(pickedByHunks(["e2e/visual.spec.ts"], { "e2e/visual.spec.ts": [[16, 16]] })).toEqual([
      ALWAYS[0],
      "the public course page renders true to the design (light)",
      ALWAYS[1],
    ]);
  });

  it("captures every capture that calls a helper or constant the diff edits", () => {
    expect(pickedByHunks(["e2e/visual.spec.ts"], { "e2e/visual.spec.ts": [[1, 1]] })).toEqual([
      "the gear register renders true to the design (light)",
      ...ALWAYS,
    ]);
    expect(pickedByHunks(["e2e/helpers.ts"], { "e2e/helpers.ts": [[4, 4]] })).toEqual([
      ALWAYS[0],
      "a trip's crew renders true to the design (light)",
      ALWAYS[1],
    ]);
  });

  it("captures everything for a hunk in no capture and no helper, or with no hunks to read", () => {
    expect(pickedByHunks(["e2e/visual.spec.ts"], { "e2e/visual.spec.ts": [[6, 6]] }).mode).toBe(
      "all",
    );
    expect(pickedByHunks(["e2e/helpers.ts"], { "e2e/helpers.ts": [[1, 1]] }).mode).toBe("all");
    expect(picked(["e2e/visual.spec.ts"]).mode).toBe("all");
    expect(picked(["e2e/helpers.ts"]).mode).toBe("all");
  });

  it("still captures everything when another file in the diff is unbounded", () => {
    expect(
      pickedByHunks(["e2e/visual.spec.ts", "src/app/globals.css"], {
        "e2e/visual.spec.ts": [[16, 16]],
      }).mode,
    ).toBe("all");
  });

  it("parses a zero-context diff into new-side ranges, a deletion as the lines around it", () => {
    const diff = [
      "diff --git a/e2e/visual.spec.ts b/e2e/visual.spec.ts",
      "--- a/e2e/visual.spec.ts",
      "+++ b/e2e/visual.spec.ts",
      "@@ -10,2 +10,3 @@ test(",
      "@@ -40 +41 @@",
      "@@ -50,4 +51,0 @@",
      "diff --git a/e2e/helpers.ts b/e2e/helpers.ts",
      "--- a/e2e/helpers.ts",
      "+++ b/e2e/helpers.ts",
      "@@ -7,0 +8,2 @@",
    ].join("\n");
    expect(parseHunks(diff)).toEqual({
      "e2e/visual.spec.ts": [
        [10, 12],
        [41, 41],
        [51, 52],
      ],
      "e2e/helpers.ts": [[8, 9]],
    });
  });
});

describe("the pieces", () => {
  it("says why a diff is unbounded", () => {
    expect(changedRoutes(["src/app/globals.css"], graph).all).toMatch(/globals\.css/);
    expect(changedRoutes(["src/app/shop/[shopSlug]/gear/page.tsx"], graph).routes).toEqual([
      { route: "/shop/[shopSlug]/gear", broad: false },
    ]);
  });

  it("matches a literal path to a route and its descendants, never a sibling", () => {
    expect(covers("/shop/blue-mantis", "/shop/[shopSlug]/gear")).toBe(true);
    expect(covers("/shop/blue-mantis/gear", "/shop/[shopSlug]/gear")).toBe(true);
    expect(covers("/shop/${SHOP}/trips/${id}", "/shop/[shopSlug]/trips/[id]")).toBe(true);
    expect(covers("/shop/blue-mantis/divers", "/shop/[shopSlug]/gear")).toBe(false);
    expect(covers("/s/blue-mantis", "/shop/[shopSlug]/gear")).toBe(false);
  });

  it("reads paths from literals, and a bare slash only as a navigation", () => {
    expect([
      ...literalPaths(
        'page.goto("/shop/blue-mantis/trips/" + id); x.split("/"); fetch("/api/test/reset"); page.goto("/")',
      ),
    ]).toEqual(["/shop/blue-mantis/trips", "/"]);
  });

  it("gives every capture the lines up to the next one", () => {
    const spans = captureSpans(report, source.split("\n"));
    expect(spans[0].text).toContain("page.goto(GEAR)");
    expect(spans[0].text).not.toContain('/shop/blue-mantis"');
  });

  it("keeps only the chosen specs, and no empty suite", () => {
    const keep = new Set([
      "visual.spec.ts › light mode › the day spine renders true to the design (light)",
    ]);
    const filtered = filterReport(report, keep);
    expect(filtered.suites[0].suites[0].specs).toHaveLength(1);
    expect(filterReport(report, new Set()).suites).toEqual([]);
  });

  it("deals a narrowed set onto as few shards as keep each near a full shard's weight", () => {
    const durations = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`visual.spec.ts › t${i}`, 10_000]),
    );
    const all = Object.keys(durations);
    expect(shardCount(all, durations)).toBe(FULL_SHARDS);
    expect(shardCount(all.slice(0, 15), durations)).toBe(2);
    expect(shardCount(all.slice(0, 1), durations)).toBe(1);
    expect(shardCount(["a", "b"], {})).toBe(2);
  });

  it("names a smoke set the visual spec still has, so a rename cannot empty it silently", () => {
    const spec = readFileSync(new URL("../e2e/visual.spec.ts", import.meta.url), "utf8");
    for (const pattern of SMOKE) {
      const title = pattern.source.replace(/^› /, "").replace(/\\\($/, "(").replace(/\\/g, "");
      expect(spec, title).toContain(title);
    }
  });
});
