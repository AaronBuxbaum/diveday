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

// Stubs `gh secret set --env-file <path>`: records the pushed file's content
// to logPath so a test can see exactly what would have been sent to GitHub.
function writeGhStub(binDirectory, logPath, exitCode = 0) {
  writeFileSync(
    join(binDirectory, "gh"),
    `#!/bin/sh
cat "$4" >> "${logPath}"
exit ${exitCode}
`,
  );
  chmodSync(join(binDirectory, "gh"), 0o755);
}

function sync(inputPath, binDirectory) {
  return execFileSync(
    "node",
    [join(process.cwd(), "scripts", "sync-github-secrets.mjs"), inputPath],
    { env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` }, encoding: "utf8" },
  );
}

describe("sync-github-secrets", () => {
  it("pushes everything on the first run and writes a checkpoint", () => {
    const directory = temporaryDirectory("diveday-gh-secrets-");
    const inputPath = join(directory, ".env.github");
    writeFileSync(inputPath, "A=1\nB=2\n");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath);

    sync(inputPath, directory);

    const pushed = readFileSync(logPath, "utf8");
    expect(pushed).toContain("A=1");
    expect(pushed).toContain("B=2");
    expect(readFileSync(`${inputPath}.synced`, "utf8")).toBe(readFileSync(inputPath, "utf8"));
  });

  it("skips the push entirely when nothing changed since the last sync", () => {
    const directory = temporaryDirectory("diveday-gh-secrets-");
    const inputPath = join(directory, ".env.github");
    writeFileSync(inputPath, "A=1\nB=2\n");
    writeFileSync(`${inputPath}.synced`, "A=1\nB=2\n");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath);

    sync(inputPath, directory);

    expect(existsSync(logPath)).toBe(false);
  });

  it("pushes only the changed subset and checkpoints the full new state", () => {
    const directory = temporaryDirectory("diveday-gh-secrets-");
    const inputPath = join(directory, ".env.github");
    writeFileSync(inputPath, "A=1\nB=changed\n");
    writeFileSync(`${inputPath}.synced`, "A=1\nB=old\n");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath);

    sync(inputPath, directory);

    const pushed = readFileSync(logPath, "utf8");
    expect(pushed).toContain("B=changed");
    expect(pushed).not.toContain("A=1");
    expect(readFileSync(`${inputPath}.synced`, "utf8")).toBe("A=1\nB=changed\n");
  });

  it("does not checkpoint when the push fails", () => {
    const directory = temporaryDirectory("diveday-gh-secrets-");
    const inputPath = join(directory, ".env.github");
    writeFileSync(inputPath, "A=1\n");
    const logPath = join(directory, "gh.log");
    writeGhStub(directory, logPath, 1);

    expect(() => sync(inputPath, directory)).toThrow();
    expect(existsSync(`${inputPath}.synced`)).toBe(false);
  });
});
