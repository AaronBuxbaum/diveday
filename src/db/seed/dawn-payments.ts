import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { paymentEntries } from "../payments";
import {
  bookingPaymentEvents,
  bookings,
  cards,
  people,
  rollCallEvents,
  tripDives,
  tripRequirements,
  trips,
} from "../schema";
import { at } from "./clock";
import { DEMO_COMPLETED_TRIP_TITLE } from "./more-trips";

/** Most divers on the first-light boat paid the desk before they sailed. */
export async function seedDawnPayments(
  db: DbExecutor,
  shopId: string,
  actorId: string,
): Promise<void> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)))
    .limit(1);
  if (!trip || trip.priceCents === null) return;
  const boarded = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .innerJoin(
      rollCallEvents,
      and(
        eq(rollCallEvents.bookingId, bookings.id),
        eq(rollCallEvents.subjectKind, "seat"),
        eq(rollCallEvents.checkpoint, "departure"),
        eq(rollCallEvents.status, "boarded"),
      ),
    )
    .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, trip.id)))
    .orderBy(asc(bookings.createdAt));
  // Leave one balance for the desk to follow up, instead of an entire boat
  // that sailed without paying. These are cash-like marks, not Stripe charges.
  const paid = boarded.slice(0, Math.max(0, boarded.length - 1));
  if (!boarded.length) return;
  const plannedAt = at(-40, 9);
  await db
    .update(trips)
    .set({ createdAt: plannedAt })
    .where(and(eq(trips.shopId, shopId), eq(trips.id, trip.id)));
  await db.update(tripDives).set({ createdAt: plannedAt }).where(eq(tripDives.tripId, trip.id));
  await db
    .update(tripRequirements)
    .set({ createdAt: plannedAt })
    .where(and(eq(tripRequirements.shopId, shopId), eq(tripRequirements.tripId, trip.id)));
  // These are established customers with reviewed cards, not people first
  // entered after the payment or card review we are recording for them.
  const peopleIds = boarded.map((seat) => seat.personId);
  await db
    .update(people)
    .set({ createdAt: at(-500, 9) })
    .where(and(eq(people.shopId, shopId), inArray(people.id, peopleIds)));
  await db
    .update(cards)
    .set({ createdAt: at(-450, 15) })
    .where(
      and(eq(cards.shopId, shopId), eq(cards.kind, "level"), inArray(cards.personId, peopleIds)),
    );
  for (const [index, seat] of boarded.entries()) {
    await db
      .update(bookings)
      .set({ createdAt: new Date(at(-35, 15).getTime() + index * 1_000) })
      .where(and(eq(bookings.shopId, shopId), eq(bookings.id, seat.id)));
  }
  if (!paid.length) return;
  const paidAt = at(-1, 16);
  await db.insert(bookingPaymentEvents).values(
    paymentEntries(
      paid.map((seat) => ({
        shopId,
        bookingId: seat.id,
        status: "paid" as const,
        amountCents: trip.priceCents,
        manualHeldCents: trip.priceCents ?? 0,
        currency: "usd",
        method: "cash" as const,
        recordedByPersonId: actorId,
        createdAt: paidAt,
        updatedAt: paidAt,
      })),
    ),
  );
}
