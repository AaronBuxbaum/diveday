import { describe, expect, it } from "vitest";
import {
  blockingAdvisories,
  ISSUE_TITLE,
  issueBody,
  readAudit,
  reconcile,
  renderAdvisories,
} from "./audit-health.mjs";
import { findIssueProblems } from "./check-follow-ups.mjs";

const advisory = (severity, module_name, extra = {}) => ({
  severity,
  module_name,
  title: `${module_name} problem`,
  vulnerable_versions: "<1.0.0",
  patched_versions: ">=1.0.0",
  url: `https://github.com/advisories/${module_name}`,
  findings: [{ version: "0.9.0", paths: ["a>b", "a>c"], dev: true }],
  ...extra,
});

const report = {
  advisories: {
    1: advisory("moderate", "lodash"),
    2: advisory("high", "zod"),
    3: advisory("critical", "evil", { findings: [{ paths: ["x"], dev: false }] }),
    4: advisory("low", "tiny"),
  },
};

function fakeTracker(open = []) {
  const calls = { created: [], comments: [] };
  return {
    calls,
    listIssues: ({ label } = {}) =>
      label ? open.filter((issue) => issue.labels?.includes(label)) : open,
    createIssue: (issue) => {
      calls.created.push(issue);
      return { number: 9, url: "" };
    },
    comment: (n, body) => calls.comments.push([n, body]),
  };
}

describe("blockingAdvisories", () => {
  it("keeps high and critical only, worst first, and says whether production is reached", () => {
    const list = blockingAdvisories(report);
    expect(list.map((a) => a.module)).toEqual(["evil", "zod"]);
    expect(list[0].reach).toBe("production");
    expect(list[1]).toMatchObject({ reach: "dev", paths: 2 });
  });

  it("does not call an advisory with no findings dev-only", () => {
    const [bare] = blockingAdvisories({
      advisories: { 1: { ...advisory("high", "bare"), findings: [] } },
    });
    expect(bare.reach).toBe("unknown");
    expect(renderAdvisories([bare])).not.toMatch(/dev dependencies only|reaches production/);
  });

  it("refuses output that is not an advisory map rather than reading it as clean", () => {
    expect(() => blockingAdvisories({})).toThrow(/no `advisories`/);
    expect(() => blockingAdvisories(null)).toThrow();
    expect(() => blockingAdvisories({ advisories: [] })).toThrow();
  });

  it("reads a clean tree as clean", () => {
    expect(blockingAdvisories({ advisories: { 1: advisory("low", "x") } })).toEqual([]);
    expect(renderAdvisories([])).toBe("No high or critical advisory.\n");
  });
});

describe("reconcile", () => {
  const list = blockingAdvisories(report);
  const log = () => {};

  it("does nothing on a clean tree, and leaves an open issue alone", () => {
    const tracker = fakeTracker([{ number: 3, title: ISSUE_TITLE }]);
    expect(reconcile({ list: [], tracker, log })).toBe("nothing");
    expect(tracker.calls.created).toHaveLength(0);
    expect(tracker.calls.comments).toHaveLength(0);
  });

  it("reports high advisories without opening or commenting on an issue", () => {
    const highOnly = list.filter((a) => a.severity === "high");
    expect(renderAdvisories(highOnly)).toContain("high: zod");
    for (const issues of [[], [{ number: 3, title: ISSUE_TITLE }]]) {
      const tracker = fakeTracker(issues);
      expect(reconcile({ list: highOnly, tracker, log })).toBe("nothing");
      expect(tracker.calls.created).toHaveLength(0);
      expect(tracker.calls.comments).toHaveLength(0);
    }
  });

  it("opens one needs-triage issue whose body passes check:follow-ups", () => {
    const tracker = fakeTracker();
    expect(reconcile({ list, tracker, log, runUrl: "https://example.test/run/1" })).toBe("opened");
    expect(tracker.calls.created).toHaveLength(1);
    expect(tracker.calls.created[0].body).toContain("critical: evil");
    expect(tracker.calls.created[0].body).not.toContain("high: zod");
    expect(tracker.calls.created[0].labels).toEqual(["needs-triage"]);
    expect(
      findIssueProblems({ number: 0, title: ISSUE_TITLE, body: issueBody(list) }).problems,
    ).toEqual([]);
  });

  it("comments on the open issue instead of filing a second", () => {
    const tracker = fakeTracker([{ number: 3, title: ISSUE_TITLE }]);
    expect(reconcile({ list, tracker, log })).toBe("commented");
    expect(tracker.calls.created).toHaveLength(0);
    expect(tracker.calls.comments[0][0]).toBe(3);
    expect(tracker.calls.comments[0][1]).toContain("critical: evil");
    expect(tracker.calls.comments[0][1]).not.toContain("high: zod");
  });

  it("opens a critical issue even when a legacy high advisory issue is open", () => {
    const tracker = fakeTracker([
      { number: 4625, title: "Dependencies carry a high or critical advisory" },
    ]);
    expect(reconcile({ list, tracker, log })).toBe("opened");
    expect(tracker.calls.comments).toHaveLength(0);
    expect(tracker.calls.created).toHaveLength(1);
  });

  it("updates an existing critical issue after it is relabeled", () => {
    const tracker = fakeTracker([{ number: 4, title: ISSUE_TITLE, labels: ["ready-for-agent"] }]);
    expect(reconcile({ list, tracker, log })).toBe("commented");
    expect(tracker.calls.comments[0][0]).toBe(4);
    expect(tracker.calls.created).toHaveLength(0);
  });
});

describe("readAudit", () => {
  it("reads the JSON whatever the exit code (pnpm audit exits 1 on findings)", () => {
    const run = () => ({ status: 1, stdout: JSON.stringify(report), stderr: "" });
    expect(readAudit(run)).toEqual(report);
  });

  it("throws when there is no JSON, so a broken registry call is not a clean week", () => {
    const run = () => ({ status: 1, stdout: "", stderr: "ENOTFOUND registry" });
    expect(() => readAudit(run)).toThrow(/no JSON/);
  });
});
