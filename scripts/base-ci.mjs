// What CI says about the layer below, for `pnpm verify:push` (scripts/verify-push.mjs).
//
// A layer pushed on a red base is a red CI run for that layer and for every layer above it, and
// each of those layers then pushes again to merge the fix (2026-10-14: main went red at
// d5014c5f1 and every open layer that merged it inherited lint and two unit shards; #2594 then
// pushed past the gate on "it's red on main, not mine"). So before stamping, the gate reads the
// base's latest CI. When it is red, the push is stamped only if this layer makes the base's
// failures pass here:
//
//   - Lint, Typecheck and Repository safeguards: the gate runs all three anyway, so a green run
//     here is the carried fix.
//   - Unit and Playwright jobs: the test files their annotations name (unit shards annotate
//     each failed file through src/test/failed-files-reporter.ts; Playwright annotates each
//     failed spec) are added to the run.
//   - A red job that names no file: refused, until the author reads its log and names the
//     files with `--base-red <file…>`, which then must pass here too.
//
// Visual capture and reg-suit are left out: a visual difference is approved by the push that
// explains it (visual-triage skill), not by a test that passes. A base still running is a note,
// not a refusal. Anything this cannot read (no `gh`, no network, a commit GitHub does not have)
// fails open with a line saying so: the gate is a convenience over CI, never a lock on the
// author's own work.

import process from "node:process";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Red jobs the gate's own steps answer for: green here is the fix carried. */
export const COVERED_LOCALLY = /^(?:Lint|Typecheck|Repository safeguards)$/;

/**
 * Jobs that are not a test verdict, or are approved by a push rather than passed. "CI result" is
 * the aggregate of every other job (ci.yml, since 2026-10-13): red whenever any of them is, and
 * naming no file, it made every red base a refusal that only `--base-red` got past.
 */
export const NOT_A_VERDICT =
  /^(?:CI result|Visual capture|reg-suit|Plan the visual|Deploy a preview|Resolve the head|Detect what changed|cdk )/;

/**
 * The events a pull request's own CI runs on. A run the base got any other way (a schedule, a
 * Run workflow button: CodeQL, Simulate a day, Follow-ups) never runs on a PR, so its red is
 * not a verdict this layer inherits: a malformed issue or a repository setting turned main red
 * on 2026-10-15 with nothing a commit could fix.
 */
export const PR_EVENTS = new Set(["push", "pull_request"]);

const UNIT_FILE = /\.test\.(?:ts|tsx|mts|mjs|js)$/;
const SPEC_FILE = /^e2e\/.+\.spec\.ts$/;

