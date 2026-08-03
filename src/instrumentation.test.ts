import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("register", () => {
  it("does nothing outside the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_HOST", "not a url");
    await expect(register()).resolves.toBeUndefined();
  });

  it("does nothing when APP_HOST is unset", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "");
    await expect(register()).resolves.toBeUndefined();
  });

  it("throws with a precise reason when APP_HOST is malformed", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "http://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    await expect(register()).rejects.toThrow(/Invalid APP_HOST configuration/);
  });

  it("does not throw for a valid HTTPS origin", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    await expect(register()).resolves.toBeUndefined();
  });
});
