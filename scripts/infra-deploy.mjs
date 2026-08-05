#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ensureAwsDeploymentLogin, ensureAwsLogin } from "./aws-login.mjs";
import { selectDeployProfile } from "./aws-profile.mjs";
import { runPostDeployWizard } from "./post-deploy-wizard.mjs";

const repoRoot = process.cwd();
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cdkArguments = process.argv.slice(2).filter((argument) => argument !== "--no-wizard");
const cdk = join(repoRoot, "node_modules", ".bin", "cdk");
const command = existsSync(cdk) ? cdk : "cdk";
const hasLegacyDeployerCredentials =
  Boolean(process.env.AWS_ACCESS_KEY_ID) && Boolean(process.env.AWS_SECRET_ACCESS_KEY);
const deployEnvironment = { ...process.env };

// Before its first deploy, this stack has not created diveday-deployer yet, so
// target diveday-admin. `aws login --profile diveday-admin` then creates and
// authenticates that exact profile. Afterwards the wizard-installed deployer
// profile becomes the default without ever returning to .env.local.
if (!hasLegacyDeployerCredentials) selectDeployProfile(deployEnvironment);
deployEnvironment.AWS_DEFAULT_REGION ||= "us-east-1";
try {
  ensureAwsDeploymentLogin({
    environment: deployEnvironment,
    interactive: !process.env.CI,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const deploy = spawnSync(command, ["deploy", ...cdkArguments], {
  env: deployEnvironment,
  stdio: "inherit",
});

if (deploy.status !== 0) process.exit(deploy.status ?? 1);

// The deployer deliberately cannot read the hand-off secret. Use the local
// administrator profile only for this post-deploy read, and strip ambient AWS
// keys because AWS gives them precedence over AWS_PROFILE.
const syncProfile = process.env.INFRA_ENV_SYNC_PROFILE?.trim() || "diveday-admin";
const syncEnvironment = { ...process.env, AWS_PROFILE: syncProfile };
delete syncEnvironment.AWS_ACCESS_KEY_ID;
delete syncEnvironment.AWS_SECRET_ACCESS_KEY;
delete syncEnvironment.AWS_SESSION_TOKEN;
// The stack's current home is us-east-1. A profile may override this, but a
// newly configured administrator profile must not make the handoff fail with
// AWS CLI's unhelpful NoRegion error.
syncEnvironment.AWS_DEFAULT_REGION ||= "us-east-1";

// A legacy deployer key may have completed the CDK deploy above, but it is
// deliberately stripped from this administrator-only handoff. Authenticate the
// administrator profile separately so the first run creates diveday-admin and
// opens the browser instead of failing after the infrastructure has changed.
try {
  ensureAwsLogin({
    environment: syncEnvironment,
    interactive: !process.env.CI,
  });
} catch (error) {
  console.error(
    `Infrastructure deployed, but the environment files were not synchronized. ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

let document;
try {
  document = execFileSync(
    "aws",
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      "diveday/env",
      "--query",
      "SecretString",
      "--output",
      "text",
    ],
    { encoding: "utf8", env: syncEnvironment },
  );
} catch {
  console.error(
    `Infrastructure deployed, but the environment files were not synchronized. Configure AWS profile ${syncProfile} with access to diveday/env, then rerun pnpm infra:deploy.`,
  );
  process.exit(1);
}

function distribute(target, outputPath, source) {
  execFileSync(
    process.execPath,
    [join(scriptDirectory, "distribute-env.mjs"), target, outputPath],
    {
      input: source,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}

distribute("local", ".env.local", document);
const localDocument = readFileSync(".env.local", "utf8");
distribute("vercel", ".env.vercel", localDocument);
distribute("github", ".env.github", localDocument);
console.log("Created .env.local, .env.vercel, and .env.github from diveday/env.");

if (stdin.isTTY && stdout.isTTY && !process.env.CI && !process.argv.includes("--no-wizard")) {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    await runPostDeployWizard({
      ask: (question) => terminal.question(question),
      cdkArguments,
      credentialsDocument: document,
      syncEnvironment,
    });
  } finally {
    terminal.close();
  }
} else {
  console.log("Run this command in a terminal to use the optional post-deploy wizard.");
}
