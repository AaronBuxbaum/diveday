import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contextValue, runPostDeployWizard } from "./post-deploy-wizard.mjs";
import { SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const allHandoffsNeedUpdate = {
  awsProfiles: true,
  vercelEnvironment: true,
  githubSecrets: true,
  cdkVariables: true,
  githubEnvironment: true,
  sesDns: true,
};

const wizard = (options) =>
  runPostDeployWizard({ checkUpdates: allHandoffsNeedUpdate, ...options });

describe("post-deploy wizard", () => {
  it("honors CDK context values", () => {
    expect(
      contextValue(["--context", "sesEmailDomain=ses.example.com"], "sesEmailDomain", "x"),
    ).toBe("ses.example.com");
    expect(
      contextValue(
        ["-c", "sesEmailDomain=ses.example.com"],
        "sesMailFromDomain",
        "mail.ses.example.com",
      ),
    ).toBe("mail.ses.example.com");
  });

  it("runs only the selected handoffs and derives SES DNS records from AWS", async () => {
    const answers = ["yes", "yes", "y", "no", "no", "yes", "yes"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "AWS_ACCESS_KEY_ID=deployer-id\n",
      // Deliberately *not* the SES region: both the get-email-identity call and
      // the MAIL FROM MX below must name where the identity actually lives, and
      // a session whose default region happens to match would prove neither.
      syncEnvironment: { AWS_DEFAULT_REGION: "us-west-2" },
      execute: (command, arguments_, options) => {
        commands.push({ command, arguments_, options });
        if (command === "aws") return JSON.stringify(["first", "second", "third"]);
        return "";
      },
      log: () => {},
    });

    expect(commands.map(({ command, arguments_ }) => [command, arguments_])).toEqual([
      [process.execPath, [expect.stringContaining("sync-aws-profiles.mjs")]],
      [
        process.execPath,
        [expect.stringContaining("import-vercel-env.mjs"), ".env.vercel", "production"],
      ],
      [process.execPath, [expect.stringContaining("sync-github-secrets.mjs"), ".env.github"]],
      [
        "aws",
        [
          "sesv2",
          "get-email-identity",
          // The identity is in the email stack's region, not the session's
          // default one (ADR 20260910-one-region-in-us-east-2). Without
          // this the call answers NotFoundException and the whole DNS step
          // reads as "the identity was never created".
          "--region",
          "us-east-2",
          "--email-identity",
          "ses.example.com",
          "--query",
          "DkimAttributes.Tokens",
          "--output",
          "json",
        ],
      ],
      ["pnpm", ["exec", "vercel", "dns", "ls", "dive.day", "--limit", "100"]],
      [
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          "dive.day",
          "first._domainkey.ses.example.com",
          "CNAME",
          "first.dkim.amazonses.com",
        ],
      ],
      [
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          "dive.day",
          "second._domainkey.ses.example.com",
          "CNAME",
          "second.dkim.amazonses.com",
        ],
      ],
      [
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          "dive.day",
          "third._domainkey.ses.example.com",
          "CNAME",
          "third.dkim.amazonses.com",
        ],
      ],
      [
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          "dive.day",
          "mail.ses.example.com",
          "MX",
          "feedback-smtp.us-east-2.amazonses.com",
          "10",
        ],
      ],
      [
        "pnpm",
        [
          "exec",
          "vercel",
          "dns",
          "add",
          "dive.day",
          "mail.ses.example.com",
          "TXT",
          "v=spf1 include:amazonses.com ~all",
        ],
      ],
      ["pnpm", ["exec", "vercel", "--prod", "--archive=tgz"]],
    ]);
  });

  it("passes --yes to the Vercel deploy only when unattended", async () => {
    // The CLI refuses to deploy without an interactive confirmation, so the
    // real 2026-08-12 CI deploy failed here *after* the stack had already
    // updated. A workstation run keeps the CLI's own prompt.
    const vercelDeploy = async (ciUnattended) => {
      const commands = [];
      await wizard({
        ask: async () => "yes",
        ciUnattended,
        cdkArguments: [],
        credentialsDocument: "",
        syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
        execute: (command, arguments_) => {
          commands.push({ command, arguments_ });
          if (command === "aws") return JSON.stringify([]);
          return "";
        },
        log: () => {},
      });
      return commands.find(
        ({ command, arguments_ }) =>
          command === "pnpm" && arguments_[1] === "vercel" && arguments_[2] === "--prod",
      );
    };

    expect((await vercelDeploy(true)).arguments_).toEqual([
      "exec",
      "vercel",
      "--prod",
      "--archive=tgz",
      "--yes",
    ]);
    expect((await vercelDeploy(false)).arguments_).toEqual([
      "exec",
      "vercel",
      "--prod",
      "--archive=tgz",
    ]);
  });

  it("keeps the Vercel production deploy last even when DNS is skipped", async () => {
    const answers = ["no", "no", "no", "no", "no", "no", "yes"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: [],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        return "";
      },
      log: () => {},
    });

    expect(commands).toEqual([
      { command: "pnpm", arguments_: ["exec", "vercel", "--prod", "--archive=tgz"] },
    ]);
  });

  it("does not ask about handoffs that are already current", async () => {
    const questions = [];
    const commands = [];
    await runPostDeployWizard({
      ask: async (question) => {
        questions.push(question);
        return "no";
      },
      checkUpdates: {
        awsProfiles: false,
        vercelEnvironment: false,
        githubSecrets: false,
        cdkVariables: false,
        githubEnvironment: false,
        sesDns: false,
      },
      cdkArguments: [],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        return "";
      },
      log: () => {},
    });

    expect(questions).toEqual(["Deploy the linked Vercel project to Production? [y/N] "]);
    expect(commands).toEqual([]);
  });

  it("checks DNS before asking and omits the question when every record exists", async () => {
    const questions = [];
    const commands = [];
    await runPostDeployWizard({
      ask: async (question) => {
        questions.push(question);
        return "no";
      },
      checkUpdates: {
        awsProfiles: true,
        vercelEnvironment: true,
        githubSecrets: true,
        cdkVariables: true,
        githubEnvironment: true,
      },
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_ORG_ID: "team_123" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          return [
            "rec_1 first._domainkey.ses.example.com CNAME first.dkim.amazonses.com. 3600",
            "rec_2 mail.ses.example.com MX 10 feedback-smtp.us-east-2.amazonses.com. 3600",
            "rec_3 mail.ses.example.com TXT v=spf1 include:amazonses.com ~all 3600",
          ].join("\n");
        }
        return "";
      },
      log: () => {},
    });

    expect(questions).not.toContain("Add the SES DNS records through Vercel DNS? [y/N] ");
    expect(commands.map(({ command, arguments_ }) => [command, arguments_])).toEqual([
      [
        "aws",
        [
          "sesv2",
          "get-email-identity",
          // The identity is in the email stack's region, not the session's
          // default one (ADR 20260910-one-region-in-us-east-2). Without
          // this the call answers NotFoundException and the whole DNS step
          // reads as "the identity was never created".
          "--region",
          "us-east-2",
          "--email-identity",
          "ses.example.com",
          "--query",
          "DkimAttributes.Tokens",
          "--output",
          "json",
        ],
      ],
      [
        "pnpm",
        ["exec", "vercel", "dns", "ls", "dive.day", "--limit", "100", "--scope", "team_123"],
      ],
    ]);
  });

  it("refuses to add a second MAIL FROM MX beside another region's", async () => {
    const logs = [];
    const commands = [];
    await runPostDeployWizard({
      ask: async (question) =>
        question === "Add the SES DNS records through Vercel DNS? [y/N] " ? "yes" : "no",
      checkUpdates: {
        awsProfiles: true,
        vercelEnvironment: true,
        githubSecrets: true,
        cdkVariables: true,
        githubEnvironment: true,
      },
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-west-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          // The zone as a previous region left it: DKIM and SPF already right,
          // and one stale MX pointing at the region the identity moved out of.
          return [
            "rec_1 first._domainkey.ses.example.com CNAME first.dkim.amazonses.com. 3600",
            "rec_2 mail.ses.example.com MX 10 feedback-smtp.us-east-1.amazonses.com. 3600",
            "rec_3 mail.ses.example.com TXT v=spf1 include:amazonses.com ~all 3600",
          ].join("\n");
        }
        return "";
      },
      log: (line) => logs.push(line),
    });

    // SES refuses the whole MAIL FROM setup when the subdomain carries several
    // MX records, and reports it Pending for up to 72 hours before saying so --
    // while mail sends normally on the shared envelope. Adding beside the stale
    // one is therefore worse than not adding at all.
    const added = commands.filter(({ arguments_ }) => arguments_[3] === "add");
    expect(added).toEqual([]);
    expect(logs.join("\n")).toContain("rec_2 mail.ses.example.com MX 10");
    expect(logs.join("\n")).toContain("vercel dns rm");
  });

  it("passes the Vercel org scope to SES DNS checks and additions", async () => {
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    await runPostDeployWizard({
      ask: async () => answers.shift() ?? "no",
      checkUpdates: {
        awsProfiles: true,
        vercelEnvironment: true,
        githubSecrets: true,
        cdkVariables: true,
        githubEnvironment: true,
      },
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_ORG_ID: "team_123" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        return "";
      },
      log: () => {},
    });

    const dnsCommands = commands.filter(
      ({ command, arguments_ }) => command === "pnpm" && arguments_[2] === "dns",
    );
    expect(dnsCommands[0].arguments_).toEqual([
      "exec",
      "vercel",
      "dns",
      "ls",
      "dive.day",
      "--limit",
      "100",
      "--scope",
      "team_123",
    ]);
    expect(dnsCommands.slice(1)).toHaveLength(3);
    expect(
      dnsCommands
        .slice(1)
        .every(({ arguments_ }) => arguments_.slice(-2).join(" ") === "--scope team_123"),
    ).toBe(true);
  });

  it("omits the scope for a personal-account org id, which the Vercel CLI refuses", async () => {
    // `vercel dns` exits non-zero on `--scope <personal account>` ("You cannot
    // set your Personal Account as the scope."), which on 2026-09-08 failed the
    // Infra workflow after the stack had already deployed. A personal account
    // is the scope an unscoped call already resolves to, so the fix is to send
    // no scope rather than a rejected one.
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    await runPostDeployWizard({
      ask: async () => answers.shift() ?? "no",
      checkUpdates: {
        awsProfiles: true,
        vercelEnvironment: true,
        githubSecrets: true,
        cdkVariables: true,
        githubEnvironment: true,
      },
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: {
        AWS_DEFAULT_REGION: "us-east-2",
        VERCEL_ORG_ID: "sHqSY0BvVUqYNlLGH1WjeXAe",
      },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        return "";
      },
      log: () => {},
    });

    const dnsCommands = commands.filter(
      ({ command, arguments_ }) => command === "pnpm" && arguments_[2] === "dns",
    );
    expect(dnsCommands).toHaveLength(4);
    expect(dnsCommands[0].arguments_).toEqual([
      "exec",
      "vercel",
      "dns",
      "ls",
      "dive.day",
      "--limit",
      "100",
    ]);
    expect(dnsCommands.every(({ arguments_ }) => !arguments_.includes("--scope"))).toBe(true);
  });

  it("syncs the infra-deploy environment only on a workstation, never in CI", async () => {
    // The CI path skips this outright: it would have the deploy job rewrite
    // the very approval gate it is running inside, add the CI PAT's owner as
    // required reviewer, and need repo Administration:write to do it (a real
    // 403 on 2026-08-12, ADR 20260812-env-sync-is-workstation-only).
    const environmentSync = async (ciUnattended) => {
      const commands = [];
      await wizard({
        ask: async () => "yes",
        ciUnattended,
        cdkArguments: [],
        credentialsDocument: "",
        syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
        execute: (command, arguments_) => {
          commands.push({ command, arguments_ });
          if (command === "aws") return JSON.stringify([]);
          return "";
        },
        log: () => {},
      });
      return commands.some(({ arguments_ }) =>
        arguments_.some(
          (argument) =>
            typeof argument === "string" && argument.includes("sync-github-cdk-ci-environment.mjs"),
        ),
      );
    };

    expect(await environmentSync(true)).toBe(false);
    expect(await environmentSync(false)).toBe(true);
  });

  it("skips a Vercel DNS record already present by name, type, and value", async () => {
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          return "rec_1  first._domainkey.ses.example.com  CNAME  first.dkim.amazonses.com  3600\n";
        }
        return "";
      },
      log: () => {},
    });

    const dnsAdds = commands.filter(
      ({ command, arguments_ }) =>
        command === "pnpm" && arguments_[2] === "dns" && arguments_[3] === "add",
    );
    expect(dnsAdds).toHaveLength(2);
    expect(dnsAdds.map(({ arguments_ }) => arguments_[6])).toEqual(["MX", "TXT"]);
  });

  it("does not treat a superset domain as a match for an existing DNS record", async () => {
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          // A decoy record whose name is a superset of the real one, and
          // whose value shares a prefix -- a raw `.includes()` would wrongly
          // treat this as the same record.
          return "rec_9  first._domainkey.ses.example.com.evil.com  CNAME  first.dkim.amazonses.com.evil.com  3600\n";
        }
        return "";
      },
      log: () => {},
    });

    const dnsAdds = commands.filter(
      ({ command, arguments_ }) =>
        command === "pnpm" && arguments_[2] === "dns" && arguments_[3] === "add",
    );
    expect(dnsAdds).toHaveLength(3);
  });

  it("reads the CDK CI role ARNs from the stack outputs and pipes them to the sync script", async () => {
    const answers = ["no", "no", "no", "yes", "no", "no", "no"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: [],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_, options) => {
        commands.push({ command, arguments_, options });
        if (command === "aws") {
          return JSON.stringify([
            { OutputKey: "GitHubActionsCdkDiffRoleArn", OutputValue: "arn:aws:iam::111:role/diff" },
            {
              OutputKey: "GitHubActionsCdkDeployRoleArn",
              OutputValue: "arn:aws:iam::111:role/deploy",
            },
            { OutputKey: "PostDeployWizard", OutputValue: "unrelated" },
          ]);
        }
        return "";
      },
      log: () => {},
    });

    expect(commands).toEqual([
      {
        command: "aws",
        arguments_: [
          "cloudformation",
          "describe-stacks",
          "--stack-name",
          "diveday-infra",
          "--query",
          "Stacks[0].Outputs",
          "--output",
          "json",
        ],
        options: {
          encoding: "utf8",
          env: { AWS_DEFAULT_REGION: "us-east-2" },
          timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
        },
      },
      {
        command: process.execPath,
        arguments_: [expect.stringContaining("sync-github-cdk-ci-vars.mjs")],
        options: {
          stdio: ["pipe", "inherit", "inherit"],
          timeoutMs: SUBPROCESS_TIMEOUTS.wizardStep,
          input:
            "AWS_CDK_DIFF_ROLE_ARN=arn:aws:iam::111:role/diff\nAWS_CDK_DEPLOY_ROLE_ARN=arn:aws:iam::111:role/deploy",
        },
      },
    ]);
  });

  it("bounds every step it runs -- a yes answered by a wedge is the worst shape this script can take", async () => {
    // This wizard runs *after* a successful deploy, so a step that never comes
    // back leaves infrastructure changed and the hand-off half-applied, with
    // nothing on screen naming the step that is stuck. That is the failure a
    // cloud runner hit on `pnpm check:repo` on 2026-08-14; the answer here is
    // that no step may be unbounded, not that a particular ceiling is right.
    const commands = [];
    await wizard({
      ask: async () => "yes",
      cdkArguments: [],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_, options) => {
        commands.push({ command, arguments_, options });
        return command === "aws" ? "[]" : "";
      },
      log: () => {},
    });

    expect(commands.length).toBeGreaterThan(0);
    const bounds = new Set(Object.values(SUBPROCESS_TIMEOUTS));
    for (const { command, arguments_, options } of commands) {
      expect(
        bounds.has(options?.timeoutMs),
        `${command} ${arguments_.join(" ")} runs with no bound from SUBPROCESS_TIMEOUTS`,
      ).toBe(true);
    }
  });

  it("creates the infra-deploy GitHub Environment when asked", async () => {
    const answers = ["no", "no", "no", "no", "yes", "no", "no"];
    const commands = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: [],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_, options) => {
        commands.push({ command, arguments_, options });
        return "";
      },
      log: () => {},
    });

    expect(commands).toEqual([
      {
        command: process.execPath,
        arguments_: [expect.stringContaining("sync-github-cdk-ci-environment.mjs")],
        options: { stdio: "inherit", timeoutMs: SUBPROCESS_TIMEOUTS.wizardStep },
      },
    ]);
  });

  /**
   * **DMARC is the one SES record no provider hands you**, so it is the one the
   * wizard was never built to publish: SES issues the DKIM tokens and the MAIL
   * FROM pair, and the record that decides how every message is *judged* was
   * left to a manual action nobody is prompted by (issue #1654).
   */
  it("publishes the sending subdomain's DMARC record when it has somewhere to send the reports", async () => {
    const commands = [];
    await wizard({
      ask: async (question) => (/SES DNS/.test(question) ? "yes" : "no"),
      cdkArguments: [
        "--context",
        "sesEmailDomain=ses.example.com",
        "--context",
        "dmarcReportEmail=dmarc@example.com",
      ],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_DNS_ZONE: "example.com" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        return "";
      },
      log: () => {},
    });

    const dmarcAdd = commands.find(
      ({ arguments_ }) => arguments_[3] === "add" && arguments_[5] === "_dmarc.ses",
    );
    expect(dmarcAdd?.arguments_).toEqual(
      expect.arrayContaining(["TXT", "v=DMARC1; p=none; rua=mailto:dmarc@example.com"]),
    );
  });

  /**
   * **Two `v=DMARC1` records at one name is worse than none** — a receiver that
   * finds more than one treats the domain as having no policy at all, so an add
   * beside an existing record switches DMARC off in silence. `vercel dns add`
   * has no upsert, and this wizard never deletes.
   */
  it("leaves a DMARC record that is already published alone, whatever its value", async () => {
    const commands = [];
    const messages = [];
    await wizard({
      ask: async (question) => (/SES DNS/.test(question) ? "yes" : "no"),
      cdkArguments: [
        "--context",
        "sesEmailDomain=ses.example.com",
        "--context",
        "dmarcReportEmail=dmarc@example.com",
      ],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_DNS_ZONE: "example.com" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[3] === "ls") {
          // A different `rua` from the one configured here: somebody's
          // deliberate choice, not a rival to clear away.
          return "_dmarc.ses TXT v=DMARC1; p=none; rua=mailto:someone@example.com\n";
        }
        return "";
      },
      log: (message) => messages.push(message),
    });

    expect(
      commands.some(({ arguments_ }) => arguments_[3] === "add" && arguments_[5] === "_dmarc.ses"),
    ).toBe(false);
    expect(messages.some((message) => /DMARC: already published/.test(message))).toBe(true);
  });

  /**
   * The `rua` address is a choice rather than a derivation. Reports sent to a
   * mailbox nobody reads are the same as no reports, and worse, they read as
   * done — so an unconfigured address prints the record for a person instead of
   * inventing one.
   */
  it("prints the record rather than inventing an address to send reports to", async () => {
    const commands = [];
    const messages = [];
    await wizard({
      ask: async (question) => (/SES DNS/.test(question) ? "yes" : "no"),
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_DNS_ZONE: "example.com" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws") return JSON.stringify(["first"]);
        return "";
      },
      log: (message) => messages.push(message),
    });

    expect(
      commands.some(({ arguments_ }) => arguments_[3] === "add" && arguments_[5] === "_dmarc.ses"),
    ).toBe(false);
    const printed = messages.find((message) => message.includes("_dmarc.ses"));
    expect(printed).toMatch(/judged with no policy of its own/);
    expect(printed).toMatch(/dmarcReportEmail/);
  });

  // A listing failure is unknown state, not empty state. `vercel dns add` has no
  // upsert, so inferring "empty" from "unreadable" is what would put a second
  // "v=spf1" TXT on the live zone and break SPF for every outbound mail -- the
  // path infra run 34176404605 actually took. Zero adds, and the reason on screen.
  it("adds nothing when it cannot list the existing DNS records", async () => {
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    const messages = [];
    await wizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          throw new Error("not authenticated");
        }
        commands.push({ command, arguments_ });
        return "";
      },
      log: (message) => messages.push(message),
    });

    const dnsAdds = commands.filter(
      ({ command, arguments_ }) =>
        command === "pnpm" && arguments_[2] === "dns" && arguments_[3] === "add",
    );
    expect(dnsAdds).toHaveLength(0);
    expect(messages.some((message) => message.includes("Could not list existing"))).toBe(true);
    expect(messages.some((message) => message.includes("not authenticated"))).toBe(true);
    // The trap this inversion has to avoid: emptying `missingRecords` without a
    // flag makes the wizard claim the records are already there, which is a
    // positive statement about a zone it never managed to read.
    expect(messages.some((message) => /already present|nothing added/.test(message))).toBe(false);
  });

  // The sibling of the test above, on the other of the two `readSesDnsPlan()`
  // call sites: this one omits `sesDns` from `checkUpdates`, so the plan is read
  // by the pre-check at the top rather than inside the yes-branch. An unreadable
  // check must leave the question standing -- the runbook's rule for a read-only
  // check that cannot prove its handoff is current.
  it("keeps the SES DNS question visible when the listing cannot be read", async () => {
    const questions = [];
    const messages = [];
    await runPostDeployWizard({
      ask: async (question) => {
        questions.push(question);
        return "no";
      },
      checkUpdates: {
        awsProfiles: true,
        vercelEnvironment: true,
        githubSecrets: true,
        cdkVariables: true,
        githubEnvironment: true,
      },
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2", VERCEL_ORG_ID: "team_123" },
      execute: (command, arguments_) => {
        if (command === "aws") return JSON.stringify(["first"]);
        if (arguments_[2] === "dns" && arguments_[3] === "ls") {
          throw new Error("not authenticated");
        }
        return "";
      },
      log: (message) => messages.push(message),
    });

    expect(questions).toContain("Add the SES DNS records through Vercel DNS? [y/N] ");
    expect(messages.some((message) => /already present|skipping its question/.test(message))).toBe(
      false,
    );
  });

  /**
   * **The AWS read runs after `cdk deploy` has already succeeded, so it may not
   * throw** (issue #1525). It used to: `readSesDnsPlan` opened with an
   * `aws sesv2 get-email-identity` inside a `JSON.parse`, and the yes-branch
   * called it outside any `try`.
   *
   * The pre-check is no defence, which is the part worth pinning. Supplying
   * `checkUpdates.sesDns` — the CI path through `infra-deploy.mjs`, and what
   * every other test here does — skips the guarded pre-check entirely, leaving
   * the unguarded call as the only one. So this case answers **yes** with a
   * throwing `aws`, which before this change killed the wizard with a stack
   * trace after the stack was updated and before the remaining handoffs ran.
   */
  it("survives an unreadable SES identity, says why, and finishes the rest", async () => {
    const messages = [];
    const commands = [];
    // Awaited plainly rather than through a matcher: the wizard resolves with
    // nothing, so `.resolves.not.toThrow()` would be doing its work through
    // `.resolves` alone while reading as though the matcher were the point.
    // A rejection fails this test on its own (Sourcery finding on #1563).
    await wizard({
      // Only the two that matter: the SES DNS handoff under test, and the
      // Vercel deploy that follows it — the wizard's deliberately final
      // action, and so the proof that the run carried on past the failure.
      ask: async (question) => (/SES DNS|Deploy the linked/.test(question) ? "yes" : "no"),
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws" && arguments_[1] === "get-email-identity") {
          throw new Error("ExpiredToken: the security token included in the request is expired");
        }
        return "";
      },
      log: (message) => messages.push(message),
    });

    // Named, never silent: the reason travels with the refusal.
    expect(messages.some((message) => message.includes("ExpiredToken"))).toBe(true);
    expect(messages.some((message) => message.includes("Could not read the SES DKIM tokens"))).toBe(
      true,
    );
    // And never a positive claim about a zone it failed to read.
    expect(messages.some((message) => /already present|nothing added/.test(message))).toBe(false);
    // Nothing was added on a plan that could not be built.
    expect(
      commands.some(({ arguments_ }) => arguments_[2] === "dns" && arguments_[3] === "add"),
    ).toBe(false);
    // The listing is skipped rather than run and reported over the top of the
    // first failure — one reason, the one that actually happened.
    expect(commands.some(({ arguments_ }) => arguments_[3] === "ls")).toBe(false);
    // The point of not throwing: the handoff after this one still gets to run.
    expect(
      commands.some(
        ({ command, arguments_ }) =>
          command === "pnpm" && arguments_?.[1] === "vercel" && arguments_?.includes("--prod"),
      ),
    ).toBe(true);
  });

  /**
   * Two ways the read fails *without* throwing where the guard could see it,
   * both from a `sourcery-ai` review of #1563. Each one put the wizard back
   * where it started: dead after `cdk deploy`, or adding records on a plan it
   * had not actually read.
   */
  it.each([
    // `--query DkimAttributes.Tokens` answers `null`, not `[]`, for an identity
    // with no DKIM tokens yet — a fresh account, which is exactly when somebody
    // runs this. `JSON.parse` accepts it and the `.map` after it does not.
    ["an identity with no DKIM tokens", () => "null", /expected a list of DKIM tokens, got null/],
    ["a scalar where a list belongs", () => '"nope"', /got string/],
    // An `Error("")` set the reason to "", which every truthiness check below
    // reads as *readable* — so the zone got listed and records added on a token
    // read that had failed.
    [
      "a failure with an empty message",
      () => {
        throw new Error("");
      },
      /no reason given/,
    ],
  ])("degrades on %s rather than dying after the deploy", async (_name, aws, expected) => {
    const messages = [];
    const commands = [];
    await wizard({
      ask: async (question) => (/SES DNS|Deploy the linked/.test(question) ? "yes" : "no"),
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
      execute: (command, arguments_) => {
        commands.push({ command, arguments_ });
        if (command === "aws" && arguments_[1] === "get-email-identity") return aws();
        return "";
      },
      log: (message) => messages.push(message),
    });

    expect(messages.some((message) => expected.test(message))).toBe(true);
    // The one that matters: nothing added on a plan that was never read.
    expect(
      commands.some(({ arguments_ }) => arguments_[2] === "dns" && arguments_[3] === "add"),
    ).toBe(false);
    expect(commands.some(({ arguments_ }) => arguments_[3] === "ls")).toBe(false);
  });
});

