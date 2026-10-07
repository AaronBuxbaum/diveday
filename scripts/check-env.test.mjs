import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];
const workspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "diveday-check-env-"));
  directories.push(directory);
  return directory;
};

// The checker reads `.env.manual` from its working directory and the
// production requirement from its own environment, so each case gets an empty
// directory and an environment holding nothing but what it names.
const checkEnv = (env, cwd = workspace()) =>
  spawnSync(process.execPath, [join(process.cwd(), "scripts", "check-env.mjs")], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });

const UPSTASH = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("check-env", () => {
  it("leaves a local run without the rate-limit store alone", () => {
    // The in-process store is the intended state everywhere but production.
    const run = checkEnv({});

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
  });

  it("leaves a preview deployment without the rate-limit store alone", () => {
    const run = checkEnv({ VERCEL_ENV: "preview" });

    expect(run.status).toBe(0);
  });

  it("fails production when the Upstash pair is absent, naming both keys", () => {
    const run = checkEnv({ VERCEL_ENV: "production" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("UPSTASH_REDIS_REST_URL");
    expect(run.stderr).toContain("UPSTASH_REDIS_REST_TOKEN");
    expect(run.stderr).toContain("per-instance in-memory store");
  });

  it("fails production when only half the pair is set", () => {
    const run = checkEnv({
      VERCEL_ENV: "production",
      UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: "  ",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("missing UPSTASH_REDIS_REST_TOKEN");
  });

  it("passes production when both are set", () => {
    const run = checkEnv({ VERCEL_ENV: "production", ...UPSTASH });

    expect(run.status).toBe(0);
  });

  it("still refuses a stack-produced key in .env.manual", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, ".env.manual"), "SES_AWS_ACCESS_KEY_ID=AKIA_BY_HAND\n");

    const run = checkEnv({}, cwd);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("SES_AWS_ACCESS_KEY_ID");
  });
});
