import { describe, expect, it } from "vitest";

import { checkArgs } from "./guard-pr-body.mjs";

describe("which pull request bodies this checkout can check", () => {
  const here = { branch: "claude/layer", fallbackBase: "origin/claude/below" };

  it("checks a new pull request from the branch checked out here, against its named base", () => {
    expect(checkArgs({ head: "claude/layer", base: "claude/below", body: "x" }, here)).toEqual({
      base: "origin/claude/below",
      head: "claude/layer",
    });
  });

  it("checks an edit with no base against the layer below", () => {
    expect(checkArgs({ pullNumber: 1, body: "x" }, here)).toEqual({
      base: "origin/claude/below",
      head: "claude/layer",
    });
  });

  it("leaves alone a pull request for another branch, a title-only edit, and a detached HEAD", () => {
    expect(checkArgs({ head: "claude/elsewhere", base: "main", body: "x" }, here)).toBeNull();
    expect(checkArgs({ pullNumber: 1, title: "t" }, here)).toBeNull();
    expect(checkArgs({ head: "x", body: "x" }, { branch: "HEAD", fallbackBase: null })).toBeNull();
  });
});
