#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ensureAwsDeploymentLogin, ensureAwsLogin } from "./aws-login.mjs";
import { selectDeployProfile } from "./aws-profile.mjs";
import { runPostDeployWizard } from "./post-deploy-wizard.mjs";

const repoRoot = process.cwd();
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
// Never a bare `process.env.CI`: it is a generic convention many local dev
// tools set (`act`, several test runners, a shell profile left from a past
// debugging session) -- gating unattended, no-confirmation wizard behavior on
// it would let an ordinary workstation shell that happens to export CI=true,
// combined with a live AWS session, silently push to Vercel Production and
// mutate the infra-deploy GitHub Environment's protection rules with no human
// confirmation at all. `--ci-unattended` is passed only by
// .github/workflows/infra.yml's deploy job -- nothing ambient can supply a CLI
// argument by accident the way it can an environment variable (security
// review on ADR 20260811-ci-deploy-full-wizard; an env-var-based signal,
// ACTIONS_ID_TOKEN_REQUEST_URL, was tried first and rejected after CI itself
// proved it is present on ordinary non-deploy Actions jobs too).
const isCiDeploy = process.argv.includes("--ci-unattended");
const cdkArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--no-wizard" && argument !== "--ci-unattended");
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
    interactive: !isCiDeploy,
  });
} catch {
  // Deliberately static, per CodeQL (clear-text logging): deployEnvironment is
  // a {...process.env} spread, so nothing derived from it or the caught error
  // is echoed here. ensureAwsLogin already printed the AWS CLI's own output
  // straight to this terminal (stdio: "inherit" in aws-login.mjs).
  console.error(
    "Could not authenticate the AWS profile used for this deploy. Run `aws login` (or, in CI, check the OIDC role assumption step above) to see why, then rerun.",
  );
  process.exit(1);
}
const deploy = spawnSync(command, ["deploy", ...cdkArguments], {
  env: deployEnvironment,
  stdio: "inherit",
});

if (deploy.status !== 0) process.exit(deploy.status ?? 1);

// The deployer deliberately cannot read the hand-off secret, so a workstation
// run switches to the local administrator profile for this post-deploy read,
// stripping ambient AWS keys because AWS gives them precedence over
// AWS_PROFILE. In CI there is no diveday-admin profile to switch to -- the
// job's own OIDC-assumed GitHubActionsCdkDeployRole is instead granted a
// narrow, resource-scoped read on exactly this secret (infra-stack.ts §18,
// ADR 20260811-ci-deploy-full-wizard), so the ambient credentials already
// assumed for the deploy above are reused as-is rather than swapped out.
const syncEnvironment = { ...process.env };
const syncProfile = process.env.INFRA_ENV_SYNC_PROFILE?.trim() || "diveday-admin";
if (!isCiDeploy) {
  syncEnvironment.AWS_PROFILE = syncProfile;
  delete syncEnvironment.AWS_ACCESS_KEY_ID;
  delete syncEnvironment.AWS_SECRET_ACCESS_KEY;
  delete syncEnvironment.AWS_SESSION_TOKEN;
}
// The stack's current home is us-east-1. A profile may override this, but a
// newly configured administrator profile must not make the handoff fail with
// AWS CLI's unhelpful NoRegion error.
syncEnvironment.AWS_DEFAULT_REGION ||= "us-east-1";

// A legacy deployer key may have completed the CDK deploy above, but it is
// deliberately stripped from this administrator-only handoff on a workstation.
// Authenticate the administrator profile separately so the first run creates
// diveday-admin and opens the browser instead of failing after the
// infrastructure has changed. In CI, ensureAwsLogin runs non-interactively
// against the already-valid OIDC session and returns immediately.
try {
  ensureAwsLogin({
    environment: syncEnvironment,
    interactive: !isCiDeploy,
  });
} catch {
  // Deliberately static, per CodeQL (clear-text logging): syncEnvironment is a
  // {...process.env} spread, so nothing derived from it, the caught error, or
  // syncProfile -- itself read from process.env, even though it only ever
  // holds a profile name -- is echoed here. ensureAwsLogin already printed the
  // AWS CLI's own output straight to this terminal. See
  // scripts/import-vercel-env.mjs's identical fix.
  console.error(
    isCiDeploy
      ? "Infrastructure deployed, but the environment files were not synchronized: the job's own AWS session could not be verified. Confirm the deploy step's OIDC role assumption succeeded, then rerun this workflow."
      : "Infrastructure deployed, but the environment files were not synchronized. Could not authenticate the administrator AWS profile for the post-deploy read (set INFRA_ENV_SYNC_PROFILE if it is not named diveday-admin). Run `aws login` yourself to see why, then rerun pnpm infra:deploy.",
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
  // Deliberately static, per CodeQL: no part of this message reads syncProfile
  // or any other process.env-derived value -- see the ensureAwsLogin catch
  // above and scripts/import-vercel-env.mjs's identical fix.
  console.error(
    isCiDeploy
      ? "Infrastructure deployed, but the environment files were not synchronized. Confirm GitHubActionsCdkDeployRole's ReadCredentialsDocumentForPostDeployWizard statement (infra-stack.ts §18) is deployed, then rerun this workflow."
      : "Infrastructure deployed, but the environment files were not synchronized. Configure the administrator AWS profile (INFRA_ENV_SYNC_PROFILE, or diveday-admin by default) with access to diveday/env, then rerun pnpm infra:deploy.",
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

// Make sure the one hand-edited file exists before anything reads it, and carry
// a pre-split `.env.local`'s manual values into it so nobody re-pastes a Stripe
// key. Safe to run every time: it never overwrites a value.
execFileSync(process.execPath, [join(scriptDirectory, "env-manual.mjs")], { stdio: "inherit" });

// Each target is rendered from the same two sources — this document and
// `.env.manual` — never from another target. `.env.vercel` used to be rendered
// from the freshly written `.env.local`, which is how a credential typed into a
// local file reached production and stayed there (ADR
// 20260812-env-provenance-registry).
distribute("local", ".env.local", document);
distribute("vercel", ".env.vercel", document);
distribute("github", ".env.github", document);
console.log("Created .env.local, .env.vercel, and .env.github from diveday/env and .env.manual.");

if (process.argv.includes("--no-wizard")) {
  console.log("Skipped the post-deploy wizard (--no-wizard).");
} else if (stdin.isTTY && stdout.isTTY && !isCiDeploy) {
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
} else if (isCiDeploy) {
  // No terminal to prompt and nobody watching one: the required-reviewer
  // approval on the infra-deploy GitHub Environment is what "unblocked
  // manually" already means by the time this process runs at all (its OIDC
  // token could not have been minted otherwise), so every wizard question is
  // answered yes rather than skipping the wizard outright (ADR
  // 20260811-ci-deploy-full-wizard). A step whose own command fails (a stale
  // Vercel token, a revoked GitHub PAT) throws and exits this process
  // non-zero, the same as any other failed deploy step.
  console.log(
    "CI deploy: running the post-deploy wizard non-interactively, answering yes to every question.",
  );
  await runPostDeployWizard({
    ask: async () => "yes",
    cdkArguments,
    credentialsDocument: document,
    syncEnvironment,
    ciUnattended: true,
  });
} else {
  console.log("Run this command in a terminal to use the optional post-deploy wizard.");
}
