import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ModuleDiagnostic, Reporter, TestModule } from "vitest/node";

/**
 * Records how long each test file took, so the shard sequencer can deal by
 * measured cost rather than by a source estimate (src/test/shard-sequencer.ts).
 *
 * Off unless `DIVEDAY_TEST_DURATIONS_OUT` names a file; CI's unit shards set it
 * and upload the result. Added *beside* the run's real reporter
 * (`--reporter=dot --reporter=./src/test/duration-reporter.ts`), never instead
 * of it.
 *
 * When it is on it also prints the same map as **one log line**, after
 * {@link DURATIONS_LOG_MARKER}. The artifact alone was not enough: downloading
 * one follows a redirect to GitHub's blob storage, which a cloud agent session's
 * egress policy refuses, so the committed durations file sat unrefreshable
 * (issue #2227). A job's log text is readable where the artifact is not (the
 * GitHub MCP server's `get_job_logs`), and `scripts/merge-test-durations.mjs`
 * reads either form.
 *
 * A file's weight is its whole wall cost in its fork — environment setup,
 * harness preparation, import and collection, setup files, then every test and
 * hook — because that is what a shard waits for. The test bodies alone (what
 * Vitest's JSON reporter measures) miss the import cost that dominates many
 * small files.
 */
export const DURATIONS_OUT_ENV = "DIVEDAY_TEST_DURATIONS_OUT";

/**
 * Prefixes the log line. `scripts/merge-test-durations.mjs` matches the same
 * string (`duration-reporter.test.ts` pins that the two agree).
 */
export const DURATIONS_LOG_MARKER = "diveday-test-durations:";

/** The one line a shard's log carries: the marker, then the compact map. */
export function durationsLogLine(durations: Record<string, number>): string {
  return `${DURATIONS_LOG_MARKER} ${JSON.stringify(durations)}`;
}

/** The parts of a file's diagnostic that add up to its wall cost. */
export type CostParts = Pick<
  ModuleDiagnostic,
  "environmentSetupDuration" | "prepareDuration" | "collectDuration" | "setupDuration" | "duration"
>;

/** The whole wall cost of one test file, in milliseconds. */
export function moduleCost(diagnostic: CostParts): number {
  return (
    diagnostic.environmentSetupDuration +
    diagnostic.prepareDuration +
    diagnostic.collectDuration +
    diagnostic.setupDuration +
    diagnostic.duration
  );
}

/** Repo-relative POSIX path → rounded milliseconds, sorted by path. */
export function collectDurations(
  modules: readonly { moduleId: string; cost: number }[],
  root: string,
): Record<string, number> {
  const entries = modules
    .filter(({ cost }) => Number.isFinite(cost) && cost >= 0)
    .map(({ moduleId, cost }): [string, number] => [
      path.relative(root, moduleId).split(path.sep).join("/"),
      Math.round(cost),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

export default class DurationReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const out = process.env[DURATIONS_OUT_ENV];
    if (!out || testModules.length === 0) return;
    const root = testModules[0].project.config.root;
    const durations = collectDurations(
      testModules.map((module) => ({
        moduleId: module.moduleId,
        cost: moduleCost(module.diagnostic()),
      })),
      root,
    );
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    writeFileSync(out, `${JSON.stringify(durations, null, 2)}\n`);
    console.log(durationsLogLine(durations));
  }
}
