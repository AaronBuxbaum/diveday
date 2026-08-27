import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * A stack's middle layers skip the expensive half of CI, and every job in
 * `.github/workflows/ci.yml` says which half it is in.
 *
 * A stacked pull request is an ordered chain, every layer pays the whole gate
 * below, and merging is bottom-up — so a middle layer's run answers a question
 * nobody asks: it lands only inside a group the bottom's run or the top's has
 * already spoken for, and the cascading rebase runs it in full the moment it
 * *becomes* the bottom. So its expensive jobs do not run at all, gated on
 * `github.event.pull_request.stack`, which GitHub puts in the event payload
 * (ADR 20260827-stack-ci-skips-the-middle-layers).
 *
 * Two things can rot, and neither goes red on its own:
 *
 * 1. **A condition that drifts.** The expression is repeated verbatim on every
 *    job that carries it, because a job-level `if:` cannot read a workflow-level
 *    `env:` — the `env` context is not available there, so there is nowhere to
 *    factor it to. Six hand-copied predicates is six chances for one to lose a
 *    clause, and a wrong one fails *quietly*: the job runs when it should not
 *    (a wasted runner, invisible) or skips when it should not (a layer merged
 *    without its gate, and GitHub reports a skipped job as **successful**, so
 *    no check goes red either way). Byte-identical is the only version of this
 *    rule a text search can hold.
 *
 * 2. **A new job classified by accident.** Every job must appear in exactly one
 *    of the two lists below, so adding one is a decision rather than a default.
 *    Left out, a new expensive job silently runs on every layer forever; added
 *    to the wrong list, it takes the visual pipeline down with it — which is the
 *    reason the second list is not merely "the cheap ones".
 *
 * `build`, `visual` and `visual-report` are in `RUNS_ON_EVERY_LAYER` and that is
 * load bearing: a stacked layer's reg-suit baseline is the head commit of the
 * layer directly below it (`scripts/reg-suit-keys.mjs`) and its report polls S3
 * for that snapshot (`scripts/wait-for-baseline.mjs`). A middle layer that never
 * published one leaves the layer above timing out and reporting every surface as
 * new under a reassuring `Changed: 0` — the pipeline's documented worst failure,
 * and the one AGENTS.md forbids merging on.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/ci.yml";

/** The one spelling of "this layer is the bottom, the top, or not in a stack". */
export const STACK_CONDITION = `    if: >-
      github.event_name != 'schedule'
      && (github.event.pull_request.stack == null
      || github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref
      || github.event.pull_request.stack.position == github.event.pull_request.stack.size)`;

/** Jobs a middle layer skips. Each carries `STACK_CONDITION`, byte for byte. */
export const SKIPS_A_MIDDLE_LAYER = [
  "repo-safeguards",
  "lint",
  "typecheck",
  "unit-tests",
  "playwright",
  "db-surface-changes",
];

/** Jobs that run on every layer, and the reason each one has to. */
export const RUNS_ON_EVERY_LAYER = new Map([
  ["build", "`visual` needs it, and the visual path runs on every layer"],
  ["visual", "the layer above is keyed to this layer's published snapshot"],
  ["visual-report", "publishes the snapshot the layer above waits for"],
  [
    "real-postgres",
    "follows `db-surface-changes`: a skipped dependency leaves `outputs.changed` empty, which is not `'true'`",
  ],
]);

/** Every top-level job name in the workflow, in file order, with its block text. */
export function parseJobs(contents) {
  const lines = contents.split("\n");
  const start = lines.indexOf("jobs:");
  if (start < 0) return new Map();
  const jobs = new Map();
  let name = null;
  let from = 0;
  for (let i = start + 1; i < lines.length; i += 1) {
    const header = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(lines[i]);
    if (!header) continue;
    if (name) jobs.set(name, lines.slice(from, i).join("\n"));
    name = header[1];
    from = i;
  }
  if (name) jobs.set(name, lines.slice(from).join("\n"));
  return jobs;
}

/** Everything wrong with how `contents` classifies its jobs. */
export function findStackCiSkipViolations(contents) {
  const violations = [];
  const jobs = parseJobs(contents);

  for (const dead of ["needs: stack-priority", "scripts/stack-ci-priority.mjs"]) {
    if (contents.includes(dead)) {
      violations.push(
        `\`${dead}\` survives. The yield job it belonged to is gone — a middle layer skips now rather than waiting.`,
      );
    }
  }

  for (const job of SKIPS_A_MIDDLE_LAYER) {
    const block = jobs.get(job);
    if (block === undefined) {
      violations.push(
        `\`${job}\` is listed as skipping a middle layer but is not a job in ${WORKFLOW}.`,
      );
    } else if (!block.includes(STACK_CONDITION)) {
      violations.push(`\`${job}\` does not carry the stack condition, byte for byte.`);
    }
  }

  for (const [job, why] of RUNS_ON_EVERY_LAYER) {
    const block = jobs.get(job);
    if (block === undefined) {
      violations.push(
        `\`${job}\` is listed as running on every layer but is not a job in ${WORKFLOW}.`,
      );
    } else if (block.includes(STACK_CONDITION)) {
      violations.push(`\`${job}\` carries the stack condition and must not: ${why}.`);
    }
  }

  for (const job of jobs.keys()) {
    if (!SKIPS_A_MIDDLE_LAYER.includes(job) && !RUNS_ON_EVERY_LAYER.has(job)) {
      violations.push(
        `\`${job}\` is in neither list. Decide whether a stack's middle layer should skip it, and say so in scripts/check-stack-ci-skip.mjs.`,
      );
    }
  }

  return violations;
}

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contents = await readFile(path.join(ROOT, WORKFLOW), "utf8");
  const violations = findStackCiSkipViolations(contents);

  if (violations.length > 0) {
    console.error(
      `${WORKFLOW} disagrees with itself about which jobs a stack's middle layer skips:`,
    );
    console.error(violations.map((v) => `- ${v}`).join("\n"));
    console.error(
      "\nThe condition is repeated verbatim because a job-level `if:` cannot read a workflow-level `env:`. Copy it exactly from STACK_CONDITION in scripts/check-stack-ci-skip.mjs:",
    );
    console.error(`\n${STACK_CONDITION}\n`);
    console.error(
      "Never put it on `build`, `visual` or `visual-report`: the layer above is keyed to this layer's published snapshot, so a middle layer that skips them leaves the top reporting every surface as new (ADR 20260827-stack-ci-skips-the-middle-layers).",
    );
    process.exit(1);
  }

  console.log(
    `stack-ci-skip: ${SKIPS_A_MIDDLE_LAYER.length} jobs a middle layer skips, ${RUNS_ON_EVERY_LAYER.size} that run on every layer`,
  );
}
