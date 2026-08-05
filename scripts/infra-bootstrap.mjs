#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { ensureAwsLogin } from "./aws-login.mjs";

const region = process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
const awsEnvironment = { ...process.env };
const cdkArguments = process.argv.slice(2);
const confirmationIndex = cdkArguments.indexOf("--confirm-account");
let confirmedAccount;
if (confirmationIndex >= 0) {
  confirmedAccount = cdkArguments[confirmationIndex + 1]?.trim();
  cdkArguments.splice(confirmationIndex, 2);
}

if (confirmationIndex >= 0 && !/^\d{12}$/.test(confirmedAccount ?? "")) {
  console.error("--confirm-account must be followed by the resolved 12-digit AWS account id.");
  process.exit(2);
}

// Bootstrap is an account-level administrator operation. It deliberately uses
// the named administrator profile, never an ambient deployer key left over from
// a shell or dotenv file. Set AWS_PROFILE explicitly to use another logged-in
// administrator profile.
awsEnvironment.AWS_PROFILE ||= "diveday-admin";
delete awsEnvironment.AWS_ACCESS_KEY_ID;
delete awsEnvironment.AWS_SECRET_ACCESS_KEY;
delete awsEnvironment.AWS_SESSION_TOKEN;

try {
  ensureAwsLogin({
    environment: awsEnvironment,
    interactive: !process.env.CI,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const identity = JSON.parse(
  execFileSync("aws", ["sts", "get-caller-identity", "--output", "json"], {
    encoding: "utf8",
    env: awsEnvironment,
  }),
);
const account = identity.Account?.trim();
if (!/^\d{12}$/.test(account ?? "")) {
  console.error("AWS STS did not return a valid 12-digit caller account.");
  process.exit(1);
}

if (confirmedAccount !== undefined && confirmedAccount !== account) {
  console.error(
    `Refusing to bootstrap account ${account}; --confirm-account is ${confirmedAccount}.`,
  );
  process.exit(1);
}

if (confirmedAccount === undefined) {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error(
      `Refusing non-interactive bootstrap for account ${account}. Re-run with --confirm-account ${account}.`,
    );
    process.exit(2);
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      `About to bootstrap AWS account ${account} as ${identity.Arn}. Type ${account} to continue: `,
    );
    if (answer.trim() !== account) {
      console.error("Bootstrap cancelled: account confirmation did not match.");
      process.exit(1);
    }
  } finally {
    terminal.close();
  }
}

// The visual-regression bucket is intentionally public. This changes only the
// account's S3 Block Public Access guardrail; it does not make any bucket or
// object public by itself. An Organizations-level policy can still prohibit it.
execFileSync(
  "aws",
  [
    "s3control",
    "put-public-access-block",
    "--account-id",
    account,
    "--public-access-block-configuration",
    JSON.stringify({
      BlockPublicAcls: false,
      IgnorePublicAcls: false,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false,
    }),
  ],
  { stdio: "inherit", env: awsEnvironment },
);

const cdk = join(process.cwd(), "node_modules", ".bin", "cdk");
const command = existsSync(cdk) ? cdk : "cdk";
const result = spawnSync(command, ["bootstrap", `aws://${account}/${region}`, ...cdkArguments], {
  env: awsEnvironment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
