import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIMARY_REGION, SES_REGION } from "../config/aws-regions.mjs";
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
        `Update generated AWS CLI profiles (and set diveday-admin's ${PRIMARY_REGION} region)? [y/N] `,
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
  //
  // Only for a team, though. `VERCEL_ORG_ID` is `.vercel/project.json`'s
  // `orgId`, which names a team *or* a personal account, and the CLI refuses
  // the latter outright: `--scope <personal account>` exits non-zero with "You
  // cannot set your Personal Account as the scope." On 2026-09-08 that failed
  // the Infra workflow after `cdk deploy` had already succeeded -- the DNS
  // listing fell back to adding everything, and the first add died. Vercel
  // prefixes team ids with `team_`; anything else is the token's own personal
  // account, which is already the scope every unscoped call resolves to, so
  // the correct argument there is none at all.
  const vercelScope = syncEnvironment?.VERCEL_ORG_ID?.trim();
  const vercelScopeArguments = vercelScope?.startsWith("team_") ? ["--scope", vercelScope] : [];

  const readSesDnsPlan = () => {
    const emailDomain = contextValue(cdkArguments, "sesEmailDomain", "ses.dive.day");
    const mailFromDomain = contextValue(cdkArguments, "sesMailFromDomain", `mail.${emailDomain}`);
    const dnsZone = syncEnvironment?.VERCEL_DNS_ZONE?.trim() || "dive.day";
    // **This read is the one that runs after `cdk deploy` has already
    // succeeded**, so it may not throw (issue #1525). The `aws` call fails for
    // ordinary reasons — expired credentials, the identity not yet existing in
    // a fresh account, a region mismatch, a timeout — and `JSON.parse` fails on
    // a non-JSON error body; before this, either one killed the wizard with a
    // stack trace *after* the CloudFormation stack was updated and *before* the
    // remaining handoffs ran. That is the exact shape the deploy job's
    // credential pre-flight exists to prevent: a late, unattributed failure in
    // a step that runs after the irreversible one.
    //
    // It is not the pre-check that saves you. Whenever `checkUpdates.sesDns` is
    // supplied — CI's own path through `infra-deploy.mjs`, and every wizard
    // test — the guarded pre-check is skipped entirely and the yes-branch call
    // is the only one there is.
    //
    // So it degrades exactly the way an unreadable Vercel listing does: name
    // what could not be read, add nothing, keep the question visible, and let
    // the rest of the wizard finish. Unknown state, never empty state.
    // Never an empty string. An `Error("")` would set this to "", which every
    // check below reads as *readable* — so the zone would be listed and records
    // added on a token read that had actually failed. It would also log an
    // empty parenthesis, which tells the operator nothing.
    const reasonOf = (error) =>
      (error instanceof Error ? error.message : String(error)) || "no reason given";

    let unreadableReason;
    let tokens = [];
    try {
      const parsed = JSON.parse(
        execute(
          "aws",
          [
            "sesv2",
            "get-email-identity",
            // `--region`, explicitly: the identity lives in the email stack's
            // region (config/aws-regions.mjs), which is not the one this
            // wizard's session defaults to. Without it the call answers
            // NotFoundException against the main region and the whole DNS step
            // reads as "the identity was never created" -- while the real
            // identity sits verified one region over.
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
      // `--query DkimAttributes.Tokens` answers `null`, not `[]`, for an
      // identity that has no DKIM tokens yet — a fresh account before DKIM is
      // generated, which is exactly when somebody runs this. `JSON.parse` is
      // happy with that and the `.map` below is not, so the throw landed
      // outside this block and killed the wizard anyway.
      if (!Array.isArray(parsed)) {
        throw new Error(
          `expected a list of DKIM tokens, got ${parsed === null ? "null" : typeof parsed}`,
        );
      }
      tokens = parsed;
    } catch (error) {
      unreadableReason = reasonOf(error);
      log(
        `Could not read the SES DKIM tokens for ${emailDomain} (${unreadableReason}); cannot tell which DNS records are needed, so none will be added.`,
      );
    }

    // `vercel dns add` has no upsert semantics: adding a record that already
    // matches by name/type/value creates a duplicate rather than updating one.
    // For a TXT record like SPF that is actively harmful -- two "v=spf1"
    // records break SPF validation for every outbound mail. List what Vercel
    // already has once, and skip any add whose exact name/type/value already
    // appears together on one line of it.
    //
    // A listing that fails is unknown state, never empty state. An expired
    // token, a rate limit, a rejected --scope or a network blip is no evidence
    // the zone is bare, and this code used to infer exactly that: infra run
    // 34176404605 (2026-09-08) had `dns ls` refused with "You cannot set your
    // Personal Account as the scope." and went on to attempt all five adds --
    // nothing was duplicated only because the adds failed for the same reason
    // the listing did. Had the listing alone been broken, a second "v=spf1"
    // TXT would have landed on the live zone and silently degraded
    // deliverability for every diver-facing email until somebody read the zone
    // by hand. So an unreadable listing adds nothing, keeps its question
    // visible, and names what it could not check -- the convention the
    // infrastructure runbook already states for a read-only check that cannot
    // prove its handoff is current.
    let existingRecords = "";
    // Skipped when the tokens are already unknown: there is nothing to compare
    // a listing against, and running it would replace the reason above with a
    // second one, hiding which read actually failed first.
    try {
      if (unreadableReason) throw new Error(unreadableReason);
      existingRecords = execute(
        "pnpm",
        ["exec", "vercel", "dns", "ls", dnsZone, "--limit", "100", ...vercelScopeArguments],
        {
          encoding: "utf8",
          timeoutMs: SUBPROCESS_TIMEOUTS.vercelCli,
        },
      );
    } catch (error) {
      const reason = reasonOf(error);
      if (!unreadableReason) {
        unreadableReason = reason;
        log(
          `Could not list existing Vercel DNS records in ${dnsZone} (${unreadableReason}); cannot tell which are already there, so none will be added.`,
        );
      }
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

    // **The one SES record no provider hands you.** SES issues the DKIM tokens
    // and the MAIL FROM pair, so those are the records this wizard was built
    // from; DMARC is the record that decides how every message is *judged* and
    // nobody hands it over (issue #1654). A receiver reads the From domain's
    // own policy and only walks up to the organizational domain when there is
    // none, so `_dmarc.ses` is what SES mail is judged by -- and `_dmarc` on
    // the apex is a CNAME to the mail provider's shared record, which is not
    // ours to touch (manual action `dmarc-dns`).
    //
    // The address is a choice rather than a derivation, so it comes from
    // context and is never guessed: reports sent to a mailbox nobody reads are
    // the same as no reports, and worse, they read as done.
    const dmarcName = recordName(`_dmarc.${emailDomain}`, dnsZone);
    const dmarcReportEmail = contextValue(cdkArguments, "dmarcReportEmail", "");
    const dmarcValue = `v=DMARC1; p=none; rua=mailto:${dmarcReportEmail}`;

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

    // **Exactly one MX**, or SES refuses the whole MAIL FROM setup. That makes
    // the MX the one record here an *add* can break: every other desired record
    // is either absent or already exactly right, but a `mail.ses` MX left over
    // from another region is present, wrong, and invisible to the
    // does-it-already-exist check above -- which asks whether the *desired*
    // value is there, not whether a rival is. Adding beside it produces two,
    // and SES then reports the setup Pending for up to 72 hours before marking
    // it Failed, with mail sending normally the whole time on the shared
    // envelope. So a rival is found and named rather than added around; the
    // wizard never deletes a DNS record, because the one that would make that
    // safe to automate is the one it cannot verify it read correctly.
    // **Two `v=DMARC1` records at one name is worse than none**: a receiver that
    // finds more than one treats the domain as having no policy at all, so an
    // add beside an existing record switches DMARC off silently. Unlike the
    // MAIL FROM MX below, *any* TXT already at this name holds the add back,
    // whatever its value -- a published policy with a different `rua` is
    // somebody's deliberate choice, not a rival to name and clear away. The
    // wizard never deletes a DNS record.
    const existingDmarc = existingRecords
      .split("\n")
      .filter((line) => containsField(line, dmarcName) && containsField(line, "TXT"))
      .map((line) => line.trim());

    const mailFromMxName = recordName(mailFromDomain, dnsZone);
    const desiredMailFromMx = `feedback-smtp.${SES_REGION}.amazonses.com`;
    const conflictingMailFromMx = existingRecords
      .split("\n")
      .filter(
        (line) =>
          containsField(line, mailFromMxName) &&
          containsField(line, "MX") &&
          !containsField(line, desiredMailFromMx, { allowTrailingDot: true }),
      )
      .map((line) => line.trim());

    if (existingDmarc.length === 0 && dmarcReportEmail) {
      desiredRecords.push({ name: dmarcName, type: "TXT", value: dmarcValue, extraArguments: [] });
    }

    const missingRecords = desiredRecords.filter(
      ({ name, type, value }) => !dnsRecordExists(name, type, value),
    );

    return {
      dnsZone,
      unreadable: Boolean(unreadableReason),
      unreadableReason,
      conflictingMailFromMx,
      existingDmarc,
      // What to publish by hand when there is nowhere to send the reports. The
      // record is printed rather than added: a `rua` this wizard invented would
      // be a mailbox nobody reads, which looks like reporting and is not.
      dmarcToPublish:
        existingDmarc.length === 0 && !dmarcReportEmail
          ? {
              name: dmarcName,
              value: `v=DMARC1; p=none; rua=mailto:<a ${dnsZone} mailbox someone reads>`,
            }
          : undefined,
      // An unreadable zone has no missing records because it has no known
      // records at all. That emptiness must never read as "already present":
      // `unreadable` is what the caller checks first, both to keep the question
      // visible and to refuse the adds. A conflicting MAIL FROM MX is narrower
      // and only holds back the MX: the operator is told which record to
      // remove, and the same wizard run adds the rest.
      missingRecords: unreadableReason
        ? []
        : conflictingMailFromMx.length > 0
          ? missingRecords.filter((record) => record.type !== "MX")
          : missingRecords,
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
      sesDnsNeedsUpdate =
        sesDnsPlan.unreadable ||
        sesDnsPlan.missingRecords.length > 0 ||
        sesDnsPlan.conflictingMailFromMx.length > 0;
    } catch {
      log("Could not check the SES DNS handoff; leaving its question visible.");
      sesDnsNeedsUpdate = true;
    }
  }

  // **DMARC is said out loud whichever way the question goes.** A published
  // record is left alone and named, and a missing one with nowhere to send its
  // reports is printed for a person -- because the wizard skipping its question
  // is exactly when nobody would otherwise learn that the record SES mail is
  // judged by does not exist (issue #1654).
  const logDmarcState = (plan) => {
    for (const line of plan.existingDmarc) {
      log(`DMARC: already published on the sending subdomain; left alone. The record: ${line}`);
    }
    if (plan.dmarcToPublish) {
      log(
        `DMARC: nothing is published at ${plan.dmarcToPublish.name}, so SES mail is judged with no policy of its own and reports nothing. Set \`dmarcReportEmail\` in cdk.json and rerun, or publish it by hand: pnpm exec vercel dns add ${plan.dnsZone} ${plan.dmarcToPublish.name} TXT '${plan.dmarcToPublish.value}'`,
      );
    }
  };

  if (sesDnsNeedsUpdate && yes(await ask("Add the SES DNS records through Vercel DNS? [y/N] "))) {
    sesDnsPlan ??= readSesDnsPlan();
    if (sesDnsPlan.unreadable) {
      // The refusal has to live here rather than in the question above it: CI
      // answers yes to every question the wizard shows (`infra-deploy.mjs`), so
      // keeping the question visible does not by itself stop a single add.
      log(
        `Adding no SES DNS records to Vercel zone ${sesDnsPlan.dnsZone}: its existing records could not be listed (${sesDnsPlan.unreadableReason}), and adding a record that is already there duplicates it. Add them by hand, or re-run once the listing works.`,
      );
    } else {
      logDmarcState(sesDnsPlan);
      for (const line of sesDnsPlan.conflictingMailFromMx) {
        log(
          `SES MAIL FROM: not adding the ${SES_REGION} MX -- ${sesDnsPlan.dnsZone} already carries a different one, and SES refuses the setup outright when the subdomain has several. Remove it first (\`pnpm exec vercel dns rm <record-id>\`), then rerun this wizard. The record: ${line}`,
        );
      }
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
    }
  } else if (!sesDnsNeedsUpdate && sesDnsPlan) {
    logDmarcState(sesDnsPlan);
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
