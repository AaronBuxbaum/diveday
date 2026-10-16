/**
 * A weekly mutation run files its survivors as one issue per module, and the body must pass
 * `check:follow-ups` whatever text a mutant's replacement carries. The tracker is a recording
 * stub; no test reaches GitHub.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import {
  issueBody,
  issueTitle,
  LIST_LIMIT,
  MUTATION_LABEL,
  parseMutationArgs,
  reconcileMutationIssue,
  summarize,
  survivorLine,
  testFileFor,
} from "./mutation-issues.mjs";

const root = path.join(import.meta.dirname, "..");
const RUN = "https://github.com/AaronBuxbaum/diveday/actions/runs/7";
const MODULE = "src/lib/readiness.ts";

const mutant = (line, status, replacement = "false", mutatorName = "ConditionalExpression") => ({
  id: `${line}-${status}`,
  mutatorName,
  replacement,
  status,
  location: { start: { line, column: 3 }, end: { line, column: 9 } },
});

const report = (mutants, file = MODULE) => ({ schemaVersion: "1", files: { [file]: { mutants } } });

function stubTracker(open = []) {
  const calls = [];
  return {
    calls,
    listIssues: ({ label }) => (label === MUTATION_LABEL ? open : []),
    comment: (number, body) => calls.push(["comment", number, body]),
    closeIssue: (number, { reason }) => calls.push(["close", number, reason]),
    createIssue: (issue) => {
      calls.push(["create", issue]);
      return { number: 77, url: "" };
    },
  };
}
const quiet = () => {};

describe("mutation-issues", () => {
  it("scores killed and timed-out mutants against every valid one, survivors in line order", () => {
    const summary = summarize(
      report([
        mutant(9, "Killed"),
        mutant(30, "Survived"),
        mutant(4, "NoCoverage"),
        mutant(12, "Timeout"),
        mutant(15, "CompileError"),
        mutant(16, "Ignored"),
      ]),
      MODULE,
    );
    expect(summary).toMatchObject({ total: 6, killed: 2, score: 50 });
    expect(summary.survivors.map((m) => m.location.start.line)).toEqual([4, 30]);
  });

  it("finds the module under an absolute report key", () => {
    const summary = summarize(report([mutant(1, "Killed")], `/runner/work/${MODULE}`), MODULE);
    expect(summary.score).toBe(100);
  });

  it("refuses a report with no entry for the module", () => {
    expect(() => summarize(report([]), "src/lib/trips.ts")).toThrow(/no entry/);
  });

  it("flattens a replacement and strips its backticks", () => {
    expect(survivorLine(mutant(3, "Survived", "`a`\n  && b"))).toBe(
      "- L3:3 ConditionalExpression → `'a' && b`",
    );
    expect(survivorLine(mutant(3, "NoCoverage"))).toMatch(/no test runs this line/);
  });

  it("composes a body the follow-ups guard accepts, touching real paths", () => {
    const summary = summarize(report([mutant(5, "Survived"), mutant(6, "Killed")]), MODULE);
    const { body, listed } = issueBody(summary, RUN);
    expect(listed).toBe(true);
    const { problems, touched } = findIssueProblems({
      number: 0,
      title: issueTitle(MODULE),
      body,
    });
    expect(problems).toEqual([]);
    for (const file of touched) expect(existsSync(path.join(root, file)), file).toBe(true);
    expect(testFileFor("src/lib/trip-admission.ts")).toBe("src/lib/trip-admission.test.ts");
  });

  it("drops the list to a comment when a replacement trips the guard", () => {
    const summary = summarize(report([mutant(5, "Survived", '"TODO"', "StringLiteral")]), MODULE);
    expect(issueBody(summary, RUN).listed).toBe(false);
    const tracker = stubTracker();
    reconcileMutationIssue({ summary, runUrl: RUN, tracker, log: quiet });
    expect(tracker.calls.map(([kind]) => kind)).toEqual(["create", "comment"]);
    expect(tracker.calls[1][2]).toContain("TODO");
  });

  it("caps the list and counts the rest", () => {
    const many = Array.from({ length: LIST_LIMIT + 3 }, (_, i) => mutant(i + 1, "Survived"));
    const { body } = issueBody(summarize(report(many), MODULE), RUN);
    expect(body).toContain("…and 3 more");
  });

  it("opens one labelled issue, then comments, then closes when nothing survives", () => {
    const survivors = summarize(report([mutant(5, "Survived")]), MODULE);
    const fresh = stubTracker();
    expect(
      reconcileMutationIssue({ summary: survivors, runUrl: RUN, tracker: fresh, log: quiet }),
    ).toBe("opened");
    expect(fresh.calls[0][1].labels).toEqual(["needs-triage", MUTATION_LABEL]);

    const open = [{ number: 12, title: issueTitle(MODULE) }];
    const again = stubTracker(open);
    expect(
      reconcileMutationIssue({ summary: survivors, runUrl: RUN, tracker: again, log: quiet }),
    ).toBe("commented");

    const clean = summarize(report([mutant(5, "Killed")]), MODULE);
    const green = stubTracker(open);
    expect(
      reconcileMutationIssue({ summary: clean, runUrl: RUN, tracker: green, log: quiet }),
    ).toBe("closed");
    expect(green.calls.at(-1)).toEqual(["close", 12, "completed"]);

    const none = stubTracker();
    expect(reconcileMutationIssue({ summary: clean, runUrl: RUN, tracker: none, log: quiet })).toBe(
      "nothing",
    );
  });

  it("leaves another module's issue alone", () => {
    const summary = summarize(report([mutant(5, "Survived")]), MODULE);
    const tracker = stubTracker([{ number: 3, title: issueTitle("src/lib/trip-admission.ts") }]);
    expect(reconcileMutationIssue({ summary, runUrl: RUN, tracker, log: quiet })).toBe("opened");
  });

  it("refuses a missing report, a non-src module or a bad run URL", () => {
    const ok = ["--report", "r.json", "--module", MODULE, "--run-url", RUN];
    expect(parseMutationArgs(ok)).toMatchObject({ module: MODULE, dryRun: false });
    expect(() => parseMutationArgs(["--module", MODULE, "--run-url", RUN])).toThrow(/--report/);
    expect(() =>
      parseMutationArgs(["--report", "r", "--module", "../x.ts", "--run-url", RUN]),
    ).toThrow(/--module/);
    expect(() =>
      parseMutationArgs(["--report", "r", "--module", MODULE, "--run-url", "x"]),
    ).toThrow(/--run-url/);
  });
});
