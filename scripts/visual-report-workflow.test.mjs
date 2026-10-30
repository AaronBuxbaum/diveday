import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { formatPrComment, summarizeReport } from "./visual-report-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CI = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const COMMIT = "b".repeat(40);
const COMMENT_MARKER = "<!-- diveday:visual-summary -->";
const tempDirs = [];

function failureNoticeSection() {
  const name = "      - name: Mark this run's visual result unavailable on the pull request\n";
  const start = CI.indexOf(name);
  if (start < 0) throw new Error("missing visual failure notice step");
  const end = CI.indexOf("\n      - name:", start);
  if (end < 0) throw new Error("missing end of visual failure notice step");
  return CI.slice(start, end);
}

function failureNoticeScript() {
  const section = failureNoticeSection();
  const run = section.indexOf("        run: |\n");
  if (run < 0) throw new Error("missing visual failure script");
  const shell = section
    .slice(run + "        run: |\n".length)
    .split("\n")
    .map((line) => line.replace(/^ {10}/u, ""))
    .join("\n");
  const open = "node --input-type=module <<'NODE'\n";
  const start = shell.indexOf(open);
  const end = shell.lastIndexOf("\nNODE");
  if (start < 0 || end < 0) throw new Error("missing inline Node failure handler");
  return shell.slice(start + open.length, end);
}

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "visual-workflow-test-"));
  tempDirs.push(dir);
  return dir;
}

function mockFetchSource() {
  return `
import { readFileSync, writeFileSync } from "node:fs";
const stateFile = process.env.MOCK_COMMENT_STATE;
globalThis.fetch = async (url, options = {}) => {
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const method = options.method || "GET";
  state.calls.push({ url: String(url), method, signalBounded: options.signal instanceof AbortSignal });
  writeFileSync(stateFile, JSON.stringify(state));
  if (process.env.MOCK_FETCH_MODE === "timeout") {
    return new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 5000);
      const failOnTimeout = () => {
        clearTimeout(keepAlive);
        reject(options.signal.reason);
      };
      if (options.signal.aborted) failOnTimeout();
      else options.signal.addEventListener("abort", failOnTimeout, { once: true });
    });
  }
  const parsed = new URL(url);
  if (method === "GET") {
    return new Response(JSON.stringify(state.comments), { status: 200 });
  }
  if (method === "PATCH") {
    const id = Number(parsed.pathname.split("/").at(-1));
    const comment = state.comments.find((entry) => entry.id === id);
    comment.body = JSON.parse(options.body).body;
    writeFileSync(stateFile, JSON.stringify(state));
    return new Response("{}", { status: 200 });
  }
  if (method === "POST") {
    const comment = { id: 99, user: { login: "github-actions[bot]" }, body: JSON.parse(options.body).body };
    state.comments.push(comment);
    writeFileSync(stateFile, JSON.stringify(state));
    return new Response(JSON.stringify(comment), { status: 201 });
  }
  throw new Error("unexpected request method " + method);
};
`;
}

function runFailureNotice({
  dir,
  statePath,
  timeoutMs = 5000,
  apiTimeoutMs = "1000",
  fetchMode = "normal",
}) {
  const preloadPath = path.join(dir, "mock-fetch.mjs");
  writeFileSync(preloadPath, mockFetchSource());
  return spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preloadPath).href,
      "--input-type=module",
      "--eval",
      failureNoticeScript(),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1_048_576,
      env: {
        ...process.env,
        GH_TOKEN: "test-token",
        GITHUB_API_URL: "https://api.test/",
        GITHUB_REPOSITORY: "diveday/shop",
        PR_NUMBER: "42",
        PR_HEAD_SHA: COMMIT,
        VISUAL_COMMENT_API_TIMEOUT_MS: apiTimeoutMs,
        MOCK_COMMENT_STATE: statePath,
        MOCK_FETCH_MODE: fetchMode,
      },
    },
  );
}

function expectNoSpawnError(result) {
  expect(result.error, result.error?.message ?? "").toBeUndefined();
  expect(result.error?.code).not.toBe("ETIMEDOUT");
}

function expectSpawnSuccess(result) {
  expectNoSpawnError(result);
  expect(result.status, result.stderr).toBe(0);
}

