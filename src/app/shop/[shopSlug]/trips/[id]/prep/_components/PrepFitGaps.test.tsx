// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import { buildDivePrepChecklist } from "@/lib/dive-prep";
import { PrepFitGaps } from "./PrepFitGaps";
import {
  byText,
  diver,
  everyPanelPrep,
  heldPrep,
  spacingPx,
  t,
  tokens,
  viewOf,
} from "./prep-test-fixtures";

afterEach(cleanup);

function renderFitGaps(prep: TripPrep) {
  return render(<PrepFitGaps view={viewOf(prep)} />);
}

/**
 * **How the packing list is drawn** (docs/design/pixel-craft.md). jsdom has no
 * layout, so each case pins the classes whose arithmetic the pixel probe
 * measured wrong; the probe re-measures the pixels.
 */
describe("the packing list's geometry", () => {
  it("gives every diver's name that stands on its own line a 44px target, and keeps the line (K-146)", () => {
    const { container } = renderFitGaps(everyPanelPrep());
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const neverAsked = within(lead.nextElementSibling as HTMLElement).getAllByRole("link");
    expect(neverAsked.map((link) => link.textContent)).toEqual(["Theo Lindqvist", "Nadia Petrov"]);
    for (const link of neverAsked) {
      // The 44px floor, and the (44 − 20) / 2 handed back above and below, so
      // the 20px line the name sits on does not grow to 44.
      expect(tokens(link)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "-my-3"]));
    }
  });

  it("sets the never-asked run's rows a whole target apart, so a tap lands on the name it covers (K-146)", () => {
    const { container } = renderFitGaps(everyPanelPrep());
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const run = lead.nextElementSibling as HTMLElement;
    const rowGap = spacingPx(run, "gap-y");
    for (const link of within(run).getAllByRole("link")) {
      // Each target reaches its give-back above and below its line, and the
      // next row's reaches as far up. With the rows closer than twice that, a
      // wrapped row's targets cover the names above them, and the later one
      // in the DOM wins the tap: a diver's record opens for the name above.
      expect(rowGap, link.textContent ?? "").toBeGreaterThanOrEqual(2 * spacingPx(link, "-my"));
    }
  });

  it("holds no empty list open above the never-asked names (K-184)", () => {
    // Only divers nobody asked: the partial list has nothing to say.
    const prep = everyPanelPrep();
    prep.checklist = buildDivePrepChecklist({
      divers: [diver(4, "Theo Lindqvist"), diver(6, "Ana Costa")],
      plannedDives: 2,
      now: new Date("2026-09-26T12:00:00Z"),
    });
    const { container } = renderFitGaps(prep);
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const card = lead.closest("section") as HTMLElement;
    for (const list of card.querySelectorAll("ul")) {
      expect(list.children.length).toBeGreaterThan(0);
    }
    // The never-asked block is the body's first child, with no margin of its own.
    const block = lead.parentElement as HTMLElement;
    expect(block.previousElementSibling).toBeNull();
    expect(tokens(block).filter((token) => /^mt-/.test(token))).toEqual([]);
  });

  it("keeps the partial list and the never-asked block one gap apart when both are there (K-184)", () => {
    const { container } = renderFitGaps(everyPanelPrep());
    const block = byText(container, t("tripPrep.missingSizesNobodyAskedLead"))
      .parentElement as HTMLElement;
    expect(block.previousElementSibling?.tagName).toBe("UL");
    expect(tokens(block.parentElement)).toEqual(
      expect.arrayContaining(["flex", "flex-col", "gap-3"]),
    );
    expect(tokens(block).filter((token) => /^mt-/.test(token))).toEqual([]);
  });
});

describe("a held seat on the Gear tab (issue #2144)", () => {
  it("says what a held seat paid for", () => {
    const prep = heldPrep();
    prep.checklist = buildDivePrepChecklist({
      divers: [
        {
          bookingId: "held",
          personId: "p9",
          fullName: "Tom Marsh",
          fit: null,
          wantsNitrox: false,
          hasVerifiedNitroxCard: false,
          identityHeld: true,
          paidRentalKinds: ["regulator", "wetsuit"],
          lastDivedBand: null,
        },
      ],
      plannedDives: 2,
    });
    const { container } = renderFitGaps(prep);
    expect(
      within(container).getByText(
        t("tripPrep.heldSeatPaidFor", { name: "Tom Marsh", pieces: "Regulator and Wetsuit" }),
      ),
    ).toBeTruthy();
  });
});
