import { execFileSync } from "node:child_process";
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

// Stubs `pnpm exec vercel env pull|add ...`: pull writes back a fixed
// document (simulating what's already on Vercel), add records the key it
// was called with and discards the value it reads from stdin.
function writePnpmStub(binDirectory, { pulledDocument, pullExitCode = 0, addLogPath }) {
  const pulledFile = join(binDirectory, "pulled-fixture.env");
  writeFileSync(pulledFile, pulledDocument);
  writeFileSync(
    join(binDirectory, "pnpm"),
    `#!/bin/sh
if [ "$4" = "pull" ]; then
  if [ "${pullExitCode}" -eq 0 ]; then cp "${pulledFile}" "$5"; fi
  exit ${pullExitCode}
fi
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

function runImport(candidateLines, { pulledDocument = "", pullExitCode = 0 } = {}) {
  const binDirectory = temporaryDirectory("diveday-vercel-stub-");
  const addLogPath = join(binDirectory, "add.log");
  writePnpmStub(binDirectory, { pulledDocument, pullExitCode, addLogPath });

  const inputPath = join(binDirectory, ".env.vercel");
  writeFileSync(inputPath, `${candidateLines.join("\n")}\n`);

  const stdout = execFileSync(
    "node",
    [join(process.cwd(), "scripts", "import-vercel-env.mjs"), inputPath, "production"],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );

  const added = existsSync(addLogPath)
    ? readFileSync(addLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  return { stdout, added };
}

describe("import-vercel-env", () => {
  it("only pushes keys whose value differs from what Vercel already has", () => {
    const { added } = runImport(["APP_HOST=https://dive.day", "AUTH_SECRET=unchanged"], {
      pulledDocument: 'APP_HOST="https://old.example"\nAUTH_SECRET="unchanged"\n',
    });
    expect(added).toEqual(["APP_HOST"]);
  });

  it("pushes everything the first time, when Vercel has none of these keys yet", () => {
    const { added } = runImport(["A=1", "B=2"], { pulledDocument: "" });
    expect(added.sort()).toEqual(["A", "B"]);
  });

  it("falls back to pushing everything when the pull itself fails", () => {
    const { added, stdout } = runImport(["A=1"], { pulledDocument: "", pullExitCode: 1 });
    expect(added).toEqual(["A"]);
    expect(stdout).toContain("Pushed 1 of 1");
  });
});
