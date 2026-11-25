// @vitest-environment jsdom
// i18n-exempt-file: test fixture names are seeded data.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GearToPack } from "@/features/trips/trip-prep";
import { staffTranslator } from "@/i18n/staff-messages";
import { CheckInQuietLine, GearToPackCard, TomorrowsWaterCard, TripFactsLine } from "./phase-cards";

const t = staffTranslator("en-US");
afterEach(cleanup);

const gear = (over: Partial<GearToPack> = {}): GearToPack => ({
  tanks: { air: 10, nitrox: 2 },
  rentals: { total: 4, sized: 3, fitAtCheckIn: ["Ana Ruiz"] },
  weights: { unsaid: [] },
  lunch: 6,
  pickups: 0,
  ...over,
});

describe("the trip's facts while it fills", () => {
  const line = () => {
    const found = document.querySelector("[data-trip-facts]");
    if (!(found instanceof HTMLElement)) throw new Error("no facts line");
    return found;
  };

  it("is one line of facts, each the door to its own section of Edit trip", () => {
    render(
      <TripFactsLine
        crew={["Sal Moretti"]}
        plan={["Blue Hole", "Coral Garden"]}
        price="$95.00"
        whoCanBook="Anyone"
        editHref={(section) => `/trip?view=edit#${section}`}
        locale="en-US"
        t={t}
      />,
    );
    const door = (name: string) => within(line()).getByRole("link", { name });
    expect(door("Edit · Crew: Sal Moretti")).toHaveAttribute("href", "/trip?view=edit#crew");
    expect(door("Edit · Plan: Blue Hole and Coral Garden")).toHaveAttribute(
      "href",
      "/trip?view=edit#dives",
    );
    expect(door("Edit · Price: $95.00")).toHaveAttribute("href", "/trip?view=edit#about");
    expect(door("Edit · Who can book: Anyone")).toHaveAttribute(
      "href",
      "/trip?view=edit#requirements",
    );
    expect(within(line()).queryByText(/^Add /)).toBeNull();
  });

  it("names everything not set in one link, to the first of it, with no Not set apiece", () => {
    render(
      <TripFactsLine
        crew={[]}
        plan={[]}
        price={null}
        whoCanBook="Open Water or higher"
        editHref={(section) => `/trip?view=edit#${section}`}
        locale="en-US"
        t={t}
      />,
    );
    expect(within(line()).getByRole("link", { name: "Add crew, plan, and price" })).toHaveAttribute(
      "href",
      "/trip?view=edit#crew",
    );
    expect(within(line()).queryByText("Not set")).toBeNull();
    expect(within(line()).getAllByRole("link")).toHaveLength(2);
  });

  it("names only what is missing: a trip with crew and plan but no price", () => {
    render(
      <TripFactsLine
        crew={["Sal Moretti"]}
        plan={["Blue Hole"]}
        price={null}
        whoCanBook="Anyone"
        editHref={(section) => `/trip?view=edit#${section}`}
        locale="en-US"
        t={t}
      />,
    );
    expect(within(line()).getByRole("link", { name: "Add price" })).toHaveAttribute(
      "href",
      "/trip?view=edit#about",
    );
  });
});

describe("Gear to pack, the day before", () => {
  it("reads the Gear page's list as short lines, with the pull list a tap away", () => {
    render(
      <GearToPackCard gear={gear()} prepHref="/prep" buddyTeamsHref={null} locale="en-US" t={t} />,
    );
    const card = screen.getByRole("region", { name: "Gear to pack" });
    expect(within(card).getByText("10 air, 2 nitrox")).toBeVisible();
    expect(within(card).getByText(/3 of 4 sized/)).toBeVisible();
    expect(within(card).getByText("Fit at check-in: Ana Ruiz")).toBeVisible();
    expect(within(card).getByText("Everyone has said")).toBeVisible();
    expect(within(card).getByText("6 lunches")).toBeVisible();
    expect(within(card).getByRole("link", { name: "Pull list" })).toHaveAttribute("href", "/prep");
    expect(within(card).queryByRole("link", { name: "Buddy teams" })).toBeNull();
  });

  it("links the buddy teams when the shop runs them, and says when nobody rents", () => {
    render(
      <GearToPackCard
        gear={gear({
          rentals: { total: 0, sized: 0, fitAtCheckIn: [] },
          weights: null,
          lunch: null,
        })}
        prepHref="/prep"
        buddyTeamsHref="/manifest"
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText("Nobody rents")).toBeVisible();
    expect(screen.queryByText("Lunch")).toBeNull();
    expect(screen.getByRole("link", { name: "Buddy teams" })).toHaveAttribute("href", "/manifest");
  });
});

describe("Tomorrow's water", () => {
  const units = {
    locale: "en-US",
    timezone: "America/New_York",
    temperatureUnit: "celsius" as const,
    depthUnit: "meters" as const,
    t,
  };

  it("says plainly when no forecast answered, and keeps the weather call", async () => {
    render(
      await TomorrowsWaterCard({
        ...units,
        automatedForecast: Promise.resolve(null),
        tideLines: Promise.resolve([]),
        callOffHref: "/trip?blowout=1",
      }),
    );
    const card = screen.getByRole("region", { name: "Tomorrow’s water" });
    expect(within(card).getByText("No forecast for these sites")).toBeVisible();
    expect(within(card).getByRole("link", { name: "Call it off for weather" })).toHaveAttribute(
      "href",
      "/trip?blowout=1",
    );
  });

  it("shows the tide, and no weather call on a trip already called off", async () => {
    render(
      await TomorrowsWaterCard({
        ...units,
        automatedForecast: Promise.resolve(null),
        tideLines: Promise.resolve([{ site: "Blue Hole", text: "High tide at 9:12 AM" }]),
        callOffHref: null,
      }),
    );
    expect(screen.queryByText("No forecast for these sites")).toBeNull();
    expect(screen.getByText("High tide at 9:12 AM")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Call it off for weather" })).toBeNull();
  });
});

describe("Check-in's quiet line", () => {
  it("says gear, crew and what comes next, and links roll call", () => {
    render(
      <CheckInQuietLine
        rentalSets={3}
        crew={[]}
        water={null}
        rollCall={{
          at: new Date("2026-11-18T12:30:00Z"),
          href: "/manifest",
          locale: "en-US",
          timeZone: "America/New_York",
        }}
        t={t}
      />,
    );
    expect(screen.getByText("3 rental sets")).toBeVisible();
    expect(screen.getByText("nobody yet")).toBeVisible();
    expect(screen.queryByText("Water")).toBeNull();
    expect(screen.getByRole("link", { name: /roll call at the dock, 7:30/ })).toHaveAttribute(
      "href",
      "/manifest",
    );
  });
});
