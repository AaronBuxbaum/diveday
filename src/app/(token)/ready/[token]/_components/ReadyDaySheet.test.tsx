// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArrivalCardShop, ArrivalCardTrip } from "@/components/arrival-card-facts";
import { diverTranslator } from "@/i18n/messages";
import ReadyTokenLayout from "../layout";
import { ReadyDaySheet } from "./ReadyDaySheet";
import type { MastheadFacts } from "./ReadyMasthead";

vi.mock("@/app/_components/RetryReturningDiverMemory", () => ({
  RetryReturningDiverMemory: () => null,
}));

afterEach(cleanup);

const t = diverTranslator("en-US");
const ZONE = "America/New_York";
const STARTS = new Date("2026-11-14T13:00:00Z");
const ENDS = new Date("2026-11-14T17:30:00Z");

const SHOP: ArrivalCardShop = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: ZONE,
  contactPhone: "+1 305 555 0100",
  contactEmail: "dock@bluemantis.example",
  address: {
    street: "1 Harbor Way",
    locality: "Key Largo",
    region: "FL",
    postalCode: "33037",
    country: "US",
  },
};

const TRIP: ArrivalCardTrip = {
  id: "7b0c7f8e-3a3a-4c55-9d0c-2f6a3b1f0a11",
  title: "Two-Tank Reef",
  startsAt: STARTS,
  endsAt: ENDS,
  meetingPointLabel: "Marina gate B",
  meetingPointAddress: "99 Ocean Dr, Key Largo",
  arrivalLandmark: "The red lighthouse",
  arrivalParkingNote: "Free lot behind the shop",
  arrivalTransitNote: null,
  arrivalLookFor: "The blue flag",
  arrivalFirstInteraction: null,
  arrivalPhotoUrl: "https://example.com/dock.jpg",
};

function facts(pickup: MastheadFacts["pickup"] = { time: null, location: null }): MastheadFacts {
  return {
    shop: { name: SHOP.name, slug: SHOP.slug, timezone: ZONE, dockCallMinutes: 30 },
    trip: { id: TRIP.id, title: TRIP.title, startsAt: STARTS, endsAt: ENDS },
    pickup,
  };
}

function sheet(overrides: { pickup?: MastheadFacts["pickup"] } = {}) {
  return render(
    <ReadyDaySheet
      t={t}
      locale="en-US"
      facts={facts(overrides.pickup)}
      arrival={{ shop: SHOP, trip: TRIP }}
      sites={["Molasses Reef", "French Reef"]}
      packing={<p>Pack the lists here</p>}
      asOf={new Date("2026-11-10T15:00:00Z")}
    />,
  );
}

/**
 * **The diver's day on paper** (issue #2745): the thread prints this sheet and
 * never its screen. What it carries is what the paper pass and the saved
 * arrival card carry; what it must never carry is what makes the thread a
 * bearer page.
 */
describe("the diver's day sheet", () => {
  it("is a print-only sheet, so the thread prints it and never its screen", () => {
    const { container } = sheet();
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame).not.toBeNull();
    expect(frame?.hasAttribute("data-paper-print-only")).toBe(true);
    expect(frame?.querySelector(".paper-sheet")).not.toBeNull();
  });

  it("says when, with the year and the zone, and when to be at the dock", () => {
    const { container } = sheet();
    const text = container.textContent ?? "";
    expect(text).toContain("Two-Tank Reef");
    expect(text).toContain("2026");
    expect(text).toMatch(/EST|ET|GMT/);
    expect(text).toContain("Aim to be at the dock by 7:30");
    // Paper outlives the morning: no "Tomorrow" or "Today" on it.
    expect(text).not.toMatch(/Tomorrow|Today/);
  });

  it("names the pickup time in place of the dock call, and never the hotel", () => {
    const { container } = sheet({ pickup: { time: "7:00 AM", location: "Reef Hotel, room 214" } });
    expect(container.textContent).toContain("7:00 AM pickup at your hotel");
    expect(container.textContent).not.toContain("Reef Hotel");
    expect(container.textContent).not.toContain("Aim to be at the dock");
  });

  it("says the paper is a snapshot and the paperwork is checked in person", () => {
    const { container } = sheet();
    expect(container.textContent).toContain(t("ready.sheetCheck"));
  });

  it("says where to go as the arrival card does, and the planned sites", () => {
    sheet();
    expect(screen.getByText("Marina gate B")).toBeInTheDocument();
    expect(screen.getByText("99 Ocean Dr, Key Largo")).toBeInTheDocument();
    expect(screen.getByText("The red lighthouse")).toBeInTheDocument();
    expect(screen.getByText("The blue flag")).toBeInTheDocument();
    expect(screen.getByText("Free lot behind the shop")).toBeInTheDocument();
    expect(screen.getByText(/Molasses Reef/)).toBeInTheDocument();
    expect(screen.getByText("Pack the lists here")).toBeInTheDocument();
  });

  it("prints the shop's contact as words, with nothing that taps", () => {
    const { container } = sheet();
    expect(container.textContent).toContain("+1 305 555 0100");
    expect(container.textContent).toContain("dock@bluemantis.example");
    expect(
      container.querySelectorAll("a, button, form, input, select, textarea, iframe, img"),
    ).toHaveLength(0);
  });

  it("carries no bearer link, no booking id and no readiness", () => {
    const { container } = sheet();
    const html = container.innerHTML;
    expect(html).not.toContain("/ready/");
    expect(html).not.toContain(TRIP.id);
    expect(container.textContent).not.toMatch(/waiver|checklist|medical/i);
  });

  it("prints every state of the link with no margin for the browser to write it in", () => {
    // The route's layout, not the sheet: the page prints before the sheet
    // streams in, and a terminal card has none.
    const { container } = render(
      <ReadyTokenLayout>
        <p>a terminal card</p>
      </ReadyTokenLayout>,
    );
    const rules = [...container.querySelectorAll("style")].map((style) => style.textContent);
    expect(rules.join("")).toContain("@page{margin:0");
  });

  it("dates itself on the fold to the minute, in the shop's zone", () => {
    const { container } = sheet();
    const fold = container.querySelector(".paper-sheet-fold");
    // `keepUnitsWhole` binds the parts with no-break spaces.
    expect(fold?.textContent).toMatch(/As of Nov\s10,\s10:00\sAM\sEST/u);
    expect(fold?.textContent).toContain("/s/blue-mantis");
  });
});
