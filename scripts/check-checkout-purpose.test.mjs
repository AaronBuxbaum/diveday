import { describe, expect, it } from "vitest";
import { findUnnamedCheckoutReads } from "./check-checkout-purpose.mjs";

describe("findUnnamedCheckoutReads", () => {
  it("refuses a read of booking_checkouts that names no purpose", () => {
    const source = "db.select().from(bookingCheckouts).where(eq(bookingCheckouts.id, id));";
    expect(findUnnamedCheckoutReads(source).findings).toHaveLength(1);
  });

  it("passes a read that filters to fares or tips", () => {
    const fare = "db.select()\n  .from(bookingCheckouts)\n  .where(and(fareCheckout(), x));";
    const tip = "db.update(bookingCheckouts)\n  .set({})\n  .where(tipCheckout());";
    expect(findUnnamedCheckoutReads(fare).findings).toEqual([]);
    expect(findUnnamedCheckoutReads(tip).findings).toEqual([]);
  });

  it("guards a join through the booking links", () => {
    const source = "db.select().from(bookings)\n  .innerJoin(bookingCheckoutBookings, eq(a, b));";
    expect(findUnnamedCheckoutReads(source).findings).toHaveLength(1);
  });

  it("guards a join prettier broke across two lines", () => {
    const source =
      "db.select().from(bookings)\n  .innerJoin(\n    bookingCheckouts,\n    eq(a, b),\n  );";
    expect(findUnnamedCheckoutReads(source).findings).toHaveLength(1);
  });

  it("proves a from and its joins with the one where clause after them", () => {
    const source =
      "db.select().from(bookingCheckouts)\n  .innerJoin(bookingCheckoutBookings, eq(a, b))\n  .where(tipCheckout());";
    expect(findUnnamedCheckoutReads(source).findings).toEqual([]);
  });

  it("never lets one query borrow its neighbour's proof", () => {
    const source = [
      "const a = db.select().from(bookingCheckouts).where(eq(x, y));",
      "const b = db.select().from(bookingCheckouts).where(fareCheckout());",
    ].join("\n");
    expect(findUnnamedCheckoutReads(source).findings.map((f) => f.line)).toEqual([1]);
  });

  it("accepts a reasoned allow comment and refuses an empty one", () => {
    const allowed =
      "// diveday:any-checkout-purpose: a session-id lookup that branches on purpose\ndb.select().from(bookingCheckouts);";
    const empty = "// diveday:any-checkout-purpose:\ndb.select().from(bookingCheckouts);";
    expect(findUnnamedCheckoutReads(allowed).findings).toEqual([]);
    expect(findUnnamedCheckoutReads(empty).findings).toHaveLength(1);
  });
});
