import { describe, expect, it } from "vitest";
import {
  quickBooksAuthorizationUrl,
  quickBooksRefundReceipt,
  quickBooksSalesReceipt,
} from "./quickbooks";

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

describe("QuickBooks integration", () => {
  it("requests the accounting scope and preserves callback state", () => {
    const url = new URL(
      quickBooksAuthorizationUrl({
        config: { clientId: "client", clientSecret: "secret", environment: "sandbox" },
        state: "opaque-state",
        redirectUri: "https://dive.day/api/integrations/quickbooks/callback",
      }),
    );
    expect(url.hostname).toBe("appcenter.intuit.com");
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(url.searchParams.get("state")).toBe("opaque-state");
  });

  it("creates a SalesReceipt with line-level quantities and amounts", () => {
    const receipt = quickBooksSalesReceipt(payload, "7", "42");
    expect(receipt.CustomerRef).toEqual({ value: "7" });
    expect(receipt.Line[0]).toMatchObject({
      Amount: 125,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "42" }, Qty: 1, UnitPrice: 125 },
    });
  });

  it("uses only the current refund delta for a RefundReceipt", () => {
    const receipt = quickBooksRefundReceipt(payload, "7", "42");
    expect(receipt.Line[0]?.Amount).toBe(25);
    expect(receipt.PrivateNote).toContain("order-1");
  });
});
