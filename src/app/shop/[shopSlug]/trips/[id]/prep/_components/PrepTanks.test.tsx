// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import { PrepTanks, tanksLine } from "./PrepTanks";
import { heldPrep, prepFor, t, viewOf } from "./prep-test-fixtures";

afterEach(cleanup);

/**
 * The section alone, with the nitrox split shown when `PrepBody` would show
 * it for a shop that sells no nitrox: when the departure has a nitrox seat.
 */
function renderTanks(prep: TripPrep) {
  const showNitrox = prep.checklist.tanks.nitrox > 0 || prep.checklist.nitroxBlockers.length > 0;
  return render(<PrepTanks view={viewOf(prep)} showNitrox={showNitrox} />);
}

describe("PrepTanks", () => {
  it("states where the tank total comes from, beside the total", () => {
    // The two facts a crew argues about, and the reason this line exists at
    // all: `/prep`'s page header used to carry it and the departure page has
    // no such header, so "6" stood over a roster of two with nothing on
    // screen saying the number is per *dive* and that the diving crew's own
    // tanks are in it (dive-domain review 20260920).
    renderTanks(prepFor());
    const derivation = screen.getByText(/one tank per diver per dive/);
    expect(derivation.textContent).toContain("2 divers");
    expect(derivation.textContent).toContain("1 diving crew member");
    expect(derivation.textContent).toContain("2 dives");
    // (2 divers + 1 diving crew) × 2 dives — the arithmetic that sentence
    // names, as one line (B54): no nitrox on this boat, so nitrox is unsaid.
    expect(screen.getByText("6 tanks, air")).toBeInTheDocument();
    expect(screen.queryByText(/nitrox/i)).toBeNull();
  });

  it("names nitrox only when a cylinder on the departure is nitrox (B54)", () => {
    expect(tanksLine(t, { total: 6, air: 4, nitrox: 2 }, true)).toBe("6 tanks: 4 air, 2 nitrox");
    expect(tanksLine(t, { total: 6, air: 6, nitrox: 0 }, true)).toBe("6 tanks, air");
    expect(tanksLine(t, { total: 1, air: 1, nitrox: 0 }, false)).toBe("1 tank, air");
  });
});

describe("a held seat on the Gear tab (issue #2144)", () => {
  it("sends the nitrox question to the roster row, never to the matched diver's record", () => {
    // The card on the matched record may be somebody else's; the first job is
    // the identity question on the seat's own row (dive-domain review).
    const { container } = renderTanks(heldPrep());
    const link = within(container).getByRole("link", {
      name: new RegExp(t("tripPrep.nitroxConfirmIdentityFirst")),
    });
    expect(link.getAttribute("href")).toMatch(/\/trips\/[^/#]+#booking-held$/);
    expect(container.querySelector('a[href*="/divers/p9"]')).toBeNull();
  });
});
