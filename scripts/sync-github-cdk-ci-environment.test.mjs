import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Stubs the three `gh` invocations the script makes, in order: `gh repo view`
// (returns a fixed owner/repo), `gh api user` (returns a fixed numeric id),
// and `gh api --method PUT .../environments/infra-deploy --input -` (records
// the target path and the JSON body piped to it).
function writeGhStub(binDirectory, pathLog, bodyLog) {
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
    echo "$4" > "${pathLog}"
    cat > "${bodyLog}"
    ;;
  *)
    exit 1
    ;;
esac
`,
  );
  chmodSync(join(binDirectory, "gh"), 0o755);
}

function run(binDirectory) {
  return execFileSync(
    "node",
    [join(process.cwd(), "scripts", "sync-github-cdk-ci-environment.mjs")],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );
}

describe("sync-github-cdk-ci-environment", () => {
  it("PUTs the current gh user as the infra-deploy environment's required reviewer", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-env-");
    const pathLog = join(directory, "path.log");
    const bodyLog = join(directory, "body.log");
    writeGhStub(directory, pathLog, bodyLog);

    const output = run(directory);

    expect(readFileSync(pathLog, "utf8").trim()).toBe(
      "repos/octocat/diveday/environments/infra-deploy",
    );
    expect(JSON.parse(readFileSync(bodyLog, "utf8"))).toEqual({
      wait_timer: 0,
      prevent_self_review: false,
      reviewers: [{ type: "User", id: 42 }],
      deployment_branch_policy: null,
    });
    expect(output).toContain("infra-deploy");
    expect(output).toContain("42");
  });
});
