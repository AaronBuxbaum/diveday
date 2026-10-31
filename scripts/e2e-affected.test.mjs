import { describe, expect, it } from "vitest";

import {
  captureGrep,
  captureMs,
  changedDiff,
  changedLocaleKeys,
  changedLocaleKeysIn,
  HUB_SPECS,
  importersOf,
  localeKeyPrefix,
  overlapScores,
  parseDiff,
  readSpecs,
  removedText,
  routeOf,
  routePattern,
  SEED_STRONG_SPECS,
  SMOKE,
  seedConstantValues,
  seedImports,
  seedTouches,
  selectCaptures,
  selectSpecs,
  smokeTests,
  stackBase,
  symbolsOf,
  textOf,
  visualBlocks,
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
  it("leaves mobile behavior to its dedicated engine lane even when edited", () => {
    const specs = new Map([["e2e/mobile-behavior.spec.ts", ""]]);
    const { strong, reach } = selectSpecs({
      changed: ["e2e/mobile-behavior.spec.ts"],
      diff: new Map(),
      specs,
      graph: null,
    });
    expect(strong.size).toBe(0);
    expect(reach.size).toBe(0);
  });
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
    const specs = new Map([
      ["e2e/gear.spec.ts", 'goto("/shop/blue-mantis/gear")'],
      ["e2e/staffing.spec.ts", 'goto("/shop/blue-mantis/staffing")'],
    ]);
    const { reach } = selectSpecs({
      changed: ["src/lib/shifts.ts"],
      diff: new Map(),
      specs,
      graph: null,
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

  it("uses the explicitly configured layer, not this branch's own remote", () => {
    const git = fake({
      "rev-parse HEAD": "abc",
      "config --get branch.claude/top.divedayBase": "origin/claude/mid",
      "rev-parse --verify --quiet origin/claude/mid": "mid",
      "rev-parse --abbrev-ref HEAD": "claude/top",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin":
        "origin/claude/low\norigin/claude/mid\norigin/claude/top",
      "rev-list --count origin/main..origin/claude/low": "4",
      "rev-list --count origin/main..origin/claude/mid": "9",
      "rev-list --count origin/main..origin/claude/top": "12",
    });
    expect(stackBase(git, { env: {} })).toBe("origin/claude/mid");
  });

  it("falls back to origin/main off a stack", () => {
    const git = fake({
      "rev-parse HEAD": "abc",
      "rev-parse --abbrev-ref HEAD": "claude/solo",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin": "",
      "rev-parse --verify --quiet origin/main": "def",
    });
    expect(stackBase(git, { env: {} })).toBe("origin/main");
  });
});

/**
 * Five visual-shard jobs between 2026-10-09 and 2026-10-12 failed on one capture ("the desk's
 * settled boat renders true to the design" waited for a "Checked in · N" heading a change had
 * moved), on every layer above it, and nothing before the push ran a capture (#2517).
 */
describe("picking captures out of the visual spec", () => {
  const source = [
    "test.describe(`${scheme} mode`, () => {",
    '  test("the desk\'s settled boat renders true to the design", async ({ page }) => {',
    '    await page.goto("/shop/blue-mantis/trips/abc");',
    '    await expect(page.getByRole("heading", { name: "Checked in · 3" })).toBeVisible();',
    "  });",
    "  test(`the landing page renders true to the design (${scheme})`, async ({ page }) => {",
    '    await page.goto("/");',
    "  });",
    '  test("the dive sites index renders", async ({ page }) => {',
    '    await page.goto("/s/blue-mantis/dive-sites");',
    "  });",
    "});",
  ].join("\n");

  it("splits the spec into its tests by title, each with its own body", () => {
    const blocks = visualBlocks(source);
    expect(blocks.map((block) => block.title)).toEqual([
      "the desk's settled boat renders true to the design",
      "the landing page renders true to the design (${scheme})",
      "the dive sites index renders",
    ]);
    expect(blocks[0].body).toContain("Checked in · 3");
    expect(blocks[0].body).not.toContain("landing");
  });

  it("names the capture that waits for a heading the diff removed", () => {
    const diff = parseDiff(
      diffOf("src/i18n/locales/en-US/staff/trip.json", ['  "checkedIn": "Checked in · 3"']),
    );
    const picked = selectCaptures({
      changed: ["src/i18n/locales/en-US/staff/trip.json"],
      diff,
      source,
    });
    expect([...picked.keys()]).toEqual(["the desk's settled boat renders true to the design"]);
  });

  it("names the captures of a route whose own directory the diff edits, and no other", () => {
    const picked = selectCaptures({
      changed: ["src/app/s/[shopSlug]/dive-sites/page.tsx"],
      diff: new Map(),
      source,
    });
    expect([...picked.keys()]).toEqual(["the dive sites index renders"]);
  });

  it("names nothing for a diff no capture reads", () => {
    expect(selectCaptures({ changed: ["src/lib/clock.ts"], diff: new Map(), source }).size).toBe(0);
    expect(selectCaptures({ changed: [], diff: new Map(), source: "" }).size).toBe(0);
  });

  it("builds a -g that runs the titles in light mode and never under a dark describe", () => {
    expect(captureGrep([])).toBeNull();
    const grep = new RegExp(
      captureGrep(["the landing page renders true to the design (${scheme})", "a.b"]) ?? "",
    );
    expect(
      grep.test(
        "visual.spec.ts light mode public the landing page renders true to the design (light)",
      ),
    ).toBe(true);
    expect(
      grep.test(
        "visual.spec.ts dark mode public the landing page renders true to the design (dark)",
      ),
    ).toBe(false);
    expect(grep.test("visual.spec.ts light mode public a.b")).toBe(true);
    expect(grep.test("visual.spec.ts light mode public axb")).toBe(false);
  });

  it("counts the recorded time of the light run only", () => {
    expect(captureMs(["the landing page renders true to the design (${scheme})"])).toBeGreaterThan(
      0,
    );
    expect(captureMs(["a title no record has met"])).toBe(0);
  });
});

describe("cheap diff discovery", () => {
  it("needs no source tree or browser specs", () => {
    const answers = {
      "merge-base origin/main HEAD": "base",
      "diff --name-only base HEAD": "scripts/tool.test.mjs",
    };
    expect(
      changedDiff({
        root: "/missing/tree",
        base: "origin/main",
        git: (args) => answers[args.join(" ")] ?? null,
      }),
    ).toMatchObject({ changed: ["scripts/tool.test.mjs"] });
  });
  it("excludes aliases at HEAD and includes provider-neutral contained layers", () => {
    const answers = {
      "rev-parse HEAD": "top",
      "config --get branch.codex/top.divedayBase": "origin/codex/base",
      "rev-parse --verify --quiet origin/codex/base": "middle",
      "rev-parse --abbrev-ref HEAD": "codex/top",
      "for-each-ref --format=%(refname:short) --merged HEAD refs/remotes/origin":
        "origin/main\norigin/HEAD\norigin/codex/top\norigin/snapshot\norigin/codex/base\norigin/feature/old",
      "rev-parse origin/snapshot": "top",
      "rev-parse origin/codex/base": "middle",
      "rev-parse origin/feature/old": "old",
      "rev-list --count origin/main..origin/codex/base": "8",
      "rev-list --count origin/main..origin/feature/old": "3",
    };
    expect(stackBase((args) => answers[args.join(" ")] ?? null, { env: {} })).toBe(
      "origin/codex/base",
    );
  });
});

it("includes untracked working files and refuses an unreadable diff", () => {
  const answers = {
    "merge-base origin/main HEAD": "base",
    "diff --name-only base": "src/a.ts",
    "ls-files --others --exclude-standard": "src/new.test.ts",
  };
  const result = changedDiff({
    base: "origin/main",
    workingTree: true,
    git: (args) => answers[args.join(" ")] ?? null,
  });
  expect(result.changed).toEqual(["src/a.ts", "src/new.test.ts"]);
  expect(
    changedDiff({ base: "origin/main", git: (args) => (args[0] === "merge-base" ? "base" : null) }),
  ).toBeNull();
});

it("selects edited captures in an extracted visual domain", () => {
  const line = 'await page.goto("/shop/demo/sites");';
  const captures = selectCaptures({
    changed: ["e2e/visual-sites.spec.ts"],
    diff: new Map([["e2e/visual-sites.spec.ts", { added: [line], removed: [] }]]),
    source: `test("site renders true to the design", async () => {${line}});`,
    file: "e2e/visual-sites.spec.ts",
  });
  expect([...captures.keys()]).toEqual(["site renders true to the design"]);
});

/**
 * The backtest of 2026-10-22: of 101 browser failures new in a push, the selector named 22. Two
 * kinds of miss it can see from the diff alone: a spec reading copy through its key, whose value
 * the diff changed (no removed literal matches a key), and a seed edit that moved a record a
 * spec counts or names.
 */
describe("a locale value a spec reads by its key", () => {
  const before = JSON.stringify({
    blockerRow: { waiverLapsed: "Waiver lapsed", waiverLapsedSoon: "Waiver lapses soon" },
    gone: "Old words",
    same: "Unchanged",
  });
  const after = JSON.stringify({
    blockerRow: { waiverLapsed: "Waiver expired", waiverLapsedSoon: "Waiver lapses soon" },
    same: "Unchanged",
    added: "Brand new",
  });

  it("names each changed or removed leaf by its full dotted key, never an added one", () => {
    expect(changedLocaleKeys(before, after, "today.")).toEqual([
      "today.blockerRow.waiverLapsed",
      "today.gone",
    ]);
    expect(changedLocaleKeys(null, after)).toEqual([]);
    expect(changedLocaleKeys("{not json", after)).toEqual([]);
  });

  it("prefixes a staff bundle's keys with its namespace and a diver key with nothing", () => {
    expect(localeKeyPrefix("src/i18n/locales/en-US/staff/today.json")).toBe("today.");
    expect(localeKeyPrefix("src/i18n/locales/en-US/diver.json")).toBe("");
    expect(localeKeyPrefix("src/i18n/locales/es-ES/diver.json")).toBeNull();
    expect(localeKeyPrefix("src/i18n/locales/en-US/staff/index.ts")).toBeNull();
  });

  it("reads both blobs of each changed bundle from git", () => {
    const blobs = {
      "show a:src/i18n/locales/en-US/staff/today.json": before,
      "show b:src/i18n/locales/en-US/staff/today.json": after,
    };
    const keys = changedLocaleKeysIn(
      (args) => blobs[args.join(" ")] ?? null,
      ["src/i18n/locales/en-US/staff/today.json", "src/lib/clock.ts"],
      "a",
      "b",
    );
    expect(keys).toEqual(["today.blockerRow.waiverLapsed", "today.gone"]);
  });

  it("selects the spec and the capture that read the key, and not a sibling key's", () => {
    const specs = new Map([
      [
        "e2e/today.spec.ts",
        'await expect(row.getByText(staffCopy("today.blockerRow.waiverLapsed"))).toBeVisible();',
      ],
      [
        "e2e/reminders.spec.ts",
        'expect(body).toContain(diverTranslator("en-US")("notifications.tripReminder.flySafe"));',
      ],
      [
        "e2e/soon.spec.ts",
        'await expect(page.getByText(staff("today.blockerRow.waiverLapsedSoon"))).toBeVisible();',
      ],
    ]);
    const localeKeys = ["today.blockerRow.waiverLapsed", "notifications.tripReminder.flySafe"];
    const { strong } = selectSpecs({
      changed: [],
      diff: new Map(),
      specs,
      graph: null,
      localeKeys,
    });
    expect([...strong.keys()].sort()).toEqual(["e2e/reminders.spec.ts", "e2e/today.spec.ts"]);
    expect([...strong.get("e2e/today.spec.ts")]).toEqual(["reads today.blockerRow.waiverLapsed"]);

    const source = [
      '  test("the desk\'s blockers render true to the design", async ({ page }) => {',
      '    await page.getByText(staffCopy("today.blockerRow.waiverLapsed")).waitFor();',
      "  });",
      '  test("the soon row renders", async ({ page }) => {',
      '    await page.getByText(staffCopy("today.blockerRow.waiverLapsedSoon")).waitFor();',
      "  });",
    ].join("\n");
    const picked = selectCaptures({ changed: [], diff: new Map(), source, localeKeys });
    expect([...picked.keys()]).toEqual(["the desk's blockers render true to the design"]);
  });

  it("only ranks the readers of a key most of the suite reads", () => {
    const specs = new Map(
      Array.from({ length: HUB_SPECS + 1 }, (_, i) => [
        `e2e/s${i}.spec.ts`,
        'await page.getByRole("button", { name: staff("shared.actions.save") }).click();',
      ]),
    );
    const { strong, reach } = selectSpecs({
      changed: [],
      diff: new Map(),
      specs,
      graph: null,
      localeKeys: ["shared.actions.save"],
    });
    expect(strong.size).toBe(0);
    expect(reach.size).toBe(HUB_SPECS + 1);
  });
});

describe("a seed edit that moves what a spec names or counts", () => {
  it("reads a removed seeded name too short for prose but two capitalised words", () => {
    expect(
      textOf("src/db/seed-cast.ts", 'export const LEAD_INSTRUCTOR_NAME = "Marcus Webb";'),
    ).toEqual(["Marcus Webb"]);
    expect(textOf("src/db/seed-cast.ts", '  status: "on hold",')).toEqual([]);
    expect(textOf("src/content/guides.ts", '  name: "Marcus Webb",')).toEqual([]);
    const diff = parseDiff(
      diffOf(
        "src/db/seed-cast.ts",
        ['export const LEAD_INSTRUCTOR_NAME = "Marcus Webb";'],
        ['export const LEAD_INSTRUCTOR_NAME = "Marcus Webber";'],
      ),
    );
    const specs = new Map([
      ["e2e/staffing.spec.ts", 'await expect(page.getByText("Marcus Webb")).toBeVisible();'],
      ["e2e/booking.spec.ts", 'await page.goto("/s/blue-mantis");'],
    ]);
    const { strong } = selectSpecs({ changed: [], diff, specs, graph: null });
    expect([...strong.keys()]).toEqual(["e2e/staffing.spec.ts"]);
  });

  it("selects the specs naming a record a changed seed line touches, by literal or by constant", () => {
    const diff = parseDiff(
      diffOf(
        "src/db/seed-booth.ts",
        [],
        [
          '  await addSeat(db, { hull: "Mantis II", diver: divers[3] });',
          "  await addSeat(db, { trip: SHOP_CERTIFIED_TITLE, diver: divers[4] });",
        ],
      ),
    );
    const seedValues = seedConstantValues(
      new Map([
        [
          "src/db/seed-booth.ts",
          'export const SHOP_CERTIFIED_TITLE = "Rescue Diver — weekend course";',
        ],
      ]),
    );
    expect([...seedTouches(diff, seedValues).names]).toEqual([
      "Mantis II",
      "Rescue Diver — weekend course",
    ]);
    const specs = new Map([
      [
        "e2e/boat-safety.spec.ts",
        'await expect(page.getByText("Mantis II · 6 aboard")).toBeVisible();',
      ],
      [
        "e2e/courses.spec.ts",
        'await page.getByRole("link", { name: "Rescue Diver — weekend course" }).click();',
      ],
      ["e2e/booking.spec.ts", 'await page.goto("/s/blue-mantis");'],
    ]);
    const { strong } = selectSpecs({ changed: [], diff, specs, graph: null, seedValues });
    expect([...strong.keys()].sort()).toEqual(["e2e/boat-safety.spec.ts", "e2e/courses.spec.ts"]);
  });

  it("selects a spec importing a seed constant a changed line uses, and ignores import lines", () => {
    const source =
      'import { LOST_MASK, type Seeded as S } from "../src/db/seed-booth";\nawait expect(row.filter({ hasText: LOST_MASK })).toBeVisible();';
    expect([...seedImports(source)]).toEqual(["LOST_MASK", "Seeded"]);
    const specs = new Map([["e2e/departure-desk.spec.ts", source]]);
    const used = parseDiff(
      diffOf("src/db/seed-booth.ts", [], ["  await seedLostMask(db, LOST_MASK, tomorrow);"]),
    );
    expect([...selectSpecs({ changed: [], diff: used, specs, graph: null }).strong.keys()]).toEqual(
      ["e2e/departure-desk.spec.ts"],
    );
    const imported = parseDiff(
      diffOf("src/db/seed-trips.ts", [], ['import { LOST_MASK } from "./seed-booth";']),
    );
    expect(selectSpecs({ changed: [], diff: imported, specs, graph: null }).strong.size).toBe(0);
  });

  it("only ranks the specs of a record most of the suite passes through, and skips seed tests", () => {
    const specs = new Map(
      Array.from({ length: SEED_STRONG_SPECS + 1 }, (_, i) => [
        `e2e/s${i}.spec.ts`,
        'await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");',
      ]),
    );
    const line = '  trip: "Two-Tank Reef — Molasses & French", seats: 8,';
    const shared = parseDiff(diffOf("src/db/seed-trips.ts", [], [line]));
    const { strong, reach } = selectSpecs({ changed: [], diff: shared, specs, graph: null });
    expect(strong.size).toBe(0);
    expect(reach.size).toBe(SEED_STRONG_SPECS + 1);
    const tested = parseDiff(diffOf("src/db/seed-trips.test.ts", [line]));
    expect(seedTouches(tested).names.size).toBe(0);
  });

  it("names the capture a changed seed line touches, when few captures name it", () => {
    const source = [
      '  test("the lost-and-found renders true to the design", async ({ page }) => {',
      '    await page.getByText("Mantis II").waitFor();',
      "  });",
      '  test("the landing page renders", async ({ page }) => {',
      '    await page.goto("/");',
      "  });",
    ].join("\n");
    const diff = parseDiff(diffOf("src/db/seed-booth.ts", [], ['  hull: "Mantis II",']));
    const picked = selectCaptures({ changed: [], diff, source });
    expect([...picked.keys()]).toEqual(["the lost-and-found renders true to the design"]);
  });
});
