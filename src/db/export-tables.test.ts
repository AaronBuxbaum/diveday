import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  buildExportTables,
  countShopScoped,
  EXPORT_TABLES,
  type ExportTableRead,
  readBookingScoped,
  readPersonScoped,
  readShopScoped,
} from "./export-tables";
import { bookings, certifications, people } from "./schema";

/**
 * The read list both export bundles go through. What matters about it is the
 * scoping — a read through it can never return another shop's or another
 * person's row — and that it reads in the entry's order; the bundles' own
 * contents are `export.test.ts`'s and `export-bundle.snapshot.test.ts`'s.
 */
describe("the export read list", () => {
  it("reads one shop's rows, in the entry's order, and nothing for another shop", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await readShopScoped(db, "people", shop.id);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((row) => row.shopId === shop.id)).toBe(true);
    const expected = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .orderBy(asc(people.createdAt), asc(people.id));
    expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(await countShopScoped(db, "people", shop.id)).toBe(rows.length);

    expect(await readShopScoped(db, "people", randomUUID())).toEqual([]);
    expect(await countShopScoped(db, "people", randomUUID())).toBe(0);
  });

  it("reads one person's rows only inside their own shop", async () => {
    const { db, shop } = await seededShopContext();
    const [card] = await db
      .select({ personId: certifications.personId })
      .from(certifications)
      .where(eq(certifications.shopId, shop.id))
      .limit(1);
    if (!card) throw new Error("seed has no certification");

    const rows = await readPersonScoped(db, "certifications", shop.id, card.personId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.personId === card.personId && row.shopId === shop.id)).toBe(
      true,
    );
    // The right person under the wrong shop is nobody.
    expect(await readPersonScoped(db, "certifications", randomUUID(), card.personId)).toEqual([]);
  });

  it("reads by the diver's bookings, and skips the query when there are none", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const seats = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(50);
    const bookingIds = seats.map((seat) => seat.id);
    const rows = await readBookingScoped(db, "bookingPayments", shop.id, bookingIds);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => bookingIds.includes(row.bookingId))).toBe(true);
    expect(await readBookingScoped(db, "bookingPayments", randomUUID(), bookingIds)).toEqual([]);

    const noQuery = {
      select: () => {
        throw new Error("an empty booking list must not reach the database");
      },
    } as unknown as typeof db;
    expect(await readBookingScoped(noQuery, "bookingPayments", shop.id, [])).toEqual([]);
  });

  it("declares a total order for every table except the two the loader reorders", () => {
    const unordered = Object.entries(EXPORT_TABLES as Record<string, ExportTableRead>)
      .filter(([, entry]) => entry.order.length === 0)
      .map(([key]) => key)
      .sort();
    expect(unordered).toEqual(["bookingPayments", "tripRequirements"]);
  });

  it("builds a bundle's files in list order, each from its own row builder", () => {
    const tables = buildExportTables(
      [
        { file: "b.csv", header: ["n"], rows: (ctx: { n: number }) => [[ctx.n]], note: "B" },
        { file: "a.csv", header: ["twice"], rows: (ctx) => [[ctx.n * 2]], note: "A" },
      ],
      { n: 21 },
    );
    expect(tables).toEqual([
      { file: "b.csv", header: ["n"], rows: [[21]], note: "B" },
      { file: "a.csv", header: ["twice"], rows: [[42]], note: "A" },
    ]);
  });
});
