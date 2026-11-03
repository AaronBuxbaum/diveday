import { describe, expect, it } from "vitest";
import { MAX_LINE_ITEMS_PER_ORDER } from "@/lib/order-limits";
import {
  invoiceAttemptFromForm,
  invoiceTargetFromKey,
  invoiceTargetKey,
  orderRowsFromForm,
} from "./order-form";

function invoice(count: number) {
  const form = new FormData();
  form.set("lineItemCount", String(count));
  for (let i = 0; i < count; i++) {
    form.set(`kind-${i}`, "other");
    form.set(`description-${i}`, `Item ${i + 1}`);
    form.set(`quantity-${i}`, "1");
    form.set(`unitAmount-${i}`, "12.50");
  }
  return form;
}

describe("invoice row boundary", () => {
  it("reads every one of twenty rows in order", () => {
    const rows = orderRowsFromForm(invoice(MAX_LINE_ITEMS_PER_ORDER));
    expect(rows).toHaveLength(20);
    expect(rows?.at(-1)?.description).toBe("Item 20");
  });

  it.each([0, 21, -1, 1.5])("refuses the unsupported count %s", (count) => {
    expect(orderRowsFromForm(invoice(count))).toBeNull();
  });

  it.each(["description-20", "description--1", "description-01", "description-x"])(
    "refuses an extra or malformed indexed field %s",
    (name) => {
      const form = invoice(1);
      form.set(name, "Do not silently lose this item");
      expect(orderRowsFromForm(form)).toBeNull();
    },
  );

  it("refuses missing and duplicate row fields", () => {
    const missing = invoice(2);
    missing.delete("quantity-1");
    expect(orderRowsFromForm(missing)).toBeNull();
    const duplicate = invoice(1);
    duplicate.append("description-0", "Second value");
    expect(orderRowsFromForm(duplicate)).toBeNull();
  });

  it("leaves partly entered rows for validation instead of dropping them", () => {
    const form = invoice(1);
    form.set("description-0", "");
    expect(orderRowsFromForm(form)?.[0]?.unitAmount).toBe("12.50");
  });
});

describe("invoice completion and target metadata", () => {
  it("accepts only one bounded opaque attempt and refuses raw boolean or duplicate markers", () => {
    const form = new FormData();
    form.set("invoiceAttempt", "1");
    expect(invoiceAttemptFromForm(form)).toBeNull();
    form.set("invoiceAttempt", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(invoiceAttemptFromForm(form)).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    form.append("invoiceAttempt", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(invoiceAttemptFromForm(form)).toBeNull();
  });
  it("keeps target identity canonical and permits only UUID prefills", () => {
    const key = invoiceTargetKey("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", null);
    expect(invoiceTargetFromKey(key)).toEqual({
      bookingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      personId: null,
    });
    expect(invoiceTargetFromKey("javascript:injected")).toBeNull();
  });
});
