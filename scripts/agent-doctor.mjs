#!/usr/bin/env node
// `pnpm agent:doctor` — what this environment will trip a session on, checked rather than
// rediscovered. Every cloud session used to find out the same things one failure at a time:
// Node 22 against a repo pinned to 24, no `gh`, an `origin/main` days old, a dev server left
// running by the session before, a `node_modules` older than the lockfile. Each check below is
// one of those, with the fix beside it.
//
// `session-context.mjs` prints `summaryLines` (two lines) at session start; this script prints
// the whole report on demand. Like the hooks, it never fails: a check that cannot answer says
// "unknown" rather than guessing, and the exit code is always 0 — it is a report, not a gate.
//
// A row warns only about what a session can fix. What only a human can change (the Node the
// container ships, the repository's delete-head-branches switch) is `info`: the full report
// still shows it, the session-start line does not, because four warnings nobody could act on
// on every start trained sessions to skip the block (2026-10-13 re-review, item 37). The GitHub
// MCP server is not a row at all: a script cannot reach it, so the row could only ever say
// "unknown"; the `gh` row's fix names the MCP tools instead.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { NODE_FLOOR, nodeRuntimeProblem } from "./check-node-version.mjs";
import { lastSessionRefusals, readLog, refusalLine } from "./hook-log.mjs";
import {
  readScheduledRuns,
  redScheduledText,
  redScheduledWorkflows,
  SCHEDULED_RUNS_CACHE,
} from "./scheduled-runs.mjs";
import { fetchHeadAgeMs, installNeed, pinnedNodeMajor } from "./session-context.mjs";
import { gitReader, readStack, stackSummary } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker } from "./tracker.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** origin/main older than this, by its last fetch, is reported stale. */
const STALE_FETCH_MS = 6 * 60 * 60_000;

