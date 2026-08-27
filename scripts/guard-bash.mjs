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
// The contract is Claude Code's: JSON on stdin, exit 2 with the reason on stderr to block,
// exit 0 to stay out of the way. It **fails open** on anything it does not understand —
// unparseable payload, unexpected shape, its own bug — because a guard that blocks the
// session because it broke is worse than the thing it prevents.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * The reason this command is refused, or null. Exported for the tests: what matters about
 * this guard is not that it blocks but that it never blocks something legitimate — a guard
 * that cries wolf gets worked around, and then it protects nothing.
 */
export function violationFor(command, scripts = packageScripts()) {
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
