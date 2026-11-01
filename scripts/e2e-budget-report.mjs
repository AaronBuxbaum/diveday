#!/usr/bin/env node
/**
 * **Which e2e tests run close to their own budget** (issue #1906).
 *
 * CI fails one shard per run on a test that ran out of budget, and a
 * different test each time: nothing is hanging, the slowest tests are just
 * near the line, and nothing measured which. The CI run now writes
 * Playwright's JSON report (`playwright.config.ts`, `reporter`) and this reads
 * it into the job summary: every test whose slowest attempt took more than
 * half the budget it ran under, worst first.
 *
 * The budget is each test's own **effective** timeout as the report records
 * it, after any `test.slow()` or `test.setTimeout()` in its body — never the
 * 15s default — so a test that already carries a 60s budget and uses 20s is
 * not listed beside one using 9s of 15s.
 *
 * It reports; it refuses nothing. Durations from a contended runner are the
 * numbers the issue is about, and a guard that failed on them would fail on
 * the runner's load. A per-test `test.slow()` with the measured number in its
 * comment is the fix this list asks for, one test at a time.
 *
 * A step summary is where nobody looks, though: `add-diver.spec.ts:48` took
 * about 27 s of its 30 and was on the list before it timed out on run 4752
 * (code review 2026-10-13, row 28). So `--annotate` prints a `::warning` for
 * each test over WARN_SHARE of its budget, which lands in the check run's
 * annotations, the place sessions read a run from.
 *
 *   node scripts/e2e-budget-report.mjs e2e-durations/results.json [--share 0.5]
 *   node scripts/e2e-budget-report.mjs e2e-durations/results.json --annotate
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { playwrightReportSpecs } from "./playwright-report-walk.mjs";

export const DEFAULT_SHARE = 0.5;
/** The share of its budget past which a test is an annotation, not only a summary row. */
export const WARN_SHARE = 0.8;

/** Every test in a Playwright JSON report, flattened with where it lives. */
export function reportTests(report) {
  const tests = [];
  for (const { rootTitle, suiteTitles, suiteFile, spec } of playwrightReportSpecs(
    report.suites ?? [],
  )) {
    const titles = [rootTitle, ...suiteTitles].filter(Boolean).slice(1);
    for (const test of spec.tests ?? []) {
      tests.push({
        title: [...titles, spec.title].join(" › "),
        file: spec.file ?? suiteFile ?? "",
        line: spec.line ?? 0,
        test,
      });
    }
  }
  return tests;
}

/**
 * The tests whose slowest run took more than `share` of their own budget,
 * worst share first. A skipped test, or one with no budget (0 = none), is
 * never listed.
 */
export function closeToBudget(report, { share = DEFAULT_SHARE } = {}) {
  const close = [];
  for (const { title, file, line, test } of reportTests(report)) {
    const durations = (test.results ?? [])
      .filter((result) => result.status !== "skipped")
      .map((result) => result.duration);
    if (durations.length === 0 || !test.timeout) continue;
    const duration = Math.max(...durations);
    const used = duration / test.timeout;
    if (used > share) close.push({ title, file, line, duration, timeout: test.timeout, used });
  }
  return close.sort((a, b) => b.used - a.used);
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** The job-summary section: a heading, one row per test, or a line saying none. */
export function formatBudgetReport(close, { share = DEFAULT_SHARE } = {}) {
  const heading = `### e2e tests over ${Math.round(share * 100)}% of their budget`;
  if (close.length === 0) return `${heading}\n\nNone on this shard.\n`;
  const rows = close.map(
    (entry) =>
      `| ${Math.round(entry.used * 100)}% | ${seconds(entry.duration)} of ${seconds(entry.timeout)} | \`${entry.file}:${entry.line}\` | ${entry.title.replaceAll("|", "\\|")} |`,
  );
  return [
    heading,
    "",
    "| Used | Took | Where | Test |",
    "| ---: | ---: | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/**
 * One `::warning` workflow command per test over `share` of its budget, its
 * file made relative to the working directory through the report's `rootDir`
 * so the annotation lands on the spec's line.
 */
export function budgetAnnotations(report, { share = WARN_SHARE, cwd = process.cwd() } = {}) {
  const rootDir = report.config?.rootDir;
  return closeToBudget(report, { share }).map((entry) => {
    const file = rootDir ? path.relative(cwd, path.resolve(rootDir, entry.file)) : entry.file;
    const title = entry.title
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    return `::warning file=${file},line=${entry.line},title=e2e test at ${Math.round(entry.used * 100)}% of its budget::${title} took ${seconds(entry.duration)} of ${seconds(entry.timeout)}. Give it test.slow() or test.setTimeout() with the measured reason, or make it faster, before it times out on a loaded runner.`;
  });
}

/** The command line: the results file, `--share <n>` and `--annotate` when given. */
export function parseArgs(args) {
  const shareAt = args.indexOf("--share");
  const annotate = args.includes("--annotate");
  const share =
    shareAt === -1 ? (annotate ? WARN_SHARE : DEFAULT_SHARE) : Number(args[shareAt + 1]);
  const file = args.find(
    (arg, index) => !arg.startsWith("--") && (shareAt === -1 || index !== shareAt + 1),
  );
  return { file, share, annotate };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { file, share, annotate } = parseArgs(process.argv.slice(2));
  if (!file || !Number.isFinite(share)) {
    console.error(
      "Usage: node scripts/e2e-budget-report.mjs <results.json> [--share 0.5] [--annotate]",
    );
    process.exit(1);
  }
  if (annotate) {
    // Nothing to annotate without a report; the summary step says why.
    if (existsSync(file)) {
      const lines = budgetAnnotations(JSON.parse(readFileSync(file, "utf8")), { share });
      if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
    }
    process.exit(0);
  }
  if (!existsSync(file)) {
    // A shard that died before the reporter wrote is already red for that
    // reason; this step only says so.
    console.log(
      `### e2e test budgets\n\nNo report at \`${file}\`: the run ended before Playwright wrote one.\n`,
    );
    process.exit(0);
  }
  const close = closeToBudget(JSON.parse(readFileSync(file, "utf8")), { share });
  process.stdout.write(formatBudgetReport(close, { share }));
}
