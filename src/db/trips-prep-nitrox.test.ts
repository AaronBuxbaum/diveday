import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { proposalKey } from "@/lib/gear-proposals";
import { fileScopedShopContext } from "@/test/db";
import { bookings, gearItems, nitroxCertifications } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { getTripPrep, screenGearPicks } from "./trips-prep";

const fileCtx = fileScopedShopContext();

/**
 * **A nitrox request is not nitrox** (domain review A1, F2): only a request
 * backed by a verified card (`nitroxTanksApproved`) steers a regulator
 * proposal onto the nitrox-designated set. An uncarded request breathes air,
 * so it is proposed an air regulator, never a designated one.
 */
describe("regulator proposals read the approved nitrox, not the request", () => {
  async function setUp() {
    const { db, shop } = fileCtx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("demo reef trip missing");
    const prep = await getTripPrep(db, shop, trip.id);
    const row = prep?.assignmentRows.find((entry) =>
      entry.wanted.some((need) => need.kind === "regulator"),
    );
    const regs = prep?.freeByKind.get("regulator") ?? [];
    const designated = regs[regs.length - 1];
    if (!row || regs.length < 2 || !designated) {
      throw new Error("seeded trip needs a regulator wanted and two free");
    }
    await db
      .update(gearItems)
      .set({ nitroxDesignated: true })
      .where(eq(gearItems.id, designated.id));
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, row.diver.bookingId));
    await db
      .delete(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, row.diver.personId));
    return {
      db,
      shop,
      tripId: trip.id,
      bookingId: row.diver.bookingId,
      personId: row.diver.personId,
      designatedId: designated.id,
    };
  }

  it("proposes an air regulator to a nitrox request with no verified card", async () => {
    const { db, shop, tripId, bookingId, designatedId } = await setUp();
    const prep = await getTripPrep(db, shop, tripId);
    const proposed = prep?.proposals.get(proposalKey(bookingId, "regulator"));
    expect(proposed).toBeDefined();
    expect(proposed?.id).not.toBe(designatedId);
    expect(proposed?.nitroxDesignated).not.toBe(true);
  });

  it("proposes the designated regulator once the card is verified", async () => {
    const { db, shop, tripId, bookingId, personId, designatedId } = await setUp();
    await db.insert(nitroxCertifications).values({
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "EAN-A1",
      status: "verified",
    });
    const prep = await getTripPrep(db, shop, tripId);
    expect(prep?.proposals.get(proposalKey(bookingId, "regulator"))?.id).toBe(designatedId);
  });
});

/**
 * **A stale tab's proposal is re-proposed, not trusted** (domain review F3):
 * confirming a proposal keeps a pick only while it is still the proposal the
 * day's thickness and nitrox rules give now.
 */
describe("confirming a stale proposal", () => {
  it("drops a proposed regulator the current rules no longer propose", async () => {
    const { db, shop } = fileCtx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("demo reef trip missing");
    const before = await getTripPrep(db, shop, trip.id);
    const row = before?.assignmentRows.find(
      (entry) => !entry.diver.wantsNitrox && entry.wanted.some((need) => need.kind === "regulator"),
    );
    if (!row) throw new Error("seeded trip needs an air diver wanting a regulator");
    const proposed = before?.proposals.get(proposalKey(row.diver.bookingId, "regulator"));
    if (!proposed) throw new Error("no regulator proposed");
    // Since the tab loaded, the shop marked that regulator for nitrox.
    await db.update(gearItems).set({ nitroxDesignated: true }).where(eq(gearItems.id, proposed.id));
    const screened = await screenGearPicks(
      db,
      shop,
      trip.id,
      [{ bookingId: row.diver.bookingId, gearItemId: proposed.id }],
      { proposed: true },
    );
    expect(screened.kept).toEqual([]);
    expect(screened.refused).toBe(1);
  });
});
