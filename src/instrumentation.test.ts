import { afterEach, describe, expect, it, vi } from "vitest";
import { SENTRY_DATA_COLLECTION } from "@/app/observability";
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

/**
 * **Errors only, and only the integrations that serves** (code review
 * 2026-10-11, item 22). The SDK is imported when a DSN is set and not before,
 * and it starts without its default integrations: no OpenTelemetry HTTP or
 * fetch instrumentation, console breadcrumbs or local variables for a server
 * whose traces sample rate is 0.
 */
describe("Sentry on the server", () => {
  const integrationNamed = (name: string) => () => ({ name });
  const sdk = () => ({
    init: vi.fn(),
    captureRequestError: vi.fn(),
    eventFiltersIntegration: integrationNamed("EventFilters"),
    functionToStringIntegration: integrationNamed("FunctionToString"),
    linkedErrorsIntegration: integrationNamed("LinkedErrors"),
    dedupeIntegration: integrationNamed("Dedupe"),
    requestDataIntegration: integrationNamed("RequestData"),
    onUncaughtExceptionIntegration: integrationNamed("OnUncaughtException"),
    onUnhandledRejectionIntegration: integrationNamed("OnUnhandledRejection"),
    contextLinesIntegration: integrationNamed("ContextLines"),
    nodeContextIntegration: integrationNamed("Context"),
  });

  afterEach(() => {
    vi.doUnmock("@sentry/nextjs");
    vi.doUnmock("@/lib/sentry-dsn");
    vi.resetModules();
  });

  async function instrumentationWith(dsn: string | null) {
    vi.resetModules();
    const fake = sdk();
    vi.doMock("@sentry/nextjs", () => fake);
    vi.doMock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: dsn }));
    return { fake, module: await import("./instrumentation") };
  }

  it("starts the SDK with its defaults off and the redaction hooks on", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("NODE_ENV", "production");
    const { fake, module } = await instrumentationWith("https://key@sentry.example.invalid/1");

    await module.register();

    expect(fake.init).toHaveBeenCalledTimes(1);
    const options = fake.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({ tracesSampleRate: 0, defaultIntegrations: false });
    // The SDK's own collection switch stays the first layer of redaction.
    expect(options.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
    const names = options.integrations.map((integration: { name: string }) => integration.name);
    expect(names).toEqual(
      expect.arrayContaining(["RequestData", "OnUncaughtException", "OnUnhandledRejection"]),
    );
    expect(names).not.toContain("Http");
  });

  it("starts nothing without a DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { fake, module } = await instrumentationWith(null);

    await module.register();

    expect(fake.init).not.toHaveBeenCalled();
  });

  it("hands a request error to the SDK only when a DSN is set", async () => {
    const args = [
      new Error("boom"),
      { path: "/", method: "GET", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/",
        routeType: "render",
        renderSource: "react-server-components",
        revalidateReason: undefined,
        renderType: "dynamic",
      },
    ] as const;
    const off = await instrumentationWith(null);
    await off.module.onRequestError(
      ...(args as unknown as Parameters<typeof off.module.onRequestError>),
    );
    expect(off.fake.captureRequestError).not.toHaveBeenCalled();

    const on = await instrumentationWith("https://key@sentry.example.invalid/1");
    await on.module.onRequestError(
      ...(args as unknown as Parameters<typeof on.module.onRequestError>),
    );
    expect(on.fake.captureRequestError).toHaveBeenCalledTimes(1);
  });
});
