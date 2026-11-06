// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import type { MinimumSeatsState } from "@/lib/minimum-seats";
import { dayProfileFacts } from "./TripDayPlan";
import { TripPaperSheet } from "./TripPaperSheet";
import type { DiveBriefing, Shop, Trip, TripMeetingDay } from "./types";

afterEach(cleanup);

const t = diverTranslator("en-US");
const ZONE = "America/New_York";
const STARTS = new Date("2026-11-14T13:00:00Z");
const ENDS = new Date("2026-11-14T17:30:00Z");
const TRIP_ID = "7b0c7f8e-3a3a-4c55-9d0c-2f6a3b1f0a11";

const SHOP = {
  name: "Blue Mantis Divers",
  slug: "blue-mantis",
  timezone: ZONE,
  currency: "usd",
  depthUnit: "feet",
  contactPhone: "+1 305 555 0100",
  contactEmail: "dock@bluemantis.example",
  dockCallMinutes: 30,
} as unknown as Shop;

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    title: "Two-Tank Reef",
    startsAt: STARTS,
    endsAt: ENDS,
    priceCents: 9_500,
    cancellationWindowHours: 24,
    description: "Two shallow reefs, back by lunch.",
    meetingPointLabel: "Marina gate B",
    meetingPointAddress: "99 Ocean Dr, Key Largo",
    isPrivate: false,
    course: null,
    conditionsHold: false,
    diveMode: "boat",
    plannedDives: 2,
    participantTypes: ["diver"],
    ...overrides,
  } as unknown as Trip;
}

const BRIEFINGS = [
  {
    dive: { id: "d1", diveNumber: 1, title: null, travelMinutes: 20 },
    diveSite: { id: "s1", name: "Molasses Reef", maxDepthMeters: 12 },
    creatures: [{ id: "c1", slug: "green-moray", name: "Green moray" }],
  },
  {
    dive: { id: "d2", diveNumber: 2, title: null, travelMinutes: 10 },
    diveSite: null,
    creatures: [],
  },
] as unknown as DiveBriefing[];

const NONE: MinimumSeatsState = { kind: "none" };

function sheet(
  overrides: {
    trip?: Trip;
    status?: "sailed" | "full" | null;
    bearer?: boolean;
    minimumSeats?: MinimumSeatsState;
    meetingDays?: TripMeetingDay[];
  } = {},
) {
  const departure = overrides.trip ?? trip();
  return render(
    <TripPaperSheet
      shop={SHOP}
      trip={departure}
      meetingDays={overrides.meetingDays ?? []}
      locale="en-US"
      t={t}
      now={new Date("2026-11-10T15:00:00Z")}
      status={overrides.status ?? null}
      minimumSeats={overrides.minimumSeats ?? NONE}
      conditionsLine={<p>Water 78°F</p>}
      requirementSentence={null}
      briefings={BRIEFINGS}
      profile={dayProfileFacts(SHOP, departure, 1, null)}
      bearer={overrides.bearer ?? false}
    />,
  );
}

/**
 * **A departure on paper** (issue #2745): the public trip page, framed or
 * not, prints this one sheet and never its screen. It carries what a diver
 * reads before they buy; it never carries what the page reserves for a
 * booked diver or what a bearer link opened.
 */
