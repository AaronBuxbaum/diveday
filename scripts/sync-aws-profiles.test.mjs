import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("sync-aws-profiles", () => {
  it("writes generated identities as named profiles without touching administrator credentials", () => {
    const home = mkdtempSync(join(tmpdir(), "diveday-aws-profiles-"));
    directories.push(home);
    mkdirSync(join(home, ".aws"));
    writeFileSync(join(home, ".aws", "credentials"), "[personal]\naws_access_key_id = keep\n");
    writeFileSync(
      join(home, ".aws", "config"),
      [
        "[default]",
        "login_session = arn:aws:iam::123456789012:root",
        "",
        "[profile diveday-admin]",
        "login_session = arn:aws:iam::123456789012:root",
        "",
        "[default]",
        "region = us-west-2",
        "",
        "[profile diveday-admin]",
        "region = us-west-1",
        "",
      ].join("\n"),
    );
    const source = [
      "SES_AWS_ACCESS_KEY_ID=ses-id",
      "SES_AWS_SECRET_ACCESS_KEY=ses-secret",
      "REG_SUIT_AWS_ACCESS_KEY_ID=reg-id",
      "REG_SUIT_AWS_SECRET_ACCESS_KEY=reg-secret",
      "# [diveday-deployer]",
      "#   aws_access_key_id = deployer-id",
      "#   aws_secret_access_key = deployer-secret",
      "# [diveday-mcp-readonly-local]",
      "#   aws_access_key_id = mcp-id",
      "#   aws_secret_access_key = mcp-secret",
      "",
    ].join("\n");

    execFileSync("node", ["scripts/sync-aws-profiles.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, AWS_PROFILE_HOME: join(home, ".aws") },
      input: source,
    });

    const credentials = readFileSync(join(home, ".aws", "credentials"), "utf8");
    const config = readFileSync(join(home, ".aws", "config"), "utf8");
    expect(credentials).toContain("[diveday-deployer]\naws_access_key_id = deployer-id");
    expect(credentials).toContain("[diveday-ses-sender]\naws_access_key_id = ses-id");
    expect(credentials).toContain("[reg-suit-bot]\naws_access_key_id = reg-id");
    expect(credentials).toContain("[diveday-mcp-readonly-local]\naws_access_key_id = mcp-id");
    expect(credentials).not.toContain("diveday-admin");
    expect(credentials).toContain("[personal]\naws_access_key_id = keep");
    expect(config.match(/^\[default\]$/gm)).toHaveLength(1);
    expect(config.match(/^\[profile diveday-admin\]$/gm)).toHaveLength(1);
    expect(config).toContain("login_session = arn:aws:iam::123456789012:root");
    expect(config).toMatch(/\[default\][\s\S]*region = us-west-2/);
    expect(config).toMatch(/\[profile diveday-admin\][\s\S]*region = us-east-1/);
    expect(config).toContain("[profile diveday-deployer]\nregion = us-east-1");
  });
});
