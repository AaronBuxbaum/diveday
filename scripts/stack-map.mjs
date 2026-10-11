#!/usr/bin/env node
// Where this checkout sits in its stack, derived live from git — never from a file that says so.
//
// A Projects thread runs a stack (the stacked-prs skill): layer branches cut one from another,
// and inside a layer, sub-branches (`-l2-core`, `-l2-pixels`) merged back into it. Nothing
// recorded that shape, so every session re-derived "which branch is the top, and what am I
// on top of" from PR bodies and branch names, and 22 of 81 merges between 2026-10-07 and
// 2026-10-10 were those sub-branch merges. Two designs could record it:
//
//   - a committed manifest (`.claude/stack.json`) that each PR updates: one more shared file
//     every layer edits, stale the moment a layer merges or a sub-branch lands, and a merge
//     conflict on every rebase — the problem it exists to remove;
//   - a STACK block in each PR body, read live: a session cannot read PR bodies from a script
//     (`gh` is absent and repo-scoped REST answers 403 in cloud containers — ADR
//     20260907-a-runner-registers-the-stack), so the hooks could never print it.
//
// Git already holds the whole shape. A layer below is a remote branch HEAD contains that main
// does not; a layer above is one that contains HEAD. A layer sits on HEAD's first-parent chain;
// a sub-branch is merged in through a second parent. So this reads the remote refs and asks
// git, and is exactly as fresh as the last fetch — `session-context.mjs` fetches `main` and
// `claude/*` once at session start for that reason. Owned paths are each layer's own diff.
//
//   node scripts/stack-map.mjs           the stack, one line per layer
//   node scripts/stack-map.mjs --json    the same record, machine-readable
//
// Every git call is a constant argument array or one built from git's own output (a ref name
// or sha git printed); nothing from a payload reaches a subprocess.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Refs read per run. A thread with more open branches than this is its own finding. */
const MAX_REFS = 40;
const BASE = "origin/main";
const NOT_LAYERS = new Set(["origin/HEAD", "origin", BASE]);

export function gitReader(cwd) {
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

function refs(output) {
  return (output ?? "")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([name, sha]) => name && sha && !NOT_LAYERS.has(name))
    .slice(0, MAX_REFS)
    .map(([name, sha]) => ({ name, sha }));
}

/**
 * The stack HEAD is in, or null when git cannot answer or there is no `origin/main` to measure
 * from. `git` is injectable (args → trimmed stdout, or null) so the tests need no repository.
 *
 * Returns `{ base, layers, current, top, forks, subBranches }`: `layers` bottom to top, each
 * `{ name, sha, commits }` with `commits` counted from the fork point; `current` is HEAD's index
 * in `layers` (HEAD itself is a layer when no remote ref points at it); `forks` are tips above
 * HEAD that are not the top; `subBranches` are refs merged into a layer at or below HEAD
 * through a second parent.
 */
