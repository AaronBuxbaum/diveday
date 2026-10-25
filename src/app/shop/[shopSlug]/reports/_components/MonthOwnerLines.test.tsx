// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { DepartureMoney } from "./DepartureMoney";
import { WeatherLine } from "./MonthOwnerLines";

afterEach(cleanup);

const t = staffTranslator("en-US");
const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;

describe("WeatherLine (item 27)", () => {
  it("says what the weather called off", () => {
    render(
      <WeatherLine
        weather={{ departures: 3, days: 2, divers: 26, refundedCents: 184_000, moved: 9 }}
        t={t}
        money={money}
      />,
    );
    expect(
      screen.getByText(
        "Weather called off 3 departures: 26 divers, $1840 refunded, 9 moved to another date.",
      ),
    ).toBeTruthy();
  });

  it("says nothing in a month the weather left alone", () => {
    const { container } = render(
      <WeatherLine
        weather={{ departures: 0, days: 0, divers: 0, refundedCents: 0, moved: 0 }}
        t={t}
        money={money}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("DepartureMoney (item 26)", () => {
  const trip = {
    tripId: "a",
    title: "Reef",
    startsAt: new Date("2026-10-03T13:00:00Z"),
    capacity: 12,
    activeBookings: 9,
    waiverComplete: 9,
    netCents: 85_500,
    boatName: "Mantis I",
    kindName: "Two-tank reef",
    isCourse: false,
  };

  it("draws a line per hull and one by kind of trip", () => {
    render(
      <DepartureMoney
        trips={[trip, { ...trip, tripId: "b", kindName: null, isCourse: true, netCents: 34_000 }]}
        timeZone="America/New_York"
        t={t}
        money={money}
      />,
    );
    expect(screen.getByText("Mantis I")).toBeTruthy();
    expect(screen.getByText("$1195")).toBeTruthy();
    expect(screen.getByText(/1 day out · 75% full/)).toBeTruthy();
    expect(screen.getByText(/Two-tank reef \$855/)).toBeTruthy();
    expect(screen.getByText(/Courses\s\$340/)).toBeTruthy();
  });

  it("renders nothing when no departure named a boat or a kind", () => {
    const { container } = render(
      <DepartureMoney
        trips={[{ ...trip, boatName: null, kindName: null }]}
        timeZone="UTC"
        t={t}
        money={money}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
