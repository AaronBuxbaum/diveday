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

// Stubs `pnpm exec vercel env add ...`: records the key it was called with
// and discards the value it reads from stdin. There is no `pull` stub --
// Vercel never returns a sensitive value once set, so the script no longer
// calls it.
function writePnpmStub(binDirectory, addLogPath) {
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

function runImport(candidateLines, { environment = "production", checkpoint } = {}) {
  const binDirectory = temporaryDirectory("diveday-vercel-stub-");
  const addLogPath = join(binDirectory, "add.log");
  writePnpmStub(binDirectory, addLogPath);

  const inputPath = join(binDirectory, ".env.vercel");
  writeFileSync(inputPath, `${candidateLines.join("\n")}\n`);
  if (checkpoint !== undefined) {
    writeFileSync(`${inputPath}.synced.${environment}`, checkpoint);
  }

  const stdout = execFileSync(
    "node",
    [join(process.cwd(), "scripts", "import-vercel-env.mjs"), inputPath, environment],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );

  const added = existsSync(addLogPath)
    ? readFileSync(addLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const checkpointAfter = existsSync(`${inputPath}.synced.${environment}`)
    ? readFileSync(`${inputPath}.synced.${environment}`, "utf8")
    : null;
  return { stdout, added, checkpointAfter };
}

describe("import-vercel-env", () => {
  it("only pushes keys whose value differs from the last sync", () => {
    const { added } = runImport(["APP_HOST=https://dive.day", "AUTH_SECRET=unchanged"], {
      checkpoint: "APP_HOST=https://old.example\nAUTH_SECRET=unchanged\n",
    });
    expect(added).toEqual(["APP_HOST"]);
  });

  it("pushes everything the first time, when there is no checkpoint yet", () => {
    const { added } = runImport(["A=1", "B=2"]);
    expect(added.sort()).toEqual(["A", "B"]);
  });

  it("records the full pushed document as the new checkpoint", () => {
    const { checkpointAfter } = runImport(["A=1", "B=2"], { checkpoint: "A=1\n" });
    expect(checkpointAfter).toBe("A=1\nB=2\n");
  });

  it("keeps checkpoints separate per environment", () => {
    const { added } = runImport(["A=1"], { environment: "preview", checkpoint: "" });
    expect(added).toEqual(["A"]);
  });
});