function expectSpawnFailure(result) {
  expectNoSpawnError(result);
  expect(result.status, result.stderr).not.toBe(0);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("visual-report workflow failure notice", () => {
  it("gates reports on this run's publisher and keeps failure handling off checkout code", () => {
    const reportStart = CI.indexOf("\n  visual-report:\n");
    const reportEnd = CI.indexOf("\n  changes:\n", reportStart);
    const report = CI.slice(reportStart, reportEnd);
    expect(report).toContain(
      "if: ${{ !cancelled() && needs.visual.result == 'success' && needs.visual-publish.result == 'success' }}",
    );
    expect(report).toContain("steps.summary.outputs.verdict != 'superseded'");
    expect(report).toContain(
      "ref: ${{ github.event_name == 'pull_request' && 'refs/heads/main' || github.sha }}",
    );
    expect(existsSync(path.join(ROOT, "scripts/visual-pr-comment.mjs"))).toBe(true);
    const reporter = readFileSync(path.join(ROOT, "scripts/visual-pr-comment.mjs"), "utf8");
    expect(reporter).toContain("publicationReportStatus(report, expectedPublicationId)");
    expect(reporter).toContain("This run's visual report was not published or verified");
    const noticeSection = failureNoticeSection();
    expect(noticeSection).toContain("needs.visual-publish.result != 'success'");
    expect(noticeSection).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(noticeSection).toContain("GITHUB_API_URL: ${{ github.api_url }}");
    const notice = failureNoticeScript();
    expect(notice).toContain("AbortSignal.timeout(timeoutMs)");
    expect(notice).toContain('comment.user?.login === "github-actions[bot]"');
    expect(notice).toContain(COMMENT_MARKER);
    expect(notice).not.toContain("gh api");
    expect(notice).not.toContain("scripts/visual-pr-comment.mjs");
    expect(notice).not.toContain("out.json");
    expect(report).toContain(
      "updates only a github-actions[bot] comment with the existing visual-summary marker",
    );
    expect(report).toContain("use a fresh commit key");
    expect(report).toContain("rerun this SHA to publish a new version");
    const forkNoticeStart = report.indexOf(
      "      - name: Explain the missing visual report on a fork pull request",
    );
    const forkNoticeEnd = report.indexOf("      - name:", forkNoticeStart + 1);
    const forkNotice = report.slice(forkNoticeStart, forkNoticeEnd);
    expect(forkNotice).toContain("head.repo.full_name != github.repository");
    expect(forkNotice).toContain("$GITHUB_STEP_SUMMARY");
    expect(forkNotice).not.toContain("GH_TOKEN");
    expect(forkNotice).not.toContain("fetch(");
  });

  it("ignores a user marker and replaces the bot's successful same-head comment", () => {
    const previousSuccess = formatPrComment({
      commit: COMMIT,
      bucket: "diveday-vrt",
      summary: summarizeReport({ passed: ["schedule.png"], failed: ["home.png"] }),
    });
    const userComment = {
      id: 6,
      user: { login: "shop-owner" },
      body: `${COMMENT_MARKER}\nuser-authored comment must remain untouched`,
    };
    const dir = tempDir();
    const statePath = path.join(dir, "comment.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        comments: [
          userComment,
          { id: 7, user: { login: "github-actions[bot]" }, body: previousSuccess },
        ],
        calls: [],
      }),
    );

    const result = runFailureNotice({ dir, statePath });
    expectSpawnSuccess(result);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.comments[0].body).toBe(userComment.body);
    const updated = state.comments[1].body;
    expect(updated).toContain(COMMENT_MARKER);
    expect(updated).toContain(`<!-- diveday:visual-commit: ${COMMIT} -->`);
    expect(updated).toContain("did not successfully verify and publish");
    expect(updated).toContain("Do not read any earlier summary as this run's result");
    expect(updated).toContain("Inspect the visual and publisher logs");
    expect(updated).toContain("use a fresh commit key");
    expect(updated).toContain("rerun this SHA to publish a new version");
    expect(updated).not.toContain("home.png");
    expect(state.calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    expect(
      state.calls.every((call) => call.signalBounded && new URL(call.url).host === "api.test"),
    ).toBe(true);
  });

  it("fails when a bounded GitHub API request times out", () => {
    const dir = tempDir();
    const statePath = path.join(dir, "comment.json");
    writeFileSync(statePath, JSON.stringify({ comments: [], calls: [] }));

    const result = runFailureNotice({
      dir,
      statePath,
      timeoutMs: 2000,
      apiTimeoutMs: "25",
      fetchMode: "timeout",
    });
    expectSpawnFailure(result);
    expect(result.stderr).toContain("request timed out after 25ms");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].signalBounded).toBe(true);
  });
});
