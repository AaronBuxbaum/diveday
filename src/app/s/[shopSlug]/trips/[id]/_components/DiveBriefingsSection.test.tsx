// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { DiveBriefingsSection } from "./DiveBriefingsSection";
import type { DiveBriefing, Trip } from "./types";

/**
 * What the briefings block puts on screen, and when.
 *
 * Two regressions from the 2026-08-06 review live here. The compare table used
 * to render for any two dives that merely *had* a site, so a two-tank day on
 * one mooring got a table of two identical rows; and the swipe hint sat in the
 * section header above that table, reading as an instruction for a table
 * rather than for the card deck further down.
 */

afterEach(() => {
  cleanup();
});

const trip = { plannedDives: 2 } as Trip;

/**
 * The three fields this component reads off a briefing. The real row is a
 * whole `trip_dives` join carrying far more than the block renders, so it is
 * narrowed here rather than fabricated in full.
 */
function briefing(diveId: string, site: { id: string; name: string } | null): DiveBriefing {
  return {
    dive: { id: diveId, diveNumber: 1, title: `Dive ${diveId}`, description: null },
    diveSite: site ? { ...site, locationName: null, landmarks: [] } : null,
    creatures: [],
    moments: [],
  } as unknown as DiveBriefing;
}

function renderSection(briefings: DiveBriefing[], leadWithFieldGuide = false) {
  render(
    <DiveBriefingsSection
      briefings={briefings}
      trip={trip}
      leadWithFieldGuide={leadWithFieldGuide}
      locale={DEFAULT_DIVER_LOCALE}
    />,
  );
}

/** A briefing whose site carries species photos, which is what #760 is about. */
function briefingWithSpecies(diveId: string): DiveBriefing {
  return {
    ...briefing(diveId, { id: "site-a", name: "Molasses Reef" }),
    creatures: [
      {
        id: "creature-1",
        slug: "stoplight-parrotfish",
        name: "Stoplight parrotfish",
        scientificName: "Sparisoma viride",
        kind: "Fish",
        description: "Grazes the reef in daylight.",
        preparationTip: "Hang back and it carries on.",
        imageUrl: "/marine-life/stoplight-parrotfish.jpg",
      },
    ],
  } as unknown as DiveBriefing;
}

/**
 * **The only photography on the page a diver buys from** sat inside a
 * default-closed disclosure, whose summary read "What to look for down there ·
 * 3 landmarks · 8 species" (issue #760). It leads for a diver who is still
 * deciding and stays folded for one who has already paid — the split the page
 * comment about the seat coming first was actually arguing for.
 */
describe("the field guide", () => {
  it("leads, outside the disclosure, for a diver who has not booked", () => {
    renderSection([briefingWithSpecies("d1")], true);

    const heading = screen.getByRole("heading", { name: "A few faces to learn" });
    expect(heading.closest("details")).toBeNull();
    // And the disclosure does not advertise species it no longer holds.
    expect(screen.queryByText(/1 species/)).not.toBeInTheDocument();
  });

  it("stays folded for a diver who has already paid", () => {
    renderSection([briefingWithSpecies("d1")], false);

    const heading = screen.getByRole("heading", { name: "A few faces to learn" });
    expect(heading.closest("details")).not.toBeNull();
  });
});

describe("compare the sites", () => {
  it("compares two dives at different sites", () => {
    renderSection([
      briefing("d1", { id: "site-a", name: "Molasses Reef" }),
      briefing("d2", { id: "site-b", name: "Christ of the Abyss" }),
    ]);

    const summary = screen.getByText("Compare the sites");
    expect(summary).toBeInTheDocument();
    // Read the table out of the DOM rather than by role: it sits inside a
    // closed `<details>`, which jsdom keeps out of the accessibility tree.
    const rows = Array.from(
      summary.closest("details")?.querySelectorAll("tbody th") ?? [],
      (cell) => cell.textContent,
    );
    expect(rows).toEqual(["Molasses Reef", "Christ of the Abyss"]);
  });

  it("stays away when both dives are at the same site", () => {
    renderSection([
      briefing("d1", { id: "site-a", name: "Molasses Reef" }),
      briefing("d2", { id: "site-a", name: "Molasses Reef" }),
    ]);

    expect(screen.queryByText("Compare the sites")).not.toBeInTheDocument();
  });

  it("stays away when only one dive has a site at all", () => {
    renderSection([briefing("d1", { id: "site-a", name: "Molasses Reef" }), briefing("d2", null)]);

    expect(screen.queryByText("Compare the sites")).not.toBeInTheDocument();
  });
});

describe("the swipe hint", () => {
  it("sits below the compare block, next to the cards it describes", () => {
    renderSection([
      briefing("d1", { id: "site-a", name: "Molasses Reef" }),
      briefing("d2", { id: "site-b", name: "Christ of the Abyss" }),
    ]);

    const hint = screen.getByText(/Swipe to explore each dive/);
    const compare = screen.getByText("Compare the sites");
    // `DOCUMENT_POSITION_FOLLOWING`: the hint comes after the compare summary
    // in document order, which is what "below it on the page" means here.
    expect(compare.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is absent for a single-dive day, which has nothing to swipe", () => {
    renderSection([briefing("d1", { id: "site-a", name: "Molasses Reef" })]);

    expect(screen.queryByText(/Swipe to explore each dive/)).not.toBeInTheDocument();
  });
});

describe("conservation note", () => {
  it("renders when the site carries a conservation note", () => {
    const brief = {
      ...briefing("d1", { id: "site-a", name: "Molasses Reef" }),
      diveSite: {
        id: "site-a",
        name: "Molasses Reef",
        locationName: null,
        landmarks: [],
        conservationNote: "Protected sanctuary zone. Maintain neutral buoyancy.",
      },
    } as unknown as DiveBriefing;

    renderSection([brief], true);
    expect(screen.getByText("Conservation note")).toBeInTheDocument();
    expect(
      screen.getByText("Protected sanctuary zone. Maintain neutral buoyancy."),
    ).toBeInTheDocument();
  });
});