// The wizard's CI credentials arrive as job env from `.github/workflows/infra.yml`,
// and GitHub resolves an absent secret to "" with no warning, so an empty one used
// to reach `gh`/`vercel` and fail there as an unattributed authentication error --
// after `cdk deploy` had already updated the stack (run 31564090783, 2026-08-12).
// The deploy job now refuses first. These assertions are about that refusal staying
// in step with the credentials it covers: a fifth credential added to the wizard's
// env, or the pre-flight sliding below the AWS credentials step, is exactly the
// drift that made the original incident unreadable.
describe("the deploy job's credential pre-flight", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../.github/workflows/infra.yml", import.meta.url)),
    "utf8",
  );
  const deployJob = workflow.slice(workflow.indexOf("\n  deploy:\n"));
  const preFlight = deployJob.slice(
    deployJob.indexOf("- name: Confirm the post-deploy wizard's credentials are set"),
  );

  it("checks every credential the wizard's deploy step is handed", () => {
    const wizardEnvironment = deployJob
      .slice(deployJob.indexOf("- run: pnpm infra:deploy"))
      .matchAll(/^ +(\w+): \$\{\{ secrets\.(\w+) \}\}$/gm);
    const handed = [...wizardEnvironment].map(([, variable, secret]) => {
      // The names are identical on both sides of the colon on purpose -- that
      // is what stops the workflow's lookup and the stored secret drifting.
      expect(secret).toBe(variable);
      return variable;
    });

    expect(handed).toEqual(["GH_TOKEN", "VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);
    const checked = [...preFlight.matchAll(/^ +require (\w+) "\$\1"/gm)].map(([, name]) => name);
    expect(checked).toEqual(handed);
  });

  it("names both the empty variable and the manual action that supplies it", () => {
    // Naming the variable is what tells a name mismatch apart from a setup step
    // nobody has done; naming the manual action is what makes the second one
    // actionable without reading this workflow.
    expect(preFlight).toContain("$1 resolved to the empty string");
    expect(preFlight).toContain("secrets.$1 this workflow reads");
    expect(preFlight).toContain("ci-github-admin-token");
    expect(preFlight).toContain("ci-vercel-deploy-token");
    expect(preFlight).toContain("docs/engineering/manual-actions.md");
  });

  it("refuses before the job touches AWS at all", () => {
    // Above `configure-aws-credentials`, not merely above `pnpm infra:deploy`:
    // an unfinished setup should leave nothing half-deployed. It also exits
    // non-zero rather than skipping a step, which ADR 20260811-ci-deploy-full-wizard
    // rejects.
    const preFlightAt = deployJob.indexOf(
      "- name: Confirm the post-deploy wizard's credentials are set",
    );
    const awsCredentialsAt = deployJob.indexOf("aws-actions/configure-aws-credentials");
    expect(preFlightAt).toBeGreaterThan(-1);
    expect(preFlightAt).toBeLessThan(awsCredentialsAt);
    expect(preFlight).toContain("exit 1");
  });
});