/** `owner/name` from a GitHub remote URL, or null. */
export function repoSlug(url) {
  const match = (url ?? "").match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * The latest run of each GitHub Actions check on a commit: a re-run leaves the earlier attempt
 * listed beside it, and only the newest one is the commit's answer.
 */
export function latestRuns(checkRuns) {
  const byName = new Map();
  for (const run of checkRuns) {
    if (run.app?.slug && run.app.slug !== "github-actions") continue;
    const seen = byName.get(run.name);
    if (!seen || run.id > seen.id) byName.set(run.name, run);
  }
  return [...byName.values()];
}

/**
 * The base's verdict from its check runs and, for each red one, its failure annotations
 * (`annotationsOf(run)` → `[{ path, annotation_level }]`).
 *
 * `{ red, pending, files, specs, unnamed }`: `red` the failed job names, `pending` the ones
 * still running, `files` and `specs` the unit and Playwright files the red jobs name, and
 * `unnamed` the red jobs that name no file and that no local step answers for.
 */
export function baseVerdict(checkRuns, annotationsOf) {
  const red = [];
  const pending = [];
  const files = new Set();
  const specs = new Set();
  const unnamed = [];
  for (const run of latestRuns(checkRuns)) {
    if (NOT_A_VERDICT.test(run.name)) continue;
    if (run.status !== "completed") {
      pending.push(run.name);
      continue;
    }
    if (run.conclusion !== "failure" && run.conclusion !== "timed_out") continue;
    red.push(run.name);
    if (COVERED_LOCALLY.test(run.name)) continue;
    let named = false;
    for (const note of annotationsOf(run) ?? []) {
      if (note.annotation_level !== "failure") continue;
      if (UNIT_FILE.test(note.path)) {
        files.add(note.path);
        named = true;
      } else if (SPEC_FILE.test(note.path)) {
        specs.add(note.path);
        named = true;
      }
    }
    if (!named) unnamed.push(run.name);
  }
  return {
    red: red.sort(),
    pending: pending.sort(),
    files: [...files].sort(),
    specs: [...specs].sort(),
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
 * Reads the verdict for `sha` from GitHub, or `{ unknown: "<why>" }` when it cannot. `gh` is
 * injectable for the tests.
 */
export function readBaseVerdict(sha, { repo, gh = ghJson } = {}) {
  if (!repo || !/^[0-9a-f]{7,64}$/.test(sha ?? "")) {
    return { unknown: "no GitHub repository or base commit to ask about" };
  }
  try {
    const listed = gh([`repos/${repo}/commits/${sha}/check-runs?per_page=100`]);
    const all = listed.check_runs ?? [];
    if (all.length === 0) return { unknown: `GitHub has no CI run for ${sha.slice(0, 9)} yet` };
    // The runs endpoint matches only a full sha; the check runs carry it.
    const full = all[0].head_sha ?? sha;
    const workflows = gh([`repos/${repo}/actions/runs?head_sha=${full}&per_page=100`]);
    const offPr = new Set(
      (workflows.workflow_runs ?? [])
        .filter((workflow) => !PR_EVENTS.has(workflow.event))
        .map((workflow) => workflow.check_suite_id),
    );
    const runs = all.filter((run) => !offPr.has(run.check_suite?.id));
    return baseVerdict(runs, (run) => gh([`repos/${repo}/check-runs/${run.id}/annotations`]));
  } catch (error) {
    return {
      unknown: `could not read CI for ${sha.slice(0, 9)} (${error.message.split("\n")[0]})`,
    };
  }
}

/**
 * What the gate does about the base: `{ refuse, files, specs, lines }`. `refuse` is the message
 * when the base is red on a job that names no file and the author named none (`extra`); the
 * files and specs are added to the run either way, so a stamp means they passed here.
 */
export function baseDecision(verdict, { base, extra = [] }) {
  const unsupported = extra.filter((file) => !UNIT_FILE.test(file) && !SPEC_FILE.test(file));
  if (unsupported.length > 0) {
    return {
      refuse: `unsupported --base-red input: ${unsupported.map((file) => JSON.stringify(file)).join(" ")}. Name whole unit test files or e2e/*.spec.ts files; line selectors are not supported.`,
      files: [],
      specs: [],
      lines: [],
    };
  }
  if (verdict.unknown) {
    return {
      refuse: null,
      files: [],
      specs: [],
      lines: [`base CI: unknown (${verdict.unknown}).`],
    };
  }
  const files = [...new Set([...verdict.files, ...extra.filter((f) => UNIT_FILE.test(f))])].sort();
  const specs = [...new Set([...verdict.specs, ...extra.filter((f) => SPEC_FILE.test(f))])].sort();
  const lines = [];
  if (verdict.pending.length > 0) {
    lines.push(
      `base CI: ${base} is still running ${verdict.pending.length} job(s); if it goes red, ` +
        "this layer is red with it — read it again before you merge it a second time.",
    );
  }
  if (verdict.red.length === 0) {
    if (verdict.pending.length === 0) lines.push(`base CI: ${base} is green.`);
    return { refuse: null, files, specs, lines };
  }
  lines.push(
    `base CI: ${base} is red on ${verdict.red.join(", ")}. This push is stamped only if those ` +
      "pass here, so the layer carries the fix instead of a second red run.",
  );
  if (files.length + specs.length > 0)
    lines.push(`  re-run here: ${[...files, ...specs].join(" ")}`);
  if (verdict.unnamed.length > 0 && extra.length === 0) {
    return {
      refuse:
        `the layer below (${base}) is red on ${verdict.unnamed.join(", ")}, and CI names no test ` +
        "file there this gate can re-run. Pushing on it is a red run for this layer and every " +
        "layer above. Read that job's log (the GitHub MCP's get_job_logs), then either fix it " +
        "in the layer that broke (its owner, through the coordinator) and merge it once green, " +
        "or carry the fix here and name the failing files so they run here too: " +
        "`pnpm verify:push --base-red <file…>`.",
      files,
      specs,
      lines,
    };
  }
  return { refuse: null, files, specs, lines };
}

/** The files after `--base-red` on the command line. */
export function baseRedArgs(argv = process.argv.slice(2)) {
  const at = argv.indexOf("--base-red");
  if (at === -1) return [];
  const rest = argv.slice(at + 1);
  const end = rest.findIndex((arg) => arg.startsWith("--"));
  const files = end === -1 ? rest : rest.slice(0, end);
  if (files.length === 0) throw new Error("--base-red requires at least one whole test-file path");
  return files;
}
