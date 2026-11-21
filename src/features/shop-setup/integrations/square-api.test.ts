import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import {
  exchangeSquareCode,
  listSquareLocations,
  readSquareReceipt,
  refreshSquareToken,
  SQUARE_SCOPES,
  squareAuthorizationUrl,
  squareConfigFromEnvironment,
} from "./square-api";

const config = {
  clientId: "test-client",
  clientSecret: "test-secret",
  environment: "sandbox" as const,
};
const reply = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
const payment = {
  id: "payment-1",
  location_id: "location-1",
  status: "COMPLETED",
  total_money: { amount: 1200, currency: "USD" },
  tip_money: { amount: 200, currency: "USD" },
};

describe("Square read-only API", () => {
  it("requires an explicit environment and asks only for receipts and locations", () => {
    expect(
      squareConfigFromEnvironment({ SQUARE_CLIENT_ID: "id", SQUARE_CLIENT_SECRET: "secret" }),
    ).toBeNull();
    const url = new URL(
      squareAuthorizationUrl({
        config,
        state: "state",
        redirectUri: "https://dive.day/api/integrations/square/callback",
      }),
    );
    expect(url.origin).toBe("https://connect.squareupsandbox.com");
    expect(url.searchParams.get("scope")).toBe(SQUARE_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toContain("WRITE");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("session")).toBe("false");
  });
  it("exchanges and refreshes tokens only against the selected environment", async () => {
    const fetchImpl = reply({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_at: new Date(nowMs() + 3600000).toISOString(),
      merchant_id: "merchant-1",
    });
    expect(
      await exchangeSquareCode(
        { config, code: "test-code", redirectUri: "https://dive.day/callback" },
        fetchImpl,
      ),
    ).toMatchObject({ merchantId: "merchant-1" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://connect.squareupsandbox.com/oauth2/token",
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      grant_type: "authorization_code",
      redirect_uri: "https://dive.day/callback",
    });
    await refreshSquareToken(config, "test-refresh", fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "test-refresh",
    });
    expect(
      await refreshSquareToken(config, "test-refresh", reply({ access_token: "leak" })),
    ).toBeNull();
  });
  it("keeps only minimal evidence, preserving integer minor units including JPY", async () => {
    const fetchImpl = reply({
      payment: {
        ...payment,
        card_details: { card: { last_4: "1234" } },
        buyer_email_address: "private@example.com",
        receipt_url: "https://unsafe.example/receipt",
      },
    });
    expect(await readSquareReceipt(config, "access", "payment-1", fetchImpl)).toEqual({
      paymentId: "payment-1",
      locationId: "location-1",
      status: "COMPLETED",
      currency: "usd",
      totalCents: 1200,
      tipCents: 200,
      refundedCents: 0,
      receiptNumber: null,
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBeUndefined();
    const yen = await readSquareReceipt(
      config,
      "access",
      "payment-1",
      reply({
        payment: {
          ...payment,
          total_money: { amount: 1000, currency: "JPY" },
          tip_money: undefined,
        },
      }),
    );
    expect(yen).toMatchObject({ currency: "jpy", totalCents: 1000 });
  });
  it("refuses malformed, mismatched and non-integer money instead of rounding it", async () => {
    for (const modified of [
      { total_money: { amount: 1.5, currency: "USD" } },
      { total_money: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" } },
      { refunded_money: { amount: 1300, currency: "USD" } },
      { tip_money: { amount: 100, currency: "EUR" } },
      { id: "another-payment" },
    ]) {
      expect(
        await readSquareReceipt(
          config,
          "access",
          "payment-1",
          reply({ payment: { ...payment, ...modified } }),
        ),
      ).toBeNull();
    }
    const fetchImpl = reply({ payment });
    expect(await readSquareReceipt(config, "access", "../oauth2/token", fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("never returns provider error details or inactive locations", async () => {
    expect(
      await readSquareReceipt(
        config,
        "access",
        "payment-1",
        reply({ errors: [{ detail: "secret" }] }, 401),
      ),
    ).toBeNull();
    expect(
      await listSquareLocations(
        config,
        "access",
        reply({
          locations: [
            { id: "l1", name: "Counter", merchant_id: "m1", currency: "USD", status: "ACTIVE" },
            { id: "l2", name: "Closed", merchant_id: "m1", currency: "USD", status: "INACTIVE" },
          ],
        }),
      ),
    ).toEqual([{ id: "l1", name: "Counter", merchantId: "m1", currency: "usd" }]);
  });
});
