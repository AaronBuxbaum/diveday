import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const supervisor = readFileSync(join(root, "scripts/e2e-server.mjs"), "utf8");
const config = readFileSync(join(root, "playwright.config.ts"), "utf8");

describe("e2e server lifecycle", () => {
  it("keeps Next and its descendants in a private process group", () => {
    expect(supervisor).toContain('detached: process.platform !== "win32"');
    expect(supervisor).toContain("process.kill(target, signal)");
    expect(supervisor).toContain('process.once("exit", () =>');
    expect(supervisor).toContain('signalChildGroup("SIGKILL")');
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
