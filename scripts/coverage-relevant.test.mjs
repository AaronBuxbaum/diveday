import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageRelevant } from "./coverage-relevant.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

describe("coverageRelevant", () => {
  it.each([
    "src/lib/readiness.ts",
    "src/lib/readiness.test.ts",
    "src/lib/readiness.adversarial.test.ts",
    "src/db/bookings.ts",
    "src/db/bookings-capacity.test.ts",
    "vitest.config.ts",
    "src/test/db.ts",
    "scripts/coverage-floors.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
  ])("keeps coverage for %s", (file) => {
    expect(coverageRelevant(file)).toBe(true);
  });

  it.each([
    "src/app/s/page.tsx",
    "src/lib/clock.ts",
    "src/db/shops.ts",
    "src/lib/readiness-copy/x.ts",
    "e2e/booking.spec.ts",
    "docs/agents/working-rules.md",
    "src/i18n/locales/es-ES/diver.json",
    "src/i18n/locales/es-ES/content/marketing.json",
  ])("skips coverage for %s", (file) => {
    expect(coverageRelevant(file)).toBe(false);
  });
});

it("waits for delayed chunks on a nonblocking large git-diff pipe", () => {
  // The outer bounded runner owns the producer and reader. The async child has
  // its own five-second deadline because this fixture must never wedge the suite.
  const driver = String.raw`
    import { spawn } from "node:child_process";
    import { setTimeout as delay } from "node:timers/promises";
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      'import { pathToFileURL } from "node:url"; process.stdin._handle.setBlocking(false); console.log("ready"); await import(pathToFileURL(process.argv[1]).href);',
      process.argv[1]], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000, killSignal: "SIGKILL" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.on("error", () => {});
    const exited = new Promise(resolve => child.once("close", (status, signal) => resolve({ status, signal })));
    await new Promise(resolve => child.stdout.once("data", resolve));
    // Leave fd 0 open but empty while the guard reaches its read, as Actions did.
    await delay(150);
    const irrelevant = Array.from({ length: 4500 }, (_, i) => "docs/architecture/example-" + i + ".md\n").join("");
    const input = irrelevant + "src/features/check-in/store.ts\nsrc/test/projects.ts\ndocs/no-coverage.md\n";
    // Split a relevant path as well as sending more than one pipe buffer.
    const cut = irrelevant.length + 17;
    child.stdin.write(input.slice(0, cut));
    await delay(25);
    child.stdin.end(input.slice(cut));
    const result = await exited;
    console.log(JSON.stringify({ ...result, stdout: stdout.replace(/^ready\n/, ""), stderr }));
  `;
  const run = runBounded(
    process.execPath,
    ["--input-type=module", "-e", driver, path.join(import.meta.dirname, "coverage-relevant.mjs")],
    {
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
      encoding: "utf8",
    },
  );
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(run.stdout.trim());
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("src/features/check-in/store.ts\nsrc/test/projects.ts\n");
});
