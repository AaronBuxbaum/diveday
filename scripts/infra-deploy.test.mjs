import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Covers only what changed for CI (ADR 20260811-ci-deploy-full-wizard): which
 * post-deploy-wizard mode infra-deploy.mjs picks, and that the credentials-secret
 * read in CI keeps the ambient (OIDC-assumed) credentials instead of swapping to
 * a diveday-admin profile that does not exist on a runner. The wizard's own
 * step-by-step behavior once every answer is "yes" is already covered by
 * post-deploy-wizard.test.mjs; these stubs just need every step to succeed so
 * the CI run completes, not to exercise each one's logic again.
 */

const directories = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-infra-deploy-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(directory, "aws-home"), { recursive: true });

  const secretCallLogPath = join(directory, "secret-calls.log");
  const ghCallLogPath = join(directory, "gh-calls.log");

  writeFileSync(join(bin, "cdk"), "#!/bin/sh\ncat >/dev/null 2>&1\nexit 0\n");

  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  echo '{"Account":"000000000000"}'
  exit 0
fi
if [ "$1" = "secretsmanager" ] && [ "$2" = "get-secret-value" ]; then
  echo "AWS_PROFILE=\${AWS_PROFILE:-<unset>} AWS_ACCESS_KEY_ID=\${AWS_ACCESS_KEY_ID:-<unset>}" >> "${secretCallLogPath}"
  printf 'APP_SECRET_SEED=test-seed\\n'
  exit 0
fi
if [ "$1" = "cloudformation" ] && [ "$2" = "describe-stacks" ]; then
  echo '[{"OutputKey":"GitHubActionsCdkDiffRoleArn","OutputValue":"arn:aws:iam::111:role/diff"},{"OutputKey":"GitHubActionsCdkDeployRoleArn","OutputValue":"arn:aws:iam::111:role/deploy"}]'
  exit 0
fi
if [ "$1" = "sesv2" ] && [ "$2" = "get-email-identity" ]; then
  echo '[]'
  exit 0
fi
if [ "$1" = "ssm" ] && [ "$2" = "get-parameter" ]; then
  echo "ParameterNotFound: parameter not found." >&2
  exit 254
fi
if [ "$1" = "ssm" ] && [ "$2" = "put-parameter" ]; then
  exit 0
fi
exit 0
`,
  );
  chmodSync(join(bin, "aws"), 0o755);

  writeFileSync(join(bin, "pnpm"), "#!/bin/sh\ncat >/dev/null 2>&1\nexit 0\n");
  chmodSync(join(bin, "pnpm"), 0o755);

  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
echo "$*" >> "${ghCallLogPath}"
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  echo "AaronBuxbaum/diveday"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo "12345"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "repos/AaronBuxbaum/diveday/environments/infra-deploy" ]; then
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
fi
cat >/dev/null 2>&1
exit 0
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "cdk"), 0o755);

  return { directory, bin, secretCallLogPath, ghCallLogPath };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function run(directory, bin, extraArguments, extraEnvironment) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), "scripts", "infra-deploy.mjs"), ...extraArguments],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_PROFILE: "ambient-caller-profile",
        AWS_ACCESS_KEY_ID: "ambient-key",
        AWS_SECRET_ACCESS_KEY: "ambient-secret",
        AWS_PROFILE_HOME: join(directory, "aws-home"),
        VERCEL_DNS_ZONE: "dive.day",
        PATH: `${bin}:${process.env.PATH}`,
        ...extraEnvironment,
      },
    },
  );
}

describe("infra-deploy in CI", () => {
  it("runs the post-deploy wizard non-interactively, answering yes to every question", () => {
    const { directory, bin, ghCallLogPath } = fixture();
    const result = run(directory, bin, ["--ci-unattended"], {});

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "CI deploy: running the post-deploy wizard non-interactively, answering yes to every question.",
    );
    expect(result.stdout).not.toContain("Run this command in a terminal");

    // Proof the wizard actually ran each step rather than the banner alone:
    // sync-github-cdk-ci-vars.mjs's two `gh variable set` calls only fire once
    // every yes/no prompt ahead of it in the wizard answered yes.
    const ghCalls = readFileSync(ghCallLogPath, "utf8");
    expect(ghCalls).toContain(
      "variable set AWS_CDK_DIFF_ROLE_ARN --body arn:aws:iam::111:role/diff",
    );
    expect(ghCalls).toContain(
      "variable set AWS_CDK_DEPLOY_ROLE_ARN --body arn:aws:iam::111:role/deploy",
    );
  });

  it("skips the wizard on --no-wizard even with --ci-unattended", () => {
    const { directory, bin, ghCallLogPath } = fixture();
    const result = run(directory, bin, ["--ci-unattended", "--no-wizard"], {});

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Skipped the post-deploy wizard (--no-wizard).");
    expect(result.stdout).not.toContain("CI deploy: running the post-deploy wizard");
    expect(() => readFileSync(ghCallLogPath, "utf8")).toThrow();
  });

  it("reads the credentials secret with the ambient OIDC-assumed credentials, not a diveday-admin profile", () => {
    const { directory, bin, secretCallLogPath } = fixture();
    const result = run(directory, bin, ["--ci-unattended", "--no-wizard"], {});

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(secretCallLogPath, "utf8").trim()).toBe(
      "AWS_PROFILE=ambient-caller-profile AWS_ACCESS_KEY_ID=ambient-key",
    );
  });

  it("never treats CI=true, or any other ambient environment variable, as authorization to run unattended", () => {
    // A dev shell running `act`, a test runner, or a leftover CI=true from a
    // past debugging session must not be able to trigger the auto-yes wizard
    // and the ambient-credential secret read just by having those variables
    // set -- only the explicit --ci-unattended flag .github/workflows/infra.yml
    // passes can (security review on ADR 20260811-ci-deploy-full-wizard).
    const { directory, bin, secretCallLogPath, ghCallLogPath } = fixture();
    const result = run(directory, bin, ["--no-wizard"], {
      CI: "true",
      GITHUB_ACTIONS: "true",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/token",
    });

    expect(result.status, result.stderr).toBe(0);
    // The workstation profile swap still ran: diveday-admin, not the ambient
    // caller profile, and the ambient key was stripped before the read.
    expect(readFileSync(secretCallLogPath, "utf8").trim()).toBe(
      "AWS_PROFILE=diveday-admin AWS_ACCESS_KEY_ID=<unset>",
    );
    expect(() => readFileSync(ghCallLogPath, "utf8")).toThrow();
  });
});
