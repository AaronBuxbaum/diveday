// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GearRentalsPage, GearRentalUnit } from "@/db/gear-rentals";
import { staffTranslator } from "@/i18n/staff-messages";
import { groupGearRentals } from "@/lib/gear-rentals";
import { GearRentalsList } from "./GearRentalsList";

afterEach(cleanup);

const t = staffTranslator("en-US");
const TODAY = "2026-10-08";

/**
 * Rows built here and folded by the pure rule, rather than read through
 * `listGearRentals`, which would drag PGlite into a jsdom render. The reader's
 * own pins are in `src/db/gear-rentals.test.ts`.
 */
function row(overrides: Partial<GearRentalUnit> & { reservationId: string }): GearRentalUnit {
  return {
    gearItemId: `item-${overrides.reservationId}`,
    label: `BCD ${overrides.reservationId}`,
    kind: "bcd",
    size: null,
    reservedFrom: "2026-10-10",
    reservedUntil: "2026-10-10",
    checkedOutAt: null,
    holderPersonId: "person-ana",
    holderName: "Ana Diaz",
    bookingId: "booking-ana",
    counterRentalStamp: null,
    counterOrderId: null,
    tripId: "trip-wreck",
    tripTitle: "Wreck Trip — Spiegel Grove",
    tripStartsAt: new Date("2026-10-10T12:00:00Z"),
    money: null,
    ...overrides,
  };
}

function renderList(rows: GearRentalUnit[]) {
  const holders = groupGearRentals(rows, TODAY);
  const page: GearRentalsPage = {
    rows: holders,
    page: 1,
    pageCount: 1,
    pageSize: 20,
    total: holders.length,
  };
  return render(
    <GearRentalsList
      page={page}
      shopSlug="blue-mantis"
      t={t}
      locale="en-US"
      pageHref={(target) => `/shop/blue-mantis/gear?view=rentals&page=${target}`}
    />,
  );
}

describe("GearRentalsList", () => {
  it("links the holder, the trip, each unit and the rental ticket", () => {
    renderList([
      row({ reservationId: "1", label: "BCD #2", size: "M" }),
      row({ reservationId: "2", label: "Reg #1", kind: "regulator" }),
    ]);
    expect(screen.getByRole("link", { name: "Ana Diaz" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-ana",
    );
    expect(screen.getByRole("link", { name: "Wreck Trip — Spiegel Grove" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-wreck",
    );
    expect(screen.getByRole("link", { name: "BCD #2" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/gear/item-1",
    );
    expect(screen.getByRole("link", { name: "Reg #1" })).toBeInTheDocument();
    expect(screen.getByText("BCD · M")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rental ticket for Ana Diaz" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/trip-wreck/prep/ticket/booking-ana",
    );
    // One state word for the set, not one per unit that agrees with it.
    expect(screen.getAllByText("Reserved")).toHaveLength(1);
  });

  it("names a counter rental as one, with its own ticket and its invoice's money word", () => {
    renderList([
      row({
        reservationId: "c",
        bookingId: null,
        counterRentalStamp: "2026-10-08 09:00:00.1+00",
        counterOrderId: "order-c",
        tripId: null,
        tripTitle: null,
        tripStartsAt: null,
        holderName: "Walk In",
        holderPersonId: "person-walk",
        money: { source: "order", status: "open", orderId: "order-c" },
      }),
    ]);
    expect(screen.getByText("Counter rental")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rental ticket for Walk In" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/gear/rentals/c",
    );
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Walk In" })).toBeInTheDocument();
  });

  it("says overdue in the register's warning words, and a unit that differs says its own", () => {
    renderList([
      row({
        reservationId: "late",
        label: "BCD #late",
        reservedFrom: "2026-10-01",
        reservedUntil: "2026-10-05",
        checkedOutAt: new Date("2026-10-01T12:00:00Z"),
      }),
      row({
        reservationId: "fine",
        label: "BCD #fine",
        reservedFrom: "2026-10-01",
        reservedUntil: "2026-10-12",
        checkedOutAt: new Date("2026-10-01T12:00:00Z"),
      }),
    ]);
    const overdue = screen.getByText("Overdue");
    expect(overdue.closest("span.text-warning-strong")).not.toBeNull();
    const fine = screen.getByRole("link", { name: "BCD #fine" }).closest("li");
    expect(fine).not.toBeNull();
    expect(within(fine as HTMLElement).getByText("Out")).toBeInTheDocument();
  });

  it("shows the money word the diver record would, and nothing when nothing was raised", () => {
    renderList([
      row({
        reservationId: "paid",
        holderName: "Paid Diver",
        holderPersonId: "person-paid",
        bookingId: "booking-paid",
        money: { source: "order", status: "paid", orderId: "order-1" },
      }),
      row({
        reservationId: "owed",
        holderName: "Owing Diver",
        holderPersonId: "person-owed",
        bookingId: "booking-owed",
        money: { source: "payment", status: "unpaid" },
      }),
      row({
        reservationId: "none",
        holderName: "Quiet Diver",
        holderPersonId: "person-quiet",
        bookingId: "booking-quiet",
      }),
    ]);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Unpaid")).toBeInTheDocument();
    const quiet = screen.getByRole("link", { name: "Rental ticket for Quiet Diver" }).closest("li");
    expect(within(quiet as HTMLElement).queryByText(/Paid|Unpaid|Open/)).toBeNull();
  });
});
