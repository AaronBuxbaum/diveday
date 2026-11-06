import { and, count, eq, gt, inArray, isNull, lte, notExists } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { staffLogins } from "./desk-pings";
import { sendNotification } from "./notifications";
import { activityEvents, bookings, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **Tell the desk when a seat sells** (loop 5, row 8; glossary "Seat-sold
 * alert"): the hourly scan's half. For each shop that switched the Features
 * row on (`shops.seat_sold_alerts_enabled`, off for a new shop), one email to
 * each owner and manager with the seats sold since the last pass, counted by
 * departure and nothing about who bought them.
 *
 * - **A seat the diver bought.** A seat a staffer put on the boat (the trail's
 *   `seat_added`, `rider_added_at_dock`,
 *   `seat_moved_here`) is not news to the desk. A cancelled seat is not a
 *   sale, so the pass counts seats that hold at the moment it runs.
 * - **Exactly once.** `shops.seat_sold_alerted_through` is the cursor: the
 *   pass takes it with a compare-and-set before it reads, so two passes cannot
 *   send the same batch, and a pass whose every send failed gives it back. It
 *   reaches back at most {@link LOOK_BACK_MS}, so a shop that switches the row
 *   on after weeks off is not told about weeks.
 * - **Quiet is silent.** No seat sold, no email. A demo shop's staff addresses
 *   are anybody's and are never mailed.
 */
const HOUR_MS = 60 * 60 * 1000;
export const LOOK_BACK_MS = 3 * HOUR_MS;
const SHOWN_DEPARTURES = 40;

const STAFF_SEATED_CODES = ["seat_added", "rider_added_at_dock", "seat_moved_here"] as const;

export type SeatSoldSummary = { shops: number; sent: number; failed: number; seats: number };

/** The departures that sold seats in `(since, through]`, soonest first. */
async function seatsSoldBetween(db: AppDb, shopId: string, since: Date, through: Date) {
  return db
    .select({ title: trips.title, startsAt: trips.startsAt, seats: count(bookings.id) })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        gt(bookings.createdAt, since),
        lte(bookings.createdAt, through),
        liveTrip(),
        notRehearsal(),
        notExists(
          db
            .select({ one: activityEvents.id })
            .from(activityEvents)
            .where(
              and(
                eq(activityEvents.shopId, shopId),
                eq(activityEvents.bookingId, bookings.id),
                inArray(activityEvents.code, [...STAFF_SEATED_CODES]),
              ),
            ),
        ),
      ),
    )
    .groupBy(trips.id, trips.title, trips.startsAt)
    .orderBy(trips.startsAt, trips.title, trips.id);
}

export async function sendSeatSoldAlerts(
  db: AppDb,
  input: { now?: Date; origin?: string | null; provider?: NotificationProvider } = {},
): Promise<SeatSoldSummary> {
  const now = input.now ?? nowDate();
  const summary: SeatSoldSummary = { shops: 0, sent: 0, failed: 0, seats: 0 };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  if (!origin) return summary;
  const candidates = await db
    .select({
      id: shops.id,
      slug: shops.slug,
      name: shops.name,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
      cursor: shops.seatSoldAlertedThrough,
    })
    .from(shops)
    .where(and(eq(shops.seatSoldAlertsEnabled, true), eq(shops.isDemo, false)));

  for (const shop of candidates) {
    // The pass's claim: only one pass may move the cursor off the value it read.
    const claimed = await db
      .update(shops)
      .set({ seatSoldAlertedThrough: now })
      .where(
        and(
          eq(shops.id, shop.id),
          shop.cursor
            ? eq(shops.seatSoldAlertedThrough, shop.cursor)
            : isNull(shops.seatSoldAlertedThrough),
        ),
      )
      .returning({ id: shops.id });
    if (claimed.length === 0) continue;

    const floor = new Date(now.getTime() - LOOK_BACK_MS);
    const since = shop.cursor ?? new Date(now.getTime() - HOUR_MS);
    const sold = await seatsSoldBetween(db, shop.id, since > floor ? since : floor, now);
    const seats = sold.reduce((sum, row) => sum + Number(row.seats), 0);
    if (seats === 0) continue;

    const recipients = (await staffLogins(db, shop.id)).filter(
      (person) => person.roles.includes("owner") || person.roles.includes("manager"),
    );
    const shown = sold.slice(0, SHOWN_DEPARTURES);
    const moreSeats = sold.slice(SHOWN_DEPARTURES).reduce((sum, row) => sum + Number(row.seats), 0);
    let sent = 0;
    let failed = 0;
    for (const person of recipients) {
      const delivery = await sendNotification(
        db,
        {
          kind: "seat_sold_digest",
          shopId: shop.id,
          personId: person.personId,
          to: person.email,
          locale: recipientLocale(person.locale, shop.defaultLocale),
          recipientName: person.fullName,
          shopName: shop.name,
          timezone: shop.timezone,
          departures: shown.map((row) => ({
            title: row.title,
            startsAt: row.startsAt,
            seats: Number(row.seats),
          })),
          moreSeats,
          boardUrl: `${origin}${shopPath(shop.slug, "schedule")}`,
          settingsUrl: `${origin}${shopPath(shop.slug, "settings", "features")}`,
          throughAt: now,
        },
        input.provider,
      );
      if (delivery.status === "sent") sent += 1;
      else failed += 1;
    }
    // Nobody got it: give the batch back so the next pass tries the same seats.
    if (sent === 0 && failed > 0) {
      await db
        .update(shops)
        .set({ seatSoldAlertedThrough: shop.cursor })
        .where(and(eq(shops.id, shop.id), eq(shops.seatSoldAlertedThrough, now)));
    }
    summary.shops += 1;
    summary.sent += sent;
    summary.failed += failed;
    summary.seats += seats;
    // Ids and counts only: never an address, a name, or a departure's words.
    log("seat_sold_alerts.sent", "info", { shopId: shop.id, seats, sent, failed });
  }
  return summary;
}
