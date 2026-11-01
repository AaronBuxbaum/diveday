import { describe, expect, it } from "vitest";
import {
  budgetAnnotations,
  closeToBudget,
  formatBudgetReport,
  parseArgs,
  reportTests,
  WARN_SHARE,
} from "./e2e-budget-report.mjs";

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

  it("keeps the current suite file and existing untitled-root title behavior", () => {
    const test = { timeout: 15_000, results: [result(14_000)] };
    const report = {
      suites: [
        {
          file: "root.spec.ts",
          suites: [
            {
              title: "first describe",
              suites: [
                {
                  title: "last describe",
                  file: "current.spec.ts",
                  specs: [{ title: "a slow test", tests: [test] }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(reportTests(report)).toEqual([
      { title: "last describe › a slow test", file: "current.spec.ts", line: 0, test },
    ]);
    expect(() => reportTests(null)).toThrow();
  });

  it("omits a falsey nested suite title as the previous traversal did", () => {
    const report = {
      suites: [
        {
          title: "waivers.spec.ts",
          file: "waivers.spec.ts",
          suites: [
            {
              title: "",
              specs: [
                {
                  title: "slow",
                  tests: [{ timeout: 15_000, results: [result(14_000)] }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(reportTests(report).map((test) => test.title)).toEqual(["slow"]);
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
      annotate: false,
    });
    expect(parseArgs(["--share", "0.4", "results.json"])).toEqual({
      file: "results.json",
      share: 0.4,
      annotate: false,
    });
    expect(parseArgs(["results.json", "--annotate"])).toEqual({
      file: "results.json",
      share: WARN_SHARE,
      annotate: true,
    });
  });

  it("annotates a test over 80% of its budget on its own line, and leaves one at 60% to the summary", () => {
    const withRoot = { ...report, config: { rootDir: "/repo/e2e" } };
    expect(budgetAnnotations(withRoot, { cwd: "/repo" })).toEqual([
      "::warning file=e2e/waivers.spec.ts,line=40,title=e2e test at 93% of its budget::the counter › seats a walk-in took 14.0s of 15.0s. Give it test.slow() or test.setTimeout() with the measured reason, or make it faster, before it times out on a loaded runner.",
    ]);
    // At 10%, three tests make the summary's list; only the one over 80% is annotated.
    expect(closeToBudget(report, { share: 0.1 })).toHaveLength(3);
    expect(budgetAnnotations({ suites: [] })).toEqual([]);
  });
});
