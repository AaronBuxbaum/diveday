// Files a weekly mutation run's survivors as one issue per module (test review 2026-10-14,
// decision 7; ADR 20261015-coverage-and-mutation-testing).
//
//   node scripts/mutation-issues.mjs --report reports/mutation/mutation.json --module src/lib/readiness.ts --run-url <url> [--dry-run]
//
// The report is Stryker's JSON reporter output (mutation-testing-report-schema). A survivor is a
// mutant no test noticed (`Survived`) or one no test even ran (`NoCoverage`): either way an
// assertion the module's tests are missing. One open issue per module, found by the
// `mutation-survivors` label and its exact title: the first run with survivors opens it, each
// later run comments with that week's list, and a run with none closes it.
//
// The issue is a `needs-triage` follow-up in the shape docs/agents/issue-tracker.md requires,
// composed by `renderFollowUpBody` and checked by `findIssueProblems` before it is filed: a
// malformed one reddens the daily `check:follow-ups` scan for everyone. When the survivor list
// itself trips the guard (a mutant's replacement text can be anything), the body falls back to
// the counts alone and the list goes in a comment, where the guard does not look.

import { readFileSync } from "node:fs";
import process from "node:process";

import { findIssueProblems, LABEL as TRIAGE_LABEL } from "./check-follow-ups.mjs";
import { renderFollowUpBody } from "./file-follow-up.mjs";
import { tracker as defaultTracker } from "./tracker.mjs";

export const MUTATION_LABEL = "mutation-survivors";
/** Survivors listed in one issue or comment; the rest are counted. */
export const LIST_LIMIT = 40;

const SURVIVING = new Set(["Survived", "NoCoverage"]);
const KILLED = new Set(["Killed", "Timeout"]);

/** The module's score and its survivors, from a Stryker JSON report. */
export function summarize(report, module) {
  const entry =
    report.files?.[module] ??
    Object.entries(report.files ?? {}).find(([file]) => file.endsWith(`/${module}`))?.[1];
  if (!entry) throw new Error(`mutation-issues: the report has no entry for ${module}`);
  const mutants = entry.mutants ?? [];
  const survivors = mutants
    .filter((mutant) => SURVIVING.has(mutant.status))
    .sort(
      (a, b) =>
        a.location.start.line - b.location.start.line ||
        a.location.start.column - b.location.start.column,
    );
  const killed = mutants.filter((mutant) => KILLED.has(mutant.status)).length;
  const valid = killed + survivors.length;
  return {
    module,
    total: mutants.length,
    killed,
    survivors,
    score: valid === 0 ? 100 : Math.round((1000 * killed) / valid) / 10,
  };
}

/** One survivor as a list line; the replacement is flattened and stripped of backticks. */
export function survivorLine(mutant) {
  const replacement = String(mutant.replacement ?? "")
    .replace(/\s+/g, " ")
    .replaceAll("`", "'")
    .slice(0, 80);
  const where = `L${mutant.location.start.line}:${mutant.location.start.column}`;
  const why = mutant.status === "NoCoverage" ? " (no test runs this line)" : "";
  return `- ${where} ${mutant.mutatorName} → \`${replacement}\`${why}`;
}

export function survivorList(summary) {
  const lines = summary.survivors.slice(0, LIST_LIMIT).map(survivorLine);
  const more = summary.survivors.length - LIST_LIMIT;
  if (more > 0) lines.push(`- …and ${more} more in the run's \`mutation-report\` artifact.`);
  return lines.join("\n");
}

export const issueTitle = (module) => `Kill the surviving mutants in ${module}`;

/** The test file beside a module, which is the first place a killing assertion goes. */
export const testFileFor = (module) => module.replace(/\.tsx?$/, (ext) => `.test${ext}`);

function headline(summary, runUrl) {
  return `The weekly mutation run (${runUrl}) made ${summary.total} mutants of \`${summary.module}\`: ${summary.killed} were caught by a test and ${summary.survivors.length} were not, a mutation score of ${summary.score}%. Each survivor below is a change to the code (an operator, a condition, a literal) that every test still passed, so it names a behaviour no assertion pins.`;
}

