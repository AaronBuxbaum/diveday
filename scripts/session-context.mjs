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
// dependencies when `node_modules/` is missing or older than `pnpm-lock.yaml`, so the first
// `pnpm lint` is not the moment a session discovers there is nothing (or the wrong thing) to run
// it with.
//
// When the Node on PATH is not the major `.nvmrc` pins and that major is installed anyway (nvm,
// fnm, n, volta, or a `/opt/node<major>` directory), it puts that one first on PATH for the rest
// of the session through `CLAUDE_ENV_FILE`, and says so. When it is not installed, it says that
// instead, and what it costs.
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

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
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

/** Compares `v24.15.0` / `24.15.0` style names numerically, highest first. */
function byVersionDescending(a, b) {
  const parts = (name) =>
    name
      .replace(/^v/, "")
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
}

/**
 * Where an installed Node `major` lives, if anywhere: the `bin` directory holding its `node`,
 * and which manager put it there. Every version manager this could meet keeps its versions in a
 * directory of its own, so this reads those directories rather than sourcing a manager's shell
 * function — nvm is a function, not a binary, and a hook has no interactive shell to run it in.
 * `exists` and `list` are injectable so the tests never need any of them installed.
 */
export function findInstalledNode(
  major,
  { env = process.env, home = os.homedir(), exists = existsSync, list = readdirSync } = {},
) {
  const versionsIn = (dir, prefix) => {
    try {
      return list(dir)
        .filter((name) => name.startsWith(prefix))
        .sort(byVersionDescending);
    } catch {
      return [];
    }
  };
  const managers = [
    {
      via: "nvm",
      root: path.join(env.NVM_DIR ?? path.join(home, ".nvm"), "versions/node"),
      prefix: `v${major}.`,
      bin: "bin",
    },
    {
      via: "fnm",
      root: path.join(env.FNM_DIR ?? path.join(home, ".local/share/fnm"), "node-versions"),
      prefix: `v${major}.`,
      bin: "installation/bin",
    },
    {
      via: "n",
      root: path.join(env.N_PREFIX ?? "/usr/local", "n/versions/node"),
      prefix: `${major}.`,
      bin: "bin",
    },
    {
      via: "volta",
      root: path.join(env.VOLTA_HOME ?? path.join(home, ".volta"), "tools/image/node"),
      prefix: `${major}.`,
      bin: "bin",
    },
  ];
  for (const { via, root, prefix, bin } of managers) {
    for (const version of versionsIn(root, prefix)) {
      const dir = path.join(root, version, bin);
      if (exists(path.join(dir, "node"))) return { bin: dir, via };
    }
  }
  const opt = path.join("/opt", `node${major}`, "bin");
  if (exists(path.join(opt, "node"))) return { bin: opt, via: "/opt" };
  return null;
}

/**
 * Puts the pinned Node first on PATH for the session's later shell commands, when the one
 * running is a different major and the pinned one is installed. `CLAUDE_ENV_FILE` is the
 * channel Claude Code gives a `SessionStart` hook for exactly this: lines appended to it are
 * sourced before every later Bash command. Without it nothing here can reach the session's
 * shell, so it reports the Node it found and leaves PATH alone.
 */
export function selectPinnedNode(
  { nodeMajor, pinnedMajor },
  { env = process.env, find = findInstalledNode, append = appendFileSync } = {},
) {
  if (!nodeMajor || !pinnedMajor || nodeMajor === pinnedMajor) return null;
  const found = find(pinnedMajor, { env });
  if (!found) return { status: "unavailable" };
  if (!env.CLAUDE_ENV_FILE) return { status: "no-env-file", ...found };
  append(env.CLAUDE_ENV_FILE, `export PATH="${found.bin}:$PATH"\n`);
  // The install below runs in this process; let it run on the Node the session will use.
  env.PATH = `${found.bin}${path.delimiter}${env.PATH ?? ""}`;
  return { status: "selected", ...found };
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
  { source = "startup", nodeMajor, pinnedMajor, installed, nodeSelection = null } = {},
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
    if (nodeSelection?.status === "selected") {
      lines.push(
        `Node ${nodeMajor} started this session, repo pins ${pinnedMajor}: Node ${pinnedMajor} from ${nodeSelection.via} (${nodeSelection.bin}) is now first on PATH for every shell command.`,
      );
    } else {
      const found =
        nodeSelection?.status === "no-env-file"
          ? `Node ${pinnedMajor} is installed (${nodeSelection.bin}) but this hook had no CLAUDE_ENV_FILE to select it with`
          : `no Node ${pinnedMajor} is installed (looked in nvm, fnm, n, volta and /opt/node${pinnedMajor})`;
      lines.push(
        `Node ${nodeMajor} here, repo pins ${pinnedMajor}, and ${found}. Every pnpm command prints an engine warning first, and node_modules may have been installed under another Node or lag pnpm-lock.yaml — when a test disagrees with CI, run \`pnpm install --frozen-lockfile\` before believing it (debug skill).`,
      );
    }
  }
  if (installed === "installed") lines.push("node_modules was missing; `pnpm install` ran.");
  if (installed === "refreshed") {
    lines.push("node_modules was older than pnpm-lock.yaml; `pnpm install` ran.");
  }
  if (installed === "failed") {
    lines.push(
      "node_modules is missing and `pnpm install --frozen-lockfile` failed — run it and read the error.",
    );
  }
  lines.push(
    "Path-scoped rules in .claude/rules/ load as you read matching files; the hooks in .claude/settings.json are described in docs/agents/session-hooks.md.",
    // The papercuts log had one entry for a month of visible friction: nothing asked for them.
    "If a guard or hook fights you this session, add a papercut: one file in docs/agents/papercuts/ (docs/agents/papercuts.md).",
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

/**
 * Whether `node_modules` needs an install: missing, or written before the lockfile last
 * changed. pnpm records each install in `node_modules/.modules.yaml`; a lockfile newer than that
 * means a pull or a branch switch moved the dependencies underneath it, and the first pnpm
 * command would otherwise reinstall in the middle of whatever the session asked it to do. A
 * checkout that only touches the lockfile's mtime costs one no-op frozen install.
 */
export function installNeed(
  root,
  { exists = existsSync, mtime = (file) => statSync(file).mtimeMs } = {},
) {
  if (!exists(path.join(root, "node_modules"))) return "missing";
  try {
    const lock = mtime(path.join(root, "pnpm-lock.yaml"));
    const installed = mtime(path.join(root, "node_modules/.modules.yaml"));
    return lock > installed ? "stale" : null;
  } catch {
    return null;
  }
}

function installIfNeeded(root) {
  if (process.env.CLAUDE_CODE_REMOTE !== "true") return null;
  const need = installNeed(root);
  if (!need) return null;
  const result = runBounded("pnpm", INSTALL_ARGS, {
    cwd: root,
    encoding: "utf8",
    stdio: "ignore",
    timeoutMs: 240_000,
  });
  if (result.status !== 0) return "failed";
  return need === "missing" ? "installed" : "refreshed";
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
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const pinnedMajor = pinnedNodeMajor(cwd);
  // Before the install, so the install runs on the Node the session will use.
  const nodeSelection = selectPinnedNode({ nodeMajor, pinnedMajor });
  const block = sessionBlock(state, {
    source,
    nodeMajor,
    pinnedMajor,
    nodeSelection,
    installed: installIfNeeded(cwd),
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
