import { describe, expect, it } from "vitest";
import {
  DEV_DEMO_QUIET_KEY,
  demoQuietKey,
  isDemoQuietKey,
  isQuietDemoDevice,
  MIN_DEMO_QUIET_KEY_LENGTH,
  quietDemoToken,
} from "./quiet-demo-device";

const KEY = "k".repeat(MIN_DEMO_QUIET_KEY_LENGTH);
const env = { NODE_ENV: "production", DEMO_QUIET_KEY: KEY };

describe("demoQuietKey", () => {
  it("is unset in production when nothing, or something too short, is configured", () => {
    expect(demoQuietKey({ NODE_ENV: "production" })).toBeNull();
    expect(demoQuietKey({ NODE_ENV: "production", DEMO_QUIET_KEY: "   " })).toBeNull();
    expect(demoQuietKey({ NODE_ENV: "production", DEMO_QUIET_KEY: "hunter2" })).toBeNull();
  });

  it("takes the configured key, trimmed", () => {
    expect(demoQuietKey({ NODE_ENV: "production", DEMO_QUIET_KEY: ` ${KEY}\n` })).toBe(KEY);
  });

  it("falls back to a fixed key outside production only, and never past a configured one", () => {
    expect(demoQuietKey({ NODE_ENV: "development" })).toBe(DEV_DEMO_QUIET_KEY);
    expect(demoQuietKey({ NODE_ENV: "development", DEMO_QUIET_KEY: "short" })).toBeNull();
  });

  it("refuses the key written in this repository, wherever it is configured", () => {
    expect(demoQuietKey({ NODE_ENV: "production", DEMO_QUIET_KEY: DEV_DEMO_QUIET_KEY })).toBeNull();
  });

  /**
   * The key used to be `ONBOARD_SETUP_KEY`, which also created shops. That
   * variable is gone (ADR 20261009-single-use-setup-links): a deployment that
   * still carries it marks nothing until the new one is set.
   */
  it("does not read the retired onboard setup key", () => {
    expect(demoQuietKey({ NODE_ENV: "production", ONBOARD_SETUP_KEY: KEY })).toBeNull();
  });
});

describe("isDemoQuietKey", () => {
  it("accepts the key and refuses a prefix, a suffix, a near miss and non-strings", () => {
    expect(isDemoQuietKey(KEY, env)).toBe(true);
    for (const candidate of [
      KEY.slice(1),
      `${KEY}k`,
      KEY.toUpperCase(),
      "",
      " ",
      undefined,
      [KEY],
    ]) {
      expect(isDemoQuietKey(candidate, env)).toBe(false);
    }
  });
});

describe("quietDemoToken", () => {
  it("marks nothing when the deployment has no key", () => {
    expect(quietDemoToken({ NODE_ENV: "production" })).toBeNull();
    expect(isQuietDemoDevice("anything", { NODE_ENV: "production" })).toBe(false);
  });

  it("is derived from the key, never the key itself", () => {
    const token = quietDemoToken(env);
    expect(token).toBeTruthy();
    expect(token).not.toContain(KEY);
  });

  it("changes when the key is rotated, unmarking every browser", () => {
    const rotated = { ...env, DEMO_QUIET_KEY: "r".repeat(MIN_DEMO_QUIET_KEY_LENGTH) };
    const before = quietDemoToken(env);
    expect(quietDemoToken(rotated)).not.toBe(before);
    expect(isQuietDemoDevice(before, rotated)).toBe(false);
  });
});

describe("isQuietDemoDevice", () => {
  it("accepts the token this deployment issues", () => {
    expect(isQuietDemoDevice(quietDemoToken(env), env)).toBe(true);
  });

  it("refuses the key itself, a missing cookie, and anything else", () => {
    expect(isQuietDemoDevice(KEY, env)).toBe(false);
    expect(isQuietDemoDevice(undefined, env)).toBe(false);
    expect(isQuietDemoDevice("", env)).toBe(false);
    expect(isQuietDemoDevice(`${quietDemoToken(env)}x`, env)).toBe(false);
    // Same length in characters, longer in bytes: a no, never a throw.
    expect(isQuietDemoDevice("é".repeat(quietDemoToken(env)?.length ?? 0), env)).toBe(false);
  });
});

describe("the marking link in telemetry", () => {
  it("never carries the key", async () => {
    const { redactCapabilityUrl } = await import("./capability-urls");
    const { QUIET_DEMO_PARAM } = await import("./quiet-demo-device");
    const redacted = redactCapabilityUrl(`/api/demo/quiet?${QUIET_DEMO_PARAM}=${KEY}`);
    expect(redacted).not.toContain(KEY);
  });
});
