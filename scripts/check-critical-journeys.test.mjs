import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { auditLedger, findTest, parseLedger } from "./check-critical-journeys.mjs";

const ledger = (...rows) =>
  [
    "# Testing",
    "",
    "## Critical journeys",
    "",
    "| Journey | Spec | Test |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## What runs when",
    "| Book | `e2e/not-a-journey.spec.ts` | below the section |",
  ].join("\n");

const spec = [
  'test("a diver books a seat", async ({ page }) => {});',
  "test(",
  '  "a diver\'s card payment settles their Pay step",',
  "  async ({ page }) => {},",
  ");",
  'test.skip("a skipped walk", async () => {});',
  'test.describe("a describe, not a test", () => {});',
].join("\n");

const readSpec = (path) => (path === "e2e/booking.spec.ts" ? spec : null);

describe("parseLedger", () => {
  it("reads the rows under its own heading only", () => {
    expect(parseLedger(ledger("| Book | `e2e/booking.spec.ts` | a diver books a seat |"))).toEqual([
      { journey: "Book", spec: "e2e/booking.spec.ts", title: "a diver books a seat", line: 7 },
    ]);
  });

  it("says when the section is missing", () => {
    expect(parseLedger("# Testing\n")).toBeNull();
  });
});

describe("findTest", () => {
  it("finds a title split onto its own line and one holding an apostrophe", () => {
    expect(findTest(spec, "a diver's card payment settles their Pay step")).toBe("test");
  });

  it("tells a skipped test from a missing one, and does not take a describe for a test", () => {
    expect(findTest(spec, "a skipped walk")).toBe("skipped");
    expect(findTest(spec, "a describe, not a test")).toBeNull();
    expect(findTest(spec, "a diver books")).toBeNull();
  });
});

describe("auditLedger", () => {
  it("passes when every row's test exists", () => {
    expect(
      auditLedger(ledger("| Book | `e2e/booking.spec.ts` | a diver books a seat |"), readSpec),
    ).toEqual([]);
  });

  it("fails a renamed test, a missing spec and a skipped test", () => {
    const problems = auditLedger(
      ledger(
        "| Book | `e2e/booking.spec.ts` | a diver books a boat |",
        "| Gone | `e2e/gone.spec.ts` | anything |",
        "| Skip | `e2e/booking.spec.ts` | a skipped walk |",
      ),
      readSpec,
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/\(Book\): no test titled "a diver books a boat"/);
    expect(problems[1]).toMatch(/e2e\/gone\.spec\.ts does not exist/);
    expect(problems[2]).toMatch(/is skipped/);
  });

  it("fails an empty or missing ledger", () => {
    expect(auditLedger(ledger(), readSpec)).toEqual([expect.stringMatching(/has no rows/)]);
    expect(auditLedger("# Testing\n", readSpec)).toEqual([
      expect.stringMatching(/no "## Critical/),
    ]);
  });

  it("holds against the real ledger", () => {
    const markdown = readFileSync("docs/engineering/testing.md", "utf8");
    const real = (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    };
    expect(parseLedger(markdown).length).toBeGreaterThanOrEqual(15);
    expect(auditLedger(markdown, real)).toEqual([]);
  });
});

it("rejects comments, skipped suites, callback skips and expected failures", () => {
  expect(findTest("// test('critical', async()=>{});", "critical")).toBeNull();
  expect(findTest("/* test('critical', async()=>{}); */", "critical")).toBeNull();
  for (const source of [
    "test.describe.skip('disabled',()=>{test('critical',async()=>{})})",
    "test.describe.fixme('disabled',()=>{test('critical',async()=>{})})",
    "test('critical',async()=>{test.skip(true, 'disabled')})",
    "test.fail('critical',async()=>{})",
    "test('critical @quarantine',async()=>{})",
  ])
    expect(findTest(source, "critical")).not.toBe("test");
});

it("rejects quarantine options and runtime suite skip annotations", () => {
  expect(findTest(`test('critical', {tag:'@quarantine'}, async()=>{})`, "critical")).toBe(
    "skipped",
  );
  expect(
    findTest(
      `test.describe('group',()=>{test.skip(process.env.OFF);test('critical',async()=>{})})`,
      "critical",
    ),
  ).toBe("skipped");
  expect(findTest(`const example="test('critical', async()=>{})"`, "critical")).toBeNull();
});

it("rejects file-level skip hooks and suite quarantine tags", () => {
  expect(
    findTest(`test.beforeEach(()=>{test.skip(true)});test('critical',async()=>{})`, "critical"),
  ).toBe("skipped");
  expect(
    findTest(
      `test.describe('suite',{tag:'@quarantine'},()=>{test('critical',async()=>{})})`,
      "critical",
    ),
  ).toBe("skipped");
});

it("leaves enabled siblings of a directly skipped declaration alone", () => {
  expect(
    findTest(
      `test.describe('suite',()=>{test.skip('other',async()=>{});test('critical',async()=>{})})`,
      "critical",
    ),
  ).toBe("test");
});

it("rejects quarantined function-callback suites and leaves enabled function-callback siblings alone", () => {
  expect(
    findTest(
      `test.describe('suite', {tag:'@quarantine'}, function () { test('critical', async function(){}) })`,
      "critical",
    ),
  ).toBe("skipped");
});
it("leaves enabled siblings of function-callback skipped declarations alone", () => {
  expect(
    findTest(
      `test.describe('suite', () => {test.skip('disabled',async function(){});test('critical',async()=>{})})`,
      "critical",
    ),
  ).toBe("test");
});
