#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureAwsDeploymentLogin } from "./aws-login.mjs";
import { selectDeployProfile } from "./aws-profile.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const [operation, ...arguments_] = process.argv.slice(2);
if (!operation || !["synth", "diff"].includes(operation)) {
  console.error("Usage: node scripts/infra-cdk.mjs <synth|diff> [CDK arguments]");
  process.exit(2);
}

const environment = { ...process.env };
selectDeployProfile(environment);
environment.AWS_DEFAULT_REGION ||= "us-east-1";
// `synth` never calls AWS -- this stack does no context lookups (no
// Vpc.fromLookup, no StringParameter.valueFromLookup) -- so it's the one
// operation here that must work with no login at all, credentials
// unconfigured included. That's what lets .github/workflows/infra.yml's diff
// job run `pnpm infra:synth` before its `configure-aws-credentials` step,
// catching a broken template even when AWS_CDK_DIFF_ROLE_ARN hasn't been set
// up yet, the same way a bare `cdk synth` used to.
if (operation !== "synth") {
  try {
    ensureAwsDeploymentLogin({
      environment,
      interactive: !process.env.CI,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const localCdk = join(process.cwd(), "node_modules", ".bin", "cdk");
// Neither operation talks to CloudFormation: `synth` renders the template and
// `diff` reads one stack description, so the bound is the compile, not a deploy.
const result = runBounded(existsSync(localCdk) ? localCdk : "cdk", [operation, ...arguments_], {
  env: environment,
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.cdkSynth,
});
process.exit(result.status ?? 1);
