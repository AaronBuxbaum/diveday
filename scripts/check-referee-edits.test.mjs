import { describe, expect, it } from "vitest";

import {
  changedExpectations,
  loweredFloors,
  newAbsorbedReasons,
  parseExpect,
  parseHunks,
  raisedAllowances,
  refereeProblems,
  refereeReport,
  ruleFileKind,
  statementOf,
  testCounts,
  testLoss,
} from "./check-referee-edits.mjs";

const change = (path, status = "M", added = 3, removed = 0) => ({ path, status, added, removed });

const suite = (assertions, extra = "") =>
  [
    'it("one", () => {',
    ...Array.from({ length: assertions }, (_, i) => `  expect(value${i}).toBe(${i});`),
    "});",
    extra,
  ].join("\n");

const report = (overrides) =>
  refereeReport({
    changes: [],
    before: () => null,
    after: () => null,
    hunks: [],
    body: "",
    ...overrides,
  });

describe("reading tests", () => {
  it("counts tests, checks and switched-off tests, and ignores comments", () => {
    const source = [
      'it("a", () => { expect(1).toBe(1); });',
      'test.each([1])("b", () => { expect(2).toBe(2); });',
      "// expect(3).toBe(3);",
      'it.skip("c", () => {});',
      "/* it.only( */",
    ].join("\n");
    expect(testCounts(source)).toEqual({ tests: 2, assertions: 2, switchedOff: 1 });
  });

  it("measures what a test file lost", () => {
    expect(testLoss(suite(4), suite(1))).toEqual({
      deleted: false,
      tests: 0,
      assertions: 3,
      switchedOff: 0,
    });
    expect(testLoss(suite(2), suite(2, 'it.skip("x", () => {});'))).toMatchObject({
      switchedOff: 1,
    });
    expect(testLoss(suite(2), null)).toMatchObject({ deleted: true, tests: 1, assertions: 2 });
    expect(testLoss(suite(1), suite(5))).toMatchObject({ assertions: 0 });
  });

  it("parses an expectation and gives up on anything else", () => {
    expect(parseExpect("  expect(await refund(order)).toBe(100);")).toEqual({
      subject: "await refund(order)",
      prefix: "",
      matcher: "toBe",
      args: "100",
    });
    expect(parseExpect("await expect(run()).rejects.toThrow('no');")).toMatchObject({
      prefix: "rejects.",
      matcher: "toThrow",
    });
    expect(parseExpect("const x = 1;")).toBeNull();
  });

  it("finds an expected answer changed in place, and a check made weaker", () => {
    const patch = [
      "--- a/src/db/refunds.test.ts",
      "+++ b/src/db/refunds.test.ts",
      "@@ -10,2 +10,2 @@",
      "-  expect(refundCents).toBe(100);",
      "-  expect(result).toEqual({ ok: true });",
      "+  expect(refundCents).toBe(90);",
      "+  expect(result).toBeTruthy();",
      "--- a/src/lib/refunds.ts",
      "+++ b/src/lib/refunds.ts",
      "@@ -1 +1 @@",
      "-  expect(a).toBe(1);",
      "+  expect(a).toBe(2);",
    ].join("\n");
    expect(changedExpectations(parseHunks(patch))).toEqual([
      {
        file: "src/db/refunds.test.ts",
        kind: "answer",
        subject: "refundCents",
        was: "100",
        became: "90",
      },
      {
        file: "src/db/refunds.test.ts",
        kind: "weaker",
        subject: "result",
        was: "toEqual",
        became: "toBeTruthy",
      },
    ]);
  });

  it("does not pair expectations about different subjects", () => {
    const patch = [
      "+++ b/a.test.ts",
      "@@ -1 +1 @@",
      "-  expect(a).toBe(1);",
      "+  expect(b).toBe(2);",
    ].join("\n");
    expect(changedExpectations(parseHunks(patch))).toEqual([]);
  });
});

