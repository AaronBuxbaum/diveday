// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeeComparison, type FeeComparisonLabels } from "./FeeComparison";

const labels: FeeComparisonLabels = {
  sliderLabel: "Money received",
  marketplaceToggle: "Include marketplaces",
  marketplaceShareLabel: "Share through them",
  subscription: "Subscription fee",
  free: "Free",
  bookingFee: "Booking fee",
  otaFee: "OTA booking fee",
  processing: "Card processing",
  marketplace: "Marketplace commission",
  total: "Each month",
  range: "{low} to {high}",
  totalNote: "{percent} of the month",
  saving: "Moving a sale keeps {low} to {high}",
  systems: {
    fareharbor: { name: "FareHarbor", note: "note" },
    diveday: { name: "DiveDay", note: "note" },
  },
};

const renderIt = () =>
  render(
    <FeeComparison
      labels={labels}
      locale="en-US"
      diveDay={{ monthlyCents: 0, basisPoints: 200 }}
      saving={{ low: 0.099, high: 0.249 }}
    />,
  );

afterEach(cleanup);

describe("FeeComparison", () => {
  it("shows a single total per column and Free for a zero subscription", () => {
    renderIt();
    expect(screen.getAllByText("Free").length).toBe(2);
    // $30,000: FareHarbor 6% + 2.9% + 30c x 200, DiveDay 2% + the same processing.
    expect(screen.getByText("$2,730")).toBeTruthy();
    expect(screen.getAllByText("$1,530").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marketplace commission")).toBeNull();
  });

  it("turns each total into a range with the marketplaces switch on", () => {
    renderIt();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getAllByText("Marketplace commission").length).toBe(2);
    expect(screen.getAllByText("$900 to $1,800").length).toBe(2);
    expect(screen.getByText("Moving a sale keeps 9.9% to 24.9%")).toBeTruthy();
  });
});
