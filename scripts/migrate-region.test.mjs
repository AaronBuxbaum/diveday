import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRIMARY_REGION } from "../config/aws-regions.mjs";

/**
 * The one script in this repository that deletes production-shaped resources.
 *
 * What is pinned here is not that the happy path works -- it is that the
 * dangerous paths refuse. A default run must touch nothing; a run against the
 * region the estate is already in must refuse rather than tear down what it
 * just built; and a mismatched account confirmation must stop before the first
 * delete rather than after it.
 */

const directories = [];

/**
 * A fake `aws` that answers STS and reports every other resource as absent, so
 * the inventory comes back empty and `--execute` needs no interactive
 * confirmation. `exit 1` is how the real CLI reports a missing stack, bucket,
 * user or secret, and it is what `awsMaybe` reads as "already gone".
 */
function fixture({ resourcesExist = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "diveday-migrate-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
printf '%s\\n' "$AWS_PROFILE:$*" >> "$DIVEDAY_AWS_LOG"
if [ "$1" = "sts" ]; then
  printf '%s' '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:role/admin"}'
  exit 0
fi
${resourcesExist ? "exit 0" : "exit 1"}
`,
  );
  writeFileSync(
    join(bin, "pnpm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DIVEDAY_PNPM_LOG"
`,
  );
  chmodSync(join(bin, "aws"), 0o755);
  chmodSync(join(bin, "pnpm"), 0o755);
  return directory;
}

function run(directory, ...arguments_) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "migrate-region.mjs"), ...arguments_],
    {
      cwd: directory,
      env: {
        ...process.env,
        CI: "1",
        DIVEDAY_AWS_LOG: join(directory, "aws.log"),
        DIVEDAY_PNPM_LOG: join(directory, "pnpm.log"),
        PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );
}

const awsLog = (directory) => readFileSync(join(directory, "aws.log"), "utf8");
const pnpmLog = (directory) => {
  try {
    return readFileSync(join(directory, "pnpm.log"), "utf8");
  } catch {
    return "";
  }
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("infra:migrate-region", () => {
  it("reports what it would delete and changes nothing without --execute", () => {
    const directory = fixture({ resourcesExist: true });
    const result = run(directory, "--from", "us-east-1", "--confirm-account", "123456789012");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("This was an inventory. Nothing has been changed.");
    // The whole point of the default. A dry run that deleted one thing would be
    // worse than no dry run at all, because it would be trusted.
    const log = awsLog(directory);
    expect(log).not.toContain("delete-stack");
    expect(log).not.toContain("delete-bucket");
    expect(log).not.toContain("delete-secret");
    expect(log).not.toContain("delete-objects");
    expect(log).not.toContain("s3 rm");
    expect(pnpmLog(directory)).toBe("");
  });

  it("names the account and the direction of travel before anything else", () => {
    const directory = fixture({ resourcesExist: true });
    const result = run(directory, "--from", "us-east-1", "--confirm-account", "123456789012");

    expect(result.stdout).toContain(`us-east-1 -> ${PRIMARY_REGION}`);
    expect(result.stdout).toContain("Account 123456789012");
    // Read off the caller identity, never assumed: the failure this prevents is
    // tearing down the estate in somebody else's account.
    expect(awsLog(directory)).toContain("diveday-admin:sts get-caller-identity");
  });

  it("refuses a --from that is already the destination", () => {
    const directory = fixture();
    const result = run(directory, "--from", PRIMARY_REGION, "--execute");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Nothing to migrate");
    // Refused before sign-in, so a mistyped --from cannot even reach AWS.
    expect(pnpmLog(directory)).toBe("");
  });

  it("refuses when the confirmed account is not the signed-in one", () => {
    const directory = fixture({ resourcesExist: true });
    const result = run(directory, "--from", "us-east-1", "--confirm-account", "210987654321");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to run against account 123456789012");
    const log = awsLog(directory);
    expect(log).not.toContain("delete-stack");
    expect(log).not.toContain("delete-bucket");
  });

  it("refuses a --from-step outside the five steps", () => {
    const directory = fixture();
    const result = run(directory, "--from", "us-east-1", "--execute", "--from-step", "9");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--from-step must be a step number between 1 and 5");
  });

  it("runs the deploys in order when the old estate is already gone", () => {
    const directory = fixture({ resourcesExist: false });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
    );

    expect(result.status).toBe(0);
    // Nothing was there, so nothing was deleted and no confirmation was needed:
    // re-running a half-finished migration has to be safe, or an operator who
    // hits a DELETE_FAILED half way has no way back in.
    const log = awsLog(directory);
    expect(log).not.toContain("delete-stack");
    expect(log).not.toContain("delete-bucket");

    // The main stack alone before the other two, because its own per-region
    // deploy grants come from it -- deploying all three first fails on an
    // AccessDenied that reads as a broken trust policy.
    const deploys = pnpmLog(directory).trim().split("\n");
    expect(deploys[0]).toContain("infra:bootstrap --confirm-account 123456789012");
    expect(deploys[1]).toContain("infra:deploy DiveDay");
    expect(deploys[2]).toBe("infra:deploy --require-approval never");
  });

  it("hands back the manual steps a script cannot do", () => {
    const directory = fixture({ resourcesExist: false });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
    );

    // Each of these is a way for the migration to look finished and not be.
    expect(result.stdout).toContain("set-active-receipt-rule-set");
    expect(result.stdout).toContain("production-access request");
    expect(result.stdout).toContain("10DLC");
    expect(result.stdout).toContain("three alarm subscription emails");
    expect(result.stdout).toContain("docs/engineering/region-migration.md");
  });
});
