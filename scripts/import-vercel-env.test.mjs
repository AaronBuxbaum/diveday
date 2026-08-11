import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Stubs `aws sts get-caller-identity` (so ensureAwsLogin's verify succeeds
// without a real session), `aws ssm get-parameter` (returns the seeded
// checkpoint fixture, or exits ParameterNotFound when there is none), and
// `aws ssm put-parameter` (records the --value and --name it was given, so a
// test can assert both the fingerprint content and which parameter it named)
// -- plus `pnpm exec vercel env add` (records the key it was called with).
function writeStubs(
  binDirectory,
  { checkpointDocument, addLogPath, putValueLogPath, ssmCallsLogPath },
) {
  const checkpointFixturePath = join(binDirectory, "checkpoint-fixture.env");
  if (checkpointDocument !== undefined) writeFileSync(checkpointFixturePath, checkpointDocument);

  writeFileSync(
    join(binDirectory, "aws"),
    `#!/bin/sh
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  echo '{"Account":"000000000000"}'
  exit 0
fi
if [ "$1" = "ssm" ]; then
  name=""
  previous=""
  for arg in "$@"; do
    if [ "$previous" = "--name" ]; then name="$arg"; fi
    previous="$arg"
  done
  echo "$2 $name" >> "${ssmCallsLogPath}"
  if [ "$2" = "get-parameter" ]; then
    if [ -f "${checkpointFixturePath}" ]; then
      cat "${checkpointFixturePath}"
      exit 0
    fi
    echo "ParameterNotFound: parameter not found." >&2
    exit 254
  fi
  if [ "$2" = "put-parameter" ]; then
    previous=""
    for arg in "$@"; do
      if [ "$previous" = "--value" ]; then printf '%s' "$arg" > "${putValueLogPath}"; fi
      previous="$arg"
    done
    exit 0
  fi
fi
exit 1
`,
  );
  chmodSync(join(binDirectory, "aws"), 0o755);

  writeFileSync(
    join(binDirectory, "pnpm"),
    `#!/bin/sh
if [ "$4" = "add" ]; then
  echo "$5" >> "${addLogPath}"
  cat >/dev/null
  exit 0
fi
exit 1
`,
  );
  chmodSync(join(binDirectory, "pnpm"), 0o755);
}

function runImport(candidateLines, { environment = "production", checkpointDocument } = {}) {
  const binDirectory = temporaryDirectory("diveday-vercel-stub-");
  const addLogPath = join(binDirectory, "add.log");
  const putValueLogPath = join(binDirectory, "put-value.log");
  const ssmCallsLogPath = join(binDirectory, "ssm-calls.log");
  writeStubs(binDirectory, { checkpointDocument, addLogPath, putValueLogPath, ssmCallsLogPath });

  const inputPath = join(binDirectory, ".env.vercel");
  writeFileSync(inputPath, `${candidateLines.join("\n")}\n`);

  const stdout = execFileSync(
    "node",
    [join(process.cwd(), "scripts", "import-vercel-env.mjs"), inputPath, environment],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );

  const added = existsSync(addLogPath)
    ? readFileSync(addLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const pushedValue = existsSync(putValueLogPath) ? readFileSync(putValueLogPath, "utf8") : null;
  const ssmCalls = existsSync(ssmCallsLogPath)
    ? readFileSync(ssmCallsLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  return { stdout, added, pushedValue, ssmCalls };
}

describe("import-vercel-env", () => {
  it("only pushes keys whose fingerprint differs from the last sync", () => {
    const { added } = runImport(["APP_HOST=https://dive.day", "AUTH_SECRET=unchanged"], {
      checkpointDocument: `APP_HOST=${fingerprint("https://old.example")}\nAUTH_SECRET=${fingerprint("unchanged")}\n`,
    });
    expect(added).toEqual(["APP_HOST"]);
  });

  it("pushes everything the first time, when there is no checkpoint parameter yet", () => {
    const { added, stdout } = runImport(["A=1", "B=2"]);
    expect(added.sort()).toEqual(["A", "B"]);
    expect(stdout).not.toContain("Could not read");
  });

  it("warns but still pushes everything when reading the checkpoint fails for a reason other than not-found", () => {
    // No checkpoint fixture and no ParameterNotFound stderr means the stub's
    // catch-all `exit 1` path fires -- simulating a permissions/network
    // failure distinct from the ordinary first-sync case.
    const binDirectory = temporaryDirectory("diveday-vercel-stub-");
    writeFileSync(
      join(binDirectory, "aws"),
      `#!/bin/sh
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  echo '{"Account":"000000000000"}'
  exit 0
fi
if [ "$1" = "ssm" ] && [ "$2" = "get-parameter" ]; then
  echo "AccessDeniedException: not authorized" >&2
  exit 254
fi
exit 0
`,
    );
    chmodSync(join(binDirectory, "aws"), 0o755);
    writeFileSync(
      join(binDirectory, "pnpm"),
      `#!/bin/sh
if [ "$4" = "add" ]; then
  echo "$5" >> "${join(binDirectory, "add.log")}"
  cat >/dev/null
  exit 0
fi
exit 1
`,
    );
    chmodSync(join(binDirectory, "pnpm"), 0o755);
    const inputPath = join(binDirectory, ".env.vercel");
    writeFileSync(inputPath, "A=1\n");

    const result = spawnSync(
      "node",
      [join(process.cwd(), "scripts", "import-vercel-env.mjs"), inputPath, "production"],
      { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
    );

    expect(result.stderr).toContain("Could not read the production Vercel sync checkpoint");
    expect(readFileSync(join(binDirectory, "add.log"), "utf8").trim()).toBe("A");
  });

  it("records a fingerprint, never the raw value, as the new checkpoint", () => {
    const { pushedValue } = runImport(["A=super-secret"]);
    expect(pushedValue).toBe(`A=${fingerprint("super-secret")}`);
    expect(pushedValue).not.toContain("super-secret");
  });

  it("names the checkpoint parameter for the requested environment", () => {
    const { ssmCalls } = runImport(["A=1"], { environment: "preview" });
    expect(ssmCalls).toContain("get-parameter /diveday/env-sync/vercel/preview");
    expect(ssmCalls).toContain("put-parameter /diveday/env-sync/vercel/preview");
  });

  describe("AWS credential selection", () => {
    function runWithCredentialLogging(extraArguments = [], extraEnvironment = {}) {
      const binDirectory = temporaryDirectory("diveday-vercel-stub-");
      const credentialLogPath = join(binDirectory, "credentials.log");
      writeFileSync(
        join(binDirectory, "aws"),
        `#!/bin/sh
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  echo "AWS_PROFILE=\${AWS_PROFILE:-<unset>} AWS_ACCESS_KEY_ID=\${AWS_ACCESS_KEY_ID:-<unset>}" >> "${credentialLogPath}"
  echo '{"Account":"000000000000"}'
  exit 0
fi
if [ "$1" = "ssm" ] && [ "$2" = "get-parameter" ]; then
  echo "ParameterNotFound: parameter not found." >&2
  exit 254
fi
if [ "$1" = "ssm" ] && [ "$2" = "put-parameter" ]; then
  exit 0
fi
exit 1
`,
      );
      chmodSync(join(binDirectory, "aws"), 0o755);
      writeFileSync(
        join(binDirectory, "pnpm"),
        `#!/bin/sh
if [ "$4" = "add" ]; then
  cat >/dev/null
  exit 0
fi
exit 1
`,
      );
      chmodSync(join(binDirectory, "pnpm"), 0o755);

      const inputPath = join(binDirectory, ".env.vercel");
      writeFileSync(inputPath, "A=1\n");

      const environment = {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        AWS_PROFILE: "ambient-caller-profile",
        AWS_ACCESS_KEY_ID: "ambient-key",
        AWS_SECRET_ACCESS_KEY: "ambient-secret",
        ...extraEnvironment,
      };

      execFileSync(
        "node",
        [
          join(process.cwd(), "scripts", "import-vercel-env.mjs"),
          inputPath,
          "production",
          ...extraArguments,
        ],
        { env: environment, encoding: "utf8" },
      );

      return readFileSync(credentialLogPath, "utf8").trim();
    }

    it("swaps to the diveday-admin profile and strips ambient keys on a workstation", () => {
      expect(runWithCredentialLogging()).toBe(
        "AWS_PROFILE=diveday-admin AWS_ACCESS_KEY_ID=<unset>",
      );
    });

    it("honors INFRA_ENV_SYNC_PROFILE instead of the diveday-admin default off CI", () => {
      expect(runWithCredentialLogging([], { INFRA_ENV_SYNC_PROFILE: "diveday-break-glass" })).toBe(
        "AWS_PROFILE=diveday-break-glass AWS_ACCESS_KEY_ID=<unset>",
      );
    });

    it("keeps the ambient OIDC-assumed credentials as-is with --ci-unattended, without a diveday-admin profile", () => {
      expect(runWithCredentialLogging(["--ci-unattended"])).toBe(
        "AWS_PROFILE=ambient-caller-profile AWS_ACCESS_KEY_ID=ambient-key",
      );
    });

    it("never treats a bare CI=true (or GITHUB_ACTIONS=true) as authorization to skip the profile swap", () => {
      // Only the explicit --ci-unattended flag scripts/post-deploy-wizard.mjs
      // forwards may do that -- see infra-deploy.mjs's isCiDeploy comment
      // (security review on ADR 20260811-ci-deploy-full-wizard).
      expect(runWithCredentialLogging([], { CI: "true", GITHUB_ACTIONS: "true" })).toBe(
        "AWS_PROFILE=diveday-admin AWS_ACCESS_KEY_ID=<unset>",
      );
    });
  });
});
