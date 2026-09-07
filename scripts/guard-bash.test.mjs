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
    expect(refuses("DIVEDAY_ALLOW_WHOLE_SUITE=1 pnpm check > /tmp/check.txt 2>&1")).toBe(false);
  });
});

describe("the whole suite, locally", () => {
  it("refuses a bare run of the scripts that belong to CI, naming the focused form", () => {
    expect(violationFor("pnpm test", scripts)).toMatch(/pnpm test <file>/);
    expect(violationFor("pnpm test --reporter=dot", scripts)).toMatch(/test:changed/);
    expect(violationFor("pnpm run test", scripts)).toMatch(/whole suite/);
    expect(violationFor("pnpm e2e", scripts)).toMatch(/pnpm e2e <spec>/);
    expect(violationFor("pnpm e2e:run --reporter=line", new Set([...scripts, "e2e:run"]))).toMatch(
      /e2e:run <spec>/,
    );
    expect(violationFor("pnpm check", scripts)).toMatch(/check:repo/);
    expect(violationFor("pnpm visual", scripts)).toMatch(/CI/);
    expect(violationFor("pnpm exec vitest run", scripts)).toMatch(/whole suite/);
    expect(violationFor("pnpm exec playwright test", scripts)).toMatch(/whole suite/);
  });

  /** Every focused form AGENTS.md and the skills actually ask for. */
  it("leaves a focused run alone", () => {
    expect(refuses("pnpm test src/db/bookings.test.ts --reporter=dot")).toBe(false);
    expect(refuses("pnpm test scripts/guard-bash.test.mjs")).toBe(false);
    expect(refuses("pnpm test:changed")).toBe(false);
    expect(refuses("pnpm test --changed origin/main")).toBe(false);
    expect(refuses("pnpm test -t 'refuses a bare'")).toBe(false);
    expect(refuses("pnpm e2e e2e/booking.spec.ts --reporter=line")).toBe(false);
    expect(refuses("pnpm e2e:run e2e/booking.spec.ts")).toBe(false);
    expect(refuses("pnpm exec vitest run src/lib/trips.test.ts")).toBe(false);
    expect(refuses("pnpm exec vitest run --shard=1/4")).toBe(false);
    expect(refuses("pnpm exec playwright test e2e/visual.spec.ts -g 'orders'")).toBe(false);
    expect(refuses("pnpm check:repo")).toBe(false);
    expect(refuses("pnpm lint && pnpm typecheck")).toBe(false);
  });

  it("honours the override written in front of the command", () => {
    expect(refuses("DIVEDAY_ALLOW_WHOLE_SUITE=1 pnpm test")).toBe(false);
    expect(refuses("CI=1 DIVEDAY_ALLOW_WHOLE_SUITE=1 pnpm check")).toBe(false);
  });

  it("does not mistake a script that is not in package.json for the suite", () => {
    expect(violationFor("pnpm test", new Set(["lint"]))).toBeNull();
  });
});

describe("a generated artifact printed through the shell", () => {
  it("refuses the lockfile, build output, a Drizzle snapshot and a Playwright report", () => {
    expect(violationFor("cat pnpm-lock.yaml", scripts)).toMatch(/grep -n/);
    expect(refuses("head -100 .next/server/app/page.js")).toBe(true);
    expect(refuses("cat drizzle/20260101_x/snapshot.json | jq .tables")).toBe(true);
    expect(refuses("tail -50 playwright-report/index.html")).toBe(true);
    expect(refuses("cat test-results/spec/error-context.md")).toBe(true);
  });

  it("leaves a migration's SQL, a source file, and grep over the artifact alone", () => {
    expect(refuses("cat drizzle/20260101_x/migration.sql")).toBe(false);
    expect(refuses("head -40 src/db/schema.ts")).toBe(false);
    expect(refuses("grep -n 'gear_items' drizzle/20260101_x/snapshot.json")).toBe(false);
    expect(refuses("grep -c '' pnpm-lock.yaml")).toBe(false);
  });
});

describe("discarding a shared working tree", () => {
  const dirty = { changes: () => [" M src/db/schema.ts", "?? scratch.ts"] };
  const clean = { changes: () => [] };

  it("refuses a wholesale discard while the tree has uncommitted changes, and lists them", () => {
    const reason = violationFor("git reset --hard origin/main", scripts, dirty);
    expect(reason).toMatch(/2 uncommitted changes/);
    expect(reason).toContain("src/db/schema.ts");
    expect(violationFor("git checkout .", scripts, dirty)).not.toBeNull();
    expect(violationFor("git checkout -- .", scripts, dirty)).not.toBeNull();
    expect(violationFor("git restore .", scripts, dirty)).not.toBeNull();
    expect(violationFor("git clean -fd", scripts, dirty)).not.toBeNull();
  });

  it("passes the same commands on a clean tree — they discard nothing", () => {
    expect(violationFor("git reset --hard origin/main", scripts, clean)).toBeNull();
    expect(violationFor("git checkout .", scripts, clean)).toBeNull();
    expect(violationFor("git clean -fd", scripts, clean)).toBeNull();
  });

  it("never consults the tree for the ordinary forms", () => {
    const explodes = {
      changes: () => {
        throw new Error("should not be called");
      },
    };
    expect(violationFor("git checkout -b feature/x", scripts, explodes)).toBeNull();
    expect(violationFor("git checkout main", scripts, explodes)).toBeNull();
    expect(violationFor("git restore --staged src/x.ts", scripts, explodes)).toBeNull();
    expect(violationFor("git reset HEAD~1", scripts, explodes)).toBeNull();
    expect(violationFor("git clean -n", scripts, explodes)).toBeNull();
  });

  it("refuses a plain force-push and a push to main, unconditionally", () => {
    expect(violationFor("git push --force origin my-branch", scripts, clean)).toMatch(
      /--force-with-lease/,
    );
    expect(violationFor("git push -f", scripts, clean)).toMatch(/--force-with-lease/);
    expect(violationFor("git push origin main", scripts, clean)).toMatch(/pull request/);
    expect(violationFor("git push origin HEAD:main", scripts, clean)).toMatch(/pull request/);
  });

  it("leaves the documented push forms alone", () => {
    expect(violationFor("git push -u origin claude/my-branch", scripts, clean)).toBeNull();
    expect(
      violationFor("git push --force-with-lease origin claude/my-branch", scripts, clean),
    ).toBeNull();
    expect(violationFor("git push", scripts, clean)).toBeNull();
    // A branch whose *name* ends in main is not main.
    expect(violationFor("git push -u origin claude/fix-domain", scripts, clean)).toBeNull();
  });
});
