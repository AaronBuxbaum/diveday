import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { seatSailed } from "@/lib/closeout";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { similarDepartures } from "@/lib/similar-departures";
import type { AppDb } from "./client";
import { departureOpenToDiver } from "./interest-offers";
import { bookings, people, trips } from "./schema";
import { tripPrimarySiteId } from "./trip-primary-site";
import { pagedUpcomingTripsWithCounts } from "./trips";
import { liveTrip } from "./trips-live";

/**
 * How long after the boat is home the Divers tab keeps saying what each diver
 * could do next. The diver dripping on the dock is the sale; a list a week old
 * is a mailing list, which is somebody else's job.
 */
export const REBOOK_WINDOW_MS = 24 * HOUR_MS;

/** How far ahead an open day is worth naming at the dock: the rest of their stay, roughly. */
const REBOOK_HORIZON_MS = 7 * DAY_MS;

/** Candidates asked together in one diver's walk, as the no-show salvage does. */
const REBOOK_STEP = 4;

/** What the sailed list says beside one diver, as codes. */
export type SailedRebooking =
  /** They already hold a later seat: "Booked Sat 11:30 AM". */
  | { kind: "booked"; tripId: string; startsAt: Date }
  /** Nothing else booked, and a day they could take: "Thu 7:00 AM has 3 seats". */
  | { kind: "open"; tripId: string; title: string; startsAt: Date; seatsLeft: number };

/**
 * The finished departure's roll call, as its record already reads it: each
 * seat's standing dock result (`listDepartureRollCallByTrip`) and standing
 * after-dive result (`listAfterDiveRollCallByTrip`), keyed by booking id.
 */
export type SailedRollCall = {
  dock: ReadonlyMap<string, "boarded" | "not_boarded">;
  afterDive: ReadonlyMap<string, "boarded" | "missing_after_dive">;
};

/**
 * Whether a seat gets a rebooking line: the diver sailed (`seatSailed`) and,
 * when the crew counted after a dive, was counted back aboard. A standing
 * miss is a diver nobody has accounted for yet, and the one row that means
 * that never wears a sales line.
 */
function cameBackAboard(bookingId: string, rollCall: SailedRollCall): boolean {
  const afterDive = rollCall.afterDive.get(bookingId);
  const sailed = seatSailed({
    noShow: false,
    dockResult: rollCall.dock.get(bookingId) ?? null,
    afterDiveResultStands: afterDive !== undefined,
  });
  return sailed && (afterDive === undefined || afterDive === "boarded");
}

/** One seat's line, with the diver it names (the offer is sent to them). */
export type SailedRebookingRow = { personId: string; personName: string; next: SailedRebooking };

/**
 * **When the boat is home, the sailed list becomes the rebooking list**
 * (fifth-loop ideas, item 4).
 *
 * For each seat still standing on the departure (not cancelled, not a no-show,
 * whose own salvage panel already speaks) whose diver sailed and came back
 * aboard (`cameBackAboard`), keyed by booking id:
 *
 * - their soonest later seat at this shop, when they hold one, so the desk
 *   stays quiet about a diver already coming back;
 * - otherwise one day they could book from a link right now, the same promise
 *   the no-show salvage makes (`departureOpenToDiver`): a similar departure
 *   first (`similarDepartures`, same course, then same site), then the soonest
 *   public day with room in the next week;
 * - otherwise nothing, and the row says nothing.
 *
 * Only for `REBOOK_WINDOW_MS` after the boat is home: the earlier of the
 * scheduled end and the crew's standing Home tap, so a boat that tied up early
 * sells while the divers are still on the dock. An empty map before that, after
 * the window, and for a departure that is gone.
 */
