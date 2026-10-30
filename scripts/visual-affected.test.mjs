import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { moduleIndex } from "./symbol-reach.mjs";
import {
  captureSpans,
  changedLines,
  changedMessageKeys,
  changedRoutes,
  covers,
  expectedCaptureTestIds,
  FULL_SHARDS,
  filterReport,
  helperBodies,
  lightGrep,
  lightOnly,
  literalPaths,
  messageConsumers,
  packageJsonReach,
  SMOKE,
  selectCaptures,
  shardCount,
  THEME,
} from "./visual-affected.mjs";
import { visualSpecs } from "./visual-specs.mjs";

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
        "drizzle/20261014024814_date-request-handled/migration.sql",
        "drizzle/meta/_journal.json",
        "src/db/__snapshots__/export-bundle.shop.snap",
        ".gitignore",
        ".env.example",
        "pnpm-lock.yaml",
        "vercel.json",
        "e2e/fixtures/booking-party.spec.ts",
        "src/lib/orphan.ts",
        ".coderabbit.yaml",
        ".agents/skills/tdd/SKILL.md",
        ".gitattributes",
      ]),
    ).toHaveLength(2);
    // Imported by next.config.ts and src/, so never inert.
    expect(picked(["config/env-registry.mjs"]).mode).toBe("all");
  });
});

/** A small tree read by name: a page, a layout, a label module, the proxy and the seed. */
const tree = new Map([
  [
    "src/app/shop/[shopSlug]/gear/page.tsx",
    [
      'import { gearTitle } from "@/lib/gear";',
      'import { t } from "@/i18n";',
      "export default function Page() {",
      '  return <h1>{gearTitle()} {t("gear.register.heading")}</h1>;',
      "}",
    ].join("\n"),
  ],
  [
    "src/app/shop/[shopSlug]/layout.tsx",
    [
      'import { chromeLabel } from "@/lib/gear";',
      "export default function Layout() {",
      "  return chromeLabel();",
      "}",
    ].join("\n"),
  ],
  [
    "src/app/s/[shopSlug]/courses/[slug]/page.tsx",
    [
      'import { courseTitle } from "@/lib/courses";',
      "export default function Page() {",
      "  return courseTitle();",
      "}",
    ].join("\n"),
  ],
  [
    "src/lib/gear.ts",
    [
      'import { slugify } from "./text";', // 1
      "", // 2
      "export function gearTitle() {", // 3
      '  return slugify("gear");', // 4
      "}", // 5
      "", // 6
      "export function chromeLabel() {", // 7
      '  return "chrome";', // 8
      "}", // 9
    ].join("\n"),
  ],
  ["src/lib/courses.ts", 'export function courseTitle() {\n  return "course";\n}'],
  ["src/lib/text.ts", "export function slugify(s) {\n  return s;\n}"],
  ["src/lib/orphan.ts", "export const unused = 1;"],
  ["src/i18n/index.ts", "export function t(key) {\n  return key;\n}"],
  ["src/proxy.ts", 'import { courseTitle } from "@/lib/courses";\nexport const x = courseTitle;'],
  [
    "src/db/seed.ts",
    [
      'import { slugify } from "@/lib/text";',
      'import { seedRentals } from "./seed-rentals";',
      "export const seed = slugify;",
      "export async function seedDemo(db) {",
      "  await seedRentals(db);",
      "}",
    ].join("\n"),
  ],
  // The data: a schema module behind its barrel, a reader two pages call, a scenario that
  // writes one table and reads another, and the demo action every public page would import.
  [
    "src/db/schema/rentals.ts",
    [
      'import { pgTable } from "drizzle-orm/pg-core";', // 1
      "", // 2
      'export const rentals = pgTable("rentals", {});', // 3
      "", // 4
      'export const sizes = pgTable("sizes", {});', // 5
    ].join("\n"),
  ],
  ["src/db/schema/index.ts", 'export * from "./rentals";'],
  [
    "src/db/rentals.ts",
    'import { rentals } from "./schema";\nexport function listRentals(db) {\n  return db.select().from(rentals);\n}',
  ],
  [
    "src/db/seed-rentals.ts",
    [
      'import { rentals, sizes } from "./schema";', // 1
      "export async function seedRentals(db) {", // 2
      "  await db.insert(rentals).values({});", // 3
      "  return db.select().from(sizes);", // 4
      "}", // 5
    ].join("\n"),
  ],
  [
    "src/app/shop/[shopSlug]/rentals/page.tsx",
    'import { listRentals } from "@/db/rentals";\nexport default function Page() {\n  return listRentals();\n}',
  ],
  [
    "src/app/s/[shopSlug]/rentals/page.tsx",
    'import { listRentals } from "@/db/rentals";\nexport default function Page() {\n  return listRentals();\n}',
  ],
  [
    "src/app/actions/demo.ts",
    'import { seedDemo } from "@/db/seed";\nexport async function mintDemo() {\n  return seedDemo();\n}',
  ],
  [
    "src/app/page.tsx",
    'import { mintDemo } from "./actions/demo";\nexport default function Page() {\n  return mintDemo;\n}',
  ],
]);

