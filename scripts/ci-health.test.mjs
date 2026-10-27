import { describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import {
  breaches,
  computeHealth,
  ghJson,
  ISSUE_TITLE,
  issueBody,
  jobKind,
  namedTests,
  percentile,
  readWeek,
  reconcileIssue,
  renderTable,
  runMinutes,
} from "./ci-health.mjs";

let ids = 0;
/** One workflow run: `minute` is its creation minute past 10:00, `took` its length. */
function run(sha, conclusion, { minute = 0, took = 20, named = [], jobs } = {}) {
  ids += 1;
  const start = new Date(Date.UTC(2026, 9, 20, 10, minute));
  const end = new Date(start.getTime() + took * 60_000);
  return {
    id: ids,
    head_sha: sha,
    conclusion,
    created_at: start.toISOString(),
    run_started_at: start.toISOString(),
    updated_at: end.toISOString(),
    ...(conclusion === "failure"
      ? {
          named: new Set(named),
          jobs: jobs ?? [
            { name: "Playwright shard 2/6", conclusion: "failure" },
            { name: "CI result", conclusion: "failure" },
          ],
        }
      : {}),
  };
}

// The week's shape the 2026-10-22 review described, in miniature.
const WEEK = [
  // Green first time.
  { number: 1, runs: [run("a1", "success", { took: 16 })] },
  // Red, then a fix push red again on the same spec (a repeat), then green.
  {
    number: 2,
    runs: [
      run("b1", "failure", { minute: 0, took: 30, named: ["spec:e2e/trips.spec.ts"] }),
      run("b2", "failure", {
        minute: 40,
        took: 25,
        named: ["spec:e2e/trips.spec.ts", "unit:src/lib/x.test.ts"],
      }),
      run("b3", "success", { minute: 80, took: 18 }),
    ],
  },
  // Red, then a push red on something new (not a repeat), then a re-run of the same commit
  // (not a push), then green.
  {
    number: 3,
    runs: [
      run("c1", "failure", {
        minute: 0,
        took: 22,
        named: ["capture:the board (light)"],
        jobs: [
          { name: "Visual capture shard 1/3", conclusion: "failure" },
          { name: "reg-suit visual regression", conclusion: "failure" },
        ],
      }),
      run("c2", "failure", { minute: 30, took: 21, named: ["spec:e2e/other.spec.ts"] }),
      run("c2", "failure", { minute: 60, took: 21, named: ["spec:e2e/other.spec.ts"] }),
      run("c3", "success", { minute: 90, took: 17 }),
    ],
  },
  // Cancelled runs are no verdict, and a pull request with none has no CI.
  { number: 4, runs: [{ ...run("d1", "success"), conclusion: "cancelled" }] },
];

describe("GitHub API reads", () => {
  it("retries a transient gateway error and returns the successful response", () => {
    const responses = [
      { status: 1, stderr: "gh: Server Error (HTTP 502)" },
      { status: 1, stderr: "gh: Server Error (HTTP 503)" },
      { status: 0, stdout: '{"ok":true}' },
    ];
    const delays = [];
    expect(
      ghJson("repos/example", undefined, {
        run: () => responses.shift(),
        sleep: (ms) => delays.push(ms),
      }),
    ).toEqual({ ok: true });
    expect(delays).toEqual([250, 500]);
    expect(responses).toHaveLength(0);
  });

  it("stops after three transient failures and does not retry a client error", () => {
    let calls = 0;
    const fail = (stderr) => () => {
      calls += 1;
      return { status: 1, stderr };
    };
    expect(() =>
      ghJson("repos/example", undefined, {
        run: fail("gh: Server Error (HTTP 504)"),
        sleep: () => {},
      }),
    ).toThrow("HTTP 504");
    expect(calls).toBe(3);
    calls = 0;
    expect(() =>
      ghJson("repos/example", undefined, {
        run: fail("gh: Not Found (HTTP 404)"),
        sleep: () => {},
      }),
    ).toThrow("HTTP 404");
    expect(calls).toBe(1);
  });
});

describe("computeHealth", () => {
  const health = computeHealth(WEEK);

  it("counts red runs per pull request and green on first run over pull requests with CI", () => {
    expect(health.prs).toBe(3);
    expect(health.runs).toBe(8);
    expect(health.red).toBe(5);
    expect(health.redPerPr).toBeCloseTo(5 / 3);
    expect(health.firstGreen).toBeCloseTo(1 / 3);
  });

  it("counts a push after a red run, red again, and red again on a test the run before named", () => {
    // #2: b1→b2 (red, repeat), b2→b3 (green). #3: c1→c2 (red, new), c2→c2 is a re-run, c2→c3.
    expect(health.followedRed).toBe(4);
    expect(health.redAgain).toBe(2);
    expect(health.repeated).toBe(1);
    expect(health.repeatRate).toBeCloseTo(0.25);
    expect(health.repeats).toEqual([
      { pr: 2, run: WEEK[1].runs[1].id, tests: ["spec:e2e/trips.spec.ts"] },
    ]);
  });

  it("takes the median and p90 of run minutes", () => {
    // 16, 30, 25, 18, 22, 21, 21, 17
    expect(health.medianMinutes).toBe(21);
    expect(health.p90Minutes).toBe(30);
  });

  it("ranks the failing jobs with shards folded together and the aggregate left out", () => {
    expect(health.failing).toEqual([
      ["Playwright shard *", 4],
      ["reg-suit visual regression", 1],
      ["Visual capture shard *", 1],
    ]);
  });

  it("reads an empty week as zeros, not NaN", () => {
    const empty = computeHealth([]);
    expect(empty.redPerPr).toBe(0);
    expect(empty.repeatRate).toBe(0);
    expect(empty.medianMinutes).toBeNull();
  });
});

describe("the thresholds", () => {
  it("name a bad week (the 10-19 to 10-22 numbers) and leave a good one (10-13 to 10-15) alone", () => {
    expect(breaches({ redPerPr: 1.4, repeatRate: 14 / 37 })).toEqual([
      "red CI runs per pull request were 1.4, over 1.0",
      "the repeat-red rate was 38%, over 25%",
    ]);
    expect(breaches({ redPerPr: 0.4, repeatRate: 0.1 })).toEqual([]);
    expect(breaches({ redPerPr: 1.0, repeatRate: 0.25 })).toEqual([]);
  });
});

describe("helpers", () => {
  it("folds shard numbers", () => {
    expect(jobKind("Playwright shard 3/6")).toBe("Playwright shard *");
    expect(jobKind("Unit tests shard 1/4")).toBe("Unit tests shard *");
    expect(jobKind("Lint")).toBe("Lint");
  });

  it("takes a nearest-rank percentile", () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("reads a run's minutes, and null for a missing time", () => {
    expect(
      runMinutes({ run_started_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:22:30Z" }),
    ).toBe(22.5);
    expect(runMinutes({ updated_at: "2026-10-20T10:00:00Z" })).toBeNull();
  });

  it("names the tests a red run's annotations list, comparable across runs", () => {
    const jobs = [
      { id: 1, name: "Unit tests shard 1/4", conclusion: "failure" },
      { id: 2, name: "Visual capture shard 2/5", conclusion: "failure" },
    ];
    const notes = {
      1: [{ path: "src/lib/a.test.ts", annotation_level: "failure" }],
      2: [
        {
          path: ".github",
          annotation_level: "notice",
          title: "🎭 Playwright Run Summary",
          message:
            "  1 failed\n    [chromium] › e2e/visual.spec.ts:46:11 › dark mode › staff › the board (dark) \n",
        },
      ],
    };
    expect([...namedTests(jobs, (job) => notes[job.id])].sort()).toEqual([
      "capture:the board (light)",
      "unit:src/lib/a.test.ts",
    ]);
  });
});

describe("readWeek", () => {
  it("asks repos/AaronBuxbaum/diveday endpoints only, with the branch unencoded", () => {
    const asked = [];
    const gh = (endpoint) => {
      asked.push(endpoint);
      if (endpoint.includes("/pulls?"))
        return [
          {
            number: 7,
            ref: "claude/a-branch",
            created_at: "2026-10-18T00:00:00Z",
            updated_at: "2026-10-21T00:00:00Z",
            closed_at: null,
          },
          {
            number: 6,
            ref: "old",
            created_at: "2026-09-01T00:00:00Z",
            updated_at: "2026-10-01T00:00:00Z",
          },
        ];
      if (endpoint.includes("/runs?"))
        return [
          { ...run("x1", "failure"), status: "completed", created_at: "2026-10-19T00:00:00Z" },
          { ...run("x0", "success"), status: "completed", created_at: "2026-10-01T00:00:00Z" },
          { ...run("x2", null), status: "in_progress", created_at: "2026-10-21T00:00:00Z" },
        ];
      if (endpoint.includes("/jobs?"))
        return [{ id: 9, name: "Playwright shard 1/6", conclusion: "failure" }];
      if (endpoint.includes("/annotations?"))
        return [{ path: "e2e/trips.spec.ts", annotation_level: "failure" }];
      throw new Error(`unexpected ${endpoint}`);
    };
    const prs = readWeek({ since: "2026-10-15T00:00:00Z", gh });
    expect(prs.map((pr) => pr.number)).toEqual([7]);
    expect(prs[0].runs).toHaveLength(1);
    expect([...prs[0].runs[0].named]).toEqual(["spec:e2e/trips.spec.ts"]);
    expect(asked.every((endpoint) => endpoint.startsWith("repos/AaronBuxbaum/diveday/"))).toBe(
      true,
    );
    expect(asked.some((endpoint) => endpoint.includes("branch=claude/a-branch&"))).toBe(true);
    expect(asked.some((endpoint) => endpoint.includes("search"))).toBe(false);
  });
});

describe("the health issue", () => {
  const bad = computeHealth(WEEK);
  const window = {
    since: "2026-10-15",
    until: "2026-10-22",
    runUrl: "https://github.com/x/y/actions/runs/1",
  };

  it("has a body the follow-up guard accepts, with the week's table in it", () => {
    const body = issueBody(bad, window);
    expect(findIssueProblems({ number: 0, title: ISSUE_TITLE, body }).problems).toEqual([]);
    expect(body).toContain("| Red CI runs per pull request | 1.7 | 1.0 |");
  });

  function stubTracker(open = []) {
    const calls = [];
    return {
      calls,
      listIssues: ({ label }) => {
        calls.push(["list", label]);
        return open;
      },
      comment: (number, body) => calls.push(["comment", number, body]),
      createIssue: (issue) => {
        calls.push(["create", issue]);
        return { number: 99 };
      },
    };
  }

  it("opens one needs-triage issue when a threshold is crossed", () => {
    const tracker = stubTracker();
    expect(reconcileIssue({ health: bad, ...window, tracker, log: () => {} })).toBe("opened");
    const created = tracker.calls.find((call) => call[0] === "create")[1];
    expect(created.title).toBe(ISSUE_TITLE);
    expect(created.labels).toEqual(["needs-triage"]);
  });

  it("comments the week on the issue already open instead of opening another", () => {
    const tracker = stubTracker([
      { number: 41, title: ISSUE_TITLE },
      { number: 40, title: "other" },
    ]);
    expect(reconcileIssue({ health: bad, ...window, tracker, log: () => {} })).toBe("commented");
    const comment = tracker.calls.find((call) => call[0] === "comment");
    expect(comment[1]).toBe(41);
    expect(comment[2]).toContain(renderTable(bad).split("\n")[0]);
  });

  it("does nothing in a healthy week", () => {
    const tracker = stubTracker([{ number: 41, title: ISSUE_TITLE }]);
    const healthy = computeHealth([WEEK[0]]);
    expect(reconcileIssue({ health: healthy, ...window, tracker, log: () => {} })).toBe("nothing");
    expect(tracker.calls).toEqual([]);
  });
});
