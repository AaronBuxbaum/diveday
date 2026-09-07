#!/usr/bin/env node
// A `PreToolUse` hook on `Bash` that refuses three command shapes this repository has
// already been burned by, and names the correct form in the refusal.
//
// All three are written down as hard rules in AGENTS.md, and being written down is not
// what stopped them. Each was followed for a while and then wasn't — a rule in prose is
// only as reliable as the odds that the session reading thirteen thousand words of it
// happens to be holding this particular sentence when it types the command. These three
// are mechanical, so they can be checked mechanically, and once they are the prose can
// stop being load-bearing.
//
//  1. `pnpm <script> -- <args>`. Unlike npm, pnpm *forwards* that `--` into the underlying
//     command instead of consuming it, so vitest/playwright see their own `--` and drop
//     everything after it. Nothing errors: the flags are silently ignored and the full
//     suite runs. CI's unit shards carry a five-line comment about the run where every
//     shard quietly ran the whole suite instead of its quarter.
//
//  2. Bare `git stash` / `git stash pop`. The stash stack is shared across every worktree
//     and every session on this machine, and `pop` takes whatever is on top — which may
//     be another session's uncommitted work. AGENTS.md's Parallel-work section asks for
//     `git stash push -u -m "<tag>"` and `git stash apply <sha>` instead, or better, a WIP
//     commit.
//
//  3. A long-running command piped into `tail` or `head`. Neither can flush, so if the
//     command outlives its tool timeout and is moved to the background, its output file
//     stays *empty* rather than filling in as it runs. That is the first link in the
//     nine-hour wait-loop of 2026-08-15: a `pnpm test` piped through `tail`, backgrounded,
//     watched for a marker that could never arrive.
//
//  4. The whole suite, locally. A bare `pnpm test`, `pnpm e2e`, `pnpm check` or `pnpm visual`
//     with no file, spec or filter runs work that belongs to CI's sharded runners
//     (docs/agents/verifying.md: measured 2026-08-28, twenty minutes local without finishing
//     against a few on CI, and a saturated box starves everything else on it). The focused
//     forms and `pnpm test:changed` are what a session runs. `DIVEDAY_ALLOW_WHOLE_SUITE=1`
//     in front of the command is the escape hatch, for the rare run that is the point.
//
//  5. A generated artifact read through the shell — `cat pnpm-lock.yaml`, `head .next/...`,
//     a Drizzle `snapshot.json`. The Read tool's own guard (`guard-read.mjs`) refuses these;
//     this is the same rule at the other door, so the shell is not the way around it.
//
//  6. A wholesale discard on a dirty tree — `git reset --hard`, `git checkout .`,
//     `git restore .`, `git clean -f`. AGENTS.md's Parallel-work section assumes another
//     session's uncommitted work may be sitting in this checkout, and these are the commands
//     that would throw it away without a trace. On a clean tree they discard nothing and pass;
//     on a dirty one the refusal lists what would be lost. `git push --force` without
//     `--force-with-lease`, and any push to `main`, are refused unconditionally: one
//     overwrites a branch somebody else may have advanced, the other skips the pull request.
//
// The contract is Claude Code's: JSON on stdin, exit 2 with the reason on stderr to block,
// exit 0 to stay out of the way. It **fails open** on anything it does not understand —
// unparseable payload, unexpected shape, its own bug — because a guard that blocks the
// session because it broke is worse than the thing it prevents.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The escape hatch for rule 4, written in front of the command like any other variable. */
export const WHOLE_SUITE_OVERRIDE = "DIVEDAY_ALLOW_WHOLE_SUITE=1";

/** Package scripts that run a whole suite when handed nothing to focus on. */
const WHOLE_SUITE_SCRIPTS = new Set(["test", "e2e", "e2e:run", "check", "visual"]);

/** Flags that narrow a run to something a session can wait for. */
const FOCUS_FLAGS =
  /^(?:--changed|--related|--shard|-t|--testNamePattern|-g|--grep|--project|--last-failed)(?:=|$)/;

