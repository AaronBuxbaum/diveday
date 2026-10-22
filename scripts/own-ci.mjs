// What CI last said about this branch itself, for `pnpm verify:push` (scripts/verify-push.mjs).
//
// `base-ci.mjs` replays the layer below's red tests; nothing replayed the branch's own. A push
// meant to fix a red run went out with only `verify:push --quick` behind it, which runs no
// browser at all, so whether the fix worked was learned from the next CI run, about 22 minutes
// later (2026-10-22 review of 2026-10-16 to 10-22: 37 pushes followed a red run on the same PR;
// 18 were red again, and 14 of those were still red on a test the run before had already named).
//
// So before stamping, the gate reads the branch's latest completed CI run. When it is red, the
// unit files, Playwright spec files and visual captures it names run here too, and the stamp
// says they passed:
//
//   - Unit shards: the files `src/test/failed-files-reporter.ts` annotates.
//   - Playwright shards and visual capture shards: the tests the "Playwright Run Summary" notice
//     lists (`[chromium] › e2e/<file>:<line>:<col> › <title path>`). A Playwright failure is
//     replayed as its whole spec file; a capture by its title, in light mode (a capture that
//     fails is a locator or a timeout, not a pixel difference: reg-suit compares pixels).
//   - Lint, Typecheck and Repository safeguards run here anyway. reg-suit, the aggregate
//     "CI result" and the other bookkeeping jobs are not a test verdict.
//
// It never refuses: a red job that names nothing is a line telling the author to read its log.
// Anything this cannot read (no `gh`, no network, a detached HEAD) fails open with a line saying
// so, like `base-ci.mjs`.

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Jobs answered by the gate's own static steps. */
const COVERED_LOCALLY = /^(?:Lint|Typecheck|Repository safeguards)$/;

/** Jobs that are not a test verdict. Visual capture is one here: its failures are functional. */
const NOT_A_VERDICT =
  /^(?:reg-suit|CI result|Plan the visual|Deploy a preview|Resolve the head|Detect what changed|cdk )/;

const PR_EVENTS = new Set(["push", "pull_request"]);
const UNIT_FILE = /\.test\.(?:ts|tsx|mts|mjs|js)$/;
const SPEC_FILE = /^e2e\/.+\.spec\.ts$/;
const VISUAL_JOB = /^Visual capture/;
const SUMMARY_LINE = /\[[\w-]+\] › (e2e\/[^\s:]+\.ts):\d+:\d+ › (.+)$/;

/**
 * The failed tests a "Playwright Run Summary" notice lists, as `{ file, title }`; `title` is the
 * last segment of the title path.
 */
export function summaryTests(message) {
  const tests = [];
  for (const line of (message ?? "").split("\n")) {
    const match = line.trim().match(SUMMARY_LINE);
    if (!match) continue;
    const path = match[2].split(" › ").map((piece) => piece.trim());
    tests.push({ file: match[1], title: path[path.length - 1] });
  }
  return tests;
}

/**
 * A capture title as the light-mode test carries it. The dark twin is the same test under
 * another `describe`, and `captureGrep` runs light mode only.
 */
export function lightTitle(title) {
  return title.replace(/ \(dark\)$/, " (light)");
}

/**
 * The branch's verdict from its run's jobs and, for each red one, its annotations
 * (`annotationsOf(job)` → `[{ path, annotation_level, title, message }]`).
 *
 * `{ red, files, specs, captures, unnamed }`: `red` the failed job names, `files` the unit
 * files, `specs` the Playwright spec files, `captures` the visual capture titles, and
 * `unnamed` the red jobs that name nothing this gate can run.
 */
