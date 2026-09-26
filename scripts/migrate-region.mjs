#!/usr/bin/env node
/**
 * Move the estate from the region it is in to `PRIMARY_REGION`.
 *
 * This is the executable half of docs/engineering/region-migration.md, and it
 * exists because the move is a **teardown**, not a cutover: S3 bucket names and
 * IAM user names are global, so the old estate has to be gone before the new
 * one can be built. A list of commands in a runbook would be fine if the order
 * were the only hard part. It is not -- three of the buckets are RETAIN, so
 * deleting the stack deliberately leaves them behind; one is DESTROY with no
 * `autoDeleteObjects`, so leaving objects in it *fails the stack deletion*
 * half-way; one is versioned, so `aws s3 rm --recursive` empties it in
 * appearance only; and two secrets linger readable in the old region for their
 * recovery window after the stack that owned them is gone, which is how an
 * operator ends up distributing the dead estate's credentials.
 *
 * Every one of those is a step somebody executing a list by hand gets wrong
 * once. So it is a script, and the script defaults to telling you what it would
 * do rather than doing it.
 *
 * The us-east-2 -> us-east-1 move (2026-09-26) added three more, each now
 * handled here rather than by the operator:
 *
 * - A re-run from step 1 against an estate already built in the new region
 *   destroyed it. Step 1 finds the old estate by *global* name, so with the new
 *   stacks up every name it looks for is theirs. Step 1 now refuses outright
 *   when either new stack exists, and a bucket counts as old only when S3 puts
 *   it in `--from`.
 * - The old `diveday-email` stack had to be taken down by hand. Step 1 now does
 *   it when mail is moving too, rule set first.
 * - The email stack's create failed on SES still seeing the recreated inbound
 *   bucket in its old region, and the rollback orphaned that bucket. Step 4 now
 *   gives the email stack the same sweep-wait-retry as step 3 gives the main one.
 *
 * Usage:
 *   node scripts/migrate-region.mjs                      # inventory only
 *   node scripts/migrate-region.mjs --execute            # do it, with prompts
 *   node scripts/migrate-region.mjs --execute --from-step 3
 *
 * `--from us-east-2` names the region being left; it defaults to the region
 * the main stack was last deployed into before it came back to us-east-1.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  EMAIL_STACK_ID,
  EMAIL_STACK_NAME,
  GLOBAL_STACK_ID,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
  PRIMARY_REGION,
  SES_REGION,
} from "../config/aws-regions.mjs";
import { ensureAwsLogin } from "./aws-login.mjs";
import {
  mailLeavesWithTheEstate,
  regionFromLocationConstraint,
  settlingKind,
} from "./migrate-region-rules.mjs";
import { orphansFrom, templateFileNameFor } from "./stack-orphans.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDirectory, "..");

/**
 * The buckets the old main stack owns, and what each one needs before it can go.
 *
 * `retained` is the difference between "CloudFormation deletes this for you"
 * and "CloudFormation deliberately does not", and it is the only per-bucket
 * distinction this script acts on. Versioning is deliberately *not* recorded
 * here even though only `diveday-backups` has it: `emptyBucket` sweeps versions
 * unconditionally, which is a no-op on the other four, and a table saying which
 * bucket is versioned is a thing that can be wrong.
 *
 * Names rather than construct ids because the name is what is global, and being
 * global is the entire reason this script exists. A name alone is also not
 * enough to call a bucket *old*: the new estate uses the same names, so step 0
 * asks S3 which region each one is in and only `--from`'s count.
 *
 * `mail` marks the one the email stack owns, which stays out of the inventory
 * entirely when mail is not leaving `--from`.
 */
const OLD_BUCKETS = [
  { name: "diveday-vrt", retained: false },
  { name: "diveday-backups", retained: true },
  { name: "diveday-database-dumps", retained: true },
  { name: "diveday-media", retained: true },
  { name: "diveday-inbound-mail", retained: true, mail: true },
];

/**
 * The receipt rule set the email stack creates. Hard-coded because its home,
 * SES_INBOUND_RULE_SET_NAME in infra/lib/stack-config.ts, is TypeScript and
 * this is not; step 5 below prints the same name for the same reason.
 */
const INBOUND_RULE_SET_NAME = "diveday-inbound";

/**
 * Secrets that outlive the stack that owned them.
 *
 * The first two are `RemovalPolicy.DESTROY`, which schedules deletion with a
 * recovery window rather than purging -- so for up to 30 days after the old
 * stack is gone, `aws secretsmanager get-secret-value --secret-id diveday/env`
 * against the old region *succeeds* and returns the dead estate's credentials
 * document. That is not hypothetical: it is exactly what a workstation whose
 * AWS profile still names the old region would read. The third is RETAIN and
 * holds a value a human typed, so it is deleted with a recovery window rather
 * than purged.
 */
const OLD_SECRETS = [
  { id: "diveday/env", purge: true },
  { id: "diveday/app-secret-seed", purge: true },
  { id: "diveday/database-url-unpooled", purge: false },
];

/** IAM user names the new stack has to be able to create. Global, so they collide. */
const GLOBAL_USER_NAMES = [
  "diveday-ses-sender",
  "diveday-media-uploader",
  "diveday-backup-uploader",
  "diveday-sns-sms-sender",
  "diveday-cloudwatch-log-shipper",
  "diveday-places-lookup",
  "cdk-deployer",
  "reg-suit-bot",
];

