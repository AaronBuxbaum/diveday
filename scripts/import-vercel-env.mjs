#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAwsLogin } from "./aws-login.mjs";
import { dotenvMap } from "./dotenv.mjs";
import { isTimeout, readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

// Never a bare `process.env.CI`: it is a generic convention many local dev
// tools set, not proof this is really the unattended CI deploy job. `--ci-unattended`
// is passed only by scripts/post-deploy-wizard.mjs when infra-deploy.mjs itself
// was invoked with that flag (which only .github/workflows/infra.yml's deploy
// job does) -- see infra-deploy.mjs's isCiDeploy comment for the full
// rationale, including why an ambient environment-variable signal was tried
// first and rejected.
const rawArguments = process.argv.slice(2);
const isCiDeploy = rawArguments.includes("--ci-unattended");
const checkOnly = rawArguments.includes("--check");
const [inputPath, environment = "production"] = rawArguments.filter(
  (argument) => argument !== "--ci-unattended" && argument !== "--check",
);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development] [--check]",
  );
  process.exit(2);
}

// `(.*)`, not `(.+)`: a deliberately blank value must still be diffed and
// pushed, not silently dropped from both the checkpoint and the sync.
const parseDotenv = dotenvMap;

const document = readFileSync(inputPath, "utf8");

// The generated file is the source for a series of write-only uploads. Do not
// silently ignore a malformed or repeated line and then discover it only after
// the first value has already reached Vercel: every candidate must be
// unambiguous before any external state changes.
const malformedLines = [];
const duplicateKeys = [];
const seenKeys = new Set();
for (const [index, line] of document.split(/\r?\n/).entries()) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) {
    malformedLines.push(index + 1);
    continue;
  }
  if (seenKeys.has(match[1])) duplicateKeys.push(match[1]);
  seenKeys.add(match[1]);
}
if (malformedLines.length > 0 || duplicateKeys.length > 0) {
  const reasons = [];
  if (malformedLines.length > 0) {
    reasons.push(`invalid dotenv line(s) ${malformedLines.join(", ")}`);
  }
  if (duplicateKeys.length > 0) {
    reasons.push(`duplicate variable(s) ${[...new Set(duplicateKeys)].join(", ")}`);
  }
  console.error(`Refusing to upload ${inputPath}: ${reasons.join("; ")}.`);
  process.exit(1);
}

const entries = parseDotenv(document);
if (entries.size === 0) {
  console.error(`Refusing to upload ${inputPath}: it contains no environment variables.`);
  process.exit(1);
}

// Every value is pushed with `--sensitive` below, and Vercel never returns a
// sensitive value again once set -- not to the dashboard, not to `vercel env
// pull`, not to the API. There is nothing to diff a value against, so this
// diffs a fingerprint instead: a SHA-256 of each value, never the value
// itself, held in one SSM Parameter Store String parameter per environment
// (see ADR 20260811-vercel-sync-checkpoint-in-ssm). Unlike a checkpoint file
// on one workstation, this travels with the AWS account: a second operator,
// or the same operator on a new machine, sees the real "already in sync"
// state instead of re-pushing everything once for no reason.
function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

const parameterName = `/diveday/env-sync/vercel/${environment}`;

// On a workstation, diveday-admin is the only profile that can read
// `diveday/env` (the deployer key that may have just run `cdk deploy`
// deliberately cannot), so this reuses that exact administrator channel
// rather than open a second one. Ambient AWS_ACCESS_KEY_ID etc. are stripped
// because AWS gives them precedence over AWS_PROFILE. In CI there is no
// diveday-admin profile: GitHubActionsCdkDeployRole is instead granted
// read/write on this checkpoint's own SSM parameter path (infra-stack.ts
// §18, ADR 20260811-ci-deploy-full-wizard), so the job's already-assumed
// OIDC credentials are reused as-is.
const adminEnvironment = { ...process.env };
if (!isCiDeploy) {
  adminEnvironment.AWS_PROFILE = process.env.INFRA_ENV_SYNC_PROFILE?.trim() || "diveday-admin";
  delete adminEnvironment.AWS_ACCESS_KEY_ID;
  delete adminEnvironment.AWS_SECRET_ACCESS_KEY;
  delete adminEnvironment.AWS_SESSION_TOKEN;
}
adminEnvironment.AWS_DEFAULT_REGION ||= "us-east-1";

try {
  ensureAwsLogin({ environment: adminEnvironment, interactive: !isCiDeploy });
} catch {
  // Deliberately static: no part of this message is read from adminEnvironment
  // or the caught error, both of which can carry values sourced from
  // process.env. ensureAwsLogin already printed whatever the AWS CLI itself
  // reported straight to this terminal (`stdio: "inherit"` in aws-login.mjs).
  console.error(
    isCiDeploy
      ? "Could not read/write the Vercel sync checkpoint with the job's own AWS credentials. Confirm GitHubActionsCdkDeployRole's ReadWriteVercelSyncCheckpoint statement (infra-stack.ts §18) is deployed and the required-reviewer approval on infra-deploy actually ran."
      : "Could not authenticate the AWS profile that holds the Vercel sync checkpoint. Run `aws login --profile diveday-admin` (or set INFRA_ENV_SYNC_PROFILE to the profile you use) in an interactive terminal, then rerun this command.",
  );
  process.exit(1);
}

