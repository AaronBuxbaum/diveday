import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { countQueries } from "@/test/query-count";
import { loadShopExportBundleInput, loadShopExportCounts } from "./export";
import { exportCountScope } from "./export-count-scope";
import { bookingCheckoutBookings, bookingCheckouts, bookings, people, trips } from "./schema";

/** The settings page's row counts, held to the bundle they describe. */

describe("export counts (the settings page's cheap view)", () => {
  it("mirrors the bundle exactly — same files, same notes, same row counts", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const input = await loadShopExportBundleInput(db, shop.id);
    const counts = await loadShopExportCounts(db, shop.id);
    if (!input || !counts) throw new Error("shop failed to load");

    expect(counts.map((row) => row.file)).toEqual(input.tables.map((row) => row.file));
    for (const [index, row] of counts.entries()) {
      expect(row.note).toBe(input.tables[index].note);
      expect(row.count).toBe(input.tables[index].rows.length);
    }
  });

  it("counts mixed rehearsal/history rows with scalar queries, matching the bundle", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("no seeded departure");
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, trip.id));
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const counted = countQueries(db);
    const counts = await loadShopExportCounts(counted.db, shop.id);
    expect(counts).toEqual(
      bundle?.tables.map(({ file, note, rows }) => ({ file, note, count: rows.length })),
    );
    expect(counted.statements.length).toBeGreaterThan(80);
    // The only non-scalar read is the initial existence check. No bundle, IDs,
    // names or other customer rows are materialized, even for rehearsals.
    expect(
      counted.statements.slice(1).every((statement) => /^select count\(/i.test(statement)),
    ).toBe(true);
    await db.transaction(async (tx) => {
      expect(await loadShopExportCounts(tx, shop.id)).toEqual(counts);
    });
  });

  it("counts each tip allocation, including refunded tips, exactly as exported", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const seats = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(2);
    if (seats.length !== 2) throw new Error("missing seeded bookings");
    const before = await loadShopExportCounts(db, shop.id);
    for (const [index, refundedCents] of [0, 1500].entries()) {
      const [checkout] = await db
        .insert(bookingCheckouts)
        .values({
          shopId: shop.id,
          tripId: seats[0].tripId,
          purpose: "tip",
          status: "completed",
          stripeAccountId: "acct_export_count",
          stripeSessionId: `cs_export_count_${index}`,
          currency: "usd",
          amountPerDiverCents: 1500,
          totalCents: 1500,
          refundedCents,
        })
        .returning({ id: bookingCheckouts.id });
      await db.insert(bookingCheckoutBookings).values(
        seats.map((seat) => ({
          shopId: shop.id,
          checkoutId: checkout.id,
          bookingId: seat.id,
        })),
      );
    }
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const counts = await loadShopExportCounts(db, shop.id);
    const tips = counts?.find((row) => row.file === "tips.csv");
    expect(tips?.count).toBe((before?.find((row) => row.file === "tips.csv")?.count ?? 0) + 4);
    expect(tips?.count).toBe(bundle?.tables.find((row) => row.file === "tips.csv")?.rows.length);
  });

  it("refuses a new exported reference without a SQL count mapping", async () => {
    const { db, shop } = await seededShopContext();
    expect(() =>
      exportCountScope(db, shop.id, { file: "future.csv", header: ["booking_id"] }, people),
    ).toThrow("future.csv has no SQL column for booking_id");
  });

  it("returns null for an unknown shop", async () => {
    const { db } = await seededShopContext();
    expect(await loadShopExportCounts(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