/** The issue body, with the survivor list when the guard accepts it and without it otherwise. */
export function issueBody(summary, runUrl) {
  const fields = (noticed) => ({
    kind: "risk",
    effort: "M",
    touches: [summary.module, testFileFor(summary.module)],
    noticed,
    why: "Mutation testing is a weekly trial on the pure safety modules, off the pull-request path, so nothing failed when these survivors appeared. Some survivors are equivalent mutants (a change that cannot alter behaviour) and need a reader to say so rather than a test.",
    proposed: `For each survivor, add an assertion to \`${testFileFor(summary.module)}\` that fails with the mutation applied, naming the behaviour rather than the line. Where a survivor is equivalent, say so in a comment here. Do not delete code only to remove a survivor unless the branch is truly dead.`,
    prompt: `Read this issue's newest survivor list, then \`${summary.module}\` and \`${testFileFor(summary.module)}\`. For each survivor (a line, a mutator and its replacement), write the smallest test that fails when that replacement is applied by hand and passes on the real code; group them by the behaviour they pin. Check each by applying the mutation locally, running \`pnpm test ${testFileFor(summary.module)}\`, and reverting it. Then run \`pnpm test:mutation --mutate ${summary.module}\` to confirm the survivors are gone, plus \`pnpm lint\` and \`pnpm typecheck\`. List any equivalent mutants in the PR. Close this issue in the PR that lands the tests.`,
  });
  const full = renderFollowUpBody(
    fields(`${headline(summary, runUrl)}\n\n${survivorList(summary)}`),
  );
  const title = issueTitle(summary.module);
  if (findIssueProblems({ number: 0, title, body: full }).problems.length === 0) {
    return { body: full, listed: true };
  }
  const bare = renderFollowUpBody(
    fields(`${headline(summary, runUrl)}\n\nThe list is in the first comment.`),
  );
  const problems = findIssueProblems({ number: 0, title, body: bare }).problems;
  if (problems.length > 0) {
    throw new Error(
      `mutation-issues: the issue body fails check:follow-ups:\n${problems.join("\n")}`,
    );
  }
  return { body: bare, listed: false };
}

/** Opens, comments on or closes the module's issue. Returns `opened`, `commented`, `closed` or `nothing`. */
export function reconcileMutationIssue({ summary, runUrl, tracker, dryRun = false, log }) {
  const title = issueTitle(summary.module);
  const open = tracker.listIssues({ label: MUTATION_LABEL }).find((issue) => issue.title === title);
  if (summary.survivors.length === 0) {
    if (!open) return "nothing";
    tracker.comment(open.number, `No survivors in ${runUrl} (score ${summary.score}%). Closing.`, {
      dryRun,
    });
    tracker.closeIssue(open.number, { reason: "completed" }, { dryRun });
    log(`mutation-issues: closed #${open.number}.`);
    return "closed";
  }
  const weekly = `${headline(summary, runUrl)}\n\n${survivorList(summary)}`;
  if (open) {
    tracker.comment(open.number, weekly, { dryRun });
    log(`mutation-issues: commented on #${open.number}.`);
    return "commented";
  }
  const { body, listed } = issueBody(summary, runUrl);
  const created = tracker.createIssue(
    { title, body, labels: [TRIAGE_LABEL, MUTATION_LABEL] },
    { dryRun },
  );
  if (!listed && created) tracker.comment(created.number, weekly, { dryRun });
  log(`mutation-issues: opened ${created ? `#${created.number}` : "(dry run)"}.`);
  return "opened";
}

export function parseMutationArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--report") args.report = argv[++i];
    else if (flag === "--module") args.module = argv[++i];
    else if (flag === "--run-url") args.runUrl = argv[++i];
    else throw new Error(`mutation-issues: unknown argument ${flag}`);
  }
  if (!args.report) throw new Error("mutation-issues: --report <stryker json> is required");
  if (!/^src\/[\w./-]+\.tsx?$/.test(args.module ?? "")) {
    throw new Error("mutation-issues: --module must be a src/ path such as src/lib/readiness.ts");
  }
  if (!/^https:\/\/\S+$/.test(args.runUrl ?? "")) {
    throw new Error("mutation-issues: --run-url must be the run's https URL");
  }
  return args;
}

function main() {
  const args = parseMutationArgs(process.argv.slice(2));
  const summary = summarize(JSON.parse(readFileSync(args.report, "utf8")), args.module);
  console.log(
    `mutation-issues: ${summary.module}: score ${summary.score}%, ${summary.survivors.length} survivor(s) of ${summary.total}.`,
  );
  reconcileMutationIssue({
    summary,
    runUrl: args.runUrl,
    tracker: defaultTracker(),
    dryRun: args.dryRun,
    log: console.log,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
