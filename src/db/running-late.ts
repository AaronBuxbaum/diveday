import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import { canSayRunningLate, RUNNING_LATE_LEAD_MS } from "@/lib/running-late";
import type { AppDb } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **"Running late", written** (J3). Three doors reach this module — the
 * diver's own `/ready` link, a `LATE` reply on the shop's WhatsApp or email
 * (`src/db/reply-keywords.ts`), and a `LATE` text to DiveDay's number
 * (`/api/webhooks/sms`) — and all of them end in one guarded update:
 *
 * - **Only an open seat.** `canSayRunningLate` (src/lib/running-late.ts):
 *   booked, not checked in, on a scheduled departure that leaves within the
 *   next twelve hours and has not left. Re-checked in the `where` clause, so a
 *   check-in landing between the read and the write wins.
 * - **The first statement stands.** A second tap, or a provider redelivering
 *   the same reply, changes nothing: "said 7:42" stays the moment the diver
 *   first said it.
 *
 * It gates nothing (see `src/lib/running-late.ts`), which is why a reply
 * channel authenticated by an address alone may write it.
 */

export type RunningLateOutcome =
  | { status: "marked"; bookingId: string; at: Date }
  /** Said before; the stored instant is the one returned. */
  | { status: "already"; bookingId: string; at: Date }
  /** No seat this could be about: checked in, released, the boat gone, or too far off. */
  | { status: "closed" };

/** The one write. Guarded by the same rule the read applied. */
async function stamp(
  db: AppDb,
  shopId: string,
  bookingId: string,
  now: Date,
): Promise<RunningLateOutcome> {
  const [row] = await db
    .select({
      status: bookings.status,
      runningLateAt: bookings.runningLateAt,
      tripStatus: trips.status,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(bookings.id, bookingId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!row) return { status: "closed" };
  if (
    !canSayRunningLate({
      bookingStatus: row.status,
      tripStatus: row.tripStatus,
      startsAt: row.startsAt,
      now,
    })
  ) {
    return { status: "closed" };
  }
  if (row.runningLateAt) return { status: "already", bookingId, at: row.runningLateAt };
  const [updated] = await db
    .update(bookings)
    .set({ runningLateAt: now })
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.id, bookingId),
        eq(bookings.status, "booked"),
        isNull(bookings.runningLateAt),
      ),
    )
    .returning({ at: bookings.runningLateAt });
  if (updated?.at) return { status: "marked", bookingId, at: updated.at };
  // Lost a race: either a check-in (closed) or a concurrent tap (already).
  const [after] = await db
    .select({ status: bookings.status, at: bookings.runningLateAt })
    .from(bookings)
    .where(and(eq(bookings.shopId, shopId), eq(bookings.id, bookingId)))
    .limit(1);
  return after?.status === "booked" && after.at
    ? { status: "already", bookingId, at: after.at }
    : { status: "closed" };
}

/** The `/ready` button: this exact seat, which the signed link already named. */
export async function markBookingRunningLate(
  db: AppDb,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<RunningLateOutcome> {
  return stamp(db, input.shopId, input.bookingId, input.now);
}

/**
 * The seats a person could say "running late" about right now, soonest first.
 * The window is applied in SQL as a bound and again by `canSayRunningLate`.
 */
function openSeatsWhere(now: Date) {
  return and(
    eq(bookings.status, "booked"),
    eq(trips.status, "scheduled"),
    liveTrip(),
    gt(trips.startsAt, now),
    lte(trips.startsAt, new Date(now.getTime() + RUNNING_LATE_LEAD_MS)),
  );
}

/**
 * A `LATE` reply from a diver this shop already attributed (WhatsApp or
 * email). **The soonest open seat**, never an ambiguity refusal like `C`'s:
 * cancelling the wrong seat loses one, while "running late" on the morning's
 * first boat is what a diver typing it on the way to the dock means, and it
 * only ever adds a line to a list.
 */
export async function markPersonRunningLate(
  db: AppDb,
  input: { shopId: string; personId: string; now: Date },
): Promise<RunningLateOutcome> {
  const [next] = await db
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(bookings.personId, input.personId),
        openSeatsWhere(input.now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) return { status: "closed" };
  return stamp(db, input.shopId, next.bookingId, input.now);
}

/**
 * A `LATE` text to DiveDay's one number. The carrier vouches for the phone and
 * nothing names a shop, so this finds **the soonest open seat held under
 * exactly that number, in any shop**: every writer of `people.phone` stores
 * E.164 (`storedPhone`), the same digits the carrier reports. A number on two
 * divers' records, or on none, finds what it finds — the statement gates
 * nothing, and no answer goes back over SMS (ADR 20260907-two-way-inbox,
 * decision 7), so nothing about any booking is disclosed to the sender.
 */
export async function markPhoneRunningLate(
  db: AppDb,
  input: { phone: string; now: Date },
): Promise<RunningLateOutcome> {
  const [next] = await db
    .select({ bookingId: bookings.id, shopId: bookings.shopId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(trips.shopId, bookings.shopId),
        eq(people.shopId, bookings.shopId),
        eq(people.phone, input.phone),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        openSeatsWhere(input.now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!next) return { status: "closed" };
  return stamp(db, next.shopId, next.bookingId, input.now);
}
