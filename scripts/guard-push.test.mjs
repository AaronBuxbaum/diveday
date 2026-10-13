import { describe, expect, it } from "vitest";

import { OVERRIDE, overrideReason, parsePush, pushViolation } from "./guard-push.mjs";

/**
 * A push guard that refuses something legitimate gets routed around, so the "leaves alone"
 * cases carry as much weight as the refusals.
 */

const answers = (overrides = {}) => ({
  head: () => "aaa111",
  branch: () => "claude/layer",
  sha: (ref) => ({ "claude/other": "bbb222" })[ref] ?? null,
  remoteHas: () => false,
  stamp: () => null,
  ...overrides,
});

describe("an unverified push", () => {
  it("is refused, naming verify:push and the way to say why", () => {
    const reason = pushViolation("git push -u origin claude/layer", answers());
    expect(reason).toMatch(/pnpm verify:push/);
    expect(reason).toContain(`${OVERRIDE}="<reason>" git push -u origin claude/layer`);
  });

  it("is refused inside a chain, after a merge from below made a new HEAD", () => {
    const read = answers({ stamp: () => "old999" });
    expect(
      pushViolation("git merge origin/claude/below && git push -u origin claude/layer", read),
    ).not.toBeNull();
  });

  it("checks the branch a refspec names, not HEAD", () => {
    const read = answers({ stamp: () => "aaa111" });
    expect(pushViolation("git push origin claude/other", read)).toMatch(/bbb222/);
  });

  it("refuses an override with no real reason", () => {
    expect(pushViolation(`${OVERRIDE}=1 git push -u origin claude/layer`, answers())).toMatch(
      /reason/,
    );
  });
});

describe("leaves alone", () => {
  it("a push of the commit the stamp names", () => {
    expect(
      pushViolation("git push -u origin claude/layer", answers({ stamp: () => "aaa111" })),
    ).toBeNull();
  });

  it("a push with a stated reason", () => {
    const command = `${OVERRIDE}="saving work before the container is reclaimed" git push -u origin claude/layer`;
    expect(pushViolation(command, answers())).toBeNull();
  });

  it("a commit the remote already has, a deletion, a tag push", () => {
    expect(
      pushViolation("git push -u origin claude/layer", answers({ remoteHas: () => true })),
    ).toBeNull();
    expect(pushViolation("git push origin --delete claude/old", answers())).toBeNull();
    expect(pushViolation("git push origin :claude/old", answers())).toBeNull();
    expect(pushViolation("git push --tags", answers())).toBeNull();
  });

  it("commands that only mention a push", () => {
    expect(pushViolation(`git stash push -u -m "wip"`, answers())).toBeNull();
    expect(pushViolation(`git log --grep "push"`, answers())).toBeNull();
    expect(pushViolation(`echo "then git push"`, answers())).toBeNull();
  });

  it("reads `git -C <dir> push` as a push", () => {
    expect(parsePush("git -C ../wt push -u origin x")).toMatchObject({
      positional: ["origin", "x"],
    });
  });
});

describe("the reason a push gave for skipping verify:push", () => {
  it("is read back so the hook can log it", () => {
    expect(
      overrideReason(
        `git fetch && ${OVERRIDE}="saving work before the container is reclaimed" git push`,
      ),
    ).toBe("saving work before the container is reclaimed");
  });

  it("is null for a plain push, a non-push, and a reason too short to count", () => {
    expect(overrideReason("git push -u origin claude/layer")).toBeNull();
    expect(overrideReason("git status")).toBeNull();
    expect(overrideReason(`${OVERRIDE}=skip git push`)).toBeNull();
  });
});
