import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { shops, tripLenses, trips } from "./schema";
import {
  countTripLensDepartures,
  createTripLens,
  deleteTripLens,
  getTripLens,
  listTripLenses,
  renameTripLens,
} from "./trip-lenses";

/**
 * The seeded demo shop already owns a six-word vocabulary
 * (`src/db/seed-lenses.ts`), so every word written here is one the demo does
 * not use. A test that reached for "Wrecks" would be asserting against a
 * collision suffix rather than against the rule it means to pin.
 */
async function rivalShop(db: AppDb) {
  const [rival] = await db
    .insert(shops)
    .values({ name: "Rival Reef", slug: "rival-reef-lenses", timezone: "America/New_York" })
    .returning();
  if (!rival) throw new Error("rival shop insert failed");
  return rival;
}

function mustCreate(lens: Awaited<ReturnType<typeof createTripLens>>) {
  if (!lens) throw new Error("lens insert failed");
  return lens;
}

describe("a shop's trip tags", () => {
  it("writes them, keeps them in the order they were written, and reads one back", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listTripLenses(db, shop.id);

    const drift = mustCreate(await createTripLens(db, shop.id, "Drift days"));
    const blue = mustCreate(await createTripLens(db, shop.id, "Blue water"));

    expect(drift.slug).toBe("drift-days");
    expect(blue.slug).toBe("blue-water");

    const listed = await listTripLenses(db, shop.id);
    // Insertion order *is* the rail's order — the order the shop wrote its own
    // vocabulary in, never alphabetical, so the two new words land at the end.
    expect(listed.slice(before.length).map((lens) => lens.name)).toEqual([
      "Drift days",
      "Blue water",
    ]);
    expect((await getTripLens(db, shop.id, blue.id))?.name).toBe("Blue water");
  });

  it("keeps the slug where it is when the shop corrects the word", async () => {
    // The link a diver shared yesterday still has to land on the same list.
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Drift days"));

    const renamed = await renameTripLens(db, shop.id, lens.id, "Drifting");

    expect(renamed?.name).toBe("Drifting");
    expect(renamed?.slug).toBe("drift-days");
  });
});

describe("two words written in the same instant", () => {
  /**
   * The frozen test clock stamps every row a run writes with one instant, and
   * the order used to fall through to a random uuid, which re-ordered the
   * storefront rail between seeded databases (issue #1762). The ids are forced
   * so the old order is the wrong one.
   */
  it("are listed by name, never by their random ids", async () => {
    const { db } = await seededShopContext();
    const rival = await rivalShop(db);
    const createdAt = new Date("2026-07-21T13:30:00.000Z");
    await db.insert(tripLenses).values([
      {
        id: "00000000-0000-4000-8000-000000000001",
        shopId: rival.id,
        name: "Wrecks",
        slug: "wrecks",
        createdAt,
      },
      {
        id: "ffffffff-ffff-4fff-bfff-ffffffffffff",
        shopId: rival.id,
        name: "Reefs",
        slug: "reefs",
        createdAt,
      },
    ]);
    expect((await listTripLenses(db, rival.id)).map((lens) => lens.name)).toEqual([
      "Reefs",
      "Wrecks",
    ]);
  });
});

describe("deleting a word", () => {
  it("stamps it instead of removing it, and takes it off the rail", async () => {
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Long range"));

    expect(await deleteTripLens(db, shop.id, lens.id)).toBe(true);

    expect((await listTripLenses(db, shop.id)).map((row) => row.id)).not.toContain(lens.id);
    expect(await getTripLens(db, shop.id, lens.id)).toBeNull();
    const [kept] = await db.select().from(tripLenses).where(eq(tripLenses.id, lens.id));
    expect(kept?.name).toBe("Long range");
    expect(kept?.deletedAt).toBeInstanceOf(Date);
  });

  it("leaves every departure still naming the word it wore", async () => {
    // The reason the row survives at all: a past day still says which kind of
    // day it was (ADR 20260820-every-delete-is-soft).
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Blue water"));
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    await db.update(trips).set({ lensId: lens.id }).where(eq(trips.id, trip.id));

    await deleteTripLens(db, shop.id, lens.id);

    const [after] = await db
      .select({ lensId: trips.lensId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.lensId).toBe(lens.id);
  });

  it("counts the departures the delete touches, so the confirm can say", async () => {
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Shark season"));
    expect(await countTripLensDepartures(db, shop.id, lens.id)).toBe(0);

    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(2);
    for (const row of rows) {
      await db.update(trips).set({ lensId: lens.id }).where(eq(trips.id, row.id));
    }
    expect(await countTripLensDepartures(db, shop.id, lens.id)).toBe(rows.length);
  });

  it("frees the word for reuse, because the unique slug covers live rows only", async () => {
    const { db, shop } = await seededShopContext();
    const first = mustCreate(await createTripLens(db, shop.id, "Photo mornings"));
    expect(first.slug).toBe("photo-mornings");
    await deleteTripLens(db, shop.id, first.id);

    const second = mustCreate(await createTripLens(db, shop.id, "Photo mornings"));

    // A shop that changed its mind gets its own word back, not "…-2".
    expect(second.slug).toBe("photo-mornings");
    expect(second.id).not.toBe(first.id);
  });

  it("suffixes a slug that collides with a word already in use", async () => {
    const { db, shop } = await seededShopContext();
    expect(mustCreate(await createTripLens(db, shop.id, "Photo mornings")).slug).toBe(
      "photo-mornings",
    );

    expect(mustCreate(await createTripLens(db, shop.id, "photo mornings")).slug).toBe(
      "photo-mornings-2",
    );
  });

  it("does not retire the same word twice, keeping the date it was retired", async () => {
    const { db, shop } = await seededShopContext();
    const lens = mustCreate(await createTripLens(db, shop.id, "Quiet mornings"));
    expect(await deleteTripLens(db, shop.id, lens.id)).toBe(true);
    const [first] = await db.select().from(tripLenses).where(eq(tripLenses.id, lens.id));

    expect(await deleteTripLens(db, shop.id, lens.id)).toBe(false);

    const [again] = await db.select().from(tripLenses).where(eq(tripLenses.id, lens.id));
    expect(again?.deletedAt).toEqual(first?.deletedAt);
  });
});

describe("another shop's vocabulary", () => {
  it("cannot be read, renamed, deleted or counted across the tenant line", async () => {
    const { db, shop } = await seededShopContext();
    const rival = await rivalShop(db);
    const lens = mustCreate(await createTripLens(db, shop.id, "Drift days"));

    expect(await getTripLens(db, rival.id, lens.id)).toBeNull();
    expect(await renameTripLens(db, rival.id, lens.id, "Stolen")).toBeNull();
    expect(await deleteTripLens(db, rival.id, lens.id)).toBe(false);
    expect(await countTripLensDepartures(db, rival.id, lens.id)).toBe(0);
    expect(await listTripLenses(db, rival.id)).toEqual([]);

    // And the word is untouched at the shop that wrote it.
    expect((await getTripLens(db, shop.id, lens.id))?.name).toBe("Drift days");
  });
});
