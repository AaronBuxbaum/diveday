import { describe, expect, it } from "vitest";

import {
  bodySection,
  buildRiskCard,
  excerpt,
  listFiles,
  MARKER,
  ourComment,
  packageChanges,
  parseNumstat,
  removingStatements,
  shopScopingLosses,
  siblingTests,
} from "./risk-card.mjs";

const change = (path, status = "M", added = 10, removed = 2) => ({ path, status, added, removed });

const drills = (overrides = {}) => ({
  schema: 1,
  mode: "diff",
  policy: { money: "block", safety: "block" },
  notRun: null,
  capped: false,
  eligible: 4,
  tried: 4,
  totals: { killed: 4, survived: 0, uncompilable: 0, accepted: 0, notTried: 0 },
  files: [],
  ...overrides,
});

const referee = (overrides = {}) => ({ needsEyes: [], watch: [], protects: [], ...overrides });

describe("risk card reading", () => {
  it("reads numstat, counting a binary file as zero lines", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\n-\t-\tpublic/x.png\n")).toEqual([
      { path: "src/a.ts", added: 3, removed: 1 },
      { path: "public/x.png", added: 0, removed: 0 },
    ]);
  });

  it("flags a file that mentions the shop in fewer places than before", () => {
    const patch = [
      "+++ b/src/db/refunds.ts",
      "-  .where(and(eq(refunds.shopId, shopId), eq(refunds.id, id)))",
      "+  .where(eq(refunds.id, id))",
      "+++ b/src/db/trips.ts",
      "-  .where(eq(trips.shopId, shopId))",
      "+  .where(eq(trips.shop_id, shopId))",
      "+++ b/src/db/refunds.test.ts",
      "-  expect(shopId).toBe(1)",
    ].join("\n");
    expect(shopScopingLosses(patch)).toEqual([{ file: "src/db/refunds.ts", lost: 1 }]);
  });

  it("separates new runtime libraries, new tools and major jumps", () => {
    const before = JSON.stringify({
      dependencies: { zod: "^3.0.0", stripe: "^22.0.0" },
      devDependencies: { vitest: "^5.0.0" },
    });
    const after = JSON.stringify({
      dependencies: { zod: "^4.0.0", stripe: "^22.1.0", leftpad: "^1.0.0" },
      devDependencies: { vitest: "^5.0.0", "fast-check": "4.0.0" },
    });
    const changes = packageChanges(before, after);
    expect(changes.added).toEqual([
      { name: "leftpad", kind: "run" },
      { name: "fast-check", kind: "dev" },
    ]);
    expect(changes.bumped.find((pkg) => pkg.name === "zod")?.major).toBe(true);
    expect(changes.bumped.find((pkg) => pkg.name === "stripe")?.major).toBe(false);
  });

  it("names statements that remove data and ignores comments", () => {
    expect(removingStatements("-- DROP TABLE old;\nALTER TABLE a ADD COLUMN b text;")).toEqual([]);
    expect(removingStatements("ALTER TABLE a DROP COLUMN b;\nDELETE FROM c;")).toEqual([
      "removes a column",
      "deletes rows",
    ]);
  });

  it("reads a body section and cuts a long one on a word", () => {
    const body = "## Before\n\n<!-- hint -->Divers could not pay.\n\n## After\n\nThey can.\n";
    expect(bodySection(body, "Before")).toBe("Divers could not pay.");
    expect(bodySection(body, "After")).toBe("They can.");
    expect(bodySection(body, "Missing")).toBe("");
    expect(excerpt("word ".repeat(300), 20)).toBe("word word word word…");
  });

  it("finds the test that sits beside a file by folder and stem", () => {
    const tests = [
      "src/lib/refunds.test.ts",
      "src/lib/refunds.queued.test.ts",
      "src/lib/other.test.ts",
      "src/db/refunds.test.ts",
    ];
    expect(siblingTests("src/lib/refunds.ts", tests)).toEqual([
      "src/lib/refunds.test.ts",
      "src/lib/refunds.queued.test.ts",
    ]);
    expect(siblingTests("src/lib/ref.ts", tests)).toEqual([]);
  });

  it("finds only the card the Actions bot posted, never a copy of the marker by someone else", () => {
    const bot = { id: 2, user: { login: "github-actions[bot]" }, body: `${MARKER}\n## Risk card` };
    const copy = { id: 1, user: { login: "someone" }, body: `${MARKER}\nFine to merge` };
    expect(ourComment([copy, bot])).toBe(bot);
    expect(ourComment([copy])).toBeUndefined();
    expect(ourComment([{ id: 3, user: { login: "github-actions[bot]" }, body: "hello" }])).toBe(
      undefined,
    );
  });

  it("escapes what the author wrote so an unclosed comment cannot hide the card", () => {
    const card = buildRiskCard({
      changes: [change("docs/a.md")],
      body: "## After\n\nShops can book <!-- and the rest of the card vanishes",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.markdown).toContain("&lt;!-- and the rest");
    expect(card.markdown.match(/<!--/g)).toHaveLength(1);
  });

  it("lists three files and counts the rest", () => {
    expect(listFiles(["a", "b"])).toBe("`a`, `b`");
    expect(listFiles(["a", "b", "c", "d", "e"])).toBe("`a`, `b`, `c` and 2 more");
  });
});

