// One issue per red scheduled workflow, opened on the first red run, commented on each red run
// after it, and closed by the first green one (test review 2026-10-14, decision 5).
//
// The nightly one-day simulation failed 27 of 30 nights, four weeks in a row, and nobody was told:
// a scheduled run's failure email goes to whoever last edited the cron line, and nobody reads a
// workflow's run list. `durations-refresh` had run once, red. So each workflow here ends with this
// step, and its state lives where a human already looks: the issue tracker.
//
//   node scripts/workflow-alert.mjs --workflow simulate-day --outcome failure --run-url <url>
//   node scripts/workflow-alert.mjs --workflow simulate-day --outcome success --run-url <url>
//
// The issue is found by the `ci-red` label and its exact title, so a renamed issue stops being
// this workflow's alert rather than being edited by it. The body is a `needs-triage` follow-up in
// the shape docs/agents/issue-tracker.md requires and `pnpm check:follow-ups` scans daily — a
// malformed one reddens that scan for everyone — so it is composed by `renderFollowUpBody` and
// checked by `findIssueProblems` before it is filed, and refused when the check says no.
// `--dry-run` prints every request and sends none.

import process from "node:process";

import { findIssueProblems, LABEL as TRIAGE_LABEL } from "./check-follow-ups.mjs";
import { renderFollowUpBody } from "./file-follow-up.mjs";
import { tracker as defaultTracker } from "./tracker.mjs";

/** The label every alert issue carries, beside `needs-triage`. */
export const ALERT_LABEL = "ci-red";

