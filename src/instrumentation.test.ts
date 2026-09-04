import { afterEach, describe, expect, it, vi } from "vitest";
import { log, setLogSink } from "@/lib/log";
import { register } from "./instrumentation";

const recordLogLine = vi.fn();

vi.mock("@/lib/observability", () => ({
  recordLogLine: (line: string, timestamp: number) => recordLogLine(line, timestamp),
  setFlushDeferrer: () => {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
  recordLogLine.mockClear();
  setLogSink(null);
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

  /**
   * `src/lib/log.ts` used to reach the CloudWatch shipper by static import, and
   * that import was the seam putting `@aws-sdk/client-cloudwatch-logs` in the
   * browser — 93.7 KB gzip, cached by the offline-manifest service worker, via
   * `src/i18n/on-error.ts`, which every translator carries. Inverting it moved
   * a guarantee the module graph used to make into one this function makes, so
   * it needs a test: drop the `setLogSink` call and every structured log line
   * silently stops reaching CloudWatch, with the console write still there to
   * make it look fine.
   */
  it("installs the CloudWatch sink, so log lines still ship after the response", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});

    log("test.before_register", "info");
    expect(recordLogLine).not.toHaveBeenCalled();

    await register();
    log("test.after_register", "info", { shopId: "s1" });

    expect(recordLogLine).toHaveBeenCalledTimes(1);
    expect(recordLogLine.mock.calls[0]?.[0]).toContain('"event":"test.after_register"');
  });

  it("does not install the sink outside the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await register();
    log("test.edge", "info");

    expect(recordLogLine).not.toHaveBeenCalled();
  });
});
