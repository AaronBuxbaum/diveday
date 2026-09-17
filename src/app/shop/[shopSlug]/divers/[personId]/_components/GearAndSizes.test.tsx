// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RentalFit } from "@/lib/dive-prep";
import { GearAndSizes } from "./GearAndSizes";
import type { DiverProfile } from "./shared";

vi.mock("../actions", () => ({
  saveProfileAction: vi.fn(),
  setNeedsStaffFitAction: vi.fn(),
}));

afterEach(cleanup);

const t = staffTranslator("en-US");

function makeRentalFit(overrides: Partial<RentalFit> = {}): RentalFit {
  return {
    rentsBcd: false,
    rentsRegulator: false,
    rentsWetsuit: false,
    rentsMaskFins: false,
    rentsWeights: false,
    rentsDiveComputer: false,
    rentsGopro: false,
    rentsDrysuit: false,
    rentsHoodGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: null,
    wetsuitSize: null,
    drysuitSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
    fitStatedAt: new Date("2026-08-20T10:00:00.000Z"),
    ...overrides,
  };
}

function renderGear(rentalFit: RentalFit | null, rentalItems: string[] = []) {
  return render(
    <GearAndSizes
      diver={{ rentalFit } as DiverProfile}
      shopSlug="blue-mantis"
      personId="person-1"
      rentalItems={rentalItems}
      canOverride
      locale="en-US"
      t={t}
    />,
  );
}

describe("GearAndSizes", () => {
  it.each([
    ["no rental fit on file", null, [], "No fit on file, not asked yet"],
    ["own kit", makeRentalFit(), [], "Own kit"],
    ["rental fit", makeRentalFit({ rentsBcd: true, bcdSize: "M" }), ["bcd"], "Rental fit on file"],
    [
      "staff fit",
      makeRentalFit({ rentsBcd: true, needsStaffFitAt: new Date("2026-08-21T10:00:00.000Z") }),
      ["bcd"],
      "Needs staff fit at check-in",
    ],
  ])("preserves the door status for %s", (_state, rentalFit, rentalItems, summary) => {
    renderGear(rentalFit, rentalItems);

    const details = screen.getByTestId("diver-file-group-gear");
    expect(details.querySelector("summary")).toHaveTextContent(summary);
  });

  it("keeps detailed rental facts inside the expanded content", () => {
    renderGear(
      makeRentalFit({
        rentsBcd: true,
        rentsWetsuit: true,
        bcdSize: "M",
        wetsuitSize: "ML",
        bootSize: "8",
      }),
      ["bcd", "wetsuit"],
    );

    const summary = screen.getByTestId("diver-file-group-gear").querySelector("summary");
    expect(summary).toHaveTextContent("Rental fit on file");
    expect(summary).not.toHaveTextContent(/BCD M|Wetsuit ML|Boots 8/);
    expect(screen.getByText("BCD M · Wetsuit ML · Boots 8")).toBeInTheDocument();
  });

  /**
   * Staff-side the drysuit size is free text, not the diver form's select: the
   * counter is where a size off the proposed grid gets recorded (issue 1414).
   */
  it("asks for a drysuit size only when the shop's catalog has one, prefilled", () => {
    renderGear(makeRentalFit({ rentsDrysuit: true, drysuitSize: "MT" }), ["drysuit"]);
    expect(screen.getByLabelText("Drysuit size")).toHaveValue("MT");
  });

  it("never asks a shop that does not rent drysuits", () => {
    renderGear(makeRentalFit({ rentsBcd: true, bcdSize: "M" }), ["bcd"]);
    expect(screen.queryByLabelText("Drysuit size")).not.toBeInTheDocument();
  });

  /**
   * A drysuit renter gets no boots line on the packing list, because a rental
   * drysuit usually has its boots vulcanised on (`src/lib/dive-prep.ts`). A
   * fleet whose suits take separate rock boots has no column, no tick and no
   * piece to say so with, and a missing line on a packing list is invisible
   * until somebody is standing on the dock in a suit they cannot fin in. This
   * box is the one field that reaches the line verbatim, so it is where the
   * rock-boot size goes — and nothing but this hint tells the staffer that.
   */
  it("tells the staffer that a sock suit's rock-boot size goes in this box", () => {
    renderGear(makeRentalFit({ rentsDrysuit: true, drysuitSize: "MT" }), ["drysuit"]);
    const trigger = screen.getByRole("button", { name: "About drysuit size" });
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /separate rock boots, put that size in here/i,
    );
    // The hint is a description, never folded into what the box is called.
    expect(screen.getByLabelText("Drysuit size")).toHaveValue("MT");
  });

  it("hangs no hint on a size box that has nothing extra to say", () => {
    renderGear(makeRentalFit({ rentsBcd: true, bcdSize: "M" }), ["bcd"]);
    expect(screen.queryByRole("button", { name: /^About / })).not.toBeInTheDocument();
  });

  /**
   * A heading, a two-line caption, an input and a button stood under the facts
   * on every diver who rents anything — a form for the morning the rack is
   * empty, open on the four hundred mornings it is not. It is one control now,
   * and the caption that described what the flag does to the packing list went
   * with it (copy-restraint #2).
   */
  it("keeps the can’t-fill form behind one control, with no caption standing", () => {
    renderGear(makeRentalFit({ rentsBcd: true, bcdSize: "M" }), ["bcd"]);

    const door = screen.getByText("Can’t fill a size?");
    expect(door.tagName).toBe("SUMMARY");
    expect(door.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/nobody lays out a size the shop is short of/)).toBeNull();
    // Still reachable, and still the same act.
    expect(screen.getByRole("button", { name: "Flag for staff fit" })).toBeInTheDocument();
  });

  /**
   * A flag that is up is open work the crew has to act on, so it is the one
   * state of this group that states itself and opens the door with the record.
   */
  it("stands the flagged state open, with its note and its one way out", () => {
    renderGear(
      makeRentalFit({
        rentsBcd: true,
        needsStaffFitAt: new Date("2026-08-21T10:00:00.000Z"),
        needsStaffFitNote: "No M BCD today",
      }),
      ["bcd"],
    );

    expect(screen.getByTestId("diver-file-group-gear")).toHaveAttribute("open");
    expect(screen.getByText("Flagged for hands-on fitting")).toHaveClass("text-warning-strong");
    expect(screen.getByText("No M BCD today")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fit resolved — pack their sizes again" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Can’t fill a size?")).toBeNull();
  });
});
