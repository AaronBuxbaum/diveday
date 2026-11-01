#!/usr/bin/env node
/**
 * A visual capture that failed on main and passed on its one rerun is a flake,
 * and a flake gets an issue, never silence (H-20261022-visual-rerun-on-main).
 *
 * On main, `.github/workflows/ci.yml`'s visual shards rerun their failed
 * captures once, whatever the cause: a failed shard publishes no screenshot
 * baseline, and every branch cut from that commit then compares nothing.
 * Pull requests keep `retries: 0` and the wedge-only rerun
 * (`scripts/e2e-retry-policy.mjs`), so no flake is hidden where a reviewer
 * looks. The price of the rerun on main is this script: the rerun's pass is
 * recorded per capture and filed as a `needs-triage` issue naming the spec,
 * so the flake is still counted and still root-caused.
 *
 *   node scripts/visual-flake-issue.mjs collect --first <first-attempt.json>
 *       --retry <retry-attempt.json> --out <flakes.json>
 *     writes the captures that failed first and passed on the rerun
 *   node scripts/visual-flake-issue.mjs file --dir <dir of flakes.json files>
 *       --run-url <url> [--dry-run]
 *     opens one issue per capture, or comments on the one already open
 *
 * A capture still red on the rerun is not a flake: the shard stays red and
 * main's "Refuse to miss main's baseline silently" step says so.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { findIssueProblems, LABEL as TRIAGE_LABEL } from "./check-follow-ups.mjs";
import { renderFollowUpBody } from "./file-follow-up.mjs";
import { tracker as defaultTracker } from "./tracker.mjs";

/** More than this many flakes in one run is one cause, not many: the rest go in the log. */
export const MAX_ISSUES_PER_RUN = 5;

/** Every test in a Playwright JSON report, with its title path and spec file. */
function* tests(report) {
  function* walk(suites, titles) {
    for (const suite of suites ?? []) {
      const here = suite.title && !suite.title.endsWith(".ts") ? [...titles, suite.title] : titles;
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          yield {
            file: spec.file.startsWith("e2e/") ? spec.file : `e2e/${spec.file}`,
            line: spec.line,
            title: [...here, spec.title].join(" › "),
            project: test.projectName ?? "",
            status: test.status,
          };
        }
      }
      yield* walk(suite.suites, here);
    }
  }
  yield* walk(report?.suites, []);
}

const key = (test) => `${test.project}\u0000${test.file}\u0000${test.title}`;

/** The captures that failed on the first attempt and passed when rerun. */
export function flakyCaptures(firstReport, retryReport) {
  const failed = new Map();
  for (const test of tests(firstReport)) {
    if (test.status === "unexpected") failed.set(key(test), test);
  }
  const flaky = [];
  for (const test of tests(retryReport)) {
    const first = failed.get(key(test));
    if (first && test.status === "expected") {
      flaky.push({ file: first.file, line: first.line, title: first.title });
    }
  }
  return flaky;
}

export function issueTitle(flake) {
  return `Root-cause the visual capture that passed only on a rerun on main: ${flake.title}`;
}

