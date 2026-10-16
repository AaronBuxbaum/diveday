import { describe, expect, it } from "vitest";

import { eligible, GITHUB_HOSTED, MAC_LABEL, pickRunner } from "./ci-runner-pick.mjs";

const REPO = "AaronBuxbaum/diveday";
const MAC = JSON.stringify(["self-hosted", MAC_LABEL]);
const GITHUB = JSON.stringify(GITHUB_HOSTED);

const runner = (status, labels = ["self-hosted", "Linux", "ARM64", MAC_LABEL]) => ({
  status,
  labels: labels.map((name) => ({ name })),
});

describe("which runs may use the Mac", () => {
  it("allows a pull request from a branch in this repository", () => {
    expect(eligible({ eventName: "pull_request", repository: REPO, headRepository: REPO })).toBe(
      true,
    );
  });

  it("refuses a pull request from a fork, so a stranger's code never runs on the machine", () => {
    expect(
      eligible({ eventName: "pull_request", repository: REPO, headRepository: "someone/diveday" }),
    ).toBe(false);
  });

  it("refuses a pull request whose head repository is unknown (a deleted fork)", () => {
    expect(
      eligible({ eventName: "pull_request", repository: REPO, headRepository: undefined }),
    ).toBe(false);
  });

  it("allows a push to main and nothing else pushed", () => {
    expect(eligible({ eventName: "push", repository: REPO, ref: "refs/heads/main" })).toBe(true);
    expect(eligible({ eventName: "push", repository: REPO, ref: "refs/heads/other" })).toBe(false);
  });

  it("refuses every other event", () => {
    expect(eligible({ eventName: "schedule", repository: REPO })).toBe(false);
    expect(
      eligible({ eventName: "pull_request_target", repository: REPO, headRepository: REPO }),
    ).toBe(false);
  });
});

describe("where the jobs go", () => {
  it("goes to the Mac when one of its runners is online", () => {
    expect(
      pickRunner({
        allowed: true,
        disabled: false,
        runners: [runner("offline"), runner("online")],
      }),
    ).toBe(MAC);
  });

  it("goes to GitHub when the Mac's runners are all offline (asleep, closed, or never started)", () => {
    expect(pickRunner({ allowed: true, disabled: false, runners: [runner("offline")] })).toBe(
      GITHUB,
    );
    expect(pickRunner({ allowed: true, disabled: false, runners: [] })).toBe(GITHUB);
  });

  it("ignores an online runner without the Mac's label", () => {
    const other = runner("online", ["self-hosted", "Linux"]);
    expect(pickRunner({ allowed: true, disabled: false, runners: [other] })).toBe(GITHUB);
  });

  it("goes to GitHub for an ineligible run even with the Mac online", () => {
    expect(pickRunner({ allowed: false, disabled: false, runners: [runner("online")] })).toBe(
      GITHUB,
    );
  });

  it("goes to GitHub when the kill switch is off, even with the Mac online", () => {
    expect(pickRunner({ allowed: true, disabled: true, runners: [runner("online")] })).toBe(GITHUB);
  });

  it("goes to GitHub when the runner list could not be read", () => {
    expect(pickRunner({ allowed: true, disabled: false, runners: undefined })).toBe(GITHUB);
  });
});

describe("what the step writes for runs-on", () => {
  it("writes one `runner=` line that `fromJSON` reads, and asks nothing without a token", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "runner-pick-"));
    const output = path.join(dir, "output");
    const script = new URL("./ci-runner-pick.mjs", import.meta.url).pathname;
    const run = (env) =>
      execFileSync(process.execPath, [script], {
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, REPOSITORY: REPO, ...env },
        timeout: 10_000,
      });
    run({ EVENT_NAME: "pull_request", HEAD_REPOSITORY: REPO });
    run({
      EVENT_NAME: "pull_request",
      HEAD_REPOSITORY: REPO,
      MAC_RUNNER: "off",
      RUNNER_STATUS_TOKEN: "x",
    });
    run({
      EVENT_NAME: "pull_request",
      HEAD_REPOSITORY: "someone/diveday",
      RUNNER_STATUS_TOKEN: "x",
    });
    const lines = readFileSync(output, "utf8").trim().split("\n");
    expect(lines).toEqual([`runner=${GITHUB}`, `runner=${GITHUB}`, `runner=${GITHUB}`]);
    expect(JSON.parse(lines[0].slice("runner=".length))).toBe("ubuntu-24.04");
  });
});
