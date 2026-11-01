#!/usr/bin/env node
/**
 * Remove checkouts of this repository that nobody is using and that hold nothing unique.
 *
 * Every task an agent starts gets its own worktree or clone, and each one grows a `node_modules`
 * (2-3 GB) and a `.next` (0.7-2 GB). Nothing retired them: on 2026-11-01 the project folder was
 * 31 GB, of which 27 GB was five idle worktrees, and `/private/tmp` held 872 `diveday-*` checkouts
 * (142 GB, all under three days old) with `~/.codex/worktrees` another 31 GB. Git also listed 134
 * worktrees whose directories were already gone.
 *
 * ## What it removes
 *
 * A checkout under one of the roots below is removed only when all of these hold. A checkout that
 * fails any of them is kept, and `--list` says which one:
 *
 * - it is not the checkout the command runs in, nor the repository's main checkout
 * - nothing on the machine has its working directory inside it (read from `lsof`; if that fails,
 *   nothing is removed)
 * - nothing in it has been touched for the idle window (24 hours; `DIVEDAY_CHECKOUT_GC_HOURS`)
 * - `git status` shows no change, tracked or untracked (the `.agents/` and `.codex/` copies a
 *   provider writes into a fresh checkout do not count)
 * - every local branch and `HEAD` is reachable from a remote ref
 *
 * Roots: this repository's `.claude/worktrees/*`, `diveday*` in the system temp directory, and
 * `~/.codex/worktrees/*`. A directory there whose `origin` is not this repository is left alone.
 *
 * ## Usage
 *
 *   node scripts/checkout-gc.mjs            # report what would go and what stays, and why
 *   node scripts/checkout-gc.mjs --apply    # remove, prune dead worktree entries, report space freed
 *   node scripts/checkout-gc.mjs --apply --quiet   # the SessionEnd form: one line, or nothing
 *
 * Fails open: any error exits 0 having removed what it had already finished.
 */

import { existsSync, readdirSync, realpathSync, rmSync, statfsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const HOUR_MS = 3_600_000;
const BUDGET_MS = 40_000;
/** Untracked top-level paths a provider copies into a fresh checkout; not work. */
const PROVIDER_COPIES = [".agents/", ".codex/"];

/** The reason a checkout must stay, or `null` when it can go. */
export function keepReason({ isSelf, inUse, idleMs, windowMs, dirty, unpushed }) {
  if (isSelf) return "this checkout";
  if (inUse) return "a process is working in it";
  if (idleMs < windowMs) return `touched ${humanHours(idleMs)} ago`;
  if (dirty) return "uncommitted changes";
  if (unpushed) return "commits on no remote branch";
  return null;
}

/** True when `git status --porcelain` output has a change that is not a provider copy. */
export function hasWork(porcelain) {
  return porcelain
    .split("\n")
    .filter(Boolean)
    .some((line) => !(line.startsWith("?? ") && PROVIDER_COPIES.includes(line.slice(3))));
}

/** True when `dir` is a working directory of some process listed by `lsof -Fn` output. */
export function inUseByProcess(lsofOutput, dir) {
  return lsofOutput
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1))
    .some((cwd) => cwd === dir || cwd.startsWith(`${dir}/`));
}