const bySymbol = (changed, context = {}) => {
  const modules = moduleIndex(tree);
  const graph = new Map([...tree.keys()].map((file) => [file, new Set()]));
  return changedRoutes(changed, graph, { modules, sources: tree, ...context });
};

describe("following an edit name by name", () => {
  it("reaches only the pages that read the function whose lines changed", () => {
    const lines = new Map([["src/lib/gear.ts", new Set([8])]]);
    expect(bySymbol(["src/lib/gear.ts"], { lines }).routes).toEqual([
      { route: "/shop/[shopSlug]", broad: true },
    ]);
    const other = new Map([["src/lib/gear.ts", new Set([4])]]);
    expect(bySymbol(["src/lib/gear.ts"], { lines: other }).routes).toEqual([
      { route: "/shop/[shopSlug]/gear", broad: false },
    ]);
  });

  it("moves nothing for a comment, or for a module no page reads", () => {
    const lines = new Map([["src/lib/gear.ts", new Set([2])]]);
    expect(bySymbol(["src/lib/gear.ts"], { lines }).routes).toEqual([]);
    expect(bySymbol(["src/lib/orphan.ts"]).routes).toEqual([]);
  });

  it("captures everything when an edit reaches the proxy or the seed", () => {
    expect(bySymbol(["src/lib/courses.ts"]).all).toMatch(/src\/proxy\.ts/);
    const lines = new Map([["src/lib/text.ts", new Set([2])]]);
    expect(bySymbol(["src/lib/text.ts"], { lines }).all).toMatch(/src\/db\/seed\.ts/);
  });

  it("follows a schema edit to the pages that read the table, never through the seed", () => {
    const rentalPages = [
      { route: "/shop/[shopSlug]/rentals", broad: false },
      { route: "/s/[shopSlug]/rentals", broad: false },
    ];
    const table = new Map([["src/db/schema/rentals.ts", new Set([3])]]);
    expect(bySymbol(["src/db/schema/rentals.ts"], { lines: table }).routes).toEqual(rentalPages);
    // `sizes` is read by the scenario only, and nothing reaches a page through a seed module.
    const unread = new Map([["src/db/schema/rentals.ts", new Set([5])]]);
    expect(bySymbol(["src/db/schema/rentals.ts"], { lines: unread }).routes).toEqual([]);
  });

  it("follows a seed scenario's edit to the readers of the tables it writes", () => {
    const write = new Map([["src/db/seed-rentals.ts", new Set([3])]]);
    expect(bySymbol(["src/db/seed-rentals.ts"], { lines: write }).routes).toEqual([
      { route: "/shop/[shopSlug]/rentals", broad: false },
      { route: "/s/[shopSlug]/rentals", broad: false },
    ]);
    // The landing page imports the demo action that runs the seed: not a reader of rentals.
    expect(
      bySymbol(["src/db/seed-rentals.ts"], { lines: write }).routes.map((r) => r.route),
    ).not.toContain("/");
  });

  it("captures everything for the orchestrator, the catalog, or a module the graph lacks", () => {
    const lines = new Map([["src/db/seed.ts", new Set([5])]]);
    expect(bySymbol(["src/db/seed.ts"], { lines }).all).toMatch(/data every capture shows/);
    expect(bySymbol(["src/db/seed-catalog.ts"]).all).toMatch(/data every capture shows/);
    expect(bySymbol(["src/db/seed-unknown.ts"]).all).toMatch(/import graph does not hold/);
    expect(bySymbol(["src/db/schema/unknown.ts"]).all).toMatch(/import graph does not hold/);
  });

  it("maps a reworded message to the module that names it, and drops a removed one", () => {
    const bundle = (value, extra = {}) =>
      JSON.stringify({ register: { heading: value, ...extra } });
    const file = "src/i18n/locales/en-US/staff/gear.json";
    const reworded = bySymbol([file], {
      before: () => bundle("Gear"),
      after: () => bundle("Your gear"),
    });
    expect(reworded.routes).toEqual([{ route: "/shop/[shopSlug]/gear", broad: false }]);
    const removed = bySymbol([file], {
      before: () => bundle("Gear", { old: "Gone" }),
      after: () => bundle("Gear"),
    });
    expect(removed.routes).toEqual([]);
  });

  it("maps a public asset to the module that names its path, or its folder", () => {
    const sources = new Map([
      ...tree,
      ["src/lib/photos.ts", "export const photo = (slug) => `/marine-life/${slug}.jpg`;"],
      ["src/app/globals.css", ".hero { background: url(/hero/reef.jpg); }"],
    ]);
    expect(bySymbol(["public/marine-life/turtle.jpg"], { sources }).routes).toEqual([]);
    expect(bySymbol(["public/hero/reef.jpg"], { sources }).all).toMatch(/globals\.css/);
  });

  it("reads package.json for what renders", () => {
    const pkg = (fields) => JSON.stringify({ name: "diveday", ...fields });
    expect(
      packageJsonReach(
        pkg({ scripts: { lint: "biome" }, devDependencies: { vitest: "1" } }),
        pkg({ scripts: { lint: "biome check" }, devDependencies: { vitest: "2" } }),
      ),
    ).toBeNull();
    expect(
      packageJsonReach(
        pkg({ devDependencies: { next: "16.0.0" } }),
        pkg({ devDependencies: { next: "16.1.0" } }),
      ),
    ).toMatch(/next/);
    expect(
      packageJsonReach(pkg({ dependencies: { a: "1" } }), pkg({ dependencies: { a: "2" } })),
    ).toMatch(/dependencies/);
    expect(
      packageJsonReach(
        pkg({ scripts: { "e2e:build": "a" } }),
        pkg({ scripts: { "e2e:build": "b" } }),
      ),
    ).toMatch(/e2e:build/);
  });

  it("names a key's readers whether written out, templated or scoped", () => {
    const sources = new Map([
      ["a.ts", 't("shopHome.spine.quietSentence")'],
      ["b.ts", "t(`spine.${kind}`)"],
      ["c.ts", 'useTranslations("shopHome.spine"); t("quietSentence")'],
      ["d.ts", 't("quietSentence")'],
    ]);
    expect([...messageConsumers("shopHome.spine.quietSentence", sources).keys()]).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(
      changedMessageKeys(
        "src/i18n/locales/en-US/staff/shopHome.json",
        '{"a":{"b":"x","c":"y"}}',
        '{"a":{"b":"z"}}',
      ),
    ).toEqual([
      { key: "shopHome.a.b", removed: false },
      { key: "shopHome.a.c", removed: true },
    ]);
  });
});

