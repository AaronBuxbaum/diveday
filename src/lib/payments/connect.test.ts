import { describe, expect, it, vi } from "vitest";
import { connectProviderFromEnvironment, stripeConnectCallbackUrl } from "./connect";

function providerWith(env: Record<string, string | undefined>, fetchImpl: unknown) {
  return connectProviderFromEnvironment(env, fetchImpl as typeof fetch);
}

const configuredEnv = { STRIPE_SECRET_KEY: "sk_test", STRIPE_CONNECT_CLIENT_ID: "ca_test" };

describe("stripe connect provider", () => {
  it("uses one fixed callback for every shop", () => {
    expect(stripeConnectCallbackUrl("https://dive.day")).toBe(
      "https://dive.day/api/stripe/connect/callback",
    );
  });

  it("has no authorize URL and reports not_configured when unset", async () => {
    const provider = providerWith({}, vi.fn());
    expect(provider.authorizeUrl({ redirectUri: "https://x/cb", state: "s" })).toBeNull();
    expect(await provider.exchangeCode("code", "https://x/cb")).toEqual({
      status: "not_configured",
    });
    expect(await provider.retrieveAccountStatus("acct_1")).toEqual({ status: "not_configured" });
    expect(await provider.deauthorize("acct_1")).toEqual({ status: "not_configured" });
  });

  it("builds a Standard OAuth authorize URL", () => {
    const provider = providerWith(configuredEnv, vi.fn());
    const url = provider.authorizeUrl({ redirectUri: "https://shop.example/cb", state: "abc123" });
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("ca_test");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://shop.example/cb");
    expect(parsed.searchParams.get("state")).toBe("abc123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges an OAuth code for a connected account id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stripe_user_id: "acct_123" }),
    });
    const provider = providerWith(configuredEnv, fetchImpl);
    const result = await provider.exchangeCode("code-abc", "https://shop.example/cb");
    expect(result).toEqual({ status: "connected", stripeAccountId: "acct_123" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://connect.stripe.com/oauth/token");
    expect(init.body).toContain("code=code-abc");
    expect(init.body).toContain("grant_type=authorization_code");
  });

  it("fails the exchange on a non-ok response or network error", async () => {
    const notOk = providerWith(
      configuredEnv,
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    expect(await notOk.exchangeCode("code", "https://x/cb")).toEqual({ status: "failed" });

    const threw = providerWith(configuredEnv, vi.fn().mockRejectedValue(new Error("network")));
    expect(await threw.exchangeCode("code", "https://x/cb")).toEqual({ status: "failed" });
  });

  it("retrieves connected account status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      }),
    });
    const provider = providerWith(configuredEnv, fetchImpl);
    const result = await provider.retrieveAccountStatus("acct_123");
    expect(result).toEqual({
      status: "ok",
      account: { chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.stripe.com/v1/accounts/acct_123");
  });

  it("deauthorizes a connected account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const provider = providerWith(configuredEnv, fetchImpl);
    expect(await provider.deauthorize("acct_123")).toEqual({ status: "ok" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://connect.stripe.com/oauth/deauthorize");
    expect(init.body).toContain("stripe_user_id=acct_123");
  });
});
