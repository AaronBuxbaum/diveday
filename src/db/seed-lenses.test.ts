import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { tripLenses, trips } from "./schema";
import { seedLenses } from "./seed-lenses";
import { listTripLenses } from "./trip-lenses";

/**
 * `seedLenses` runs inside `seedDemoSchedule`, which `resetDemoShop` calls again
 * before **every** e2e test. The vocabulary is shop configuration and the reset
 * deliberately does not clear it, so a second run has to be a no-op on the words
 * and a re-stamp on the departures.
 *
 * This is a regression test with a failure to its name: the first version
 * inserted all six words unconditionally, and the second run hit the per-shop
 * unique slug index — which took the whole seed transaction with it and left the
 * dev server answering 503 from its own health check.
 */
describe("the demo's kinds of day", () => {
  it("writes the six words in the order the shop wrote them", async () => {
    const { db, shop } = await seededShopContext();

    const lenses = await listTripLenses(db, shop.id);

    expect(lenses.map((lens) => lens.name)).toEqual([
      "Easygoing reef",
      "Wrecks",
      "After dark",
      "Small life & cameras",
      "First time back in a while",
      "Learning",
    ]);
  });

  it("re-runs without duplicating a word, and puts the departures back on it", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listTripLenses(db, shop.id);
    // A reset rebuilds the departures, so every assignment is cleared and has
    // to come back.
    await db.update(trips).set({ lensId: null }).where(eq(trips.shopId, shop.id));

    await seedLenses(db, shop.id);

    expect((await listTripLenses(db, shop.id)).map((lens) => lens.id)).toEqual(
      before.map((lens) => lens.id),
    );
    const wearing = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), isNull(trips.lensId)));
    const all = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
    expect(wearing.length).toBeLessThan(all.length);
  });

  it("leaves the storefront's first page holding one departure with no word at all", async () => {
    // The silence the visual capture needs in front of it: a row with no lens
    // renders its meta line with no leading separator and no placeholder.
    const { db, shop } = await seededShopContext();

    const [unlensed] = await db
      .select({ lensId: trips.lensId })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, "Morning Two-Tank — Molasses Reef")))
      .limit(1);

    expect(unlensed).toBeDefined();
    expect(unlensed?.lensId).toBeNull();
  });

  it("writes no word twice even when one was deleted and re-seeded", async () => {
    // A deleted word frees its slug for reuse, so a reset after a shop deleted
    // one writes it back rather than colliding.
    const { db, shop } = await seededShopContext();
    const [wrecks] = await db
      .select({ id: tripLenses.id })
      .from(tripLenses)
      .where(and(eq(tripLenses.shopId, shop.id), eq(tripLenses.name, "Wrecks")))
      .limit(1);
    if (!wrecks) throw new Error("expected the seeded 'Wrecks' lens");
    await db
      .update(tripLenses)
      .set({ deletedAt: new Date("2026-09-01T00:00:00.000Z") })
      .where(eq(tripLenses.id, wrecks.id));

    await seedLenses(db, shop.id);

    const live = await listTripLenses(db, shop.id);
    expect(live.filter((lens) => lens.name === "Wrecks")).toHaveLength(1);
    expect(live.find((lens) => lens.name === "Wrecks")?.id).not.toBe(wrecks.id);
  });
});
