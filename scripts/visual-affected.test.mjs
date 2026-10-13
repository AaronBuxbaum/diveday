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

const helpers = new Map([
  ...helperBodies(source),
  ...helperBodies(
    [
      "async function openSailedTrip(page: Page) {",
      '  await page.goto("/shop/blue-mantis/schedule/board");',
      '  await page.getByRole("link", { name: SAILED }).click();',
      "}",
    ].join("\n"),
  ),
]);

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
      ]),
    ).toHaveLength(2);
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
