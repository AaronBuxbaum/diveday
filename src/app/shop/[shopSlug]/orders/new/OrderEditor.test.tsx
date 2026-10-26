// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { nowMs } from "@/lib/clock";
import { ClearCreatedInvoice } from "./ClearCreatedInvoice";
import { InvoiceForm } from "./InvoiceForm";
import { OrderEditor } from "./OrderEditor";
import { invoiceTargetKey } from "./order-form";
import { INVOICE_FORM, retainInvoice } from "./retained-invoice";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});
const scope = "test-shop.test-staffer";
const words: ComponentProps<typeof OrderEditor>["words"] = {
  legend: "Line items",
  item: "Item #",
  kind: "Kind",
  description: "Description",
  descriptionPlaceholder: "Item",
  quantity: "Quantity",
  unitPrice: "Unit price",
  add: "Add another item",
  remove: "Remove item",
  removeAria: "Remove item #",
  subtotal: "Subtotal",
  submit: "Create and send invoice",
  sending: "Sending",
};

const bookingA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bookingB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const customerA = "11111111-1111-4111-8111-111111111111";
const customerB = "22222222-2222-4222-8222-222222222222";
function Harness({
  restore = false,
  currency = "USD",
  actor = scope,
  bookingId = null,
  customerId = "",
  defaults = [],
  action,
}: {
  action?: ComponentProps<typeof InvoiceForm>["action"];
  restore?: boolean;
  currency?: string;
  actor?: string;
  bookingId?: string | null;
  customerId?: string;
  defaults?: ComponentProps<typeof OrderEditor>["defaults"];
}) {
  const target = invoiceTargetKey(bookingId, customerId);
  return (
    <InvoiceForm
      identity={`${actor}:${target}`}
      aria-label="Invoice"
      action={action}
      onSubmit={action ? undefined : (event) => event.preventDefault()}
    >
      <select name="personId" aria-label="Customer" defaultValue={customerId}>
        <option value="">Choose</option>
        <option value={customerA}>Customer A</option>
        <option value={customerB}>Customer B</option>
      </select>
      <input name="description" aria-label="Order note" />
      <input name="customerAddressLine1" aria-label="Billing address" />
      <OrderEditor
        defaults={defaults}
        bookingId={bookingId}
        target={target}
        kinds={[{ value: "other", label: "Other" }]}
        currency={currency}
        locale="en-US"
        step={currency === "JPY" ? "1" : "0.01"}
        scope={actor}
        restore={restore}
        words={words}
      />
    </InvoiceForm>
  );
}
const item = (number: number) =>
  screen.getByRole("group", { name: new RegExp(`^Item ${number}$`) });
function fillItem(number: number, description: string, price: string, quantity = "1") {
  fireEvent.change(within(item(number)).getByLabelText("Description"), {
    target: { value: description },
  });
  fireEvent.change(within(item(number)).getByLabelText("Unit price"), { target: { value: price } });
  fireEvent.change(within(item(number)).getByLabelText("Quantity"), {
    target: { value: quantity },
  });
}

