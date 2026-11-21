import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { resetDemoFromSnapshot } from "@/features/demo/demo-reset-snapshot";
import { nowDate, nowMs } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import type { AppDb } from "./client";
import { accountSessions, boardingObservations, bookings, shops, trips } from "./schema";
import { createDemoShop, resetDemoSchedule, seedDemo } from "./seed";
import {
  deleteDemoShopCascade,
  enforceMintedDemoCap,
  reapExpiredDemoShops,
} from "./seed-demo-lifecycle";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

describePostgres("demo cleanup encountering a dock sighting", () => {
  for (const operation of ["reset", "reap"] as const) {
    it(`rolls back ${operation} and preserves the sighting and its context`, async () => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "history");
      const shop = await getShopBySlug(pg.db, "blue-mantis");
      if (!shop) throw new Error("shop missing");
      const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
      if (!trip) throw new Error("trip missing");
      const [seat, otherSeat] = await getTripRoster(pg.db, shop.id, trip.id);
      const [staff] = await listStaff(pg.db, shop.id);
      if (!seat || !otherSeat || !staff) throw new Error("seats or staff missing");
      const [bookingBefore] = await pg.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, seat.booking.id));
      const [tripBefore] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
      const observations = await pg.db
        .insert(boardingObservations)
        .values([
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: seat.booking.id,
            recordedByPersonId: staff.person.id,
            clientKey: crypto.randomUUID(),
            state: "pending",
          },
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: otherSeat.booking.id,
            recordedByPersonId: staff.person.id,
            clientKey: crypto.randomUUID(),
            state: "conflict",
            conflictCode: "capacity",
            settledAt: nowDate(),
          },
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: seat.booking.id,
            recordedByPersonId: staff.person.id,
            clientKey: crypto.randomUUID(),
            state: "applied",
            settledAt: nowDate(),
          },
          {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: seat.booking.id,
            recordedByPersonId: staff.person.id,
            clientKey: crypto.randomUUID(),
            state: "dismissed",
            settledAt: nowDate(),
            dismissedByPersonId: staff.person.id,
          },
        ])
        .returning();

      const cleanup =
        operation === "reset"
          ? resetDemoSchedule(pg.db, shop.id, "history")
          : deleteDemoShopCascade(pg.db, shop.id);
      await expect(cleanup).rejects.toThrow("Demo cleanup blocked by dock sighting");
      const retained = await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.shopId, shop.id));
      expect(retained).toHaveLength(4);
      expect(retained).toEqual(expect.arrayContaining(observations));
      expect(await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id))).toEqual([
        bookingBefore,
      ]);
      expect(await pg.db.select().from(trips).where(eq(trips.id, trip.id))).toEqual([tripBefore]);
    });
  }

  it("refuses snapshot replay without retrying a destructive reset", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    let transactions = 0;
    const counted = new Proxy(pg.db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) => {
            transactions++;
            return target.transaction(work);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect((await resetDemoFromSnapshot(counted, shop.id)).mode).toBe("captured");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId: seat.booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    const beforeReplay = transactions;
    await expect(resetDemoFromSnapshot(counted, shop.id)).rejects.toThrow(
      "Demo cleanup blocked by dock sighting",
    );
    expect(transactions - beforeReplay).toBe(1);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
    expect(
      await pg.db.select().from(bookings).where(eq(bookings.id, seat.booking.id)),
    ).toHaveLength(1);
    expect(await pg.db.select().from(trips).where(eq(trips.id, trip.id))).toHaveLength(1);
  });

  it("keeps the protected expired shop and reaps an unrelated expired shop", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const kept = await createDemoShop(pg.db, { shape: "lean" });
    const removed = await createDemoShop(pg.db, { shape: "lean" });
    const keptShop = await getShopBySlug(pg.db, kept.slug);
    const removedShop = await getShopBySlug(pg.db, removed.slug);
    if (!keptShop || !removedShop) throw new Error("minted shops missing");
    const [booking] = await pg.db.select().from(bookings).where(eq(bookings.shopId, keptShop.id));
    const [staff] = await listStaff(pg.db, keptShop.id);
    if (!booking || !staff) throw new Error("fixture missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: keptShop.id,
        tripId: booking.tripId,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    const old = new Date(nowMs() - 10 * 24 * 60 * 60 * 1000);
    await pg.db.update(shops).set({ createdAt: old }).where(eq(shops.id, keptShop.id));
    await pg.db.update(shops).set({ createdAt: old }).where(eq(shops.id, removedShop.id));
    const result = await reapExpiredDemoShops(pg.db);
    expect(result.slugs).toContain(removed.slug);
    expect(result.slugs).not.toContain(kept.slug);
    expect(await getShopBySlug(pg.db, kept.slug)).toBeDefined();
    expect(await getShopBySlug(pg.db, removed.slug)).toBeNull();
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
  });

  it("refuses cap eviction rather than removing a shop with a sighting", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const minted = await createDemoShop(pg.db, { shape: "lean" });
    const shop = await getShopBySlug(pg.db, minted.slug);
    if (!shop) throw new Error("minted shop missing");
    const [booking] = await pg.db.select().from(bookings).where(eq(bookings.shopId, shop.id));
    const [staff] = await listStaff(pg.db, shop.id);
    if (!booking || !staff) throw new Error("fixture missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: shop.id,
        tripId: booking.tripId,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    vi.stubEnv("DEMO_SHOP_MAX_LIVE", "1");
    try {
      await expect(pg.db.transaction((tx) => enforceMintedDemoCap(tx))).rejects.toThrow(
        "Demo cleanup blocked by dock sighting",
      );
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await getShopBySlug(pg.db, minted.slug)).toBeDefined();
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
  });

  it("evicts an unprotected demo when the oldest demo has a sighting", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const kept = await createDemoShop(pg.db, { shape: "lean" });
    const removed = await createDemoShop(pg.db, { shape: "lean" });
    const keptShop = await getShopBySlug(pg.db, kept.slug);
    const removedShop = await getShopBySlug(pg.db, removed.slug);
    if (!keptShop || !removedShop) throw new Error("minted shops missing");
    expect(
      await pg.db.select().from(accountSessions).where(eq(accountSessions.shopId, keptShop.id)),
    ).toEqual([]);
    expect(
      await pg.db.select().from(accountSessions).where(eq(accountSessions.shopId, removedShop.id)),
    ).toEqual([]);
    await pg.db
      .update(shops)
      .set({ createdAt: new Date(nowMs() - 20_000) })
      .where(eq(shops.id, keptShop.id));
    await pg.db
      .update(shops)
      .set({ createdAt: new Date(nowMs() - 10_000) })
      .where(eq(shops.id, removedShop.id));
    const [booking] = await pg.db.select().from(bookings).where(eq(bookings.shopId, keptShop.id));
    const [staff] = await listStaff(pg.db, keptShop.id);
    if (!booking || !staff) throw new Error("fixture missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: keptShop.id,
        tripId: booking.tripId,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    vi.stubEnv("DEMO_SHOP_MAX_LIVE", "2");
    try {
      await pg.db.transaction((tx) => enforceMintedDemoCap(tx));
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await getShopBySlug(pg.db, kept.slug)).toBeDefined();
    expect(await getShopBySlug(pg.db, removed.slug)).toBeNull();
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, booking.id))).toEqual([
      booking,
    ]);
  });

  it("rolls back an earlier eviction if protected demos leave insufficient capacity", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const removable = await createDemoShop(pg.db, { shape: "lean" });
    const protectedDemo = await createDemoShop(pg.db, { shape: "lean" });
    const removableShop = await getShopBySlug(pg.db, removable.slug);
    const protectedShop = await getShopBySlug(pg.db, protectedDemo.slug);
    if (!removableShop || !protectedShop) throw new Error("minted shops missing");
    expect(
      await pg.db
        .select()
        .from(accountSessions)
        .where(eq(accountSessions.shopId, removableShop.id)),
    ).toEqual([]);
    expect(
      await pg.db
        .select()
        .from(accountSessions)
        .where(eq(accountSessions.shopId, protectedShop.id)),
    ).toEqual([]);
    await pg.db
      .update(shops)
      .set({ createdAt: new Date(nowMs() - 20_000) })
      .where(eq(shops.id, removableShop.id));
    await pg.db
      .update(shops)
      .set({ createdAt: new Date(nowMs() - 10_000) })
      .where(eq(shops.id, protectedShop.id));
    const [booking] = await pg.db
      .select()
      .from(bookings)
      .where(eq(bookings.shopId, protectedShop.id));
    const [staff] = await listStaff(pg.db, protectedShop.id);
    if (!booking || !staff) throw new Error("fixture missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: protectedShop.id,
        tripId: booking.tripId,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        clientKey: crypto.randomUUID(),
      })
      .returning();
    vi.stubEnv("DEMO_SHOP_MAX_LIVE", "1");
    try {
      await expect(pg.db.transaction((tx) => enforceMintedDemoCap(tx))).rejects.toThrow(
        "Demo cleanup blocked by dock sighting",
      );
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await getShopBySlug(pg.db, removable.slug)).toBeDefined();
    expect(await getShopBySlug(pg.db, protectedDemo.slug)).toBeDefined();
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, observation.id)),
    ).toEqual([observation]);
  });
});
