import { describe, expect, it } from "vitest";
import { findTimeIdOrders } from "./check-time-id-order.mjs";

const lines = (source) => findTimeIdOrders(source).findings.map((finding) => finding.line);

describe("an orderBy a frozen clock hands to a random id", () => {
  it("is refused when a timestamp and then an id are the last two keys", () => {
    expect(
      lines(`
        return db.select().from(tripLenses).orderBy(asc(tripLenses.createdAt), asc(tripLenses.id));
      `),
    ).toEqual([2]);
  });

  it("is refused in its descending twin, and across lines", () => {
    expect(
      lines(`
        .orderBy(
          desc(importedPaymentHistory.occurredOn),
          desc(importedPaymentHistory.importedAt),
          desc(importedPaymentHistory.id),
        )
      `),
    ).toEqual([2]);
  });

  it("is refused when the id belongs to a joined table", () => {
    // seed-recent-recaps' old shape: every seat on one departure shares its
    // `startsAt`, so the booking id alone decided which diver came first.
    expect(lines(".orderBy(asc(trips.startsAt), asc(bookings.id));")).toEqual([1]);
  });

  it("is refused when the timestamp key is raw SQL", () => {
    expect(
      lines(".orderBy(sql`${tripSeries.lastRolledAt} asc nulls first`, asc(tripSeries.id))"),
    ).toEqual([1]);
  });
});

describe("what it leaves alone", () => {
  it("passes once a key a person can predict sits between the two", () => {
    expect(lines(".orderBy(asc(trips.startsAt), asc(trips.title), asc(trips.id));")).toEqual([]);
  });

  it("passes a timestamp alone, or an id alone", () => {
    expect(lines(".orderBy(desc(orders.createdAt));")).toEqual([]);
    expect(lines(".orderBy(asc(orders.id));")).toEqual([]);
  });

  it("passes an id after a key that is not a timestamp", () => {
    expect(lines(".orderBy(asc(people.fullName), asc(people.id));")).toEqual([]);
  });

  it("passes a column whose name only contains `At` partway", () => {
    expect(lines(".orderBy(asc(x.Attempts), asc(x.id));")).toEqual([]);
  });

  it("does not read an id that is not the last key", () => {
    expect(lines(".orderBy(asc(trips.startsAt), asc(trips.id), asc(bookings.position));")).toEqual(
      [],
    );
  });

  it("passes once it says why nobody reads the order, from directly above", () => {
    expect(
      lines(`
        // diveday:allow-time-id-order: which surplus tokens are revoked; no list renders it
        .orderBy(desc(bookingCapabilities.issuedAt), desc(bookingCapabilities.id));
      `),
    ).toEqual([]);
  });

  it("passes once it says why from inside the arguments", () => {
    expect(
      lines(`
        .orderBy(
          // diveday:allow-time-id-order: an outbox drain, delivery order only
          asc(events.createdAt),
          asc(events.id),
        )
      `),
    ).toEqual([]);
  });

  it("refuses an exemption with nothing after the colon", () => {
    expect(
      lines(`
        // diveday:allow-time-id-order:
        .orderBy(asc(tripLenses.createdAt), asc(tripLenses.id));
      `),
    ).toEqual([3]);
  });

  it("refuses an empty exemption inside the arguments, where the next line is code", () => {
    expect(
      lines(`
        .orderBy(
          // diveday:allow-time-id-order:
          asc(events.createdAt),
          asc(events.id),
        )
      `),
    ).toEqual([2]);
  });

  it("does not let a neighbour's exemption cover a later query", () => {
    expect(
      lines(`
        // diveday:allow-time-id-order: a cursor nobody is shown
        .orderBy(asc(a.createdAt), asc(a.id));
        const other = await db.select().from(b);
        const more = other;
        return db.select().from(b).orderBy(asc(b.createdAt), asc(b.id));
      `),
    ).toEqual([6]);
  });

  it("counts every orderBy it read", () => {
    expect(findTimeIdOrders(".orderBy(asc(a.x));\n.orderBy(asc(b.y));").orders).toBe(2);
  });
});