describe("reading floors and allowances", () => {
  it("finds a lowered or removed floor and ignores a rise", () => {
    const before = { "//": "x", "src/a.ts": 90, "src/b.ts": 80, "src/c.ts": 70, "src/d.ts": 60 };
    const after = { "//": "x", "src/a.ts": 85, "src/b.ts": 95, "src/d.ts": 60 };
    expect(loweredFloors(before, after, () => true)).toEqual([
      { key: "src/a.ts", was: 90, now: 85 },
      { key: "src/c.ts", was: 70, now: null },
    ]);
    expect(loweredFloors(before, after, (key) => key !== "src/c.ts")).toEqual([
      { key: "src/a.ts", was: 90, now: 85 },
    ]);
  });

  it("finds a ratchet allowance that rose or appeared", () => {
    const before = { architecture: { "src/a.ts": 1 }, copy: { "//": "x" } };
    const after = { architecture: { "src/a.ts": 3, "src/b.ts": 2 }, copy: { "//": "x" } };
    expect(raisedAllowances(before, after)).toEqual([
      { key: "architecture.src/a.ts", was: 1, now: 3 },
      { key: "architecture.src/b.ts", was: 0, now: 2 },
    ]);
    expect(raisedAllowances(after, before)).toEqual([]);
  });

  it("quotes only reasons newly recorded as absorbed", () => {
    const before = { "//absorbed": [{ why: "old" }] };
    const after = { "//absorbed": [{ why: "old" }, { why: "dead code deleted" }] };
    expect(newAbsorbedReasons(before, after)).toEqual(["dead code deleted"]);
  });
});

describe("rule files and the author's statement", () => {
  it("names the files that judge a change and leaves tests and product code alone", () => {
    expect(ruleFileKind("scripts/check-tenant-gates.mjs")?.kind).toBe("check");
    expect(ruleFileKind("scripts/check-tenant-gates.test.mjs")).toBeNull();
    expect(ruleFileKind(".github/workflows/ci.yml")?.kind).toBe("ci");
    expect(ruleFileKind("biome.json")?.kind).toBe("lint");
    expect(ruleFileKind(".claude/rules/domain.md")?.kind).toBe("agent-rules");
    expect(ruleFileKind("src/lib/refunds.ts")).toBeNull();
  });

  it("takes a real sentence and refuses a placeholder", () => {
    const body = (text) => `## Rules changed\n\n<!-- hint -->${text}\n\n## How\n`;
    expect(statementOf(body("none"))).toBe("");
    expect(statementOf(body("n/a"))).toBe("");
    expect(statementOf(body("ok"))).toBe("");
    expect(
      statementOf(
        body("The refund test now expects the rounded amount because the old one pinned a bug."),
      ),
    ).toContain("rounded amount");
    expect(statementOf("")).toBe("");
  });
});

