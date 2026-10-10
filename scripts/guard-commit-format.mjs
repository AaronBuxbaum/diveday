#!/usr/bin/env node
// A `PreToolUse` hook on `Bash` that formats what a `git commit` is about to commit, before
// it is committed, so formatting never lands as a commit of its own.
//
// `format-touched.mjs` already runs Biome on every Edit and Write. What it cannot see is a
// file that reached the index another way — a merge from `main`, a `git checkout <ref> --
// <path>`, a file a script wrote — and those are what produced the "Format …" commits and the
// papercut `docs/agents/papercuts/2026-10-03-vendored-config-failed-lint-on-every-layer.md`:
// CI's lint went red on a file no edit had touched, and the fix was one more commit.
//
// So on a command that runs `git commit`, this runs `biome check --write` over the staged
// files Biome handles and re-stages them. Only **fully staged** files: one with unstaged
// changes as well (a partial `git add -p`) is left alone, because formatting the working copy
// and re-adding it would commit the hunks its author deliberately held back. `git commit -a`
// commits the working copy anyway, so there every tracked, modified file counts.
//
// It never refuses. Lint findings Biome cannot fix are the lint job's to report, and a hook
// that blocked a commit on them would be a second, stricter `pnpm lint` nobody asked for. It
// fails open on everything: no Biome binary, an unreadable payload, a git that does not answer.

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** What Biome handles in this repository; the same set as format-touched.mjs. */
const HANDLED = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".css"]);

/**
 * Whether `command` runs `git commit`, and with `-a`/`--all`. A commit inside a compound
 * command (`git add x && git commit -m …`) counts; `git commit` named inside a quoted message
 * of some other command does not, because each segment must *start* with it.
 */
export function commitIn(command) {
  if (typeof command !== "string") return null;
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const words = segment.trim().split(/\s+/);
    let i = 0;
    while (/^[A-Z_][A-Z0-9_]*=/.test(words[i] ?? "")) i++;
    if (words[i] !== "git") continue;
    i++;
    while (words[i] === "-C" || words[i] === "-c") i += 2;
    if (words[i] !== "commit") continue;
    const flags = words.slice(i + 1).filter((word) => word.startsWith("-"));
    const all = flags.some(
      (flag) => flag === "--all" || (/^-[a-zA-Z]+$/.test(flag) && flag.includes("a")),
    );
    return { all };
  }
  return null;
}

/** The staged (or, with `-a`, modified) files to format: Biome-handled, fully staged. */
export function filesToFormat({ staged, unstaged, all }) {
  const held = new Set(unstaged);
  const candidates = all
    ? [...new Set([...staged, ...unstaged])]
    : staged.filter((f) => !held.has(f));
  return candidates.filter(
    (file) => HANDLED.has(path.extname(file)) && !file.includes("node_modules/"),
  );
}

function gitList(cwd, args) {
  try {
    return String(
      readBounded("git", args, {
        cwd,
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  const parsed = JSON.parse(payload);
  if (parsed.tool_name !== "Bash") return;
  const commit = commitIn(parsed.tool_input?.command);
  if (!commit) return;

  const cwd = process.env.CLAUDE_PROJECT_DIR ?? parsed.cwd ?? ROOT;
  const biome = path.join(cwd, "node_modules/.bin/biome");
  if (!existsSync(biome)) return;

  const staged = gitList(cwd, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  const unstaged = gitList(cwd, ["diff", "--name-only", "--diff-filter=ACMR", "-z"]);
  if (staged === null || unstaged === null) return;
  const files = filesToFormat({ staged, unstaged, all: commit.all });
  if (files.length === 0) return;

  // Argument arrays only: the file names come from git, never from the payload.
  runBounded(biome, ["check", "--write", "--no-errors-on-unmatched", "--", ...files], {
    cwd,
    stdio: "ignore",
    timeoutMs: SUBPROCESS_TIMEOUTS.biomeFile,
  });
  if (!commit.all) {
    runBounded("git", ["add", "--", ...files], {
      cwd,
      stdio: "ignore",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open: an unformatted file is CI's to report; a blocked commit would be worse.
  }
  process.exit(0);
}
