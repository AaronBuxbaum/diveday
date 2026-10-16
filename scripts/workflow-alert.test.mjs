/**
 * A red scheduled workflow opens one issue, comments on it while it stays red, and closes it
 * when it goes green. The body must pass `check:follow-ups`, because a malformed `needs-triage`
 * issue reddens the daily tracker scan for everyone. The tracker here is a recording stub; no
 * test reaches GitHub.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import {
  ALERT_LABEL,
  ALERTS,
  alertBody,
  alertProblems,
  parseAlertArgs,
  reconcileAlert,
} from "./workflow-alert.mjs";

const root = path.join(import.meta.dirname, "..");
const RUN = "https://github.com/AaronBuxbaum/diveday/actions/runs/123";

function stubTracker(open = []) {
  const calls = [];
  return {
    calls,
    listIssues: ({ label }) => (label === ALERT_LABEL ? open : []),
    comment: (number, body) => calls.push(["comment", number, body]),
    closeIssue: (number, { reason }) => calls.push(["close", number, reason]),
    createIssue: (issue) => {
      calls.push(["create", issue]);
      return { number: 900, url: "" };
    },
  };
}

const quiet = () => {};

describe("workflow-alert", () => {
  for (const [workflow, alert] of Object.entries(ALERTS)) {
    it(`files a ${workflow} body the follow-ups guard accepts, touching real paths`, () => {
      expect(alertProblems(alert, RUN)).toEqual([]);
      const { touched } = findIssueProblems({
        number: 0,
        title: alert.title,
        body: alertBody(alert, RUN),
      });
      expect(touched.length).toBeGreaterThan(0);
      for (const file of touched) expect(existsSync(path.join(root, file)), file).toBe(true);
      expect(existsSync(path.join(root, ".github/workflows", `${workflow}.yml`))).toBe(true);
    });
  }

  it("opens one issue, labelled for triage and as an alert, on the first red run", () => {
    const tracker = stubTracker();
    const did = reconcileAlert({
      workflow: "simulate-day",
      outcome: "failure",
      runUrl: RUN,
      tracker,
      log: quiet,
    });
    expect(did).toBe("opened");
    const [[kind, issue]] = tracker.calls;
    expect(kind).toBe("create");
    expect(issue.title).toBe(ALERTS["simulate-day"].title);
    expect(issue.labels).toEqual(["needs-triage", ALERT_LABEL]);
    expect(issue.body).toContain(RUN);
  });

  it("comments on the open alert instead of opening a second one", () => {
    const tracker = stubTracker([{ number: 41, title: ALERTS["simulate-day"].title }]);
    const did = reconcileAlert({
      workflow: "simulate-day",
      outcome: "failure",
      runUrl: RUN,
      tracker,
      log: quiet,
    });
    expect(did).toBe("commented");
    expect(tracker.calls).toEqual([["comment", 41, `Red again: ${RUN}`]]);
  });

  it("matches by exact title, so another workflow's alert is left alone", () => {
    const tracker = stubTracker([{ number: 41, title: ALERTS["durations-refresh"].title }]);
    expect(
      reconcileAlert({
        workflow: "simulate-day",
        outcome: "success",
        runUrl: RUN,
        tracker,
        log: quiet,
      }),
    ).toBe("nothing");
    expect(tracker.calls).toEqual([]);
  });

  it("closes the open alert as completed on the first green run", () => {
    const tracker = stubTracker([{ number: 41, title: ALERTS["durations-refresh"].title }]);
    const did = reconcileAlert({
      workflow: "durations-refresh",
      outcome: "success",
      runUrl: RUN,
      tracker,
      log: quiet,
    });
    expect(did).toBe("closed");
    expect(tracker.calls).toEqual([
      ["comment", 41, `Green again: ${RUN}. Closing.`],
      ["close", 41, "completed"],
    ]);
  });

  it("does nothing on a green run with no open alert", () => {
    const tracker = stubTracker();
    expect(
      reconcileAlert({
        workflow: "simulate-day",
        outcome: "success",
        runUrl: RUN,
        tracker,
        log: quiet,
      }),
    ).toBe("nothing");
    expect(tracker.calls).toEqual([]);
  });

  it("refuses an unknown workflow, outcome or run URL", () => {
    const ok = ["--workflow", "simulate-day", "--outcome", "failure", "--run-url", RUN];
    expect(parseAlertArgs(ok)).toMatchObject({ workflow: "simulate-day", outcome: "failure" });
    expect(() =>
      parseAlertArgs(["--workflow", "nope", "--outcome", "failure", "--run-url", RUN]),
    ).toThrow(/--workflow/);
    expect(() =>
      parseAlertArgs(["--workflow", "simulate-day", "--outcome", "cancelled", "--run-url", RUN]),
    ).toThrow(/--outcome/);
    expect(() =>
      parseAlertArgs(["--workflow", "simulate-day", "--outcome", "failure", "--run-url", "x"]),
    ).toThrow(/--run-url/);
  });
});
