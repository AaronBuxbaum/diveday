import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  baseReplayFiles,
  browserSpecs,
  CORES_PER_E2E_WORKER,
  E2E_CHUNK,
  e2eWorkers,
  excerpt,
  mergeOnly,
  notRunHere,
  plan,
  pushRoundWarning,
  quickBase,
  quickPlan,
  runStep,
  stampCoverage,
  UNIT_SHARDS,
  writeStamps,
} from "./verify-push.mjs";

const names = (steps) => steps.map((step) => step.name);
const base = { specs: [] };

describe("the quick push round size", () => {
  const sha = "a".repeat(40);
  const files = (count) => Array.from({ length: count }, (_, i) => `src/file-${i}.ts`);

  it("warns only above 150 files since this branch's latest completed CI", () => {
    const git = (args) => (args[0] === "diff" ? files(151).join("\n") : null);
    expect(pushRoundWarning({ quick: true, ciSha: sha, changed: files(400), git })).toMatch(
      /151.*last CI/i,
    );
    expect(
      pushRoundWarning({ quick: true, ciSha: sha, changed: [], git: () => files(150).join("\n") }),
    ).toBeNull();
    expect(pushRoundWarning({ quick: false, ciSha: sha, changed: files(400), git })).toBeNull();
  });

  it("labels the fallback when the branch has no locally readable CI commit", () => {
    expect(
      pushRoundWarning({ quick: true, ciSha: null, changed: files(151), git: () => null }),
    ).toMatch(/151.*base/i);
    expect(
      pushRoundWarning({ quick: true, ciSha: sha, changed: files(151), git: () => null }),
    ).toMatch(/151.*base/i);
  });

  it("does not count earlier rounds when the latest CI commit is available", () => {
    const git = (args) => {
      expect(args).toEqual(["diff", "--name-only", sha, "HEAD"]);
      return files(2).join("\n");
    };
    expect(pushRoundWarning({ quick: true, ciSha: sha, changed: files(400), git })).toBeNull();
  });
});

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

  it("runs the visual captures the diff names after the specs, in light mode, on the same build (#2517)", () => {
    const steps = plan({
      ...base,
      changed: ["src/lib/x.ts"],
      specs: ["e2e/a.spec.ts"],
      captures: ["the desk renders true to the design"],
    });
    expect(names(steps).slice(-3)).toEqual(["e2e build", "e2e specs", "visual captures"]);
    const capture = steps.at(-1);
    expect(capture.args.slice(0, 2)).toEqual(["e2e:run", "e2e/visual"]);
    expect(capture.args[3]).toContain("(?!.*dark mode)");
    expect(capture.workers).toBe(true);
    // A diff that names only captures still builds once and runs them.
    const only = plan({ ...base, changed: ["src/lib/x.ts"], captures: ["x renders"] });
    expect(
      names(only).filter((name) => name.startsWith("e2e") || name === "visual captures"),
    ).toEqual(["e2e build", "visual captures"]);
    expect(names(plan({ ...base, changed: ["src/lib/x.ts"] }))).not.toContain("visual captures");
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

describe("the quick pre-push plan", () => {
  it("replays only known base failures after selected units, using bounded browser steps", () => {
    const specs = Array.from({ length: E2E_CHUNK + 1 }, (_, i) => `e2e/red${i}.spec.ts`);
    const steps = quickPlan({
      changed: ["scripts/example.mjs"],
      selection: { mode: "direct", files: ["scripts/example.test.mjs"] },
      specs,
    });
    expect(names(steps).slice(-4)).toEqual([
      "related unit tests",
      "e2e build",
      "e2e specs 1/2",
      "e2e specs 2/2",
    ]);
    const runs = steps.filter((step) => step.workers);
    expect(runs.flatMap((step) => step.args.filter((arg) => arg.endsWith(".spec.ts")))).toEqual(
      specs,
    );
    expect(steps.find((step) => step.build)?.name).toBe("e2e build");
    expect(
      names(
        quickPlan({
          changed: ["scripts/example.mjs"],
          selection: { mode: "direct", files: [] },
          specs: [specs[0]],
        }),
      ).slice(-2),
    ).toEqual(["e2e build", "e2e specs"]);
  });

  it.each(["e2e/gone.spec.ts", "src/lib/gone.test.ts"])(
    "refuses a missing named base failure %s instead of silently dropping its replay",
    (missing) => {
      expect(() =>
        baseReplayFiles({
          files: ["src/lib/present.test.ts", missing],
          existing: (file) => file !== missing,
        }),
      ).toThrow(missing);
      expect(
        baseReplayFiles({
          files: ["src/lib/present.test.ts", "e2e/red.spec.ts"],
          existing: () => true,
        }),
      ).toEqual(["src/lib/present.test.ts", "e2e/red.spec.ts"]);
    },
  );

  it("records replayed base specs and excludes them from the quick skipped count", () => {
    const specs = ["e2e/red.spec.ts"];
    const verdict = { red: ["browser"] };
    const decision = { files: ["src/lib/red.test.ts"], specs };
    expect(stampCoverage({ specs, verdict, decision })).toEqual({
      specs,
      baseCi: { red: ["browser"], ran: ["src/lib/red.test.ts", ...specs] },
    });
    expect(
      notRunHere({
        quick: true,
        specs,
        allSpecs: [...specs, "e2e/other.spec.ts", "e2e/visual.spec.ts"],
      }).join("\n"),
    ).toContain("1 Playwright specs (quick run)");
    expect(stampCoverage({ specs: [], verdict, decision }).baseCi.ran).toEqual(decision.files);
    expect(stampCoverage({ specs: [], verdict: { unknown: "offline" }, decision }).baseCi).toEqual({
      unknown: "offline",
    });
  });

  it("runs the static checks and the unit tests the diff reaches, and no browser", () => {
    const steps = quickPlan({
      changed: ["src/lib/x.ts", "docs/a.md"],
      selection: { mode: "related", files: ["src/lib/x.ts", "src/lib/y.test.ts"] },
    });
    expect(names(steps)).toEqual([
      "regen",
      "lint",
      "typecheck",
      "check:repo",
      "guards",
      "related unit tests",
    ]);
    expect(steps.at(-1).args).toEqual([
      "exec",
      "vitest",
      "related",
      "--run",
      "--project",
      "!guards",
      "--reporter=dot",
      "src/lib/x.ts",
      "src/lib/y.test.ts",
    ]);
  });

  it("replays the branch's own red spec and capture in a quick run (scripts/own-ci.mjs)", () => {
    const steps = quickPlan({
      changed: ["src/lib/x.ts"],
      selection: { mode: "related", files: [] },
      specs: ["e2e/last-minute-fill.spec.ts"],
      captures: ["a station names a blocker aboard (light)"],
    });
    expect(names(steps).slice(-3)).toEqual(["e2e build", "e2e specs", "visual captures"]);
    expect(steps.at(-1).args).toContain("e2e/visual");
    expect(steps.at(-1).args.join(" ")).toContain("a station names a blocker aboard \\(light\\)");
  });

  it("stops at the static checks for documents without reader tests; deletions run all units", () => {
    const statics = ["regen", "lint", "typecheck", "check:repo", "guards"];
    expect(names(quickPlan({ changed: ["AGENTS.md"], related: [] }))).toEqual(statics);
    expect(quickPlan({ changed: ["src/lib/gone.ts"] }).at(-1).args).toEqual([
      "exec",
      "vitest",
      "run",
      "--project",
      "!guards",
      "--reporter=dot",
    ]);
  });

  it("says it left every spec and the unimported unit tests to CI", () => {
    const lines = notRunHere({
      quick: true,
      specs: [],
      allSpecs: ["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/visual.spec.ts"],
    });
    expect(lines.join("\n")).toMatch(/all 2 Playwright specs \(quick run\)/);
    expect(lines.join("\n")).toMatch(/conservative source-reader contracts/);
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

  it("marks each browser step to take its worker count when it starts", () => {
    const steps = plan({ ...base, changed: ["src/lib/x.ts"], specs: ["e2e/a.spec.ts"] });
    expect(steps.find((step) => step.name === "e2e specs").workers).toBe(true);
  });
});

describe("how many Playwright workers a local run uses", () => {
  it("runs one on an idle four-core box, where two missed CI's ceiling", () => {
    expect(CORES_PER_E2E_WORKER).toBe(3);
    expect(e2eWorkers({ cores: 4, load: 0 }).workers).toBe(1);
  });

  it("runs as many as free cores allow, never more than CI's cores/2", () => {
    expect(e2eWorkers({ cores: 8, load: 0 }).workers).toBe(2);
    expect(e2eWorkers({ cores: 16, load: 0 }).workers).toBe(5);
    expect(e2eWorkers({ cores: 4, load: 0, override: undefined }).formula).toBe(
      "max(1, min(floor((4 cores - 0.0 load) / 3), 4/2))",
    );
  });

  it("gives up workers to load, such as another thread's gate, but keeps one", () => {
    expect(e2eWorkers({ cores: 16, load: 7.5 }).workers).toBe(2);
    expect(e2eWorkers({ cores: 4, load: 9 }).workers).toBe(1);
  });

  it("lets an operator's E2E_WORKERS win", () => {
    expect(e2eWorkers({ cores: 4, load: 0, override: "2" })).toEqual({
      workers: 2,
      formula: "E2E_WORKERS=2 set by the operator",
    });
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

describe("a merge-only quick push", () => {
  const reader = (answers) => (args) => {
    const key = args.join(" ");
    return key in answers ? answers[key] : null;
  };
  const pushed = "origin/claude/x";

  it("is every commit since the last push being a merge of another branch", () => {
    const git = reader({
      [`rev-parse --verify --quiet ${pushed}`]: "abc",
      [`rev-list --first-parent --no-merges ${pushed}..HEAD`]: "",
      [`rev-list --first-parent --merges ${pushed}..HEAD`]: "m1",
    });
    expect(mergeOnly(git, "claude/x")).toBe(true);
  });

  it("is not a push with a commit of the branch's own, nothing new, or no pushed branch", () => {
    const base = { [`rev-parse --verify --quiet ${pushed}`]: "abc" };
    expect(
      mergeOnly(
        reader({
          ...base,
          [`rev-list --first-parent --no-merges ${pushed}..HEAD`]: "c1",
          [`rev-list --first-parent --merges ${pushed}..HEAD`]: "m1",
        }),
        "claude/x",
      ),
    ).toBe(false);
    expect(
      mergeOnly(
        reader({
          ...base,
          [`rev-list --first-parent --no-merges ${pushed}..HEAD`]: "",
          [`rev-list --first-parent --merges ${pushed}..HEAD`]: "",
        }),
        "claude/x",
      ),
    ).toBe(false);
    expect(mergeOnly(reader({}), "claude/x")).toBe(false);
    expect(mergeOnly(reader(base), "")).toBe(false);
  });
});

describe("the base's red in a quick run", () => {
  it("is a warning naming what was not replayed, never a refusal", () => {
    const decision = quickBase({
      refuse: "Build named no test",
      files: ["src/a.test.ts"],
      specs: ["e2e/b.spec.ts"],
      lines: [],
    });
    expect(decision.refuse).toBeNull();
    expect([...decision.files, ...decision.specs]).toEqual([]);
    expect(decision.lines.join("\n")).toMatch(/not blocking a quick run\): Build named no test/);
    expect(decision.lines.join("\n")).toMatch(/src\/a\.test\.ts e2e\/b\.spec\.ts/);
  });

  it("says nothing when the base is green", () => {
    expect(quickBase({ refuse: null, files: [], specs: [], lines: [] }).lines).toEqual([]);
  });
});
