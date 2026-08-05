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
    const answers = ["yes", "yes", "yes", "y", "yes"];
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
      ["gh", ["secret", "set", "--env-file", ".env.github"]],
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
});
