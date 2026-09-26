// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BookingRequestCardItem,
  BookingRequestContext,
  RelevantBookingRequests,
} from "./BookingRequestCards";

afterEach(cleanup);

const ITEMS: BookingRequestCardItem[] = [
  {
    id: "r-1",
    name: "Dee Whitlock",
    subject: "Wants to dive: A night dive, if you still run them",
    diversLabel: "3 divers",
    dateLabel: "Aug 2, 2026",
    href: "/shop/blue-mantis/bookings/new?request=r-1",
  },
  {
    id: "r-2",
    name: "Hannah Okafor",
    subject: "Wants to dive: A shallow reef morning",
    diversLabel: "1 diver",
    href: "/shop/blue-mantis/bookings/new?request=r-2",
  },
];

/**
 * The relevant-request rows on "Add a booking" (the pixel audit, booking-new).
 * At 1280 the one row whose words ran long dropped its "Book from this
 * request" to a second line at x 371 while the other three kept theirs at the
 * row's right; and on every row the link was a 20px word.
 */
describe("RelevantBookingRequests", () => {
  it("keeps every row's link on the row's right from `sm` up", () => {
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);

    for (const row of screen.getAllByRole("listitem")) {
      expect(row).toHaveClass("flex-wrap", "sm:flex-nowrap");
      // `flex-1` only from `sm` up: in the phone's wrapping row a zero basis
      // would never let the link wrap, and squeeze the words beside it instead.
      const words = row.firstElementChild;
      expect(words).toHaveClass("min-w-0", "sm:flex-1");
      expect(words).not.toHaveClass("flex-1");
    }
  });

  it("makes every row's link a 44px target, with the wrapped line's air in its box", () => {
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);

    const links = screen.getAllByRole("link", { name: "Book" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
    for (const row of screen.getAllByRole("listitem")) expect(row).toHaveClass("gap-y-0");
  });

  it("hands the wrapped link's lower half back to the row's inset on a phone", () => {
    // Below `sm` the link wraps under the words. Its box's top half is the
    // gap; its bottom half stacked on the row's own py-3 and left the link
    // 27px above the row's edge against the name's 18px under the top (K-457
    // review, booking-new@390). From `sm` up it shares the words' line.
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);
    for (const link of screen.getAllByRole("link", { name: "Book" })) {
      expect(link).toHaveClass("max-sm:-mb-3");
      expect(link.className).not.toMatch(/(^|\s)-m[by]-/);
      expect(link.closest("li")).toHaveClass("py-3");
    }
  });
});

describe("BookingRequestContext", () => {
  it("makes the request's two links 44px targets", () => {
    render(
      <BookingRequestContext
        title="From a request"
        name="Dee Whitlock"
        diversLabel="3 divers"
        subject="Wants to dive: A night dive"
        sourceHref="/shop/blue-mantis/requests/r-1"
        sourceLabel="Open the request"
        personHref="/shop/blue-mantis/divers/p-1"
        personLabel="Open Dee's record"
      />,
    );

    for (const name of ["Open the request", "Open Dee's record"]) {
      expect(screen.getByRole("link", { name })).toHaveClass(
        "inline-flex",
        "min-h-11",
        "items-center",
      );
    }
    // The boxes carry the air the row's margin and row gap used to.
    const row = screen.getByRole("link", { name: "Open the request" }).parentElement;
    expect(row).toHaveClass("gap-y-0");
    expect(row?.className).not.toMatch(/(^|\s)mt-/);
  });
});
