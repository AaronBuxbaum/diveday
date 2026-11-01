import { expect, it } from "vitest";
import { evidenceManifest, failureGroups, specOwners } from "./ci-evidence.mjs";

it("preserves exact attempts, failed setup steps, evidence and unknown root causes", () => {
  const result = evidenceManifest({
    needs: { playwright: { result: "failure" } },
    jobs: [
      {
        id: 42,
        name: "Playwright 2",
        conclusion: "failure",
        steps: [{ name: "Install browsers", conclusion: "failure" }],
      },
    ],
    annotations: [{ message: "install failed" }],
    env: { GITHUB_SHA: "merge", PR_HEAD_SHA: "head", GITHUB_RUN_ATTEMPT: "2" },
  });
  expect(result.headSha).toBe("head");
  expect(result.attempt).toBe("2");
  expect(result.jobs[0].classification).toBe("unclassified");
  expect(result.attempts[0].failedSteps).toEqual(["Install browsers"]);
});
it("groups shared setup failures without guessing a root cause", () => {
  const groups = failureGroups(
    [
      {
        name: "shard 1",
        conclusion: "failure",
        steps: [{ name: "Install browser", conclusion: "failure" }],
      },
      {
        name: "shard 2",
        conclusion: "failure",
        steps: [{ name: "Install browser", conclusion: "failure" }],
      },
    ],
    [],
  );
  expect(groups).toHaveLength(1);
  expect(groups[0].jobs).toHaveLength(2);
  expect(groups[0].classification).toBe("setup-step-failure");
  expect(groups[0].rootCause).toBeNull();
});
it("lists open PRs that change a failing spec, and not the PR under test", () => {
  const pulls = [
    { number: 7, title: "fix spec", html_url: "u7", head: { sha: "other" } },
    { number: 8, title: "unrelated", html_url: "u8", head: { sha: "other2" } },
    { number: 9, title: "self", html_url: "u9", head: { sha: "head" } },
  ];
  const changed = {
    7: [{ filename: "e2e/board.spec.ts" }],
    8: [{ filename: "src/a.ts" }],
    9: [{ filename: "e2e/board.spec.ts" }],
  };
  const owners = specOwners({
    files: ["e2e/board.spec.ts"],
    pulls,
    filesFor: (number) => changed[number],
    headSha: "head",
  });
  expect(owners).toEqual([
    { number: 7, title: "fix spec", url: "u7", files: ["e2e/board.spec.ts"] },
  ]);
});
it("stays quiet when the pull request API is unavailable", () => {
  expect(
    specOwners({ files: ["e2e/a.spec.ts"], pulls: null, filesFor: () => null }),
  ).toEqual([]);
  expect(
    specOwners({
      files: ["e2e/a.spec.ts"],
      pulls: [{ number: 1, head: {} }],
      filesFor: () => null,
    }),
  ).toEqual([]);
  expect(
    specOwners({
      files: [],
      pulls: [{ number: 1, head: {} }],
      filesFor: () => [],
    }),
  ).toEqual([]);
});
it("records spec owners on the manifest", () => {
  const owners = [
    { number: 7, title: "t", url: "u", files: ["e2e/a.spec.ts"] },
  ];
  expect(evidenceManifest({ env: {}, specOwners: owners }).specOwners).toEqual(
    owners,
  );
  expect(evidenceManifest({ env: {} }).specOwners).toEqual([]);
});
