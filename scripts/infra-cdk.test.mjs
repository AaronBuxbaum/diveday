import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "diveday-infra-cdk-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  const cdkDirectory = join(directory, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(cdkDirectory, { recursive: true });
  writeFileSync(
    join(bin, "aws"),
    `#!/bin/sh
if [ "$1" = "sts" ]; then printf '%s' '{"Account":"123456789012"}'; fi
`,
  );
  writeFileSync(
    join(cdkDirectory, "cdk"),
    '#!/bin/sh\nprintf \'%s\' "$AWS_PROFILE:$*" > "$DIVEDAY_CDK_LOG"\n',
  );
  chmodSync(join(bin, "aws"), 0o755);
  chmodSync(join(cdkDirectory, "cdk"), 0o755);
  // An AWS home with no profiles in it. Without this the scripts read the
  // developer's real ~/.aws, so `selectDeployProfile` finds whatever profiles
  // that machine happens to have installed and the "nothing is configured"
  // cases below assert against someone's workstation instead of a fixture.
  mkdirSync(join(directory, "aws-home"), { recursive: true });
  return directory;
}

/**
 * The environment for a case that means "no AWS anything": no ambient
 * credentials, no selected profile, and no profiles on disk to discover.
 *
 * `PATH` is emptied rather than inherited on purpose -- a real `aws` binary on
 * the developer's PATH is exactly what these cases must not find. `cdk` is
 * still reached, because infra-cdk.mjs runs `node_modules/.bin/cdk` by
 * absolute path rather than resolving it through PATH.
 */
function unconfigured(directory) {
  const environment = { ...process.env, DIVEDAY_CDK_LOG: join(directory, "cdk.log") };
  delete environment.AWS_PROFILE;
  delete environment.INFRA_DEPLOY_PROFILE;
  delete environment.AWS_ACCESS_KEY_ID;
  delete environment.AWS_SECRET_ACCESS_KEY;
  delete environment.AWS_SESSION_TOKEN;
  delete environment.AWS_SHARED_CREDENTIALS_FILE;
  delete environment.AWS_CONFIG_FILE;
  environment.AWS_PROFILE_HOME = join(directory, "aws-home");
  environment.PATH = "";
  return environment;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("infra-cdk", () => {
  it("runs synth without verifying an AWS session -- selectDeployProfile's env shaping still applies", () => {
    const directory = fixture();
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "infra-cdk.mjs"), "synth"],
      {
        cwd: directory,
        env: {
          ...process.env,
          AWS_PROFILE: "diveday-admin",
          DIVEDAY_CDK_LOG: join(directory, "cdk.log"),
          PATH: `${join(directory, "bin")}:${process.env.PATH}`,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(directory, "cdk.log"), "utf8")).toBe("diveday-admin:synth");
  });

  it("runs synth with no AWS login available at all -- the diff job's pre-credentials step", () => {
    const directory = fixture();
    // No `aws` on PATH at all, and no credentials/profile of any kind --
    // matches .github/workflows/infra.yml's diff job, which runs `pnpm
    // infra:synth` before its `configure-aws-credentials` step so a broken
    // template fails loudly even when AWS_CDK_DIFF_ROLE_ARN hasn't been set
    // up yet. ensureAwsDeploymentLogin would fail immediately in this
    // environment; synth must never call it.
    const environment = unconfigured(directory);

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "infra-cdk.mjs"), "synth", "--quiet"],
      { cwd: directory, env: environment },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(directory, "cdk.log"), "utf8")).toBe("diveday-admin:synth --quiet");
  });

  it("still verifies the selected administrator session before diff", () => {
    const directory = fixture();
    // No `aws` reachable at all: ensureAwsDeploymentLogin has nothing to
    // successfully call, so diff -- unlike synth -- must fail rather than
    // proceed to invoke cdk at all.
    const environment = unconfigured(directory);

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts", "infra-cdk.mjs"), "diff"],
      { cwd: directory, env: environment },
    );

    expect(result.status).not.toBe(0);
  });
});
