// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RentalFit } from "@/lib/dive-prep";
import { GearAndSizes } from "./GearAndSizes";
import type { DiverProfile } from "./shared";

vi.mock("../fit-actions", () => ({ saveProfileAction: vi.fn(), setNeedsStaffFitAction: vi.fn() }));

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
    rentsHood: false,
    rentsGloves: false,
    rentsTorch: false,
    rentsSmb: false,
    bcdSize: null,
    wetsuitSize: null,
    drysuitSize: null,
    hoodSize: null,
    gloveSize: null,
    bootSize: null,
    finSize: null,
    weightPreference: null,
    divesDry: false,
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
  /** ADR 20260815-minimal-gear-register, amendment 2026-10-08. */
  it("names each open counter rental with a link to its ticket, and offers Rent gear", () => {
    render(
      <GearAndSizes
        diver={{ rentalFit: null } as unknown as DiverProfile}
        shopSlug="blue-mantis"
        personId="person-1"
        rentalItems={[]}
        canOverride
        locale="en-US"
        t={t}
        counterRentals={[
          {
            ticketId: "ticket-1",
            personId: "person-1",
            personName: "Priya Sharma",
            reservedFrom: "2026-07-18",
            reservedUntil: "2026-07-20",
            createdAt: new Date("2026-07-17T10:00:00.000Z"),
            orderId: null,
            units: [
              {
                reservationId: "ticket-1",
                gearItemId: "unit-1",
                kind: "mask",
                label: "Mask #2",
                size: null,
                checkedOutAt: null,
                returnedAt: null,
                returnOutcome: null,
              },
              {
                reservationId: "res-2",
                gearItemId: "unit-2",
                kind: "fins",
                label: "Fins #2",
                size: "M",
                checkedOutAt: null,
                returnedAt: null,
                returnOutcome: null,
              },
            ],
          },
        ]}
        rentGearHref="/shop/blue-mantis/gear/rentals/new?personId=person-1"
      />,
    );
    // A rental out opens the group with the record: it is gear somebody has.
    expect(screen.getByTestId("diver-file-group-gear")).toHaveAttribute("open");
    expect(
      screen.getByRole("link", { name: /^Mask #2, Fins #2 · back by Jul.20, 2026$/ }),
    ).toHaveAttribute("href", "/shop/blue-mantis/gear/rentals/ticket-1");
    expect(screen.getByRole("link", { name: "Rent gear" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/gear/rentals/new?personId=person-1",
    );
  });

  it("offers no Rent gear door and no Rented row when there is nothing to say", () => {
    renderGear(null);
    expect(screen.queryByRole("link", { name: "Rent gear" })).not.toBeInTheDocument();
    expect(screen.queryByText("Rented")).not.toBeInTheDocument();
  });

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

  it("asks a hood and glove size each, in free text, only for what the shop rents (H-102)", () => {
    renderGear(
      makeRentalFit({ rentsHood: true, hoodSize: "M, 5 mm", rentsGloves: true, gloveSize: "L" }),
      ["hood", "gloves"],
    );
    expect(screen.getByLabelText("Hood size")).toHaveValue("M, 5 mm");
    expect(screen.getByLabelText("Glove size")).toHaveValue("L");
    expect(screen.getByLabelText("Hood")).toBeChecked();
    expect(screen.getByLabelText("Gloves")).toBeChecked();
    cleanup();
    renderGear(makeRentalFit({ rentsGloves: true, gloveSize: "L" }), ["gloves"]);
    expect(screen.queryByLabelText("Hood size")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Glove size")).toHaveValue("L");
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

  /**
   * The suit is one choice of four (H-78): a staffer taking a call can record
   * a diver in their own drysuit, which no tick could say, and can never
   * record two suits for one diver.
   */
  it("asks the suit as one choice, opening on the diver's own drysuit", () => {
    renderGear(makeRentalFit({ divesDry: true }), ["bcd", "wetsuit", "drysuit"]);
    const values = screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"));
    expect(values).toEqual(["own_wetsuit", "rents_wetsuit", "own_drysuit", "rents_drysuit"]);
    expect(screen.getByRole("radio", { name: "Own drysuit" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Wetsuit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Drysuit" })).not.toBeInTheDocument();
  });

  it("asks the wetsuit size once the staffer picks a rented wetsuit", () => {
    renderGear(makeRentalFit(), ["bcd", "wetsuit"]);
    expect(screen.queryByLabelText("Wetsuit size")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Rents a wetsuit" }));
    expect(screen.getByLabelText("Wetsuit size")).toBeInTheDocument();
  });

  it("gives a drysuit example for the weighting while the suit is a drysuit", () => {
    renderGear(makeRentalFit({ rentsWeights: true }), ["weights", "drysuit"]);
    const weighting = () => screen.getByRole("textbox", { name: "Weight preference" });
    expect(weighting()).toHaveAttribute("placeholder", "Usually 12 lb with 3 mm suit");
    fireEvent.click(screen.getByRole("radio", { name: "Own drysuit" }));
    expect(weighting()).toHaveAttribute("placeholder", "Usually 22 lb in a drysuit");
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