export async function sailedRebooking(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    now: Date;
    rollCall: SailedRollCall;
    /** When the crew said Home, while that word stands (`boatStageOf`); null otherwise. */
    homeAt: Date | null;
  },
): Promise<Map<string, SailedRebookingRow>> {
  const { shopId, tripId, now, rollCall, homeAt } = input;
  const result = new Map<string, SailedRebookingRow>();
  const [trip] = await db
    .select({
      id: trips.id,
      endsAt: trips.endsAt,
      courseId: trips.courseId,
      diveSiteId: tripPrimarySiteId,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return result;
  const home = Math.min(trip.endsAt.getTime(), homeAt?.getTime() ?? Number.POSITIVE_INFINITY);
  const sinceHome = now.getTime() - home;
  if (sinceHome < 0 || sinceHome > REBOOK_WINDOW_MS) return result;

  const heldSeats = await db
    .select({ bookingId: bookings.id, personId: bookings.personId, personName: people.fullName })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
      ),
    );
  const seats = heldSeats.filter((seat) => cameBackAboard(seat.bookingId, rollCall));
  if (seats.length === 0) return result;
  const personIds = [...new Set(seats.map((seat) => seat.personId))];

  const [later, board] = await Promise.all([
    db
      .selectDistinctOn([bookings.personId], {
        personId: bookings.personId,
        tripId: trips.id,
        startsAt: trips.startsAt,
      })
      .from(bookings)
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.personId, personIds),
          inArray(bookings.status, [...SEAT_HELD_STATUSES]),
          ne(trips.id, tripId),
          ne(trips.status, "cancelled"),
          gt(trips.startsAt, now),
          liveTrip(),
        ),
      )
      .orderBy(bookings.personId, asc(trips.startsAt)),
    pagedUpcomingTripsWithCounts(db, shopId, { now, limit: 50, hasSpace: true, publicOnly: true }),
  ]);
  const laterByPerson = new Map(later.map((row) => [row.personId, row]));

  // The board's own one-hour buffer reaches back past `now`; a day already
  // under way is not one to offer.
  const horizon = now.getTime() + REBOOK_HORIZON_MS;
  const ahead = board.trips.filter(
    (candidate) =>
      candidate.id !== tripId &&
      candidate.startsAt > now &&
      candidate.startsAt.getTime() <= horizon,
  );
  const similar = similarDepartures({
    full: { tripId, courseId: trip.courseId, diveSiteId: trip.diveSiteId },
    candidates: ahead.map((candidate) => ({
      ...candidate,
      diveSiteId: candidate.diveSite?.id ?? null,
    })),
    limit: ahead.length,
  });
  const similarIds = new Set(similar.map((departure) => departure.tripId));
  const byId = new Map(ahead.map((candidate) => [candidate.id, candidate]));
  const ranked = [
    ...similar.flatMap((departure) => byId.get(departure.tripId) ?? []),
    ...ahead.filter((candidate) => !similarIds.has(candidate.id)),
  ];

  const openDayFor = new Map<string, SailedRebooking | null>();
  await Promise.all(
    personIds
      .filter((personId) => !laterByPerson.has(personId))
      .map(async (personId) => {
        for (let start = 0; start < ranked.length; start += REBOOK_STEP) {
          const step = ranked.slice(start, start + REBOOK_STEP);
          const open = await Promise.all(
            step.map((candidate) =>
              departureOpenToDiver(db, { shopId, tripId: candidate.id, personId, now }),
            ),
          );
          const index = open.indexOf(true);
          const found = index >= 0 ? step[index] : undefined;
          if (found) {
            openDayFor.set(personId, {
              kind: "open",
              tripId: found.id,
              title: found.title,
              startsAt: found.startsAt,
              seatsLeft: Math.max(0, found.sellableCapacity - found.booked),
            });
            return;
          }
        }
        openDayFor.set(personId, null);
      }),
  );

  for (const seat of seats) {
    const booked = laterByPerson.get(seat.personId);
    const next: SailedRebooking | null | undefined = booked
      ? { kind: "booked", tripId: booked.tripId, startsAt: booked.startsAt }
      : openDayFor.get(seat.personId);
    if (next) {
      result.set(seat.bookingId, { personId: seat.personId, personName: seat.personName, next });
    }
  }
  return result;
}