/** The workflows that alert, keyed by their file name without `.yml`. */
export const ALERTS = {
  "mobile-behavior": {
    title: "Fix the nightly mobile behavior run, which is red on main",
    kind: "risk",
    effort: "S",
    touches: [
      ".github/workflows/mobile-behavior.yml",
      "e2e/mobile-behavior.spec.ts",
      "playwright.mobile.config.ts",
    ],
    noticed:
      "The scheduled mobile behavior run failed on main. Its touch Chromium and mobile WebKit journeys cover public booking, guardian waiver signing, navigation and offline manifest persistence and reconciliation. While it is red those mobile engine contracts are unverified. Each red run adds its evidence; the first green run closes this issue.",
    why: "The nightly lane found this outside a feature change. Read the trace to distinguish an application regression from a test that missed an intended flow change or a browser installation failure.",
    proposed:
      "Read the failing step and download mobile-behavior-evidence. Reproduce with the mobile config and fix the failing behavior or stale locator. Do not widen timeouts, add retries or replace touch events with clicks.",
    prompt:
      "The nightly mobile behavior lane is red. Read the newest run and mobile-behavior-evidence artifact, then docs/engineering/testing.md and e2e/mobile-behavior.spec.ts. Reproduce with E2E_WORKERS=1 pnpm exec playwright test --config playwright.mobile.config.ts after pnpm e2e:build. Fix the regression or intended-flow mismatch without retries or timeout increases. Done is both mobile projects passing, workflow alert tests, lint, typecheck and repo checks passing. Close this issue in the fix PR.",
  },
  "simulate-day": {
    title: "Fix the nightly one-day simulation, which is red on main",
    kind: "risk",
    effort: "M",
    touches: [".github/workflows/simulate-day.yml", "scripts/simulate-day/day.spec.ts"],
    noticed:
      "The scheduled `Simulate a day` workflow failed on main. It drives one fresh shop through a whole dive day against the production build (book, sign, check in, roll call, underway, home, close out, recap) and stops at the first state the day cannot reach. It is the only test of the whole day joining up, so while it is red nothing checks that the day still works end to end. Each red run after this one adds a comment with its link; the first green run closes this issue.",
    why: "It was found by the scheduled run, not by a change anyone was making. The cause is either a product regression in the state the run stopped at, or a copy or flow change the simulation was not updated for, and telling the two apart needs someone to read the run's transcript and screenshots.",
    proposed:
      "Download the failed run's `simulation` artifact and read `day.md`: it names every state reached and where the day stopped, with a screenshot of each. If the product is wrong, fix it with a regression test. If the product changed on purpose, update `scripts/simulate-day/day.spec.ts` to wait on the new role or heading. Do not widen a timeout or skip the state.",
    prompt:
      "The nightly one-day simulation (`.github/workflows/simulate-day.yml`, which runs `pnpm simulate:day --no-build` after `pnpm e2e:build`) is red on main. Read the newest failed run linked in this issue's body and comments: download its `simulation` artifact and read `day.md` and the last screenshot, then `simulation-test-results` for Playwright's trace. Read `scripts/simulate-day/day.spec.ts` and `docs/engineering/testing.md` first. Decide whether the stopped state is a product regression (fix it, starting with a failing regression test) or an intended change the spec missed (update the spec's wait to the new role or heading, never a longer timeout). Done is `pnpm e2e:build && pnpm simulate:day --no-build` completing locally, plus `pnpm lint`, `pnpm typecheck` and `pnpm check:repo`. Close this issue in the PR that lands the fix.",
  },
  "durations-refresh": {
    title: "Fix the weekly durations refresh, which is red on main",
    kind: "risk",
    effort: "S",
    touches: [
      ".github/workflows/durations-refresh.yml",
      "scripts/merge-test-durations.mjs",
      "scripts/e2e-durations.mjs",
    ],
    noticed:
      "The scheduled `Durations refresh` workflow failed. It folds the newest main CI run's measured durations into `scripts/test-durations.json` and `scripts/e2e-durations.json`, which the unit, Playwright and visual shards are dealt by. While it is red those files go stale and the shards drift apart, which shows up as one slow shard holding every pull request's CI. Each red run after this one adds a comment with its link; the first green run closes this issue.",
    why: "It was found by the scheduled run, not by a change anyone was making. The job reads other runs' artifacts and pushes to main, so it can fail for reasons outside this repository's code (an expired artifact, a refused push, a missing repository setting), and the run log is what says which.",
    proposed:
      "Read the failed run's log and find the failing step. If no main run carried all four unit-durations artifacts, find why the unit shards stopped uploading them in `.github/workflows/ci.yml`. If the push and the fallback pull request were both refused, name the repository setting in this issue for the owner. If a merge script threw, fix it with a test.",
    prompt:
      "The weekly durations refresh (`.github/workflows/durations-refresh.yml`) is red. Read the newest failed run linked in this issue's body and comments with `gh api repos/AaronBuxbaum/diveday/actions/runs/<id>/jobs` and its logs, and find the failing step. Read the workflow, `scripts/merge-test-durations.mjs` and `scripts/e2e-durations.mjs` first. A missing artifact is a `ci.yml` upload problem; a refused push needs the owner, so say which setting in a comment here; a script error is fixed with a failing test first. Done is a manual run of the workflow (its Run workflow button) going green, plus `pnpm lint`, `pnpm typecheck` and `pnpm check:repo` on the fix. Close this issue in the PR that lands the fix.",
  },
  "e2e-nightly": {
    title: "Fix the nightly quarantine and flake-hunt run, which is red on main",
    kind: "risk",
    effort: "S",
    touches: [".github/workflows/e2e-nightly.yml", "scripts/e2e-recent-failures.mjs"],
    noticed:
      "The scheduled `E2E nightly` workflow failed on main. It runs every `@quarantine` test and then each spec that failed on CI in the last 7 days five times. A red run means a quarantined test is still failing, a recent failure is a flake rather than a fixed break, or the run itself broke. Each red run after this one adds a comment with its link; the first green run closes this issue.",
    why: "It was found by the scheduled run, not by a change anyone was making. A quarantined test failing here is expected until its own issue is fixed; a spec from the flake hunt failing one of its five repeats is the evidence a quarantine needs, and nothing else in CI collects it.",
    proposed:
      'Read the failed run\'s log and its `e2e-nightly-report` artifact and name the failing tests. For a quarantined test, comment on its own quarantine issue. For a flake-hunt spec, fix the flake, or quarantine it with an issue and a 7-day expiry per `docs/engineering/testing.md` "Flakes". If the run itself broke (build, `scripts/e2e-recent-failures.mjs`), fix that with a test.',
    prompt:
      'The nightly quarantine and flake-hunt run (`.github/workflows/e2e-nightly.yml`) is red on main. Read the newest failed run linked in this issue\'s body and comments with `gh api repos/AaronBuxbaum/diveday/actions/runs/<id>/jobs` and its logs, and download its `e2e-nightly-report` artifact. Read `docs/engineering/testing.md` "Flakes" and `scripts/e2e-recent-failures.mjs` first. A failing quarantined test belongs to its own issue: comment there. A flake-hunt spec that failed one of its five repeats is a flake: fix it (starting from the trace, never a wider timeout) or quarantine it with an open issue and an expiry. A broken run is fixed with a failing test first. Done is a manual run of the workflow (its Run workflow button) going green, plus `pnpm lint`, `pnpm typecheck` and `pnpm check:repo`. Close this issue in the PR that lands the fix.',
  },
  mutation: {
    title: "Fix the weekly mutation run, which is red on main",
    kind: "risk",
    effort: "S",
    touches: [
      ".github/workflows/mutation.yml",
      "stryker.config.mjs",
      "stryker.vitest.config.ts",
      "scripts/mutation-issues.mjs",
    ],
    noticed:
      "The scheduled `Mutation testing` workflow failed. Surviving mutants never fail it (they are filed as one issue per module), so a red run means Stryker itself or the filing step broke, and no survivors are being reported for any module until it is fixed. Each red run after this one adds a comment with its link; the first green run closes this issue.",
    why: "It was found by the scheduled run, not by a change anyone was making. Stryker runs the `lib` tests under a config of its own, so a change to the Vitest setup, a Stryker upgrade or a malformed report can each break it, and only the run log says which.",
    proposed:
      "Read the failed leg's log. If Stryker failed its dry run, run the same command locally and fix the config or the failing test. If the filing step failed, fix `scripts/mutation-issues.mjs` with a test first. Do not drop a module from the matrix to make the run green.",
    prompt:
      "The weekly mutation run (`.github/workflows/mutation.yml`) is red. Read the newest failed run linked in this issue's body and comments, find the failing leg and step, then read `stryker.config.mjs`, `stryker.vitest.config.ts` and `scripts/mutation-issues.mjs`. Reproduce locally with `pnpm test:mutation --mutate src/lib/trip-admission.ts` (the smaller module). Fix the cause, with a failing test first when the fault is in a script. Done is a manual run of the workflow going green, plus `pnpm lint`, `pnpm typecheck` and `pnpm check:repo`. Close this issue in the PR that lands the fix.",
  },
};

