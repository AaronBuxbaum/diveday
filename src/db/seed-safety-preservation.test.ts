import { eq, ne } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { requireNoRetainedSafetyForDemoReset } from "./retained-safety";
import { rollCallEventClaims, shops, unresolvedSafetyAlertOutbox } from "./schema";
import { resetDemoSchedule } from "./seed";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

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
