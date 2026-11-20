// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeeComparison, type FeeComparisonLabels } from "./FeeComparison";

const labels: FeeComparisonLabels = {
  sliderLabel: "Money received",
  subscription: "Subscription fee",
  free: "Free",
  bookingFee: "Booking fee",
  otaFee: "OTA booking fee",
  processing: "Card transaction fee",
  total: "Each month",
  totalNote: "{percent} of the month",
  otaFootnote: "Assumes {share} of bookings come through OTAs.",
  otaSource: "Source: Arival",
  systems: {
    fareharbor: { name: "FareHarbor", estimated: "(estimated)" },
    diveday: { name: "DiveDay" },
  },
};

const renderIt = () =>
  render(
    <FeeComparison
      labels={labels}
      locale="en-US"
      diveDay={{ monthlyCents: 0, basisPoints: 100 }}
    />,
  );

afterEach(cleanup);

describe("FeeComparison", () => {
  it("takes each percent off the whole $30,000, the same amount in both columns", () => {
    renderIt();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(1);
    expect(screen.queryByRole("switch")).toBeNull();
    const booking = screen.getByRole("row", { name: /Booking fee/ });
    expect(booking.textContent).toContain("6% ($1,800)");
    expect(booking.textContent).toContain("1% ($300)");
    // 37% of $30,000 comes through the agencies: 2% of $11,100, on top.
    const ota = screen.getByRole("row", { name: /OTA booking fee/ });
    expect(ota.textContent).toContain("2% ($222)");
    expect(screen.getByText(/Assumes 37% of bookings/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source: Arival" }).getAttribute("href")).toBe(
      "https://arival.travel/article/direct-bookings-dive-otas-rise/",
    );
    expect(screen.getByText("(estimated)")).toBeTruthy();
  });
});
