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

// Stubs `gh variable set <key> --body <value>`: appends "<key>=<value>" to
// logPath so a test can see exactly what would have been sent to GitHub.
function writeGhStub(binDirectory, logPath, exitCode = 0) {
  writeFileSync(
    join(binDirectory, "gh"),
    `#!/bin/sh
echo "$3=$5" >> "${logPath}"
exit ${exitCode}
`,
  );
  chmodSync(join(binDirectory, "gh"), 0o755);
}

function sync(input, binDirectory) {
  return execFileSync("node", [join(process.cwd(), "scripts", "sync-github-cdk-ci-vars.mjs")], {
    input,
    env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` },
    encoding: "utf8",
  });
}

describe("sync-github-cdk-ci-vars", () => {
  it("sets both role ARNs as repository variables", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-vars-");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath);

    sync(
      "AWS_CDK_DIFF_ROLE_ARN=arn:aws:iam::111:role/diff\nAWS_CDK_DEPLOY_ROLE_ARN=arn:aws:iam::111:role/deploy",
      directory,
    );

    expect(readFileSync(logPath, "utf8")).toBe(
      "AWS_CDK_DIFF_ROLE_ARN=arn:aws:iam::111:role/diff\nAWS_CDK_DEPLOY_ROLE_ARN=arn:aws:iam::111:role/deploy\n",
    );
  });

  it("refuses a blank value instead of clearing the variable", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-vars-");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath);

    expect(() =>
      sync(
        "AWS_CDK_DIFF_ROLE_ARN=\nAWS_CDK_DEPLOY_ROLE_ARN=arn:aws:iam::111:role/deploy",
        directory,
      ),
    ).toThrow();
  });

  it("exits nonzero with nothing on stdin", () => {
    const directory = temporaryDirectory("diveday-gh-cdk-vars-");
    writeGhStub(directory, join(directory, "gh.log"));

    expect(() => sync("", directory)).toThrow();
  });
});
