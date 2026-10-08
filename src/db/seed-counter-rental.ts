import { and, eq, inArray, isNull } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { bookings, gearItems, gearReservations, type people } from "./schema";

/**
 * **One counter rental on the books** (ADR 20260815-minimal-gear-register,
 * amended 2026-10-08): the camera and a pair of boots, put by over the phone
 * for a diver who is snorkeling from the shore this weekend and has no boat
 * booked. Both are soft goods, so the counter's card rule has nothing to ask
 * of them (`counterRentalCardRefusal`); a seeded regulator would show a rental
 * the counter could not have written for somebody with no card on file. Picked
 * up tomorrow, back two days later — reserved, not yet out, so the register's
 * wall shows the hold, the diver's record shows "Rented", and nothing on
 * Today or in the Out group moves (a unit out or overdue is a trouble state,
 * seeded per test through `/api/test/seed-trouble-states`, never here).
 *
 * No invoice: an order dated in the seed would sit in the Orders index, whose
 * first row the `order-detail` capture clicks through to (see
 * `seed-open-invoice.ts`). Both rows go in one statement, so they share the
 * `created_at` that makes them one rental.
 */
export async function seedCounterRental(
  db: DbExecutor,
  shopId: string,
  ctx: { timezone: string; divers: (typeof people.$inferSelect)[] },
): Promise<void> {
  const booked = new Set(
    (
      await db
        .select({ personId: bookings.personId })
        .from(bookings)
        .where(eq(bookings.shopId, shopId))
    ).map((row) => row.personId),
  );
  // A diver with no departure on the board: the person this is for.
  const diver = ctx.divers.find((person) => !booked.has(person.id) && !person.deletedAt);
  if (!diver) return;

  const units = await db
    .select({ id: gearItems.id })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        inArray(gearItems.label, ["GoPro A", "Boots #2"]),
        isNull(gearItems.deletedAt),
      ),
    );
  if (units.length === 0) return;

  const tomorrow = shiftCalendarDate(calendarDateInTimezone(nowDate(), ctx.timezone), 1);
  await db.insert(gearReservations).values(
    units.map((unit) => ({
      shopId,
      gearItemId: unit.id,
      personId: diver.id,
      reservedFrom: tomorrow,
      reservedUntil: shiftCalendarDate(tomorrow, 2),
    })),
  );
}
