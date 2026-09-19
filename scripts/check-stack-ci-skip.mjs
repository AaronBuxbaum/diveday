import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * A stack's middle layers skip CI entirely, and every job in
 * `.github/workflows/ci.yml` says how it arrives at that.
 *
 * A stacked pull request is an ordered chain, every layer pays the whole gate
 * below, and merging is bottom-up — so a middle layer's run answers a question
 * nobody asks: it lands only inside a group the bottom's run or the top's has
 * already spoken for, and the cascading rebase runs it in full the moment it
 * *becomes* the bottom. So it runs nothing, gated on
 * `github.event.pull_request.stack`, which GitHub puts in the event payload
 * (ADR 20260919-stack-ci-cancels-superseded-layers).
 *
 * There are two ways a job gets there, and each is a list below:
 *
 * 1. **It carries the condition itself.** The expression is repeated verbatim,
 *    because a job-level `if:` cannot read a workflow-level `env:` — the `env`
 *    context is not available there, so there is nowhere to factor it to. Each
 *    hand-copied predicate is a chance for one to lose a clause, and a wrong
 *    one fails *quietly*: the job runs when it should not (a wasted runner,
 *    invisible) or skips when it should not (a layer merged without its gate,
 *    and GitHub reports a skipped job as **successful**, so no check goes red
 *    either way). Byte-identical is the only version of this rule a text search
 *    can hold.
 *
 * 2. **It reaches `changes` through `needs:`.** `changes` carries the
 *    condition, and a skipped dependency skips its dependents by propagation,
 *    so `build`, `visual`, `visual-report` and `real-postgres` state the
 *    question once rather than five times. This guard walks the `needs:` graph
 *    and fails if one of them stops reaching `changes` — a job quietly
 *    re-rooted onto something else would start running on every layer again,
 *    and nothing else would say so.
 *
 * Every job must appear in exactly one list, so adding one is a decision rather
 * than a default. Left out, a new expensive job silently runs on every layer
 * forever.
 *
 * **What changed on 2026-09-19.** `build`, `visual` and `visual-report` used to
 * be exempt outright, and that exemption was load bearing: a stacked layer's
 * reg-suit baseline was the head commit of the layer directly below it, so a
 * middle layer that published no snapshot left the layer above timing out and
 * reporting every surface as new. Every layer is keyed to the stack's fork
 * point from the default branch now (`scripts/reg-suit-keys.mjs`), which the
 * default branch's own run published long ago, so no layer waits on another and
 * the exemption is gone with the reason for it.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/ci.yml";

/** The one spelling of "this layer is the bottom, the top, or not in a stack". */
export const STACK_CONDITION = `    if: >-
      github.event_name != 'schedule'
      && (github.event.pull_request.stack == null
      || github.event.pull_request.stack.base.ref == github.event.pull_request.base.ref
      || github.event.pull_request.stack.position == github.event.pull_request.stack.size)`;

/** The job every propagating job must reach, and the only one whose skip is load bearing. */
export const ROOT_JOB = "changes";

/** Jobs that decide for themselves. Each carries `STACK_CONDITION`, byte for byte. */
export const CARRIES_THE_CONDITION = [
  ROOT_JOB,
  "repo-safeguards",
  "lint",
  "typecheck",
  "unit-tests",
  "playwright",
];

/** Jobs that skip because `changes` did, and the `needs:` edge each one rides. */
export const SKIPS_BY_PROPAGATION = new Map([
  ["build", "needs `changes` for its `code` output"],
  ["visual", "needs `build`, which needs `changes`"],
  ["visual-report", "needs `visual` and `changes`"],
  ["real-postgres", "needs `changes` for its `db` output"],
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

/**
 * The jobs one job declares in `needs:`, in either spelling GitHub accepts —
 * `needs: build` and `needs: [visual, changes]`.
 */
export function directNeeds(block) {
  const line = /^ {4}needs:\s*(.+)$/m.exec(block ?? "");
  if (!line) return [];
  const value = line[1].trim();
  const inner = value.startsWith("[") ? value.replace(/^\[|\]$/g, "") : value;
  return inner
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Whether `job` reaches `ROOT_JOB` by any chain of `needs:` edges. */
export function reachesRoot(job, jobs, seen = new Set()) {
  for (const next of directNeeds(jobs.get(job))) {
    if (next === ROOT_JOB) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    if (reachesRoot(next, jobs, seen)) return true;
  }
  return false;
}

/** Everything wrong with how `contents` classifies its jobs. */
export function findStackCiSkipViolations(contents) {
  const violations = [];
  const jobs = parseJobs(contents);

  for (const dead of ["needs: stack-priority", "scripts/stack-ci-priority.mjs", "middle_layer"]) {
    if (contents.includes(dead)) {
      violations.push(
        `\`${dead}\` survives. A middle layer now skips \`${ROOT_JOB}\` itself, so every expensive job skips by propagation and none of them reads a separate answer.`,
      );
    }
  }

  for (const job of CARRIES_THE_CONDITION) {
    const block = jobs.get(job);
    if (block === undefined) {
      violations.push(
        `\`${job}\` is listed as carrying the stack condition but is not a job in ${WORKFLOW}.`,
      );
    } else if (!block.includes(STACK_CONDITION)) {
      violations.push(`\`${job}\` does not carry the stack condition, byte for byte.`);
    }
  }

  for (const [job, edge] of SKIPS_BY_PROPAGATION) {
    const block = jobs.get(job);
    if (block === undefined) {
      violations.push(
        `\`${job}\` is listed as skipping by propagation but is not a job in ${WORKFLOW}.`,
      );
    } else if (!reachesRoot(job, jobs)) {
      violations.push(
        `\`${job}\` no longer reaches \`${ROOT_JOB}\` through \`needs:\` (it ${edge}), so a middle layer would run it.`,
      );
    }
  }

  for (const job of jobs.keys()) {
    if (!CARRIES_THE_CONDITION.includes(job) && !SKIPS_BY_PROPAGATION.has(job)) {
      violations.push(
        `\`${job}\` is in neither list. Decide whether a stack's middle layer should skip it by carrying the condition or by depending on \`${ROOT_JOB}\`, and say so in scripts/check-stack-ci-skip.mjs.`,
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
      `A job that does not carry it must reach \`${ROOT_JOB}\` through \`needs:\` instead, so it skips by propagation (ADR 20260919-stack-ci-cancels-superseded-layers).`,
    );
    process.exit(1);
  }

  console.log(
    `stack-ci-skip: ${CARRIES_THE_CONDITION.length} jobs carry the stack condition, ${SKIPS_BY_PROPAGATION.size} skip by propagation`,
  );
}
