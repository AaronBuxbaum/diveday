import { describe, expect, it } from "vitest";
import type { OrderExportLine } from "@/db/order-export";
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
      "America/New_York",
    );
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(ORDERS_CSV_HEADER.join(","));
    expect(rows[1]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,Two-Tank Reef,2026-10-15,paid,trip_fee,Two-tank charter,1,95,153.9,10.9,153.9,0,USD`,
    );
    expect(rows[2]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,Two-Tank Reef,2026-10-15,paid,rental,BCD,2,48,,,,,USD`,
    );
  });

  it("keeps an order with no lines and no departure as one row", () => {
    const csv = ordersCsv(
      [{ ...ORDER, tripTitle: null, tripStartsAt: null, line: null }],
      "America/New_York",
    );
    expect(csv.trimEnd().split("\r\n")[1]).toBe(
      `${ORDER.orderId},2026-10-08,Kenji Watanabe,,,paid,,,,,153.9,10.9,153.9,0,USD`,
    );
  });

  it("neutralizes a diver name that would open as a formula", () => {
    const csv = ordersCsv(
      [{ ...ORDER, diverName: '=HYPERLINK("x")', line: null }],
      "America/New_York",
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
