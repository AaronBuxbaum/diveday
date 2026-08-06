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

  it("skips a Vercel DNS record already present by name, type, and value", async () => {
    const answers = ["no", "no", "no", "no", "yes"];
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
    const answers = ["no", "no", "no", "no", "yes"];
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

  it("falls back to adding every DNS record when listing existing ones fails", async () => {
    const answers = ["no", "no", "no", "no", "yes"];
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
