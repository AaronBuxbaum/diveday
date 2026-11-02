#!/usr/bin/env node
// The weekly dependency audit (issue #3651).
//
// `pnpm audit --audit-level high` ran in ci.yml until 2026-10-18, when 19 high advisories in the
// `vercel` and `next-devtools-mcp` dev dependencies reddened every pull request (#2826); it was
// switched off "until #2826 lands" and stayed dark after #2826 closed. On 2026-11-02 main still
// carried one high advisory (zod < 4.6.6, dev-only, through `vercel` and `next-devtools-mcp`), so
// turning it back on per pull request would redden every PR for a fix no PR owns. This runs the
// same audit weekly from ci-health.yml and opens one `needs-triage` issue (or comments on the open
// one), and never fails the run: an advisory is a finding, not a broken pipeline.
//
//   node scripts/audit-health.mjs [--summary <file>] [--file-issue] [--dry-run] [--run-url <url>]
//
// Exit 0 always for findings; exit 1 only when the audit itself could not be read, so a broken
// registry call is not mistaken for a clean tree.
import { appendFileSync } from "node:fs";
import process from "node:process";

import { findIssueProblems, LABEL as TRIAGE_LABEL } from "./check-follow-ups.mjs";
import { renderFollowUpBody } from "./file-follow-up.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker as defaultTracker } from "./tracker.mjs";

export const ISSUE_TITLE = "Dependencies carry a high or critical advisory";
const BLOCKING = new Set(["high", "critical"]);

/**
 * The high and critical advisories in `pnpm audit --json` output, one per advisory id, sorted
 * worst first. `advisories` is a map in pnpm's output; anything unreadable is an error, never an
 * empty list.
 */
export function blockingAdvisories(report) {
  const advisories = report?.advisories;
  if (!advisories || typeof advisories !== "object" || Array.isArray(advisories)) {
    throw new Error("audit-health: pnpm audit output has no `advisories` map");
  }
  return Object.entries(advisories)
    .map(([id, advisory]) => ({
      id,
      severity: String(advisory.severity ?? ""),
      title: String(advisory.title ?? ""),
      module: String(advisory.module_name ?? ""),
      vulnerable: String(advisory.vulnerable_versions ?? ""),
      patched: String(advisory.patched_versions ?? ""),
      url: String(advisory.url ?? ""),
      paths: (advisory.findings ?? []).reduce((n, f) => n + (f.paths?.length ?? 0), 0),
      devOnly: (advisory.findings ?? []).every((f) => f.dev === true),
    }))
    .filter((advisory) => BLOCKING.has(advisory.severity))
    .sort((a, b) => a.severity.localeCompare(b.severity) || a.module.localeCompare(b.module));
}

export function renderAdvisories(list) {
  if (list.length === 0) return "No high or critical advisory.\n";
  const rows = list.map(
    (a) =>
      `- ${a.severity}: ${a.module} ${a.vulnerable} (patched ${a.patched || "none"}), ${a.title}; ` +
      `${a.paths} path(s), ${a.devOnly ? "dev dependencies only" : "reaches production"}. ${a.url}`,
  );
  return `${rows.join("\n")}\n`;
}

export function issueBody(list, runUrl) {
  return renderFollowUpBody({
    kind: "risk",
    effort: "S",
    touches: ["scripts/audit-health.mjs", ".github/workflows/ci-health.yml"],
    noticed:
      `The weekly audit (\`.github/workflows/ci-health.yml\`, \`scripts/audit-health.mjs\`) found ${list.length} high or critical advisory(ies) in the tree:\n\n${renderAdvisories(list)}\n${runUrl ? `Run: ${runUrl}` : ""}`.trim(),
    why: "The audit is not a per-pull-request check because one unpatched dev dependency would redden every pull request for a fix none of them owns (#2826); the weekly run is how a new advisory is seen at all.",
    proposed:
      "Bump or override the vulnerable package to a patched release (`overrides` in pnpm-workspace.yaml), or, when no patched release exists, review it into `auditConfig.ignoreGhsas` with the reason and a revisit date. Whether the advisory reaches production code is stated per line above.",
    prompt:
      "Read `scripts/audit-health.mjs` and `pnpm-workspace.yaml` (`auditConfig` and the overrides). Run `pnpm audit --audit-level high`, then patch each listed advisory by upgrading or overriding the package, or review it into `auditConfig.ignoreGhsas` with a reason and a revisit date. Run `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm check:repo`. Done is `pnpm audit --audit-level high` exiting 0. A security-reviewer run is required; name it in the PR body. Close this issue when the work lands.",
  });
}

/** Opens the issue, comments on the open one, or does nothing. */
export function reconcile({ list, runUrl, tracker, dryRun = false, log }) {
  if (list.length === 0) return "nothing";
  const open = tracker
    .listIssues({ label: TRIAGE_LABEL })
    .find((issue) => issue.title === ISSUE_TITLE);
  if (open) {
    tracker.comment(open.number, `Still failing this week:\n\n${renderAdvisories(list)}`, {
      dryRun,
    });
    log(`audit-health: commented on #${open.number}.`);
    return "commented";
  }
  const body = issueBody(list, runUrl);
  const { problems } = findIssueProblems({ number: 0, title: ISSUE_TITLE, body });
  if (problems.length > 0) {
    throw new Error(`audit-health: the issue body fails check:follow-ups:\n${problems.join("\n")}`);
  }
  const created = tracker.createIssue(
    { title: ISSUE_TITLE, body, labels: [TRIAGE_LABEL] },
    { dryRun },
  );
  log(`audit-health: opened ${created ? `#${created.number}` : "(dry run)"}.`);
  return "opened";
}

/** `pnpm audit` exits 1 when it finds anything, so the exit code says nothing; the JSON does. */
export function readAudit(run = runBounded) {
  const result = run("pnpm", ["audit", "--audit-level", "high", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
  });
  try {
    return JSON.parse(result?.stdout ?? "");
  } catch {
    throw new Error(
      `audit-health: pnpm audit gave no JSON (exit ${result?.status}): ${String(result?.stderr ?? "").slice(0, 300)}`,
    );
  }
}

function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const list = blockingAdvisories(readAudit());
  const text = `## Dependency audit\n\n${renderAdvisories(list)}`;
  process.stdout.write(`${text}\n`);
  if (value("--summary")) appendFileSync(value("--summary"), `${text}\n`);
  if (flag("--file-issue")) {
    reconcile({
      list,
      runUrl: value("--run-url"),
      tracker: defaultTracker(),
      dryRun: flag("--dry-run"),
      log: console.log,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