const parameters = process.argv.slice(2);
const execute = parameters.includes("--execute");
const flagValue = (flag, fallback) => {
  const index = parameters.indexOf(flag);
  return index >= 0 ? parameters[index + 1]?.trim() : fallback;
};
const oldRegion = flagValue("--from", "us-east-2");
const fromStep = Number(flagValue("--from-step", "1"));
const confirmedAccount = flagValue("--confirm-account", undefined);
// Separate from --confirm-account on purpose. That one asserts *which account*
// and is a thing somebody might reasonably pass in a wrapper script for safety;
// letting it also authorize an irreversible mass delete would mean a flag whose
// name says "check this is the right account" quietly answering "yes, destroy
// it". This one names the region being torn down and authorizes nothing else.
const confirmedTeardown = flagValue("--confirm-teardown", undefined);

if (!/^[a-z]{2}-[a-z]+-\d$/.test(oldRegion)) {
  console.error(`--from must be an AWS region name; got "${oldRegion}".`);
  process.exit(2);
}
if (oldRegion === PRIMARY_REGION) {
  console.error(
    `Nothing to migrate: --from and PRIMARY_REGION are both ${PRIMARY_REGION}. ` +
      "Change PRIMARY_REGION in config/aws-regions.mjs first, and read " +
      "docs/engineering/region-migration.md before you do.",
  );
  process.exit(2);
}
if (!Number.isInteger(fromStep) || fromStep < 1 || fromStep > 5) {
  console.error("--from-step must be a step number between 1 and 5.");
  process.exit(2);
}

const awsEnvironment = { ...process.env };
// The administrator profile, never an ambient deployer key: this deletes
// stacks and buckets, and the deployer deliberately cannot. Identical handling
// to scripts/infra-bootstrap.mjs, which is the other account-level script.
awsEnvironment.AWS_PROFILE ||= "diveday-admin";
delete awsEnvironment.AWS_ACCESS_KEY_ID;
delete awsEnvironment.AWS_SECRET_ACCESS_KEY;
delete awsEnvironment.AWS_SESSION_TOKEN;
// Assigned, not defaulted: every call below passes `--region` explicitly, and
// this is only here so a profile with no region configured does not fail with
// the AWS CLI's unhelpful NoRegion error.
awsEnvironment.AWS_DEFAULT_REGION = PRIMARY_REGION;

const log = (line) => console.log(line);

/** One bounded AWS CLI call that is allowed to fail, returning stdout or null. */
function awsMaybe(args) {
  try {
    return readBounded("aws", args, {
      encoding: "utf8",
      env: awsEnvironment,
      stdio: "pipe",
      timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
    });
  } catch {
    // Deliberately swallowed rather than reported: every caller is asking "is
    // this thing there?", a missing thing is the answer they want, and the
    // error text can carry an ARN this script has no reason to print.
    return null;
  }
}

/** One bounded AWS CLI call that must succeed. */
function aws(args, timeoutMs = SUBPROCESS_TIMEOUTS.awsApi) {
  return readBounded("aws", args, {
    encoding: "utf8",
    env: awsEnvironment,
    stdio: "pipe",
    timeoutMs,
  });
}

/** A stack's status in one region, or null when there is no such stack. */
function stackStatus(stackName, region) {
  const status = awsMaybe([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    "Stacks[0].StackStatus",
    "--output",
    "text",
  ]);
  return status === null ? null : status.trim();
}

function bucketExists(name) {
  // `--region` is deliberately absent: a bucket name is global, and asking the
  // wrong region for one answers a redirect rather than a 404. What this needs
  // to know is whether the name is taken at all -- *where* is bucketRegion's.
  return awsMaybe(["s3api", "head-bucket", "--bucket", name]) !== null;
}

/**
 * The region a bucket lives in, or null when S3 would not say.
 *
 * The question step 1 did not ask on 2026-09-26. A bucket name answering
 * `head-bucket` says only that *somebody* holds it, and once the new estate is
 * up, that somebody is the new estate. Every delete of a bucket below is gated
 * on this naming the region being cleared; a null is "could not tell", and a
 * bucket this could not place is never touched.
 */
function bucketRegion(name) {
  const raw = awsMaybe(["s3api", "get-bucket-location", "--bucket", name, "--output", "json"]);
  if (raw === null) return null;
  try {
    return regionFromLocationConstraint(JSON.parse(raw || "{}").LocationConstraint);
  } catch {
    return null;
  }
}

function userExists(name) {
  return awsMaybe(["iam", "get-user", "--user-name", name, "--output", "text"]) !== null;
}

function secretExists(id, region) {
  return (
    awsMaybe([
      "secretsmanager",
      "describe-secret",
      "--secret-id",
      id,
      "--region",
      region,
      "--query",
      "Name",
      "--output",
      "text",
    ]) !== null
  );
}

/**
 * Empty a bucket, versions and delete markers included.
 *
 * `aws s3 rm --recursive` is deliberately not used, not even as a fast first
 * pass. On a versioned bucket it writes a delete marker per object and every
 * byte survives as a non-current version, so the bucket reads as empty in the
 * console and `delete-bucket` still answers BucketNotEmpty -- and the markers it
 * just created are themselves more objects for the sweep below to remove. One
 * mechanism that is correct on both kinds of bucket beats a fast one that is
 * correct on one of them.
 */
