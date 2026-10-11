import { describe, expect, it } from "vitest";

import { commitIn, filesToFormat } from "./guard-commit-format.mjs";

describe("commitIn", () => {
  it("finds a commit in a compound command and resolves its directory", () => {
    expect(commitIn("git add x && git commit -m 'y'", "/repo")).toEqual({
      all: false,
      dir: "/repo",
    });
    expect(commitIn("cd /wt && git commit -am y", "/repo")).toEqual({ all: true, dir: "/wt" });
    expect(commitIn("git -C ../wt commit --all -m y", "/repo/sub")).toEqual({
      all: true,
      dir: "/repo/wt",
    });
    expect(commitIn("GIT_EDITOR=true git -c a=b commit", "/repo")).toEqual({
      all: false,
      dir: "/repo",
    });
  });

  it("ignores a commit named inside another command, and anything else", () => {
    expect(commitIn('echo "git commit -m x"', "/repo")).toBeNull();
    expect(commitIn("git status", "/repo")).toBeNull();
    expect(commitIn(undefined, "/repo")).toBeNull();
  });

  it("does not guess a directory the shell would expand", () => {
    expect(commitIn("cd $WT && git commit -m x", "/repo")?.dir).toBeNull();
    expect(commitIn("git -C ~/wt commit -m x", "/repo")?.dir).toBeNull();
    expect(commitIn("cd && git commit -m x", "/repo")?.dir).toBeNull();
  });

  it("does not read -m's argument as -a", () => {
    expect(commitIn("git commit --amend -m x", "/repo")?.all).toBe(false);
  });
});

describe("filesToFormat", () => {
  it("formats fully staged files Biome handles", () => {
    expect(filesToFormat({ staged: ["a.ts", "b.md", "c.json"], unstaged: [], all: false })).toEqual(
      ["a.ts", "c.json"],
    );
  });

  it("leaves a partly staged file alone", () => {
    expect(filesToFormat({ staged: ["a.ts", "b.ts"], unstaged: ["b.ts"], all: false })).toEqual([
      "a.ts",
    ]);
  });

  it("with -a, takes every modified file", () => {
    expect(filesToFormat({ staged: ["a.ts"], unstaged: ["b.ts", "c.txt"], all: true })).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});
