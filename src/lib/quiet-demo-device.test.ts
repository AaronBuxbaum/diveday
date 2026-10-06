import { describe, expect, it } from "vitest";
import { MIN_ONBOARD_SETUP_KEY_LENGTH } from "./onboard-setup-key";
import { isQuietDemoDevice, quietDemoToken } from "./quiet-demo-device";

const KEY = "k".repeat(MIN_ONBOARD_SETUP_KEY_LENGTH);
const env = { NODE_ENV: "production", ONBOARD_SETUP_KEY: KEY };

describe("quietDemoToken", () => {
  it("marks nothing when the deployment has no setup key", () => {
    expect(quietDemoToken({ NODE_ENV: "production" })).toBeNull();
    expect(isQuietDemoDevice("anything", { NODE_ENV: "production" })).toBe(false);
  });

  it("is derived from the key, never the key itself", () => {
    const token = quietDemoToken(env);
    expect(token).toBeTruthy();
    expect(token).not.toContain(KEY);
  });

  it("changes when the key is rotated, unmarking every browser", () => {
    const rotated = { ...env, ONBOARD_SETUP_KEY: "r".repeat(MIN_ONBOARD_SETUP_KEY_LENGTH) };
    const before = quietDemoToken(env);
    expect(quietDemoToken(rotated)).not.toBe(before);
    expect(isQuietDemoDevice(before, rotated)).toBe(false);
  });
});

describe("isQuietDemoDevice", () => {
  it("accepts the token this deployment issues", () => {
    expect(isQuietDemoDevice(quietDemoToken(env), env)).toBe(true);
  });

  it("refuses the setup key itself, a missing cookie, and anything else", () => {
    expect(isQuietDemoDevice(KEY, env)).toBe(false);
    expect(isQuietDemoDevice(undefined, env)).toBe(false);
    expect(isQuietDemoDevice("", env)).toBe(false);
    expect(isQuietDemoDevice(`${quietDemoToken(env)}x`, env)).toBe(false);
  });
});