function minutes(ms) {
  if (ms === null || !Number.isFinite(ms)) return null;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function commandWorks(command, args) {
  try {
    const result = runBounded(command, args, {
      stdio: "ignore",
      timeoutMs: SUBPROCESS_TIMEOUTS.processTable,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function strayCount(root) {
  try {
    const result = runBounded("node", [path.join(root, "scripts/stray-processes.mjs"), "--list"], {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.processTable,
    });
    if (result.status !== 0) return null;
    return String(result.stdout ?? "")
      .split("\n")
      .filter((line) => /^\s+pid \d+/.test(line)).length;
  } catch {
    return null;
  }
}

/**
 * The branches on origin that no open pull request has as its head, `main` aside; null when
 * either list could not be read. On 2026-10-11, 28 of 29 heads on origin had no open pull
 * request, and every session start fetches all of `claude/*`.
 */
export function branchesWithoutPr(heads, openHeads) {
  if (!heads || !openHeads) return null;
  const open = new Set(openHeads);
  return heads.filter((name) => name !== "main" && !open.has(name)).sort();
}

function remoteHeads(root) {
  const result = runBounded("git", ["ls-remote", "--heads", "origin"], {
    cwd: root,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.gitFetch,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  return String(result.stdout ?? "")
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, ""))
    .filter(Boolean);
}

/**
 * Where the checkout every session's hooks, settings and AGENTS.md load from stands against
 * `origin/main`: `$CLAUDE_PROJECT_DIR`, which in the cloud containers is the shared clone the
 * `wt-*` worktrees hang off. On 2026-10-13 it sat detached 704 commits behind, so three days of
 * hooks ran nowhere (fourth review, row 1). Null when git could not answer.
 */
export function hooksCheckoutLag(dir) {
  const git = gitReader(dir);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const behind = Number(git(["rev-list", "--count", "HEAD..origin/main"]));
  if (!branch || !Number.isInteger(behind)) return null;
  return { dir, detached: branch === "HEAD", behind };
}

function openPullHeads() {
  try {
    return tracker()
      .listPulls({ state: "open" })
      .map((pull) => pull.headRefName);
  } catch {
    return null;
  }
}

/** Main's scheduled runs, through a cache in the clone's git common dir (scheduled-runs.mjs). */
function scheduledRuns(root, git) {
  const common = git(["rev-parse", "--git-common-dir"]);
  return readScheduledRuns(
    common ? path.join(path.resolve(root, common), SCHEDULED_RUNS_CACHE) : null,
  );
}

/**
 * The raw facts, each null when it could not be read. Every reader is injectable through
 * `readers` so the tests need no git, no `gh` and no process table.
 */
export function gatherFacts(
  root = ROOT,
  {
    strays = true,
    remote = false,
    scheduled = false,
    readers = {},
    fetched = null,
    mergeDriversInstall = null,
    projectDir = process.env.CLAUDE_PROJECT_DIR ?? root,
  } = {},
) {
  const git = readers.git ?? gitReader(root);
  const facts = {
    // SessionStart's own fetch, when it ran just before this: "fetched" or "failed". A fetch
    // that just succeeded is current whatever FETCH_HEAD's path says; one that failed is
    // already said by the session block, so the summary does not say it twice.
    fetched,
    // SessionStart's own driver install, when it ran just before this: its failure is the
    // session block's line already.
    mergeDriversInstall,
    nodeVersion: process.versions.node,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    pinnedMajor: (readers.pinnedMajor ?? pinnedNodeMajor)(root),
    gh: (readers.commandWorks ?? commandWorks)("gh", ["--version"]),
    fetchAgeMs: fetched === "fetched" ? 0 : (readers.fetchAge ?? fetchHeadAgeMs)(git, root),
    mainTip: git(["log", "-1", "--format=%cs", "origin/main"]),
    nodeModules: (readers.installNeed ?? installNeed)(root),
    strays: strays ? (readers.strayCount ?? strayCount)(root) : undefined,
    stack: stackSummary((readers.readStack ?? readStack)(git)),
    hooksCheckout: (readers.hooksCheckout ?? hooksCheckoutLag)(projectDir),
    // Git runs a driver `.gitattributes` names only when the clone's config defines it.
    mergeDriver: git(["config", "--get", "merge.diveday-ratchets.driver"]),
    refusals: refusalLine(lastSessionRefusals((readers.readLog ?? readLog)({ root }), null)),
    // One cached network read: the session start asks for it (a red nightly is something a
    // session can fix and nobody else is reading), the tests do not.
    redScheduled: scheduled
      ? redScheduledWorkflows((readers.scheduledRuns ?? scheduledRuns)(root, git))
      : undefined,
    // Two network reads, so only the on-demand report makes them, never the session-start lines.
    orphanBranches: remote
      ? branchesWithoutPr(
          (readers.remoteHeads ?? remoteHeads)(root),
          (readers.openPullHeads ?? openPullHeads)(),
        )
      : undefined,
  };
  return facts;
}

/**
 * One row per check: `{ name, status: "ok" | "warn" | "info" | "unknown", detail, fix }`.
 * `warn` is for what a session can fix; `info` for what only a human can.
 */
export function checks(facts) {
  const rows = [];
  const runtimeProblem = nodeRuntimeProblem(facts.nodeVersion ?? `${facts.nodeMajor}.0.0`);
  rows.push({
    name: "node",
    status: runtimeProblem ? "warn" : "ok",
    detail: `Node ${facts.nodeVersion ?? facts.nodeMajor} (requires ^${NODE_FLOOR}; .nvmrc pins ${facts.pinnedMajor ?? "nothing readable"})`,
    fix: runtimeProblem ?? "",
  });
  rows.push({
    name: "gh",
    status: facts.gh ? "ok" : "warn",
    detail: facts.gh ? "gh is installed" : "gh is not installed",
    fix: facts.gh
      ? ""
      : "Use the GitHub MCP tools (`mcp__github__*`; `mcp__github__get_me` tests them) for issues, PRs and review threads; `pnpm gates` and `check:follow-ups` report SKIPPED without gh. Where gh is installed, `gh api` (REST) works in cloud sessions and `gh issue`/`gh pr` (GraphQL) do not.",
  });
  const stale = facts.fetchAgeMs === null || facts.fetchAgeMs > STALE_FETCH_MS;
  rows.push({
    name: "origin/main",
    status: facts.mainTip === null ? "warn" : stale ? "warn" : "ok",
    detail:
      facts.mainTip === null
        ? "no origin/main ref"
        : `origin/main tip ${facts.mainTip}, ${facts.fetchAgeMs === null ? "never fetched in this checkout" : `fetched ${minutes(facts.fetchAgeMs)} ago`}`,
    fix: stale
      ? "git fetch origin main — `verify:push` (off a stack), `check:closing-keywords` and the migration guard measure from it."
      : "",
  });
  const hooks = facts.hooksCheckout;
  const behind = hooks ? `${hooks.behind} commit${hooks.behind === 1 ? "" : "s"}` : "";
  rows.push({
    name: "hooks checkout",
    status: !hooks ? "unknown" : hooks.behind === 0 ? "ok" : hooks.detached ? "warn" : "info",
    detail: !hooks
      ? "could not read the checkout the hooks load from"
      : hooks.behind === 0
        ? `hooks run from ${hooks.dir}, current with origin/main`
        : `hooks run from ${hooks.dir}, ${behind} behind origin/main`,
    fix:
      hooks && hooks.behind > 0
        ? hooks.detached
          ? `Session start fast-forwards it when it is clean; it was not, so move or commit what is there, then \`git -C ${hooks.dir} checkout --detach origin/main\`. Its hooks, settings and AGENTS.md take effect from the next session.`
          : `It is on a branch, so its hooks are that branch's; session start moves only a detached one.`
        : "",
  });
  rows.push({
    name: "merge drivers",
    status: facts.mergeDriver ? "ok" : "warn",
    detail: facts.mergeDriver
      ? "merge drivers are installed"
      : "merge drivers are not installed, so a merge stops on scripts/ratchets.json and the other generated files",
    fix: facts.mergeDriver ? "" : "node scripts/merge-drivers.mjs install",
  });
  rows.push({
    name: "node_modules",
    status: facts.nodeModules ? "warn" : "ok",
    detail:
      facts.nodeModules === "missing"
        ? "node_modules is missing"
        : facts.nodeModules === "stale"
          ? "node_modules is older than pnpm-lock.yaml"
          : "node_modules is current with pnpm-lock.yaml",
    fix: facts.nodeModules ? "pnpm install --frozen-lockfile" : "",
  });
  if (facts.strays !== undefined) {
    rows.push({
      name: "stray processes",
      status: facts.strays === null ? "unknown" : facts.strays > 0 ? "warn" : "ok",
      detail:
        facts.strays === null
          ? "could not read the process table"
          : `${facts.strays} stale background shell(s)`,
      fix: facts.strays ? "node scripts/stray-processes.mjs --list" : "",
    });
  }
  if (facts.orphanBranches !== undefined) {
    const names = facts.orphanBranches ?? [];
    const shown = names.slice(0, 5).join(", ");
    rows.push({
      name: "remote branches",
      status: facts.orphanBranches === null ? "unknown" : names.length > 0 ? "info" : "ok",
      detail:
        facts.orphanBranches === null
          ? "could not list origin's branches or the open pull requests"
          : `${names.length} remote branches with no open PR${shown ? ` (${shown}${names.length > 5 ? ", …" : ""})` : ""}`,
      fix:
        names.length > 0
          ? 'Every session start fetches them. A merged one is safe to delete on GitHub; one of yours with unpushed intent wants its pull request opened. Turning on "Automatically delete head branches" in the repository settings stops the merged ones piling up (a human\'s switch).'
          : "",
    });
  }
  if (facts.redScheduled !== undefined) {
    const red = facts.redScheduled ?? [];
    rows.push({
      name: "scheduled runs",
      status: facts.redScheduled === null ? "unknown" : red.length > 0 ? "warn" : "ok",
      detail:
        facts.redScheduled === null
          ? "could not read main's scheduled workflow runs"
          : red.length > 0
            ? redScheduledText(red)
            : "no scheduled workflow is red twice running",
      fix:
        red.length > 0
          ? `Nobody else reads these. Fix it like any red test (a failing test is part of the work): ${red.map((w) => `${w.path} (${w.url})`).join(", ")}; \`gh run view <id> --log-failed\` reads the failure, and \`gh api -X POST repos/<owner>/<repo>/actions/workflows/<file>/dispatches -f ref=<branch>\` proves the fix before main's next night.`
          : "",
    });
  }
  rows.push({
    name: "stack",
    status: "ok",
    detail: facts.stack || "HEAD is in no stack of remote branches",
    fix: "node scripts/stack-map.mjs for every layer and its paths",
  });
  if (facts.refusals) {
    rows.push({ name: "hook refusals", status: "warn", detail: facts.refusals, fix: "" });
  }
  return rows;
}

/** The two lines `session-context.mjs` prints at session start. */
export function summaryLines(facts) {
  const rows = checks(facts);
  // The refusal tally is the per-prompt line's to say, once; not repeated here.
  const warned = rows.filter(
    (row) =>
      row.status === "warn" &&
      row.name !== "hook refusals" &&
      // A failed session fetch is the session block's first line already.
      !(row.name === "origin/main" && facts.fetched === "failed") &&
      !(row.name === "merge drivers" && facts.mergeDriversInstall === "not installed"),
  );
  const first =
    warned.length === 0
      ? "Doctor: nothing to warn about."
      : `Doctor: ${warned.map((row) => row.detail).join("; ")}.`;
  const stackRow = rows.find((row) => row.name === "stack");
  return [
    first,
    `${stackRow.detail[0].toUpperCase()}${stackRow.detail.slice(1)}; \`pnpm agent:doctor\` for the full report.`,
  ];
}

export function renderReport(facts) {
  const lines = ["Agent doctor", ""];
  for (const row of checks(facts)) {
    lines.push(`${row.status.padEnd(8)}${row.name.padEnd(18)}${row.detail}`);
    if (row.fix) lines.push(`${" ".repeat(26)}${row.fix}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      `${renderReport(gatherFacts(process.cwd(), { remote: true, scheduled: true }))}\n`,
    );
  } catch (error) {
    process.stdout.write(`agent:doctor could not finish: ${error?.message ?? error}\n`);
  }
}
