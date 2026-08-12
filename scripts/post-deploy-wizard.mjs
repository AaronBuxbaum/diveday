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
  // Forwarded to import-vercel-env.mjs as `--ci-unattended` so it makes the
  // same CI-vs-workstation AWS-credential choice its caller already made,
  // without needing to re-derive it from the ambient environment itself (see
  // infra-deploy.mjs's isCiDeploy comment for why an ambient signal is unsafe
  // here). Never true when called from the interactive branch.
  ciUnattended = false,
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
      ...(ciUnattended ? ["--ci-unattended"] : []),
    ]);
  }

  if (yes(await ask("Deploy the linked Vercel project to Production? [y/N] "))) {
    // `--yes` only when unattended: the Vercel CLI refuses to deploy without an
    // interactive confirmation ("Command `vercel deploy` requires confirmation.
    // Use option \"--yes\" to confirm."), which in CI is a prompt with nobody to
    // answer it -- the whole run fails there, after the stack has already
    // deployed. The question above is that confirmation, and in the unattended
    // branch it was already answered yes by the caller. A workstation run keeps
    // the CLI's own prompt: it is the only thing standing between a mistyped
    // `y` here and a Production deploy.
    run("pnpm", ["exec", "vercel", "--prod", ...(ciUnattended ? ["--yes"] : [])]);
  }

  if (yes(await ask("Update GitHub Actions secrets for visual regression? [y/N] "))) {
    run(process.execPath, [join(scriptDirectory, "sync-github-secrets.mjs"), ".env.github"]);
  }

  if (
    yes(
      await ask("Set the GitHub Actions CDK diff/deploy role ARNs as repository variables? [y/N] "),
    )
  ) {
    const outputs = JSON.parse(
      execute(
        "aws",
        [
          "cloudformation",
          "describe-stacks",
          "--stack-name",
          "diveday-infra",
          "--query",
          "Stacks[0].Outputs",
          "--output",
          "json",
        ],
        { encoding: "utf8", env: syncEnvironment },
      ),
    );
    const outputValue = (key) => outputs.find((output) => output.OutputKey === key)?.OutputValue;
    const roleArns = [
      `AWS_CDK_DIFF_ROLE_ARN=${outputValue("GitHubActionsCdkDiffRoleArn") ?? ""}`,
      `AWS_CDK_DEPLOY_ROLE_ARN=${outputValue("GitHubActionsCdkDeployRoleArn") ?? ""}`,
    ].join("\n");
    run(process.execPath, [join(scriptDirectory, "sync-github-cdk-ci-vars.mjs")], {
      input: roleArns,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }

  // Workstation only, and not merely because the CI token cannot do it
  // (ADR 20260812-env-sync-is-workstation-only). This step bootstraps the
  // infra-deploy environment -- the approval gate the deploy job is running
  // *inside* by the time the wizard reaches here. Having that job rewrite its
  // own gate is the wrong direction, and the identity it would add as
  // required reviewer is whoever the CI PAT belongs to, not the human who
  // approved this run. `gh api --method PUT .../environments/infra-deploy`
  // also needs repo Administration:write, several times broader than the
  // Secrets/Variables the rest of the wizard uses, on a token reachable from
  // CI. So the CI path skips it outright rather than asking a question whose
  // yes-answer is wrong.
  if (ciUnattended) {
    log(
      "CI deploy: skipping the infra-deploy GitHub Environment sync -- it is a workstation bootstrap step (ADR 20260812-env-sync-is-workstation-only).",
    );
  } else if (
    yes(
      await ask(
        "Create/update the infra-deploy GitHub Environment with yourself as its required reviewer? [y/N] ",
      ),
    )
  ) {
    run(process.execPath, [join(scriptDirectory, "sync-github-cdk-ci-environment.mjs")]);
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

  // `vercel dns add` has no upsert semantics: adding a record that already
  // matches by name/type/value creates a duplicate rather than updating one.
  // For a TXT record like SPF that is actively harmful -- two "v=spf1"
  // records break SPF validation for every outbound mail. List what Vercel
  // already has once, and skip any add whose exact name/type/value already
  // appears together on one line of it. If the listing itself fails, fall
  // back to adding everything rather than silently skipping real work.
  let existingRecords = "";
  try {
    existingRecords = execute("pnpm", ["exec", "vercel", "dns", "ls", dnsZone, "--limit", "100"], {
      encoding: "utf8",
    });
  } catch (error) {
    log(
      `Could not list existing Vercel DNS records (${error instanceof Error ? error.message : error}); adding all records instead of only what's missing.`,
    );
  }

  // A raw `.includes()` would treat "foo.example.com" as present inside
  // "foo.example.com.evil.com", or inside an unrelated record that happens
  // to share a substring. Require each field to appear whitespace-bounded
  // (or at a line edge) instead -- still tolerant of an unknown column
  // layout, but not fooled by a superset match. Not token-splitting the
  // line: the TXT value below ("v=spf1 include:amazonses.com ~all")
  // contains spaces, so it has to be matched as one bounded run, not one
  // token.
  function containsField(line, field) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(line);
  }

  function dnsRecordExists(name, type, value) {
    return existingRecords
      .split("\n")
      .some(
        (line) =>
          containsField(line, name) && containsField(line, type) && containsField(line, value),
      );
  }

  let added = 0;
  function addDnsRecord(name, type, value, extraArguments = []) {
    if (dnsRecordExists(name, type, value)) {
      log(`Skipping ${type} ${name} -- already present in Vercel DNS.`);
      return;
    }
    run("pnpm", ["exec", "vercel", "dns", "add", dnsZone, name, type, value, ...extraArguments]);
    added += 1;
  }

  for (const token of tokens) {
    addDnsRecord(
      recordName(`${token}._domainkey.${emailDomain}`, dnsZone),
      "CNAME",
      `${token}.dkim.amazonses.com`,
    );
  }
  addDnsRecord(
    recordName(mailFromDomain, dnsZone),
    "MX",
    `feedback-smtp.${syncEnvironment.AWS_DEFAULT_REGION || "us-east-1"}.amazonses.com`,
    ["10"],
  );
  addDnsRecord(recordName(mailFromDomain, dnsZone), "TXT", "v=spf1 include:amazonses.com ~all");
  log(
    added === 0
      ? `SES DNS records already present in Vercel zone ${dnsZone}; nothing added.`
      : `Added ${added} SES DNS record(s) to Vercel zone ${dnsZone}.`,
  );
}
