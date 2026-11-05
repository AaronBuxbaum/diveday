// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { latestDeckCounts, recordDeckCount } from "./deck-counts";
import { deckCounts, people, shops, trips } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/** A seeded departure and a seeded staffer of the demo shop. */
async function departureAndStaffer() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  const [staff] = await listStaff(db, shop.id);
  if (!trip || !staff) throw new Error("seeded trip or staff missing");
  return { trip, staffId: staff.person.id };
}

/**
 * **The deck count's writer and reader** (loop 5, row 1). A control on a
 * safety surface: the refusals come first, because the writer's job is to
 * keep a count that names the wrong boat, checkpoint or person off the record.
 */
describe("recordDeckCount", () => {
  it("refuses somebody who is not this shop's staff", async () => {
    const { db, shop } = ctx;
    const { trip } = await departureAndStaffer();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Ada" })
      .returning();
    if (!diver) throw new Error("person insert failed");
    await expect(
      recordDeckCount(db, {
        shopId: shop.id,
        tripId: trip.id,
        checkpoint: "departure",
        counted: 8,
        recordedByPersonId: diver.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses another shop's departure", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await departureAndStaffer();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-deck", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    await expect(
      recordDeckCount(db, {
        shopId: other.id,
        tripId: trip.id,
        checkpoint: "departure",
        counted: 8,
        recordedByPersonId: staffId,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(await db.select().from(deckCounts).where(eq(deckCounts.shopId, shop.id))).toEqual([]);
  });

  it("refuses a checkpoint the plan does not have, and a count past the cap", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await departureAndStaffer();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staffId };
    await expect(
      recordDeckCount(db, { ...base, checkpoint: "after_dive_99", counted: 8 }),
    ).resolves.toEqual({ ok: false, reason: "invalid_checkpoint" });
    await expect(
      recordDeckCount(db, { ...base, checkpoint: "departure", counted: -1 }),
    ).resolves.toEqual({ ok: false, reason: "invalid_count" });
    await expect(
      recordDeckCount(db, { ...base, checkpoint: "departure", counted: 1000 }),
    ).resolves.toEqual({ ok: false, reason: "invalid_count" });
    await expect(
      recordDeckCount(db, { ...base, checkpoint: "departure", counted: 2.5 }),
    ).resolves.toEqual({ ok: false, reason: "invalid_count" });
  });

  it("refuses a deleted departure", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await departureAndStaffer();
    await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, trip.id));
    await expect(
      recordDeckCount(db, {
        shopId: shop.id,
        tripId: trip.id,
        checkpoint: "departure",
        counted: 8,
        recordedByPersonId: staffId,
      }),
    ).resolves.toEqual({ ok: false, reason: "trip_unavailable" });
  });
});

describe("latestDeckCounts", () => {
  it("answers the newest count per checkpoint, with who counted", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await departureAndStaffer();
    const base = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staffId };
    await expect(
      recordDeckCount(db, { ...base, checkpoint: "departure", counted: 9 }),
    ).resolves.toEqual({
      ok: true,
    });
    advanceClock(60_000);
    await recordDeckCount(db, { ...base, checkpoint: "departure", counted: 8 });

    const counts = await latestDeckCounts(db, shop.id, trip.id);
    expect(counts.get("departure")).toMatchObject({ counted: 8 });
    expect(counts.get("departure")?.recordedByName).toEqual(expect.any(String));
    // A recount appends; the first count stays on the record.
    expect(await db.select().from(deckCounts).where(eq(deckCounts.tripId, trip.id))).toHaveLength(
      2,
    );
  });

  it("reads nothing across shops", async () => {
    const { db, shop } = ctx;
    const { trip, staffId } = await departureAndStaffer();
    await recordDeckCount(db, {
      shopId: shop.id,
      tripId: trip.id,
      checkpoint: "departure",
      counted: 8,
      recordedByPersonId: staffId,
    });
    const [other] = await db
      .insert(shops)
      .values({ name: "Other", slug: "other-deck-read", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("shop insert failed");
    expect((await latestDeckCounts(db, other.id, trip.id)).size).toBe(0);
  });
});
