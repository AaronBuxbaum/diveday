import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const captureRequestError = vi.fn();

vi.mock("@sentry/nextjs", () => ({ init, captureRequestError }));

describe("initSentry", () => {
  beforeEach(() => {
    init.mockClear();
  });

  it("does nothing without a DSN", async () => {
    const { initSentry } = await import("./observability-sentry");
    initSentry({});
    expect(init).not.toHaveBeenCalled();
  });

  it("does nothing with a blank DSN", async () => {
    const { initSentry } = await import("./observability-sentry");
    initSentry({ NEXT_PUBLIC_SENTRY_DSN: "   " });
    expect(init).not.toHaveBeenCalled();
  });

  it("initializes with the DSN, errors-only sampling, and both redaction hooks", async () => {
    const { initSentry } = await import("./observability-sentry");
    initSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://key@sentry.example/1", NODE_ENV: "production" });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@sentry.example/1",
        environment: "production",
        tracesSampleRate: 0,
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );
  });
});

describe("onRequestError", () => {
  it("is Sentry's captureRequestError adapter", async () => {
    const { onRequestError } = await import("./observability-sentry");
    expect(onRequestError).toBe(captureRequestError);
  });
});

describe("redactEvent", () => {
  it("redacts a capability token in the request URL", async () => {
    const { redactEvent } = await import("./observability-sentry");
    const event = redactEvent({
      type: undefined,
      request: { url: "https://app.example/waivers/abc123.def456" },
    });
    expect(event.request?.url).toBe("/waivers/[token]");
  });

  it("redacts a capability token in the referer header", async () => {
    const { redactEvent } = await import("./observability-sentry");
    const event = redactEvent({
      type: undefined,
      request: { headers: { Referer: "https://app.example/ready/abc123.def456" } },
    });
    expect(event.request?.headers?.Referer).toBe("/ready/[token]");
  });

  it("leaves an event with no request untouched", async () => {
    const { redactEvent } = await import("./observability-sentry");
    expect(redactEvent({ type: undefined })).toEqual({ type: undefined });
  });
});

describe("redactBreadcrumb", () => {
  it("redacts navigation from/to URLs", async () => {
    const { redactBreadcrumb } = await import("./observability-sentry");
    const breadcrumb = redactBreadcrumb({
      category: "navigation",
      data: { from: "/recap/abc123.def456", to: "/shop/blue-hole/schedule" },
    });
    expect(breadcrumb.data?.from).toBe("/recap/[token]");
    expect(breadcrumb.data?.to).toBe("/shop/blue-hole/schedule");
  });

  it("redacts an xhr/fetch breadcrumb URL", async () => {
    const { redactBreadcrumb } = await import("./observability-sentry");
    const breadcrumb = redactBreadcrumb({
      category: "fetch",
      data: { url: "/verify/abc123.def456" },
    });
    expect(breadcrumb.data?.url).toBe("/verify/[token]");
  });

  it("leaves an unrelated breadcrumb untouched", async () => {
    const { redactBreadcrumb } = await import("./observability-sentry");
    const breadcrumb = redactBreadcrumb({ category: "console", data: { message: "hi" } });
    expect(breadcrumb.data?.message).toBe("hi");
  });

  it("leaves a breadcrumb with no data untouched", async () => {
    const { redactBreadcrumb } = await import("./observability-sentry");
    expect(redactBreadcrumb({ category: "navigation" })).toEqual({ category: "navigation" });
  });
});
