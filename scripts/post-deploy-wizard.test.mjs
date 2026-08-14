import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contextValue, runPostDeployWizard } from "./post-deploy-wizard.mjs";

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
    const answers = ["yes", "yes", "yes", "y", "no", "no", "yes"];
    const commands = [];
    await runPostDeployWizard({
      ask: async () => answers.shift() ?? "no",
      cdkArguments: ["--context", "sesEmailDomain=ses.example.com"],
      credentialsDocument: "AWS_ACCESS_KEY_ID=deployer-id\n",
      syncEnvironment: { AWS_DEFAULT_REGION: "us-east-2" },
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
      ["pnpm", ["exec", "vercel", "--prod"]],
      [process.execPath, [expect.stringContaining("sync-github-secrets.mjs"), ".env.github"]],
      [
        "aws",
        [
          "sesv2",
          "get-email-identity",
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
    ]);
  });

  it("passes --yes to the Vercel deploy only when unattended", async () => {
    // The CLI refuses to deploy without an interactive confirmation, so the
    // real 2026-08-12 CI deploy failed here *after* the stack had already
    // updated. A workstation run keeps the CLI's own prompt.
    const vercelDeploy = async (ciUnattended) => {
      const commands = [];
      await runPostDeployWizard({
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
        ({ command, arguments_ }) => command === "pnpm" && arguments_[1] === "vercel",
      );
    };

    expect((await vercelDeploy(true)).arguments_).toEqual(["exec", "vercel", "--prod", "--yes"]);
    expect((await vercelDeploy(false)).arguments_).toEqual(["exec", "vercel", "--prod"]);
  });

  it("syncs the infra-deploy environment only on a workstation, never in CI", async () => {
    // The CI path skips this outright: it would have the deploy job rewrite
    // the very approval gate it is running inside, add the CI PAT's owner as
    // required reviewer, and need repo Administration:write to do it (a real
    // 403 on 2026-08-12, ADR 20260812-env-sync-is-workstation-only).
    const environmentSync = async (ciUnattended) => {
      const commands = [];
      await runPostDeployWizard({
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
    const answers = ["no", "no", "no", "no", "no", "no", "yes"];
    const commands = [];
    await runPostDeployWizard({
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
    const answers = ["no", "no", "no", "no", "no", "no", "yes"];
    const commands = [];
    await runPostDeployWizard({
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
    const answers = ["no", "no", "no", "no", "yes", "no", "no"];
    const commands = [];
    await runPostDeployWizard({
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
        options: { encoding: "utf8", env: { AWS_DEFAULT_REGION: "us-east-2" } },
      },
      {
        command: process.execPath,
        arguments_: [expect.stringContaining("sync-github-cdk-ci-vars.mjs")],
        options: {
          stdio: ["pipe", "inherit", "inherit"],
          input:
            "AWS_CDK_DIFF_ROLE_ARN=arn:aws:iam::111:role/diff\nAWS_CDK_DEPLOY_ROLE_ARN=arn:aws:iam::111:role/deploy",
        },
      },
    ]);
  });

  it("creates the infra-deploy GitHub Environment when asked", async () => {
    const answers = ["no", "no", "no", "no", "no", "yes", "no"];
    const commands = [];
    await runPostDeployWizard({
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
        options: { stdio: "inherit" },
      },
    ]);
  });

  it("falls back to adding every DNS record when listing existing ones fails", async () => {
    const answers = ["no", "no", "no", "no", "no", "no", "yes"];
    const commands = [];
    const messages = [];
    await runPostDeployWizard({
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
    expect(dnsAdds).toHaveLength(3);
    expect(messages.some((message) => message.includes("Could not list existing"))).toBe(true);
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