describe("risk card verdict", () => {
  it("says a docs-only change is fine and names no weighty area", () => {
    const card = buildRiskCard({
      changes: [change("docs/engineering/testing.md")],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.verdict).toBe("ok");
    expect(card.markdown).toContain(MARKER);
    expect(card.markdown).toContain("Fine to merge once the checks are green");
    expect(card.markdown).toContain("Nothing in money, dive safety");
  });

  it("is fine when money code changed beside its test and every break was caught", () => {
    const card = buildRiskCard({
      changes: [change("src/db/refunds.ts"), change("src/db/refunds.test.ts")],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.verdict).toBe("ok");
    expect(card.markdown).toContain("**Money**");
    expect(card.markdown).toContain("the tests caught 4");
  });

  it("asks for eyes when money code changed and no test file did", () => {
    const card = buildRiskCard({
      changes: [change("src/db/refunds.ts")],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.verdict).toBe("eyes");
    expect(card.needs[0].what).toContain("not one test file");
    expect(card.markdown).toContain("Needs your eyes");
  });

  it("names a surviving break by file and line, and says whether CI blocks it", () => {
    const card = buildRiskCard({
      changes: [change("src/lib/readiness.ts"), change("src/lib/readiness.test.ts")],
      body: "",
      mutation: drills({
        totals: { killed: 3, survived: 1, uncompilable: 0, accepted: 1, notTried: 0 },
        files: [
          {
            path: "src/lib/readiness.ts",
            class: "safety",
            survivors: [
              {
                line: 123,
                column: 7,
                operator: "flip a comparison",
                was: "<",
                became: "<=",
                snippet: "if (a < b)",
              },
            ],
            accepted: [{ line: 150, reason: "log text only" }],
          },
        ],
      }),
      referee: referee(),
    });
    expect(card.verdict).toBe("eyes");
    expect(card.markdown).toContain("src/lib/readiness.ts:123");
    expect(card.markdown).toContain("CI blocks this");
    expect(card.markdown).toContain("excused from the breakage drills: log text only");
  });

  it("does not say CI blocks a class set to warn", () => {
    const card = buildRiskCard({
      changes: [change("src/lib/readiness.ts"), change("src/lib/readiness.test.ts")],
      body: "",
      mutation: drills({
        policy: { money: "block", safety: "warn" },
        totals: { killed: 0, survived: 1, uncompilable: 0, accepted: 0, notTried: 0 },
        files: [
          {
            path: "src/lib/readiness.ts",
            class: "safety",
            survivors: [{ line: 5, operator: "negate a check", was: "!x", became: "x" }],
          },
        ],
      }),
      referee: referee(),
    });
    expect(card.markdown).not.toContain("CI blocks this");
  });

  it("owns up to every guard that did not report", () => {
    const card = buildRiskCard({
      changes: [change("src/lib/readiness.ts"), change("src/lib/readiness.test.ts")],
      body: "",
    });
    expect(card.gaps.join("\n")).toContain("breakage drills did not run");
    const quiet = buildRiskCard({ changes: [change("docs/a.md")], body: "" });
    expect(quiet.gaps.join("\n")).not.toContain("breakage drills");
    expect(card.gaps.join("\n")).toContain("referee guard");
    expect(card.markdown).toContain("What this card cannot tell you");
  });

  it("says which money and safety files the breakage drills cannot reach", () => {
    const route = "src/app/api/webhooks/stripe/route.ts";
    const card = buildRiskCard({
      changes: [change(route), change("src/app/api/webhooks/stripe/route.test.ts")],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.gaps.join("\n")).toContain(`do not reach \`${route}\``);
    expect(card.gaps.join("\n")).not.toContain("breakage drills did not run");
    const inReach = buildRiskCard({
      changes: [change("src/db/refunds.ts"), change("src/db/refunds.test.ts")],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(inReach.gaps.join("\n")).not.toContain("do not reach");
  });

  it("says the drills were capped rather than claiming all of them ran", () => {
    const card = buildRiskCard({
      changes: [change("src/lib/readiness.ts"), change("src/lib/readiness.test.ts")],
      body: "",
      mutation: drills({
        capped: true,
        eligible: 412,
        tried: 150,
        totals: { killed: 150, survived: 0, uncompilable: 0, accepted: 0, notTried: 262 },
      }),
      referee: referee(),
    });
    expect(card.markdown).toContain("tried 150 of 412");
  });

  it("asks about a new runtime library but only mentions a new tool", () => {
    const eyes = buildRiskCard({
      changes: [change("package.json")],
      body: "",
      packages: { added: [{ name: "leftpad", kind: "run" }], removed: [], bumped: [] },
      mutation: drills(),
      referee: referee(),
    });
    expect(eyes.verdict).toBe("eyes");
    expect(eyes.markdown).toContain("leftpad");
    const fine = buildRiskCard({
      changes: [change("package.json")],
      body: "",
      packages: { added: [{ name: "fast-check", kind: "dev" }], removed: [], bumped: [] },
      mutation: drills(),
      referee: referee(),
    });
    expect(fine.verdict).toBe("ok");
    expect(fine.markdown).toContain("not shipped to shops");
  });

  it("asks when a migration removes data and when a query stops naming its shop", () => {
    const card = buildRiskCard({
      changes: [
        change("src/db/schema/payments.ts"),
        change("drizzle/20261122000000_x/migration.sql", "A"),
      ],
      body: "",
      migrations: [
        { path: "drizzle/20261122000000_x/migration.sql", removes: ["removes a column"] },
      ],
      shopLosses: [{ file: "src/db/trips.ts", lost: 2 }],
      mutation: drills(),
      referee: referee(),
    });
    expect(card.verdict).toBe("eyes");
    expect(card.markdown).toContain("removes a column");
    expect(card.markdown).toContain("`src/db/trips.ts`");
  });

  it("carries what the referee guard found into the verdict", () => {
    const card = buildRiskCard({
      changes: [change("scripts/check-tenant-gates.mjs")],
      body: "",
      mutation: drills(),
      referee: referee({
        needsEyes: [{ what: "A rule was loosened.", ask: "Was that on purpose?" }],
      }),
    });
    expect(card.verdict).toBe("eyes");
    expect(card.markdown).toContain("A rule was loosened.");
  });

  it("quotes the author's Before and After and labels them unchecked", () => {
    const card = buildRiskCard({
      changes: [change("docs/a.md")],
      body: "## Before\n\nDivers could not pay.\n\n## After\n\nThey can.\n",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.markdown).toContain("**Before:** Divers could not pay.");
    expect(card.markdown).toContain("not something CI checked");
  });

  it("does not count a deleted test file as a test that changed", () => {
    const card = buildRiskCard({
      changes: [change("src/db/refunds.ts"), change("src/db/refunds.test.ts", "D", 0, 40)],
      body: "",
      mutation: drills(),
      referee: referee(),
    });
    expect(card.needs.map((item) => item.what).join("\n")).toContain("not one test file");
  });
});
