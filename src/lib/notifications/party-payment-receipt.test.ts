// @vitest-environment node
import { describe, expect, it } from "vitest";
import { notificationIdempotencyKey } from "./kinds";
import { partyPaymentReceiptEmail } from "./party-payment-receipt";

const base = {
  diverName: "Pat Party",
  shopName: "Blue Mantis Divers",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-10-25T14:00:00Z"),
  timezone: "America/New_York",
  seats: 4,
  amountCents: 72_000,
  currency: "usd",
};

describe("partyPaymentReceiptEmail", () => {
  it("names the seats, the trip and the settled total in the lead's language", () => {
    const en = partyPaymentReceiptEmail({ ...base, locale: "en-US" });
    expect(en.subject).toBe("Receipt: Two-Tank Reef");
    expect(en.text).toContain("Hi Pat");
    expect(en.text).toContain("Paid by card for 4 seats on Two-Tank Reef");
    expect(en.text).toContain("$720.00");
    const es = partyPaymentReceiptEmail({ ...base, locale: "es-ES" });
    expect(es.subject).toBe("Recibo: Two-Tank Reef");
    expect(es.text).toContain("Pagado con tarjeta por 4 plazas");
  });

  it("escapes a shop-authored trip title in the html", () => {
    const email = partyPaymentReceiptEmail({ ...base, locale: "en-US", tripTitle: "<b>Hi</b>" });
    expect(email.html).not.toContain("<b>Hi</b>");
    expect(email.html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });
});

describe("the receipt's idempotency key", () => {
  it("is one per checkout", () => {
    const checkoutId = "6d6f8a3e-1b6c-4f64-9d7e-0a1b2c3d4e5f";
    expect(
      notificationIdempotencyKey({
        kind: "party_payment_receipt",
        checkoutId,
        shopId: "0f0f8a3e-1b6c-4f64-9d7e-0a1b2c3d4e5f",
        to: "pat@example.com",
        locale: "en-US",
        ...base,
      }),
    ).toBe(`party-payment-receipt/${checkoutId}`);
  });
});
