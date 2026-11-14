import { eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { requireNoRetainedSafetyForDemoReset } from "./retained-safety";
import {
  boardingObservations,
  rollCallEventClaims,
  shops,
  unresolvedSafetyAlertOutbox,
} from "./schema";
import { resetDemoSchedule } from "./seed";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

it("refuses demo reset while a dock sighting remains open", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  const [staff] = await listStaff(db, shop.id);
  if (!seat || !staff) throw new Error("seat or staff missing");
  const [observation] = await db
    .insert(boardingObservations)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.booking.id,
      clientKey: crypto.randomUUID(),
      recordedByPersonId: staff.person.id,
    })
    .returning();
  await expect(db.transaction((tx) => resetDemoSchedule(tx, shop.id, "history"))).rejects.toThrow(
    "unresolved safety evidence",
  );
  expect(
    await db.select().from(boardingObservations).where(eq(boardingObservations.id, observation.id)),
  ).toEqual([observation]);
  await db
    .update(boardingObservations)
    .set({ state: "applied", settledAt: nowDate() })
    .where(eq(boardingObservations.id, observation.id));
  await expect(db.transaction((tx) => resetDemoSchedule(tx, shop.id, "history"))).rejects.toThrow(
    "unresolved safety evidence",
  );
  const [otherShop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(ne(shops.id, shop.id))
    .limit(1);
  if (!otherShop) throw new Error("other shop missing");
  await expect(
    db.transaction((tx) => requireNoRetainedSafetyForDemoReset(tx, otherShop.id)),
  ).resolves.toBeUndefined();
});

it("refuses demo reset before altering a retained safety obligation", async () => {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips[0];
  if (!trip) throw new Error("trip missing");
  const [claim] = await db
    .insert(rollCallEventClaims)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
    })
    .returning({ id: rollCallEventClaims.id });
  const [outbox] = await db
    .insert(unresolvedSafetyAlertOutbox)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      claimId: claim.id,
      generationId: crypto.randomUUID(),
    })
    .returning({ id: unresolvedSafetyAlertOutbox.id });
  await expect(db.transaction((tx) => resetDemoSchedule(tx, shop.id, "history"))).rejects.toThrow(
    "unresolved safety evidence",
  );
  const [otherShop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(ne(shops.id, shop.id))
    .limit(1);
  if (!otherShop) throw new Error("other shop missing");
  await expect(
    db.transaction((tx) => requireNoRetainedSafetyForDemoReset(tx, otherShop.id)),
  ).resolves.toBeUndefined();
  expect(
    await db
      .select({ id: unresolvedSafetyAlertOutbox.id })
      .from(unresolvedSafetyAlertOutbox)
      .where(eq(unresolvedSafetyAlertOutbox.id, outbox.id)),
  ).toEqual([{ id: outbox.id }]);
  expect((await upcomingTripsWithCounts(db, shop.id)).map((item) => item.id)).toEqual(
    trips.map((item) => item.id),
  );
});
