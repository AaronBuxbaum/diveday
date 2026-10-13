import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = {
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(() => "event-id"),
  captureMessage: vi.fn(() => "message-id"),
};

/** The wrapper with a DSN (or none), and the SDK import counted. */
async function load(dsn: string | undefined, sdkModule: () => unknown = () => sdk) {
  vi.resetModules();
  const imported = vi.fn(sdkModule);
  vi.doMock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: dsn }));
  vi.doMock("@sentry/nextjs", async () => imported() as never);
  const { sentry } = await import("./sentry");
  return { sentry, imported };
}

afterEach(() => {
  vi.doUnmock("@/lib/sentry-dsn");
  vi.doUnmock("@sentry/nextjs");
  vi.clearAllMocks();
});

describe("sentry, loaded on first use", () => {
  it("never imports the SDK without a DSN, and reports nothing", async () => {
    const { sentry, imported } = await load(undefined);
    expect(await sentry.captureCheckIn({ monitorSlug: "m", status: "in_progress" })).toBe(
      undefined,
    );
    expect(await sentry.captureException(new Error("x"))).toBe(undefined);
    expect(imported).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("imports the SDK once with a DSN and hands back what it answers", async () => {
    const { sentry, imported } = await load("https://key@sentry.invalid/1");
    expect(await sentry.captureCheckIn({ monitorSlug: "m", status: "in_progress" })).toBe(
      "check-in-id",
    );
    expect(await sentry.captureMessage("hello", { level: "warning" })).toBe("message-id");
    expect(await sentry.captureException(new Error("x"), { tags: { a: "b" } })).toBe("event-id");
    expect(imported).toHaveBeenCalledTimes(1);
    expect(sdk.captureMessage).toHaveBeenCalledWith("hello", { level: "warning" });
  });

  it("reports nothing and throws nothing when the SDK cannot load", async () => {
    const { sentry } = await load("https://key@sentry.invalid/1", () => {
      throw new Error("module missing");
    });
    await expect(sentry.captureException(new Error("x"))).resolves.toBe(undefined);
  });

  it("tries the import again after a failed load", async () => {
    let attempt = 0;
    const { sentry, imported } = await load("https://key@sentry.invalid/1", () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return sdk;
    });
    expect(await sentry.captureException(new Error("x"))).toBe(undefined);
    expect(await sentry.captureException(new Error("y"))).toBe("event-id");
    expect(imported).toHaveBeenCalledTimes(2);
  });
});

describe("reportScrubbedError", () => {
  it("sends a stand-in with the caller's words, the class and cause tokens, never the message", async () => {
    await load("https://key@sentry.invalid/1");
    const { reportScrubbedError } = await import("./sentry");
    const leaky = new Error("insert failed for nora@example.com", {
      cause: Object.assign(new Error("dup"), { name: "DatabaseError", code: "23505" }),
    });
    await reportScrubbedError(leaky, { name: "XError", message: "X failed", tags: { a: "b" } });
    const [sent, context] = sdk.captureException.mock.calls[0] as unknown as [Error, unknown];
    expect(sent.name).toBe("XError");
    expect(sent.message).toBe("X failed");
    expect(sent.cause).toBeUndefined();
    expect(sent.stack).not.toContain("nora@example.com");
    expect(context).toEqual({
      tags: { a: "b", error_class: "Error", cause_name: "DatabaseError", cause_code: "23505" },
    });
  });
});
