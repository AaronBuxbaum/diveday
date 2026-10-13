#!/usr/bin/env node
// A `PreToolUse` hook on `Bash` that refuses a `git push` of a commit `pnpm verify:push` has not
// passed, and names the command that would.
//
// The verify skill always said to run the checks before pushing. Between 2026-10-09 and
// 2026-10-12, 90 CI jobs failed on the open stack anyway, almost all on breaks a local run
// would have shown (docs/agents/verifying.md#the-pre-push-gate). A checklist in prose is
// followed until the moment it isn't — a long round, a merge from the layer below after the
// checks already ran, a subagent that never loaded the skill. So the checklist is now one
// command that leaves a stamp (`scripts/verify-push.mjs`), and this reads the stamp.
//
// The stamp names one commit. A new commit, a merge from below, an amend: each is a new sha and
// needs a new run, which is the point — the Typecheck failures of 2026-10-12 came in through a
// merge after the layer's own checks had passed.
//
// The way past it is written in front of the command, with a reason a reviewer can read:
//
//   DIVEDAY_PUSH_UNVERIFIED="saving work before the container is reclaimed" git push -u origin <branch>
//
// Left alone: a push of a commit the remote already has, a branch deletion, a tag push, and a
// push in any directory that is not this repository's checkout or one of its worktrees.
//
// The contract is Claude Code's: JSON on stdin, exit 2 with the reason on stderr to block, exit 0
// to stay out of the way. It fails open on anything it does not understand.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { recordOverride, recordRefusal } from "./hook-log.mjs";
import { gitReader } from "./stack-map.mjs";

export const OVERRIDE = "DIVEDAY_PUSH_UNVERIFIED";

/** A reason shorter than this is "skip", not a reason. */
const MIN_REASON = 10;

const STAMP = "diveday-verified.json";

function segments(command) {
  return command
    .split(/\n|;|&&|\|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The `git push` in one shell segment: its override reason (or null), and the refspecs and flags
 * after `push`. Null when the segment is not a push.
 */
export function parsePush(segment) {
  let rest = segment;
  let reason = null;
  for (;;) {
    const match = rest.match(/^([A-Z_][A-Z0-9_]*)=("[^"]*"|'[^']*'|\S*)\s+/);
    if (!match) break;
    if (match[1] === OVERRIDE) reason = match[2].replace(/^["']|["']$/g, "").trim();
    rest = rest.slice(match[0].length);
  }
  const tokens = rest.split(/\s+/);
  if (tokens[0] !== "git") return null;
  let i = 1;
  while (tokens[i] === "-C" || tokens[i] === "-c") i += 2;
  if (tokens[i] !== "push") return null;
  const after = tokens.slice(i + 1);
  return {
    reason,
    flags: after.filter((token) => token.startsWith("-")),
    positional: after.filter((token) => !token.startsWith("-")),
  };
}

/**
 * Why `command` may not run, or null. `read` answers from git: `head()`, `branch()`,
 * `sha(ref)`, `remoteHas(sha)` and `stamp()` (the verified sha, or null).
 */
export function pushViolation(command, read) {
  if (typeof command !== "string") return null;
  for (const segment of segments(command)) {
    const push = parsePush(segment);
    if (!push) continue;
    if (push.reason !== null) {
      if (push.reason.length >= MIN_REASON) continue;
      return `\`${OVERRIDE}\` needs a reason a reviewer can read (at least ${MIN_REASON} characters), in quotes: \`${OVERRIDE}="why this push skips verify:push" ${segment.replace(/^.*?git /, "git ")}\`.`;
    }
    if (push.flags.some((flag) => flag === "--delete" || flag === "-d" || flag === "--tags")) {
      continue;
    }
    const refspecs = push.positional.slice(1);
    if (refspecs.some((spec) => spec.startsWith(":"))) continue;
    const named = refspecs.map((spec) => spec.split(":")[0].replace(/^\+/, ""));
    const sources = named.length > 0 ? named : ["HEAD"];
    for (const source of sources) {
      const sha = source === "HEAD" || source === read.branch() ? read.head() : read.sha(source);
      if (!sha) continue;
      if (read.remoteHas(sha)) continue;
      if (read.stamp() === sha) continue;
      return (
        `\`${segment}\` pushes ${sha.slice(0, 9)}, which \`pnpm verify:push\` has not passed. ` +
        "Run it (in the background: it builds and runs the Playwright specs your diff reaches), " +
        "fix what it finds, and push once it says green. Each red CI run costs the whole stack a " +
        `cycle (docs/agents/verifying.md#the-pre-push-gate). To push anyway — work saved before ` +
        `the container is reclaimed, or a push to learn what only CI can answer — say why in front of it: ` +
        `\`${OVERRIDE}="<reason>" ${segment.replace(/^.*?git /, "git ")}\`, and say so in the PR.`
      );
    }
  }
  return null;
}

/** The reason a push in `command` gives for skipping verify:push, when it is long enough to count. */
export function overrideReason(command) {
  if (typeof command !== "string") return null;
  for (const segment of segments(command)) {
    const push = parsePush(segment);
    if (push?.reason && push.reason.length >= MIN_REASON) return push.reason;
  }
  return null;
}

/** The answers `pushViolation` needs, from the repository at `cwd`. */
export function gitAnswers(cwd) {
  const git = gitReader(cwd);
  return {
    head: () => git(["rev-parse", "HEAD"]),
    branch: () => git(["rev-parse", "--abbrev-ref", "HEAD"]),
    sha: (ref) =>
      /^[\w./~^-]+$/.test(ref)
        ? git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
        : null,
    remoteHas: (sha) =>
      Boolean(git(["branch", "-r", "--contains", sha, "--format=%(refname:short)"])),
    stamp: () => {
      const file = git(["rev-parse", "--git-path", STAMP]);
      if (!file) return null;
      try {
        return JSON.parse(readFileSync(path.resolve(cwd, file), "utf8")).sha ?? null;
      } catch {
        return null;
      }
    },
  };
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  const parsed = JSON.parse(payload);
  if (parsed.tool_name !== "Bash") return;
  const command = parsed.tool_input?.command;
  if (typeof command !== "string" || !/\bgit\b[^\n]*\bpush\b/.test(command)) return;
  const cwd = parsed.cwd ?? process.cwd();
  const reason = pushViolation(command, gitAnswers(cwd));
  const override = overrideReason(command);
  if (!reason && override) {
    recordOverride("guard-push", override, {
      session: parsed.session_id,
      detail: gitAnswers(cwd).head(),
    });
  }
  if (!reason) return;
  recordRefusal("guard-push", reason, { session: parsed.session_id });
  console.error(`Refused by scripts/guard-push.mjs: ${reason}`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open, always and deliberately. See the module comment.
    process.exit(0);
  }
}
