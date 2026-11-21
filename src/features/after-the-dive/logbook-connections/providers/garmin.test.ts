import { describe, expect, it, vi } from "vitest";
import type { LogbookProviderConfig, LogbookTokens } from "../provider";
import { garminProvider } from "./garmin";

const config: LogbookProviderConfig = {
  clientId: "client",
  clientSecret: "never-log-secret",
  redirectUri: "https://dive.day/api/logbook/garmin/callback",
  garminTokenHost: "diauth",
};
const verifier = "a".repeat(43);
const response = {
  access_token: "documented-opaque-access",
  refresh_token: "rotated-refresh",
  token_type: "bearer",
  expires_in: 86400,
  refresh_token_expires_in: 7775998,
  scope: "PARTNER_READ CONNECT_READ",
};
const tokens: LogbookTokens = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresInSeconds: 100,
  scope: [],
};

describe("Garmin documented partner OAuth", () => {
  it("uses the fixed consent host, S256, state and matching redirect without secrets or scopes", () => {
    const url = new URL(
      garminProvider.authorizationUrl(config, { state: "opaque-state", codeChallenge: verifier }),
    );
    expect(url.origin + url.pathname).toBe("https://connect.garmin.com/oauth2Confirm");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client",
      redirect_uri: config.redirectUri,
      state: "opaque-state",
      code_challenge: verifier,
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it.each([undefined, "other", "diauth.garmin.com", "https://attacker.test"])(
    "rejects an absent or unapproved token host %s before sending credentials",
    async (host) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        garminProvider.exchangeCode(
          { ...config, garminTokenHost: host as LogbookProviderConfig["garminTokenHost"] },
          { code: "code", codeVerifier: verifier },
          fetcher,
        ),
      ).rejects.toMatchObject({ code: "invalid_configuration" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["diauth", "connectapi"] as const)(
    "exchanges only on the explicitly configured %s host and form contract",
    async (host) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
      expect(
        await garminProvider.exchangeCode(
          { ...config, garminTokenHost: host },
          { code: "code+/=", codeVerifier: verifier },
          fetcher,
        ),
      ).toEqual({
        accessToken: response.access_token,
        refreshToken: "rotated-refresh",
        expiresInSeconds: 86400,
        refreshExpiresInSeconds: 7775998,
        scope: ["PARTNER_READ", "CONNECT_READ"],
      });
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(`https://${host}.garmin.com/di-oauth2-service/oauth/token`);
      expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
      expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
        grant_type: "authorization_code",
        client_id: "client",
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code: "code+/=",
        code_verifier: verifier,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["", "a".repeat(42), "a".repeat(129), `${verifier}\n`, "+".repeat(43)])(
    "rejects an invalid PKCE verifier before any request",
    async (codeVerifier) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        garminProvider.exchangeCode(config, { code: "code", codeVerifier }, fetcher),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("replaces both tokens with the rotating refresh response without retaining the old token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const updated = await garminProvider.refresh(config, { refreshToken: "old-refresh" }, fetcher);
    expect(updated.refreshToken).toBe("rotated-refresh");
    expect(Object.fromEntries(fetcher.mock.calls[0][1]?.body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      client_id: "client",
      client_secret: config.clientSecret,
      refresh_token: "old-refresh",
    });
    expect(updated).not.toHaveProperty("old-refresh");
  });

  it("rejects a refresh response that would lose the next rotating refresh token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...response, refresh_token: undefined }));
    await expect(
      garminProvider.refresh(config, { refreshToken: "old-refresh" }, fetcher),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("reads stable identity and granted permissions separately from OAuth scopes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/id")
          ? Response.json({ userId: "stable-api-user" })
          : Response.json(["ACTIVITY_EXPORT", "HEALTH_EXPORT"]),
      );
    expect(await garminProvider.identify(config, tokens, fetcher)).toEqual({
      externalId: "stable-api-user",
      permissions: ["ACTIVITY_EXPORT", "HEALTH_EXPORT"],
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://apis.garmin.com/wellness-api/rest/user/id",
      "https://apis.garmin.com/wellness-api/rest/user/permissions",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toEqual({ Authorization: "Bearer old-access" });
    }
  });

  it.each([{}, { userId: "" }, { userId: 1 }])("rejects invalid identity %j", async (identity) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json(String(url).endsWith("/id") ? identity : []),
      );
    await expect(garminProvider.identify(config, tokens, fetcher)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each([{ permissions: ["ACTIVITY_EXPORT"] }, [null], ["unsafe\nheader"]])(
    "rejects unestablished permission wrappers or invalid entries %j",
    async (permissions) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url) =>
          Response.json(String(url).endsWith("/id") ? { userId: "user" } : permissions),
        );
      await expect(garminProvider.identify(config, tokens, fetcher)).rejects.toMatchObject({
        code: "invalid_response",
      });
    },
  );

  it("calls mandatory registration deletion and accepts an empty success response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await garminProvider.revoke(config, tokens, fetcher)).toEqual({
      remoteRevoked: true,
      manualRevocationRequired: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://apis.garmin.com/wellness-api/rest/user/registration",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer old-access" },
      }),
    );
  });

  it("does not claim completed revocation for an accepted asynchronous deletion", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(garminProvider.revoke(config, tokens, fetcher)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never reports a failed upstream deletion as successful local revocation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret", { status: 401 }));
    await expect(garminProvider.revoke(config, tokens, fetcher)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
