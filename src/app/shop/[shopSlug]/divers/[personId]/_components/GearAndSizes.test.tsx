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
    bcdSize: null,
    wetsuitSize: null,
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
});
