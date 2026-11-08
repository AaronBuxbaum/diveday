import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { worktreeIdentity } from "./verify-agent-inputs.mjs";

it("fingerprints content edits, untracked additions and deletion even without a HEAD change", () => {
  const root = mkdtempSync(path.join(tmpdir(), "agent-inputs-"));
  const git = (args) =>
    args[0] === "rev-parse" ? "head" : args.includes("--others") ? "new\0" : "tracked\0";
  try {
    writeFileSync(path.join(root, "tracked"), "first");
    const first = worktreeIdentity(root, git);
    writeFileSync(path.join(root, "tracked"), "other");
    const second = worktreeIdentity(root, git);
    expect(second).not.toBe(first);
    writeFileSync(path.join(root, "new"), "untracked");
    const third = worktreeIdentity(root, git);
    expect(third).not.toBe(second);
    rmSync(path.join(root, "tracked"));
    expect(worktreeIdentity(root, git)).not.toBe(third);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses git enumeration failure", () => {
  expect(() => worktreeIdentity(".", () => null)).toThrow(/fingerprint/);
});
