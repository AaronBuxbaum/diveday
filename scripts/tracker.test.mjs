import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createTracker,
  ghApi,
  lastLabelledAt,
  repoSlug,
  TrackerError,
  toIssue,
} from "./tracker.mjs";

// Responses recorded from GitHub's REST API (see `_recorded` in the file).
const RECORDED = JSON.parse(readFileSync(new URL("./tracker.fixtures.json", import.meta.url)));

/** A runner that answers from `routes` (endpoint prefix → JSON) and records every call. */
function fakeGh(routes) {
  const calls = [];
  const run = (args, input) => {
    calls.push({ args, input });
    const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const hit = Object.entries(routes).find(([prefix]) => endpoint.startsWith(prefix));
    if (!hit) return { status: 1, stdout: "", stderr: `HTTP 404: Not Found (${endpoint})` };
    const value = typeof hit[1] === "function" ? hit[1](endpoint) : hit[1];
    return { status: 0, stdout: JSON.stringify(value), stderr: "" };
  };
  return { run, calls };
}

const REPO = "AaronBuxbaum/diveday";
const BASE = `repos/${REPO}`;

describe("reading issues", () => {
  it("returns gh issue list's shape and drops the pull requests the REST list mixes in", () => {
    const { run } = fakeGh({ [`${BASE}/issues?`]: RECORDED.issues });
    const issues = createTracker({ repo: REPO, run }).listIssues({ label: "ready-for-agent" });
    expect(issues.map((issue) => issue.number)).toEqual([2366, 2365]);
    expect(issues[0]).toMatchObject({
      state: "OPEN",
      createdAt: expect.stringMatching(/^2026-10-/),
      labels: [{ name: "bug" }, { name: "ready-for-agent" }],
    });
    expect(typeof issues[0].body).toBe("string");
  });

  it("asks for the label and state in the query", () => {
    const { run, calls } = fakeGh({ [`${BASE}/issues?`]: [] });
    createTracker({ repo: REPO, run }).listIssues({ label: "in-progress", state: "closed" });
    expect(calls[0].args).toEqual([
      `${BASE}/issues?state=closed&labels=in-progress&per_page=100&page=1`,
    ]);
  });

  it("follows pages until one comes back short", () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: "t" }));
    const { run, calls } = fakeGh({
      [`${BASE}/issues?`]: (endpoint) => (endpoint.endsWith("page=1") ? full : [full[0]]),
    });
    expect(createTracker({ repo: REPO, run }).listIssues()).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it("attaches comments when asked, oldest first, in gh's shape", () => {
    const { run } = fakeGh({
      [`${BASE}/issues/2366/comments`]: RECORDED.comments,
      [`${BASE}/issues/2365/comments`]: [],
      [`${BASE}/issues?`]: RECORDED.issues,
    });
    const [first] = createTracker({ repo: REPO, run }).listIssues({ comments: true });
    expect(first.comments).toHaveLength(RECORDED.comments.length);
    expect(first.comments[0]).toEqual({
      body: RECORDED.comments[0].body,
      createdAt: RECORDED.comments[0].created_at,
    });
  });

  it("reads open pull requests' head branches", () => {
    const { run } = fakeGh({ [`${BASE}/pulls?`]: RECORDED.pulls });
    const pulls = createTracker({ repo: REPO, run }).listPulls({ state: "closed" });
    expect(pulls[0]).toMatchObject({ number: 2367, headRefName: "claude/project-thread-vidbfn-5" });
  });

  it("leaves out pull requests whose head is in another repository", () => {
    const own = {
      number: 1,
      head: { ref: "a", repo: { full_name: "o/r" } },
      base: { ref: "main", repo: { full_name: "o/r" } },
    };
    const fork = {
      number: 2,
      head: { ref: "b", repo: { full_name: "x/r" } },
      base: { ref: "main", repo: { full_name: "o/r" } },
    };
    const gone = {
      number: 3,
      head: { ref: "c", repo: null },
      base: { ref: "main", repo: { full_name: "o/r" } },
    };
    const { run } = fakeGh({ [`${BASE}/pulls?`]: [own, fork, gone] });
    const pulls = createTracker({ repo: REPO, run }).listPulls();
    expect(pulls.map((pull) => pull.number)).toEqual([1]);
  });

  it("finds when a label was last added from the issue's events", () => {
    expect(lastLabelledAt(RECORDED.events, "in-progress")).toBe("2026-10-10T09:46:09Z");
    expect(lastLabelledAt(RECORDED.events, "wontfix")).toBeNull();
  });

  it("throws a TrackerError naming the call when gh fails, so callers can fail open", () => {
    const { run } = fakeGh({});
    expect(() => createTracker({ repo: REPO, run }).getIssue(1)).toThrow(TrackerError);
    expect(() => createTracker({ repo: REPO, run }).getIssue(1)).toThrow(/gh api .*issues\/1/);
  });

  it("refuses something that is not an issue number before calling gh", () => {
    const { run, calls } = fakeGh({});
    expect(() => createTracker({ repo: REPO, run }).getIssue("1; rm")).toThrow(TrackerError);
    expect(calls).toHaveLength(0);
  });

  it("reads labels given as plain strings as well as objects", () => {
    expect(toIssue({ number: 1, labels: ["bug"] }).labels).toEqual([{ name: "bug" }]);
  });
});

