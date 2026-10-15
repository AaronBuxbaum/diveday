// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { EveningReadings, TomorrowFromTonight } from "./TomorrowFromTonight";

afterEach(cleanup);

describe("TomorrowFromTonight", () => {
  it("says tomorrow's load-out and prints tomorrow, never a free date", () => {
    render(
      <TomorrowFromTonight
        loadOut={{ departures: 2, tanks: { total: 42, air: 36, nitrox: 6 }, rentalPieces: 29 }}
        shopSlug="blue-mantis"
        t={staffTranslator("en-US")}
      />,
    );
    expect(screen.getByRole("heading", { name: "Tomorrow from tonight" })).toBeTruthy();
    expect(
      screen.getByText(
        "42 tanks to fill (36 air, 6 nitrox) · 29 rental pieces to pick · 2 departures",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Print tomorrow" }).getAttribute("href")).toBe(
      "/shop/blue-mantis/print?day=tomorrow",
    );
  });

  it("says tomorrow before the day is closing, and keeps the takings for when it is", () => {
    const loadOut = { departures: 1, tanks: { total: 8, air: 8, nitrox: 0 }, rentalPieces: 3 };
    const reading = (closing: boolean) =>
      ({
        close: { closing, tomorrow: loadOut },
        takings: { revenueCents: 123_450, tipsCents: 0, importedRecordCount: 0, boatTips: [] },
      }) as never;
    const props = {
      currency: "USD",
      locale: "en-US",
      timeZone: "America/New_York",
      shopSlug: "blue-mantis",
      t: staffTranslator("en-US"),
    };
    const { rerender } = render(<EveningReadings evening={reading(false)} {...props} />);
    expect(screen.getByRole("heading", { name: "Tomorrow from tonight" })).toBeTruthy();
    const takings = () => document.getElementById("day-takings-label");
    expect(takings()).toBeNull();
    rerender(<EveningReadings evening={reading(true)} {...props} />);
    expect(takings()).not.toBeNull();
  });
});
