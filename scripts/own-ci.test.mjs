import { describe, expect, it } from "vitest";

import { lightTitle, ownDecision, ownVerdict, readOwnVerdict, summaryTests } from "./own-ci.mjs";

const job = (id, name, conclusion = "failure") => ({
  id,
  name,
  status: "completed",
  conclusion,
});
const fails = (path) => ({ path, annotation_level: "failure" });
const summary = (message) => ({
  path: ".github",
  annotation_level: "notice",
  title: "🎭 Playwright Run Summary",
  message,
});

// The notices of #2929's red run 39799400274 (2026-10-22), trimmed.
const PLAYWRIGHT_SUMMARY =
  "  4 failed\n" +
  "    [chromium] › e2e/last-minute-fill.spec.ts:21:5 › diver opts in, Today nudges staff, and the trip page reflects the send attempt \n" +
  "    [chromium] › e2e/last-minute-fill.spec.ts:110:5 › a failed send attempt does not silence the Today row — nothing actually went out \n" +
  "  148 passed (12.0m)";
const CAPTURE_SUMMARY =
  "  1 failed\n" +
  "    [chromium] › e2e/visual.spec.ts:4604:11 › dark mode › staff › a station names a blocker aboard (dark) \n" +
  "  1 skipped\n  99 passed (17.3m)";

describe("the Playwright Run Summary", () => {
  it("names each failed test's file and the last segment of its title", () => {
    expect(summaryTests(CAPTURE_SUMMARY)).toEqual([
      {
        file: "e2e/visual.spec.ts",
        title: "a station names a blocker aboard (dark)",
      },
    ]);
    expect(summaryTests(PLAYWRIGHT_SUMMARY).map((t) => t.file)).toEqual([
      "e2e/last-minute-fill.spec.ts",
      "e2e/last-minute-fill.spec.ts",
    ]);
  });

  it("reads a capture registered from an audit helper file", () => {
    expect(
      summaryTests(
        "    [chromium] › e2e/visual-audit-account-states.ts:228:11 › light mode — public opt-out outcomes › last-minute email opt-out renders its question and saved outcome",
      ),
    ).toEqual([
      {
        file: "e2e/visual-audit-account-states.ts",
        title: "last-minute email opt-out renders its question and saved outcome",
      },
    ]);
  });

  it("turns a dark capture into its light twin, which is the one the gate runs", () => {
    expect(lightTitle("a station names a blocker aboard (dark)")).toBe(
      "a station names a blocker aboard (light)",
    );
    expect(lightTitle("catalog overview keeps every site visible")).toBe(
      "catalog overview keeps every site visible",
    );
  });
});

describe("the branch's own verdict", () => {
  it("reads #2929's red run: a spec file, captures by title, reg-suit and the aggregate left out", () => {
    const jobs = [
      job(1, "Playwright shard 3/6"),
      job(2, "Visual capture shard 1/8"),
      job(3, "reg-suit visual regression"),
      job(4, "CI result"),
      job(5, "Unit tests shard 1/4", "success"),
    ];
    const notes = {
      // The failure annotation points at a fixture, not the spec; the summary names the spec.
      1: [fails("e2e/fixtures.ts"), summary(PLAYWRIGHT_SUMMARY)],
      2: [fails("e2e/visual.spec.ts"), summary(CAPTURE_SUMMARY)],
    };
    expect(ownVerdict(jobs, (j) => notes[j.id])).toEqual({
      red: ["Playwright shard 3/6", "Visual capture shard 1/8"],
      files: [],
      specs: ["e2e/last-minute-fill.spec.ts"],
      captures: ["a station names a blocker aboard (light)"],
      unnamed: [],
    });
  });

  it("names the unit files a red shard annotates, and leaves lint to the gate's own step", () => {
    const verdict = ownVerdict([job(1, "Unit tests shard 2/4"), job(2, "Lint")], (j) =>
      j.id === 1 ? [fails(".github"), fails("src/db/staff-render-cost.test.ts")] : [],
    );
    expect(verdict.files).toEqual(["src/db/staff-render-cost.test.ts"]);
    expect(verdict.red).toEqual(["Lint", "Unit tests shard 2/4"]);
    expect(verdict.unnamed).toEqual([]);
  });

  it("calls a red job that names nothing unnamed", () => {
    expect(ownVerdict([job(1, "Build")], () => [fails(".github")]).unnamed).toEqual(["Build"]);
  });
});

describe("reading it from GitHub", () => {
  const gh = (responses) => (args) => {
    const key = Object.keys(responses).find((k) => args[0].includes(k));
    if (!key) throw new Error(`unexpected ${args[0]}`);
    return responses[key];
  };

  it("takes the newest finished pull-request run and skips a cancelled one", () => {
    const verdict = readOwnVerdict("claude/x", {
      repo: "o/r",
      gh: gh({
        "workflows/ci.yml/runs": {
          workflow_runs: [
            {
              id: 9,
              event: "pull_request",
              status: "completed",
              conclusion: "cancelled",
              head_sha: "c".repeat(40),
              created_at: "2026-10-22T15:00:00Z",
            },
            {
              id: 8,
              event: "pull_request",
              status: "completed",
              conclusion: "success",
              head_sha: "b".repeat(40),
              created_at: "2026-10-22T14:00:00Z",
            },
            {
              id: 7,
              event: "pull_request",
              status: "completed",
              conclusion: "failure",
              head_sha: "a".repeat(40),
              created_at: "2026-10-22T13:00:00Z",
            },
          ],
        },
      }),
    });
    expect(verdict).toEqual({ green: true, sha: "b".repeat(40) });
  });

  it("fails open when there is no branch or GitHub cannot answer", () => {
    expect(readOwnVerdict("", { repo: "o/r" }).unknown).toBeTruthy();
    const verdict = readOwnVerdict("claude/x", {
      repo: "o/r",
      gh: () => {
        throw new Error("network down");
      },
    });
    expect(verdict.unknown).toMatch(/network down/);
  });
});

describe("what the gate does with it", () => {
  it("never refuses, and says when the red run is on this very commit", () => {
    const decision = ownDecision(
      {
        sha: "d3bb0f702a1",
        url: "https://github.com/o/r/actions/runs/1",
        red: ["Build", "Playwright shard 3/6"],
        files: [],
        specs: ["e2e/last-minute-fill.spec.ts"],
        captures: [],
        unnamed: ["Build"],
      },
      { branch: "claude/x", head: "d3bb0f702a1" },
    );
    expect(decision.specs).toEqual(["e2e/last-minute-fill.spec.ts"]);
    expect(decision.lines[0]).toMatch(/on this very commit/);
    expect(decision.lines.join("\n")).toMatch(/Build named no test; read its log/);
    expect(decision).not.toHaveProperty("refuse");
  });

  it("adds nothing when the last run is green or unknown", () => {
    for (const verdict of [{ green: true, sha: "abc123456789" }, { unknown: "offline" }]) {
      const decision = ownDecision(verdict, { branch: "claude/x", head: "f" });
      expect([...decision.files, ...decision.specs, ...decision.captures]).toEqual([]);
      expect(decision.lines).toHaveLength(1);
    }
  });
});