export function ownVerdict(jobs, annotationsOf) {
  const red = [];
  const files = new Set();
  const specs = new Set();
  const captures = new Set();
  const unnamed = [];
  for (const job of jobs) {
    if (job.conclusion !== "failure" && job.conclusion !== "timed_out")
      continue;
    if (NOT_A_VERDICT.test(job.name)) continue;
    red.push(job.name);
    if (COVERED_LOCALLY.test(job.name)) continue;
    let named = false;
    for (const note of annotationsOf(job) ?? []) {
      if (
        note.annotation_level === "failure" &&
        UNIT_FILE.test(note.path ?? "")
      ) {
        files.add(note.path);
        named = true;
      } else if (
        note.annotation_level === "failure" &&
        SPEC_FILE.test(note.path ?? "")
      ) {
        if (VISUAL_JOB.test(job.name)) continue;
        specs.add(note.path);
        named = true;
      } else if (/Playwright Run Summary/.test(note.title ?? "")) {
        for (const test of summaryTests(note.message)) {
          if (VISUAL_JOB.test(job.name)) captures.add(lightTitle(test.title));
          else if (SPEC_FILE.test(test.file)) specs.add(test.file);
          else continue;
          named = true;
        }
      }
    }
    if (!named) unnamed.push(job.name);
  }
  return {
    red: red.sort(),
    files: [...files].sort(),
    specs: [...specs].sort(),
    captures: [...captures].sort(),
    unnamed: unnamed.sort(),
  };
}

function ghJson(args) {
  const out = readBounded("gh", ["api", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
  });
  return JSON.parse(out);
}

/**
 * Reads the verdict of `branch`'s latest completed CI run, or `{ unknown: "<why>" }`. A green
 * run is `{ green: true, sha }`; a red one adds `sha` and `url` to {@link ownVerdict}'s fields.
 * `gh` is injectable for the tests.
 */
export function readOwnVerdict(branch, { repo, gh = ghJson } = {}) {
  if (!repo || !branch)
    return { unknown: "no GitHub repository or branch to ask about" };
  try {
    const listed = gh([
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=20`,
    ]);
    const done = (listed.workflow_runs ?? []).filter(
      (run) =>
        PR_EVENTS.has(run.event) &&
        run.status === "completed" &&
        (run.conclusion === "success" || run.conclusion === "failure"),
    );
    if (done.length === 0)
      return { unknown: `no finished CI run on ${branch} yet` };
    const latest = done.reduce((a, b) => (b.created_at > a.created_at ? b : a));
    const sha = latest.head_sha;
    if (latest.conclusion === "success") return { green: true, sha };
    const jobs =
      gh([`repos/${repo}/actions/runs/${latest.id}/jobs?per_page=100`]).jobs ??
      [];
    return {
      sha,
      url: latest.html_url,
      ...ownVerdict(jobs, (job) =>
        gh([`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`]),
      ),
    };
  } catch (error) {
    return {
      unknown: `could not read CI for ${branch} (${error.message.split("\n")[0]})`,
    };
  }
}

/**
 * What the gate does about the branch's own last run: `{ files, specs, captures, lines }`.
 * Never a refusal; the files, specs and captures join the run, so a stamp means they passed.
 */
export function ownDecision(verdict, { branch, head }) {
  const none = { files: [], specs: [], captures: [] };
  if (verdict.unknown)
    return { ...none, lines: [`own CI: unknown (${verdict.unknown}).`] };
  if (verdict.green) {
    return {
      ...none,
      lines: [
        `own CI: ${branch}'s last run (${verdict.sha.slice(0, 9)}) is green.`,
      ],
    };
  }
  const same = verdict.sha === head ? ", on this very commit" : "";
  const lines = [
    `own CI: ${branch}'s last run (${verdict.sha.slice(0, 9)}${same}) is red on ` +
      `${verdict.red.join(", ") || "jobs this gate does not answer for"}. What it names runs ` +
      "here, so this push is checked against the failures it is meant to fix.",
  ];
  const named = [...verdict.files, ...verdict.specs];
  if (named.length > 0) lines.push(`  re-run here: ${named.join(" ")}`);
  if (verdict.captures.length > 0)
    lines.push(
      `  captures re-run here (light mode): ${verdict.captures.join("; ")}`,
    );
  if (verdict.unnamed.length > 0)
    lines.push(
      `  ${verdict.unnamed.join(", ")} named no test; read its log (the GitHub MCP's ` +
        `get_job_logs) before pushing: ${verdict.url ?? ""}`.trimEnd(),
    );
  return {
    files: verdict.files,
    specs: verdict.specs,
    captures: verdict.captures,
    lines,
  };
}
