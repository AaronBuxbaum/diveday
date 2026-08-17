import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signalProcessTree } from "./e2e-process-tree.mjs";

const root = process.cwd();
const supervisor = readFileSync(join(root, "scripts/e2e-server.mjs"), "utf8");
const config = readFileSync(join(root, "playwright.config.ts"), "utf8");

describe("e2e server lifecycle", () => {
  it("stays inside Playwright's process group", () => {
    expect(supervisor).toContain("detached: false");
    expect(supervisor).toContain("signalProcessTree(child.pid, signal)");
    expect(supervisor).not.toContain('detached: process.platform !== "win32"');
    expect(supervisor).toContain("process.ppid !== ownerPid");
    expect(supervisor).toContain('process.stdin.once("end"');
    expect(supervisor).toContain('process.once("exit", () =>');
    expect(supervisor).toContain('signalChild("SIGKILL")');
  });

  it("terminates a server descendant when the launcher disappears", async () => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { spawn } from "node:child_process"; const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); descendant.once("spawn", () => console.log("ready")); setInterval(() => {}, 1000);',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", resolve);
    });

    signalProcessTree(child.pid, "SIGTERM");
    await expect(new Promise((resolve) => child.once("exit", () => resolve(true)))).resolves.toBe(
      true,
    );
  });

  it("does not silently reuse a stale local fleet", () => {
    expect(config).toContain("command: e2eServerCommand(port)");
    expect(config).toContain("reuseExistingServer: false");
  });

  it("does not forward routine server stdout into Playwright output", () => {
    expect(config).toContain('stdout: "ignore"');
    expect(config).toContain('stderr: "pipe"');
  });
});
