import { writeFileSync } from "node:fs";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

/**
 * **Where a visual shard's wall time goes**, as one JSON file.
 *
 * A capture shard's recorded test durations summed to about 7 of its 12
 * minutes on CI, and nothing said where the rest went. This answers it for a
 * local run: wall time, the sum of test durations, how many worker processes
 * started (each one a browser launch and a cold context), and the time spent
 * inside each fixture, read from Playwright's own fixture steps rather than by
 * timing the fixtures from inside. A fixture's `count` holds its setup and its
 * teardown steps, so a test-scoped fixture reads twice per test; `ms` is both.
 *
 * Opt-in and off every CI path: add it with
 * `--reporter=list,./e2e/visual-timing-reporter.ts` and read
 * `VISUAL_TIMING_OUT` (default `visual-timing.json`). The procedure and the
 * numbers it produced are in docs/engineering/testing.md, "Where a visual
 * shard's time goes".
 */
type Row = { title: string; workerIndex: number; duration: number; status: string };

class VisualTimingReporter implements Reporter {
  private readonly started = Date.now();
  private readonly rows: Row[] = [];
  private readonly fixtures = new Map<string, { count: number; ms: number }>();
  private readonly workers = new Set<number>();

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== "fixture") return;
    // "Fixture \"privateShop\"" in current Playwright; keep whatever it says.
    const name = step.title.replace(/^fixture:?\s*/i, "").replace(/^"|"$/g, "");
    const entry = this.fixtures.get(name) ?? { count: 0, ms: 0 };
    entry.count += 1;
    entry.ms += step.duration;
    this.fixtures.set(name, entry);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.workers.add(result.workerIndex);
    this.rows.push({
      title: test.titlePath().slice(1).join(" › "),
      workerIndex: result.workerIndex,
      duration: result.duration,
      status: result.status,
    });
  }

  onEnd(result: FullResult) {
    const summary = {
      wallMs: Date.now() - this.started,
      runnerMs: result.duration,
      tests: this.rows.length,
      sumTestMs: this.rows.reduce((sum, row) => sum + row.duration, 0),
      workerStarts: this.workers.size,
      fixtures: Object.fromEntries([...this.fixtures.entries()].sort((a, b) => b[1].ms - a[1].ms)),
      rows: this.rows,
    };
    writeFileSync(
      process.env.VISUAL_TIMING_OUT ?? "visual-timing.json",
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }

  printsToStdio() {
    return false;
  }
}

export default VisualTimingReporter;
