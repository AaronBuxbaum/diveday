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
  otaFootnote: "Assumes {share} of bookings come through OTAs.",
  otaSource: "Source: Arival",
  totalNote: "{percent} of the month",
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
  it("shows a single total per column, the OTA line footnoted with its source", () => {
    renderIt();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(1);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(/Marketplace/)).toBeNull();
    // $30,000: 37% through the agencies ($11,100), the rest direct ($18,900).
    const booking = screen.getByRole("row", { name: /Booking fee/ });
    expect(booking.textContent).toContain("6% ($1,134)");
    expect(booking.textContent).toContain("1% ($189)");
    const ota = screen.getByRole("row", { name: /OTA booking fee/ });
    expect(ota.textContent).toContain("2% ($222)");
    expect(screen.getByText("(estimated)")).toBeTruthy();
    expect(screen.getByText(/Assumes 37% of bookings/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Source: Arival" });
    expect(link.getAttribute("href")).toBe(
      "https://arival.travel/article/direct-bookings-dive-otas-rise/",
    );
  });
});
