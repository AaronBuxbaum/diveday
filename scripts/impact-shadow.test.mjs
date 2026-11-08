import { describe, expect, it } from "vitest";
import { compareShadow, selectionSnapshot, shadowSummary, specPath } from "./impact-shadow.mjs";

const selection = () =>
  selectionSnapshot(
    {
      base: "main",
      changed: ["src/example.ts"],
      strong: new Map([["e2e/a.spec.ts:10", new Set(["smoke"])]]),
      reach: new Map([["e2e/b.spec.ts", new Set(["route"])]]),
    },
    { sha: "abc" },
  );
const row = (
  file,
  line,
  status = "expected",
  results = [{ status: "passed", duration: 10 }],
  more = {},
) => ({
  title: `test ${line}`,
  file,
  line,
  tests: [{ status, results, projectName: "chromium", ...more }],
});
const report = (...specs) => ({ suites: [{ title: "suite", specs }] });
const failure = (file, line) => row(file, line, "unexpected", [{ status: "failed", duration: 20 }]);

describe("full-suite selection shadow", () => {
  it("measures the budgeted agent plan independently of full selection", () => {
    const snapshot = { ...selection(), agent: { specs: ["e2e/a.spec.ts:10"], estimatedMs: 12 } };
    const result = compareShadow(snapshot, report(failure("b.spec.ts", 1)));
    expect(result.counts).toMatchObject({ deferredFailures: 0, agentDeferredFailures: 1 });
    expect(result.durationMs.agentSelected).toBe(0);
    expect(result.estimatedAgentMs).toBe(12);
  });
  it("matches whole specs and individual smoke lines without claiming their siblings", () => {
    const result = compareShadow(
      selection(),
      report(row("a.spec.ts", 10), failure("a.spec.ts", 20), failure("b.spec.ts", 10)),
    );
    expect(result.counts).toMatchObject({
      selected: 2,
      deferred: 1,
      deferredFailures: 1,
      outsideStrongFailures: 2,
    });
    expect(result.durationMs).toEqual({
      agentSelected: null,
      observed: 50,
      selected: 30,
      deferred: 20,
    });
    expect(result.observations[1].outcome).toBe("single-failure");
    expect(shadowSummary(result)).toContain("not proven change-caused misses");
  });
  it("recognizes retry recovery, without laundering the first attempt", () => {
    const result = compareShadow(selection(), report(failure("c.spec.ts", 1)), {
      retryReport: report(row("c.spec.ts", 1)),
    });
    expect(result.counts).toMatchObject({ unresolvedFailures: 0, retryRecovered: 1 });
    expect(result.observations[0]).toMatchObject({
      attempts: 2,
      durationMs: 30,
      outcome: "retry-recovered",
    });
  });
  it("labels failures repeated on containment rerun, without asserting causality", () => {
    const result = compareShadow(selection(), report(failure("c.spec.ts", 1)), {
      retryReport: report(failure("c.spec.ts", 1)),
    });
    expect(result.observations[0].outcome).toBe("repeated-failure");
    expect(result.counts.deferredFailures).toBe(1);
  });
  it("does not match retries in another project", () => {
    const retry = row("c.spec.ts", 1, "expected", [{ status: "passed" }], {
      projectName: "firefox",
    });
    expect(
      compareShadow(selection(), report(failure("c.spec.ts", 1)), { retryReport: report(retry) })
        .counts.retryRecovered,
    ).toBe(0);
  });
  it("separates built-in flakes, expected failures, skipped and interrupted tests", () => {
    const result = compareShadow(
      selection(),
      report(
        row("c.spec.ts", 1, "flaky", [{ status: "failed" }, { status: "passed" }]),
        row("c.spec.ts", 2, "expected", [{ status: "failed" }], { expectedStatus: "failed" }),
        row("c.spec.ts", 3, "skipped", [{ status: "skipped" }]),
        row("c.spec.ts", 4, "unexpected", [{ status: "interrupted" }]),
      ),
    );
    expect(result.counts).toMatchObject({ executed: 2, unresolvedFailures: 0, retryRecovered: 1 });
  });
  it("counts unexpected passes as red CI, never retry recovery", () => {
    const unexpectedPass = row("c.spec.ts", 1, "unexpected", [{ status: "passed", duration: 10 }], {
      expectedStatus: "failed",
    });
    const result = compareShadow(selection(), report(unexpectedPass), {
      retryReport: report(failure("c.spec.ts", 1)),
    });
    expect(result.observations[0].outcome).toBe("unexpected-pass");
    expect(result.counts).toMatchObject({
      unexpectedPasses: 1,
      unresolvedFailures: 1,
      deferredFailures: 1,
      retryRecovered: 0,
    });
    expect(shadowSummary(result)).toContain("(unexpected-pass)");
  });
  it("never calls unavailable selection a zero-recall prediction", () => {
    const result = compareShadow(selectionSnapshot(null), report(failure("a.spec.ts", 1)));
    expect(result.counts.deferredFailures).toBe(0);
    expect(result.observations[0].selected).toBeNull();
    expect(shadowSummary(result)).toContain("recall cannot be measured");
  });
  it("rejects cross-commit snapshots and unknown schemas", () => {
    expect(() => compareShadow(selection(), report(), { sha: "different" })).toThrow("SHA");
    expect(() => compareShadow({ version: 2 }, report())).toThrow("version");
  });
  it("flags incomplete report-level errors", () => {
    expect(shadowSummary(compareShadow(selection(), { errors: [{}] }))).toContain(
      "may be incomplete",
    );
  });
  it("normalizes Playwright paths without losing nested specs", () => {
    expect(specPath("/home/runner/work/repo/e2e/nested/a.spec.ts")).toBe("e2e/nested/a.spec.ts");
    expect(specPath("e2e/a.spec.ts")).toBe("e2e/a.spec.ts");
    expect(specPath("C:\\repo\\e2e\\a.spec.ts")).toBe("e2e/a.spec.ts");
  });
});
