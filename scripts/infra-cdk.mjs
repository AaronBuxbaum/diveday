#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureAwsDeploymentLogin } from "./aws-login.mjs";
import { selectDeployProfile } from "./aws-profile.mjs";

const [operation, ...arguments_] = process.argv.slice(2);
if (!operation || !["synth", "diff"].includes(operation)) {
  console.error("Usage: node scripts/infra-cdk.mjs <synth|diff> [CDK arguments]");
  process.exit(2);
}

const environment = { ...process.env };
selectDeployProfile(environment);
environment.AWS_DEFAULT_REGION ||= "us-east-1";
try {
  ensureAwsDeploymentLogin({
    environment,
    interactive: !process.env.CI,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const localCdk = join(process.cwd(), "node_modules", ".bin", "cdk");
const result = spawnSync(existsSync(localCdk) ? localCdk : "cdk", [operation, ...arguments_], {
  env: environment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
