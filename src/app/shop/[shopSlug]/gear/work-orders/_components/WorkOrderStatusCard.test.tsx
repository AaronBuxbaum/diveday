// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonClass } from "@/components/ui/button";
import type { WorkOrder } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";

vi.mock("../actions", () => ({
  restoreWorkOrderAction: vi.fn(),
  setWorkOrderStatusAction: vi.fn(),
}));

const { WorkOrderStatusCard } = await import("./WorkOrderStatusCard");

afterEach(cleanup);

const t = staffTranslator("en-US");
const received = { id: "wo-1", status: "received", outcome: null } as unknown as WorkOrder;

/**
 * UX review 2026-10-10, item 25: the moves read as a segmented control whose
 * filled segment was the current status. They are actions, captioned as moves.
 */
describe("WorkOrderStatusCard", () => {
  it("captions its buttons as moves, in one labelled group of buttons", () => {
    render(<WorkOrderStatusCard workOrder={received} subject="customer" readOnly={false} t={t} />);
    const group = screen.getByRole("group", { name: "Move to" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(1);
    // A move is never drawn as a pressed segment: nothing is aria-pressed or a radio.
    for (const button of buttons) expect(button).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByRole("radio")).toBeNull();
    // The current status is not one of the moves.
    expect(within(group).queryByRole("button", { name: "Received" })).toBeNull();
  });

  it("says where the ticket is as a pill in the row, and fills no move (A29)", () => {
    render(<WorkOrderStatusCard workOrder={received} subject="customer" readOnly={false} t={t} />);
    const group = screen.getByRole("group", { name: "Move to" });
    expect(within(group).getByText("Received").closest("button")).toBeNull();
    for (const button of within(group).getAllByRole("button")) {
      expect(button.className).toBe(buttonClass({ variant: "secondary" }));
    }
  });
});
