import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-bootstrap-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  const cdkDirectory = join(directory, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(cdkDirectory, { recursive: true });
  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
printf '%s\\n' "$AWS_PROFILE:$*" >> "$DIVEDAY_AWS_LOG"
if [ "$1" = "sts" ]; then
  printf '%s' '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:role/admin"}'
fi
`,
  );
  writeFileSync(
    join(cdkDirectory, "cdk"),
    `#!/bin/sh
printf '%s\\n' "$*" > "$DIVEDAY_CDK_LOG"
`,
  );
  chmodSync(join(bin, "aws"), 0o755);
  chmodSync(join(cdkDirectory, "cdk"), 0o755);
  return directory;
}

function run(directory, ...arguments_) {
  return {
    cwd: directory,
    env: {
      ...process.env,
      DIVEDAY_AWS_LOG: join(directory, "aws.log"),
      DIVEDAY_CDK_LOG: join(directory, "cdk.log"),
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
    },
    arguments_,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("infra:bootstrap", () => {
  it("uses the signed-in administrator profile and a matching STS account confirmation", () => {
    const directory = fixture();
    const invocation = run(directory, "--confirm-account", "123456789012", "--qualifier", "dive");
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "infra-bootstrap.mjs"), ...invocation.arguments_],
      { cwd: invocation.cwd, env: invocation.env },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(directory, "aws.log"), "utf8")).toContain(
      "diveday-admin:sts get-caller-identity --output json",
    );
    expect(readFileSync(join(directory, "aws.log"), "utf8")).toContain(
      "diveday-admin:s3control put-public-access-block --account-id 123456789012",
    );
    expect(readFileSync(join(directory, "cdk.log"), "utf8")).toBe(
      "bootstrap aws://123456789012/us-east-1 --qualifier dive\n",
    );
  });

  it("refuses an account confirmation that does not match the signed-in identity", () => {
    const directory = fixture();
    const invocation = run(directory, "--confirm-account", "210987654321");
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "infra-bootstrap.mjs"), ...invocation.arguments_],
      { cwd: invocation.cwd, env: invocation.env },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("Refusing to bootstrap account 123456789012");
    expect(existsSync(join(directory, "cdk.log"))).toBe(false);
  });
});
