import { describe, expect, it } from "vitest";

import { violationFor } from "./guard-bash.mjs";

/**
 * What matters about a guard that blocks a tool call is not the blocking. It is that it
 * never blocks something legitimate: a guard that cries wolf gets routed around, and a
 * guard that gets routed around protects nothing. So the "leaves alone" cases below carry
 * at least as much weight as the refusals, and each one is a command shape that appears in
 * this repository's own docs, scripts, or CI.
 */

const scripts = new Set(["test", "check", "lint", "typecheck", "build", "dev", "e2e", "visual"]);
const refuses = (command) => violationFor(command, scripts) !== null;

describe("the pnpm `--` forwarding trap", () => {
  it("refuses a bare `--` after a package script, and names the fix", () => {
    const reason = violationFor("pnpm test -- src/db/bookings.test.ts --reporter=dot", scripts);
    expect(reason).toMatch(/silently drop/);
    // The refusal is only useful if it hands back the command the session meant to run.
    expect(reason).toContain("pnpm test src/db/bookings.test.ts --reporter=dot");
  });

  /**
   * The four shapes that contain `--` and are all correct. `pnpm install
   * --frozen-lockfile` is in the permission allowlist; `git log -- <path>` is how you
   * scope a log to a file, and its `--` is git's own path separator.
   */
  it("leaves every legitimate `--` alone", () => {
    expect(refuses("pnpm test src/foo.test.ts --reporter=dot")).toBe(false);
    expect(refuses("pnpm install --frozen-lockfile")).toBe(false);
    expect(refuses("git log --oneline -- src/db/schema.ts")).toBe(false);
    expect(refuses("pnpm exec vitest run --shard=1/4")).toBe(false);
  });

  it("looks at every command in a chain, not only the first", () => {
    expect(refuses("pnpm lint && pnpm test -- src/foo.test.ts")).toBe(true);
  });
});

describe("the shared stash stack", () => {
  it("refuses the two forms that take or leave an unfindable entry", () => {
    expect(refuses("git stash")).toBe(true);
    expect(refuses("git stash pop")).toBe(true);
    expect(refuses("git stash push -u")).toBe(true);
  });

  /**
   * The labelled push and the sha-addressed apply are exactly what AGENTS.md asks for
   * instead — refusing them would refuse the documented remedy.
   */
  it("allows the labelled push, the sha-addressed apply, and the read-only forms", () => {
    expect(refuses('git stash push -u -m "context-budget-wip"')).toBe(false);
    expect(refuses("git stash apply 8f3c1de")).toBe(false);
    expect(refuses("git stash list --format='%H %gs'")).toBe(false);
    expect(refuses("git stash show -p")).toBe(false);
  });
});

describe("piping a long run through tail", () => {
  it("refuses it for the commands that take minutes", () => {
    expect(refuses("pnpm check 2>&1 | tail -40")).toBe(true);
    expect(refuses("pnpm e2e:run e2e/booking.spec.ts | tail -20")).toBe(true);
    expect(refuses("pnpm exec vitest run | head -30")).toBe(true);
  });

  it("says what to do instead, since the shape itself is the habit", () => {
    expect(violationFor("pnpm test | tail -5", scripts)).toMatch(/> \/tmp\/out\.txt|line-buffered/);
  });

  it("suggests a pasteable command, not one still wearing the redirect it had", () => {
    expect(violationFor("pnpm check --foo 2>&1 | tail -3", scripts)).toContain(
      "`pnpm check --foo > /tmp/out.txt 2>&1`",
    );
  });

  /**
   * Both of these were caught live, by this guard, while this guard was being written: a
   * `python3 - <<'PY'` heredoc whose body *documented* the refused shape, and a `node -e`
   * whose script mentioned it inside a string. Neither is a pipeline, and a guard that
   * refuses the sentence explaining the rule is one people learn to route around.
   */
  it("does not read a heredoc body or a quoted string as a command", () => {
    const heredoc = ["python3 - <<'PY'", "# never write: pnpm test | tail -5", "PY"].join("\n");
    expect(refuses(heredoc)).toBe(false);
    expect(refuses(`node -e 'console.log("pnpm test | tail -6")'`)).toBe(false);
    expect(refuses(`git commit -m "stop piping pnpm test | tail"`)).toBe(false);
    expect(refuses(`git commit -m "a note about pnpm test -- args"`)).toBe(false);
  });

  /**
   * `tail` is not the problem; `tail` on something that might outlive its timeout is. A
   * git log or a file read through `head` is instantaneous and unremarkable.
   */
  it("leaves fast commands piped through tail alone", () => {
    expect(refuses("git log --oneline -20 | head -5")).toBe(false);
    expect(refuses("cat AGENTS.md | tail -40")).toBe(false);
    expect(refuses("pnpm check > /tmp/check.txt 2>&1")).toBe(false);
  });
});
