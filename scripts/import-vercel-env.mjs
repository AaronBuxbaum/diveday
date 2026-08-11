#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ensureAwsLogin } from "./aws-login.mjs";

const [inputPath, environment = "production"] = process.argv.slice(2);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development]",
  );
  process.exit(2);
}

// `(.*)`, not `(.+)`: a deliberately blank value must still be diffed and
// pushed, not silently dropped from both the checkpoint and the sync.
const envLine = /^([A-Z][A-Z0-9_]*)=(.*)$/;
function parseDotenv(content) {
  return new Map(
    content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(envLine);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
}

const document = readFileSync(inputPath, "utf8");
const entries = parseDotenv(document);

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

// diveday-admin is the only profile that can read `diveday/env` (the
// deployer key that may have just run `cdk deploy` deliberately cannot), so
// this reuses that exact administrator channel rather than open a second
// one. Ambient AWS_ACCESS_KEY_ID etc. are stripped because AWS gives them
// precedence over AWS_PROFILE.
const adminEnvironment = {
  ...process.env,
  AWS_PROFILE: process.env.INFRA_ENV_SYNC_PROFILE?.trim() || "diveday-admin",
};
delete adminEnvironment.AWS_ACCESS_KEY_ID;
delete adminEnvironment.AWS_SECRET_ACCESS_KEY;
delete adminEnvironment.AWS_SESSION_TOKEN;
adminEnvironment.AWS_DEFAULT_REGION ||= "us-east-1";

try {
  ensureAwsLogin({ environment: adminEnvironment, interactive: !process.env.CI });
} catch (error) {
  console.error(
    `Could not authenticate the ${adminEnvironment.AWS_PROFILE} AWS profile that holds the Vercel sync checkpoint. ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

function readCheckpoint() {
  try {
    const value = execFileSync(
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
      { encoding: "utf8", env: adminEnvironment, stdio: ["ignore", "pipe", "pipe"] },
    );
    return parseDotenv(value);
  } catch (error) {
    const stderr = error.stderr?.toString() ?? "";
    // A missing parameter is the ordinary first-sync case, not a failure --
    // any other reason (permissions, network, a renamed parameter) must not
    // be swallowed into "nothing synced yet", which is exactly the silence
    // that would hide a real problem.
    if (!/ParameterNotFound/.test(stderr)) {
      console.warn(
        `Could not read the ${environment} Vercel sync checkpoint from ${parameterName} (${stderr.trim() || (error instanceof Error ? error.message : error)}); pushing every value instead of only what changed.`,
      );
    }
    return new Map();
  }
}

const previous = readCheckpoint();

const changed = [...entries].filter(([key, value]) => previous.get(key) !== fingerprint(value));

if (changed.length === 0) {
  console.log(`No ${environment} Vercel environment variables changed; nothing pushed.`);
  process.exit(0);
}

for (const [key, value] of changed) {
  // Do not put a secret in argv or terminal output. The Vercel CLI reads each
  // value from stdin; --force makes rerunning a rotation deterministic.
  const result = spawnSync(
    "pnpm",
    ["exec", "vercel", "env", "add", key, environment, "--force", "--sensitive"],
    { input: value, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Only recorded after every push succeeds, and as fingerprints of the full
// current document -- not just the changed subset, and never the values
// themselves -- so the next run's diff is against reality without this
// parameter ever holding a secret. Standard-tier String parameters cap at
// 4KB; the current key set fingerprints to well under that, and a future
// overflow fails this call loudly rather than corrupting the checkpoint --
// the fix then is `--tier Advanced` below.
const checkpointDocument = [...entries]
  .map(([key, value]) => `${key}=${fingerprint(value)}`)
  .join("\n");
const put = spawnSync(
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
    checkpointDocument,
  ],
  { env: adminEnvironment, stdio: ["ignore", "inherit", "inherit"] },
);
if (put.status !== 0) process.exit(put.status ?? 1);

console.log(
  `Pushed ${changed.length} of ${entries.size} ${environment} Vercel environment variable(s); the rest matched the last sync.`,
);
