// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { getTripManifest } from "@/db/manifests";
import { resetDemoSchedule } from "@/db/seed";
import { bookings as bookingsT, trips as tripsTable, waiverRecords } from "@/db/schema";

describe("probe", () => {
  it("dumps history readiness", async () => {
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id, { history: true });
    const history = await db
      .select({ id: tripsTable.id, title: tripsTable.title })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, "Sailed. Kept in the log for the shop's monthly numbers.")));
    const tally: Record<string, number> = {};
    for (const trip of history) {
      const m = await getTripManifest(db, shop.id, trip.id);
      for (const d of m!.divers) {
        const key = `${d.rollCall?.state ?? "awaiting"}/${d.readiness.status}/${d.readiness.blockers.map(b=>b.code).join("+")}`;
        tally[key] = (tally[key] ?? 0) + 1;
      }
    }
    const ids = history.map(h=>h.id);
    const bk = await db.select({id: bookingsT.id, status: bookingsT.status, tripId: bookingsT.tripId}).from(bookingsT).where(eq(bookingsT.shopId, shop.id));
    const hist = bk.filter(b=>ids.includes(b.tripId));
    const wr = await db.select({bookingId: waiverRecords.bookingId, status: waiverRecords.status}).from(waiverRecords).where(eq(waiverRecords.shopId, shop.id));
    const withW = new Set(wr.map(w=>w.bookingId));
    const byStatus: Record<string, number> = {};
    for (const b of hist) {
      const key = `${b.status}/${withW.has(b.id) ? "waiver" : "none"}`;
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    console.log(JSON.stringify(tally, null, 1), history.length, JSON.stringify(byStatus));
    expect(true).toBe(true);
  });
});
