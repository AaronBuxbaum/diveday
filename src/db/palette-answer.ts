import { and, asc, eq, gte, ne } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { PaletteAnswerFacts, PaletteNaming } from "@/lib/palette-answer";
import type { AppDb } from "./client";
import { listTripReadiness } from "./readiness";
import { bookings, trips } from "./schema";
import { tripCrewByTrip } from "./trips-crew";
import { liveTrip } from "./trips-live";
import { upcomingTripsWithCounts } from "./trips-queries";

/**
 * The facts behind the palette's answer card (ADR 20260906-before-you-ask,
 * decision 3), read through the readers the home and the roster already use —
 * `listTripReadiness` for who is blocked, `upcomingTripsWithCounts` for the
 * board — so the card can never disagree with the page it opens. Reads only,
 * and only within the caller's own shop.
 */
export async function paletteAnswerFacts(
  db: AppDb,
  input: { shopId: string; naming: NonNullable<PaletteNaming>; timeZone: string; now?: Date },
): Promise<PaletteAnswerFacts | null> {
  const now = input.now ?? nowDate();
  const { naming } = input;
  switch (naming.kind) {
    case "diver": {
      const [next] = await db
        .select({
          bookingId: bookings.id,
          tripId: trips.id,
          tripTitle: trips.title,
          startsAt: trips.startsAt,
        })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.personId, naming.personId),
            ne(bookings.status, "cancelled"),
            liveTrip(),
            eq(trips.status, "scheduled"),
            gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
          ),
        )
        .orderBy(asc(trips.startsAt))
        .limit(1);
      if (!next) {
        return { kind: "diver", personId: naming.personId, fullName: naming.fullName, next: null };
      }
      const row = (await listTripReadiness(db, input.shopId, next.tripId, now)).find(
        (candidate) => candidate.booking.id === next.bookingId,
      );
      if (!row) {
        return { kind: "diver", personId: naming.personId, fullName: naming.fullName, next: null };
      }
      return {
        kind: "diver",
        personId: naming.personId,
        fullName: naming.fullName,
        next: {
          bookingId: next.bookingId,
          tripId: next.tripId,
          tripTitle: next.tripTitle,
          startsAt: next.startsAt,
          status: row.readiness.status,
          blockers: row.readiness.blockers,
        },
      };
    }
    case "day": {
      const onDay = (await upcomingTripsWithCounts(db, input.shopId, now)).filter(
        (trip) => calendarDateInTimezone(trip.startsAt, input.timeZone) === naming.date,
      );
      const crewByTrip = await tripCrewByTrip(
        db,
        input.shopId,
        onDay.map((trip) => trip.id),
      );
      const crew = [
        ...new Set([...crewByTrip.values()].flat().map((member) => member.name)),
      ].sort();
      return {
        kind: "day",
        date: naming.date,
        departures: onDay.length,
        divers: onDay.reduce((sum, trip) => sum + trip.booked, 0),
        crew,
      };
    }
    case "departure": {
      const [trip] = await db
        .select({ title: trips.title, startsAt: trips.startsAt, capacity: trips.capacity })
        .from(trips)
        .where(and(eq(trips.id, naming.tripId), eq(trips.shopId, input.shopId), liveTrip()))
        .limit(1);
      if (!trip) return null;
      const rows = await listTripReadiness(db, input.shopId, naming.tripId, now);
      return {
        kind: "departure",
        tripId: naming.tripId,
        title: trip.title,
        startsAt: trip.startsAt,
        booked: rows.length,
        capacity: trip.capacity,
        blocked: rows.filter((row) => row.readiness.status === "blocked").length,
      };
    }
  }
}
