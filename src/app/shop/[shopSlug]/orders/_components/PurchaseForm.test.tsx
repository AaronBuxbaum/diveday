// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PurchaseForm } from "./PurchaseForm";
import type { PurchaseWords } from "./purchase-form-types";

vi.mock("../purchase-actions", () => ({ recordPurchaseAction: vi.fn() }));
vi.mock("../customer-search-actions", () => ({
  searchOrderCustomersAction: vi.fn(async () => ({
    customers: [{ id: "diver", fullName: "Diver", email: null }],
    more: false,
  })),
}));
afterEach(cleanup);
const words: PurchaseWords = {
  title: "Purchase",
  customer: {
    label: "Customer",
    placeholder: "Walk-in, or search",
    choose: "Choose a diver",
    change: "Change",
    noMatches: "No one",
    more: "More match",
  },
  method: "Method",
  reference: "Reference",
  note: "Note",
  item: "Item",
  kind: "Kind",
  quantity: "Quantity",
  price: "Price",
  tax: "Tax included",
  taxHint: "Recorded facts",
  tip: "Tip",
  gross: "Total received",
  grossDue: "Total due",
  add: "Add item",
  remove: "Remove item",
  submit: "Record received",
  busy: "Saving",
  invalid: "Review",
  entryType: "Entry",
  received: "Already received",
  due: "Amount due",
  dueHelp: "No card charge",
  itemsHeading: "Items",
  paymentHeading: "Payment received",
  totalInvalid: "Enter valid amounts",
  submitDue: "Create amount due",
  payerRequired: "Choose a diver",
  kinds: [{ value: "merchandise", label: "Purchase" }],
  methods: [{ value: "cash", label: "Cash" }],
};
function setup(canCreateDue = true) {
  render(
    <PurchaseForm
      attemptId="attempt"
      currency="usd"
      locale="en-US"
      step="0.01"
      customer={null}
      canCreateDue={canCreateDue}
      words={words}
    />,
  );
}
it("distinguishes missing amounts from zero and requires a named diver only for due", async () => {
  setup();
  expect(screen.getByText("Enter valid amounts")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "0" } });
  expect(screen.queryByText("Enter valid amounts")).not.toBeInTheDocument();
  expect(screen.getByText("$0.00")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Amount due" }));
  expect(screen.getByRole("button", { name: "Create amount due" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "Div" } });
  fireEvent.click(await screen.findByRole("button", { name: "Diver" }));
  expect(screen.getByRole("button", { name: "Create amount due" })).toBeEnabled();
});
it("preserves cart and receipt drafts across modes and moves focus when adding/removing", async () => {
  setup();
  fireEvent.change(screen.getByLabelText("Item", { selector: "input" }), {
    target: { value: "Mask" },
  });
  fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "Terminal 42" } });
  fireEvent.click(screen.getByRole("radio", { name: "Amount due" }));
  expect(screen.getByDisplayValue("Mask")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Already received" }));
  expect(screen.getByDisplayValue("Terminal 42")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  const items = screen.getAllByLabelText("Item", { selector: "input" });
  await waitFor(() => expect(items[1]).toHaveFocus());
  fireEvent.click(screen.getAllByRole("button", { name: "Remove item" })[1]);
  await waitFor(() => expect(items[0]).toHaveFocus());
});
it("keeps paid walk-ins available without offering billing permission", () => {
  setup(false);
  expect(screen.queryByRole("radio", { name: "Amount due" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Customer")).toHaveAttribute("placeholder", "Walk-in, or search");
  expect(document.querySelector('input[name="personId"]')).toHaveValue("walk-in");
});

it("labels an unpaid total as due and retains the received label when switching back", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "25" } });
  expect(screen.getByText("Total received:")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Amount due" }));
  expect(screen.getByText("Total due:")).toBeVisible();
  expect(screen.queryByText("Total received:")).not.toBeInTheDocument();
  expect(screen.getByText("$25.00")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Already received" }));
  expect(screen.getByText("Total received:")).toBeVisible();
  expect(screen.getByText("$25.00")).toBeVisible();
});
