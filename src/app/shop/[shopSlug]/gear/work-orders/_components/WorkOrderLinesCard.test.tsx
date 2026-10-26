// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { toShopCurrency } from "@/lib/money";
import { WorkOrderLinesCard } from "./WorkOrderLinesCard";

vi.mock("../actions", () => ({
  addWorkOrderLineAction: vi.fn(),
  updateWorkOrderLineAction: vi.fn(),
  deleteWorkOrderLineAction: vi.fn(),
}));
afterEach(cleanup);
it("answers an add-line price refusal beside the retained add form", () => {
  render(
    <WorkOrderLinesCard
      workOrderId="ticket-1"
      scope="shop.staff.ticket-1"
      notice="invalid-amount"
      lines={[]}
      totalCents={0}
      readOnly={false}
      currency={toShopCurrency("USD")}
      locale="en-US"
      t={staffTranslator("en-US")}
    />,
  );
  const refusal = screen.getByText("Check the price.");
  expect(refusal.closest("form")).toContainElement(screen.getByLabelText("Price each"));
  expect(screen.getByLabelText("Price each")).toHaveAttribute("aria-invalid", "true");
});

it("keeps a deleted ticket readable without a destination editor for validation feedback", () => {
  render(
    <WorkOrderLinesCard
      workOrderId="ticket-1"
      scope="shop.staff.ticket-1"
      notice="invalid-amount"
      lines={[]}
      totalCents={0}
      readOnly={true}
      currency={toShopCurrency("USD")}
      locale="en-US"
      t={staffTranslator("en-US")}
    />,
  );
  expect(screen.getByRole("heading", { name: "Parts and labor" })).toBeVisible();
  expect(screen.queryByLabelText("Price each")).toBeNull();
  expect(screen.queryByText("Check the price.")).toBeNull();
});