export function issueBody(flake, runUrl) {
  const where = `${flake.file}:${flake.line}`;
  return renderFollowUpBody({
    kind: "risk",
    effort: "S",
    touches: [flake.file, "e2e/visual-harness.ts"],
    noticed: `The visual capture "${flake.title}" (\`${where}\`) failed on main and passed when the shard reran its failed captures once. Main reruns a failed capture so that one flake does not stop the commit publishing its screenshot baseline; pull requests do not rerun, so this capture can fail a pull request that did not touch it. Each later flake of the same capture on main adds a comment here.\n\nFirst flaky run: ${runUrl}`,
    why: "It was found by the rerun on main, not by a change anyone was making. The rerun hides the failure from the run's result on purpose, so this issue is the only record that the capture is not deterministic.",
    proposed:
      "Download the run's `visual-attempts-<shard>` artifact: `first-attempt.json` and `first-attempt-results/` hold the failing attempt's error and trace. Find what differed between the two attempts (a wait on the wrong thing, seeded data, a missing hydration wait) and fix that. Do not add a retry, a wider timeout or a mask.",
    prompt: `The visual capture "${flake.title}" in \`${where}\` failed on main and passed only on the shard's rerun. Read the run linked in this issue (\`gh api repos/AaronBuxbaum/diveday/actions/runs/<id>/jobs\`) and download its visual-attempts artifact for the failing shard; read \`first-attempt.json\` and the trace in \`first-attempt-results/\`. Read \`.claude/rules/e2e.md\`, \`e2e/visual-harness.ts\` and the spec first. Reproduce with \`pnpm e2e:build\` then \`pnpm e2e:run ${flake.file} --repeat-each=5 --reporter=line\`. Fix the cause with no retry, timeout increase or mask. Done is five clean repeats, plus \`pnpm lint\`, \`pnpm typecheck\` and \`pnpm check:repo\`. Close this issue in the PR that lands the fix.`,
  });
}

/**
 * Opens or comments one issue per flaky capture (deduplicated across shards),
 * at most {@link MAX_ISSUES_PER_RUN}. Returns what it did, per capture.
 */
export function fileFlakes({ flakes, runUrl, tracker, dryRun = false, log }) {
  const unique = [...new Map(flakes.map((flake) => [flake.title, flake])).values()];
  const open = tracker.listIssues({ label: TRIAGE_LABEL });
  const done = [];
  for (const [index, flake] of unique.entries()) {
    const title = issueTitle(flake);
    if (index >= MAX_ISSUES_PER_RUN) {
      log(`visual-flake-issue: not filed (over ${MAX_ISSUES_PER_RUN} this run): ${title}`);
      done.push("skipped");
      continue;
    }
    const existing = open.find((issue) => issue.title === title);
    if (existing) {
      tracker.comment(existing.number, `Flaked again on main: ${runUrl}`, { dryRun });
      log(`visual-flake-issue: commented on #${existing.number}.`);
      done.push("commented");
      continue;
    }
    const body = issueBody(flake, runUrl);
    const { problems } = findIssueProblems({ number: 0, title, body });
    if (problems.length > 0) {
      throw new Error(
        `visual-flake-issue: the issue body fails check:follow-ups, so it was not filed:\n${problems.join("\n")}`,
      );
    }
    const created = tracker.createIssue({ title, body, labels: [TRIAGE_LABEL] }, { dryRun });
    log(`visual-flake-issue: opened ${created ? `#${created.number}` : "(dry run)"}: ${title}`);
    done.push("opened");
  }
  return done;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (["--first", "--retry", "--out", "--dir", "--run-url"].includes(flag)) {
      args[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else throw new Error(`visual-flake-issue: unknown argument ${flag}`);
  }
  return args;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === "collect") {
    const flakes = flakyCaptures(readJson(args.first), readJson(args.retry));
    writeFileSync(args.out, `${JSON.stringify(flakes, null, 2)}\n`);
    for (const flake of flakes) {
      console.log(
        `::warning file=${flake.file},line=${flake.line},title=Passed only on the rerun::${flake.title}`,
      );
    }
    return;
  }
  if (command === "file") {
    if (!/^https:\/\/\S+$/.test(args.runUrl ?? "")) {
      throw new Error("visual-flake-issue: --run-url must be the run's https URL");
    }
    const flakes = readdirSync(args.dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => readJson(path.join(args.dir, name)));
    if (flakes.length === 0) {
      console.log("visual-flake-issue: no capture passed only on a rerun.");
      return;
    }
    fileFlakes({
      flakes,
      runUrl: args.runUrl,
      tracker: defaultTracker(),
      dryRun: args.dryRun,
      log: console.log,
    });
    return;
  }
  throw new Error("visual-flake-issue: the command is `collect` or `file`.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
