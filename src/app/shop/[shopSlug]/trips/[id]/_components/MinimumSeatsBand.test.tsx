// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { staffTranslator } from "@/i18n/staff-messages";
import { MinimumSeatsBand } from "./MinimumSeatsBand";

afterEach(cleanup);

const t = staffTranslator("en-US");

/** A departure far enough out that its decision is still ahead: "short". */
const trip = {
  minimumBookings: 4,
  minimumDecisionHours: 24,
  startsAt: new Date("2099-01-10T13:00:00Z"),
  capacity: 12,
};

function renderBand(booked: number) {
  return render(
    <MinimumSeatsBand
      trip={trip}
      booked={booked}
      locale="en-US"
      timeZone="America/New_York"
      t={t}
    />,
  );
}

/**
 * **The band is a card in a tone** (pixel-craft class 3). It hand-rolled `p-5`
 * where every card on the roster is `p-4 sm:p-5`, so on a phone "MINIMUM HEAD
 * COUNT" and its heading started 4px right of the About and roster cards
 * above and below it (x 38 against 34 at 390), and it sat without the bed
 * every other panel rests on.
 */
describe("MinimumSeatsBand", () => {
  it("takes the tone panel's geometry, keeping its own tone", () => {
    const { container } = renderBand(1);
    const band = container.querySelector("section");
    expect(band).toHaveClass(...TONE_PANEL_CLASS.split(" "), "border-warning/40", "bg-warning/10");
    expect(band).not.toHaveClass("p-5");
  });

  /**
   * A heading that wraps shares its words between its lines (pixel-craft
   * class 8, K-543): at 390 "3 divers short of the 6 this departure needs"
   * left "needs" alone on the second line. The app ramp leaves balance to
   * each heading that wraps, and this one does.
   */
  it("balances its heading's lines", () => {
    const { getByRole } = renderBand(1);
    expect(getByRole("heading", { level: 2 })).toHaveClass("text-balance");
  });

  it("says nothing once the departure has its head count", () => {
    const { container } = renderBand(4);
    expect(container).toBeEmptyDOMElement();
  });
});
