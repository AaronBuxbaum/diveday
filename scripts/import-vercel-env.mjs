#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRIMARY_REGION } from "../config/aws-regions.mjs";
import { ensureAwsLogin } from "./aws-login.mjs";
import { dotenvMap } from "./dotenv.mjs";
import { isTimeout, readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { VERCEL_CLI } from "./vercel-cli.mjs";

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
// Push every value whatever the checkpoint says: the checkpoint is DiveDay's
// memory of what it last sent, not a reading of Vercel, so this is the way to
// put Vercel back in line after it drifted from that memory.
const resync = rawArguments.includes("--resync");
const FLAGS = new Set(["--ci-unattended", "--check", "--resync"]);
const [inputPath, environment = "production"] = rawArguments.filter(
  (argument) => !FLAGS.has(argument),
);
if (!inputPath || !["production", "preview", "development"].includes(environment)) {
  console.error(
    "Usage: node scripts/import-vercel-env.mjs <dotenv-file> [production|preview|development] [--check] [--resync]",
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
// pull`, not to the API. There is nothing to diff a sensitive value against,
// so this diffs a fingerprint of what the last sync sent (and, since
// 2026-10-14, checks Vercel's own listing beside it -- readVercelState): a SHA-256 of each value, never the value
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
adminEnvironment.AWS_DEFAULT_REGION ||= PRIMARY_REGION;

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

const previous = resync ? new Map() : readCheckpoint();

/**
 * What Vercel itself holds for this environment, read so the checkpoint is not
 * the only witness. The checkpoint records what the last sync *sent*; a
 * variable deleted or edited in the dashboard since, or a push that was never
 * answered "yes", leaves it claiming a value Vercel does not have, and every
 * later deploy then reported "already in sync" (the platform backup's region,
 * 2026-10-14). Vercel never returns a sensitive value, so for those this proves
 * only that the key exists; a readable value is compared too.
 *
 * Returns `null` when the listing cannot be read, and the sync falls back to the
 * checkpoint alone: a CLI hiccup must not turn into a full re-push or a refusal.
 * The JSON carries readable values, so it is parsed here and never printed.
 */
function readVercelState() {
  let output;
  try {
    output = readBounded("pnpm", [...VERCEL_CLI, "env", "ls", environment, "--format", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: SUBPROCESS_TIMEOUTS.vercelCli,
    });
  } catch (error) {
    // The status and whether it timed out, never the child's stderr: that output
    // ran with the ambient environment and may carry values from it.
    const why = isTimeout(error) ? "timed out" : `exit ${error.status ?? "unknown"}`;
    return listingUnavailable(
      `Could not list the ${environment} Vercel environment variables (${why})`,
    );
  }
  try {
    const parsed = JSON.parse(String(output).slice(String(output).indexOf("{")));
    const list = Array.isArray(parsed?.envs) ? parsed.envs : null;
    if (!list) throw new Error("no envs array");
    const state = new Map();
    for (const entry of list) {
      if (typeof entry?.key !== "string") continue;
      // An entry naming no target (a custom environment) proves nothing about this one.
      const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
      if (!targets.includes(environment)) continue;
      const readable =
        entry.type !== "sensitive" && typeof entry.value === "string" && entry.value !== ""
          ? entry.value
          : null;
      state.set(entry.key, readable);
    }
    return state;
  } catch {
    return listingUnavailable(`Could not read the ${environment} Vercel environment listing`);
  }
}

/**
 * On a workstation a missing listing falls back to the checkpoint with a
 * warning someone sees. In the unattended CI deploy nobody reads a warning, and
 * falling back is exactly the silent "already in sync" this listing exists to
 * end, so there it stops the run instead.
 */
function listingUnavailable(reason) {
  if (isCiDeploy) {
    console.error(`${reason}; refusing to trust the checkpoint alone in the unattended deploy.`);
    process.exit(1);
  }
  console.warn(`${reason}; trusting the last sync's checkpoint for what Vercel holds.`);
  return null;
}

const live = readVercelState();

/** Why a key is pushed: checkpoint says it changed, Vercel lacks it, or Vercel's readable value differs. */
const driftedInVercel = (key, value) => {
  if (!live) return false;
  if (!live.has(key)) return true;
  const readable = live.get(key);
  return readable !== null && readable !== value;
};

const changed = [...entries].filter(
  ([key, value]) => previous.get(key) !== fingerprint(value) || driftedInVercel(key, value),
);
// Names only: a key is not a secret, and naming it is what tells an operator
// which variable someone changed in the dashboard.
const drifted = [...entries]
  .filter(([key, value]) => previous.get(key) === fingerprint(value) && driftedInVercel(key, value))
  .map(([key]) => key);
if (drifted.length > 0) {
  console.log(
    `Vercel ${environment} no longer matches the last sync for ${drifted.join(", ")}; ${checkOnly ? "they need pushing again" : "pushing them again"}.`,
  );
}

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
const checkpointNeedsRefresh = previous.size !== entries.size || changed.length > 0;
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
    // A `NEXT_PUBLIC_` variable is public by definition -- Next.js inlines it
    // into the client bundle -- and Vercel refuses to store one as a Secret,
    // which is what `--sensitive` asks for: "NEXT_PUBLIC_ exposes this value to
    // anyone visiting your site, so it cannot be a Secret." Everything else
    // here is a credential and stays sensitive.
    //
    // Latent until a NEXT_PUBLIC_ value actually changed, because only changed
    // variables are pushed. The region migration changed the RUM app monitor
    // id, which is how it surfaced.
    const sensitivity = key.startsWith("NEXT_PUBLIC_") ? "--no-sensitive" : "--sensitive";
    // Do not put a secret in argv or terminal output. The Vercel CLI reads each
    // value from stdin; --force makes rerunning a rotation deterministic.
    const result = runBounded(
      "pnpm",
      [...VERCEL_CLI, "env", "add", key, environment, "--force", sensitivity],
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
