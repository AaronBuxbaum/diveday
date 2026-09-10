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
 * Usage:
 *   node scripts/migrate-region.mjs                      # inventory only
 *   node scripts/migrate-region.mjs --execute            # do it, with prompts
 *   node scripts/migrate-region.mjs --execute --from-step 2
 *
 * `--from us-east-1` names the region being left; it defaults to the only
 * region this repository has ever deployed the main stack into.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  EMAIL_STACK_ID,
  GLOBAL_STACK_ID,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
  PRIMARY_REGION,
} from "../config/aws-regions.mjs";
import { ensureAwsLogin } from "./aws-login.mjs";
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
 * global is the entire reason this script exists.
 */
const OLD_BUCKETS = [
  { name: "diveday-vrt", retained: false },
  { name: "diveday-backups", retained: true },
  { name: "diveday-database-dumps", retained: true },
  { name: "diveday-media", retained: true },
  { name: "diveday-inbound-mail", retained: true },
];

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
const oldRegion = flagValue("--from", "us-east-1");
const fromStep = Number(flagValue("--from-step", "1"));
const confirmedAccount = flagValue("--confirm-account", undefined);

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

function stackExists(stackName, region) {
  return (
    awsMaybe([
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
    ]) !== null
  );
}

function bucketExists(name) {
  // `--region` is deliberately absent: a bucket name is global, and asking the
  // wrong region for one answers a redirect rather than a 404. What this needs
  // to know is whether the name is taken at all.
  return awsMaybe(["s3api", "head-bucket", "--bucket", name]) !== null;
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
 * Ask before something irreversible.
 *
 * `--confirm-account` is the non-interactive escape hatch, exactly as
 * `scripts/infra-bootstrap.mjs` uses it, and it only applies when there is no
 * terminal to ask in. A run that *has* a terminal always gets the prompt, even
 * with the flag passed: somebody who supplies it to pin the account must not
 * find that doing so quietly removed a confirmation.
 *
 * Until this matched, the refusal below named a remedy that did not work --
 * it told the operator to pass `--confirm-account` and then refused anyway.
 */
async function confirm(question, expected) {
  if (!stdin.isTTY || !stdout.isTTY) {
    if (confirmedAccount !== undefined) return;
    throw new Error(
      `Refusing to continue non-interactively. Re-run in a terminal, or pass --confirm-account ${account}.`,
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

const oldStackPresent = stackExists(MAIN_STACK_NAME, oldRegion);
const bucketsPresent = OLD_BUCKETS.filter((bucket) => bucketExists(bucket.name));
const secretsPresent = OLD_SECRETS.filter((secret) => secretExists(secret.id, oldRegion));
const usersPresent = GLOBAL_USER_NAMES.filter((name) => userExists(name));

log("What is there now:");
log(`  stack ${MAIN_STACK_NAME} in ${oldRegion}: ${oldStackPresent ? "present" : "already gone"}`);
log(
  `  buckets holding a global name: ${
    bucketsPresent.length === 0 ? "none" : bucketsPresent.map((b) => b.name).join(", ")
  }`,
);
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
log("");

if (!execute) {
  log("This was an inventory. Nothing has been changed.");
  log("");
  log("If that list is what you expect to lose, re-run with --execute.");
  log("Read docs/engineering/region-migration.md first -- in particular, this");
  log("deletes the visual-regression baselines, every backup bundle, every");
  log("database dump and every media object in the old region. It is written");
  log("for a pre-pilot estate and it is the wrong tool for any other kind.");
  process.exit(0);
}

// --- The destructive run ---------------------------------------------------

try {
  if (fromStep <= 1) {
    log("Step 1/5: tear down the old estate.");
    if (bucketsPresent.length > 0 || oldStackPresent) {
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

    // Retained by design, so CloudFormation left them. Deleted here because the
    // new region cannot create a bucket whose global name is still taken.
    for (const bucket of bucketsPresent.filter((candidate) => candidate.retained)) {
      if (!bucketExists(bucket.name)) continue;
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

    const stillTaken = [
      ...OLD_BUCKETS.filter((bucket) => bucketExists(bucket.name)).map((b) => `bucket ${b.name}`),
      ...GLOBAL_USER_NAMES.filter((name) => userExists(name)).map((name) => `IAM user ${name}`),
    ];
    if (stillTaken.length > 0) {
      throw new Error(
        `Still taken, so the next deploy would fail part-way: ${stillTaken.join(", ")}. ` +
          "Delete them by hand, then re-run with --from-step 2.",
      );
    }
    log("  the global names are free.");
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
    pnpm(
      ["infra:deploy", MAIN_STACK_ID, "--require-approval", "never"],
      SUBPROCESS_TIMEOUTS.cdkDeploy,
    );
  }

  if (fromStep <= 4) {
    log("");
    log(`Step 4/5: deploy ${MAIN_STACK_ID}, ${EMAIL_STACK_ID} and ${GLOBAL_STACK_ID}.`);
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
log("  6. Redeploy the app. Every AWS credential is new, and so are");
log("     RUM_APP_MONITOR_ID and MEDIA_PUBLIC_URL_BASE.");
log("");
log(`  7. Check ${oldRegion} is actually empty: log groups outside a stack and`);
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
