import { and, desc, eq, inArray } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import { rollCallCheckpoints } from "@/lib/roll-call";
import type { DbExecutor } from "../client";
import { paymentEntries } from "../payments";
import {
  bookingPaymentEvents,
  bookings,
  cards,
  orderLineItems,
  orders,
  people,
  trips,
  waiverRecords,
} from "../schema";
import { seatNotCancelled } from "../trips-queries";
import { getCurrentWaiverTemplate } from "../waivers";
import { seedArrivals } from "./arrivals";
import { at, withinDeskHours } from "./clock";
import { salesTaxCents } from "./history";
import { paperRelease } from "./paper-release";
import { seedRollCallEvidence } from "./roll-call-evidence";

/** Current, already-cleared divers who also sailed with the shop before. */
export async function seedReturningDivers(
  db: DbExecutor,
  shopId: string,
  actorId: string,
  customers: (typeof people.$inferSelect)[],
): Promise<void> {
  // These three already have signed current releases and verified cards; do
  // not clear the deliberately unsigned release on the first reef seat.
  const regulars = [customers[3], customers[4], customers[5]].filter(
    (person): person is typeof people.$inferSelect => !!person,
  );
  if (regulars.length !== 3) throw new Error("seed: returning divers missing");
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) throw new Error("seed: waiver template missing");
  const history = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
      ),
    )
    .orderBy(desc(trips.startsAt));
  const tripIds = history.map((trip) => trip.id);
  const existing = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), inArray(bookings.tripId, tripIds), seatNotCancelled));
  const seats = new Map<string, number>();
  for (const row of existing) seats.set(row.tripId, (seats.get(row.tripId) ?? 0) + 1);
  const candidates = history.filter(
    (trip) =>
      !trip.title.startsWith("Night Dive") &&
      trip.priceCents !== null &&
      (seats.get(trip.id) ?? 0) < trip.capacity,
  );
  if (candidates.length < regulars.length * 2)
    throw new Error("seed: not enough room for returning divers");

  // Their profiles and reviewed cards were on file before these departures.
  const ids = regulars.map((person) => person.id);
  await db
    .update(people)
    .set({ createdAt: at(-500, 9) })
    .where(and(eq(people.shopId, shopId), inArray(people.id, ids)));
  await db
    .update(cards)
    .set({ createdAt: at(-450, 15) })
    .where(and(eq(cards.shopId, shopId), eq(cards.kind, "level"), inArray(cards.personId, ids)));

  const plans = candidates.slice(0, regulars.length * 2).map((trip, index) => {
    const person = regulars[index % regulars.length];
    if (!person) throw new Error("seed: missing regular");
    return {
      trip,
      person,
      bookedAt: new Date(trip.startsAt.getTime() - 14 * DAY_MS),
      paidAt: new Date(trip.startsAt.getTime() - 5 * DAY_MS),
    };
  });
  const seatsWritten = await db
    .insert(bookings)
    .values(
      plans.map(({ trip, person, bookedAt }) => ({
        shopId,
        tripId: trip.id,
        personId: person.id,
        status: "booked" as const,
        bookedAs: "diver" as const,
        createdAt: bookedAt,
      })),
    )
    .returning();
  await db.insert(waiverRecords).values(
    plans.map(({ trip, person }, index) => {
      const booking = seatsWritten[index];
      if (!booking) throw new Error("seed: missing returning booking");
      const signedAt = withinDeskHours(new Date(trip.startsAt.getTime() - DAY_MS));
      return {
        shopId,
        bookingId: booking.id,
        personId: person.id,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateGeneration: template.materialGeneration,
        templateBody: template.body,
        ...paperRelease(signedAt, actorId, person.fullName),
        createdAt: signedAt,
      };
    }),
  );
  const invoices = await db
    .insert(orders)
    .values(
      plans.map(({ trip, person, paidAt }, index) => {
        const booking = seatsWritten[index];
        if (!booking || trip.priceCents === null) throw new Error("seed: missing returning fare");
        const taxCents = salesTaxCents(trip.priceCents);
        return {
          shopId,
          bookingId: booking.id,
          personId: person.id,
          createdByPersonId: actorId,
          status: "paid" as const,
          currency: "usd",
          totalCents: trip.priceCents + taxCents,
          amountPaidCents: trip.priceCents + taxCents,
          taxCents,
          description: "Two-tank charter",
          stripeAccountId: "acct_demo",
          stripeCustomerId: `cus_demo_${shopId}_return_${index}`,
          stripeInvoiceId: `in_demo_${shopId}_return_${index}`,
          finalizedAt: paidAt,
          paidAt,
          createdAt: paidAt,
          updatedAt: paidAt,
        };
      }),
    )
    .returning();
  await db.insert(orderLineItems).values(
    invoices.map((order, index) => ({
      shopId,
      orderId: order.id,
      kind: "trip_fee" as const,
      description: "Two-tank charter",
      quantity: 1,
      unitAmountCents: plans[index]?.trip.priceCents ?? 0,
      createdAt: order.createdAt,
    })),
  );
  await db.insert(bookingPaymentEvents).values(
    paymentEntries(
      invoices.map((order) => ({
        shopId,
        bookingId: order.bookingId as string,
        status: "paid" as const,
        amountCents: order.amountPaidCents,
        currency: order.currency,
        provider: "stripe",
        providerRef: order.stripeInvoiceId,
        createdAt: order.paidAt as Date,
        updatedAt: order.paidAt as Date,
      })),
    ),
  );
  await seedArrivals(
    db,
    seatsWritten.map((seat, index) => {
      const trip = plans[index]?.trip;
      if (!trip) throw new Error("seed: missing returning trip");
      const occurredAt = new Date(trip.startsAt.getTime() - 10 * 60_000);
      return {
        shopId,
        tripId: trip.id,
        bookingId: seat.id,
        recordedByPersonId: actorId,
        occurredAt,
        createdAt: occurredAt,
      };
    }),
  );
  await seedRollCallEvidence(
    db,
    seatsWritten.flatMap((seat, index) => {
      const trip = plans[index]?.trip;
      if (!trip) throw new Error("seed: missing returning trip");
      return rollCallCheckpoints(trip.plannedDives).map((checkpoint, count) => {
        const occurredAt = new Date(trip.startsAt.getTime() + count * 90 * 60_000);
        return {
          shopId,
          tripId: trip.id,
          bookingId: seat.id,
          recordedByPersonId: actorId,
          status: "boarded" as const,
          checkpoint,
          source: "live" as const,
          occurredAt,
          createdAt: occurredAt,
        };
      });
    }),
    { observesPrevious: false },
  );
}
