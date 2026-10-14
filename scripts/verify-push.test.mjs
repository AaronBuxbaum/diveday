import { describe, expect, it } from "vitest";

import {
  appTreeKey,
  browserSpecs,
  excerpt,
  plan,
  REACH_BUDGET_MS,
  sourceScanTests,
  writeStamps,
} from "./verify-push.mjs";

const names = (steps) => steps.map((step) => step.name);
const base = { specs: [], scans: ["src/components/ui/form.test.tsx"] };

describe("the pre-push plan", () => {
  it("runs every local check CI's red jobs came from, cheapest first", () => {
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs: ["e2e/a.spec.ts"] });
    expect(names(steps)).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
      "source scans",
      "related tests",
      "e2e build",
      "e2e specs",
    ]);
    expect(steps.find((s) => s.name === "related tests").args).toContain("src/lib/x.ts");
    expect(steps.at(-1).args).toContain("e2e/a.spec.ts");
  });

  it("names the schema guards instead of a --changed run that would be the whole suite", () => {
    const steps = plan({ ...base, changed: ["src/db/schema/trips.ts"] });
    expect(names(steps)).toContain("schema guards");
    expect(names(steps)).not.toContain("related tests");
  });

  it("regenerates the export snapshot only when seed, schema or export changed", () => {
    expect(plan({ ...base, changed: ["src/db/seed-trips.ts"] })[0].args).toEqual(["regen"]);
    expect(plan({ ...base, changed: ["src/lib/x.ts"] })[0].args).toEqual([
      "regen",
      "--no-snapshot",
    ]);
  });

  it("stops at the static checks for a docs-only diff, as CI does", () => {
    expect(names(plan({ ...base, changed: ["docs/agents/verifying.md", "AGENTS.md"] }))).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
    ]);
  });
});

describe("the related tests", () => {
  it("follow the changed code only, so a package.json edit does not select the whole suite", () => {
    const steps = plan({
      ...base,
      changed: ["package.json", "scripts/a.mjs", "scripts/gone.mjs"],
      existing: (f) => f !== "scripts/gone.mjs",
    });
    const related = steps.find((s) => s.name === "related tests");
    expect(related.args).toContain("scripts/a.mjs");
    expect(related.args).not.toContain("package.json");
    expect(related.args).not.toContain("scripts/gone.mjs");
  });
});

describe("the source scans", () => {
  it("include the tests that read files and that vitest --changed never selects", () => {
    const scans = sourceScanTests();
    for (const file of [
      "src/components/ui/form.test.tsx",
      "src/components/ui/button.test.ts",
      "src/components/account/EntryShell.test.tsx",
      "src/db/erasure-coverage.test.ts",
    ]) {
      expect(scans).toContain(file);
    }
  });
});

describe("a red step's excerpt", () => {
  it("shows the first failure even when the summary pushes it out of the tail", () => {
    const log = [
      "== check:a: ok ==",
      "== check:context-budget (check-context-budget.mjs): FAILED (exit 1) ==",
      "- AGENTS.md: over its budget",
      ...Array.from({ length: 60 }, (_, i) => `== check:${i}: ok ==`),
      "check:repo: one or more checks failed",
    ].join("\n");
    const shown = excerpt(log);
    expect(shown).toContain("context-budget");
    expect(shown).toContain("over its budget");
    expect(shown).toContain("one or more checks failed");
  });

  it("is only the tail when the failure is already in it", () => {
    expect(excerpt("a\nb\n FAIL src/x.test.ts\nTests 1 failed")).toBe(
      "a\nb\n FAIL src/x.test.ts\nTests 1 failed",
    );
  });
});

