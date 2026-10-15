import { describe, expect, it } from "vitest";

import {
  HUB_SPECS,
  importersOf,
  overlapScores,
  parseDiff,
  readSpecs,
  removedText,
  routeOf,
  routePattern,
  SMOKE,
  selectSpecs,
  smokeTests,
  stackBase,
  symbolsOf,
  textOf,
  withinBudget,
} from "./e2e-affected.mjs";
import { moduleIndex } from "./symbol-reach.mjs";

/**
 * The cases are the breaks that reached CI between 2026-10-09 and 2026-10-12: each one is a
 * spec that a selector reading the same diff would have named. The "leaves alone" cases keep
 * the selection narrow enough that a session can wait for it.
 */

const diffOf = (file, removed, added = []) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");

describe("removed text a spec still quotes", () => {
  it("finds a deleted locale value in the spec that asserts on it (sightings, 2026-10-12)", () => {
    const sentence =
      "What the crew logged, and when. It says what was seen, not what you will see.";
    const diff = parseDiff(
      diffOf("src/i18n/locales/en-US/diver.json", [`      "honest": "${sentence}",`]),
    );
    const specs = new Map([
      ["e2e/sightings.spec.ts", `await expect(page.getByText("${sentence}")).toBeVisible();`],
      ["e2e/booking.spec.ts", `await page.goto("/s/blue-mantis");`],
    ]);
    const { strong } = selectSpecs({ changed: [], diff, specs, graph: null });
    expect([...strong.keys()]).toEqual(["e2e/sightings.spec.ts"]);
  });

  it("splits an ICU message around its placeholders", () => {
    expect(
      textOf(
        "src/i18n/locales/en-US/staff/trips.json",
        `"a": "{count} divers are still waiting at the dock"`,
      ),
    ).toEqual(["divers are still waiting at the dock"]);
  });

  it("reads JSX text from a component and literals from the seed, not from any module", () => {
    expect(textOf("src/components/X.tsx", "  <p>Nothing on the boat yet today</p>")).toEqual([
      "Nothing on the boat yet today",
    ]);
    expect(textOf("src/db/seed-trips.ts", `  name: "Molasses Reef morning",`)).toEqual([
      "Molasses Reef morning",
    ]);
    expect(textOf("src/lib/format.ts", `  return "a sentence in a helper";`)).toEqual([]);
  });

  it("leaves alone text the same diff adds back, and fragments too short to mean anything", () => {
    const moved = parseDiff(
      diffOf(
        "src/i18n/locales/en-US/diver.json",
        [`"a": "Bring your certification card"`, `"b": "Save"`],
        [`"c": "Bring your certification card"`],
      ),
    );
    expect(removedText(moved)).toEqual([]);
  });
});

describe("routes", () => {
  it("maps a file to its route, skipping groups and private folders", () => {
    expect(routeOf("src/app/shop/[shopSlug]/staffing/_components/Week.tsx")).toEqual({
      route: "/shop/[shopSlug]/staffing",
      broad: false,
    });
    expect(routeOf("src/app/(marketing)/pricing/page.tsx")?.route).toBe("/pricing");
    expect(routeOf("src/app/s/[shopSlug]/layout.tsx")).toEqual({
      route: "/s/[shopSlug]",
      broad: true,
    });
  });

  it("never maps a test file: it changes no page", () => {
    expect(routeOf("src/app/edge-refusal-coverage.test.ts")).toBeNull();
    expect(routeOf("src/lib/format.ts")).toBeNull();
  });

  it("matches a route written out or templated, and a page change only at its own depth", () => {
    const page = routePattern({ route: "/shop/[shopSlug]/staffing", broad: false });
    expect(page.test(`page.goto("/shop/blue-mantis/staffing")`)).toBe(true);
    expect(page.test("page.goto(`/shop/${SHOP}/staffing?week=2`)")).toBe(true);
    expect(page.test(`page.goto("/shop/blue-mantis/staffing/requests")`)).toBe(false);
    expect(page.test(`page.goto("/shop/blue-mantis/staff")`)).toBe(false);
    const layout = routePattern({ route: "/shop/[shopSlug]/staffing", broad: true });
    expect(layout.test(`page.goto("/shop/blue-mantis/staffing/requests")`)).toBe(true);
  });

  it("ranks a hub's visitors instead of running them all", () => {
    const specs = new Map(
      Array.from({ length: HUB_SPECS + 1 }, (_, i) => [
        `e2e/s${i}.spec.ts`,
        `goto("/s/blue-mantis")`,
      ]),
    );
    specs.set("e2e/reviews.spec.ts", `goto("/s/blue-mantis/reviews")`);
    const { strong, reach } = selectSpecs({
      changed: ["src/app/s/[shopSlug]/page.tsx", "src/app/s/[shopSlug]/reviews/page.tsx"],
      diff: new Map(),
      specs,
      graph: null,
    });
    expect([...strong.keys()]).toEqual(["e2e/reviews.spec.ts"]);
    expect(reach.size).toBe(HUB_SPECS + 1);
  });
});

