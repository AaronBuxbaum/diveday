import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { readRetainedInvoice, retainInvoice } from "./retained-invoice";

describe("bounded invoice refusal state", () => {
  it("retains all twenty complete rows plus customer, note, booking and billing address", () => {
    const form = new FormData();
    form.set("lineItemCount", "20");
    form.set("invoiceAttempt", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    form.set("invoiceTarget", ":");
    for (let i = 0; i < 20; i++) {
      form.set(`kind-${i}`, "other");
      form.set(`description-${i}`, `${i}: ${"d".repeat(190)}`);
      form.set(`quantity-${i}`, "2");
      form.set(`unitAmount-${i}`, "12.50");
    }
    form.set("personId", "11111111-1111-4111-8111-111111111111");
    form.set("bookingId", "22222222-2222-4222-8222-222222222222");
    form.set("description", "Desk note");
    form.set("customerAddressLine1", "12 Test Street");
    form.set("customerAddressCountry", "US");
    form.set("cardNumber", "never retained");
    const raw = retainInvoice(form, 1000);
    const draft = readRetainedInvoice(raw, 1001);
    expect(draft?.rows).toHaveLength(20);
    expect(draft?.rows[19]?.description).toBe(`19: ${"d".repeat(190)}`);
    expect(draft?.fields).toEqual({
      personId: "11111111-1111-4111-8111-111111111111",
      bookingId: "22222222-2222-4222-8222-222222222222",
      description: "Desk note",
      customerAddressLine1: "12 Test Street",
      customerAddressCountry: "US",
    });
    expect(raw).not.toContain("cardNumber");
    expect(readRetainedInvoice(raw, 1001 + 10 * MINUTE_MS)).toBeNull();
  });

  it("rejects invented fields, oversized rows and future timestamps", () => {
    const draft = {
      at: 10,
      attempt: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      target: ":",
      rows: [{ kind: "other", description: "Test", quantity: "1", unitAmount: "0" }],
      fields: {},
    };
    expect(
      readRetainedInvoice(JSON.stringify({ ...draft, fields: { password: "secret" } }), 11),
    ).toBeNull();
    expect(
      readRetainedInvoice(JSON.stringify({ ...draft, rows: Array(21).fill(draft.rows[0]) }), 11),
    ).toBeNull();
    expect(readRetainedInvoice(JSON.stringify(draft), 9)).toBeNull();
  });
});
