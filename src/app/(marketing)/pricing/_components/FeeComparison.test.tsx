// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeeComparison, type FeeComparisonLabels } from "./FeeComparison";

const labels: FeeComparisonLabels = {
  sliderLabel: "Money received",
  subscription: "Subscription fee",
  free: "Free",
  bookingFee: "Booking fee",
  processing: "Card transaction fee",
  total: "Each month",
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
  it("takes each percent off the whole $30,000, the same amount in both columns", () => {
    renderIt();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(1);
    expect(screen.queryByRole("switch")).toBeNull();
    const booking = screen.getByRole("row", { name: /Booking fee/ });
    expect(booking.textContent).toContain("6% ($1,800)");
    expect(booking.textContent).toContain("1% ($300)");
    expect(screen.queryByRole("row", { name: /OTA/ })).toBeNull();
    expect(screen.getByText("(estimated)")).toBeTruthy();
  });
});