/** Generated artifacts nobody reads whole; the shell's half of `guard-read.mjs`. */
const GENERATED_ARTIFACT =
  /(?:^|[\s/])(?:pnpm-lock\.yaml|\.next\/|playwright-report\/|test-results\/|drizzle\/[^\s]*\/(?:snapshot|_journal)\.json)/;

/** Commands whose only purpose is to print a file. */
const PRINTERS = /^(?:cat|head|tail|less|more|bat)\b/;

function workingTreeChanges() {
  const status = readBounded("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return status.split("\n").filter(Boolean);
}

/** Commands whose output an agent has to wait minutes for. */
const LONG_RUNNING = [
  /\bpnpm\s+(test|check|build|dev|e2e|visual)\b/,
  /\bpnpm\s+(e2e|visual|test|check):[\w-]+/,
  /\b(vitest|playwright|next)\s+(run|test|build|dev)\b/,
  /\bpnpm\s+exec\s+(vitest|playwright|tsc)\b/,
];

/**
 * A `--` on its own, outside quotes. Written as a scan rather than a regex over the whole
 * string so an argument that legitimately *contains* `--` (a `--flag`, a `-- ` inside a
 * commit message) cannot be mistaken for the separator token.
 */
function hasBareDoubleDash(segment) {
  return segment
    .split(/\s+/)
    .slice(1)
    .some((token) => token === "--");
}

/**
 * The command with every heredoc body and quoted region blanked out, so a pattern is only
 * ever matched against text the shell would run.
 *
 * This is not a refinement, it is the difference between a guard and a nuisance. Writing
 * this file found out the hard way: a `python3 - <<'PY'` whose heredoc *documents* the
 * refused shape, and a `node -e '...'` whose script mentions it in a string, were both
 * refused as if they were pipelines. A guard that blocks the sentence describing the rule
 * is a guard people learn to route around, and a routed-around guard protects nothing.
 *
 * The cost is a shell-in-a-string (`sh -c "pnpm test | tail"`) going unrefused. That trade
 * is deliberate and one way round only: a false negative costs one uncaught command, a
 * false positive costs the guard its credibility.
 */
function withoutInertText(command) {
  const blank = (match) => " ".repeat(match.length);
  return (
    command
      // Heredocs first — a heredoc body can itself contain quotes that would otherwise
      // unbalance the quote scan below.
      .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?^\s*\2\s*$/gm, blank)
      .replace(/'[^']*'|"[^"]*"/g, blank)
  );
}

function packageScripts(root = ROOT) {
  try {
    return new Set(
      Object.keys(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts ?? {}),
    );
  } catch {
    return new Set();
  }
}

/**
 * The left-hand side of a pipe, with any redirection it already carried stripped, so the
 * suggested replacement is something a reader can paste rather than a command wearing a
 * stray `2>&1` in front of the `>` this guard is about to add.
 */
function withoutRedirection(command) {
  return command
    .replace(/\s*\d?>&\d/g, "")
    .replace(/\s*\d?>>?\s*\S+/g, "")
    .trim();
}

/** Split on `;`, `&&`, `||`, and newlines so each simple command is judged on its own. */
function segments(command) {
  return command
    .split(/\n|;|&&|\|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The tokens after a leading run of `NAME=value` assignments. */
function withoutEnvAssignments(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[index])) index += 1;
  return tokens.slice(index);
}

/**
 * Whether a whole-suite script was handed nothing to focus on: no positional argument and no
 * flag that narrows the run. `--reporter=dot` narrows nothing.
 */
function isUnfocused(args) {
  return !args.some((token) => !token.startsWith("-") || FOCUS_FLAGS.test(token));
}

/**
 * Rule 4's refusal for one segment, or null. Split out because it looks at three different
 * command shapes — a package script, `pnpm exec vitest run`, `pnpm exec playwright test` —
 * that share one reason.
 */
