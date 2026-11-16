import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { createPerson } from "@/db/people";
import { bookings, shops, trips, userAccounts } from "@/db/schema";
import { nowDate } from "@/lib/clock";

export async function tripCreditTestFixture(db: AppDb, existingShop?: typeof shops.$inferSelect) {
  const [created] = existingShop
    ? []
    : await db
        .insert(shops)
        .values({ name: "Credit Reef", slug: `credit-${randomUUID()}`, timezone: "UTC" })
        .returning();
  const shop = existingShop ?? created;
  if (!shop) throw new Error("credit fixture shop missing");
  await db
    .update(shops)
    .set({ currency: "usd", taxEnabled: false, passThroughFee: null })
    .where(eq(shops.id, shop.id));
  const actorEmail = `${randomUUID()}@example.com`;
  const actor = await createPerson(db, {
    shopId: shop.id,
    fullName: "Credit Manager",
    email: actorEmail,
    phone: null,
    origin: "counter",
    roles: ["owner"],
  });
  await db.insert(userAccounts).values({ personId: actor.id, email: actorEmail, status: "active" });
  const diver = await createPerson(db, {
    shopId: shop.id,
    fullName: "Credit Diver",
    email: `${randomUUID()}@example.com`,
    phone: null,
    origin: "counter",
  });
  const start = new Date(nowDate().getTime() + 7 * 86_400_000);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Promotional reef",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3_600_000),
      capacity: 4,
      priceCents: 10_000,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: diver.id, bookedAs: "diver" })
    .returning();
  const scope = { shopId: shop.id, personId: diver.id, actorPersonId: actor.id, currency: "usd" };
  const grant = {
    ...scope,
    attemptId: randomUUID(),
    amountCents: 10_000,
    reason: "goodwill" as const,
  };
  const redeem = {
    ...scope,
    attemptId: randomUUID(),
    bookingId: booking.id,
    expectedFareCents: 10_000,
  };
  return { db, shop, actor, diver, trip, booking, scope, grant, redeem };
}
