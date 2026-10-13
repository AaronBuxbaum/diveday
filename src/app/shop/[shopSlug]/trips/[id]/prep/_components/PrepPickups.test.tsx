// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import { PrepPickups } from "./PrepPickups";
import { everyPanelPrep, t, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

function renderPickups(prep: TripPrep) {
  return render(<PrepPickups view={viewOf(prep)} />);
}

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
describe("the packing list's geometry", () => {
  it("heads the hotel pickups table with the one row THead draws", () => {
    // `THead` wraps its cells in its own `<tr>`; a second one inside it makes
    // a row in a row, which a browser draws as a table squeezed into the
    // first column, under a header row that has lost its column voice.
    const { container } = renderPickups(everyPanelPrep());
    const hotel = within(container).getByRole("columnheader", {
      name: t("tripPrep.pickupHotelColumn"),
    });
    const head = hotel.closest("thead") as HTMLElement;
    expect(head.querySelectorAll("tr")).toHaveLength(1);
    expect(hotel.parentElement?.parentElement).toBe(head);
  });
});