function wholeSuiteViolation(segment, scripts) {
  const tokens = segment.split(/\s+/);
  if (tokens.includes(WHOLE_SUITE_OVERRIDE)) return null;
  const command = withoutEnvAssignments(tokens);
  if (command[0] !== "pnpm") return null;

  let script = null;
  let args = [];
  if (command[1] === "exec" && command[2] === "vitest" && command[3] === "run") {
    script = "test";
    args = command.slice(4);
  } else if (command[1] === "exec" && command[2] === "playwright" && command[3] === "test") {
    script = "e2e";
    args = command.slice(4);
  } else {
    const name = command[1] === "run" ? command[2] : command[1];
    if (!WHOLE_SUITE_SCRIPTS.has(name) || !scripts.has(name)) return null;
    script = name;
    args = command.slice(command[1] === "run" ? 3 : 2);
  }
  if (!isUnfocused(args)) return null;

  const focused = {
    test: "`pnpm test <file> --reporter=dot` for the test you are iterating on and `pnpm test:changed` before you push",
    e2e: "`pnpm e2e <spec> --reporter=line` (or `pnpm e2e:run <spec>` after one `pnpm e2e:build`)",
    "e2e:run": "`pnpm e2e:run <spec> --reporter=line`",
    check:
      "`pnpm check:repo`, `pnpm lint`, `pnpm typecheck` and `pnpm test:changed` — the four local halves of the gate",
    visual: "a filtered visual-spec run (see the verify skill), or push and read CI's report",
  }[script];
  return (
    `\`${segment}\` runs the whole suite on this box. That work belongs to CI, which shards it across ` +
    `dedicated runners while a local run saturates the machine for twenty minutes and starves everything ` +
    `else on it (docs/agents/verifying.md). Run ${focused}. If the whole run is genuinely the point, ` +
    `say so in front of the command: \`${WHOLE_SUITE_OVERRIDE} ${segment}\`.`
  );
}

/**
 * Rule 6's refusal for one segment, or null. `changes` is the working tree's `git status
 * --porcelain` lines, computed lazily and only for a command that would discard them.
 */
function discardViolation(segment, changes) {
  const tokens = withoutEnvAssignments(segment.split(/\s+/));
  if (tokens[0] !== "git") return null;
  const [, subcommand, ...rest] = tokens;

  if (subcommand === "push") {
    const force = rest.some((token) => token === "--force" || token === "-f");
    if (force && !rest.some((token) => token.startsWith("--force-with-lease"))) {
      return (
        `\`${segment}\` — \`--force\` overwrites whatever the branch holds now, including a commit another session or ` +
        `a reviewer pushed since you last fetched. Use \`--force-with-lease\`, which refuses exactly that case.`
      );
    }
    const toMain = rest.some(
      (token) => token === "main" || token.endsWith(":main") || token === "refs/heads/main",
    );
    if (toMain) {
      return (
        `\`${segment}\` pushes to \`main\`. Nothing lands on \`main\` except through a pull request ` +
        `(AGENTS.md, Parallel work) — push your branch with \`git push -u origin <branch>\` and open one.`
      );
    }
    return null;
  }

  const wholesale =
    (subcommand === "reset" && rest.includes("--hard")) ||
    // `git checkout .` and `git checkout -- .` (never `git checkout <branch>`).
    (subcommand === "checkout" && rest.length > 0 && rest[rest.length - 1] === ".") ||
    (subcommand === "restore" && rest.some((token) => token === "." || token === ":/")) ||
    (subcommand === "clean" &&
      rest.some((token) => /^-[a-zA-Z]*f/.test(token) || token === "--force"));
  if (!wholesale) return null;

  const dirty = changes();
  if (dirty.length === 0) return null;
  const listed = dirty.slice(0, 8).join(", ");
  const more = dirty.length > 8 ? `, and ${dirty.length - 8} more` : "";
  return (
    `\`${segment}\` would discard ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} in this checkout ` +
    `(${listed}${more}), and AGENTS.md's Parallel-work section assumes some of them may belong to another session. ` +
    `Commit yours as a WIP first, or move the experiment to a \`git worktree\`; on a clean tree this command passes.`
  );
}

