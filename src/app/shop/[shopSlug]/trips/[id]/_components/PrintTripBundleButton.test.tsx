// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { PrintTripBundleButton } from "./PrintTripBundleButton";

afterEach(cleanup);

const props = {
  href: "/shop/blue-mantis/trips/t1/print",
  label: "Print packet",
  popupBlockedLabel: "Allow pop-ups to print",
  recordAction: () => {},
};

/**
 * Last of the About panel's three quiet doors, and on a phone the one that
 * wraps to a second line, where it sat 12px inside the column (pixel probe,
 * DEPARTURE-2-06, K-06). The row flushes all three, so a wrapped one lands on
 * the column too.
 */
it("puts its word on the column when its row asks", () => {
  render(<PrintTripBundleButton {...props} flush />);
  expect(rendersFlush(screen.getByRole("button", { name: "Print packet" }), "ghost", "sm")).toBe(
    true,
  );
});

it("keeps its padding unless asked", () => {
  render(<PrintTripBundleButton {...props} />);
  expect(rendersFlush(screen.getByRole("button", { name: "Print packet" }), "ghost", "sm")).toBe(
    false,
  );
});