export function readStack(git, { paths = false } = {}) {
  const head = git(["rev-parse", "HEAD"]);
  if (!head || !git(["rev-parse", "--verify", "--quiet", BASE])) return null;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const format = "--format=%(refname:short)%09%(objectname)";
  const below = refs(
    git(["for-each-ref", format, "--merged", "HEAD", "--no-merged", BASE, "refs/remotes/origin"]),
  );
  const above = refs(git(["for-each-ref", format, "--contains", "HEAD", "refs/remotes/origin"]));

  const chain = new Set((git(["rev-list", "--first-parent", `${BASE}..HEAD`]) ?? "").split("\n"));
  const count = (sha) => Number(git(["rev-list", "--count", `${BASE}..${sha}`]) ?? Number.NaN);

  const layersBelow = [];
  const subBranches = [];
  for (const ref of below) {
    if (ref.sha === head) continue;
    (chain.has(ref.sha) ? layersBelow : subBranches).push(ref);
  }
  const atHead = [...below, ...above].filter((ref) => ref.sha === head).map((ref) => ref.name);
  const current = {
    name: branch && branch !== "HEAD" ? branch : (atHead[0] ?? "HEAD"),
    sha: head,
    here: true,
  };

  // Above HEAD, a layer is a tip no other tip above contains; the rest are layers between.
  const higher = above.filter((ref) => ref.sha !== head);
  const tips = higher.filter(
    (ref) =>
      !higher.some(
        (other) =>
          other.sha !== ref.sha &&
          git(["merge-base", "--is-ancestor", ref.sha, other.sha]) !== null,
      ),
  );
  const withCounts = (list) =>
    list.map((ref) => ({ ...ref, commits: count(ref.sha) })).sort((a, b) => a.commits - b.commits);
  const tipsCounted = withCounts(tips);
  const top = tipsCounted.at(-1) ?? null;
  const between = top
    ? higher.filter(
        (ref) =>
          !tips.includes(ref) &&
          git(["merge-base", "--is-ancestor", ref.sha, top.sha]) !== null &&
          new Set(
            (git(["rev-list", "--first-parent", `${BASE}..${top.sha}`]) ?? "").split("\n"),
          ).has(ref.sha),
      )
    : [];

  const layers = [
    ...withCounts(layersBelow),
    { ...current, commits: count(head) },
    ...withCounts(between),
    ...(top ? [top] : []),
  ];
  // Two remote refs can name one commit (a layer and its PR's merge ref); keep the first.
  const seen = new Set();
  const unique = layers.filter((layer) => {
    if (seen.has(layer.sha) && !layer.here) return false;
    seen.add(layer.sha);
    return true;
  });

  if (paths) {
    for (let i = 0; i < unique.length; i++) {
      const from = i === 0 ? git(["merge-base", BASE, unique[i].sha]) : unique[i - 1].sha;
      const diff = git(["diff", "--name-only", `${from}..${unique[i].sha}`]) ?? "";
      unique[i].paths = ownedPaths(diff.split("\n").filter(Boolean));
    }
  }

  return {
    base: BASE,
    layers: unique,
    current: unique.findIndex((layer) => layer.here),
    top: (top ?? current).name,
    forks: tipsCounted.slice(0, -1).map((ref) => ref.name),
    subBranches: subBranches.map((ref) => ref.name),
  };
}

/** A layer's changed files folded to their two leading segments, most-touched first. */
export function ownedPaths(files, limit = 8) {
  const counts = new Map();
  for (const file of files) {
    const parts = file.split("/");
    const key = parts.length > 2 ? `${parts.slice(0, 2).join("/")}/` : file;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

/** The per-prompt fragment: "" when HEAD is in no stack (nothing below it, nothing above). */
export function stackSummary(stack) {
  if (!stack || stack.layers.length < 2) return "";
  const position = `layer ${stack.current + 1} of ${stack.layers.length}`;
  const atTop = stack.current === stack.layers.length - 1;
  const forks = stack.forks.length > 0 ? `, ${stack.forks.length} other tip(s) above` : "";
  return `stack: ${position}${atTop ? " (top)" : `, top ${stack.top}`}${forks}`;
}

export function renderStack(stack) {
  if (!stack) return "stack: git could not answer, or there is no origin/main to measure from.";
  const lines = [`Stack over ${stack.base}, bottom first:`];
  stack.layers.forEach((layer, index) => {
    const mark = layer.here ? "  <- HEAD" : "";
    lines.push(`  ${index + 1}. ${layer.name} (${layer.commits} commits)${mark}`);
    if (layer.paths?.length) lines.push(`       ${layer.paths.join(" ")}`);
  });
  if (stack.forks.length > 0) lines.push(`Other tips above HEAD: ${stack.forks.join(", ")}`);
  if (stack.subBranches.length > 0)
    lines.push(`Sub-branches merged in: ${stack.subBranches.join(", ")}`);
  lines.push(
    "As fresh as the last fetch: git fetch origin main '+refs/heads/claude/*:refs/remotes/origin/claude/*'",
  );
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = readStack(gitReader(process.cwd()), { paths: true });
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(stack, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderStack(stack)}\n`);
  }
}
