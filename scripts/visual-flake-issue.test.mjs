import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findIssueProblems } from "./check-follow-ups.mjs";
import {
  fileFlakes,
  flakyCaptures,
  issueBody,
  issueTitle,
  MAX_ISSUES_PER_RUN,
} from "./visual-flake-issue.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN = "https://github.com/AaronBuxbaum/diveday/actions/runs/1";

/** A Playwright JSON report: one file suite, one describe, the given tests. */
function report(tests, file = "visual-staff-roll-call.spec.ts") {
  return {
    errors: [],
    suites: [
      {
        title: file,
        file,
        specs: [],
        suites: [
          {
            title: "dark mode",
            file,
            specs: tests.map(([title, status, line = 10]) => ({
              title,
              file,
              line,
              tests: [{ projectName: "visual", status, results: [] }],
            })),
          },
        ],
      },
    ],
  };
}

describe("flakyCaptures", () => {
  it("names a capture that failed first and passed on the rerun", () => {
    const flakes = flakyCaptures(
      report([
        ["roll call", "unexpected", 42],
        ["manifest", "expected"],
      ]),
      report([["roll call", "expected", 42]]),
    );
    expect(flakes).toEqual([
      { file: "e2e/visual-staff-roll-call.spec.ts", line: 42, title: "dark mode › roll call" },
    ]);
  });

  it("is not a flake when the rerun failed too", () => {
    expect(
      flakyCaptures(report([["roll call", "unexpected"]]), report([["roll call", "unexpected"]])),
    ).toEqual([]);
  });

  it("ignores a rerun pass of a test the first attempt never failed", () => {
    expect(
      flakyCaptures(report([["roll call", "expected"]]), report([["roll call", "expected"]])),
    ).toEqual([]);
  });

  it("matches by title path, so a same-named capture in another describe is not counted", () => {
    const first = report([["roll call", "unexpected"]]);
    const retry = report([["roll call", "expected"]]);
    retry.suites[0].suites[0].title = "light mode";
    expect(flakyCaptures(first, retry)).toEqual([]);
  });

  it("answers nothing for an empty or malformed report rather than throwing", () => {
    expect(flakyCaptures({}, {})).toEqual([]);
    expect(flakyCaptures(null, null)).toEqual([]);
  });
});

function stubTracker(open = []) {
  const calls = [];
  return {
    calls,
    listIssues: () => open,
    comment: (number, body) => calls.push(["comment", number, body]),
    createIssue: (issue) => {
      calls.push(["create", issue]);
      return { number: 900 };
    },
  };
}

const quiet = () => {};
const FLAKE = { file: "e2e/visual-staff-roll-call.spec.ts", line: 42, title: "dark › roll call" };

describe("fileFlakes", () => {
  it("files a needs-triage body the follow-ups guard accepts, touching real paths", () => {
    const { problems, touched } = findIssueProblems({
      number: 0,
      title: issueTitle(FLAKE),
      body: issueBody(FLAKE, RUN),
    });
    expect(problems).toEqual([]);
    for (const file of touched) expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    expect(issueBody(FLAKE, RUN)).toContain("e2e/visual-staff-roll-call.spec.ts:42");
  });

  it("opens one issue per capture, once even when two shards report it", () => {
    const tracker = stubTracker();
    expect(fileFlakes({ flakes: [FLAKE, FLAKE], runUrl: RUN, tracker, log: quiet })).toEqual([
      "opened",
    ]);
    const [[kind, issue]] = tracker.calls;
    expect(kind).toBe("create");
    expect(issue.title).toBe(issueTitle(FLAKE));
    expect(issue.labels).toEqual(["needs-triage"]);
    expect(issue.body).toContain(RUN);
  });

  it("comments on the open issue for the same capture instead of opening another", () => {
    const tracker = stubTracker([{ number: 7, title: issueTitle(FLAKE) }]);
    expect(fileFlakes({ flakes: [FLAKE], runUrl: RUN, tracker, log: quiet })).toEqual([
      "commented",
    ]);
    expect(tracker.calls).toEqual([["comment", 7, `Flaked again on main: ${RUN}`]]);
  });

  it(`files at most ${MAX_ISSUES_PER_RUN} in one run`, () => {
    const tracker = stubTracker();
    const flakes = Array.from({ length: MAX_ISSUES_PER_RUN + 2 }, (_, n) => ({
      ...FLAKE,
      title: `capture ${n}`,
    }));
    const done = fileFlakes({ flakes, runUrl: RUN, tracker, log: quiet });
    expect(done.filter((did) => did === "opened")).toHaveLength(MAX_ISSUES_PER_RUN);
    expect(done.filter((did) => did === "skipped")).toHaveLength(2);
  });
});