/**
 * The reason this command is refused, or null. Exported for the tests: what matters about
 * this guard is not that it blocks but that it never blocks something legitimate — a guard
 * that cries wolf gets worked around, and then it protects nothing.
 *
 * `changes` is how the tests stand in a working tree without needing one on disk.
 */
export function violationFor(
  command,
  scripts = packageScripts(),
  { changes = workingTreeChanges } = {},
) {
  for (const segment of segments(withoutInertText(command))) {
    const pnpmScript = segment.match(/^pnpm\s+(?:run\s+)?([\w:.-]+)\b/);
    if (pnpmScript && scripts.has(pnpmScript[1]) && hasBareDoubleDash(segment)) {
      return (
        `\`${segment}\` — pnpm forwards that bare \`--\` into the underlying command instead of consuming it, ` +
        `so vitest/playwright see their own \`--\` and silently drop every flag after it. Nothing errors; the ` +
        `filters are ignored and the full run happens instead. Pass the arguments directly: ` +
        `\`pnpm ${pnpmScript[1]} ${segment
          .split(/\s+/)
          .filter((token) => token !== "--")
          .slice(2)
          .join(" ")}\`.`
      );
    }

    const stash = segment.match(/^git\s+stash(?:\s+([\w-]+))?/);
    if (stash) {
      const subcommand = stash[1];
      const isBare = subcommand === undefined;
      const isPop = subcommand === "pop";
      const isUnlabelledPush = subcommand === "push" && !/\s-m\b|--message\b/.test(segment);
      if (isBare || isPop || isUnlabelledPush) {
        return (
          `\`${segment}\` — the stash stack is shared with the main checkout and every other worktree on this ` +
          `machine, and another session may push or pop it while you work. ${isPop ? "`pop` takes whatever is on top, which may be their work, and drops the entry either way." : "An unlabelled entry is one you cannot find again once somebody else pushes on top of it."} ` +
          `Prefer a temporary WIP commit. If you must stash: \`git stash push -u -m "<unique-tag>"\`, capture your ` +
          `entry's sha from \`git stash list --format='%H %gs'\`, and restore with \`git stash apply <sha>\`.`
        );
      }
    }

    if (
      /\|\s*(tail|head)\b/.test(segment) &&
      LONG_RUNNING.some((pattern) => pattern.test(segment))
    ) {
      return (
        `\`${segment}\` — never pipe a long-running command through \`tail\` or \`head\`. Neither can flush, so ` +
        `if this outlives its tool timeout and is moved to the background, its output file stays *empty* rather ` +
        `than filling in as it runs, and anything waiting on that file waits forever (AGENTS.md's hard rule; the ` +
        `nine-hour wait-loop of 2026-08-15 started here). Redirect to a file and read it instead — ` +
        `\`${withoutRedirection(segment.split("|")[0])} > /tmp/out.txt 2>&1\` — or filter with \`grep --line-buffered\`.`
      );
    }

    const wholeSuite = wholeSuiteViolation(segment, scripts);
    if (wholeSuite) return wholeSuite;

    const printed = segment
      .split("|")
      .map((part) => part.trim())
      .find((part) => PRINTERS.test(part) && GENERATED_ARTIFACT.test(part));
    if (printed) {
      return (
        `\`${printed}\` prints a generated artifact whole — the lockfile, build output, a Drizzle snapshot or a ` +
        `Playwright report is thousands of lines nobody reads (AGENTS.md, "Context economy"). For a specific ` +
        `lookup, \`grep -n\` it for the line you need; \`src/db/schema.ts\` is the schema's source of truth.`
      );
    }

    const discard = discardViolation(segment, changes);
    if (discard) return discard;
  }
  return null;
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;

  const parsed = JSON.parse(payload);
  if (parsed.tool_name !== "Bash") return;
  const command = parsed.tool_input?.command;
  if (typeof command !== "string") return;

  const reason = violationFor(command);
  if (!reason) return;

  console.error(`Refused by scripts/guard-bash.mjs: ${reason}`);
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
