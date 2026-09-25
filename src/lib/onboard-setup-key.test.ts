import { describe, expect, it } from "vitest";
import { redactCapabilityUrl } from "./capability-urls";
import {
  DEV_ONBOARD_SETUP_KEY,
  E2E_ONBOARD_SETUP_KEY,
  isOnboardSetupKey,
  MIN_ONBOARD_SETUP_KEY_LENGTH,
  ONBOARD_SETUP_PARAM,
  onboardSetupKey,
} from "./onboard-setup-key";

const KEY = "k".repeat(MIN_ONBOARD_SETUP_KEY_LENGTH);

describe("onboardSetupKey", () => {
  it("is shut in production when nothing is configured", () => {
    expect(onboardSetupKey({ NODE_ENV: "production" })).toBeNull();
    expect(onboardSetupKey({ NODE_ENV: "production", ONBOARD_SETUP_KEY: "   " })).toBeNull();
  });

  it("is shut in production when the configured key is too short to be a key", () => {
    expect(onboardSetupKey({ NODE_ENV: "production", ONBOARD_SETUP_KEY: "hunter2" })).toBeNull();
  });

  it("takes the configured key, trimmed", () => {
    expect(onboardSetupKey({ NODE_ENV: "production", ONBOARD_SETUP_KEY: ` ${KEY}\n` })).toBe(KEY);
  });

  it("falls back to a fixed key outside production only", () => {
    expect(onboardSetupKey({ NODE_ENV: "development" })).toBe(DEV_ONBOARD_SETUP_KEY);
    expect(onboardSetupKey({ NODE_ENV: "test" })).toBe(DEV_ONBOARD_SETUP_KEY);
  });

  it("never falls back past a configured key, even outside production", () => {
    // A short key set on purpose is a mistake to surface, not a reason to open
    // the dev door on a deployment that happens to run without NODE_ENV.
    expect(onboardSetupKey({ NODE_ENV: "development", ONBOARD_SETUP_KEY: "short" })).toBeNull();
  });
});

describe("the keys anyone can read in this repository", () => {
  it("are refused wherever they are configured", () => {
    for (const key of [DEV_ONBOARD_SETUP_KEY, E2E_ONBOARD_SETUP_KEY]) {
      expect(onboardSetupKey({ NODE_ENV: "production", ONBOARD_SETUP_KEY: key })).toBeNull();
    }
  });

  it("let the e2e harness through with its own key, and nowhere with a real database", () => {
    const harness = {
      NODE_ENV: "production",
      DIVEDAY_E2E: "1",
      ONBOARD_SETUP_KEY: E2E_ONBOARD_SETUP_KEY,
    };
    expect(onboardSetupKey(harness)).toBe(E2E_ONBOARD_SETUP_KEY);
    expect(onboardSetupKey({ ...harness, DATABASE_URL: "postgres://real" })).toBeNull();
    expect(onboardSetupKey({ ...harness, DIVEDAY_E2E: undefined })).toBeNull();
  });
});

describe("isOnboardSetupKey", () => {
  const env = { NODE_ENV: "production", ONBOARD_SETUP_KEY: KEY };

  it("accepts the key", () => {
    expect(isOnboardSetupKey(KEY, env)).toBe(true);
  });

  it("refuses anything else, including a prefix, a suffix and a near miss", () => {
    for (const candidate of [KEY.slice(1), `${KEY}k`, KEY.toUpperCase(), "", " "]) {
      expect(isOnboardSetupKey(candidate, env)).toBe(false);
    }
  });

  it("refuses what a request can carry that is not a string", () => {
    expect(isOnboardSetupKey(undefined, env)).toBe(false);
    expect(isOnboardSetupKey(null, env)).toBe(false);
    expect(isOnboardSetupKey([KEY, KEY], env)).toBe(false);
    expect(isOnboardSetupKey(new Blob([KEY]), env)).toBe(false);
  });

  it("refuses everything when the door is shut, the empty string included", () => {
    const shut = { NODE_ENV: "production" };
    expect(isOnboardSetupKey("", shut)).toBe(false);
    expect(isOnboardSetupKey(DEV_ONBOARD_SETUP_KEY, shut)).toBe(false);
  });
});

describe("the setup link in telemetry", () => {
  it("never carries the key", () => {
    const href = `/onboard?${ONBOARD_SETUP_PARAM}=${KEY}&error=email_taken`;
    const redacted = redactCapabilityUrl(href);
    expect(redacted).not.toContain(KEY);
    expect(redacted).toContain("error=email_taken");
  });
});
