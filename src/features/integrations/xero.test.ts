import { describe, expect, it } from "vitest";
import {
  exchangeXeroCode,
  fetchXeroTenant,
  xeroAuthorizationUrl,
  xeroBankTransaction,
  xeroConfigFromEnvironment,
} from "./xero";

const CONFIG = { clientId: "client", clientSecret: "secret" };

const payload = {
  orderId: "order-1",
  customer: { id: "person-1", name: "Diver One", email: "diver@example.test" },
  currency: "usd",
  totalCents: 12_500,
  refundedCents: 2_500,
  refundCents: 2_500,
  createdAt: "2026-08-25T12:00:00.000Z",
  lineItems: [{ description: "Two-tank reef", quantity: 1, unitAmountCents: 12_500 }],
};

const CODES = { salesAccountCode: "200", bankAccountCode: "090" };

describe("Xero configuration", () => {
  it("is absent until both halves of the app registration are set", () => {
    expect(xeroConfigFromEnvironment({})).toBeNull();
    expect(xeroConfigFromEnvironment({ XERO_CLIENT_ID: "client" })).toBeNull();
    expect(
      xeroConfigFromEnvironment({ XERO_CLIENT_ID: " ", XERO_CLIENT_SECRET: "secret" }),
    ).toBeNull();
    expect(
      xeroConfigFromEnvironment({ XERO_CLIENT_ID: "client", XERO_CLIENT_SECRET: "secret" }),
    ).toEqual(CONFIG);
  });
});

describe("Xero authorization", () => {
  it("asks for a refresh token and the two narrow accounting scopes", () => {
    const url = new URL(
      xeroAuthorizationUrl({
        config: CONFIG,
        state: "opaque-state",
        redirectUri: "https://dive.day/api/integrations/xero/callback",
      }),
    );
    expect(url.hostname).toBe("login.xero.com");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "accounting.contacts",
      "accounting.transactions",
      "offline_access",
    ]);
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://dive.day/api/integrations/xero/callback",
    );
  });

  it("reports a refused exchange as a code rather than throwing", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;
    expect(
      await exchangeXeroCode(
        { config: CONFIG, code: "abc", redirectUri: "https://dive.day/cb" },
        fetchImpl,
      ),
    ).toEqual({ status: "failed", code: "xero_exchange_refused" });
  });

  it("refuses a token response with no refresh token, so a dead connection is never saved", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "access", expires_in: 1800 }),
    })) as unknown as typeof fetch;
    expect(
      await exchangeXeroCode(
        { config: CONFIG, code: "abc", redirectUri: "https://dive.day/cb" },
        fetchImpl,
      ),
    ).toEqual({ status: "failed", code: "xero_exchange_invalid" });
  });
});

describe("Xero tenant lookup", () => {
  const credentials = { accessToken: "access", refreshToken: "refresh", expiresAt: 0 };

  it("takes the organisation the shop authorized", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "c1",
          tenantId: "3b1f5b3a-0f4b-4b7a-9f2e-6c1d9a4e77c2",
          tenantName: "Blue Mantis Diving",
          tenantType: "ORGANISATION",
        },
      ],
    })) as unknown as typeof fetch;
    expect(await fetchXeroTenant(credentials, fetchImpl)).toEqual({
      status: "ok",
      tenantId: "3b1f5b3a-0f4b-4b7a-9f2e-6c1d9a4e77c2",
      tenantName: "Blue Mantis Diving",
    });
  });

  /**
   * The id becomes an `xero-tenant-id` header on every later write, and a header
   * value carrying a newline makes `fetch` throw rather than answer — which this
   * module would read as a network failure and retry against forever. A grant
   * whose id is not a Xero id is refused at the door instead.
   */
  it("refuses a tenant id that is not shaped like one", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { id: "c1", tenantId: "tenant-1\r\nx-injected: 1", tenantType: "ORGANISATION" },
      ],
    })) as unknown as typeof fetch;
    expect(await fetchXeroTenant(credentials, fetchImpl)).toEqual({
      status: "failed",
      code: "xero_no_organisation",
    });
  });

  /** A practice-manager connection carries no organisation to write into. */
  it("refuses a grant with no organisation on it", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { id: "c1", tenantId: "3b1f5b3a-0f4b-4b7a-9f2e-6c1d9a4e77c2", tenantType: "PRACTICE" },
      ],
    })) as unknown as typeof fetch;
    expect(await fetchXeroTenant(credentials, fetchImpl)).toEqual({
      status: "failed",
      code: "xero_no_organisation",
    });
  });
});

describe("Xero bank transactions", () => {
  it("writes a sale as money received against the shop's own two account codes", () => {
    const transaction = xeroBankTransaction(payload, "contact-1", { ...CODES, type: "RECEIVE" });
    expect(transaction.Type).toBe("RECEIVE");
    expect(transaction.Contact).toEqual({ ContactID: "contact-1" });
    expect(transaction.BankAccount).toEqual({ Code: "090" });
    expect(transaction.CurrencyCode).toBe("USD");
    expect(transaction.Date).toBe("2026-08-25");
    expect(transaction.LineItems[0]).toEqual({
      Description: "Two-tank reef",
      Quantity: 1,
      UnitAmount: 125,
      AccountCode: "200",
    });
  });

  /**
   * The slice, never the running total. An order refunded twice emits one event
   * per slice carrying that slice's delta; posting `refundedCents` would put the
   * whole refund out of the bank account a second time.
   */
  it("spends only the current refund delta", () => {
    const transaction = xeroBankTransaction(
      { ...payload, refundCents: 2_500, refundedCents: 8_000 },
      "contact-1",
      { ...CODES, type: "SPEND" },
    );
    expect(transaction.Type).toBe("SPEND");
    expect(transaction.LineItems).toHaveLength(1);
    expect(transaction.LineItems[0]?.UnitAmount).toBe(25);
    expect(transaction.Reference).toContain("order-1");
  });

  it("carries no tax treatment DiveDay does not know", () => {
    expect(
      xeroBankTransaction(payload, "contact-1", { ...CODES, type: "RECEIVE" }).LineAmountTypes,
    ).toBe("NoTax");
  });
});
