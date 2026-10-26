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
// When the checkout is the shared one the hooks load from — the primary worktree, detached and
// clean — and `origin/main` has moved past it, it fast-forwards it first (`fastForwardShared`).
//
// **UserPromptSubmit** prints one line: branch, uncommitted count, unpushed count. AGENTS.md's
// Parallel-work section asks for a `git status` before anything that touches the shared tree;
// this makes that free and current on every prompt instead of a snapshot from session start.
//
// Nothing here can block. It fails open on every error, printing nothing rather than
// something wrong: a session that starts without its context line loses a few tokens of
// convenience; a session that starts with a stale or invented branch name loses more.

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { gatherFacts, summaryLines } from "./agent-doctor.mjs";
import {
  appendEntry,
  lastSessionRefusals,
  papercutLine,
  readLog,
  refusalLine,
  repeatedRefusal,
} from "./hook-log.mjs";
import { install as installMergeDrivers } from "./merge-drivers.mjs";
import { readStack, gitReader as stackGit, stackSummary } from "./stack-map.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { repoSlug } from "./tracker.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The one fetch a session makes on its own, at startup and resume: `main`, which
 * `verify:push`, `check:closing-keywords` and the migration guard all measure from, and the
 * all provider thread branches `stack-map.mjs` derives the stack from. A container's refs are
 * whatever its clone saw, and on 2026-10-10 that was an `origin/main` five days and 650 commits
 * old. `--prune` drops refs of merged-and-deleted branches, so a merged layer leaves the stack.
 */
export const SESSION_FETCH_ARGS = [
  "fetch",
  "--quiet",
  "--prune",
  "--no-tags",
  "origin",
  "+refs/heads/*:refs/remotes/origin/*",
];
const SESSION_FETCH_TIMEOUT_MS = 20_000;
/** A fetch younger than this (by `FETCH_HEAD`'s mtime) is this session's; skip it. */
const FETCH_FRESH_MS = 10 * 60_000;

/** Whether this SessionStart should fetch: startup or resume, not opted out, not just done. */
export function fetchNeed({ source, env = process.env, fetchHeadAgeMs = null }) {
  if (env.DIVEDAY_SESSION_FETCH === "0") return false;
  if (source !== "startup" && source !== "resume") return false;
  return fetchHeadAgeMs === null || fetchHeadAgeMs > FETCH_FRESH_MS;
}

/** How long ago this checkout last fetched, in ms, or null when it never has. */
export function fetchHeadAgeMs(git, cwd, now = Date.now()) {
  const file = git(["rev-parse", "--git-path", "FETCH_HEAD"]);
  if (!file) return null;
  try {
    return now - statSync(path.resolve(cwd, file)).mtimeMs;
  } catch {
    return null;
  }
}

