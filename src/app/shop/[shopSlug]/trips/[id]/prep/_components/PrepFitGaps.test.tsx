// @vitest-environment jsdom

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripPrep } from "@/db/trips";
import { buildDivePrepChecklist } from "@/lib/dive-prep";
import { PrepFitGaps } from "./PrepFitGaps";
import { byText, diver, everyPanelPrep, heldPrep, t, tokens, viewOf } from "./prep-test-fixtures";

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
  it("names every never-asked diver in one paragraph, as a comma list of links (B54)", () => {
    const { container } = renderFitGaps(everyPanelPrep());
    const lead = byText(container, t("tripPrep.missingSizesNobodyAskedLead"));
    const paragraph = lead.parentElement as HTMLElement;
    expect(paragraph.tagName).toBe("P");
    const names = within(paragraph).getAllByRole("link");
    expect(names.map((link) => link.textContent)).toEqual(["Theo Lindqvist", "Nadia Petrov"]);
    expect(paragraph.textContent).toContain("Theo Lindqvist, Nadia Petrov");
    expect(paragraph.querySelector("ul")).toBeNull();
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
