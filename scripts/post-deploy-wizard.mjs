import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SES_REGION } from "../config/aws-regions.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

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

function checkOutputNeedsUpdate(output) {
  const lines = String(output ?? "")
    .trim()
    .split(/\r?\n/);
  return lines.at(-1) !== "CURRENT";
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
  execute = readBounded,
  syncEnvironment,
  cdkArguments,
  credentialsDocument,
  log = console.log,
  checkUpdates = {},
  // Forwarded to import-vercel-env.mjs as `--ci-unattended` so it makes the
  // same CI-vs-workstation AWS-credential choice its caller already made,
  // without needing to re-derive it from the ambient environment itself (see
  // infra-deploy.mjs's isCiDeploy comment for why an ambient signal is unsafe
  // here). Never true when called from the interactive branch.
  ciUnattended = false,
}) {
  // Every step below is bounded. A wizard question answered "yes" that then
  // never comes back is the worst shape this script can take: it runs *after* a
  // successful deploy, so a wedge there leaves infrastructure changed and the
  // hand-off half-applied, with nothing on screen saying which step is stuck.
  const run = (command, arguments_, timeoutMs, options = {}) =>
    execute(command, arguments_, { stdio: "inherit", timeoutMs, ...options });
  const needsUpdate = (name, arguments_, input) => {
    if (name in checkUpdates) {
      const answer = checkUpdates[name];
      return Boolean(typeof answer === "function" ? answer() : answer);
    }
    try {
      return checkOutputNeedsUpdate(
        execute(process.execPath, arguments_, {
          encoding: "utf8",
          input,
          stdio: ["pipe", "pipe", "pipe"],
          timeoutMs: SUBPROCESS_TIMEOUTS.wizardStep,
        }),
      );
    } catch {
      // A read-only preflight is an optimization, not a second gate. Keep the
      // question visible when its state cannot be proved; the write command
      // remains the authority for the actionable error.
      log(
        `Could not check whether the ${name} handoff needs an update; leaving its question visible.`,
      );
      return true;
    }
  };

  if (
    needsUpdate(
      "awsProfiles",
      [join(scriptDirectory, "sync-aws-profiles.mjs"), "--check"],
      credentialsDocument,
    ) &&
    yes(
      await ask(
        "Update generated AWS CLI profiles (and set diveday-admin's us-east-1 region)? [y/N] ",
      ),
    )
  ) {
    run(
      process.execPath,
      [join(scriptDirectory, "sync-aws-profiles.mjs")],
      SUBPROCESS_TIMEOUTS.nodeScript,
      {
        input: credentialsDocument,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
  }

  if (
    needsUpdate("vercelEnvironment", [
      join(scriptDirectory, "import-vercel-env.mjs"),
      ".env.vercel",
      "production",
      "--check",
      ...(ciUnattended ? ["--ci-unattended"] : []),
    ]) &&
    yes(
      await ask(
        "Update Vercel Production environment variables, including 1Password-provided Stripe values? [y/N] ",
      ),
    )
  ) {
    run(
      process.execPath,
      [
        join(scriptDirectory, "import-vercel-env.mjs"),
        ".env.vercel",
        "production",
        ...(ciUnattended ? ["--ci-unattended"] : []),
      ],
      SUBPROCESS_TIMEOUTS.wizardStep,
    );
  }

  if (
    needsUpdate("githubSecrets", [
      join(scriptDirectory, "sync-github-secrets.mjs"),
      ".env.github",
      "--check",
    ]) &&
    yes(await ask("Update GitHub Actions secrets for visual regression? [y/N] "))
  ) {
    run(
      process.execPath,
      [join(scriptDirectory, "sync-github-secrets.mjs"), ".env.github"],
      SUBPROCESS_TIMEOUTS.wizardStep,
    );
  }

  let roleArns;
  const readRoleArns = () => {
    if (roleArns !== undefined) return roleArns;
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
        { encoding: "utf8", env: syncEnvironment, timeoutMs: SUBPROCESS_TIMEOUTS.awsApi },
      ),
    );
    const outputValue = (key) => outputs.find((output) => output.OutputKey === key)?.OutputValue;
    roleArns = [
      `AWS_CDK_DIFF_ROLE_ARN=${outputValue("GitHubActionsCdkDiffRoleArn") ?? ""}`,
      `AWS_CDK_DEPLOY_ROLE_ARN=${outputValue("GitHubActionsCdkDeployRoleArn") ?? ""}`,
    ].join("\n");
    return roleArns;
  };

  let cdkVariablesNeedUpdate;
  if ("cdkVariables" in checkUpdates) {
    cdkVariablesNeedUpdate = Boolean(
      typeof checkUpdates.cdkVariables === "function"
        ? checkUpdates.cdkVariables()
        : checkUpdates.cdkVariables,
    );
  } else {
    try {
      cdkVariablesNeedUpdate = needsUpdate(
        "cdkVariables",
        [join(scriptDirectory, "sync-github-cdk-ci-vars.mjs"), "--check"],
        readRoleArns(),
      );
    } catch {
      log(
        "Could not read the CDK role outputs while checking the GitHub variables handoff; leaving its question visible.",
      );
      cdkVariablesNeedUpdate = true;
    }
  }

  if (
    cdkVariablesNeedUpdate &&
    yes(
      await ask("Set the GitHub Actions CDK diff/deploy role ARNs as repository variables? [y/N] "),
    )
  ) {
    run(
      process.execPath,
      [join(scriptDirectory, "sync-github-cdk-ci-vars.mjs")],
      SUBPROCESS_TIMEOUTS.wizardStep,
      { input: readRoleArns(), stdio: ["pipe", "inherit", "inherit"] },
    );
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
    needsUpdate("githubEnvironment", [
      join(scriptDirectory, "sync-github-cdk-ci-environment.mjs"),
      "--check",
    ]) &&
    yes(
      await ask(
        "Create/update the infra-deploy GitHub Environment with yourself as its required reviewer? [y/N] ",
      ),
    )
  ) {
    run(
      process.execPath,
      [join(scriptDirectory, "sync-github-cdk-ci-environment.mjs")],
      SUBPROCESS_TIMEOUTS.wizardStep,
    );
  }

  // `VERCEL_ORG_ID` selects the linked project for env/deploy commands, but
  // the Vercel DNS commands resolve their scope independently. CI has no
  // persisted `.vercel` link to supply that scope, so pass it explicitly or
  // DNS listing/addition can target the operator's personal account.
  const vercelScope = syncEnvironment?.VERCEL_ORG_ID?.trim();
  const vercelScopeArguments = vercelScope ? ["--scope", vercelScope] : [];

  const readSesDnsPlan = () => {
    const emailDomain = contextValue(cdkArguments, "sesEmailDomain", "ses.dive.day");
    const mailFromDomain = contextValue(cdkArguments, "sesMailFromDomain", `mail.${emailDomain}`);
    const dnsZone = syncEnvironment?.VERCEL_DNS_ZONE?.trim() || "dive.day";
    // `--region`, explicitly: the identity lives in the email stack's region
    // (config/aws-regions.mjs), which is not the one this wizard's session
    // defaults to. Without it the call answers NotFoundException against the
    // main region and the whole DNS step reads as "the identity was never
    // created" -- while the real identity sits verified one region over.
    const tokens = JSON.parse(
      execute(
        "aws",
        [
          "sesv2",
          "get-email-identity",
          "--region",
          SES_REGION,
          "--email-identity",
          emailDomain,
          "--query",
          "DkimAttributes.Tokens",
          "--output",
          "json",
        ],
        { encoding: "utf8", env: syncEnvironment, timeoutMs: SUBPROCESS_TIMEOUTS.awsApi },
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
      existingRecords = execute(
        "pnpm",
        ["exec", "vercel", "dns", "ls", dnsZone, "--limit", "100", ...vercelScopeArguments],
        {
          encoding: "utf8",
          timeoutMs: SUBPROCESS_TIMEOUTS.vercelCli,
        },
      );
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
    function containsField(line, field, { allowTrailingDot = false } = {}) {
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const trailingDot = allowTrailingDot ? "\\.?" : "";
      return new RegExp(`(^|\\s)${escaped}${trailingDot}(\\s|$)`).test(line);
    }

    function dnsRecordExists(name, type, value) {
      return existingRecords
        .split("\n")
        .some(
          (line) =>
            containsField(line, name) &&
            containsField(line, type) &&
            containsField(line, value, { allowTrailingDot: type === "CNAME" || type === "MX" }),
        );
    }

    const desiredRecords = [
      ...tokens.map((token) => ({
        name: recordName(`${token}._domainkey.${emailDomain}`, dnsZone),
        type: "CNAME",
        value: `${token}.dkim.amazonses.com`,
        extraArguments: [],
      })),
      {
        name: recordName(mailFromDomain, dnsZone),
        type: "MX",
        // The SES region, never the session's: this MX is what SES checks the
        // MAIL FROM domain against, and one naming the wrong region fails the
        // setup silently -- mail keeps sending, on the shared amazonses.com
        // envelope, with SPF aligned to Amazon rather than to us.
        value: `feedback-smtp.${SES_REGION}.amazonses.com`,
        extraArguments: ["10"],
      },
      {
        name: recordName(mailFromDomain, dnsZone),
        type: "TXT",
        value: "v=spf1 include:amazonses.com ~all",
        extraArguments: [],
      },
    ];

    return {
      dnsZone,
      missingRecords: desiredRecords.filter(
        ({ name, type, value }) => !dnsRecordExists(name, type, value),
      ),
    };
  };

  let sesDnsPlan;
  let sesDnsNeedsUpdate;
  if ("sesDns" in checkUpdates) {
    sesDnsNeedsUpdate = Boolean(
      typeof checkUpdates.sesDns === "function" ? checkUpdates.sesDns() : checkUpdates.sesDns,
    );
  } else {
    try {
      sesDnsPlan = readSesDnsPlan();
      sesDnsNeedsUpdate = sesDnsPlan.missingRecords.length > 0;
    } catch {
      log("Could not check the SES DNS handoff; leaving its question visible.");
      sesDnsNeedsUpdate = true;
    }
  }

  if (sesDnsNeedsUpdate && yes(await ask("Add the SES DNS records through Vercel DNS? [y/N] "))) {
    sesDnsPlan ??= readSesDnsPlan();
    let added = 0;
    for (const { name, type, value, extraArguments } of sesDnsPlan.missingRecords) {
      run(
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          sesDnsPlan.dnsZone,
          name,
          type,
          value,
          ...extraArguments,
          ...vercelScopeArguments,
        ],
        SUBPROCESS_TIMEOUTS.vercelCli,
      );
      added += 1;
    }
    log(
      added === 0
        ? `SES DNS records already present in Vercel zone ${sesDnsPlan.dnsZone}; nothing added.`
        : `Added ${added} SES DNS record(s) to Vercel zone ${sesDnsPlan.dnsZone}.`,
    );
  } else if (!sesDnsNeedsUpdate && sesDnsPlan) {
    log(
      `SES DNS records already present in Vercel zone ${sesDnsPlan.dnsZone}; skipping its question.`,
    );
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
    // This is deliberately the final wizard action: all generated handoffs and
    // SES DNS changes are checked and applied before a production build starts.
    // The build bound rather than the CLI one: this call waits on a full Vercel
    // production build, not a single API request.
    run(
      "pnpm",
      ["exec", "vercel", "--prod", "--archive=tgz", ...(ciUnattended ? ["--yes"] : [])],
      SUBPROCESS_TIMEOUTS.build,
    );
  }
}