function fetchAtStart(cwd, git, source) {
  if (!git(["remote", "get-url", "origin"])) return null;
  if (!fetchNeed({ source, fetchHeadAgeMs: fetchHeadAgeMs(git, cwd) })) return null;
  const result = runBounded("git", SESSION_FETCH_ARGS, {
    cwd,
    stdio: "ignore",
    timeoutMs: SESSION_FETCH_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.status === 0 ? "fetched" : "failed";
}

/**
 * **The shared checkout catches up with main.** Every thread loads its hooks and AGENTS.md from
 * the clone the container started with (`/home/claude/diveday`), and that clone stays at the
 * commit it had when the thread was created: on 2026-10-14 one was 659 commits behind and wired
 * 9 hooks against main's 14, so it ran without the push gate. Builds happen in worktrees, so the
 * clone itself is usually clean and detached; at startup and resume this moves it to
 * `origin/main` (just fetched above) when, and only when, nothing could be lost:
 *
 * - it is the main worktree, never a linked one (`git worktree add`), which is someone's work;
 * - HEAD is detached or on `main`, never another branch;
 * - the tree is clean, untracked files included;
 * - no rebase, merge, cherry-pick, revert or bisect is in progress (each can look clean and
 *   detached);
 * - HEAD has no commit that is not already on `origin/main`, so the move is a fast-forward.
 *
 * Anything else, or any git question that fails, leaves the checkout alone and prints nothing.
 *
 * It runs on every prompt too (`source: "prompt"`), without a fetch of its own: the clone's
 * `origin/main` moves whenever any session in it fetches. Startup alone was not enough. A
 * coordinator or a long thread never restarts, and every hook a session runs is read from
 * `$CLAUDE_PROJECT_DIR`, this checkout, on each call. On 2026-10-14 the checkout sat at
 * 81245edd0, before #2584, for hours after #2584 merged, so threads whose own branch had a fixed
 * hook were still refused by the old one.
 *
 * `DIVEDAY_SESSION_FASTFORWARD=0` opts out. `git` and `exists` are injectable for the tests.
 */
const IN_PROGRESS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
];
const FASTFORWARD_TIMEOUT_MS = 60_000;

export function fastForwardPlan(git, { source, env = process.env, exists = existsSync } = {}) {
  try {
    if (env.DIVEDAY_SESSION_FASTFORWARD === "0") return null;
    if (source !== "startup" && source !== "resume" && source !== "prompt") return null;
    const gitDir = git(["rev-parse", "--absolute-git-dir"]);
    const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (!gitDir || !common || path.resolve(gitDir) !== path.resolve(common)) return null;
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== "HEAD" && branch !== "main") return null;
    if (git(["status", "--porcelain"]) !== "") return null;
    if (IN_PROGRESS.some((marker) => exists(path.join(gitDir, marker)))) return null;
    const from = git(["rev-parse", "--verify", "HEAD^{commit}"]);
    const to = git(["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
    if (!from || !to || from === to) return null;
    if (git(["rev-list", "--count", `${to}..${from}`]) !== "0") return null;
    const behind = Number(git(["rev-list", "--count", `${from}..${to}`]));
    if (!Number.isInteger(behind) || behind <= 0) return null;
    return { from, to, behind };
  } catch {
    return null;
  }
}

/** Plans and makes the fast-forward; the plan when HEAD is now `origin/main`, else null. */
export function fastForwardShared(
  cwd,
  { source, env = process.env, git = gitReader(cwd), run = runBounded } = {},
) {
  const plan = fastForwardPlan(git, { source, env });
  if (!plan) return null;
  // Re-read HEAD just before moving it: another session may have checked out a branch or
  // another commit since the plan, and `--ff-only` alone would fast-forward that too.
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (git(["rev-parse", "--verify", "HEAD^{commit}"]) !== plan.from) return null;
  if (branch !== "HEAD" && branch !== "main") return null;
  try {
    // `--ff-only` refuses anything but a fast-forward, a second lock on the plan's checks; on
    // a detached HEAD it moves HEAD and stays detached. `--no-overwrite-ignore` keeps an ignored
    // file (an `.env.local`, say) from being replaced by a path main starts tracking.
    run("git", ["merge", "--ff-only", "--no-overwrite-ignore", "--quiet", "--no-stat", plan.to], {
      cwd,
      stdio: "ignore",
      timeoutMs: FASTFORWARD_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no" },
    });
  } catch {
    return null;
  }
  return git(["rev-parse", "--verify", "HEAD^{commit}"]) === plan.to ? plan : null;
}

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
  const detached = branch === "HEAD";
  const upstream = detached
    ? null
    : git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
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
  // Unpushed is measured against the branch's own upstream when it has one. Against every
  // remote ref at once (`--not --remotes`) a fresh container whose `origin/main` was days old
  // reported "650 unpushed commits" on a detached checkout of a pushed commit; a detached HEAD
  // has nothing to push to, so it gets no count at all. A branch with no upstream yet is the
  // one case `--not --remotes` answers honestly: none of its commits is on any remote branch.
  let unpushed = null;
  if (upstream) unpushed = ahead;
  else if (!detached) {
    const unpushedRaw = git(["rev-list", "--count", "HEAD", "--not", "--remotes"]);
    unpushed = unpushedRaw === null ? null : Number(unpushedRaw);
  }
  const status = git(["status", "--porcelain"]);
  const uncommitted = status === null ? null : status.split("\n").filter(Boolean).length;
  const head = git(["log", "-1", "--format=%h %s"]);
  return { branch, detached, upstream, ahead, behind, unpushed, uncommitted, head };
}

export function pinnedNodeMajor(root) {
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

/**
 * **The author's open pull requests, on every prompt.** Aaron's rule since 2026-10-12 is one
 * pull request's CI at a time, driven by the thread that owns the stack, because concurrent runs
 * cancel each other (AGENTS.md's Parallel work); on 2026-10-12, 126 runs were cancelled and 90
 * jobs failed while 15 to 19 layers ran at once. A session cannot keep to that rule without
 * seeing what is already open, so the per-prompt line says it. Every session pushes as the same
 * GitHub account, so "the author's" is the whole account's count, which is the one that matters.
 *
 * Two REST reads (`gh api user`, then the repository's open pulls), cached in the clone's git
 * common dir for OPEN_PULLS_TTL_MS so most prompts read a file; each read is bounded well under
 * the hook's 10 s timeout, and any failure prints nothing.
 */
export const OPEN_PULLS_TTL_MS = 10 * 60_000;
export const OPEN_PULLS_CACHE = "diveday-open-pulls.json";
const OPEN_PULLS_READ_MS = 3_000;

/** `{ login, numbers }` from GitHub, or null. `run` is `runBounded`'s shape, injectable. */
export function fetchOpenPulls({ run = runBounded, repo = repoSlug() } = {}) {
  const api = (args) => {
    const result = run("gh", ["api", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeoutMs: OPEN_PULLS_READ_MS,
    });
    if (result?.status !== 0) return null;
    try {
      return JSON.parse(String(result.stdout ?? ""));
    } catch {
      return null;
    }
  };
  const login = api(["user"])?.login;
  if (!login) return null;
  const pulls = api([`repos/${repo}/pulls?state=open&per_page=100`]);
  if (!Array.isArray(pulls)) return null;
  const numbers = pulls
    .filter((pull) => pull.user?.login === login)
    .map((pull) => pull.number)
    .sort((a, b) => a - b);
  return { login, numbers };
}

/** The cached record when it is fresh, else a fetched one (written back), else null. */
export function readOpenPulls(
  cacheFile,
  { now = Date.now(), fetch = fetchOpenPulls, read = readFileSync, write = writeFileSync } = {},
) {
  if (cacheFile) {
    try {
      const cached = JSON.parse(read(cacheFile, "utf8"));
      if (now - cached.at <= OPEN_PULLS_TTL_MS && Array.isArray(cached.numbers)) return cached;
    } catch {
      // No cache yet, or a torn one: read GitHub.
    }
  }
  const fetched = fetch();
  if (!fetched) return null;
  const record = { at: now, ...fetched };
  if (cacheFile) {
    try {
      write(cacheFile, JSON.stringify(record));
    } catch {
      // An unwritable cache costs a read next prompt, nothing more.
    }
  }
  return record;
}

/** "2 open PRs by <login> (#1, #2)", or "" when unknown. */
export function openPullsText(record) {
  if (!record?.login || !Array.isArray(record.numbers)) return "";
  const n = record.numbers.length;
  const list = n > 0 ? ` (${record.numbers.map((number) => `#${number}`).join(", ")})` : "";
  return `${n} open PR${n === 1 ? "" : "s"} by ${record.login}${list}`;
}

/**
 * The one-line form for `UserPromptSubmit`: the checkout, then (when there is one) the stack
 * position from `stack-map.mjs` and the author's open pull requests, then (once per session)
 * the previous session's hook refusals and the ask for a papercut when one rule keeps refusing.
 */
export function promptLine(
  state,
  { stack = "", refusals = "", openPulls = "", papercut = "" } = {},
) {
  if (!state) return "";
  const parts = [state.detached ? "git: detached HEAD (no upstream)" : `git: ${state.branch}`];
  if (state.uncommitted !== null) {
    parts.push(state.uncommitted === 0 ? "clean tree" : `${state.uncommitted} uncommitted`);
  }
  if (state.unpushed)
    parts.push(`${state.unpushed} unpushed commit${state.unpushed === 1 ? "" : "s"}`);
  if (state.behind) parts.push(`${state.behind} behind ${state.upstream}`);
  if (stack) parts.push(stack);
  if (openPulls) parts.push(openPulls);
  return [parts.join(" · "), refusals, papercut].filter(Boolean).join("\n");
}

/** The block for `SessionStart`, given the state and the session's `source`. */
export function sessionBlock(
  state,
  {
    source = "startup",
    nodeMajor,
    pinnedMajor,
    installed,
    nodeSelection = null,
    fetched = null,
    fastForwarded = null,
    mergeDrivers = null,
    doctor = [],
  } = {},
) {
  const lines = [];
  if (mergeDrivers === "not installed") {
    lines.push(
      "Merge drivers: not installed (git config failed), so a merge or restack can stop on scripts/ratchets.json and the generated files — run `node scripts/merge-drivers.mjs install`.",
    );
  }
  if (fetched === "failed") {
    lines.push(
      "`git fetch origin main` failed or timed out at session start: origin/main may be stale, so `pnpm verify:push` and `check:closing-keywords` may measure from an old base.",
    );
  }
  if (fastForwarded) {
    lines.push(
      `Fast-forwarded this checkout ${fastForwarded.behind} commit${fastForwarded.behind === 1 ? "" : "s"} to origin/main (${fastForwarded.from.slice(0, 9)} → ${fastForwarded.to.slice(0, 9)}): it was clean, detached or on main, and had nothing main lacks. Hooks and AGENTS.md from disk now match main.`,
    );
  }
  if (state) {
    const upstream = state.upstream
      ? `upstream ${state.upstream}${state.ahead !== null ? ` (${state.ahead} ahead, ${state.behind} behind)` : ""}`
      : state.detached
        ? "detached HEAD, no upstream"
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
      const where = state.upstream ? `not on ${state.upstream}` : "on no remote branch";
      lines.push(
        `${state.unpushed} local commit${state.unpushed === 1 ? " is" : "s are"} ${where} — push before the session ends.`,
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
  lines.push(...doctor);
  lines.push(
    "Path-scoped rules in .claude/rules/ load automatically only in supported hosts; otherwise read matching rules explicitly; the hooks in .claude/settings.json are described in docs/agents/session-hooks.md.",
    // The papercuts log had one entry for a month of visible friction: nothing asked for them.
    "If a guard or hook fights you this session, add a papercut: one file in docs/agents/papercuts/ (docs/agents/papercuts.md).",
  );

  if (source === "compact") {
    lines.push(
      "",
      "After compaction, the rules a summary drops:",
      "- Re-read TaskList; the task list is the queue, a sentence in a message is not.",
      "- Before you commit: the guard you touched, `pnpm test <file>`, `pnpm typecheck`, `pnpm lint`; then push. CI is the gate: fix a red run forward.",
      '- A bug, safety gap or decision you are not acting on becomes a `needs-triage` issue; anything else, a "Notes" comment on the PR. Never a closing remark.',
      "- A turn ends done, filed, or handed over in as many words. Never on an intention.",
      "- Read a large file by range after a Grep, never whole; the hooks refuse the whole-file form.",
    );
  }
  return lines.join("\n");
}

/** The repeated refusal, unless a papercut with its slug is already in the tree. */
export function unwrittenPapercut(repeat, root, { list = readdirSync } = {}) {
  if (!repeat) return null;
  try {
    const written = list(path.join(root, "docs/agents/papercuts"));
    if (written.some((name) => name.endsWith(`-${repeat.slug}.md`))) return null;
  } catch {
    // No papercuts directory: nothing written yet.
  }
  return repeat;
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
  const git = gitReader(cwd);

  if (process.argv.includes("--prompt")) {
    const session = payload.session_id ?? "unknown";
    const log = readLog({ root: cwd });
    const noted = log.some((e) => e.kind === "noted" && e.session === session);
    const summary = lastSessionRefusals(log, session);
    const papercut = noted ? "" : papercutLine(unwrittenPapercut(repeatedRefusal(log), cwd));
    if (summary || papercut) {
      appendEntry({ session, hook: "session-context", kind: "noted" }, { root: cwd });
    }
    const moved = fastForwardShared(cwd, { source: "prompt", git });
    if (moved) {
      process.stdout.write(
        `Fast-forwarded the shared checkout ${moved.behind} commit${moved.behind === 1 ? "" : "s"} to origin/main (${moved.from.slice(0, 9)} → ${moved.to.slice(0, 9)}), so its hooks match main.\n`,
      );
    }
    const common = git(["rev-parse", "--git-common-dir"]);
    const line = promptLine(checkoutState(git), {
      stack: stackSummary(readStack(stackGit(cwd))),
      openPulls:
        process.env.DIVEDAY_OPEN_PULLS === "0"
          ? ""
          : openPullsText(
              readOpenPulls(common ? path.join(path.resolve(cwd, common), OPEN_PULLS_CACHE) : null),
            ),
      refusals: refusalLine(summary),
      papercut,
    });
    if (line) process.stdout.write(`${line}\n`);
    return;
  }

  const source = payload.source ?? payload.how_started ?? "startup";
  // Before reading the state, so ahead/behind and the stack are measured from current refs.
  const fetched = fetchAtStart(cwd, git, source);
  // Before reading the state and before the install, so both see the moved checkout.
  const fastForwarded = fastForwardShared(cwd, { source, git });
  const state = checkoutState(git);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const pinnedMajor = pinnedNodeMajor(cwd);
  // Before the install, so the install runs on the Node the session will use.
  const nodeSelection = selectPinnedNode({ nodeMajor, pinnedMajor });
  const installed = installIfNeeded(cwd);
  // So a restack merge never stops on a generated file (scripts/merge-drivers.mjs).
  const mergeDrivers = installMergeDrivers(cwd) ? "installed" : "not installed";
  const block = sessionBlock(state, {
    source,
    nodeMajor,
    pinnedMajor,
    nodeSelection,
    installed,
    fetched,
    fastForwarded,
    mergeDrivers,
    // After the fetch above, so origin/main's row reads this session's refs.
    // `scheduled`: a nightly red twice running is said here, because nothing else tells a
    // session (scripts/scheduled-runs.mjs).
    doctor: summaryLines(
      gatherFacts(cwd, {
        fetched,
        scheduled: process.env.DIVEDAY_SCHEDULED_RUNS !== "0",
        mergeDriversInstall: mergeDrivers,
        projectDir: cwd,
      }),
    ),
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