describe("invoice line editing", () => {
  it("starts with one line and preserves retained row controls when removing the middle", () => {
    render(<Harness />);
    expect(screen.getAllByRole("group", { name: /^Item \d/ })).toHaveLength(1);
    fillItem(1, "First", "12.50", "2");
    fireEvent.click(screen.getByRole("button", { name: words.add }));
    fillItem(2, "Middle", "3");
    fireEvent.click(screen.getByRole("button", { name: words.add }));
    fillItem(3, "Last", "4");
    const retained = within(item(3)).getByLabelText("Description");
    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    expect(within(item(2)).getByLabelText("Description")).toBe(retained);
    expect(retained).toHaveValue("Last");
    expect(retained).toHaveFocus();
    expect(screen.getByText("$29.00")).toBeVisible();
  });

  it("supports twenty rows and stops adding at the shared maximum", () => {
    render(<Harness />);
    for (let index = 1; index < 20; index++)
      fireEvent.click(screen.getByRole("button", { name: words.add }));
    expect(screen.getAllByRole("group", { name: /^Item \d/ })).toHaveLength(20);
    expect(screen.getByRole("button", { name: words.add })).toBeDisabled();
  });

  it("uses currency minor units for a zero-decimal subtotal", () => {
    render(<Harness currency="JPY" />);
    fillItem(1, "Tank", "5000", "2");
    expect(screen.getByText("¥10,000")).toBeVisible();
  });

  it("restores all twenty rows and other fields after refusal and a repeated native reset", async () => {
    const first = render(<Harness />);
    for (let index = 1; index < 20; index++)
      fireEvent.click(screen.getByRole("button", { name: words.add }));
    for (let index = 1; index <= 20; index++)
      fillItem(index, `Complete item ${index}`, String(index));
    fireEvent.change(screen.getByLabelText("Order note"), { target: { value: "Typed note" } });
    fireEvent.change(screen.getByLabelText("Billing address"), {
      target: { value: "12 Test Street" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Invoice" }));
    first.unmount();
    render(<Harness restore />);
    expect(within(item(20)).getByLabelText("Description")).toHaveValue("Complete item 20");
    expect(screen.getByLabelText("Billing address")).toHaveValue("12 Test Street");
    fillItem(20, "Corrected last item", "25");
    fireEvent.submit(screen.getByRole("form", { name: "Invoice" }));
    (screen.getByRole("form", { name: "Invoice" }) as HTMLFormElement).reset();
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(within(item(20)).getByLabelText("Description")).toHaveValue("Corrected last item");
    expect(screen.getByLabelText("Order note")).toHaveValue("Typed note");
    expect(screen.getByLabelText("Billing address")).toHaveValue("12 Test Street");
  });

  it("holds the submitted customer, address and lines while pending, then reenables the retained refusal", async () => {
    let finish!: () => void;
    let postedAttempt: FormDataEntryValue | null = null;
    const held = async (form: FormData) => {
      postedAttempt = form.get("invoiceAttempt");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const view = render(<Harness action={held} />);
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: customerA } });
    fireEvent.change(screen.getByLabelText("Order note"), { target: { value: "Held note" } });
    fireEvent.change(screen.getByLabelText("Billing address"), {
      target: { value: "Held billing address" },
    });
    fillItem(1, "Held invoice", "12");
    fireEvent.click(screen.getByRole("button", { name: words.add }));
    fillItem(2, "Held rental", "5");
    fireEvent.submit(screen.getByRole("form", { name: "Invoice" }));
    expect(screen.getByLabelText("Customer")).toBeDisabled();
    expect(screen.getByLabelText("Order note")).toBeDisabled();
    expect(screen.getByLabelText("Billing address")).toBeDisabled();
    expect(within(item(1)).getByLabelText("Description")).toBeDisabled();
    expect(within(item(2)).getByLabelText("Unit price")).toBeDisabled();
    expect(screen.getByRole("button", { name: words.add })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove item 1" })).toBeDisabled();
    const kept = window.sessionStorage.getItem(keptTypedKey(INVOICE_FORM, scope));
    expect(Boolean(kept && postedAttempt === JSON.parse(kept).attempt)).toBe(true);
    view.rerender(<Harness restore action={held} />);
    await act(async () => {
      finish();
    });
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(screen.getByLabelText("Customer")).toBeEnabled();
    expect(screen.getByLabelText("Customer")).toHaveValue(customerA);
    expect(screen.getByLabelText("Billing address")).toHaveValue("Held billing address");
    expect(within(item(1)).getByLabelText("Description")).toHaveValue("Held invoice");
    expect(within(item(2)).getByLabelText("Description")).toHaveValue("Held rental");
  });

  it("resets the complete form when its actual booking/customer target changes, while equivalent defaults do not erase edits", () => {
    const a = [{ kind: "other", description: "Booking A", quantity: "1", unitAmount: "10" }];
    const b = [{ kind: "other", description: "Booking B", quantity: "1", unitAmount: "20" }];
    const view = render(<Harness bookingId={bookingA} customerId={customerA} defaults={a} />);
    fillItem(1, "Edited A", "12");
    fireEvent.change(screen.getByLabelText("Billing address"), {
      target: { value: "A billing address" },
    });
    view.rerender(<Harness bookingId={bookingA} customerId={customerA} defaults={[...a]} />);
    expect(within(item(1)).getByLabelText("Description")).toHaveValue("Edited A");
    view.rerender(<Harness bookingId={bookingB} customerId={customerB} defaults={b} />);
    const payload = new FormData(screen.getByRole("form", { name: "Invoice" }) as HTMLFormElement);
    expect(payload.get("bookingId")).toBe(bookingB);
    expect(payload.get("personId")).toBe(customerB);
    expect(payload.get("description-0")).toBe("Booking B");
    expect(payload.get("unitAmount-0")).toBe("20");
    expect(screen.getByLabelText("Billing address")).toHaveValue("");
  });

  it("restores a refusal only for its matching target, including across a remount", () => {
    const defaults = [{ kind: "other", description: "Booking A", quantity: "1", unitAmount: "10" }];
    const view = render(
      <Harness bookingId={bookingA} customerId={customerA} defaults={defaults} />,
    );
    fillItem(1, "Refused A", "15");
    fireEvent.submit(screen.getByRole("form", { name: "Invoice" }));
    view.unmount();
    const restored = render(
      <Harness restore bookingId={bookingA} customerId={customerA} defaults={defaults} />,
    );
    expect(within(item(1)).getByLabelText("Description")).toHaveValue("Refused A");
    restored.rerender(
      <Harness
        restore
        bookingId={bookingB}
        customerId={customerB}
        defaults={[{ ...defaults[0], description: "Booking B" }]}
      />,
    );
    const payload = new FormData(screen.getByRole("form", { name: "Invoice" }) as HTMLFormElement);
    expect(payload.get("bookingId")).toBe(bookingB);
    expect(payload.get("personId")).toBe(customerB);
    expect(payload.get("description-0")).toBe("Booking B");
  });

  it("mints a new correlation for each submitted attempt and resets fields when the staff scope changes", () => {
    const view = render(<Harness />);
    fillItem(1, "Pending", "12");
    fireEvent.change(screen.getByLabelText("Billing address"), {
      target: { value: "Private billing address" },
    });
    const form = screen.getByRole("form", { name: "Invoice" });
    fireEvent.submit(form);
    const first = window.sessionStorage.getItem(keptTypedKey(INVOICE_FORM, scope));
    fireEvent.submit(form);
    const second = window.sessionStorage.getItem(keptTypedKey(INVOICE_FORM, scope));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(JSON.parse(first ?? "{}").attempt).not.toBe(JSON.parse(second ?? "{}").attempt);
    view.rerender(<Harness actor="other-shop.other-staffer" />);
    expect(screen.getByLabelText("Billing address")).toHaveValue("");
    expect(within(item(1)).getByLabelText("Description")).toHaveValue("");
  });

  it("preserves a draft for a raw, old or mismatched success marker, consumes an exact attempt once, and preserves a newer attempt on replay", () => {
    const oldAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const currentAttempt = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const nextAttempt = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const own = keptTypedKey(INVOICE_FORM, scope);
    const other = keptTypedKey(INVOICE_FORM, "other-shop.other-staffer");
    const draft = (attempt: string) => {
      const form = new FormData();
      form.set("invoiceAttempt", attempt);
      form.set("invoiceTarget", invoiceTargetKey(null, null));
      form.set("lineItemCount", "1");
      form.set("kind-0", "other");
      form.set("description-0", "Pending invoice");
      form.set("quantity-0", "1");
      form.set("unitAmount-0", "12");
      const raw = retainInvoice(form, nowMs());
      if (!raw) throw new Error("valid test draft was refused");
      return raw;
    };
    const pending = draft(currentAttempt);
    window.sessionStorage.setItem(own, pending);
    window.sessionStorage.setItem(other, pending);
    const view = render(<ClearCreatedInvoice scope={scope} receipt="1" />);
    expect(window.sessionStorage.getItem(own)).toBe(pending);
    view.rerender(<ClearCreatedInvoice scope={scope} receipt={oldAttempt} />);
    expect(window.sessionStorage.getItem(own)).toBe(pending);
    view.rerender(<ClearCreatedInvoice scope={scope} receipt={currentAttempt} />);
    expect(window.sessionStorage.getItem(own)).toBeNull();
    expect(window.sessionStorage.getItem(other)).toBe(pending);
    const next = draft(nextAttempt);
    window.sessionStorage.setItem(own, next);
    view.unmount();
    render(<ClearCreatedInvoice scope={scope} receipt={currentAttempt} />);
    expect(window.sessionStorage.getItem(own)).toBe(next);
  });
});
