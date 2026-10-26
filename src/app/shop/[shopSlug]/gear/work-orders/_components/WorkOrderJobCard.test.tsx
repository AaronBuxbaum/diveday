// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkOrder } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { WorkOrderJobCard } from "./WorkOrderJobCard";

vi.mock("../actions", () => ({ saveWorkOrderAction: vi.fn() }));
afterEach(cleanup);
const t = staffTranslator("en-US");
const job = {
  id: "wo-1",
  status: "picked_up",
  reportedProblem: "Fogged display",
  promisedOn: null,
  technicianPersonId: null,
  technicianNotes: "Bench observation",
  workPerformed: "Replaced seal",
} as unknown as WorkOrder;
const props = {
  workOrder: job,
  unit: false,
  staff: [],
  technicianName: null,
  readOnly: false,
  locale: "en-US",
  t,
};

describe("a collected job", () => {
  it("reads as facts and keeps correction behind Edit", () => {
    const { container } = render(<WorkOrderJobCard {...props} />);
    expect(screen.getByText("Fogged display", { selector: "p" })).toBeVisible();
    expect(screen.getByText("Bench observation", { selector: "p" })).toBeVisible();
    expect(screen.getByText("Replaced seal", { selector: "p" })).toBeVisible();
    expect(screen.getByText("Edit job")).toBeVisible();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector('input[name="workOrderId"]')).toHaveValue("wo-1");
  });
  it("reopens correction after a refused save while deleted records offer none", () => {
    const { container, rerender } = render(<WorkOrderJobCard {...props} formOpen />);
    expect(container.querySelector("details")).toHaveAttribute("open");
    rerender(<WorkOrderJobCard {...props} readOnly />);
    expect(screen.queryByText("Edit job")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByText("Fogged display", { selector: "p" })).toBeVisible();
  });
});
