#!/usr/bin/env node
// Sets the two GitHub Actions repository variables .github/workflows/infra.yml
// reads to assume the diff/deploy roles, from a two-line KEY=VALUE document on
// stdin (the wizard reads them from the stack's own CfnOutputs -- see
// infra-stack.ts §18). Repository *variables*, not secrets: a role ARN is not
// sensitive, and a secret's value is redacted from logs, which would make a
// failed sts:AssumeRoleWithWebIdentity impossible to read from the workflow.
import { readFileSync } from "node:fs";
import { dotenvEntries } from "./dotenv.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const document = readFileSync(0, "utf8");
const entries = dotenvEntries(document);

if (entries.length === 0) {
  console.error("sync-github-cdk-ci-vars: no KEY=VALUE lines on stdin; nothing to set.");
  process.exit(1);
}

let failed = false;
for (const [key, value] of entries) {
  if (!value) {
    console.error(
      `${key} has no value -- deploy the current stack (infra-stack.ts §18) before running this.`,
    );
    failed = true;
    continue;
  }
  const result = runBounded("gh", ["variable", "set", key, "--body", value], {
    stdio: "inherit",
    timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
  });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`Set ${entries.length} GitHub Actions repository variable(s).`);
