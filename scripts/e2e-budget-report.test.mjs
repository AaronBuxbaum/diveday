import { describe, expect, it } from "vitest";
import { closeToBudget, formatBudgetReport, parseArgs, reportTests } from "./e2e-budget-report.mjs";

const result = (duration, status = "passed") => ({ duration, status });
const report = {
  suites: [
    {
      title: "waivers.spec.ts",
      file: "waivers.spec.ts",
      specs: [
        {
          title: "a refused evaluation stops the chase",
          file: "waivers.spec.ts",
          line: 1216,
          // test.slow() in the body: the report records the tripled budget.
          tests: [{ timeout: 45_000, results: [result(9_000)] }],
        },
        {
          title: "a quick one",
          file: "waivers.spec.ts",
          line: 10,
          tests: [{ timeout: 15_000, results: [result(3_000)] }],
        },
      ],
      suites: [
        {
          title: "the counter",
          specs: [
            {
              title: "seats a walk-in",
              file: "waivers.spec.ts",
              line: 40,
              tests: [{ timeout: 15_000, results: [result(9_500), result(14_000, "timedOut")] }],
            },
            {
              title: "skipped",
              file: "waivers.spec.ts",
              line: 50,
              tests: [{ timeout: 15_000, results: [result(0, "skipped")] }],
            },
          ],
        },
      ],
    },
  ],
};

describe("e2e budget report", () => {
  it("flattens nested describes into one title per test", () => {
    expect(reportTests(report).map((entry) => entry.title)).toContain(
      "the counter › seats a walk-in",
    );
  });

  it("measures each test against its own effective budget, slowest attempt first", () => {
    const close = closeToBudget(report);
    // 9s of a 45s slow() budget is 20%, so it is not listed beside 14s of 15s.
    expect(close.map((entry) => entry.title)).toEqual(["the counter › seats a walk-in"]);
    expect(close[0]).toMatchObject({ duration: 14_000, timeout: 15_000, line: 40 });
  });

  it("takes a narrower or wider share when asked", () => {
    expect(closeToBudget(report, { share: 0.1 })).toHaveLength(3);
  });

  it("writes a table, or one line when nothing is close", () => {
    const table = formatBudgetReport(closeToBudget(report));
    expect(table).toContain(
      "| 93% | 14.0s of 15.0s | `waivers.spec.ts:40` | the counter › seats a walk-in |",
    );
    expect(formatBudgetReport([])).toContain("None on this shard.");
  });

  it("reads the results file whether or not --share is given", () => {
    expect(parseArgs(["e2e-durations/results.json"]).file).toBe("e2e-durations/results.json");
    expect(parseArgs(["results.json", "--share", "0.4"])).toEqual({
      file: "results.json",
      share: 0.4,
    });
    expect(parseArgs(["--share", "0.4", "results.json"])).toEqual({
      file: "results.json",
      share: 0.4,
    });
  });
});
