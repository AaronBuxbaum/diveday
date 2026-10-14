import { describe, expect, it } from "vitest";
import type { OrderExportLine } from "@/db/order-export";
import type { SeatPaymentRow } from "@/db/seat-payments";
import { ORDERS_CSV_HEADER, ordersCsv } from "./orders-csv";

const ORDER: Omit<OrderExportLine, "line"> = {
  orderId: "11111111-1111-4111-8111-111111111111",
  // 01:30 UTC on the 9th is still the 8th in Key Largo.
  createdAt: new Date("2026-10-09T01:30:00Z"),
  status: "paid",
  currency: "usd",
  totalCents: 15_390,
  taxCents: 1_090,
  amountPaidCents: 15_390,
  refundedCents: 0,
  // 02:10 UTC on the 10th is the 9th in Key Largo: the day the money came.
  paidAt: new Date("2026-10-10T02:10:00Z"),
  collection: "stripe_invoice",
  diverName: "Kenji Watanabe",
  tripTitle: "Two-Tank Reef",
  tripStartsAt: new Date("2026-10-15T12:30:00Z"),
};

/**
 * One row per order line, the money as numbers, and each order's own figures
 * counted once (third UX review, item 34).
 */
describe("ordersCsv", () => {
  it("writes a line per row and the order's figures on its first line only", () => {
    const csv = ordersCsv(
      [
        {
          ...ORDER,
          line: {
            kind: "trip_fee",
            description: "Two-tank charter",
            quantity: 1,
            unitAmountCents: 9_500,
          },
        },
        {
          ...ORDER,
          line: { kind: "rental", description: "BCD", quantity: 2, unitAmountCents: 2_400 },
        },
      ],
      [],
      "America/New_York",
    );
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(ORDERS_CSV_HEADER.join(","));
    expect(rows[1]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,Two-Tank Reef,2026-10-15,paid,2026-10-09,stripe,trip_fee,Two-tank charter,1,95,153.9,10.9,153.9,0,USD`,
    );
    expect(rows[2]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,Two-Tank Reef,2026-10-15,paid,2026-10-09,stripe,rental,BCD,2,48,,,,,USD`,
    );
  });

  it("keeps an order with no lines and no departure as one row", () => {
    const csv = ordersCsv(
      [{ ...ORDER, tripTitle: null, tripStartsAt: null, line: null }],
      [],
      "America/New_York",
    );
    expect(csv.trimEnd().split("\r\n")[1]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,,,paid,2026-10-09,stripe,,,,,153.9,10.9,153.9,0,USD`,
    );
  });

  it("neutralizes a diver name that would open as a formula", () => {
    const csv = ordersCsv(
      [{ ...ORDER, diverName: '=HYPERLINK("x")', line: null }],
      [],
      "America/New_York",
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("says how counter money was taken and leaves an unpaid order's day blank", () => {
    const csv = ordersCsv(
      [
        { ...ORDER, collection: "cash", line: null },
        { ...ORDER, orderId: "open", status: "open", paidAt: null, amountPaidCents: 0, line: null },
      ],
      [],
      "America/New_York",
    );
    const [, cash, open] = csv.trimEnd().split("\r\n");
    expect(cash).toContain(",paid,2026-10-09,cash,");
    expect(open).toContain(",open,,stripe,");
  });

  it("writes a seat paid online as its own row, with its share of the charge", () => {
    const seat: SeatPaymentRow = {
      id: "seat-1",
      checkoutId: "22222222-2222-4222-8222-222222222222",
      bookingId: "booking-1",
      paidAt: new Date("2026-10-12T14:00:00Z"),
      currency: "usd",
      status: "partly_refunded",
      amountCents: 10_000,
      refundedCents: 2_500,
      taxCents: 700,
      checkout: { chargedCents: 20_000, refundedCents: 5_000, taxCents: 1_400 },
      person: { id: "p", fullName: "Ana Ruiz" },
      trip: { id: "t", title: "Wreck Dive", startsAt: new Date("2026-10-18T12:00:00Z") },
    };
    const csv = ordersCsv([], [seat], "America/New_York");
    expect(csv.trimEnd().split("\r\n")[1]).toBe(
      `${seat.checkoutId},2026-10-12,Ana Ruiz,Wreck Dive,2026-10-18,partly_refunded,2026-10-12,stripe,seat,Wreck Dive,1,100,100,7,75,25,USD`,
    );
  });

  it("puts orders and seat payments in one newest-first list", () => {
    const seat = {
      id: "seat-1",
      checkoutId: "checkout",
      bookingId: "b",
      paidAt: new Date("2026-10-09T12:00:00Z"),
      currency: "usd",
      status: "paid",
      amountCents: 100,
      refundedCents: 0,
      taxCents: 0,
      checkout: { chargedCents: 100, refundedCents: 0, taxCents: 0 },
      person: { id: "p", fullName: "Ana Ruiz" },
      trip: { id: "t", title: "Wreck Dive", startsAt: new Date("2026-10-18T12:00:00Z") },
    } satisfies SeatPaymentRow;
    const csv = ordersCsv(
      [
        { ...ORDER, line: null },
        { ...ORDER, orderId: "older", createdAt: new Date("2026-10-01T12:00:00Z"), line: null },
      ],
      [seat],
      "America/New_York",
    );
    const firstColumn = csv
      .trimEnd()
      .split("\r\n")
      .slice(1)
      .map((row) => row.split(",")[0]);
    expect(firstColumn).toEqual(["checkout", ORDER.orderId, "older"]);
  });
});