describe("the browser specs a push runs", () => {
  const minute = 60_000;
  const record = {
    "e2e/a.spec.ts": 2 * minute,
    "e2e/b.spec.ts": 4 * minute,
    "e2e/c.spec.ts": minute,
  };
  const strong = new Map([["e2e/a.spec.ts", new Set(["quotes it"])]]);
  const rank = new Map();

  it("caps what the diff only reaches at five minutes, whatever the strong tier left", () => {
    const reach = new Map([
      ["e2e/b.spec.ts", new Set()],
      ["e2e/c.spec.ts", new Set()],
      ["e2e/d.spec.ts", new Set()],
    ]);
    const picked = browserSpecs({ changed: ["src/lib/x.ts"], strong, reach, rank, record });
    expect(REACH_BUDGET_MS).toBe(5 * minute);
    // Cheapest first: c (1) and d (unrecorded, one minute by default) fit; b (4) would make six.
    expect(picked.specs).toEqual(["e2e/a.spec.ts", "e2e/c.spec.ts", "e2e/d.spec.ts"]);
    expect(picked.left).toEqual(["e2e/b.spec.ts"]);
  });

  it("never spends more than the whole budget when the strong tier is already near it", () => {
    const heavy = { ...record, "e2e/a.spec.ts": 14 * minute };
    const reach = new Map([["e2e/b.spec.ts", new Set()]]);
    const picked = browserSpecs({ changed: ["src/lib/x.ts"], strong, reach, rank, record: heavy });
    expect(picked.specs).toEqual(["e2e/a.spec.ts"]);
    expect(picked.left).toEqual(["e2e/b.spec.ts"]);
  });

  it("runs no browser spec, so builds nothing, when only unit tests changed", () => {
    const picked = browserSpecs({
      changed: ["src/lib/x.test.ts", "scripts/y.test.mjs", "docs/agents/verifying.md"],
      strong,
      reach: new Map(),
      rank,
      record,
    });
    expect(picked).toEqual({ specs: [], reached: [], left: [], testsOnly: true });
  });

  it("still runs the specs a diff of e2e specs names", () => {
    const picked = browserSpecs({
      changed: ["e2e/a.spec.ts"],
      strong,
      reach: new Map(),
      rank,
      record,
    });
    expect(picked.specs).toEqual(["e2e/a.spec.ts"]);
  });
});

describe("the build key", () => {
  const line = (file, sha) => `100644 blob ${sha}\t${file}`;
  const app = [line("src/lib/x.ts", "a1"), line("package.json", "b2")];

  it("does not move when only tests, specs or docs change, so the build is reused", () => {
    const before = appTreeKey(
      [...app, line("src/lib/x.test.ts", "c3"), line("e2e/a.spec.ts", "d4")].join("\n"),
    );
    const after = appTreeKey(
      [
        ...app,
        line("src/lib/x.test.ts", "ff"),
        line("e2e/a.spec.ts", "ee"),
        line("docs/x.md", "11"),
      ].join("\n"),
    );
    expect(after).toBe(before);
  });

  it("moves when anything the app is built from changes", () => {
    const before = appTreeKey(app.join("\n"));
    const after = appTreeKey([line("src/lib/x.ts", "a2"), line("package.json", "b2")].join("\n"));
    expect(after).not.toBe(before);
  });
});

describe("the stamp", () => {
  it("is written per worktree and keyed by sha in the common git dir, which every worktree reads", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const writes = {};
    const dirs = [];
    const git = (args) =>
      ({
        "rev-parse --git-path diveday-verified.json":
          "/repo/.git/worktrees/wt/diveday-verified.json",
        "rev-parse --path-format=absolute --git-common-dir": "/repo/.git",
      })[args.join(" ")] ?? null;
    writeStamps(
      { sha, base: "origin/main" },
      {
        git,
        write: (file, text) => {
          writes[file] = JSON.parse(text);
        },
        mkdir: (dir) => dirs.push(dir),
      },
    );
    expect(Object.keys(writes).sort()).toEqual([
      `/repo/.git/diveday-verified/${sha}`,
      "/repo/.git/worktrees/wt/diveday-verified.json",
    ]);
    expect(writes[`/repo/.git/diveday-verified/${sha}`].sha).toBe(sha);
    expect(dirs).toEqual(["/repo/.git/diveday-verified"]);
  });
});
