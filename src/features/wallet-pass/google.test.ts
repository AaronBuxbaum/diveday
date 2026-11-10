// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateWalletTestCredentials, walletContentFixture } from "@/test/wallet-credentials";
import { ensureGoogleClass, pushGoogleObject } from "./google";

const generated = generateWalletTestCredentials();
beforeEach(() => {
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "12345");
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    JSON.stringify({ client_email: "generated@test.invalid", private_key: generated.key }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google Wallet delivery", () => {
  it("uses the issuer-scoped JWT grant and accepts an existing generic class", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return url.includes("oauth2")
          ? Response.json({ access_token: "test-access" })
          : new Response(null, { status: 409 });
      }),
    );
    await ensureGoogleClass();
    const grant = new URLSearchParams(String(calls[0].init?.body));
    expect(grant.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const payload = JSON.parse(
      Buffer.from((grant.get("assertion") ?? "").split(".")[1], "base64url").toString(),
    );
    expect(payload.scope).toBe("https://www.googleapis.com/auth/wallet_object.issuer");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ id: "12345.diveday-departure" });
    expect(calls[1].init?.headers).toMatchObject({ Authorization: "Bearer test-access" });
  });
  it("PATCHes the changed object and creates it if the pass was never saved", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("oauth2")) return Response.json({ access_token: "test-access" });
        return new Response(null, { status: init?.method === "PATCH" ? 404 : 200 });
      }),
    );
    await pushGoogleObject(
      "12345.generated",
      { ...walletContentFixture(), voided: true },
      new Date("2026-07-20T00:00:00Z"),
      "es-ES",
    );
    expect(calls[1].init?.method).toBe("PATCH");
    expect(calls[2].init?.method).toBe("POST");
    const object = JSON.parse(String(calls[1].init?.body));
    expect(object).toMatchObject({
      state: "INACTIVE",
      cardTitle: { defaultValue: { language: "es-ES" } },
    });
    expect(object).not.toHaveProperty("barcode");
    expect(object).not.toHaveProperty("linksModuleData");
  });
  it("does not convert an issuer refusal into a successful delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("oauth2")
          ? Response.json({ access_token: "test-access" })
          : new Response(null, { status: 403 }),
      ),
    );
    await expect(
      pushGoogleObject(
        "12345.generated",
        walletContentFixture(),
        new Date("2026-07-20T00:00:00Z"),
        "en-US",
      ),
    ).rejects.toThrow("wallet_google_push_failed");
  });
});
