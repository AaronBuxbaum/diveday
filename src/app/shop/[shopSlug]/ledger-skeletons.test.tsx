// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import NewBookingLoading from "./bookings/new/loading";
import StaffCoursesLoading from "./courses/loading";
import DiveSitesLoading from "./dive-sites/loading";
import DiversLoading from "./divers/loading";
import GearLoading from "./gear/loading";
import OrdersIndexLoading from "./orders/loading";
import PromosLoading from "./promos/loading";
import ReportsLoading from "./reports/loading";
import StaffingLoading from "./staffing/loading";

afterEach(cleanup);

/**
 * **No skeleton row stands under a ledger row's floor** (#1993).
 *
 * Nine skeletons stood in for lists of `LedgerRow`s, whose floor is 52px
 * (`min-h-13`), with 48px rows, so every list grew as it arrived and
 * everything under it moved down (pixel-craft class 11 allows 0px of shift
 * on load).
 *
 * This is a floor, not a match: a loaded row is often taller than 52px, and
 * each skeleton's own comment says what it measured its rows against. What
 * this stops is the one regression a class string can show — a hairline row
 * drawn with nothing holding it at 52px on a phone.
 */
const SKELETONS: Record<string, ComponentType> = {
  orders: OrdersIndexLoading,
  divers: DiversLoading,
  gear: GearLoading,
  courses: StaffCoursesLoading,
  "bookings/new": NewBookingLoading,
  "dive-sites": DiveSitesLoading,
  reports: ReportsLoading,
  promos: PromosLoading,
  staffing: StaffingLoading,
};

/** The height, in Tailwind's 4px steps, a row's unprefixed classes hold it at. */
function phoneFloor(className: string): number {
  let floor = 0;
  for (const token of className.split(/\s+/)) {
    const match = /^(?:min-)?h-(\d+(?:\.\d+)?)$/.exec(token);
    if (match) floor = Math.max(floor, Number(match[1]));
  }
  return floor;
}

describe("the ledger lists' loading skeletons", () => {
  for (const [route, Skeleton] of Object.entries(SKELETONS)) {
    it(`holds every ${route} skeleton row at a ledger row's floor or taller`, () => {
      const { container } = render(<Skeleton />);
      // A ledger row's hairline box (`ledgerRowOpenBoxClass`): the rule and
      // the room either side of it. Not the staffing week's grid, which is
      // a table drawn from `lg` only (`hidden lg:block`), not a ledger list.
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>(".\\-mx-2.px-2.border-t.border-border"),
      ).filter((row) => !row.closest(".hidden"));
      expect(rows.length, route).toBeGreaterThan(0);
      for (const row of rows) {
        expect(phoneFloor(row.className), `${route}: ${row.className}`).toBeGreaterThanOrEqual(13);
      }
    });
  }
});