/** The issue body for one workflow's alert; the run that opened it is named first. */
export function alertBody(alert, runUrl) {
  return renderFollowUpBody({
    kind: alert.kind,
    effort: alert.effort,
    touches: alert.touches,
    noticed: `${alert.noticed}\n\nFirst red run: ${runUrl}`,
    why: alert.why,
    proposed: alert.proposed,
    prompt: alert.prompt,
  });
}

/** What the guard would say about this alert's issue; empty means it may be filed. */
export function alertProblems(alert, runUrl) {
  return findIssueProblems({ number: 0, title: alert.title, body: alertBody(alert, runUrl) })
    .problems;
}

/**
 * Opens, comments on, or closes the workflow's alert issue. Returns what it did:
 * `opened`, `commented`, `closed` or `nothing`.
 */
export function reconcileAlert({ workflow, outcome, runUrl, tracker, dryRun = false, log }) {
  const alert = ALERTS[workflow];
  if (!alert) throw new Error(`workflow-alert: no alert for workflow "${workflow}"`);
  const open = tracker
    .listIssues({ label: ALERT_LABEL })
    .find((issue) => issue.title === alert.title);

  if (outcome === "success") {
    if (!open) return "nothing";
    tracker.comment(open.number, `Green again: ${runUrl}. Closing.`, { dryRun });
    tracker.closeIssue(open.number, { reason: "completed" }, { dryRun });
    log(`workflow-alert: closed #${open.number}.`);
    return "closed";
  }

  if (open) {
    tracker.comment(open.number, `Red again: ${runUrl}`, { dryRun });
    log(`workflow-alert: commented on #${open.number}.`);
    return "commented";
  }
  const problems = alertProblems(alert, runUrl);
  if (problems.length > 0) {
    throw new Error(
      `workflow-alert: the issue body fails check:follow-ups, so it was not filed:\n${problems.join("\n")}`,
    );
  }
  const created = tracker.createIssue(
    { title: alert.title, body: alertBody(alert, runUrl), labels: [TRIAGE_LABEL, ALERT_LABEL] },
    { dryRun },
  );
  log(`workflow-alert: opened ${created ? `#${created.number}` : "(dry run)"}.`);
  return "opened";
}

/** `--workflow`, `--outcome success|failure`, `--run-url`, `--dry-run`. */
export function parseAlertArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--workflow") args.workflow = argv[++i];
    else if (flag === "--outcome") args.outcome = argv[++i];
    else if (flag === "--run-url") args.runUrl = argv[++i];
    else throw new Error(`workflow-alert: unknown argument ${flag}`);
  }
  if (!ALERTS[args.workflow]) {
    throw new Error(`workflow-alert: --workflow must be one of ${Object.keys(ALERTS).join(", ")}`);
  }
  if (args.outcome !== "success" && args.outcome !== "failure") {
    throw new Error("workflow-alert: --outcome must be success or failure");
  }
  if (!/^https:\/\/\S+$/.test(args.runUrl ?? "")) {
    throw new Error("workflow-alert: --run-url must be the run's https URL");
  }
  return args;
}

async function main() {
  const args = parseAlertArgs(process.argv.slice(2));
  reconcileAlert({ ...args, tracker: defaultTracker(), log: console.log });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
