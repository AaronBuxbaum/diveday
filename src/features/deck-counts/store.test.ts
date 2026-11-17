import { describe, expect, it } from "vitest";
import { listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { fileScopedShopContext } from "@/test/db";
import { latestDeckCounts, recordDeckCount } from "./store";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function deckContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const staff = await listStaff(db, shop.id);
  const captain = staff[0]?.person;
  if (!captain) throw new Error("demo staff missing");
  return { db, shop, reef, captain };
}

describe("deck counts (in-memory PGlite)", () => {
  it("keeps the newest count per checkpoint, and a recount replaces nothing it said before", async () => {
    const { db, shop, reef, captain } = await deckContext();
    const base = { shopId: shop.id, tripId: reef.id, recordedByPersonId: captain.id };
    expect(await recordDeckCount(db, { ...base, checkpoint: "departure", counted: 11 })).toEqual({
      ok: true,
    });
    expect(await recordDeckCount(db, { ...base, checkpoint: "departure", counted: 12 })).toEqual({
      ok: true,
    });
    expect(await recordDeckCount(db, { ...base, checkpoint: "after_dive_1", counted: 10 })).toEqual(
      { ok: true },
    );
    const latest = await latestDeckCounts(db, shop.id, reef.id);
    expect(latest.get("departure")).toBe(12);
    expect(latest.get("after_dive_1")).toBe(10);
    expect(latest.has("after_dive_2")).toBe(false);
  });

  it("refuses a count that is not a whole number in range, and writes nothing", async () => {
    const { db, shop, reef, captain } = await deckContext();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      recordedByPersonId: captain.id,
      checkpoint: "departure",
    };
    for (const counted of [-1, 1.5, 1000, Number.NaN]) {
      expect(await recordDeckCount(db, { ...base, counted })).toEqual({
        ok: false,
        reason: "count_invalid",
      });
    }
    expect((await latestDeckCounts(db, shop.id, reef.id)).size).toBe(0);
  });

  it("refuses a checkpoint the departure does not have", async () => {
    const { db, shop, reef, captain } = await deckContext();
    expect(
      await recordDeckCount(db, {
        shopId: shop.id,
        tripId: reef.id,
        recordedByPersonId: captain.id,
        checkpoint: "after_dive_9",
        counted: 4,
      }),
    ).toEqual({ ok: false, reason: "checkpoint_invalid" });
  });

  it("refuses a departure that is not this shop's, and a person who is not its staff", async () => {
    const { db, shop, reef, captain } = await deckContext();
    const elsewhere = "00000000-0000-4000-8000-000000000000";
    const base = { recordedByPersonId: captain.id, checkpoint: "departure", counted: 4 };
    expect(await recordDeckCount(db, { ...base, shopId: shop.id, tripId: elsewhere })).toEqual({
      ok: false,
      reason: "trip_not_found",
    });
    expect(await recordDeckCount(db, { ...base, shopId: elsewhere, tripId: reef.id })).toEqual({
      ok: false,
      reason: "staff_not_found",
    });
    expect((await latestDeckCounts(db, shop.id, reef.id)).size).toBe(0);
  });
});
