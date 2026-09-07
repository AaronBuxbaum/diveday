#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { findIssueProblems, LABEL, listIssuesByLabel } from "./check-follow-ups.mjs";
import {
  classify,
  planRun,
  renderComment,
  renderIssue,
  renderSummary,
  sourceFileForPath,
} from "./persona-bots/findings.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * `pnpm persona:bots` — the weekly persona walk (N-61), and the only thing in
 * this repository that writes into the issue tracker on its own.
 *
 * What it does, in order:
 *
 * 1. Checks a Chromium is available, and builds the e2e production build — or,
 *    with `--no-build`, verifies one is already on disk, which is what the
 *    weekly workflow does after its own `pnpm e2e:build`.
 * 2. Runs `scripts/persona-bots/walk.spec.ts`: every surface
 *    `docs/product/personas.md` names, opened as the persona who lives on it,
 *    probed deterministically, and photographed through
 *    `scripts/screenshot.mjs`.
 * 3. Shapes what it found into `needs-triage` issues, **validates each one
 *    against `findIssueProblems`** — the same guard `pnpm check:follow-ups`
 *    runs over the live tracker inside every pull request's `pnpm check` — and
 *    applies the volume policy in `scripts/persona-bots/findings.mjs`.
 * 4. Files what survives that, through `gh`.
 *
 * **This is a report, never a gate.** Nothing it finds fails a build, nothing
 * it cannot do fails the job: no `gh`, a walk that did not complete, a body
 * the guard refuses — each of those prints why and files nothing. A bot that
 * reddens a repository or fills an inbox with malformed issues is worse than
 * no bot, and both failures are one bad week away without this.
 *
 * Options: `--dry-run` (shape and print, file nothing — what a session runs),
 * `--no-build`, `--keep`, `--out <dir>` (default `persona-bots`).
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const dryRun = flag("--dry-run");
const root = process.cwd();
const outDir = path.resolve(
  root,
  option("--out") ?? process.env.PERSONA_BOTS_OUT ?? "persona-bots",
);
const env = { ...process.env, PERSONA_BOTS_OUT: outDir };

/** The workflow run this was: named in every issue so the screenshots are findable. */
const runContext = {
  runUrl:
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  artifactName: "persona-bots",
  screenshots: {},
};