function emptyBucket(name) {
  // One page at a time, deleting as we go: a listing caps at 1000 keys, and
  // paginating by re-listing after each delete is correct precisely because the
  // deletes shrink the set. The loop is bounded by the bucket emptying, and by
  // the round cap below, so it cannot spin forever on a bucket something else
  // is still writing to.
  //
  // Deliberately no `--query`: the first version of this asked the CLI for
  // `{Objects: [].{Key: Key, VersionId: VersionId}}`, and `[]` is a flatten over
  // an *array*. The response is a hash of `Versions` and `DeleteMarkers`, so the
  // projection matched nothing, every round read zero objects, and the sweep
  // returned on its first pass reporting success. The bucket then failed
  // `delete-bucket` with BucketNotEmpty, which is the loud half of a silent bug.
  // Doing the extraction here means it is covered by a test rather than by a
  // JMESPath expression nothing exercises.
  //
  // Both lists matter and `DeleteMarkers` is the one that is easy to forget: on
  // a versioned bucket every plain delete leaves one behind, and a bucket whose
  // only remaining objects are delete markers is still not empty as far as S3
  // is concerned. An unversioned bucket answers with `Versions` alone, each
  // carrying the literal VersionId "null", which `delete-objects` accepts -- so
  // this one path empties both kinds and there is no flag to get wrong.
  for (let round = 0; round < 1000; round += 1) {
    const listed = aws([
      "s3api",
      "list-object-versions",
      "--bucket",
      name,
      "--max-items",
      "500",
      "--output",
      "json",
    ]);
    const page = JSON.parse(listed || "{}");
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(
      ({ Key, VersionId }) => ({ Key, VersionId }),
    );
    if (objects.length === 0) return;
    aws([
      "s3api",
      "delete-objects",
      "--bucket",
      name,
      "--region",
      oldRegion,
      "--delete",
      JSON.stringify({ Objects: objects, Quiet: true }),
    ]);
  }
  throw new Error(`Gave up emptying ${name} after 1000 rounds. Something is still writing to it.`);
}

/**
 * Poll a stack until it is gone, with a deadline.
 *
 * Not `aws cloudformation wait stack-delete-complete`: the main stack owns a
 * CloudFront distribution, which CloudFormation disables and then deletes, and
 * that alone runs past some of the CLI's waiter ceilings. A wait whose only
 * exit is success is also the shape this repository has an incident about, so
 * this one has a deadline and fails loudly at it.
 */
async function waitForStackDeletion(stackName, region, deadlineMs = 45 * 60_000) {
  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < deadlineMs) {
    const status = awsMaybe([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--region",
      region,
      "--query",
      "Stacks[0].StackStatus",
      "--output",
      "text",
    ]);
    if (status === null) return;
    const trimmed = status.trim();
    if (trimmed !== lastStatus) {
      lastStatus = trimmed;
      log(`  ${stackName}: ${trimmed}`);
    }
    if (trimmed === "DELETE_FAILED") {
      throw new Error(
        `${stackName} is DELETE_FAILED. Open the stack's events in the console: a resource ` +
          "refused deletion, and the usual cause is a bucket that still has objects in it.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(
    `${stackName} was still deleting after ${Math.round(deadlineMs / 60_000)} minutes. ` +
      "Check its events rather than re-running blind.",
  );
}

/**
 * The most recent failure reasons CloudFormation recorded for a stack.
 *
 * Read rather than guessed at: `pnpm()` inherits stdio so this script never
 * sees `cdk deploy`'s output, and retrying on *any* failure would turn a real
 * error into a half-hour of silent retries.
 */
function recentFailureReasons(stackName, region) {
  // No `--query` and no `--max-items`. Both change the shape of what the CLI
  // prints -- `--max-items` makes the paginator wrap the result so it can carry
  // a NextToken -- and the previous version parsed the wrapped shape, threw on
  // `.filter`, caught it, and returned "no reasons". Which reads as "not a
  // settling failure", so the retry never fired. `{ StackEvents: [...] }` is
  // the documented shape and it does not move.
  const raw = awsMaybe([
    "cloudformation",
    "describe-stack-events",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--output",
    "json",
  ]);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return (parsed?.StackEvents ?? [])
      .map((event) => event?.ResourceStatusReason)
      .filter((reason) => typeof reason === "string");
  } catch {
    // `null`, not `[]`. "I could not find out" and "there was nothing" are
    // different answers, and collapsing them is the specific mistake that has
    // now cost five runs of this migration.
    return null;
  }
}

/**
 * Whether a deploy failed because AWS has not caught up with a bucket that was
 * just deleted or recreated, and if so which way (`settlingKind` in
 * scripts/migrate-region-rules.mjs has both reasons and their wording).
 *
 * S3's bucket namespace is global and eventually consistent: for some minutes
 * after a delete `head-bucket` answers 404 -- the name looks free -- while
 * `create-bucket` answers 409 OperationAborted. And SES, checking that the
 * inbound bucket is in its own region, can go on seeing the region a
 * recreated bucket used to be in. There is no API that answers "is this
 * creatable yet", so the only honest test is to try, and the only fix is to
 * wait and try again.
 */
function settlingFailure(stackName, region) {
  const reasons = recentFailureReasons(stackName, region);
  if (reasons === null) {
    log("  Could not read the stack's events, so could not tell why the deploy failed.");
    return null;
  }
  return settlingKind(reasons);
}

/**
 * Statuses that mean a real, deployed stack. This is an update, and its log
 * groups are its own.
 */
const DEPLOYED_STACK_STATUSES = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE",
  "IMPORT_COMPLETE",
  "IMPORT_ROLLBACK_COMPLETE",
]);

/**
 * Statuses that mean a create that never landed. The stack holds no resources
 * and CloudFormation will not update it; delete is the only legal operation.
 *
 * `REVIEW_IN_PROGRESS` is the one that cost three runs. CloudFormation creates
 * the stack in that state the moment `cdk deploy` makes a change set for a
 * brand-new stack, and leaves it there when the change set fails validation --
 * which is exactly what "log group already exists" is. So every attempt left a
 * stack behind, the next attempt read a status that was neither of the two
 * failure states this knew about, concluded the stack was healthy, and returned
 * without sweeping. The sweep was correct by then; it was never called.
 */
const UNLANDED_STACK_STATUSES = new Set([
  "ROLLBACK_COMPLETE",
  "CREATE_FAILED",
  "REVIEW_IN_PROGRESS",
]);

/**
 * Clear the way for `stackId` to be created as `stackName` in `region`: delete
 * a stack a failed create left behind, then sweep what that create orphaned.
 * A deployed stack is left alone -- the deploy is an update.
 */
