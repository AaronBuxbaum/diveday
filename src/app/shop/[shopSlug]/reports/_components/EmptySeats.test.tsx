// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { departuresWithEmptySeats } from "@/lib/open-seats";
import { EmptySeats } from "./EmptySeats";

afterEach(cleanup);

const NOW = new Date("2026-08-20T12:00:00Z");
const departure = (
  tripId: string,
  title: string,
  capacity: number,
  booked: number,
  day: number,
) => ({
  tripId,
  title,
  capacity,
  booked,
  startsAt: new Date(Date.UTC(2026, 7, day, 11)),
});

function show(locale: "en-US" | "es-ES", summary = departuresWithEmptySeats([], NOW)) {
  return render(
    <EmptySeats
      summary={summary}
      shopSlug="blue-mantis"
      t={staffTranslator(locale)}
      locale={locale}
      timeZone="UTC"
    />,
  );
}

describe("EmptySeats", () => {
  const summary = departuresWithEmptySeats(
    [departure("t1", "Two-Tank Reef", 12, 8, 3), departure("t2", "Night Dive", 6, 1, 9)],
    NOW,
  );

  it("counts the month and links each departure to its own page", () => {
    show("en-US", summary);
    const section = screen.getByRole("region", { name: "Departures that left with empty seats" });
    expect(within(section).getByText("2 departures left with 9 seats unsold")).toBeTruthy();
    const night = within(section).getByRole("link", { name: /Night Dive/ });
    expect(night.getAttribute("href")).toBe("/shop/blue-mantis/trips/t2");
    expect(within(section).getByText("5 seats")).toBeTruthy();
    expect(within(section).getByText("4 seats")).toBeTruthy();
  });

  it("speaks Spanish too", () => {
    show("es-ES", summary);
    expect(screen.getByText("2 salidas zarparon con 9 plazas sin vender")).toBeTruthy();
  });

  it("renders nothing for a month where every boat filled", () => {
    const { container } = show("en-US");
    expect(container.innerHTML).toBe("");
  });
});