describe("edits to the visual spec and its helpers", () => {
  const visual = (lines, extra = {}) => {
    const result = selectCaptures({
      changed: ["e2e/visual.spec.ts"],
      graph,
      report,
      source,
      helpers,
      visualLines: new Set(lines),
      ...extra,
    });
    return result.mode === "all"
      ? result
      : [...result.lines].map((line) => line.split(" › ").at(-1));
  };

  it("recaptures a capture whose own lines changed", () => {
    expect(visual([16])).toContain("the public course page renders true to the design (light)");
    expect(visual([16])).not.toContain("the gear register renders true to the design (light)");
  });

  it("recaptures what reads an edited constant, and everything for a line outside them all", () => {
    expect(visual([1])).toContain("the gear register renders true to the design (light)");
    expect(visual([1])).not.toContain("the public course page renders true to the design (light)");
    expect(
      selectCaptures({
        changed: ["e2e/visual.spec.ts"],
        graph,
        report: { suites: [] },
        source: 'import { x } from "./y";\ntest.use({ colorScheme: "dark" });',
        helpers,
        visualLines: new Set([2]),
      }).mode,
    ).toBe("all");
  });

  it("recaptures what calls an edited helper in e2e/helpers.ts", () => {
    const helpersSource = [
      'import { expect } from "@playwright/test";', // 1
      "", // 2
      "async function openSailedTrip(page: Page) {", // 3
      '  await page.goto("/shop/blue-mantis/schedule/board");', // 4
      "}", // 5
    ].join("\n");
    const picked = (lines) => {
      const result = selectCaptures({
        changed: ["e2e/helpers.ts"],
        graph,
        report,
        source,
        helpers,
        helperLines: new Set(lines),
        helpersSource,
      });
      return result.mode === "all"
        ? result
        : [...result.lines].map((line) => line.split(" › ").at(-1));
    };
    expect(picked([4])).toContain("a trip's crew renders true to the design (light)");
    expect(picked([4])).not.toContain("the gear register renders true to the design (light)");
    expect(picked([1]).mode).toBe("all");
  });

  it("captures everything when the edited lines were not read, or another file is unbounded", () => {
    expect(picked(["e2e/visual.spec.ts"]).mode).toBe("all");
    expect(picked(["e2e/helpers.ts"]).mode).toBe("all");
    expect(visual([16], { changed: ["e2e/visual.spec.ts", "src/app/globals.css"] }).mode).toBe(
      "all",
    );
  });

  it("reads a diff's changed lines, a deletion marking both neighbours", () => {
    expect([...changedLines("@@ -3,0 +4,2 @@\n@@ -9 +11,0 @@")]).toEqual([4, 5, 11, 12]);
  });

  it("captures light mode only on a pull request, unless it touches a colour token or theme", () => {
    const lines = [
      "visual.spec.ts › light mode › the day spine renders true to the design (light)",
      "visual.spec.ts › dark mode › the day spine renders true to the design (dark)",
      "visual-shop-states.spec.ts › dark mode — the unanswered emergency reference › a note (dark)",
      "visual-audit-x.ts › light mode — sign-in outcomes › email verification renders",
    ];
    expect(lightOnly(lines, ["src/lib/gear.ts"]).lines).toEqual([lines[0], lines[3]]);
    for (const theme of [
      "src/app/globals.css",
      "src/lib/brand.ts",
      "src/components/BrandStyle.tsx",
      "src/app/_brand/colors.ts",
      "postcss.config.mjs",
    ]) {
      expect(THEME.test(theme), theme).toBe(true);
      expect(lightOnly(lines, ["src/lib/gear.ts", theme]).dark).toMatch(theme);
    }
    expect(lightOnly(lines, null).dark).toMatch(/could not be read/);
  });

  it("gives a local run the light-mode captures only, as a --grep", () => {
    expect(
      lightGrep([
        "visual.spec.ts › light mode › the day (light)",
        "visual.spec.ts › dark mode › the day (dark)",
      ]),
    ).toBe(String.raw`(?:the day \(light\))$`);
    expect(lightGrep([])).toBeNull();
  });

  it("includes supplemental light-mode groups in the local selection", () => {
    const grep = lightGrep([
      "visual.spec.ts › light mode — private states › verified account",
      "visual.spec.ts › dark mode — private states › dark account",
      "visual.spec.ts › print › paper pass",
    ]);
    expect(grep).toBe("(?:verified account)$");
  });

  it("reads supplemental test locations from their own source when tracing route changes", () => {
    const registered = {
      suites: [
        {
          title: "visual.spec.ts",
          file: "visual.spec.ts",
          specs: [],
          suites: [
            {
              title: "light mode — supplemental",
              specs: [
                { title: "private gear", file: "visual-audit-staff.ts", line: 2 },
                { title: "private course", file: "visual-audit-staff.ts", line: 5 },
              ],
            },
          ],
        },
      ],
    };
    const module = [
      "export function register(capture) {",
      '  test("private gear", async ({ page }) => {',
      '    await page.goto("/shop/blue-mantis/gear");',
      "  });",
      '  test("private course", async ({ page }) => {',
      '    await page.goto("/s/blue-mantis/courses/open-water");',
      "  });",
      "}",
    ].join("\n");
    const result = selectCaptures({
      changed: ["src/app/shop/[shopSlug]/gear/page.tsx"],
      graph,
      report: registered,
      source: 'import { register } from "./visual-audit-staff";',
      visualSources: new Map([["visual-audit-staff.ts", module]]),
      helpers: new Map(),
    });
    expect(result.mode).toBe("affected");
    expect([...result.lines]).toEqual([
      "visual-audit-staff.ts › light mode — supplemental › private gear",
    ]);
    expect(filterReport(registered, result.lines).suites[0].suites[0].specs).toEqual([
      { title: "private gear", file: "visual-audit-staff.ts", line: 2 },
    ]);
  });
});

