// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { QuietDay } from "./QuietDay";

afterEach(cleanup);

const props = {
  shopSlug: "blue-mantis",
  nextDeparture: {
    tripId: "trip-tue",
    title: "Tuesday two-tank",
    startsAt: new Date("2026-09-01T12:00:00Z"),
    booked: 8,
    sellableCapacity: 8,
  },
  locale: "en-US",
  timeZone: "America/New_York",
  t: staffTranslator("en-US"),
};

describe("QuietDay", () => {
  it("says tomorrow's load-out and prints tomorrow on a no-boat day before a ready one", () => {
    render(
      <QuietDay
        {...props}
        loadOut={{ departures: 1, tanks: { total: 16, air: 12, nitrox: 4 }, rentalPieces: 6 }}
      />,
    );
    expect(screen.getByRole("link", { name: "Add a departure" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tomorrow from tonight" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Print tomorrow" }).getAttribute("href")).toBe(
      "/shop/blue-mantis/print?day=tomorrow",
    );
  });

  it("says nothing of tomorrow when tomorrow has no load-out", () => {
    render(<QuietDay {...props} loadOut={null} />);
    expect(screen.queryByRole("heading", { name: "Tomorrow from tonight" })).toBeNull();
  });
});
