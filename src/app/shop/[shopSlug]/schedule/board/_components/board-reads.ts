import type { AppDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { crewAwayByTrip } from "@/db/crew-away";
import { listDiveSites } from "@/db/dive-sites";
import { tripCrewByTrip, type weekBoard } from "@/db/trips";
import type { AvailabilityBlock } from "@/lib/crew-requests";

type WeekRows = Awaited<ReturnType<typeof weekBoard>>;

/**
 * **Who is crewing the week the board is drawing.** Chained onto the week read, since it needs
 * that read's ids. One reading, so one list: this used to union the stream's cursor page with the
 * week's ids, and the two never agreed about which departures were on the board (#1923). A shop
 * that keeps no crew schedule prints no crew line, so it reads none.
 *
 * **Each member carries the days they said they are away that this departure meets on** (fourth
 * review, item 12; `crewAwayByTrip`), so the board can say "Marcus Webb away Sun, Oct 18" on the
 * sessions he is rostered to teach. Courses too: a span names its instructor in its own line, and
 * the instructor away is the case the review found.
 */
export async function weekCrewRead(
  db: AppDb,
  shop: { id: string; crewScheduleEnabled: boolean; timezone: string },
  weekRead: Promise<WeekRows>,
): Promise<Map<string, Array<{ id: string; name: string; away: AvailabilityBlock[] }>>> {
  if (!shop.crewScheduleEnabled) return new Map();
  const week = await weekRead;
  const tripIds = [
    ...Object.values(week.days).flatMap((entries) => entries.map((e) => e.tripId)),
    ...week.spans.map((span) => span.tripId),
  ];
  const [crew, away] = await Promise.all([
    tripCrewByTrip(db, shop.id, tripIds),
    crewAwayByTrip(db, shop.id, tripIds, shop.timezone),
  ]);
  return new Map(
    [...crew].map(([tripId, members]) => {
      const awayOnTrip = away.get(tripId) ?? [];
      return [
        tripId,
        members.map((member) => ({
          ...member,
          away: awayOnTrip.find((entry) => entry.personId === member.id)?.blocks ?? [],
        })),
      ];
    }),
  );
}

/**
 * A course the catalogue, or a dive site the library, sent us here to schedule. One list read,
 * and only on the rare navigation that names one — scoped to the session's own shop, so a
 * `?course=` or `?site=` from another tenant simply resolves to nothing.
 */
export async function requestedCourseAndSite(
  db: AppDb,
  shopId: string,
  { course, site }: { course: string | undefined; site: string | undefined },
) {
  const [courses, sites] = await Promise.all([
    course ? listActiveCourses(db, shopId) : [],
    site ? listDiveSites(db, shopId) : [],
  ]);
  return {
    requestedCourse: courses.find((row) => row.id === course) ?? null,
    requestedSite: sites.find((row) => row.id === site) ?? null,
  };
}
