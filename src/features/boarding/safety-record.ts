import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { listStandingDepartureMarksByTrip } from "@/db/manifests";
import { bookings, trips } from "@/db/schema";
import { liveTrip, notRehearsal } from "@/db/trips";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import { listRollCallGaps } from "./roll-call-gaps";

/**
 * **A shop's safety record: four counts and the days they cover** (issue
 * #4255; glossary "Safety record"). Computed from the rows the crew already
 * write, shown on the shopfront only when the owner turns it on
 * (`shops.safety_record_enabled`, off for a new shop), and a statement of
 * nothing beyond the numbers.
 *
 * - **Departures run**: a departure that has come home (`hasReturned`), was
 *   not cancelled, was not a rehearsal and had at least one booked seat. A
 *   departure where every diver the crew counted stayed ashore is left out; one
 *   nobody counted stays in. A boat still out is not counted yet.
 * - **Boardings**: diver seats the crew counted aboard at the dock, each
 *   departure on its own (`listStandingDepartureMarksByTrip`, the reader every
 *   other "who was aboard" answer comes from). Snorkelers and riders are not
 *   counted. A diver on three departures is three.
 * - **Departures with every head count closed**: the detector finds no open gap
 *   (`listRollCallGaps`, in its `historical` mode, so a count that aged out of
 *   Today's queue is still read) and at least one diver was counted aboard.
 * - **Departures with every diver cleared to board**: at least one diver was counted
 *   aboard and every one of them was recorded `ready` when counted. A diver
 *   counted while blocked, or with no readiness recorded, keeps the
 *   departure out of this count. Readiness is recorded only from 2026-10-15
 *   (ADR 20261015-roll-call-records-readiness), so earlier departures never
 *   enter it.
 *
 * **No minimum and no floor.** One departure reads as one (the house rule in
 * ADR 20260729-verified-diver-reviews), and a shop with no departure run has no
 * record at all: `null`, never four zeros.
 */
export type SafetyRecord = {
  /** The shop-local day of the first departure counted. */
  startsOn: CalendarDate;
  /** The shop-local day of the last departure counted. */
  endsOn: CalendarDate;
  departures: number;
  boardings: number;
  rollCallsCompleted: number;
  readinessCompleted: number;
};

/** Departures read per statement; the readers take an id list, and one list should stay short. */
const CHUNK = 100;

export async function readSafetyRecord(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<SafetyRecord | null> {
  const candidates = await db
    .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        notRehearsal(),
        eq(trips.status, "scheduled"),
        lte(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt));
  const home = candidates.filter((trip) => hasReturned(trip.endsAt, now));
  if (home.length === 0) return null;

  const withDivers = new Set<string>();
  for (const ids of chunks(home.map((trip) => trip.id))) {
    const rows = await db
      .selectDistinct({ tripId: bookings.tripId })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, ids),
          eq(bookings.status, "booked"),
        ),
      );
    for (const row of rows) withDivers.add(row.tripId);
  }
  let boardings = 0;
  let rollCallsCompleted = 0;
  let readinessCompleted = 0;
  const ran: typeof home = [];
  const booked = home.filter((trip) => withDivers.has(trip.id));
  for (const chunk of chunks(booked)) {
    const ids = chunk.map((trip) => trip.id);
    const [marks, gaps, others] = await Promise.all([
      listStandingDepartureMarksByTrip(db, shopId, ids),
      listRollCallGaps(db, shopId, now, ids, { historical: true }),
      // Snorkelers and riders are counted aboard too; they are not divers boarded.
      db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shopId),
            inArray(bookings.tripId, ids),
            ne(bookings.participantType, "diver"),
          ),
        ),
    ]);
    const open = new Set(gaps.map((gap) => gap.tripId));
    const notDivers = new Set(others.map((row) => row.id));
    for (const trip of chunk) {
      const standing = [...(marks.get(trip.id) ?? [])]
        .filter(([bookingId]) => !notDivers.has(bookingId))
        .map(([, mark]) => mark);
      const aboard = standing.filter((mark) => mark.status === "boarded");
      // Everybody counted stayed ashore: the boat did not go out with divers.
      if (standing.length > 0 && aboard.length === 0) continue;
      ran.push(trip);
      boardings += aboard.length;
      if (aboard.length > 0 && !open.has(trip.id)) rollCallsCompleted += 1;
      if (aboard.length > 0 && aboard.every((mark) => mark.readinessStatus === "ready")) {
        readinessCompleted += 1;
      }
    }
  }
  if (ran.length === 0) return null;

  const first = ran[0];
  const last = ran[ran.length - 1];
  if (!first || !last) return null;
  return {
    startsOn: calendarDateInTimezone(first.startsAt, timeZone),
    endsOn: calendarDateInTimezone(last.startsAt, timeZone),
    departures: ran.length,
    boardings,
    rollCallsCompleted,
    readinessCompleted,
  };
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}