async function prepareForCreate(stackId, stackName, region) {
  const trimmed = stackStatus(stackName, region);

  if (trimmed !== null && DEPLOYED_STACK_STATUSES.has(trimmed)) return { bucketsFreed: 0 };

  if (trimmed !== null && UNLANDED_STACK_STATUSES.has(trimmed)) {
    log(
      `  ${stackName} is ${trimmed}, which holds no resources and cannot be updated. Deleting it.`,
    );
    aws(["cloudformation", "delete-stack", "--stack-name", stackName, "--region", region]);
    await waitForStackDeletion(stackName, region);
  } else if (trimmed !== null) {
    // Every remaining status is either an operation in flight or one this does
    // not know about, and both are things to stop on rather than guess at. The
    // guess is what this function used to do -- anything unrecognized was read
    // as "healthy", which is how REVIEW_IN_PROGRESS skipped the cleanup three
    // times running.
    throw new Error(
      `${stackName} in ${region} is ${trimmed}, which this script does not know how to prepare. ` +
        "Wait for any operation in flight to finish, or delete the stack by hand, then re-run.",
    );
  }

  // Reached whenever no stack stands in the way: it never existed, this just
  // deleted it, or somebody deleted it by hand between runs. The condition is
  // also the argument for the sweep being safe -- if no stack owns these names,
  // nothing does, so anything holding one is debris from a create that did not
  // finish.
  return deleteWhatTheLastCreateLeft(stackId, region);
}

/**
 * Delete what a rolled-back create leaves behind.
 *
 * Every log group in this stack has a **fixed name**, and a Lambda writes to
 * `/aws/lambda/<function>` whether CloudFormation declared it or not. During a
 * rollback the custom-resource provider functions are invoked to handle their
 * own Delete events, and the Lambda service recreates those log groups *after*
 * CloudFormation has deleted them -- outside the stack, so nothing owns them.
 * The next create then fails with "Resource of type 'AWS::Logs::LogGroup' with
 * identifier '/aws/lambda/diveday-access-key-pruner-provider' already exists",
 * one or two names at a time, for as many attempts as there are orphans.
 *
 * The names come out of the synthesized template rather than a list here. A
 * list would be wrong the first time somebody adds a log group -- and it would
 * be wrong quietly, surfacing as this same failure months later. Two of them
 * (`sns/<region>/<account>/DirectPublishToPhoneNumber` and its `/Failure`
 * sibling) do not even carry the word diveday, so a name filter would miss
 * them too.
 *
 * Safe because of where it is called: only when no stack named for `stackId`
 * stands in `region`, the region the estate is being built into, so nothing of
 * ours owns these names there. A bucket is additionally deleted only when S3
 * puts it in `region` -- a same-named bucket anywhere else is not debris from
 * this create, and is refused with its region named rather than touched.
 */
