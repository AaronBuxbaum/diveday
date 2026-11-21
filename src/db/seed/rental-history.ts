import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { DbExecutor } from "../client";
import { bookings, gearItems, gearReservations, rollCallEvents, trips } from "../schema";
import { at, DEMO_SHOP_TIMEZONE } from "./clock";

/** Rental gear that actually left the wall and came home on recent boat days. */
export async function seedRentalHistory(
  db: DbExecutor,
  shopId: string,
  currentCustomerIds: readonly string[],
): Promise<void> {
  // The fleet's earliest hydro and service records predate the last year. The
  // units must already be in the register before either care or rentals.
  await db
    .update(gearItems)
    .set({ createdAt: at(-1_200, 9) })
    .where(eq(gearItems.shopId, shopId));
  const days = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.description, "Sailed. Kept in the log for the shop's monthly numbers."),
        isNull(trips.deletedAt),
      ),
    )
    .orderBy(desc(trips.startsAt))
    .limit(12);
  if (!days.length) return;
  const ids = days.map((day) => day.id);
  const seats = await db
    .select({ id: bookings.id, tripId: bookings.tripId, createdAt: bookings.createdAt })
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
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, ids),
        notInArray(bookings.personId, [...currentCustomerIds]),
        eq(bookings.status, "booked"),
      ),
    )
    .orderBy(asc(bookings.createdAt));
  const units = await db
    .select({ id: gearItems.id, label: gearItems.label })
    .from(gearItems)
    .where(and(eq(gearItems.shopId, shopId), isNull(gearItems.deletedAt)));
  const byLabel = new Map(units.map((unit) => [unit.label, unit.id]));
  const used = new Set<string>();
  const rows: (typeof gearReservations.$inferInsert)[] = [];
  days.forEach((trip, dayIndex) => {
    const date = calendarDateInTimezone(trip.startsAt, DEMO_SHOP_TIMEZONE);
    const checkedOutAt = new Date(trip.startsAt.getTime() - 30 * 60_000);
    const divers = seats
      .filter((seat) => seat.tripId === trip.id && seat.createdAt <= checkedOutAt)
      .slice(0, 2);
    divers.forEach((seat, personIndex) => {
      const slot = (dayIndex * 2 + personIndex) % 4;
      const labels = [`BCD #${slot + 1}`, `Reg #${slot === 3 ? 5 : slot + 1}`, `3mm #${slot + 1}`];
      for (const label of labels) {
        const gearItemId = byLabel.get(label);
        if (!gearItemId || used.has(`${date}:${gearItemId}`)) continue;
        used.add(`${date}:${gearItemId}`);
        const createdAt = new Date(
          Math.max(seat.createdAt.getTime(), trip.startsAt.getTime() - 24 * 60 * 60_000),
        );
        rows.push({
          shopId,
          bookingId: seat.id,
          gearItemId,
          reservedFrom: date,
          reservedUntil: date,
          createdAt,
          checkedOutAt,
          returnedAt: new Date(trip.endsAt.getTime() + 15 * 60_000),
          returnOutcome:
            label.startsWith("3mm") && dayIndex % 4 === 0 ? "fit_adjusted" : "all_good",
        });
      }
    });
  });
  if (rows.length) await db.insert(gearReservations).values(rows);
}
