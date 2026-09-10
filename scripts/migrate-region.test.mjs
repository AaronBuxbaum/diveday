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
 *
 * `delete-stack` makes the following `describe-stacks` fail, which is what
 * CloudFormation itself does and what lets the deletion poll terminate. A fake
 * that kept answering would hang the test for the poll's full 45-minute
 * deadline rather than failing it.
 */
function fixture({
  resourcesExist = false,
  bucketPages = [],
  stackEventReasons = [],
  deployFailures = 0,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "diveday-migrate-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  // Each list-object-versions call answers the next page and then empties, so
  // the sweep terminates the way a real bucket makes it terminate.
  for (const [index, page] of bucketPages.entries()) {
    writeFileSync(join(directory, `page-${index}.json`), JSON.stringify(page));
  }
  writeFileSync(join(directory, "stack-events.json"), JSON.stringify(stackEventReasons));
  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
printf '%s\\n' "$AWS_PROFILE:$*" >> "$DIVEDAY_AWS_LOG"
if [ "$2" = "describe-stack-events" ]; then
  cat "$DIVEDAY_DIR/stack-events.json"
  exit 0
fi
if [ "$1" = "sts" ]; then
  printf '%s' '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:role/admin"}'
  exit 0
fi
if [ "$2" = "delete-stack" ]; then
  : > "$DIVEDAY_DIR/stack-deleted"
  exit 0
fi
if [ "$2" = "describe-stacks" ] && [ -f "$DIVEDAY_DIR/stack-deleted" ]; then
  exit 1
fi
if [ "$2" = "list-object-versions" ]; then
  n=$(cat "$DIVEDAY_PAGE_COUNTER" 2>/dev/null || echo 0)
  printf '%s' "$((n + 1))" > "$DIVEDAY_PAGE_COUNTER"
  if [ -f "$DIVEDAY_DIR/page-$n.json" ]; then cat "$DIVEDAY_DIR/page-$n.json"; else printf '%s' '{}'; fi
  exit 0
fi
${resourcesExist ? "exit 0" : "exit 1"}
`,
  );
  // Fails the first `deployFailures` *main-stack deploys*, as `cdk deploy` does
  // while S3 has not yet freed a bucket name, then succeeds. Scoped to that one
  // command on purpose: counting every pnpm call would fail the bootstrap in
  // step 2 and the run would never reach the deploy under test.
  writeFileSync(
    join(bin, "pnpm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DIVEDAY_PNPM_LOG"
if [ "$1" = "infra:deploy" ] && [ "$2" = "DiveDay" ]; then
  n=$(cat "$DIVEDAY_DEPLOY_COUNTER" 2>/dev/null || echo 0)
  printf '%s' "$((n + 1))" > "$DIVEDAY_DEPLOY_COUNTER"
  if [ "$n" -lt ${deployFailures} ]; then exit 1; fi
fi
exit 0
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
        DIVEDAY_DIR: directory,
        DIVEDAY_PAGE_COUNTER: join(directory, "page-counter"),
        DIVEDAY_DEPLOY_COUNTER: join(directory, "deploy-counter"),
        // Drives the retry loop without sleeping through its real five minutes.
        DIVEDAY_BUCKET_SETTLE_MS: "10",
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

  it("refuses to delete non-interactively without the teardown flag", () => {
    const directory = fixture({ resourcesExist: true });
    // --confirm-account alone is deliberately not enough. It asserts which
    // account, which is a thing somebody might pass in a wrapper script for
    // safety; a flag whose name says "check this is the right account" must
    // never also mean "yes, empty the backup bucket".
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to delete anything non-interactively");
    expect(result.stderr).toContain("--confirm-teardown us-east-1");
    const log = awsLog(directory);
    expect(log).not.toContain("delete-stack");
    expect(log).not.toContain("delete-objects");
    expect(log).not.toContain("delete-bucket");
  });

  it("refuses a teardown flag naming a different region than --from", () => {
    const directory = fixture({ resourcesExist: true });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
      "--confirm-teardown",
      "eu-west-1",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to delete anything non-interactively");
    expect(awsLog(directory)).not.toContain("delete-objects");
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

  it("sweeps versions and delete markers, not just the current objects", () => {
    // The exact shape `aws s3api list-object-versions` answers with. The first
    // version of the sweep asked the CLI for `{Objects: [].{...}}`, which is a
    // flatten over an array applied to this hash -- it matched nothing, every
    // round read zero objects, and the sweep reported success having deleted
    // nothing. The bucket then failed delete-bucket with BucketNotEmpty.
    const directory = fixture({
      resourcesExist: true,
      bucketPages: [
        {
          Versions: [
            { Key: "exports/2026-09-01/blue-mantis.zip", VersionId: "v1", Size: 12 },
            { Key: "exports/2026-09-01/blue-mantis.zip", VersionId: "v0", Size: 11 },
          ],
          DeleteMarkers: [{ Key: "exports/2026-08-25/gone.zip", VersionId: "dm1" }],
        },
      ],
    });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
      "--confirm-teardown",
      "us-east-1",
    );

    const log = awsLog(directory);
    const call = log.split("\n").find((line) => line.includes("delete-objects"));
    expect(call).toBeDefined();
    // Both non-current versions by id, and the delete marker with them. A
    // bucket whose only remaining objects are delete markers is still not empty.
    expect(call).toContain('"VersionId":"v1"');
    expect(call).toContain('"VersionId":"v0"');
    expect(call).toContain('"VersionId":"dm1"');
    expect(call).toContain("exports/2026-08-25/gone.zip");
    // Nothing but Key and VersionId: delete-objects rejects a payload carrying
    // the Size and LastModified the listing also returns.
    expect(call).not.toContain('"Size"');

    // This fixture reports every bucket as still present however many times it
    // is asked, so the run ends on the guard that refuses to hand a half-freed
    // set of global names to the next step. That refusal is the point.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Still taken");
  });

  it("waits and retries while S3 has not freed the deleted bucket names", () => {
    // The failure this covers: step 1 deletes the buckets and confirms the
    // names answer as gone, then step 3 creates them and S3 answers 409
    // OperationAborted because its global namespace has not settled. head-bucket
    // saying 404 and create-bucket succeeding are not the same question.
    const directory = fixture({
      deployFailures: 2,
      stackEventReasons: [
        "A conflicting conditional operation is currently in progress against this resource. Please try again.",
      ],
    });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
      "--confirm-teardown",
      "us-east-1",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("S3 has not freed the bucket names yet");
    // Two failed attempts then a success, and only then the rest of the run.
    const deploys = pnpmLog(directory).trim().split("\n");
    expect(deploys.filter((line) => line.startsWith("infra:deploy DiveDay "))).toHaveLength(3);
    expect(deploys.at(-1)).toBe("infra:deploy --require-approval never");
  });

  it("gives up rather than retrying a deploy that failed for another reason", () => {
    // No bucket-conflict reason in the stack events, so the failure is real and
    // retrying it would turn one error into half an hour of silence.
    const directory = fixture({
      deployFailures: 1,
      stackEventReasons: ["Resource handler returned message: not authorized"],
    });
    const result = run(
      directory,
      "--from",
      "us-east-1",
      "--execute",
      "--confirm-account",
      "123456789012",
      "--confirm-teardown",
      "us-east-1",
    );

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("S3 has not freed the bucket names yet");
    expect(pnpmLog(directory).match(/infra:deploy DiveDay /g)).toHaveLength(1);
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
