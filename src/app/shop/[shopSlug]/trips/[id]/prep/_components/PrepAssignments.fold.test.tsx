// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import type { GearServiceState } from "@/lib/gear";
import { PrepAssignments } from "./PrepAssignments";
import { assignmentRowIsSettled } from "./prep-lines";
import { prepFor, t, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

/**
 * **A settled diver folds on a phone** (issue #2435): "All N assigned" for a
 * row with nothing left to do, a full row for anyone who still needs
 * something. The fold is CSS (`lg:` shows the body, the summary row is
 * `lg:hidden`), so these tests read the classes and the disclosure state, not
 * a viewport.
 */

const unit = (n: number, extra: Record<string, unknown> = {}) => ({
  reservationId: `r${n}`,
  gearItemId: `u${n}`,
  bookingId: "b1",
  kind: "regulator",
  size: null,
  label: `Reg #${n}`,
  reservedFrom: "2026-07-21",
  reservedUntil: "2026-07-21",
  checkedOutAt: null,
  status: "in_service",
  serviceNote: null,
  serviceState: { state: "no_clock" } as GearServiceState,
  serviceConcern: false,
  ...extra,
});

type Row = TripPrep["assignmentRows"][number];

const row = (over: Partial<Record<keyof Row, unknown>> = {}): Row =>
  ({
    diver: { bookingId: "b1", fullName: "Carmen Ruiz" },
    assigned: [unit(1), unit(2)],
    wanted: [],
    handedOver: true,
    needsStaffFit: null,
    counterHeld: [],
    ...over,
  }) as never;

function renderRows(...rows: Row[]) {
  const base = prepFor();
  return render(
    <PrepAssignments
      view={viewOf({
        ...base,
        gearFleetTotal: 4,
        loadOut: { units: 2, divers: rows.length, serviceFlagged: 0 },
        assignmentRows: rows,
      })}
    />,
  );
}

describe("assignmentRowIsSettled", () => {
  it("is true only when everything is assigned, handed over and unremarkable", () => {
    expect(assignmentRowIsSettled(t, row())).toBe(true);
  });

  it.each([
    ["a piece still to pick", { wanted: [{ kind: "bcd", size: "L" }] }],
    ["a set not yet handed over", { handedOver: false }],
    ["a staff fit flag", { needsStaffFit: { note: null } }],
    ["a counter rental to say", { counterHeld: [{ label: "Reg #9", until: "2026-07-25" }] }],
    ["nothing assigned", { assigned: [] }],
    ["a unit pulled for service", { assigned: [unit(1, { status: "needs_service" })] }],
    ["an unanswered service concern", { assigned: [unit(1, { serviceConcern: true })] }],
  ])("is false with %s", (_label, over) => {
    expect(assignmentRowIsSettled(t, row(over))).toBe(false);
  });
});

describe("the Gear tab's rows below lg", () => {
  it("folds a settled diver to one row, opens it on a tap, and keeps the lines in the page", () => {
    renderRows(row());
    const fold = screen.getByRole("button", { name: t("gear.prep.allAssigned", { count: 2 }) });
    expect(fold).toHaveTextContent("All 2 assigned");
    expect(fold.className).toContain("lg:hidden");
    expect(fold).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById(fold.getAttribute("aria-controls") ?? "");
    expect(body?.className).toContain("hidden");
    expect(body?.className).toContain("lg:block");
    expect(body).toContainElement(screen.getByText("Reg #1"));

    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(body?.className.split(" ")).not.toContain("hidden");
  });

  it("keeps a diver who still needs something open, with no fold row", () => {
    renderRows(row({ handedOver: false }), row({ wanted: [{ kind: "bcd", size: "L" }] }));
    expect(screen.queryByRole("button", { name: /assigned/ })).toBeNull();
    expect(screen.getAllByText("Reg #1")).toHaveLength(2);
  });

  it("never folds a unit that needs care, so the line cannot be hidden behind a tap", () => {
    renderRows(row({ assigned: [unit(1, { serviceConcern: true })] }));
    expect(screen.queryByRole("button", { name: /assigned/ })).toBeNull();
    expect(screen.getByText(t("gear.prep.optionServiceConcern"))).toBeVisible();
  });

  it("says a single unit in the singular", () => {
    renderRows(row({ assigned: [unit(1)] }));
    expect(screen.getByRole("button", { name: "1 assigned" })).toBeInTheDocument();
  });
});