describe("edited specs and helpers", () => {
  it("runs a spec the diff edits and every spec importing an edited helper", () => {
    const specs = new Map([
      ["e2e/a.spec.ts", `import { test } from "./fixtures";`],
      ["e2e/b.spec.ts", `import { test } from "@playwright/test";`],
      ["e2e/c.spec.ts", ""],
    ]);
    const { strong } = selectSpecs({
      changed: ["e2e/fixtures.ts", "e2e/c.spec.ts"],
      diff: new Map(),
      specs,
      graph: null,
    });
    expect([...strong.keys()].sort()).toEqual(["e2e/a.spec.ts", "e2e/c.spec.ts"]);
  });

  it("never selects the visual spec, whose captures are the verify skill's section 3", () => {
    const specs = new Map([["e2e/visual.spec.ts", ""]]);
    const { strong } = selectSpecs({
      changed: ["e2e/visual.spec.ts"],
      diff: new Map(),
      specs,
      graph: null,
    });
    expect(strong.size).toBe(0);
  });
});

describe("reach through imports", () => {
  const graph = new Map([
    ["src/app/shop/[shopSlug]/staffing/page.tsx", new Set(["src/lib/shifts.ts"])],
    ["src/lib/shifts.ts", new Set(["src/db/seed-clock.ts"])],
    ["src/db/seed-clock.ts", new Set()],
    ["src/app/s/[shopSlug]/page.tsx", new Set()],
  ]);

  it("follows importers up to a route's entry file", () => {
    expect(importersOf(graph, ["src/db/seed-clock.ts"])).toEqual(
      new Set([
        "src/db/seed-clock.ts",
        "src/lib/shifts.ts",
        "src/app/shop/[shopSlug]/staffing/page.tsx",
      ]),
    );
    const specs = new Map([
      ["e2e/staffing.spec.ts", `goto("/shop/blue-mantis/staffing")`],
      ["e2e/booking.spec.ts", `goto("/s/blue-mantis")`],
    ]);
    const { strong, reach } = selectSpecs({
      changed: ["src/db/seed-clock.ts"],
      diff: new Map(),
      specs,
      graph,
    });
    expect(strong.size).toBe(0);
    expect([...reach.keys()]).toEqual(["e2e/staffing.spec.ts"]);
  });

  it("spends the budget on the narrowest routes first, and names the rest", () => {
    const reach = new Map([
      ["e2e/wide.spec.ts", new Set(["/"])],
      ["e2e/narrow.spec.ts", new Set(["/x"])],
    ]);
    const rank = new Map([
      ["e2e/wide.spec.ts", 40],
      ["e2e/narrow.spec.ts", 2],
    ]);
    const record = { "e2e/wide.spec.ts": 60_000, "e2e/narrow.spec.ts": 60_000 };
    expect(withinBudget(reach, rank, record, 90_000)).toEqual({
      run: ["e2e/narrow.spec.ts"],
      left: ["e2e/wide.spec.ts"],
    });
  });
});

