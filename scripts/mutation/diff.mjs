// The lines a branch added or changed, from `git diff -U0 --no-renames <base>...HEAD`, on the
// new side (ADR 20261122-diff-mutation-testing). A deleted file produces nothing; a renamed file
// is a deletion plus an addition, so the new path is drilled whole, like any added file.

import { readBounded, SUBPROCESS_TIMEOUTS } from "../subprocess.mjs";

/** `Map<path, Set<line>>` from the text of a `-U0` unified diff. */
export function changedLines(diffText) {
  const changed = new Map();
  let current = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      current = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (current && !changed.has(current)) changed.set(current, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n += 1) changed.get(current).add(n);
    }
  }
  for (const [file, lines] of changed) if (lines.size === 0) changed.delete(file);
  return changed;
}

/** The `-U0` diff of `files` between the merge base of `base` and HEAD, and HEAD. */
export function gitDiff(root, base, files) {
  if (files.length === 0) return "";
  return readBounded(
    "git",
    ["diff", "-U0", "--no-renames", "--no-color", `${base}...HEAD`, "--", ...files],
    {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

/** Every path the branch touched since the merge base with `base`. */
export function gitChangedFiles(root, base) {
  return readBounded("git", ["diff", "--name-only", "--no-renames", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}

/** The commit HEAD names, or `null` outside a repository. */
export function gitHead(root, ref = "HEAD") {
  try {
    return readBounded("git", ["rev-parse", ref], {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