function run(command, commandArgs, label, timeoutMs) {
  const result = runBounded(command, commandArgs, { timeoutMs, stdio: "inherit", env, cwd: root });
  if (result.error) {
    console.error(`persona-bots: could not start ${label}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// `build`'s ceiling, not a tighter one: a cold machine downloads a Chromium here.
if (run(pnpm, ["e2e:browser-check"], "the browser check", SUBPROCESS_TIMEOUTS.build) !== 0) {
  console.error("persona-bots: DID NOT RUN — no browser, so nothing was walked and nothing filed.");
  process.exit(0);
}

const buildStatus = flag("--no-build")
  ? run(
      process.execPath,
      ["scripts/check-e2e-build.mjs"],
      "the build check",
      SUBPROCESS_TIMEOUTS.nodeScript,
    )
  : run(pnpm, ["e2e:build"], "the e2e build", SUBPROCESS_TIMEOUTS.build);
if (buildStatus !== 0) {
  console.error("persona-bots: DID NOT RUN — no build to walk, so nothing was filed.");
  process.exit(0);
}

if (!flag("--keep") && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(
  `persona-bots: walking the personas; artifacts land in ${path.relative(root, outDir) || "."}`,
);
const walk = run(
  pnpm,
  ["exec", "playwright", "test", "--config", "scripts/persona-bots/playwright.config.ts"],
  "the persona walk",
  SUBPROCESS_TIMEOUTS.personaWalk,
);

// **Fail open, loudly.** The walk only fails on the harness itself breaking —
// a finding is data, never a red test — so a non-zero exit means the report is
// partial and nothing in it is trustworthy enough to put in front of a human.
if (walk !== 0) {
  console.error(
    "persona-bots: DID NOT FILE — the walk did not complete. Read the Playwright output above and the trace under test-results/persona-bots/.",
  );
  process.exit(0);
}

const findingsFile = path.join(outDir, "findings.json");
let report;
try {
  report = JSON.parse(readFileSync(findingsFile, "utf8"));
} catch (error) {
  console.error(
    `persona-bots: DID NOT FILE — could not read ${path.relative(root, findingsFile)} (${error.message}).`,
  );
  process.exit(0);
}

runContext.screenshots = report.screenshots ?? {};
const findings = report.findings ?? [];
const classes = classify(findings);

// The tracker, read once. Both lists fail open: `listIssuesByLabel` returns
// null when `gh` cannot answer, and a bot that cannot see what is already
// filed must not file, or it re-files the same three issues every week. A dry
// run reads it too when it can — that is how a session sees the dedupe working
// — and simply plans against an empty tracker when `gh` is absent, which it is
// in most containers this repository is developed in.
const openIssues = listIssuesByLabel(root, {
  label: LABEL,
  fields: "number,title,body",
  what: "persona-bots",
});
const closedIssues = listIssuesByLabel(root, {
  label: LABEL,
  fields: "number,title,body",
  state: "closed",
  what: "persona-bots (closed)",
});
const sawTracker = openIssues !== null && closedIssues !== null;
if (!sawTracker && !dryRun) {
  console.error(
    "persona-bots: DID NOT FILE — `gh` could not list the tracker, and a bot that cannot see what is " +
      `already open must not file. The walk's findings are in ${path.relative(root, findingsFile)}.`,
  );
  process.exit(0);
}
if (!sawTracker) {
  console.warn(
    "persona-bots: `gh` could not list the tracker, so this dry run plans against an empty one — " +
      "the dedupe and suppression rules are untested by it.",
  );
}

// A walk that opened fewer surfaces than it planned to is a partial report,
// and a partial report is not something to put in front of a human as a
// finding: the classes it did reach may be missing the pages that would have
// changed how they read. It still writes its findings file and still prints
// the summary — it just files nothing.
const complete =
  typeof report.walked === "number" &&
  typeof report.planned === "number" &&
  report.walked === report.planned;

const routes = routePatterns(root);
const plan = planRun({ classes, openIssues: openIssues ?? [], closedIssues: closedIssues ?? [] });

/** Every class rendered, and every body put through the guard before anything is filed. */
const refused = [];
const issues = [];
for (const entry of plan.file) {
  const touches = [
    ...new Set(
      entry.surfaces
        .map((surface) =>
          sourceFileForPath(surface.path, routes, (file) => existsSync(path.join(root, file))),
        )
        .filter(Boolean),
    ),
  ];
  const issue = renderIssue(entry, { runContext, touches });
  // The self-check that keeps a bad week from reddening every open pull
  // request: `pnpm check:follow-ups` reads the live tracker, so one malformed
  // issue here fails `pnpm check` for every other session until a human
  // notices. Number 0 is a placeholder — the guard only reads it to build its
  // message.
  const { problems } = findIssueProblems({ number: 0, title: issue.title, body: issue.body });
  if (problems.length > 0) {
    refused.push({ probe: entry.probe, problems });
    continue;
  }
  issues.push({ entry, ...issue });
}

console.log(
  renderSummary({
    plan,
    classes,
    findings,
    dryRun,
    walked: report.walked,
    planned: report.planned,
  }),
);
for (const item of refused) {
  console.error(
    `persona-bots: refused to file ${item.probe} — its own body does not pass check:follow-ups:\n${item.problems.map((problem) => `  - ${problem}`).join("\n")}`,
  );
}

if (!complete && !dryRun) {
  console.error(
    `persona-bots: DID NOT FILE — the walk opened ${report.walked ?? "an unknown number of"} of ` +
      `${report.planned ?? "?"} surfaces, so its report is partial.`,
  );
  process.exit(0);
}

if (dryRun) {
  for (const issue of issues) {
    console.log("\n--- would file -------------------------------------------------\n");
    console.log(issue.title);
    console.log();
    console.log(issue.body);
  }
  process.exit(0);
}

for (const issue of issues) {
  const result = runBounded(
    "gh",
    ["issue", "create", "--label", "needs-triage", "--title", issue.title, "--body", issue.body],
    { cwd: root, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCli },
  );
  if (result.status !== 0) {
    console.error(`persona-bots: could not file ${issue.entry.probe} — ${short(result.stderr)}`);
    continue;
  }
  console.log(`persona-bots: filed ${issue.entry.probe} — ${String(result.stdout ?? "").trim()}`);
}

for (const entry of plan.comment) {
  const result = runBounded(
    "gh",
    [
      "issue",
      "comment",
      String(entry.issue.number),
      "--body",
      renderComment(entry, { runContext }),
    ],
    { cwd: root, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCli },
  );
  if (result.status !== 0) {
    console.error(
      `persona-bots: could not comment on #${entry.issue.number} — ${short(result.stderr)}`,
    );
  }
}

/** The route patterns `scripts/route-coverage.json` knows, for naming the page a finding is on. */
function routePatterns(repoRoot) {
  try {
    const coverage = JSON.parse(
      readFileSync(path.join(repoRoot, "scripts/route-coverage.json"), "utf8"),
    );
    return Object.keys(coverage).filter((route) => !route.startsWith("//"));
  } catch {
    return [];
  }
}

/** One line of a subprocess's stderr, so a `gh` failure reads as a sentence. */
function short(value) {
  return (
    String(value ?? "")
      .split("\n")
      .filter(Boolean)[0] ?? "no output"
  );
}
