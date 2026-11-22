import type { AppDb } from "@/db/client";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { isRefresherCourse } from "@/lib/re-entry";
import { seatsOnSale, spotsRemaining } from "@/lib/trips";
import { firstBoatAfterwards } from "./first-boat-pick";
import { listTripLenses } from "./trip-lenses";
import { plannedSitesByTrip } from "./trip-planned-sites";

/** How many upcoming public departures are weighed; the earliest qualifying one wins. */
const CANDIDATE_WINDOW = 40;

/** What the row prints about the departure it points at. */
export type FirstBoatPick = {
  tripId: string;
  title: string;
  startsAt: Date;
  seatsOpen: number;
};

/**
 * **A good first boat afterwards** (issue #4898), for a refresher session.
 *
 * A session is a refresher by its course's template (`isRefresherCourse`),
 * never by its name; anything else answers null. The candidates are the shop's
 * public, non-course departures with a seat left that start after the session
 * ends, and `firstBoatAfterwards` picks one. A suggestion only: it touches no
 * booking, admission or readiness.
 */
export async function readFirstBoatAfterwards(
  db: AppDb,
  input: {
    shopId: string;
    now: Date;
    session: {
      endsAt: Date;
      course: { sourceTemplateSlug: string | null; isActive: boolean } | null;
    };
  },
): Promise<FirstBoatPick | null> {
  const { session } = input;
  if (!session.course || !isRefresherCourse(session.course)) return null;
  if (session.endsAt.getTime() <= input.now.getTime()) return null;

  const [page, lenses] = await Promise.all([
    pagedUpcomingTripsWithCounts(db, input.shopId, {
      now: input.now,
      from: session.endsAt,
      limit: CANDIDATE_WINDOW,
      hasSpace: true,
      publicOnly: true,
      tripType: "fun_dive",
    }),
    listTripLenses(db, input.shopId),
  ]);
  const departures = page.trips.map(seatsOnSale).filter((trip) => !trip.conditionsHold);
  const sites = await plannedSitesByTrip(
    db,
    departures.map((trip) => trip.id),
  );
  const slugById = new Map(lenses.map((lens) => [lens.id, lens.slug]));

  const pick = firstBoatAfterwards({
    sessionEndsAt: session.endsAt,
    candidates: departures.map((trip) => ({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      seatsOpen: spotsRemaining(trip),
      courseId: trip.courseId,
      lensSlug: trip.lensId ? (slugById.get(trip.lensId) ?? null) : null,
      plannedSiteDifficulties: (sites.get(trip.id) ?? []).map((site) => site.difficultyLevel),
    })),
  });
  return pick
    ? { tripId: pick.tripId, title: pick.title, startsAt: pick.startsAt, seatsOpen: pick.seatsOpen }
    : null;
}
