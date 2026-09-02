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
 * 1. **The pull-request base is resolved by ref, never by `base.sha`.** The
 *    whole point; `base.sha` reintroduces the bug verbatim.
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

  if (step.includes("pull_request.base.sha")) {
    violations.push(
      "it reads `github.event.pull_request.base.sha`. That is the base as recorded when the pull request was opened; it never advances, so once main moves the three-dot diff lists main's own files as this branch's. Resolve the base by ref instead (`github.event.pull_request.base.ref`).",
    );
  }

  if (!step.includes("pull_request.base.ref")) {
    violations.push(
      "it never mentions `github.event.pull_request.base.ref`, so it is not resolving the pull-request base against the live branch.",
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
    "ci-change-detection: the pull-request base resolves by ref, the push path keeps `before`, and every range is three-dot",
  );
}
