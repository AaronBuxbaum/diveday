import { expect, it } from "vitest";
import { evidenceManifest, failureGroups } from "./ci-evidence.mjs";

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
