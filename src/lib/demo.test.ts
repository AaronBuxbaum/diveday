import { describe, expect, it } from "vitest";
import { isDemoMode } from "./demo";

describe("isDemoMode", () => {
  it("is on outside production by default", () => {
    expect(isDemoMode({ NODE_ENV: "development" })).toBe(true);
    expect(isDemoMode({ NODE_ENV: "test" })).toBe(true);
    expect(isDemoMode({})).toBe(true);
  });

  it("is off in production by default", () => {
    expect(isDemoMode({ NODE_ENV: "production" })).toBe(false);
  });

  it("honours an explicit opt-in in production", () => {
    for (const flag of ["1", "true", "on", "TRUE", " On "]) {
      expect(isDemoMode({ NODE_ENV: "production", SCUBA_DEMO: flag })).toBe(true);
    }
  });

  it("honours an explicit opt-out outside production", () => {
    for (const flag of ["0", "false", "off", "OFF"]) {
      expect(isDemoMode({ NODE_ENV: "development", SCUBA_DEMO: flag })).toBe(false);
    }
  });

  it("falls back to the NODE_ENV default for an unrecognised flag", () => {
    expect(isDemoMode({ NODE_ENV: "production", SCUBA_DEMO: "maybe" })).toBe(false);
    expect(isDemoMode({ NODE_ENV: "development", SCUBA_DEMO: "" })).toBe(true);
  });
});
