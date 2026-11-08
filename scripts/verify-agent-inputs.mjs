// Hash live tracked and untracked inputs, not merely HEAD or porcelain filenames.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

export function worktreeIdentity(root, git) {
  const tracked = git(["ls-files", "-z"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]);
  const head = git(["rev-parse", "HEAD"]);
  if (tracked === null || untracked === null || !head)
    throw new Error("Cannot fingerprint worktree");
  const hash = createHash("sha256").update(head);
  const files = [...new Set(`${tracked}\0${untracked}`.split("\0").filter(Boolean))].sort();
  for (const file of files) {
    hash.update(`\0${file}\0`);
    try {
      const absolute = path.join(root, file);
      const stat = lstatSync(absolute);
      hash.update(`${stat.mode}\0`);
      hash.update(stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("deleted");
    }
  }
  return hash.digest("hex");
}