describe("the departure's sheet", () => {
  it("is a print-only sheet that names the shop, the trip and its date with the year and zone", () => {
    const { container } = sheet();
    const frame = container.querySelector(".paper-sheet-frame");
    expect(frame).toHaveAttribute("data-paper-print-only");
    expect(container.querySelector(".paper-sheet")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Two-Tank Reef" })).toBeInTheDocument();
    expect(container).toHaveTextContent("Blue Mantis Divers");
    expect(container).toHaveTextContent(/2026/);
    expect(container).toHaveTextContent(/EST/);
    expect(container).toHaveTextContent("$95");
    expect(container).toHaveTextContent(t("common.perDiver"));
    expect(container).toHaveTextContent("Two shallow reefs, back by lunch.");
  });

  it("lists the day's dives with their depth and what to look for, and says an unset site", () => {
    const { container } = sheet();
    expect(container).toHaveTextContent(t("trip.theDay"));
    expect(container).toHaveTextContent("Molasses Reef");
    expect(container).toHaveTextContent("Green moray");
    expect(container).toHaveTextContent(t("trip.siteToBeConfirmed"));
    expect(container).toHaveTextContent("Water 78°F");
  });

  it("carries the terms and the shop's number and address as words, never as links", () => {
    const { container } = sheet();
    expect(container).toHaveTextContent(/Free cancellation until/);
    expect(container).toHaveTextContent("+1 305 555 0100");
    expect(container).toHaveTextContent("dock@bluemantis.example");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button, input, select, textarea, form")).toBeNull();
  });

  it("prints the departure's own address in the fold, with no query and no scheme", () => {
    const { container } = sheet();
    const fold = container.querySelector(".paper-sheet-fold");
    expect(fold).toHaveTextContent(`/s/blue-mantis/trips/${TRIP_ID}`);
    expect(fold?.textContent).not.toMatch(/https?:|\?/);
    expect(fold).toHaveTextContent(/As of .*2026/);
  });

  it("never prints the meeting point, which is a booked diver's", () => {
    const { container } = sheet();
    expect(container).not.toHaveTextContent("Marina gate B");
    expect(container).not.toHaveTextContent("99 Ocean Dr");
  });

  it("says a full boat, a sailed one and a conditions hold in words", () => {
    expect(sheet({ status: "full" }).container).toHaveTextContent(t("booking.fullHeading"));
    cleanup();
    expect(sheet({ status: "sailed" }).container).toHaveTextContent(t("booking.sailedHeading"));
    cleanup();
    expect(sheet({ trip: trip({ conditionsHold: true }) }).container).toHaveTextContent(
      t("trip.conditionsHoldHeading"),
    );
  });

  it("says a sailed boat sailed and nothing live: no hold, no cancellation window", () => {
    const { container } = sheet({ status: "sailed", trip: trip({ conditionsHold: true }) });
    expect(container).toHaveTextContent(t("booking.sailedHeading"));
    expect(container).not.toHaveTextContent(t("trip.conditionsHoldHeading"));
    expect(container).not.toHaveTextContent(/Free cancellation until/);
  });

  it("says the head count a short departure needs, and when it is decided", () => {
    const { container } = sheet({
      minimumSeats: {
        kind: "short",
        minimum: 4,
        shortfall: 2,
        decidesAt: new Date("2026-11-12T22:00:00Z"),
      },
    });
    expect(container).toHaveTextContent(/at least 4 divers/);
  });

  it("names every day of a multi-day departure with its year", () => {
    const days = [
      { id: "m1", dayNumber: 1, startsAt: STARTS, endsAt: ENDS },
      {
        id: "m2",
        dayNumber: 2,
        startsAt: new Date("2026-11-15T13:00:00Z"),
        endsAt: new Date("2026-11-15T17:30:00Z"),
      },
    ] as unknown as TripMeetingDay[];
    const { container } = sheet({ meetingDays: days });
    expect(container).toHaveTextContent(/Day 1 · .*2026/);
    expect(container).toHaveTextContent(/Day 2 · .*2026/);
  });

  it("names its departure on every page of a public link's paper", () => {
    const { container } = sheet();
    const identity = container.querySelector('[data-departure-paper="departure-public-trip"]');
    expect(identity).not.toBeNull();
    expect(identity?.querySelector("style")?.textContent).toContain("Two-Tank Reef");
  });

  it("prints a bearer link's page with no margin, so the browser has nowhere to write the link", () => {
    const { container } = sheet({ bearer: true });
    expect(container.querySelector("[data-departure-paper]")).toBeNull();
    const rule = container.querySelector("style[data-capability-print]");
    expect(rule?.textContent).toContain("@page{margin:0");
    // A named page kept alive from an earlier route cannot bring a margin back.
    expect(rule?.textContent).toContain("[data-departure-paper]{page:auto!important}");
  });
});