describe("ranking the reach tier by what the diff says", () => {
  it("puts the spec that names the diff's own words first, and words every spec says count for nothing", () => {
    const diff = parseDiff(
      [
        "diff --git a/src/db/seed-staff.ts b/src/db/seed-staff.ts",
        "--- a/src/db/seed-staff.ts",
        "+++ b/src/db/seed-staff.ts",
        "@@ -1 +1 @@",
        '-  { name: "Dana Reyes", shift: "07:00" },',
        '+  { name: "Dana Reyes", shift: "06:30" },',
      ].join("\n"),
    );
    const specs = new Map([
      ["e2e/a.spec.ts", 'await page.goto("/shop"); expect(name).toBe(1)'],
      ["e2e/staffing.spec.ts", 'await page.getByText("Dana Reyes"); expect(name)'],
      ["e2e/c.spec.ts", "await page.goto(x); expect(name)"],
    ]);
    expect(symbolsOf(diff)).toContain("Dana Reyes");
    const scores = overlapScores(symbolsOf(diff), specs, [...specs.keys()]);
    expect(scores.get("e2e/staffing.spec.ts")).toBeGreaterThan(0);
    expect(scores.get("e2e/a.spec.ts")).toBe(0);
  });

  it("orders `rank` so the budget runs the overlapping spec before a narrower stranger", () => {
    const graph = new Map([
      ["src/app/shop/[shopSlug]/staffing/page.tsx", new Set(["src/lib/shifts.ts"])],
      ["src/app/shop/[shopSlug]/gear/page.tsx", new Set(["src/lib/shifts.ts"])],
      ["src/lib/shifts.ts", new Set()],
    ]);
    const specs = new Map([
      ["e2e/gear.spec.ts", 'goto("/shop/blue-mantis/gear")'],
      ["e2e/staffing.spec.ts", 'goto("/shop/blue-mantis/staffing"); getByText("openingShift")'],
      ["e2e/staffing-2.spec.ts", 'goto("/shop/blue-mantis/staffing")'],
    ]);
    const diff = parseDiff(
      [
        "diff --git a/src/lib/shifts.ts b/src/lib/shifts.ts",
        "--- a/src/lib/shifts.ts",
        "+++ b/src/lib/shifts.ts",
        "@@ -1 +1 @@",
        "-export const openingShift = 7;",
        "+export const openingShift = 6;",
      ].join("\n"),
    );
    const { reach, rank } = selectSpecs({ changed: ["src/lib/shifts.ts"], diff, specs, graph });
    expect(reach.size).toBe(3);
    expect([...rank].sort((a, b) => a[1] - b[1])[0][0]).toBe("e2e/staffing.spec.ts");
  });

  it("follows the changed lines name by name when given the module index", () => {
    const modules = moduleIndex(
      new Map([
        [
          "src/lib/shifts.ts",
          "export function opening() {\n  return 7;\n}\n\nexport function closing() {\n  return 5;\n}",
        ],
        [
          "src/app/shop/[shopSlug]/staffing/page.tsx",
          'import { opening } from "@/lib/shifts";\nexport default function P() {\n  return opening();\n}',
        ],
        [
          "src/app/shop/[shopSlug]/gear/page.tsx",
          'import { closing } from "@/lib/shifts";\nexport default function P() {\n  return closing();\n}',
        ],
      ]),
    );
    const graph = new Map([
      ["src/lib/shifts.ts", new Set()],
      ["src/app/shop/[shopSlug]/staffing/page.tsx", new Set(["src/lib/shifts.ts"])],
      ["src/app/shop/[shopSlug]/gear/page.tsx", new Set(["src/lib/shifts.ts"])],
    ]);
    const specs = new Map([
      ["e2e/gear.spec.ts", 'goto("/shop/blue-mantis/gear")'],
      ["e2e/staffing.spec.ts", 'goto("/shop/blue-mantis/staffing")'],
    ]);
    const { reach } = selectSpecs({
      changed: ["src/lib/shifts.ts"],
      diff: new Map(),
      specs,
      graph,
      modules,
      lines: new Map([["src/lib/shifts.ts", new Set([2])]]),
    });
    expect([...reach.keys()]).toEqual(["e2e/staffing.spec.ts"]);
  });
});

describe("what every push runs, and what only its tool's change runs", () => {
  it("names five smoke tests the specs still have, as file:line", () => {
    const { found, missing } = smokeTests(readSpecs());
    expect(missing).toEqual([]);
    expect(found).toHaveLength(SMOKE.length);
    for (const test of found) expect(test).toMatch(/^e2e\/[\w-]+\.spec\.ts:\d+$/);
  });

  it("runs pixel-probe only when the probe or the stylesheet changed", () => {
    const specs = new Map([["e2e/pixel-probe.spec.ts", "setContent()"]]);
    const pick = (changed) => [
      ...selectSpecs({ changed, diff: new Map(), specs, graph: null }).strong.keys(),
    ];
    expect(pick(["scripts/pixel-probe/collect.mjs"])).toEqual(["e2e/pixel-probe.spec.ts"]);
    expect(pick(["src/app/globals.css"])).toEqual(["e2e/pixel-probe.spec.ts"]);
    expect(pick(["src/lib/format.ts"])).toEqual([]);
  });
});

describe("the base a layer is measured from", () => {
  const fake = (answers) => (args) => answers[args.join(" ")] ?? null;

  it("is the nearest claude/* layer HEAD contains, not this branch's own remote", () => {
    const git = fake({
      "rev-parse HEAD": "abc",
      "rev-parse --abbrev-ref HEAD": "claude/top",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin/claude":
        "origin/claude/low\norigin/claude/mid\norigin/claude/top",
      "rev-list --count origin/main..origin/claude/low": "4",
      "rev-list --count origin/main..origin/claude/mid": "9",
      "rev-list --count origin/main..origin/claude/top": "12",
    });
    expect(stackBase(git)).toBe("origin/claude/mid");
  });

  it("falls back to origin/main off a stack", () => {
    const git = fake({
      "rev-parse HEAD": "abc",
      "rev-parse --abbrev-ref HEAD": "claude/solo",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin/claude": "",
      "rev-parse --verify --quiet origin/main": "def",
    });
    expect(stackBase(git)).toBe("origin/main");
  });
});