function deleteWhatTheLastCreateLeft(stackId, region) {
  // The cloud assembly is written relative to the repository, not to the
  // working directory, so the override exists for the tests: a fixture in a
  // temp directory cannot otherwise reach the file this reads, and that gap is
  // exactly why a wrong filename survived a green test run.
  const assemblyDirectory = process.env.DIVEDAY_CDK_OUT || join(repoRoot, "cdk.out");
  const templatePath = join(assemblyDirectory, templateFileNameFor(stackId));
  let template;
  try {
    runBounded("pnpm", ["infra:synth", stackId, "--quiet"], {
      cwd: repoRoot,
      env: awsEnvironment,
      stdio: "ignore",
      timeoutMs: SUBPROCESS_TIMEOUTS.cdkSynth,
    });
    template = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (error) {
    // Names the path. An earlier version reported "could not synthesize" for
    // what was actually a filename mistake, so the one clue that would have
    // solved it in a minute was the one thing not printed.
    log(`  Could not read ${templatePath} to find what the last create left behind.`);
    log(`  Reason: ${error instanceof Error ? error.message : String(error)}`);
    log("  If the deploy fails saying something already exists, delete it and re-run.");
    return { bucketsFreed: 0 };
  }

  const { logGroups, buckets, secrets, unresolved, unsupportedRetained } = orphansFrom(template, {
    account,
    region,
  });
  for (const value of unresolved) {
    log(`  Could not work out one resource's name from the template: ${JSON.stringify(value)}`);
    log("  If the deploy fails saying it already exists, delete it and re-run.");
  }
  for (const { id, type } of unsupportedRetained) {
    log(`  ${id} is a retained ${type}, which this does not know how to remove.`);
    log("  A rolled-back create keeps it, and the next create will fail on its name.");
  }

  const deleted = [];
  const absent = [];
  const failed = [];

  /** Delete one thing, telling "was not there" apart from "was refused". */
  const remove = (label, exists, doDelete) => {
    // Asked before it is deleted, so those two outcomes are different. Until
    // this, both came back as `null` from `awsMaybe` and both printed as
    // nothing-to-do -- so a sweep refused at every turn reported exactly what a
    // sweep with nothing to do reports.
    if (exists() === false) {
      absent.push(label);
      return;
    }
    try {
      doDelete();
      deleted.push(label);
      log(`  Deleted ${label}`);
    } catch (error) {
      const reason = String(error?.stderr ?? "") + String(error?.message ?? error);
      if (reason.includes("ResourceNotFoundException") || reason.includes("NoSuchBucket")) {
        absent.push(label);
        return;
      }
      failed.push({ label, reason: reason.trim().split("\n").at(-1) ?? "no reason given" });
    }
  };

  // Secrets first, then buckets, then log groups -- no ordering requirement
  // between them, but the secret is the cheapest and the buckets are the ones
  // whose names S3 takes minutes to free, so freeing them earliest gives step
  // 3's retry the best chance of not needing to wait.
  for (const name of secrets) {
    remove(
      `secret ${name}`,
      () => secretExists(name, region),
      () =>
        // Purged, not scheduled. A secret in its recovery window still holds its
        // name, which is the whole reason this one is here: the rolled-back
        // create retained it, and a 30-day window would block every retry.
        aws([
          "secretsmanager",
          "delete-secret",
          "--secret-id",
          name,
          "--region",
          region,
          "--force-delete-without-recovery",
        ]),
    );
  }

  for (const name of buckets) {
    remove(
      `bucket ${name}`,
      () => bucketExists(name),
      () => {
        const where = bucketRegion(name);
        if (where !== region) {
          throw new Error(
            `the name is held in ${where ?? "a region S3 would not name"}, not ${region}, so it is not this create's to delete. Find out who owns it.`,
          );
        }
        emptyBucket(name);
        aws(["s3api", "delete-bucket", "--bucket", name, "--region", region]);
      },
    );
  }

  for (const name of logGroups) {
    remove(
      `log group ${name}`,
      () => {
        const listed = awsMaybe([
          "logs",
          "describe-log-groups",
          "--log-group-name-prefix",
          name,
          "--region",
          region,
          "--query",
          "logGroups[].logGroupName",
          "--output",
          "text",
        ]);
        // `--log-group-name-prefix` is a prefix match, so an exact comparison
        // decides. A null listing means the question could not be asked, which
        // is not an answer -- fall through to the delete, which reports its own.
        return listed === null ? null : listed.split(/\s+/).includes(name);
      },
      () => aws(["logs", "delete-log-group", "--log-group-name", name, "--region", region]),
    );
  }

  const total = secrets.length + buckets.length + logGroups.length;
  log(
    `  Left by the last create: ${deleted.length} deleted, ${absent.length} already gone, ${failed.length} refused, of ${total} names this stack claims.`,
  );
  const bucketsFreed = deleted.filter((label) => label.startsWith("bucket ")).length;

  if (failed.length > 0) {
    // Thrown, not warned. Every one of these is a name the deploy is about to
    // try to create, so continuing means failing again in a minute with a
    // worse message than the one AWS just gave us.
    throw new Error(
      `Could not remove ${failed.length} thing(s) the last create left behind, and the deploy will fail on them:\n` +
        failed.map(({ label, reason }) => `  ${label}: ${reason}`).join("\n"),
    );
  }

  return { bucketsFreed };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pnpm(args, timeoutMs) {
  const result = runBounded("pnpm", args, {
    cwd: repoRoot,
    env: awsEnvironment,
    stdio: "inherit",
    timeoutMs,
  });
  if (result.status !== 0) throw new Error(`\`pnpm ${args.join(" ")}\` failed.`);
}

/**
 * Deploy one stack that may be a create, and retry only the failures that are
 * AWS catching up.
 *
 * Step 3 had this loop for the main stack; step 4 deployed the email stack
 * bare, and on 2026-09-26 its create failed on SES still placing the freshly
 * recreated `diveday-inbound-mail` in its old region. The rollback then kept
 * that RETAIN bucket, so the next create would have failed "already exists" --
 * the operator deleted the stack and the bucket by hand. Each attempt here
 * starts with `prepareForCreate`, which is exactly that cleanup.
 */
async function deployCreatingStack(stackId, stackName, region) {
  // Overridable so the tests can drive the waits without sleeping through
  // them. Not a knob for operators: the default is the only value anybody
  // running a migration should use, and shortening it in anger just spends
  // the attempts faster.
  const settleMs = Number(process.env.DIVEDAY_BUCKET_SETTLE_MS || 5 * 60_000);
  const attempts = 7;
  for (let attempt = 1; ; attempt += 1) {
    const { bucketsFreed } = await prepareForCreate(stackId, stackName, region);
    // Wait when the sweep just deleted a bucket. S3 frees a bucket name some
    // minutes after the delete, and the sweep runs *immediately* before this
    // deploy -- so without this, the migration reliably races itself and
    // burns a create, a rollback, and a fresh set of orphans on every run.
    // The retry below still covers the case where this is not long enough;
    // this is here so the common path does not need it.
    if (bucketsFreed > 0) {
      log(
        `  Waiting ${Math.round(settleMs / 1000)}s before deploying: S3 frees a deleted bucket name minutes after the delete, and ${bucketsFreed} of them went just now.`,
      );
      await sleep(settleMs);
    }
    try {
      pnpm(["infra:deploy", stackId, "--require-approval", "never"], SUBPROCESS_TIMEOUTS.cdkDeploy);
      return;
    } catch (error) {
      const kind = settlingFailure(stackName, region);
      if (kind === null) throw error;
      if (attempt >= attempts) {
        throw new Error(
          `${stackName} still cannot create its buckets after ` +
            `${Math.round((attempts * settleMs) / 60_000)} minutes of waiting for AWS to catch up ` +
            "with the buckets deleted and recreated in this migration. That usually takes minutes; " +
            "this is longer than that, so read the stack events rather than waiting further.",
        );
      }
      log("");
      log(
        kind === "ses-bucket-region"
          ? `  SES still places the inbound mail bucket in the region it just left -- the create was refused as "not in the same region as your Amazon SES configuration". Waiting and retrying (attempt ${attempt} of ${attempts}).`
          : `  S3 has not freed the bucket names yet -- create answered 409 while head-bucket says the names are gone. Waiting and retrying (attempt ${attempt} of ${attempts}).`,
      );
      await sleep(settleMs);
    }
  }
}

/**
 * Take the old email stack down, receipt rule set first.
 *
 * CloudFormation cannot delete an *active* receipt rule set, so deleting the
 * stack with it active lands in DELETE_FAILED. Deactivation is region-wide --
 * there is one active set per region, with no name argument meaning "none" --
 * so it only happens when the active set is ours: a set somebody else made
 * active in that region is not this script's to switch off, and the stack
 * delete is then free to proceed because our set is not the active one.
 */
async function tearDownOldEmailStack(region) {
  const active = JSON.parse(
    aws(["ses", "describe-active-receipt-rule-set", "--region", region, "--output", "json"]) ||
      "{}",
  );
  const activeName = active?.Metadata?.Name ?? null;
  if (activeName === INBOUND_RULE_SET_NAME) {
    log(`  deactivating receipt rule set ${INBOUND_RULE_SET_NAME} in ${region}...`);
    aws(["ses", "set-active-receipt-rule-set", "--region", region]);
  } else if (activeName !== null) {
    log(`  the active receipt rule set in ${region} is ${activeName}, not ours; leaving it on.`);
  }
  log(`  deleting stack ${EMAIL_STACK_NAME} in ${region}...`);
  aws(["cloudformation", "delete-stack", "--stack-name", EMAIL_STACK_NAME, "--region", region]);
  await waitForStackDeletion(EMAIL_STACK_NAME, region);
}

/**
 * Ask before something irreversible.
 *
 * `--confirm-teardown <region>` is the non-interactive escape hatch, and it has
 * to name the region for the same reason the typed prompt does: the flag is the
 * authorization, so it should be impossible to supply for any other purpose.
 * It only applies when there is no terminal to ask in -- a run that *has* one
 * always gets the prompt, even with the flag passed, so nobody scripting this
 * discovers they removed a confirmation by adding a safety argument.
 *
 * The first version of this let `--confirm-account` stand in, because that is
 * what the refusal message happened to say. Wrong direction: the message was
 * the thing that was wrong, and `--confirm-account` asserts which account, not
 * that a bucket full of backups may be emptied.
 */
async function confirm(question, expected) {
  if (!stdin.isTTY || !stdout.isTTY) {
    if (confirmedTeardown === expected) return;
    throw new Error(
      `Refusing to delete anything non-interactively. Re-run in a terminal, or pass --confirm-teardown ${expected}.`,
    );
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(question);
    if (answer.trim() !== expected) throw new Error("Cancelled: confirmation did not match.");
  } finally {
    terminal.close();
  }
}

// --- Sign in and pin the account ------------------------------------------

try {
  ensureAwsLogin({ environment: awsEnvironment, interactive: !process.env.CI });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const identity = JSON.parse(aws(["sts", "get-caller-identity", "--output", "json"]) || "{}");
const account = identity.Account?.trim();
if (!/^\d{12}$/.test(account ?? "")) {
  console.error("AWS STS did not return a valid 12-digit caller account.");
  process.exit(1);
}
if (confirmedAccount !== undefined && confirmedAccount !== account) {
  console.error(
    `Refusing to run against account ${account}; --confirm-account is ${confirmedAccount}.`,
  );
  process.exit(1);
}

// --- Step 0: inventory -----------------------------------------------------

log("");
log(`DiveDay region migration: ${oldRegion} -> ${PRIMARY_REGION}`);
log(`Account ${account}, as ${identity.Arn ?? "unknown"}`);
log("");

// Whether the email stack is part of this move at all. When SES_REGION is the
// region being left, mail is staying where it is: its stack and its inbound
// bucket are live, and nothing below may touch either.
const mailMoves = mailLeavesWithTheEstate({ oldRegion, sesRegion: SES_REGION });

// The stacks this migration builds, where it builds them. Either one existing
// means step 1 has already run and the deploys have begun -- and step 1 finds
// the old estate by global name, so against a built new estate every name it
// looks for is the new estate's. That is how a re-run on 2026-09-26 emptied
// and deleted the new buckets and then asked the operator to delete its users.
const newStacks = [
  { name: MAIN_STACK_NAME, region: PRIMARY_REGION },
  ...(mailMoves ? [{ name: EMAIL_STACK_NAME, region: SES_REGION }] : []),
]
  .map((stack) => ({ ...stack, status: stackStatus(stack.name, stack.region) }))
  .filter((stack) => stack.status !== null);

const oldStackPresent = stackStatus(MAIN_STACK_NAME, oldRegion) !== null;
const oldEmailStackPresent = mailMoves && stackStatus(EMAIL_STACK_NAME, oldRegion) !== null;

// A bucket is old when S3 puts it in --from, and only then. A same-named bucket
// in any other region -- the new estate's, an orphan of a rolled-back create,
// anybody's -- is reported and never touched.
const oldBucketNames = OLD_BUCKETS.filter((bucket) => mailMoves || !bucket.mail);
const bucketsHeld = oldBucketNames
  .filter((bucket) => bucketExists(bucket.name))
  .map((bucket) => ({ ...bucket, region: bucketRegion(bucket.name) }));
const bucketsPresent = bucketsHeld.filter((bucket) => bucket.region === oldRegion);
const bucketsElsewhere = bucketsHeld.filter((bucket) => bucket.region !== oldRegion);
const secretsPresent = OLD_SECRETS.filter((secret) => secretExists(secret.id, oldRegion));
const usersPresent = GLOBAL_USER_NAMES.filter((name) => userExists(name));

const describeElsewhere = (bucket) => `${bucket.name} (${bucket.region ?? "region unknown"})`;

log("What is there now:");
log(`  stack ${MAIN_STACK_NAME} in ${oldRegion}: ${oldStackPresent ? "present" : "already gone"}`);
if (mailMoves) {
  log(
    `  stack ${EMAIL_STACK_NAME} in ${oldRegion}: ${oldEmailStackPresent ? "present" : "already gone"}`,
  );
} else {
  log(`  stack ${EMAIL_STACK_NAME}: mail stays in ${SES_REGION}, so it is not part of this move`);
}
log(
  `  buckets in ${oldRegion}: ${
    bucketsPresent.length === 0 ? "none" : bucketsPresent.map((b) => b.name).join(", ")
  }`,
);
if (bucketsElsewhere.length > 0) {
  log(
    `  same-named buckets elsewhere, left alone: ${bucketsElsewhere.map(describeElsewhere).join(", ")}`,
  );
}
log(
  `  secrets readable in ${oldRegion}: ${
    secretsPresent.length === 0 ? "none" : secretsPresent.map((s) => s.id).join(", ")
  }`,
);
log(
  `  IAM users holding a global name: ${
    usersPresent.length === 0 ? "none" : usersPresent.join(", ")
  }`,
);
for (const stack of newStacks) {
  log(`  new estate: ${stack.name} in ${stack.region} is ${stack.status}`);
}
log("");

if (!execute) {
  log("This was an inventory. Nothing has been changed.");
  log("");
  if (newStacks.length > 0) {
    log("The new estate already exists, so step 1 will refuse. Resume with --from-step 3.");
    log("");
  }
  log("If that list is what you expect to lose, re-run with --execute.");
  log("Read docs/engineering/region-migration.md first -- in particular, this");
  log("deletes the visual-regression baselines, every backup bundle, every");
  log("database dump and every media object in the old region. It is written");
  log("for a pre-pilot estate and it is the wrong tool for any other kind.");
  process.exit(0);
}

// --- The destructive run ---------------------------------------------------

// Said before anything else happens, so a missing or mistyped --from-step shows
// up here rather than in the first thing it deletes.
log(`Starting at step ${fromStep} of 5.`);
log("");

// Refused before the confirmation prompt and before the first delete: nothing
// step 1 could do against a built new estate is anything but destruction.
if (fromStep <= 1 && newStacks.length > 0) {
  console.error(
    `Refusing to run step 1: the new estate already exists (${newStacks
      .map((stack) => `${stack.name} in ${stack.region} is ${stack.status}`)
      .join("; ")}).`,
  );
  console.error(
    "Step 1 identifies the old estate by global name, and the new stacks hold those names now: it would empty and delete the new estate's buckets and then stop on its IAM users.",
  );
  console.error(
    `Resume with --from-step 3 (or --from-step 4 once ${MAIN_STACK_NAME} has deployed). Whatever is left in ${oldRegion} is step 5's last check.`,
  );
  process.exit(1);
}

try {
  if (fromStep <= 1) {
    log("Step 1/5: tear down the old estate.");
    if (bucketsPresent.length > 0 || oldStackPresent || oldEmailStackPresent) {
      await confirm(
        `This permanently deletes the above from ${oldRegion}. Type ${oldRegion} to continue: `,
        oldRegion,
      );
    }

    // Emptied *before* the stack deletion, not after. diveday-vrt is
    // RemovalPolicy.DESTROY with no autoDeleteObjects, so CloudFormation tries
    // to delete a non-empty bucket and the whole stack lands in DELETE_FAILED
    // half-way through -- after the CloudFront distribution has already gone.
    for (const bucket of bucketsPresent) {
      log(`  emptying ${bucket.name}...`);
      emptyBucket(bucket.name);
    }

    if (oldStackPresent) {
      log(`  deleting stack ${MAIN_STACK_NAME} in ${oldRegion} (CloudFront makes this slow)...`);
      aws([
        "cloudformation",
        "delete-stack",
        "--stack-name",
        MAIN_STACK_NAME,
        "--region",
        oldRegion,
      ]);
      await waitForStackDeletion(MAIN_STACK_NAME, oldRegion);
    }

    // Before the retained buckets, because the email stack retains
    // diveday-inbound-mail: once the stack is gone the bucket is swept with the
    // others below. Left standing, the stack would keep the name, and the new
    // region's email stack could not take it.
    if (oldEmailStackPresent) await tearDownOldEmailStack(oldRegion);

    // Retained by design, so CloudFormation left them. Deleted here because the
    // new region cannot create a bucket whose global name is still taken.
    for (const bucket of bucketsPresent.filter((candidate) => candidate.retained)) {
      // Asked again rather than trusted from step 0: only a bucket S3 still
      // puts in the old region is deleted, and a gone one answers null.
      if (bucketRegion(bucket.name) !== oldRegion) continue;
      log(`  deleting bucket ${bucket.name}...`);
      // Emptied a second time on purpose: SES can have received more mail into
      // diveday-inbound-mail while the stack was deleting, and delete-bucket
      // refuses a bucket with one object in it.
      emptyBucket(bucket.name);
      aws(["s3api", "delete-bucket", "--bucket", bucket.name, "--region", oldRegion]);
    }

    // The recovery window is the hole here, not the deletion. Purged rather
    // than scheduled so nothing can read the old estate's credentials document
    // out of the old region tomorrow.
    for (const secret of secretsPresent) {
      log(`  ${secret.purge ? "purging" : "deleting"} secret ${secret.id}...`);
      aws([
        "secretsmanager",
        "delete-secret",
        "--secret-id",
        secret.id,
        "--region",
        oldRegion,
        ...(secret.purge
          ? ["--force-delete-without-recovery"]
          : ["--recovery-window-in-days", "7"]),
      ]);
    }

    // Two different answers, and they must not read alike. A name still in the
    // old region is this step's unfinished business. A name held anywhere else
    // is not the old estate's -- no stack of ours exists in the new region, or
    // the refusal above would have stopped the run -- so something this script
    // does not know about owns it, and deleting it to make this pass is how an
    // estate gets destroyed.
    const remaining = oldBucketNames
      .filter((bucket) => bucketExists(bucket.name))
      .map((bucket) => ({ ...bucket, region: bucketRegion(bucket.name) }));
    const stillInOld = remaining.filter((bucket) => bucket.region === oldRegion);
    const heldElsewhere = [
      ...remaining.filter((bucket) => bucket.region !== oldRegion).map(describeElsewhere),
      // IAM has no region to ask, and with the old stack gone nothing of ours
      // should hold these names.
      ...GLOBAL_USER_NAMES.filter((name) => userExists(name)).map((name) => `IAM user ${name}`),
    ];
    const problems = [];
    if (stillInOld.length > 0) {
      problems.push(
        `Still taken in ${oldRegion}, so the next deploy would fail part-way: ${stillInOld
          .map((bucket) => `bucket ${bucket.name}`)
          .join(
            ", ",
          )}. Re-run step 1 -- it only deletes what is in ${oldRegion} -- and read the error it stops on.`,
      );
    }
    if (heldElsewhere.length > 0) {
      problems.push(
        `Still taken by something outside ${oldRegion}: ${heldElsewhere.join(", ")}. No stack of the old estate owns these, so this script will not touch them. Stop and find out what does before going further. If it is a part-built new estate in ${PRIMARY_REGION}, resume with --from-step 3, which sweeps what a rolled-back create left.`,
      );
    }
    if (problems.length > 0) throw new Error(problems.join("\n\n"));
    // Free as in "nothing answers for them", which is not the same as "S3 will
    // let you create them". The deploy in step 3 is what finds out, and it is
    // written to wait rather than to fail.
    log("  the global names answer as gone. S3 can take a few more minutes to");
    log("  let them be created again; step 3 waits for that if it has to.");
  }

  if (fromStep <= 2) {
    log("");
    log(`Step 2/5: bootstrap every region in the registry.`);
    pnpm(["infra:bootstrap", "--confirm-account", account], SUBPROCESS_TIMEOUTS.cdkDeploy);
  }

  if (fromStep <= 3) {
    log("");
    log(`Step 3/5: deploy ${MAIN_STACK_ID} alone, to widen the deploy grants.`);
    log("  Its own per-region grants come from this stack, so nothing else can");
    log("  be deployed or diffed until it has landed once.");
    // Retried, and only on the failures worth retrying. The buckets this stack
    // creates carry the names step 1 just deleted, and S3 frees a bucket name
    // minutes after the delete rather than at it -- so the first attempt here
    // can fail on names that step 1 correctly reported as gone.
    await deployCreatingStack(MAIN_STACK_ID, MAIN_STACK_NAME, PRIMARY_REGION);
  }

  if (fromStep <= 4) {
    log("");
    log(
      `Step 4/5: deploy ${EMAIL_STACK_ID}, then ${MAIN_STACK_ID}, ${EMAIL_STACK_ID} and ${GLOBAL_STACK_ID}.`,
    );
    // The email stack alone first, through the same sweep-wait-retry as step 3:
    // its create recreates diveday-inbound-mail, and SES can go on placing that
    // bucket in the region it just left for some minutes after.
    await deployCreatingStack(EMAIL_STACK_ID, EMAIL_STACK_NAME, SES_REGION);
    pnpm(["infra:deploy", "--require-approval", "never"], SUBPROCESS_TIMEOUTS.cdkDeploy);
  }
} catch (error) {
  console.error("");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(
    "Nothing after the failing step has run. Fix it, then re-run with --from-step <n>.",
  );
  process.exit(1);
}

// --- Step 5: what a script cannot do --------------------------------------

log("");
log("Step 5/5: what is left, and none of it is automatable.");
log("");
log(`  1. DNS, from the ${EMAIL_STACK_ID} outputs. New region means new DKIM tokens,`);
log("     and both MX records name the region. Each MX is a delete-then-add:");
log("     SES refuses the MAIL FROM setup outright if the subdomain has two.");
log("     The post-deploy wizard offers the adds and will refuse to create a");
log("     second MX beside a stale one.");
log("");
log(`  2. Activate the receipt rule set in ${PRIMARY_REGION}:`);
log(
  `     aws ses set-active-receipt-rule-set --rule-set-name diveday-inbound --region ${PRIMARY_REGION}`,
);
log("");
log(`  3. File the SES production-access request in ${PRIMARY_REGION}. Fresh sandbox,`);
log("     fresh case. See docs/engineering/ses-email-runbook.md for the case text.");
log("");
log(`  4. Start the SMS registrations in ${PRIMARY_REGION}: sandbox exit, spend limit,`);
log("     origination identity. The 10DLC vetting is measured in weeks, so this");
log("     is the one to start today rather than when a shop needs a text.");
log("");
log("  5. Confirm three alarm subscription emails, one per alarm topic. The");
log("     links expire after three days.");
log("");
log("  6. Check the address card: Amazon Location's Places API is not served in");
log("     every region, and an unserved one fails in DNS with nothing to read.");
log(`     aws geo-places search-text --query-text test --region ${PRIMARY_REGION}`);
log("");
log("  7. Redeploy the app. Every AWS credential is new, and so are");
log("     RUM_APP_MONITOR_ID and MEDIA_PUBLIC_URL_BASE.");
log("");
log(`  8. Check ${oldRegion} is actually empty: log groups outside a stack and`);
log("     console-created alarms survive a stack deletion and still cost money.");
log(`     aws cloudformation list-stacks --region ${oldRegion}`);
log(`     Expect the CDK bootstrap stack and ${GLOBAL_STACK_ID}, and nothing else.`);
log("");
log("The full version of all seven is docs/engineering/region-migration.md.");

if (!existsSync(join(repoRoot, "docs", "engineering", "region-migration.md"))) {
  log("");
  log("(That runbook is missing from this checkout, which means this script is");
  log(" newer than the tree it is running in. Check you are on the right branch.)");
}
