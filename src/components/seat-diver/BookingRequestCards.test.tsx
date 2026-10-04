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
  it("keeps every row's door on the row's right at every width", () => {
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);

    for (const row of screen.getAllByRole("listitem")) {
      expect(row).not.toHaveClass("flex-wrap");
      const words = row.firstElementChild;
      expect(words).toHaveClass("min-w-0", "flex-1");
    }
  });

  it("makes every row's link a 44px target", () => {
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);

    const links = screen.getAllByRole("link", { name: "Book" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveClass("inline-flex", "min-h-11", "items-center");
  });

  it("makes the whole row the door on a phone, its words kept for a reader", () => {
    // Below `sm` "Book from this request" under every request doubled the
    // list's lines (phone text density pass): the row is the target and a
    // chevron draws it, and the words stay in the link's accessible name.
    render(<RelevantBookingRequests title="Relevant requests" items={ITEMS} openLabel="Book" />);
    for (const link of screen.getAllByRole("link", { name: "Book" })) {
      expect(link).toHaveClass("max-sm:after:absolute", "max-sm:after:inset-0");
      expect(link.closest("li")).toHaveClass("relative");
      expect(link.querySelector(".max-sm\\:sr-only")).toHaveTextContent("Book");
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