describe("the referee's report", () => {
  it("says nothing was loosened when nothing was", () => {
    const result = report({
      changes: [change("src/lib/refunds.ts"), change("src/lib/refunds.test.ts")],
      before: () => suite(1),
      after: () => suite(3),
    });
    expect(result.loosens).toBe(0);
    expect(result.protects[0]).toContain("no test was deleted or weakened");
  });

  it("needs eyes for a deleted money test and none when the code was deleted with it", () => {
    const alone = report({
      changes: [change("src/db/refunds.test.ts", "D", 0, 50)],
      before: () => suite(3),
    });
    expect(alone.needsEyes).toHaveLength(1);
    expect(alone.needsEyes[0].what).toContain("test file was deleted");
    expect(alone.needsEyes[0].ask).toContain("No reason was given");
    const together = report({
      changes: [
        change("src/db/refunds.test.ts", "D", 0, 50),
        change("src/db/refunds.ts", "D", 0, 80),
      ],
      before: () => suite(3),
    });
    expect(together.loosens).toBe(0);
  });

  it("only lists a lost check in an unweighty test once it is five or more", () => {
    const few = report({
      changes: [change("src/components/Foo.test.tsx")],
      before: () => suite(8),
      after: () => suite(5),
    });
    expect(few.loosens).toBe(0);
    const many = report({
      changes: [change("src/components/Foo.test.tsx")],
      before: () => suite(12),
      after: () => suite(5),
    });
    expect(many.watch).toHaveLength(1);
    expect(many.needsEyes).toHaveLength(0);
    const money = report({
      changes: [change("src/db/refunds.test.ts")],
      before: () => suite(3),
      after: () => suite(2),
    });
    expect(money.needsEyes).toHaveLength(1);
  });

  it("raises a changed money answer to Aaron and quotes the author's reason", () => {
    const hunks = parseHunks(
      [
        "+++ b/src/db/refunds.test.ts",
        "@@ -1 +1 @@",
        "-  expect(refundCents).toBe(100);",
        "+  expect(refundCents).toBe(90);",
      ].join("\n"),
    );
    const result = report({
      changes: [change("src/db/refunds.test.ts")],
      before: () => suite(1),
      after: () => suite(1),
      hunks,
      body: "## Rules changed\n\nThe refund is now rounded down to the cent, so the old figure was wrong.",
    });
    expect(result.needsEyes[0].what).toContain("expected answer changed");
    expect(result.needsEyes[0].ask).toContain("rounded down to the cent");
  });

  it("raises a lowered coverage floor and lists a recorded fall", () => {
    const floors = (value, absorbed = []) =>
      JSON.stringify({ "//absorbed": absorbed, "src/lib/readiness.ts": value });
    const result = report({
      changes: [change("scripts/coverage-floors.json")],
      before: () => floors(99),
      after: () => floors(90, [{ why: "dead branch deleted" }]),
    });
    expect(result.needsEyes[0].what).toContain("lowered from 99% to 90%");
    expect(result.watch.join("\n")).toContain("dead branch deleted");
  });

  it("calls an edited check a loosening and an added check a tightening", () => {
    const edited = report({ changes: [change("scripts/check-tenant-gates.mjs", "M", 4, 3)] });
    expect(edited.loosens).toBe(1);
    expect(edited.watch[0]).toContain("a repository check was edited");
    const added = report({ changes: [change("scripts/check-new.mjs", "A", 40, 0)] });
    expect(added.loosens).toBe(0);
    expect(added.tightens).toBe(1);
    expect(added.protects.join("\n")).toContain("Added a repository check");
    const removed = report({ changes: [change("scripts/check-tenant-gates.mjs", "D", 0, 80)] });
    expect(removed.needsEyes).toHaveLength(1);
  });

  it("mentions a rule switched off in product code but does not make it a loosening", () => {
    const hunks = parseHunks(
      [
        "+++ b/src/lib/a.ts",
        "@@ -1 +1 @@",
        "+// biome-ignore lint/suspicious/noExplicitAny: parser output",
      ].join("\n"),
    );
    const result = report({ changes: [change("src/lib/a.ts")], hunks });
    expect(result.watch[0]).toContain("switched off in product code");
    expect(result.loosens).toBe(0);
  });
});

describe("what a pull request must say", () => {
  const reviewed =
    "## Reviews launched\n\n- `referee-reviewer`: launched; found nothing that makes a bad change easier to merge\n";
  const said = "## Rules changed\n\nThe floor moved because the dead branch was deleted.\n";

  it("asks for nothing when nothing loosened", () => {
    expect(refereeProblems({ loosens: 0 }, "")).toEqual([]);
  });

  it("asks for both the sentence and the reviewer, and accepts both", () => {
    expect(refereeProblems({ loosens: 2 }, "")).toHaveLength(2);
    expect(refereeProblems({ loosens: 2 }, said)).toHaveLength(1);
    expect(refereeProblems({ loosens: 2 }, reviewed)).toHaveLength(1);
    expect(refereeProblems({ loosens: 2 }, `${said}\n${reviewed}`)).toEqual([]);
  });

  it("accepts a reasoned skip of the reviewer but not a bare one", () => {
    const skip =
      "## Reviews launched\n\n- `referee-reviewer`: not needed because the edit only reorders two lines of the workflow\n";
    expect(refereeProblems({ loosens: 1 }, `${said}\n${skip}`)).toEqual([]);
    expect(
      refereeProblems(
        { loosens: 1 },
        `${said}\n## Reviews launched\n\n- \`referee-reviewer\`: yes\n`,
      ),
    ).toHaveLength(1);
  });
});
