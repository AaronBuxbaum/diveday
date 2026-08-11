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
// `aws ssm put-parameter` (records both the raw --value argument -- expected
// to be a `file://` reference, never the content itself -- and the resolved
// content of the file it points at, plus the --name it was given) -- plus
// `pnpm exec vercel env add` (records the key it was called with).
function writeStubs(
  binDirectory,
  { checkpointDocument, addLogPath, putValueLogPath, putValueArgumentLogPath, ssmCallsLogPath },
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
      if [ "$previous" = "--value" ]; then
        printf '%s' "$arg" > "${putValueArgumentLogPath}"
        path=$(printf '%s' "$arg" | sed 's#^file://##')
        if [ -f "$path" ]; then cp "$path" "${putValueLogPath}"; fi
      fi
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
  const putValueArgumentLogPath = join(binDirectory, "put-value-argument.log");
  const ssmCallsLogPath = join(binDirectory, "ssm-calls.log");
  writeStubs(binDirectory, {
    checkpointDocument,
    addLogPath,
    putValueLogPath,
    putValueArgumentLogPath,
    ssmCallsLogPath,
  });

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
  const pushedValueArgument = existsSync(putValueArgumentLogPath)
    ? readFileSync(putValueArgumentLogPath, "utf8")
    : null;
  const ssmCalls = existsSync(ssmCallsLogPath)
    ? readFileSync(ssmCallsLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  return { stdout, added, pushedValue, pushedValueArgument, ssmCalls };
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

  it("passes the checkpoint through a file, never as a literal CLI argument", () => {
    const { pushedValueArgument, pushedValue } = runImport(["A=1"]);
    expect(pushedValueArgument).toMatch(/^file:\/\//);
    expect(pushedValueArgument).not.toContain(fingerprint("1"));
    expect(pushedValue).toBe(`A=${fingerprint("1")}`);
  });

  it("names the checkpoint parameter for the requested environment", () => {
    const { ssmCalls } = runImport(["A=1"], { environment: "preview" });
    expect(ssmCalls).toContain("get-parameter /diveday/env-sync/vercel/preview");
    expect(ssmCalls).toContain("put-parameter /diveday/env-sync/vercel/preview");
  });
});