describe("writing issues", () => {
  it("sends the fields as JSON on stdin, never in argv", () => {
    const { run, calls } = fakeGh({ [`${BASE}/issues`]: { number: 9, html_url: "https://x/9" } });
    const created = createTracker({ repo: REPO, run }).createIssue({
      title: "--upload-pack=evil",
      body: "body",
      labels: ["needs-triage"],
    });
    expect(created).toEqual({ number: 9, url: "https://x/9" });
    expect(calls[0].args).toEqual(["--method", "POST", `${BASE}/issues`, "--input", "-"]);
    expect(JSON.parse(calls[0].input)).toEqual({
      title: "--upload-pack=evil",
      body: "body",
      labels: ["needs-triage"],
    });
  });

  it("sends nothing under a dry run and says what it would have sent", () => {
    const lines = [];
    const { run, calls } = fakeGh({});
    const tracker = createTracker({ repo: REPO, run, log: (line) => lines.push(line) });
    expect(tracker.createIssue({ title: "t", body: "b" }, { dryRun: true })).toBeNull();
    tracker.comment(5, "hello", { dryRun: true });
    tracker.editLabels(5, { add: ["a"], remove: ["in-progress"] }, { dryRun: true });
    tracker.closeIssue(5, {}, { dryRun: true });
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(7);
    expect(lines[3]).toContain(`DELETE ${BASE}/issues/5/labels/in-progress`);
    expect(lines[4]).toContain('"state_reason":"completed"');
  });

  it("strips in-progress and ready-for-agent when it closes an issue, after the close", () => {
    const { run, calls } = fakeGh({ [`${BASE}/issues/7`]: { number: 7 } });
    createTracker({ repo: REPO, run }).closeIssue(7);
    expect(calls.map((call) => call.args.slice(0, 3).join(" "))).toEqual([
      `--method PATCH ${BASE}/issues/7`,
      `--method DELETE ${BASE}/issues/7/labels/in-progress`,
      `--method DELETE ${BASE}/issues/7/labels/ready-for-agent`,
    ]);
  });

  it("treats removing a label the issue does not carry as done", () => {
    const { run } = fakeGh({});
    expect(() =>
      createTracker({ repo: REPO, run }).editLabels(5, { remove: ["in-progress"] }),
    ).not.toThrow();
  });
});

describe("repoSlug", () => {
  it("takes GITHUB_REPOSITORY in Actions and this repository otherwise", () => {
    expect(repoSlug({ GITHUB_REPOSITORY: "a/b" })).toBe("a/b");
    expect(repoSlug({})).toBe(REPO);
    expect(repoSlug({ GITHUB_REPOSITORY: "not a slug" })).toBe(REPO);
  });
});

describe("the gh runner", () => {
  it("holds a full page of closed pull requests, which overflowed spawnSync's 1 MB (2026-10-15)", () => {
    // One page of 100 closed PRs was 2.3 MB; the default buffer cut gh off with an empty stderr
    // and the nightly expire-claims run failed with "…failed: " and nothing after it.
    let options;
    ghApi(["repos/o/r/pulls?state=closed&per_page=100"], undefined, (_cmd, _args, opts) => {
      options = opts;
      return { status: 0, stdout: "[]" };
    });
    expect(options.maxBuffer).toBeGreaterThanOrEqual(32 * 1024 * 1024);
  });
});