export function humanHours(ms) {
  const hours = Math.floor(ms / HOUR_MS);
  return hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

function git(cwd, args) {
  return readBounded("git", args, {
    cwd,
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Commits no remote has. A linked worktree shares its branches with the main checkout, so only its own HEAD counts. */
function unpushed(dir, linked) {
  const refs = linked ? ["HEAD"] : ["--branches", "HEAD"];
  return git(dir, ["log", ...refs, "--not", "--remotes", "-1", "--format=%h"]).trim();
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function listDirs(root, prefix = "") {
  try {
    return readdirSync(root)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(root, name))
      .filter((dir) => existsSync(path.join(dir, ".git")));
  } catch {
    return [];
  }
}

function describe(dir, { mainRoot, selfRoot, cwds, windowMs, now }) {
  const origin = git(dir, ["remote", "get-url", "origin"]).trim();
  if (!/[/:]diveday(\.git)?$/i.test(origin)) return null;
  const gitDir = path.resolve(dir, git(dir, ["rev-parse", "--git-dir"]).trim());
  const touched = Math.max(
    mtime(dir),
    mtime(path.join(gitDir, "HEAD")),
    mtime(path.join(gitDir, "index")),
  );
  const real = realpathSync(dir);
  const linked = statSync(path.join(dir, ".git")).isFile();
  return {
    dir,
    linked,
    reason:
      real === mainRoot
        ? "main checkout"
        : keepReason({
            isSelf: real === selfRoot,
            inUse: cwds === null || inUseByProcess(cwds, real),
            idleMs: now - touched,
            windowMs,
            dirty: hasWork(git(dir, ["status", "--porcelain"])),
            unpushed: unpushed(dir, linked) !== "",
          }),
  };
}

/** macOS keeps agent checkouts in `/private/tmp`, which is not `os.tmpdir()` (`/var/folders/...`). */
function tempRoots() {
  const roots = new Set();
  for (const root of [os.tmpdir(), "/private/tmp", "/tmp"]) {
    try {
      roots.add(realpathSync(root));
    } catch {}
  }
  return [...roots];
}

function freeBytes(target) {
  const stats = statfsSync(target);
  return stats.bavail * stats.bsize;
}

function main(argv) {
  const apply = argv.includes("--apply");
  const quiet = argv.includes("--quiet");
  const windowMs = Number(process.env.DIVEDAY_CHECKOUT_GC_HOURS ?? 24) * HOUR_MS;
  const common = path.resolve(git(process.cwd(), ["rev-parse", "--git-common-dir"]).trim());
  const mainRoot = realpathSync(path.dirname(common));
  const selfRoot = realpathSync(git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim());

  let cwds = null;
  try {
    cwds = readBounded("lsof", ["-a", "-d", "cwd", "-Fn"], {
      timeoutMs: SUBPROCESS_TIMEOUTS.processTable,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {}

  const roots = [
    ...listDirs(path.join(mainRoot, ".claude", "worktrees")),
    ...tempRoots().flatMap((root) => listDirs(root, "diveday")),
    ...listDirs(path.join(os.homedir(), ".codex", "worktrees")),
  ];
  const context = { mainRoot, selfRoot, cwds, windowMs, now: Date.now() };
  const started = Date.now();
  const before = freeBytes(mainRoot);
  const kept = [];
  let removed = 0;

  for (const dir of roots) {
    if (apply && Date.now() - started > BUDGET_MS) break;
    let found;
    try {
      found = describe(dir, context);
    } catch {
      continue;
    }
    if (!found) continue;
    if (found.reason) {
      kept.push(`${found.dir}: ${found.reason}`);
      continue;
    }
    if (!apply) {
      console.log(`would remove ${found.dir}`);
      removed += 1;
      continue;
    }
    try {
      if (found.linked) {
        git(mainRoot, ["worktree", "remove", "--force", found.dir]);
      } else {
        rmSync(found.dir, { recursive: true, force: true });
      }
      removed += 1;
    } catch {
      kept.push(`${found.dir}: removal failed`);
    }
  }
  if (apply) git(mainRoot, ["worktree", "prune"]);

  const freedGb = ((freeBytes(mainRoot) - before) / 1e9).toFixed(1);
  if (!quiet) for (const line of kept) console.log(`kept ${line}`);
  if (apply && removed > 0)
    console.log(`checkout-gc: removed ${removed} idle checkouts, freed ${freedGb} GB`);
  else if (!apply && !quiet)
    console.log(`checkout-gc: ${removed} removable, ${kept.length} kept (--apply removes)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!process.argv.includes("--quiet")) console.error(`checkout-gc: ${error.message}`);
  }
}
