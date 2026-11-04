import { describe, expect, it, vi } from "vitest";
import { cronUrl, dispatch } from "./cron-dispatcher-handler";

const secret = "cron-secret-value";

describe("cronUrl", () => {
  it("accepts only a cron route path", () => {
    expect(cronUrl("https://www.dive.day", "/api/cron/shop-tick")).toBe(
      "https://www.dive.day/api/cron/shop-tick",
    );
    expect(() => cronUrl("http://www.dive.day", "/api/cron/usage")).toThrow("https");
    for (const bad of ["/api/cron/../x", "/api/other", "//evil.test/api/cron/x", undefined, 4]) {
      expect(() => cronUrl("https://www.dive.day", bad)).toThrow();
    }
  });
});

describe("dispatch", () => {
  const base = { origin: "https://www.dive.day", timeoutMs: 1000, readSecret: async () => secret };

  it("sends the bearer token and returns the status", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(dispatch({ path: "/api/cron/usage" }, { ...base, fetchFn })).resolves.toEqual({
      status: 200,
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.dive.day/api/cron/usage");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${secret}`);
  });

  it("throws on a non-2xx answer so the Errors metric counts it", async () => {
    const fetchFn = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(dispatch({ path: "/api/cron/usage" }, { ...base, fetchFn })).rejects.toThrow(
      "503",
    );
  });

  it("never calls out for a path outside /api/cron/", async () => {
    const fetchFn = vi.fn();
    await expect(dispatch({ path: "/api/webhooks/sms" }, { ...base, fetchFn })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
