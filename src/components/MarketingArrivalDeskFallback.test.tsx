// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ArrivalDeskFallback } from "./MarketingArrivalDeskFallback";

afterEach(cleanup);

// The walkthrough checks Priya in at the counter: her tap turns to "Checked in", her row
// moves into that band, the count is one higher and the Ready band is gone.
it("moves Priya from the Check in tap into the checked-in band", () => {
  const { rerender } = render(<ArrivalDeskFallback locale="en-US" />);
  expect(screen.getByText("Ready · 1")).toBeInTheDocument();
  expect(screen.getByText("Check in")).toBeInTheDocument();
  expect(screen.getByText("Checked in · 7")).toBeInTheDocument();

  rerender(<ArrivalDeskFallback locale="en-US" state="checkedIn" />);
  expect(screen.queryByText(/^Ready · /)).toBeNull();
  expect(screen.queryByText("Check in")).toBeNull();
  expect(screen.getByText("Checked in · 8")).toBeInTheDocument();
  expect(screen.getAllByText("Checked in")).toHaveLength(2);
  expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  expect(screen.getByText("1 diver can’t board yet")).toBeInTheDocument();
});
