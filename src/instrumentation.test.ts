import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register", () => {
  it("does nothing outside the nodejs runtime", () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_HOST", "not a url");
    expect(() => register()).not.toThrow();
  });

  it("does nothing when APP_HOST is unset", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "");
    expect(() => register()).not.toThrow();
  });

  it("throws with a precise reason when APP_HOST is malformed", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "http://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => register()).toThrow(/Invalid APP_HOST configuration/);
  });

  it("does not throw for a valid HTTPS origin", () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => register()).not.toThrow();
  });
});
