import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { DemoSightingCleanupBlocked, refuseLateDockSightings } from "./demo-sighting-guard";
import { boardingObservations, people } from "./schema";

const ctx = fileScopedShopContext();

it("refuses a same-shop sighting without deleting it, and ignores another shop", async () => {
  const { db, shop } = ctx;
  const [actor] = await db.select({ id: people.id }).from(people).where(eq(people.shopId, shop.id));
  if (!actor) throw new Error("actor missing");
  const [sighting] = await db
    .insert(boardingObservations)
    .values({
      shopId: shop.id,
      tripId: randomUUID(),
      bookingId: randomUUID(),
      clientKey: randomUUID(),
      recordedByPersonId: actor.id,
    })
    .returning();
  if (!sighting) throw new Error("sighting missing");

  await expect(refuseLateDockSightings(db, randomUUID())).resolves.toBeUndefined();
  await expect(refuseLateDockSightings(db, shop.id)).rejects.toBeInstanceOf(
    DemoSightingCleanupBlocked,
  );
  expect(
    await db.select().from(boardingObservations).where(eq(boardingObservations.id, sighting.id)),
  ).toEqual([sighting]);
});
