import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * The `changes` job in `.github/workflows/ci.yml` decides whether a pull
 * request touched code or the database surface, and everything expensive is
 * gated on its answer. This pins how it asks.
 *
 * **Why it needs a guard at all.** The failure is silent and the job stays
 * green either way. Until 2026-09-02 the diff ran
 * `github.event.pull_request.base.sha...HEAD`, under a comment claiming
 * "what this branch changed, not what main did underneath it". That holds only
 * while main has not moved: on a `pull_request` event `actions/checkout` gives
 * the job `refs/pull/N/merge`, which already contains everything main merged
 * since the pull request was opened, while `base.sha` is the base *as recorded
 * when it was opened* and never advances. `base.sha` is therefore an ancestor
 * of HEAD, `merge-base(base.sha, HEAD) == base.sha`, and the three-dot form
 * degenerates into listing main's own new files as the branch's.
 *
 * Nobody sees that as a failure — it fails *open*, so the only symptom is that
 * a docs-only push runs the whole gate. On #1291 (two lines under
 * `docs/design/canvases/`) it answered `code=true` and `db=true` after #1287
 * and #1293 merged, spending the build, four Playwright shards, four visual
 * shards, reg-suit and real-postgres, and charging 196 changed and 8 new
 * surfaces to a pull request that cannot move a pixel (issue #1295).
 *
 * Three properties, each of which was a trap on the way in:
 *
 * 1. **Both ends of a pull request's range come from the run's event**
 *    (`base.sha`, `head.sha`), never the live base branch (issue #3259: a PR merged
 *    mid-run, the live ref contained its head, the range was empty and a code change read as
 *    docs-only) and never the checked-out `HEAD`, the merge commit (issue #1295). The three-dot
 *    form from the recorded base to the PR head is the fork point to the head whatever main did.
 * 2. **The push-to-main path still diffs from `github.event.before`.**
 *    Collapsing both events into one range makes `origin/main...github.sha`
 *    empty on a push, so nothing runs, main publishes no visual baseline, and
 *    every branch cut from that commit resolves none — issue #1277's failure.
 * 3. **Three dots, not two.** A two-dot range reports every file main added
 *    since the fork as a deletion, which `--name-only` lists identically: the
 *    same false positive in a new costume.
 *
 * The shallow-fetch trap is not checkable here and is written at the call site
 * instead: the step's checkout already ran `fetch-depth: 0`, so a `--depth=1`
 * fetch of the base ref would graft a shallow boundary on and make `merge-base`
 * compute against truncated history.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/ci.yml";

/** The `filter` step of the `changes` job — the block every rule below reads. */
export function filterStep(contents) {
  const start = contents.indexOf("      - id: filter\n");
  if (start === -1) return null;
  // The next step at the same indentation, or the next job.
  const rest = contents.slice(start + 1);
  const end = rest.search(/\n {6}- (?:id|name|uses):|\n {2}\w[\w-]*:\n/);
  return end === -1 ? contents.slice(start) : rest.slice(0, end + 1);
}

export function findCiChangeDetectionViolations(contents) {
  const violations = [];
  const step = filterStep(contents);

  if (step === null) {
    return [
      `the \`changes\` job has no \`- id: filter\` step in ${WORKFLOW}. If it was renamed, rename it here too — this guard cannot check a step it cannot find.`,
    ];
  }

  if (!step.includes("pull_request.base.sha") || !step.includes("pull_request.head.sha")) {
    violations.push(
      "it does not pin both ends of a pull request's range to this run's event (`github.event.pull_request.base.sha` and `.head.sha`). Anything live can move mid-run: a PR that merges while detection runs makes the live base contain the PR head, the range comes out empty, and a code change classifies as docs-only (issue #3259).",
    );
  }

  if (step.includes("pull_request.base.ref") || /origin\/\$\{?BASE_REF/.test(step)) {
    violations.push(
      "it resolves the pull-request base through the live base branch (`pull_request.base.ref` / `origin/${BASE_REF}`). That ref advances during the run and can come to contain the PR head, which empties the range (issue #3259). Use `github.event.pull_request.base.sha`.",
    );
  }

  if (!step.includes("github.event.before")) {
    violations.push(
      "it never mentions `github.event.before`, so a push to main has no range of its own. `origin/main...github.sha` is empty on a push: nothing would run, main would publish no visual baseline, and every branch cut from that commit would resolve none (issue #1277).",
    );
  }

  const ranges = [...step.matchAll(/git diff --name-only "([^"]+)"/g)].map((m) => m[1]);
  if (ranges.length === 0) {
    violations.push('it runs no `git diff --name-only "<range>"`, so it decides nothing.');
  }
  for (const range of ranges) {
    if (/\.\.\.HEAD$/.test(range)) {
      violations.push(
        `the range \`${range}\` ends at the checked-out HEAD, which on a pull request is \`refs/pull/N/merge\` and already holds everything main merged since the PR opened: main's files get listed as the branch's (issue #1295). End at \`github.event.pull_request.head.sha\`.`,
      );
    }
    if (!range.includes("...")) {
      violations.push(
        `the range \`${range}\` is not three-dot. Two dots report every file main added since the fork as a deletion, which \`--name-only\` lists just the same.`,
      );
    }
  }

  return violations;
}

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contents = await readFile(path.join(ROOT, WORKFLOW), "utf8");
  const violations = findCiChangeDetectionViolations(contents);

  if (violations.length > 0) {
    console.error(`${WORKFLOW}'s change detection asks the wrong question:`);
    console.error(violations.map((v) => `- ${v}`).join("\n"));
    console.error(
      "\nThis fails *open*, so nothing goes red — the symptom is a docs-only pull request spending the build, eight Playwright and visual shards, reg-suit and real-postgres, and a reviewer accounting for visual diffs that are main's (issue #1295). See scripts/check-ci-change-detection.mjs.",
    );
    process.exit(1);
  }

  console.log(
    "ci-change-detection: a pull request is diffed between the event-pinned base and head shas, the push path keeps `before`, and every range is three-dot",
  );
}
