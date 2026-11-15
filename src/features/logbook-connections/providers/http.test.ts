import { afterEach, describe, expect, it, vi } from "vitest";
import { LogbookProviderError } from "../provider";
import { providerRequest, tokenResponse, validateConfig } from "./http";

const endpoint = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const validTokens = {
  access_token: "access",
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 86400,
  scope: "PARTNER_READ",
};

afterEach(() => vi.useRealTimers());

describe("bounded OAuth provider transport", () => {
  it.each([
    "http://diauth.garmin.com/di-oauth2-service/oauth/token",
    `${endpoint}?access_token=secret`,
    `${endpoint}/extra`,
    "https://diauth.garmin.com.attacker.test/di-oauth2-service/oauth/token",
    "https://attacker.test/token",
  ])("rejects unlisted outbound URLs without forwarding secrets", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(providerRequest(url, {}, fetcher)).rejects.toMatchObject({
      code: "invalid_configuration",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [400, "provider_rejected"],
    [302, "provider_rejected"],
  ])("sanitizes HTTP %s and performs no retries", async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private-token private-body https://private-url.test", {
        status: Number(status),
      }),
    );
    const error = await providerRequest(endpoint, {}, fetcher).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(LogbookProviderError);
    expect(error).toMatchObject({ code, message: code });
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("private");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sanitizes network errors and disables redirects, cache, cookies and referrers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("secret https://secret.test"));
    await expect(providerRequest(endpoint, {}, fetcher)).rejects.toMatchObject({
      code: "network_error",
      message: "network_error",
    });
    expect(fetcher).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("rejects redirected responses even when an injected fetcher ignores redirect:error", async () => {
    const response = Response.json({ access_token: "secret" });
    Object.defineProperty(response, "redirected", { value: true });
    await expect(
      providerRequest(endpoint, {}, vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: "provider_rejected" });
  });

  it.each([
    new Response("not JSON"),
    new Response(new Uint8Array([0xff])),
    new Response("{}", { headers: { "content-length": "65537" } }),
    new Response("{}", { headers: { "content-length": "invalid" } }),
    new Response("x".repeat(65537)),
  ])("rejects malformed, invalid UTF-8 and oversized response bodies", async (response) => {
    await expect(
      providerRequest(endpoint, {}, vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("bounds streamed bytes without trusting content-length and cancels on overflow", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(40000));
          controller.enqueue(new Uint8Array(40000));
        },
        cancel,
      }),
      { headers: { "content-length": "1" } },
    );
    await expect(
      providerRequest(endpoint, {}, vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("times out an unresponsive fetch after 10 seconds even if it ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const result = providerRequest(endpoint, {}, fetcher);
    const assertion = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active after headers while a response body stalls", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start() {}, cancel }));
    const result = providerRequest(endpoint, {}, vi.fn<typeof fetch>().mockResolvedValue(response));
    const assertion = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("OAuth response and configuration validation", () => {
  it.each([
    null,
    [],
    { ...validTokens, access_token: "" },
    { ...validTokens, access_token: "x".repeat(16385) },
    { ...validTokens, access_token: "token\r\nAuthorization:injected" },
    { ...validTokens, refresh_token: null },
    { ...validTokens, token_type: "mac" },
    { ...validTokens, expires_in: "86400" },
    { ...validTokens, expires_in: 0 },
    { ...validTokens, expires_in: -1 },
    { ...validTokens, expires_in: 0.1 },
    { ...validTokens, expires_in: Number.MAX_SAFE_INTEGER },
    { ...validTokens, scope: ["PARTNER_READ"] },
    { ...validTokens, scope: "x".repeat(4097) },
    { ...validTokens, scope: "unsafe\nvalue" },
    { ...validTokens, refresh_token_expires_in: 0 },
  ])("rejects invalid token contracts without including response values", (response) => {
    expect(() => tokenResponse(response, true)).toThrowError("invalid_response");
  });

  it("uses response expiries and accepts documented case-insensitive bearer type", () => {
    expect(tokenResponse({ ...validTokens, token_type: "Bearer", expires_in: 1234 }, true)).toEqual(
      {
        accessToken: "access",
        refreshToken: "refresh",
        expiresInSeconds: 1234,
        scope: ["PARTNER_READ"],
      },
    );
  });

  it.each([
    "http://dive.day/callback",
    "https://secret:password@dive.day/callback",
    "https://dive.day/callback#secret",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects unsafe redirect configuration without exposing it", (redirectUri) => {
    expect(() =>
      validateConfig({ clientId: "client", clientSecret: "secret", redirectUri }),
    ).toThrow("invalid_configuration");
  });
});
