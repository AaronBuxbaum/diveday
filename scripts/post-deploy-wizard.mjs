import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export function contextValue(arguments_, name, fallback) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const candidate =
      argument === "--context" || argument === "-c" ? arguments_[index + 1] : argument;
    const prefix = `${name}=`;
    if (candidate?.startsWith(prefix)) return candidate.slice(prefix.length);
  }
  return fallback;
}

function yes(answer) {
  return /^(y|yes)$/i.test(answer.trim());
}

function recordName(name, zone) {
  return name.endsWith(`.${zone}`) ? name.slice(0, -zone.length - 1) : name;
}

/**
 * Offers only post-deploy work this workstation can perform. Account approvals
 * stay in the short manual-actions document; they cannot be truthfully hidden
 * behind a yes/no prompt because neither CDK nor a CLI has authority to do them.
 */
export async function runPostDeployWizard({
  ask,
  execute = execFileSync,
  syncEnvironment,
  cdkArguments,
  credentialsDocument,
  log = console.log,
}) {
  const run = (command, arguments_, options = {}) =>
    execute(command, arguments_, { stdio: "inherit", ...options });

  if (
    yes(
      await ask(
        "Update generated AWS CLI profiles (and set diveday-admin's us-east-1 region)? [y/N] ",
      ),
    )
  ) {
    run(process.execPath, [join(scriptDirectory, "sync-aws-profiles.mjs")], {
      input: credentialsDocument,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }

  if (
    yes(
      await ask(
        "Update Vercel Production environment variables, including 1Password-provided Stripe values? [y/N] ",
      ),
    )
  ) {
    run(process.execPath, [
      join(scriptDirectory, "import-vercel-env.mjs"),
      ".env.vercel",
      "production",
    ]);
  }

  if (yes(await ask("Deploy the linked Vercel project to Production? [y/N] "))) {
    run("pnpm", ["exec", "vercel", "--prod"]);
  }

  if (yes(await ask("Update GitHub Actions secrets for visual regression? [y/N] "))) {
    run("gh", ["secret", "set", "--env-file", ".env.github"]);
  }

  if (!yes(await ask("Add the SES DNS records through Vercel DNS? [y/N] "))) return;

  const emailDomain = contextValue(cdkArguments, "sesEmailDomain", "ses.dive.day");
  const mailFromDomain = contextValue(cdkArguments, "sesMailFromDomain", `mail.${emailDomain}`);
  const dnsZone = process.env.VERCEL_DNS_ZONE?.trim() || "dive.day";
  const tokens = JSON.parse(
    execute(
      "aws",
      [
        "sesv2",
        "get-email-identity",
        "--email-identity",
        emailDomain,
        "--query",
        "DkimAttributes.Tokens",
        "--output",
        "json",
      ],
      { encoding: "utf8", env: syncEnvironment },
    ),
  );

  for (const token of tokens) {
    run("pnpm", [
      "exec",
      "vercel",
      "dns",
      "add",
      dnsZone,
      recordName(`${token}._domainkey.${emailDomain}`, dnsZone),
      "CNAME",
      `${token}.dkim.amazonses.com`,
    ]);
  }
  run("pnpm", [
    "exec",
    "vercel",
    "dns",
    "add",
    dnsZone,
    recordName(mailFromDomain, dnsZone),
    "MX",
    `feedback-smtp.${syncEnvironment.AWS_DEFAULT_REGION || "us-east-1"}.amazonses.com`,
    "10",
  ]);
  run("pnpm", [
    "exec",
    "vercel",
    "dns",
    "add",
    dnsZone,
    recordName(mailFromDomain, dnsZone),
    "TXT",
    "v=spf1 include:amazonses.com ~all",
  ]);
  log(`Added SES DNS records to Vercel zone ${dnsZone}.`);
}
