#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_REGION, MAIN_STACK_ID, STACK_IDS } from "../config/aws-regions.mjs";
import { ensureAwsDeploymentLogin, ensureAwsLogin } from "./aws-login.mjs";
import { selectDeployProfile } from "./aws-profile.mjs";
import { runPostDeployWizard } from "./post-deploy-wizard.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const repoRoot = process.cwd();
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function linkedVercelOrgId() {
  const explicitOrgId = process.env.VERCEL_ORG_ID?.trim();
  if (explicitOrgId) return explicitOrgId;

  try {
    const project = JSON.parse(readFileSync(join(repoRoot, ".vercel", "project.json"), "utf8"));
    return typeof project.orgId === "string" ? project.orgId.trim() : "";
  } catch {
    // A linked Vercel project is optional on a workstation, and CI supplies
    // VERCEL_ORG_ID directly. Leave the CLI's existing current-scope behavior
    // alone when neither source is available.
    return "";
  }
}
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

// The app builds two stacks (ADR 20260903-ses-lives-in-its-own-region), and
// `cdk deploy` with neither a stack id nor `--all` refuses to guess. A bare
// `pnpm infra:deploy` has always meant "deploy the infrastructure", so it keeps
// meaning that -- it just has to say so out loud now. The ids come from the
// registry infra/bin/infra.ts builds the stacks from, so a rename cannot leave
// this line behind.
const selectsStacks = cdkArguments.some(
  (argument) => argument === "--all" || STACK_IDS.includes(argument),
);

// `--parameters KEY=VALUE` with no `STACK:` qualifier is applied to *every*
// stack being deployed, and CloudFormation rejects a parameter a template does
// not declare -- so the documented rotation command, unqualified and aimed at
// both stacks, would update diveday-infra and then fail diveday-email with
// "Parameters: [CredentialSerial] do not exist in the template", leaving the
// operator to work out whether the rotation happened. It did. Refuse instead,
// and name the fix: CredentialSerial belongs to DiveDay.
//
// Both spellings, because yargs takes both and an operator who reaches for the
// equals form is not making a different request: a guard that reads only the
// separated one lets `--parameters=CredentialSerial=2` through to exactly the
// half-done rotation it exists to prevent.
const parameterValueAt = (argument, index) => {
  if (argument === "--parameters") return cdkArguments[index + 1];
  if (argument.startsWith("--parameters=")) return argument.slice("--parameters=".length);
  return undefined;
};
const unqualifiedParameter = cdkArguments.some((argument, index) => {
  const parameter = parameterValueAt(argument, index);
  return parameter !== undefined && !parameter.includes(":");
});
if (!selectsStacks && unqualifiedParameter) {
  console.error(
    "Refusing to deploy: --parameters with no stack named applies to every stack, and a stack that does not declare the parameter fails the deploy half-done. Name the stack the parameter belongs to, e.g. " +
      `\`pnpm infra:deploy ${MAIN_STACK_ID} --parameters CredentialSerial=<n>\`.`,
  );
  process.exit(2);
}
if (!selectsStacks) cdkArguments.push("--all");
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
deployEnvironment.AWS_DEFAULT_REGION ||= DEFAULT_REGION;
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
const deploy = runBounded(command, ["deploy", ...cdkArguments], {
  env: deployEnvironment,
  stdio: "inherit",
  // Generous on purpose -- see SUBPROCESS_TIMEOUTS.cdkDeploy. Killing the CLI
  // does not roll CloudFormation back, it only takes away the operator's view
  // of a stack that is still changing.
  timeoutMs: SUBPROCESS_TIMEOUTS.cdkDeploy,
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
syncEnvironment.VERCEL_ORG_ID ||= linkedVercelOrgId();
const syncProfile = process.env.INFRA_ENV_SYNC_PROFILE?.trim() || "diveday-admin";
if (!isCiDeploy) {
  syncEnvironment.AWS_PROFILE = syncProfile;
  delete syncEnvironment.AWS_ACCESS_KEY_ID;
  delete syncEnvironment.AWS_SECRET_ACCESS_KEY;
  delete syncEnvironment.AWS_SESSION_TOKEN;
}
// The credentials secret's home is us-east-1, with the rest of the main stack
// -- the email stack in us-east-2 (ADR 20260903-ses-lives-in-its-own-region)
// holds nothing this read wants. A profile may override this, but a newly
// configured administrator profile must not make the handoff fail with AWS
// CLI's unhelpful NoRegion error.
syncEnvironment.AWS_DEFAULT_REGION ||= DEFAULT_REGION;

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
  document = readBounded(
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
    { encoding: "utf8", env: syncEnvironment, timeoutMs: SUBPROCESS_TIMEOUTS.awsApi },
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
  readBounded(process.execPath, [join(scriptDirectory, "distribute-env.mjs"), target, outputPath], {
    input: source,
    stdio: ["pipe", "inherit", "inherit"],
    timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
  });
}

// Validate the registry/example relationship and the one human-edited source
// before changing it, writing any target file, or offering a provider upload.
// Blank manual values are a supported state; structural drift and
// unknown/trespassing keys are not, and must be fixed before the handoff can
// begin. Running this before env-manual matters: env-manual may regenerate its
// scaffolding and would otherwise hide an invalid old line before the checker
// sees it.
readBounded(process.execPath, [join(scriptDirectory, "check-env.mjs")], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
});

// Make sure the one hand-edited file exists before anything else reads it, and
// carry a pre-split `.env.local`'s manual values into it so nobody re-pastes a
// Stripe key. Safe to run every time: it never overwrites a value.
readBounded(process.execPath, [join(scriptDirectory, "env-manual.mjs")], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
});

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
