import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appTreeKey,
  browserSpecs,
  E2E_CHUNK,
  E2E_WORKERS,
  excerpt,
  notRunHere,
  plan,
  runStep,
  UNIT_SHARDS,
  writeStamps,
} from "./verify-push.mjs";

const names = (steps) => steps.map((step) => step.name);
const base = { specs: [] };

describe("the pre-push plan", () => {
  it("runs every local check CI's red jobs came from, cheapest first", () => {
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs: ["e2e/a.spec.ts"] });
    expect(names(steps)).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
      "unit tests 1/4",
      "unit tests 2/4",
      "unit tests 3/4",
      "unit tests 4/4",
      "e2e build",
      "e2e specs",
    ]);
    expect(steps.at(-1).args).toContain("e2e/a.spec.ts");
  });

  it("runs the whole unit suite as CI shards it, whatever the diff touches", () => {
    const units = plan({ ...base, changed: ["package.json"] }).filter((step) =>
      step.name.startsWith("unit tests"),
    );
    expect(units).toHaveLength(UNIT_SHARDS);
    for (const [i, step] of units.entries()) {
      expect(step.args).toEqual([
        "exec",
        "vitest",
        "run",
        "--project",
        "!guards",
        "--reporter=dot",
        `--shard=${i + 1}/${UNIT_SHARDS}`,
      ]);
    }
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

  it("runs every spec the diff reaches, narrowest first, whatever it costs", () => {
    const reach = new Map([
      ["e2e/b.spec.ts", new Set()],
      ["e2e/c.spec.ts", new Set()],
      ["e2e/d.spec.ts", new Set()],
    ]);
    const heavy = {
      ...record,
      "e2e/a.spec.ts": 40 * minute,
      "e2e/b.spec.ts": 30 * minute,
    };
    const picked = browserSpecs({
      changed: ["src/lib/x.ts"],
      strong,
      reach,
      rank,
      record: heavy,
    });
    expect(picked.specs).toEqual([
      "e2e/a.spec.ts",
      "e2e/c.spec.ts",
      "e2e/d.spec.ts",
      "e2e/b.spec.ts",
    ]);
    expect(picked).not.toHaveProperty("left");
  });

  it("runs no browser spec, so builds nothing, when only unit tests changed", () => {
    const picked = browserSpecs({
      changed: ["src/lib/x.test.ts", "scripts/y.test.mjs", "docs/agents/verifying.md"],
      strong,
      reach: new Map(),
      rank,
      record,
    });
    expect(picked).toEqual({ specs: [], reached: [], testsOnly: true });
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

describe("a large browser selection", () => {
  it("runs in steps of E2E_CHUNK specs, so none outlives its hour", () => {
    const specs = Array.from({ length: E2E_CHUNK * 2 + 1 }, (_, i) => `e2e/s${i}.spec.ts`);
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs });
    const runs = steps.filter((step) => step.name.startsWith("e2e specs"));
    expect(runs.map((step) => step.name)).toEqual([
      "e2e specs 1/3",
      "e2e specs 2/3",
      "e2e specs 3/3",
    ]);
    expect(runs.flatMap((step) => step.args.filter((arg) => arg.endsWith(".spec.ts")))).toEqual(
      specs,
    );
  });

  it("runs each step on one worker, so CI's per-test ceiling stays the bar", () => {
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs: ["e2e/a.spec.ts"] });
    const run = steps.find((step) => step.name === "e2e specs");
    expect(E2E_WORKERS).toBe(1);
    expect(run.env).toEqual({ E2E_WORKERS: "1" });
  });
});

describe("what a green run says it did not run", () => {
  const allSpecs = ["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/visual.spec.ts"];

  it("names the unit tests, the unselected specs and the visual captures", () => {
    const lines = notRunHere({
      docsOnly: false,
      testsOnly: false,
      specs: ["e2e/a.spec.ts"],
      allSpecs,
    });
    expect(lines).toEqual([
      "1 Playwright specs the diff neither names nor reaches",
      expect.stringMatching(/^visual captures/),
    ]);
  });

  it("counts a spec a smoke pick ran by line as run", () => {
    const lines = notRunHere({
      docsOnly: false,
      testsOnly: false,
      specs: ["e2e/a.spec.ts:12", "e2e/b.spec.ts"],
      allSpecs,
    });
    expect(lines).toHaveLength(1);
  });

  it("says why no spec ran when only tests or docs changed", () => {
    expect(notRunHere({ docsOnly: false, testsOnly: true, specs: [], allSpecs })[0]).toBe(
      "all 2 Playwright specs (no page code changed)",
    );
    expect(notRunHere({ docsOnly: true, testsOnly: false, specs: [], allSpecs })).toHaveLength(2);
  });
});

describe("a step that hits its ceiling", () => {
  // A killed process whose parent is gone waits as a zombie until PID 1 reaps it, which in a
  // container may be never; a zombie runs nothing and holds no port, so it counts as gone.
  const alive = (pid) => {
    try {
      return readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[2] !== "Z";
    } catch {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
  };

  it("leaves no grandchild running, as an e2e server would", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "verify-step-"));
    const pidFile = path.join(dir, "grandchild.pid");
    const result = runStep("sh", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], {
      stdio: "ignore",
      timeoutMs: 1000,
    });
    expect(result.error?.code).toBe("ETIMEDOUT");
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    expect(grandchild).toBeGreaterThan(0);
    await expect.poll(() => alive(grandchild), { timeout: 2000 }).toBe(false);
  });

  it("kills the step's whole group, by its leader's pid, after a clean exit too", () => {
    const killed = [];
    runStep("true", [], {
      timeoutMs: 1000,
      run: () => ({ pid: 4321, status: 0 }),
      kill: (pid, signal) => killed.push([pid, signal]),
    });
    expect(killed).toEqual([[-4321, "SIGKILL"]]);
  });
});
