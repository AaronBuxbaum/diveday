#!/usr/bin/env node
// The one hook that *adds* context rather than refusing something.
//
// Two modes, one module, because both print the same fact — where this checkout stands —
// at two different moments:
//
//   node scripts/session-context.mjs            `SessionStart`: startup, resume, clear, compact
//   node scripts/session-context.mjs --prompt   `UserPromptSubmit`: one line, every prompt
//
// **SessionStart** prints a short block Claude Code adds to the conversation: branch, upstream,
// how far ahead or behind, how many paths are uncommitted, HEAD's subject, and the Node major
// against the one the repo pins. Each of those is otherwise a tool call a session makes in its
// first minute — `git status`, `git log -1`, `git branch -vv`, `node --version` — and a tool
// call costs more context than the answer does. In a cloud container it also installs
// dependencies when `node_modules/` is missing, so the first `pnpm lint` is not the moment a
// session discovers there is nothing to run it with.
//
// After a **compaction** the same block carries a second half: the working rules the summary
// most reliably drops. AGENTS.md is re-read from disk after compaction (Claude Code does that
// itself), but the *state* of the turn — which branch to push, that follow-ups are issues,
// that a closing message is not a queue — is exactly what a summary compresses into "continued
// working". The reminders are short because they are paid for on every compaction.
//
// **UserPromptSubmit** prints one line: branch, uncommitted count, unpushed count. AGENTS.md's
// Parallel-work section asks for a `git status` before anything that touches the shared tree;
// this makes that free and current on every prompt instead of a snapshot from session start.
//
// Nothing here can block. It fails open on every error, printing nothing rather than
// something wrong: a session that starts without its context line loses a few tokens of
// convenience; a session that starts with a stale or invented branch name loses more.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The install a cloud container runs when it wakes without its dependencies. */
export const INSTALL_ARGS = ["install", "--frozen-lockfile", "--prefer-offline"];

function gitReader(cwd) {
  return (args) => {
    try {
      return readBounded("git", args, {
        cwd,
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
}

/**
 * Where the checkout stands, as plain facts. `git` is injectable so the tests never need a
 * repository; every field is null when git could not answer, and the renderers below leave a
 * null out rather than guessing.
 */
export function checkoutState(git) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return null;
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let ahead = null;
  let behind = null;
  if (upstream) {
    const counts = git(["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [b, a] = (counts ?? "").split(/\s+/).map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      ahead = a;
      behind = b;
    }
  }
  const unpushedRaw = git(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
  const unpushed = unpushedRaw === null ? null : Number(unpushedRaw);
  const status = git(["status", "--porcelain"]);
  const uncommitted = status === null ? null : status.split("\n").filter(Boolean).length;
  const head = git(["log", "-1", "--format=%h %s"]);
  return { branch, upstream, ahead, behind, unpushed, uncommitted, head };
}

function pinnedNodeMajor(root) {
  try {
    const pin = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
    const major = Number(pin.replace(/^v/, "").split(".")[0]);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

/** The one-line form for `UserPromptSubmit`. */
export function promptLine(state) {
  if (!state) return "";
  const parts = [`git: ${state.branch}`];
  if (state.uncommitted !== null) {
    parts.push(state.uncommitted === 0 ? "clean tree" : `${state.uncommitted} uncommitted`);
  }
  if (state.unpushed)
    parts.push(`${state.unpushed} unpushed commit${state.unpushed === 1 ? "" : "s"}`);
  if (state.behind) parts.push(`${state.behind} behind ${state.upstream}`);
  return parts.join(" · ");
}

/** The block for `SessionStart`, given the state and the session's `source`. */
export function sessionBlock(
  state,
  { source = "startup", nodeMajor, pinnedMajor, installed } = {},
) {
  const lines = [];
  if (state) {
    const upstream = state.upstream
      ? `upstream ${state.upstream}${state.ahead !== null ? ` (${state.ahead} ahead, ${state.behind} behind)` : ""}`
      : "no upstream yet";
    const tree =
      state.uncommitted === null
        ? ""
        : state.uncommitted === 0
          ? ", clean tree"
          : `, ${state.uncommitted} uncommitted path${state.uncommitted === 1 ? "" : "s"}`;
    lines.push(`Checkout (${source}): branch ${state.branch}, ${upstream}${tree}.`);
    if (state.head) lines.push(`HEAD ${state.head}`);
    if (state.unpushed) {
      lines.push(
        `${state.unpushed} local commit${state.unpushed === 1 ? " is" : "s are"} on no remote branch — push before the session ends.`,
      );
    }
  }
  if (nodeMajor && pinnedMajor && nodeMajor !== pinnedMajor) {
    lines.push(
      `Node ${nodeMajor} here, repo pins ${pinnedMajor}: expected in a container, and the reason every pnpm command prints an engine warning first (debug skill).`,
    );
  }
  if (installed === "installed") lines.push("node_modules was missing; `pnpm install` ran.");
  if (installed === "failed") {
    lines.push(
      "node_modules is missing and `pnpm install --frozen-lockfile` failed — run it and read the error.",
    );
  }
  lines.push(
    "Path-scoped rules in .claude/rules/ load as you read matching files; the hooks in .claude/settings.json are described in docs/agents/session-hooks.md.",
  );

  if (source === "compact") {
    lines.push(
      "",
      "After compaction, the rules a summary drops:",
      "- Re-read TaskList; the task list is the queue, a sentence in a message is not.",
      "- Before you commit: the guard you touched, `pnpm test <file>`, `pnpm typecheck`, `pnpm lint`; before you push, `pnpm test:changed`. The whole suite belongs to CI.",
      "- A thought you are not acting on becomes a `needs-triage` GitHub issue, never a closing remark.",
      "- A turn ends done, filed, or handed over in as many words. Never on an intention.",
      "- Read a large file by range after a Grep, never whole; the hooks refuse the whole-file form.",
    );
  }
  return lines.join("\n");
}

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function installIfMissing(root) {
  if (process.env.CLAUDE_CODE_REMOTE !== "true") return null;
  if (existsSync(path.join(root, "node_modules"))) return null;
  const result = runBounded("pnpm", INSTALL_ARGS, {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
    timeoutMs: 240_000,
  });
  return result.status === 0 ? "installed" : "failed";
}

function main() {
  const payload = readPayload();
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? ROOT;
  const state = checkoutState(gitReader(cwd));

  if (process.argv.includes("--prompt")) {
    const line = promptLine(state);
    if (line) process.stdout.write(`${line}\n`);
    return;
  }

  const source = payload.source ?? payload.how_started ?? "startup";
  const block = sessionBlock(state, {
    source,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    pinnedMajor: pinnedNodeMajor(cwd),
    installed: installIfMissing(cwd),
  });
  if (block) process.stdout.write(`${block}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    // Fail open: a missing context line costs a few tokens, a wrong one costs more.
  }
  process.exit(0);
}
