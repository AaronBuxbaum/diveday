import { describe, expect, it } from "vitest";

import {
  baseDecision,
  baseRedArgs,
  baseVerdict,
  latestRuns,
  readBaseVerdict,
  repoSlug,
} from "./base-ci.mjs";

const run = (id, name, conclusion, status = "completed") => ({
  id,
  name,
  status,
  conclusion,
  app: { slug: "github-actions" },
});
const fails = (path) => ({ path, annotation_level: "failure" });

describe("the base's verdict", () => {
  it("reads main at d5014c5f1: lint answered here, the unit shards by the files they name", () => {
    const runs = [
      run(1, "Lint", "failure"),
      run(2, "Unit tests shard 2/4", "failure"),
      run(3, "Unit tests shard 4/4", "failure"),
      run(4, "Typecheck", "success"),
    ];
    const notes = {
      2: [fails(".github"), fails("src/db/open-local-db.test.ts")],
      3: [fails("src/db/open-local-db.test.ts"), fails("src/test/db.ts")],
    };
    expect(baseVerdict(runs, (r) => notes[r.id])).toEqual({
      red: ["Lint", "Unit tests shard 2/4", "Unit tests shard 4/4"],
      pending: [],
      files: ["src/db/open-local-db.test.ts"],
      specs: [],
      unnamed: [],
    });
  });

  it("names the spec a red Playwright shard annotates", () => {
    const verdict = baseVerdict([run(5, "Playwright shard 5/6", "failure")], () => [
      fails(".github"),
      fails("e2e/booking.spec.ts"),
    ]);
    expect(verdict.specs).toEqual(["e2e/booking.spec.ts"]);
    expect(verdict.unnamed).toEqual([]);
  });

  it("leaves out the aggregate CI result job, which names no file and is red whenever any job is", () => {
    const verdict = baseVerdict(
      [run(1, "CI result", "failure"), run(2, "Playwright shard 3/6", "failure")],
      (r) => (r.id === 2 ? [fails("e2e/courses.spec.ts")] : [fails(".github")]),
    );
    expect(verdict.red).toEqual(["Playwright shard 3/6"]);
    expect(verdict.unnamed).toEqual([]);
  });

  it("calls a red job that names no file unnamed, so the gate cannot pretend it re-ran it", () => {
    const verdict = baseVerdict([run(6, "Build", "failure")], () => [fails(".github")]);
    expect(verdict.unnamed).toEqual(["Build"]);
  });

  it("leaves out visual jobs, which a push approves, and counts what is still running", () => {
    const verdict = baseVerdict(
      [
        run(7, "reg-suit visual regression", "failure"),
        run(8, "Visual capture shard 2/8", "failure"),
        run(9, "Playwright shard 1/6", null, "in_progress"),
      ],
      () => [],
    );
    expect(verdict.red).toEqual([]);
    expect(verdict.pending).toEqual(["Playwright shard 1/6"]);
  });

  it("takes the newest attempt of a re-run job and ignores other apps' checks", () => {
    const runs = [
      run(10, "Unit tests shard 1/4", "failure"),
      run(11, "Unit tests shard 1/4", "success"),
      {
        ...run(12, "Claude Approvals", "failure"),
        app: { slug: "claude-approvals" },
      },
    ];
    expect(latestRuns(runs).map((r) => r.id)).toEqual([11]);
    expect(baseVerdict(runs, () => []).red).toEqual([]);
  });
});

describe("what the gate does about the base", () => {
  const green = { red: [], pending: [], files: [], specs: [], unnamed: [] };

  it("says nothing more than green for a green base", () => {
    expect(baseDecision(green, { base: "origin/main" })).toEqual({
      refuse: null,
      files: [],
      specs: [],
      lines: ["base CI: origin/main is green."],
    });
  });

  it("runs the base's red files here and stamps only if they pass", () => {
    const decision = baseDecision(
      { ...green, red: ["Unit tests shard 2/4"], files: ["src/db/a.test.ts"] },
      { base: "origin/claude/below" },
    );
    expect(decision.refuse).toBeNull();
    expect(decision.files).toEqual(["src/db/a.test.ts"]);
    expect(decision.lines.join("\n")).toMatch(/red on Unit tests shard 2\/4/);
  });

  it("refuses a red job that names no file until the author names the files", () => {
    const verdict = { ...green, red: ["Build"], unnamed: ["Build"] };
    expect(baseDecision(verdict, { base: "origin/claude/below" }).refuse).toMatch(
      /--base-red <file…>/,
    );
    const named = baseDecision(verdict, {
      base: "origin/claude/below",
      extra: ["src/lib/x.test.ts", "e2e/a.spec.ts"],
    });
    expect(named.refuse).toBeNull();
    expect(named.files).toEqual(["src/lib/x.test.ts"]);
    expect(named.specs).toEqual(["e2e/a.spec.ts"]);
  });

  it("fails open, saying so, when CI cannot be read", () => {
    const decision = baseDecision({ unknown: "no gh" }, { base: "origin/main" });
    expect(decision.refuse).toBeNull();
    expect(decision.lines).toEqual(["base CI: unknown (no gh)."]);
  });

  it.each(["", "README.md", "src/lib/x.ts", "e2e/a.spec.ts:42"])(
    "refuses unsupported --base-red input %j instead of clearing an unnamed failure",
    (file) => {
      const verdict = { ...green, red: ["CI result"], unnamed: ["CI result"] };
      const decision = baseDecision(verdict, {
        base: "origin/main",
        extra: [file],
      });
      expect(decision.refuse).toMatch(/unsupported --base-red/);
      expect(decision.files).toEqual([]);
      expect(decision.specs).toEqual([]);
      expect(
        baseDecision(verdict, {
          base: "origin/main",
          extra: ["src/lib/x.test.ts", file],
        }).refuse,
      ).toMatch(/unsupported --base-red/);
      expect(
        baseDecision({ unknown: "offline" }, { base: "origin/main", extra: [file] }).refuse,
      ).toMatch(/unsupported --base-red/);
    },
  );

  it("warns, without refusing, while the base is still running", () => {
    const decision = baseDecision({ ...green, pending: ["Build"] }, { base: "origin/main" });
    expect(decision.refuse).toBeNull();
    expect(decision.lines[0]).toMatch(/still running 1 job/);
  });
});