describe("the 28 pull requests the test review replayed", () => {
  // Path by path, the reasons left to capture everything are the ones that can move any pixel:
  // the capture's plumbing, its harness, the seed and the schema, the workspace config. Before
  // this, 26 of the 28 captured everything over a migration, an image, a locale bundle, a
  // functional spec, `.gitignore` or a snapshot.
  const recorded = JSON.parse(
    readFileSync(new URL("./visual-affected.fixtures.json", import.meta.url), "utf8"),
  );
  const prs = Object.entries(recorded).filter(([pr]) => !pr.startsWith("_"));

  /** A bundle holding `keys` (dotted, after the namespace), each set to `value`. */
  const bundleOf = (keys, value) => {
    const root = {};
    for (const key of keys) {
      const parts = key.split(".");
      let at = root;
      for (const part of parts.slice(0, -1)) at = at[part] ??= {};
      at[parts.at(-1)] = value;
    }
    return JSON.stringify(root);
  };

  const reasons = new Map();
  for (const [pr, { files, keys = {}, packageJson }] of prs) {
    const before = (file) => {
      if (file === "package.json") return JSON.stringify({ name: "x" });
      return bundleOf(
        (keys[file] ?? []).map((key) => key.replace(/^-/, "")),
        "before",
      );
    };
    const after = (file) => {
      if (file === "package.json") {
        return JSON.stringify(
          packageJson ? { name: "x", dependencies: { next: "1" } } : { name: "x" },
        );
      }
      return bundleOf(
        (keys[file] ?? []).filter((key) => !key.startsWith("-")),
        "after",
      );
    };
    const result = changedRoutes(files, new Map(), {
      before,
      after,
      sources: new Map(),
      modules: moduleIndex(new Map()),
    });
    reasons.set(pr, result.all ?? null);
  }

  it("bounds every one whose only unbounded paths were inert", () => {
    for (const [pr, why] of reasons) {
      if (why === null) continue;
      expect(why, `#${pr}`).toMatch(
        /capture's own plumbing|capture harness|data every capture shows|import graph does not hold|pnpm-workspace\.yaml/,
      );
    }
    expect([...reasons.values()].filter((why) => why === null).length).toBe(18);
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

  it("lists planned screenshot test IDs and excludes deliberate no-image checks", () => {
    const planned = {
      suites: [
        {
          file: "e2e/visual-staff-today.spec.ts",
          specs: [
            { id: "capture-id", title: "the day spine renders true to the design" },
            {
              id: "touch-check-id",
              title: "grouped departure links have a usable touch target and keyboard focus",
            },
          ],
          suites: [
            {
              file: "e2e/visual-capture-harness.spec.ts",
              specs: [{ id: "harness-id", title: "a pass that never settles is bounded" }],
              suites: [],
            },
            {
              file: "e2e/visual-consistency.spec.ts",
              specs: [{ id: "geometry-id", title: "the email correction is a touch target" }],
              suites: [],
            },
            {
              file: "e2e/visual-print-departure-paper.spec.ts",
              specs: [
                { id: "pdf-id", title: "standalone manifest and log repeat visible context" },
              ],
              suites: [],
            },
            {
              file: "e2e/visual-print-filter-context.spec.ts",
              specs: [
                {
                  id: "print-filter-id",
                  title: "printed roster states its visible subset rather than a web page number",
                },
              ],
              suites: [],
            },
            {
              file: "e2e/visual-print.spec.ts",
              specs: [
                {
                  id: "print-id",
                  title: "every sheet of an expanded crew rota renders context and warning ink",
                },
              ],
              suites: [],
            },
          ],
        },
      ],
    };
    expect(expectedCaptureTestIds(planned)).toEqual(["capture-id"]);
    expect(() =>
      expectedCaptureTestIds({
        suites: [{ file: "e2e/visual-staff.spec.ts", specs: [{ title: "missing id" }] }],
      }),
    ).toThrow(/no stable Playwright test ID/u);
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

  it("names a smoke set the visual specs still have, so a rename cannot empty it silently", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const spec = visualSpecs(root)
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    for (const pattern of SMOKE) {
      const title = pattern.source.replace(/^› /, "").replace(/\\\($/, "(").replace(/\\/g, "");
      expect(spec, title).toContain(title);
    }
  });
});
