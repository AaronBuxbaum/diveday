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
