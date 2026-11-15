import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { LogbookTokens } from "../provider";
import { suuntoProvider } from "./suunto";

const config = {
  clientId: "client",
  clientSecret: "private-secret",
  redirectUri: "https://dive.day/api/logbook/suunto/callback",
};
function tokenFor(claims: unknown): string {
  return `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}
const tokens: LogbookTokens = {
  accessToken: tokenFor({ user: "authorized-account" }),
  refreshToken: "refresh",
  expiresInSeconds: 86400,
  scope: ["workout"],
};

describe("Suunto publicly documented OAuth subset", () => {
  it("uses fixed authorization host and state but never claims undocumented PKCE", () => {
    const url = new URL(
      suuntoProvider.authorizationUrl(config, { state: "state", codeChallenge: "unused" }),
    );
    expect(url.origin + url.pathname).toBe("https://cloudapi-oauth.suunto.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client",
      redirect_uri: config.redirectUri,
      state: "state",
    });
    expect(url.toString()).not.toContain(config.clientSecret);
  });

  it("uses Basic client authentication and the exact documented exchange form", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: tokens.accessToken,
        refresh_token: "refresh",
        expires_in: 86400,
        token_type: "bearer",
        scope: "workout",
      }),
    );
    expect(
      await suuntoProvider.exchangeCode(config, { code: "authorization-code" }, fetcher),
    ).toEqual(tokens);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://cloudapi-oauth.suunto.com/oauth/token");
    expect(init?.headers).toEqual({
      Authorization: `Basic ${Buffer.from("client:private-secret").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code: "authorization-code",
    });
  });

  it("accepts an access-only grant without inventing a refresh token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: tokens.accessToken,
        token_type: "bearer",
        expires_in: 86400,
        scope: "workout",
      }),
    );
    expect(await suuntoProvider.exchangeCode(config, { code: "code" }, fetcher)).toEqual({
      ...tokens,
      refreshToken: null,
    });
  });

  it("rejects a malformed refresh token even when refresh is optional", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: tokens.accessToken,
        token_type: "bearer",
        expires_in: 86400,
        scope: "workout",
        refresh_token: "",
      }),
    );
    await expect(
      suuntoProvider.exchangeCode(config, { code: "code" }, fetcher),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects missing workout scope rather than implying dive access", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: tokens.accessToken,
        refresh_token: "refresh",
        expires_in: 86400,
        token_type: "bearer",
        scope: "other",
      }),
    );
    await expect(
      suuntoProvider.exchangeCode(config, { code: "code" }, fetcher),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("extracts only the documented user correlation claim without a network identity guess", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await suuntoProvider.identify(config, tokens, fetcher)).toEqual({
      externalId: "authorized-account",
      permissions: ["workout"],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "opaque-token",
    "a.b.c.d",
    "a.!.c",
    tokenFor({ sub: "not-the-documented-claim" }),
    tokenFor({ user: 10 }),
    tokenFor({ user: "" }),
    tokenFor({ user: "x".repeat(513) }),
    tokenFor({ user: "injected\naccount" }),
    tokenFor({ user: "user", padding: "a".repeat(8200) }),
    "a._w.c",
    "a.e30=.c",
  ])("rejects malformed or oversized identity claims", async (accessToken) => {
    await expect(suuntoProvider.identify(config, { ...tokens, accessToken })).rejects.toMatchObject(
      { code: "invalid_response" },
    );
  });

  it("does not invent refresh or revocation endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      suuntoProvider.refresh(config, { refreshToken: "refresh" }, fetcher),
    ).rejects.toMatchObject({ code: "documentation_required" });
    expect(await suuntoProvider.revoke(config, tokens, fetcher)).toEqual({
      remoteRevoked: false,
      manualRevocationRequired: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
