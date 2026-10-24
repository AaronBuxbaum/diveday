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
  KV_REST_API_URL: "https://example.upstash.io",
  KV_REST_API_TOKEN: "token",
};

// Every key production must carry: the Upstash pair and the sealing key.
// A well-formed sealing key: 32 bytes, base64, as `openssl rand -base64 32` prints one.
const SEALING_KEY = Buffer.alloc(32, 7).toString("base64");
const PRODUCTION = { ...UPSTASH, SECRET_ENCRYPTION_KEY: SEALING_KEY };

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
    expect(run.stderr).toContain("KV_REST_API_URL");
    expect(run.stderr).toContain("KV_REST_API_TOKEN");
    expect(run.stderr).toContain("per-instance in-memory store");
  });

  it("fails production when only half the pair is set", () => {
    const run = checkEnv({
      VERCEL_ENV: "production",
      ...PRODUCTION,
      KV_REST_API_TOKEN: "  ",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("missing KV_REST_API_TOKEN");
  });

  it("passes production when every required key is set", () => {
    const run = checkEnv({ VERCEL_ENV: "production", ...PRODUCTION });

    expect(run.status).toBe(0);
  });

  it("fails production without the sealing key, naming it and the two-factor lockout", () => {
    // Without it every staffer who turned on two-factor is locked out and the notification retry
    // queue drops what it should keep, so a deploy without it fails at build rather than at sign-in.
    const run = checkEnv({ VERCEL_ENV: "production", ...UPSTASH });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("production is missing SECRET_ENCRYPTION_KEY.");
    expect(run.stderr).toContain("locked out");
  });

  it("fails production when the sealing key is only whitespace", () => {
    const run = checkEnv({ VERCEL_ENV: "production", ...UPSTASH, SECRET_ENCRYPTION_KEY: " " });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("missing SECRET_ENCRYPTION_KEY");
  });

  it("fails production when the sealing key is mistyped, naming it", () => {
    // The app reads a key that does not decode to 32 bytes as none (src/lib/secret-box.ts), so a
    // truncated paste locks two-factor staff out just as a missing key does.
    const truncated = SEALING_KEY.slice(0, 20);
    const run = checkEnv({
      VERCEL_ENV: "production",
      ...UPSTASH,
      SECRET_ENCRYPTION_KEY: truncated,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("production has a malformed SECRET_ENCRYPTION_KEY.");
    expect(run.stderr).toContain("locked out");
  });

  it("fails production when a rotation key is set but mistyped", () => {
    const run = checkEnv({
      VERCEL_ENV: "production",
      ...PRODUCTION,
      SECRET_ENCRYPTION_KEY_PREVIOUS: "not-a-key",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("malformed SECRET_ENCRYPTION_KEY_PREVIOUS");
  });

  it("leaves a mistyped sealing key alone outside production", () => {
    const run = checkEnv({ VERCEL_ENV: "preview", ...UPSTASH, SECRET_ENCRYPTION_KEY: "short" });

    expect(run.status).toBe(0);
  });

  it("leaves a preview deployment without the sealing key alone", () => {
    // Previews are not asked for any production requirement, and a preview never runs check-env
    // from the build (scripts/vercel-build.mjs gates it on VERCEL_ENV=production).
    const run = checkEnv({ VERCEL_ENV: "preview", ...UPSTASH });

    expect(run.status).toBe(0);
  });

  it("does not ask production for the rotation key", () => {
    // SECRET_ENCRYPTION_KEY_PREVIOUS is set only during a rotation; requiring it would make every
    // ordinary deploy carry a stale key.
    const run = checkEnv({ VERCEL_ENV: "production", ...PRODUCTION });

    expect(run.stderr).not.toContain("SECRET_ENCRYPTION_KEY_PREVIOUS");
  });

  it("fails production that carries the e2e harness's switches, naming each", () => {
    const run = checkEnv({
      VERCEL_ENV: "production",
      ...PRODUCTION,
      DIVEDAY_E2E: "1",
      DIVEDAY_E2E_SECRET: "left-over",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("production sets DIVEDAY_E2E, DIVEDAY_E2E_SECRET");
  });

  it("leaves the harness's switches alone outside production", () => {
    const run = checkEnv({ VERCEL_ENV: "preview", DIVEDAY_E2E: "1", DIVEDAY_E2E_SECRET: "s" });

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
