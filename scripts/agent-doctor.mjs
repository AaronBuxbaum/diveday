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
// The GitHub MCP server cannot be reached from a script at all (it is a tool of the session,
// not a process this can call), so that row always says how to test it rather than pretending.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { lastSessionRefusals, readLog, refusalLine } from "./hook-log.mjs";
import { fetchHeadAgeMs, installNeed, pinnedNodeMajor } from "./session-context.mjs";
import { gitReader, readStack, stackSummary } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

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
 * The raw facts, each null when it could not be read. Every reader is injectable through
 * `readers` so the tests need no git, no `gh` and no process table.
 */
export function gatherFacts(root = ROOT, { strays = true, readers = {} } = {}) {
  const git = readers.git ?? gitReader(root);
  const facts = {
    nodeMajor: Number(process.versions.node.split(".")[0]),
    pinnedMajor: (readers.pinnedMajor ?? pinnedNodeMajor)(root),
    gh: (readers.commandWorks ?? commandWorks)("gh", ["--version"]),
    fetchAgeMs: (readers.fetchAge ?? fetchHeadAgeMs)(git, root),
    mainTip: git(["log", "-1", "--format=%cs", "origin/main"]),
    nodeModules: (readers.installNeed ?? installNeed)(root),
    strays: strays ? (readers.strayCount ?? strayCount)(root) : undefined,
    stack: stackSummary((readers.readStack ?? readStack)(git)),
    refusals: refusalLine(lastSessionRefusals((readers.readLog ?? readLog)({ root }), null)),
  };
  return facts;
}

/** One row per check: `{ name, status: "ok" | "warn" | "unknown", detail, fix }`. */
export function checks(facts) {
  const rows = [];
  const nodeOk = facts.pinnedMajor === null || facts.nodeMajor === facts.pinnedMajor;
  rows.push({
    name: "node",
    status: facts.pinnedMajor === null ? "unknown" : nodeOk ? "ok" : "warn",
    detail: `Node ${facts.nodeMajor} (.nvmrc pins ${facts.pinnedMajor ?? "nothing readable"})`,
    fix: nodeOk
      ? ""
      : "Every pnpm command prints an engine warning; when a test disagrees with CI, reinstall (`pnpm install --frozen-lockfile`) before believing it. Only the environment's setup can change the Node (issue #2247).",
  });
  rows.push({
    name: "gh",
    status: facts.gh ? "ok" : "warn",
    detail: facts.gh ? "gh is installed" : "gh is not installed",
    fix: facts.gh
      ? ""
      : "Use the GitHub MCP tools (`mcp__github__*`) for issues, PRs and review threads; `pnpm gates` and `check:follow-ups` report SKIPPED without gh.",
  });
  rows.push({
    name: "github-mcp",
    status: "unknown",
    detail: "not reachable from a script",
    fix: "Test it in the session: call `mcp__github__get_me`. An answer means issues and PRs are reachable; repo-scoped REST through curl is refused in cloud containers either way.",
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
      ? "git fetch origin main — `test:changed`, `check:closing-keywords` and the migration guard measure from it."
      : "",
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
  const warned = rows.filter((row) => row.status === "warn" && row.name !== "hook refusals");
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
    process.stdout.write(`${renderReport(gatherFacts(process.cwd()))}\n`);
  } catch (error) {
    process.stdout.write(`agent:doctor could not finish: ${error?.message ?? error}\n`);
  }
}
