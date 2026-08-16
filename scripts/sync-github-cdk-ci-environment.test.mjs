import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Stubs every `gh` invocation the script makes: `gh repo view`, `gh api
// user`, the environment GET, the PUT, and (first-run only) the
// deployment-branch-policies POST. `getResponse` is either a JSON string (the
// existing environment) or the literal "404" to simulate one not existing
// yet. Each PUT/POST call's arguments are appended to callLog as JSON lines
// so a test can inspect exactly what was sent, in order.
function writeGhStub(binDirectory, callLogPath, getResponse) {
  const escapedGetResponse = getResponse.replace(/'/g, "'\\''");
  writeFileSync(
    join(binDirectory, "gh"),
    `#!/bin/sh
case "$1 $2" in
  "repo view")
    echo "octocat/diveday"
    ;;
  "api user")
    echo "42"
    ;;
  "api --method")
    method="$3"
    path="$4"
    body="$(cat 2>/dev/null || true)"
    printf '%s\\n' "{\\"method\\":\\"$method\\",\\"path\\":\\"$path\\",\\"body\\":$([ -n "$body" ] && printf '%s' "$body" || echo null)}" >> "${callLogPath}"
    ;;
  "api repos/octocat/diveday/environments/infra-deploy")
    response='${escapedGetResponse}'
    if [ "$response" = "404" ]; then
      echo "gh: HTTP 404: Not Found" >&2
      exit 1
    fi
    echo "$response"
    ;;
  *)
    echo "unstubbed: $@" >&2
    exit 1
    ;;
esac
`,
  );
  chmodSync(join(binDirectory, "gh"), 0o755);
}

function run(binDirectory, arguments_ = []) {
  return execFileSync(
    "node",
    [join(process.cwd(), "scripts", "sync-github-cdk-ci-environment.mjs"), ...arguments_],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );
}

function readCalls(callLogPath) {
  return readFileSync(callLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("sync-github-cdk-ci-environment", () => {
  it("creates the environment with a main-only branch policy on first run", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-env-");
    const callLogPath = join(directory, "calls.log");
    writeGhStub(directory, callLogPath, "404");

    const output = run(directory);
    const calls = readCalls(callLogPath);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      method: "PUT",
      path: "repos/octocat/diveday/environments/infra-deploy",
      body: {
        wait_timer: 0,
        prevent_self_review: false,
        reviewers: [{ type: "User", id: 42 }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      },
    });
    expect(calls[1]).toEqual({
      method: "POST",
      path: "repos/octocat/diveday/environments/infra-deploy/deployment-branch-policies",
      body: null,
    });
    expect(output).toContain("infra-deploy");
  });

  it("adds the current user to an existing reviewer list instead of replacing it", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-env-");
    const callLogPath = join(directory, "calls.log");
    writeGhStub(
      directory,
      callLogPath,
      JSON.stringify({
        wait_timer: 30,
        prevent_self_review: true,
        protection_rules: [
          {
            type: "required_reviewers",
            reviewers: [{ type: "Team", reviewer: { id: 7, slug: "platform" } }],
          },
        ],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      }),
    );

    run(directory);
    const calls = readCalls(callLogPath);

    // No branch-policy registration call: the environment already existed.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      wait_timer: 30,
      prevent_self_review: true,
      reviewers: [
        { type: "Team", id: 7 },
        { type: "User", id: 42 },
      ],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
  });

  it("does not duplicate the current user if already a reviewer", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-env-");
    const callLogPath = join(directory, "calls.log");
    writeGhStub(
      directory,
      callLogPath,
      JSON.stringify({
        wait_timer: 0,
        prevent_self_review: false,
        protection_rules: [
          {
            type: "required_reviewers",
            reviewers: [{ type: "User", reviewer: { id: 42, login: "octocat" } }],
          },
        ],
        deployment_branch_policy: null,
      }),
    );

    run(directory);
    const calls = readCalls(callLogPath);

    expect(calls[0].body.reviewers).toEqual([{ type: "User", id: 42 }]);
  });

  it("reports an existing current reviewer without updating the environment", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-env-");
    const callLogPath = join(directory, "calls.log");
    writeGhStub(
      directory,
      callLogPath,
      JSON.stringify({
        protection_rules: [
          {
            type: "required_reviewers",
            reviewers: [{ type: "User", reviewer: { id: 42, login: "octocat" } }],
          },
        ],
      }),
    );

    expect(run(directory, ["--check"]).trim()).toBe("CURRENT");
    expect(existsSync(callLogPath)).toBe(false);
  });
});
