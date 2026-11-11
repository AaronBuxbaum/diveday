// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import type { RentalPricing } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

const emptyFit: DiverRentalFit = {
  rentsBcd: false,
  bcdSize: null,
  rentsRegulator: false,
  rentsWetsuit: false,
  wetsuitSize: null,
  drysuitSize: null,
  hoodSize: null,
  gloveSize: null,
  bootSize: null,
  rentsMask: false,
  rentsFins: false,
  finSize: null,
  rentsWeights: false,
  weightPreference: null,
  divesDry: false,
  rentsDiveComputer: false,
  rentsGopro: false,
  rentsDrysuit: false,
  rentsHood: false,
  rentsGloves: false,
  rentsTorch: false,
  rentsSmb: false,
  note: null,
  fitStatedAt: new Date("2026-07-21T13:30:00.000Z"),
};
const defaultPricing: RentalPricing = {
  setCents: 5000,
  perItemCents: {
    bcd: 1500,
    regulator: 1500,
    wetsuit: 1500,
    fins: 1000,
    weights: 500,
    dive_computer: 1000,
    gopro: 2000,
  },
  nitroxCents: 1000,
};

const mockAction = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * **The first question of the gear step** (Aaron, 2026-11-11, #4337): the full set stays the
 * default, and one tap says otherwise.
 */
describe("RentalFitForm gear source", () => {
  function renderSource(
    rentalFit: DiverRentalFit | null,
    course: Parameters<typeof RentalFitForm>[0]["course"] = null,
  ) {
    return renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={rentalFit}
        rentalItems={["bcd", "regulator", "wetsuit", "mask", "fins"]}
        course={course}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
  }

  it("starts on I need everything with the full set ticked, as before", () => {
    renderSource(null);
    expect(screen.getByRole("radio", { name: "I need everything" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Rent a wetsuit" })).toBeChecked();
  });

  it("All my own unticks every piece and picks the diver's own suit in one tap", async () => {
    renderSource(null);
    await userEvent.click(screen.getByRole("radio", { name: "All my own" }));
    for (const piece of [/^BCD/, /^Regulator/, /^Mask/, /^Fins/]) {
      expect(screen.getByRole("checkbox", { name: piece })).not.toBeChecked();
    }
    expect(screen.getByRole("radio", { name: /^My own wetsuit/ })).toBeChecked();
  });

  it("opens on All my own for a saved fit that rents nothing, and I need everything puts the set back", async () => {
    renderSource({ ...emptyFit });
    expect(screen.getByRole("radio", { name: "All my own" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "I need everything" }));
    expect(screen.getByRole("checkbox", { name: /^BCD/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Rent a wetsuit" })).toBeChecked();
  });

  it("moves to Some of it when the diver changes a single piece", async () => {
    renderSource(null);
    await userEvent.click(screen.getByRole("checkbox", { name: /^BCD/ }));
    expect(screen.getByRole("radio", { name: "Some of it" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Regulator/ })).toBeChecked();
  });

  it("is not asked on a course whose fee includes gear", () => {
    renderSource(null, { nitroxCompatible: false, includedRentalKinds: ["bcd", "regulator"] });
    expect(screen.queryByRole("radio", { name: "All my own" })).toBeNull();
  });

  it("offers the diver's own suit either way, and ours only when the shop rents it", () => {
    renderDiver(
      <RentalFitForm
        action={mockAction}
        rentalFit={emptyFit}
        rentalItems={["bcd", "wetsuit"]}
        course={null}
        pricing={defaultPricing}
        wantsNitrox={false}
        nitroxCardVerified={false}
        plannedDives={2}
        saved={false}
        currency="usd"
      />,
    );
    // The first three radios are the gear question; the suit's own choices follow.
    const suits = screen.getAllByRole("radio").slice(3);
    expect(suits.map((radio) => radio.getAttribute("value"))).toEqual([
      "own_wetsuit",
      "rents_wetsuit",
      "own_drysuit",
    ]);
    // No suit tick left among the pieces: the suit has one question.
    expect(screen.queryByRole("checkbox", { name: /^Wetsuit/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /^Drysuit/ })).toBeNull();
  });
});