function readCheckpoint() {
  try {
    const value = readBounded(
      "aws",
      [
        "ssm",
        "get-parameter",
        "--name",
        parameterName,
        "--query",
        "Parameter.Value",
        "--output",
        "text",
      ],
      {
        encoding: "utf8",
        env: adminEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
        timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
      },
    );
    return parseDotenv(value);
  } catch (error) {
    const stderr = error.stderr?.toString() ?? "";
    // A missing parameter is the ordinary first-sync case, not a failure --
    // any other reason (permissions, network, a renamed parameter) must not
    // be swallowed into "nothing synced yet", which is exactly the silence
    // that would hide a real problem. `stderr` is only ever tested here, not
    // logged: the command ran with a profile whose environment is a spread of
    // process.env, so its output must never be echoed back out wholesale --
    // rerunning the same `aws` command directly shows the real error.
    if (isTimeout(error)) {
      // The one reason worth naming rather than folding into the line below:
      // "the call never came back" sends someone looking at the network, not
      // at the parameter's name or their permissions. `error.message` is
      // readBounded's own text -- the argv and the bound, nothing from `env`.
      console.warn(
        `${error.message} Pushing every ${environment} value instead of only what changed.`,
      );
    } else if (!/ParameterNotFound/.test(stderr)) {
      console.warn(
        `Could not read the ${environment} Vercel sync checkpoint from ${parameterName}; pushing every value instead of only what changed. Run \`aws ssm get-parameter --name ${parameterName}\` yourself to see why.`,
      );
    }
    return new Map();
  }
}

const previous = readCheckpoint();

const changed = [...entries].filter(([key, value]) => previous.get(key) !== fingerprint(value));

// Only recorded after every push succeeds, and as fingerprints of the full
// current document -- not just the changed subset, and never the values
// themselves -- so the next run's diff is against reality without this
// parameter ever holding a secret. Standard-tier String parameters cap at
// 4KB. Build and size-check this complete state before the first Vercel upload;
// a future overflow must fail without leaving Vercel partially updated -- the
// fix then is `--tier Advanced` below.
const checkpointDocument = [...entries]
  .map(([key, value]) => `${key}=${fingerprint(value)}`)
  .join("\n");
const checkpointNeedsRefresh =
  previous.size !== entries.size ||
  [...entries].some(([key, value]) => previous.get(key) !== fingerprint(value));
const checkpointBytes = Buffer.byteLength(checkpointDocument, "utf8");
if (checkpointBytes > 4096) {
  console.error(
    `Refusing to upload ${inputPath}: the hashed Vercel sync checkpoint is ${checkpointBytes} bytes, over the 4096-byte Standard-tier SSM limit. Use an Advanced parameter before adding more variables.`,
  );
  process.exit(1);
}

if (checkOnly) {
  // The check is deliberately read-only. It still authenticates and reads the
  // account-wide checkpoint, but it never uploads a Vercel value or refreshes
  // SSM. The wizard uses this to avoid presenting a question whose only work
  // would be a no-op (or a checkpoint cleanup it did not know about).
  console.log(checkpointNeedsRefresh ? "UPDATE" : "CURRENT");
  process.exit(0);
}

// A `--value` of literal argv text sits in `ps` output for any other user on
// this machine to read, the exact reason `vercel env add` above goes through
// stdin instead. Fingerprints aren't secrets, but this document is shaped
// like one line-for-line, so it gets the same treatment: written to a
// private temp file and loaded with the AWS CLI's own `file://` form, never
// passed as a literal argument.
const checkpointDirectory = mkdtempSync(join(tmpdir(), "diveday-vercel-checkpoint-"));
const checkpointFile = join(checkpointDirectory, "checkpoint.env");
let exitCode = 0;
try {
  writeFileSync(checkpointFile, checkpointDocument);

  for (const [key, value] of changed) {
    // Do not put a secret in argv or terminal output. The Vercel CLI reads each
    // value from stdin; --force makes rerunning a rotation deterministic.
    const result = runBounded(
      "pnpm",
      ["exec", "vercel", "env", "add", key, environment, "--force", "--sensitive"],
      {
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
        timeoutMs: SUBPROCESS_TIMEOUTS.vercelCli,
      },
    );
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }

  if (exitCode === 0) {
    // Upload the complete hashed state even when no Vercel value changed. This
    // prunes variables removed from the generated document and keeps the
    // account-wide checkpoint authoritative for every current variable.
    const put = runBounded(
      "aws",
      [
        "ssm",
        "put-parameter",
        "--name",
        parameterName,
        "--type",
        "String",
        "--overwrite",
        "--value",
        `file://${checkpointFile}`,
      ],
      {
        env: adminEnvironment,
        stdio: ["ignore", "inherit", "inherit"],
        timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
      },
    );
    exitCode = put.status ?? 1;
  }
} finally {
  rmSync(checkpointDirectory, { recursive: true, force: true });
}

if (exitCode !== 0) process.exit(exitCode);

console.log(
  changed.length === 0
    ? `No ${environment} Vercel environment variables changed; refreshed the hashed state for all ${entries.size} variable(s).`
    : `Pushed ${changed.length} of ${entries.size} ${environment} Vercel environment variable(s); the rest matched the last sync.`,
);