describe("reading GitHub", () => {
  it("asks for the base commit's check runs and each red one's annotations", () => {
    const asked = [];
    const gh = (args) => {
      asked.push(args[0]);
      if (args[0].includes("/annotations")) return [fails("src/db/a.test.ts")];
      if (args[0].includes("/actions/runs")) return { workflow_runs: [] };
      return { check_runs: [run(1, "Unit tests shard 1/4", "failure")] };
    };
    const verdict = readBaseVerdict("abc1234", { repo: "o/r", gh });
    expect(verdict.files).toEqual(["src/db/a.test.ts"]);
    expect(asked).toEqual([
      "repos/o/r/commits/abc1234/check-runs?per_page=100",
      "repos/o/r/actions/runs?head_sha=abc1234&per_page=100",
      "repos/o/r/check-runs/1/annotations",
    ]);
  });

  it("leaves out runs a PR never gets: main b340c3c00's schedule-only reds (2026-10-15)", () => {
    const suite = (id, name, suiteId) => ({
      ...run(id, name, "failure"),
      check_suite: { id: suiteId },
      head_sha: "b340c3c0068ffb7d117975ce804c76a0699dd840",
    });
    const gh = (args) => {
      if (args[0].includes("/annotations")) return [fails("e2e/booking.spec.ts")];
      if (args[0].includes("/actions/runs")) {
        // The runs endpoint matches only a full sha, so the abbreviated base finds nothing.
        if (!args[0].includes("head_sha=b340c3c0068ffb7d")) return { workflow_runs: [] };
        return {
          workflow_runs: [
            { event: "schedule", check_suite_id: 10 },
            { event: "schedule", check_suite_id: 11 },
            { event: "workflow_dispatch", check_suite_id: 12 },
            { event: "push", check_suite_id: 13 },
          ],
        };
      }
      return {
        check_runs: [
          suite(1, "Analyze (javascript-typescript)", 10),
          suite(2, "Simulate a day", 11),
          suite(3, "Every needs-triage issue is actionable cold, and no claim is dead", 12),
          suite(4, "Playwright shard 2/6", 13),
        ],
      };
    };
    const verdict = readBaseVerdict("b340c3c00", { repo: "o/r", gh });
    expect(verdict.red).toEqual(["Playwright shard 2/6"]);
    expect(verdict.unnamed).toEqual([]);
  });

  it("is unknown, not green, when gh fails or GitHub has no run yet", () => {
    const broken = () => {
      throw new Error("gh: not found");
    };
    expect(readBaseVerdict("abc1234", { repo: "o/r", gh: broken }).unknown).toMatch(
      /gh: not found/,
    );
    expect(
      readBaseVerdict("abc1234", {
        repo: "o/r",
        gh: () => ({ check_runs: [] }),
      }).unknown,
    ).toMatch(/no CI run/);
    expect(readBaseVerdict(null, { repo: "o/r" }).unknown).toBeTruthy();
  });

  it("finds the repository in the remote URL", () => {
    expect(repoSlug("https://github.com/AaronBuxbaum/diveday")).toBe("AaronBuxbaum/diveday");
    expect(repoSlug("git@github.com:AaronBuxbaum/diveday.git")).toBe("AaronBuxbaum/diveday");
    expect(repoSlug("http://127.0.0.1:1234/git/x")).toBeNull();
  });

  it("reads --base-red's files up to the next flag", () => {
    expect(baseRedArgs(["--base-red", "a.test.ts", "e2e/b.spec.ts", "--plan"])).toEqual([
      "a.test.ts",
      "e2e/b.spec.ts",
    ]);
    expect(baseRedArgs(["--plan"])).toEqual([]);
    expect(() => baseRedArgs(["--base-red"])).toThrow(/requires at least one/);
    expect(() => baseRedArgs(["--base-red", "--plan"])).toThrow(/requires at least one/);
  });
});
