import { describe, expect, it } from "vitest";
import { orderLineItemKind } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { KIND_KEYS, NOTICES, recordPaymentNotice } from "./order-detail-keys";

describe("KIND_KEYS", () => {
  // `e_learning_fee` rendered raw on the order page (visual review A02): every
  // kind the column can hold has a label, in both languages, and none reads as
  // the enum value.
  it.each(["en-US", "es-ES"] as const)("labels every order-line kind in %s", (locale) => {
    const t = staffTranslator(locale);
    for (const kind of orderLineItemKind.enumValues) {
      const key = KIND_KEYS[kind];
      expect(key, kind).toBeDefined();
      const label = t(key);
      expect(label, kind).not.toBe(key);
      expect(label, kind).not.toContain("_");
    }
  });
});

describe("recordPaymentNotice", () => {
  it("tells a payment still with Stripe apart from a real failure", () => {
    expect(recordPaymentNotice({ ok: false, reason: "claim_held" })).toBe("payment-in-flight");
    expect(recordPaymentNotice({ ok: false, reason: "stripe_unknown" })).toBe("payment-in-flight");
    expect(recordPaymentNotice({ ok: false, reason: "stripe_refused" })).toBe(
      "payment-stripe-refused",
    );
    expect(recordPaymentNotice({ ok: false, reason: "invalid" })).toBe("payment-record-failed");
    expect(recordPaymentNotice(null)).toBe("payment-record-failed");
  });

  it("does not tell a demo shop Stripe was told", () => {
    const ok = { ok: true, order: {} } as Parameters<typeof recordPaymentNotice>[0];
    expect(recordPaymentNotice(ok)).toBe("payment-recorded");
    expect(recordPaymentNotice(ok, { demo: true })).toBe("payment-recorded-demo");
    expect(NOTICES["payment-recorded-demo"]).toBeDefined();
    expect(recordPaymentNotice({ ok: false, reason: "invalid" }, { demo: true })).toBe(
      "payment-record-failed",
    );
  });

  it("names a notice the page can render for every outcome", () => {
    for (const reason of [
      "invalid",
      "stripe_refused",
      "stripe_unknown",
      "claim_held",
      "not_configured",
    ] as const) {
      expect(NOTICES[recordPaymentNotice({ ok: false, reason })]).toBeDefined();
    }
  });
});
