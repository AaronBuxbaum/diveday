import { and, eq, inArray } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import {
  countBothClaims,
  groupCrewAssignments,
  type InWaterCrewCount,
  type LapsedRung,
  lapsedRungs,
  lastDayOfDeparture,
  rungLostToLapse,
  rungLostToUnverified,
  unverifiedRungs,
} from "@/lib/crew-roles";
import type { AppDb } from "./client";
import { people, personRoles, shops, tripAssignments, trips } from "./schema";
import { ratingCredentialsByPerson } from "./staff-credentials";
import { liveTrip } from "./trips-live";

/**
 * How many instructors and certified assistants (divemasters) each course
 * trip's crew has, counted by the one definition every ratio gate shares
 * (`countInWaterCrew`, src/lib/crew-roles.ts).
 *
 * Its own module because the shift roster's crew-gap summary composes *this*
 * reader — the one Today's own `instructor_missing` detection runs on — rather than
 * re-deriving crew counts of its own (ADR 20260806-staffing-is-the-shift-roster),
 * and so the roster and crew requests need not import Today (#2357).
 *
 * **This is the supervision claim, so it reads the credentials** (issue
 * #1853). A rostered professional whose every recorded rating has lapsed by
 * the departure's last shop-local day counts for the rung they are still
 * current on, or for nothing (`lapsedRungs`, src/lib/crew-roles.ts). `lapsed`
 * names who a lapse took down a rung, so every surface that shows a gap this
 * count opened can say why rather than showing one more shortfall. The money
 * and roster paths do not come through here: `tripCourseCrewCounts`
 * (src/db/bookings.ts) is the roster's claim, on purpose (H-59).
 */
export async function courseCrewCountsByTrip(
  db: AppDb,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, SupervisionCrewCount>> {
  const counts = new Map<string, SupervisionCrewCount>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({
      tripId: tripAssignments.tripId,
      personId: tripAssignments.personId,
      fullName: people.fullName,
      tripRole: tripAssignments.tripRole,
      role: personRoles.role,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      timeZone: shops.timezone,
    })
    .from(tripAssignments)
    // `trip_assignments` carries no shop_id of its own; proving the trip
    // itself belongs to shopId (not just the assigned person) is what closes
    // the cross-tenant read this table's shape allows (CR-007 review
    // finding — mirrors getTripCrewIds's already-fixed join, src/db/trips.ts).
    // Every current caller already pre-filters tripIds to this shop, but the
    // helper itself shouldn't depend on that discipline.
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    // The zone the departure's day is read in (issue #1853).
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    // A `left join`, and no role filter: the per-trip role lives on the
    // assignment row, so a rostered captain has to reach the rule that decides
    // they count for nothing rather than being filtered out of the query.
    .leftJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(people.shopId, shopId),
        inArray(tripAssignments.tripId, tripIds),
      ),
    );
  const rowsByTrip = new Map<string, typeof rows>();
  const nameByPerson = new Map<string, string>();
  for (const row of rows) {
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
    nameByPerson.set(row.personId, row.fullName);
  }
  const credentials = await ratingCredentialsByPerson(db, shopId, [...nameByPerson.keys()]);
  for (const tripId of tripIds) {
    const tripRows = rowsByTrip.get(tripId) ?? [];
    const [first] = tripRows;
    // Asked of the departure's own last day in the shop's zone, so a rating
    // that lapses between the booking and the dive is lapsed for the dive.
    const divesOn = first ? lastDayOfDeparture(first.endsAt, first.timeZone) : null;
    const firstDay = first ? calendarDateInTimezone(first.startsAt, first.timeZone) : null;
    const members = groupCrewAssignments(tripRows).map((member) => ({
      ...member,
      lapsedRungs:
        divesOn === null
          ? []
          : lapsedRungs(credentials.get(member.personId) ?? [], divesOn, firstDay ?? divesOn),
      unverifiedRungs:
        firstDay === null ? [] : unverifiedRungs(credentials.get(member.personId) ?? [], firstDay),
    }));
    const { supervision, roster } = countBothClaims(members);
    const lapsed: SupervisionCrewCount["lapsed"] = [];
    const unverified: NonNullable<SupervisionCrewCount["unverified"]> = [];
    for (const member of members) {
      const lost = rungLostToLapse(member);
      if (lost !== null)
        lapsed.push({
          personId: member.personId,
          fullName: nameByPerson.get(member.personId) ?? "",
          lost,
        });
      const unverifiedLost = rungLostToUnverified(member);
      if (unverifiedLost !== null)
        unverified.push({
          personId: member.personId,
          fullName: nameByPerson.get(member.personId) ?? "",
          lost: unverifiedLost,
        });
    }
    // Names in a stable order, so the sentence that lists them does not
    // reshuffle between loads.
    lapsed.sort(byNameThenId);
    unverified.sort(byNameThenId);
    counts.set(tripId, {
      ...supervision,
      roster,
      lapsed,
      ...(unverified.length ? { unverified } : {}),
    });
  }
  return counts;
}

function byNameThenId(
  a: { fullName: string; personId: string },
  b: { fullName: string; personId: string },
): number {
  if (a.fullName !== b.fullName) return a.fullName < b.fullName ? -1 : 1;
  return a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0;
}

/**
 * The supervision claim for one departure: the in-water counts with every
 * rostered professional's recorded ratings read, the roster's claim beside it
 * (the same count with none read), and who a lapse took down a rung and which
 * rung (issue #1853). A surface says a gap is a lapse's only when the two
 * claims disagree about that gap.
 */
export type SupervisionCrewCount = InWaterCrewCount & {
  roster: InWaterCrewCount;
  lapsed: { personId: string; fullName: string; lost: LapsedRung }[];
  unverified?: { personId: string; fullName: string; lost: LapsedRung }[];
};

/** A departure nobody is rostered on: nobody in the water, nobody lapsed. */
export const NO_SUPERVISION: SupervisionCrewCount = {
  instructorCount: 0,
  assistantCount: 0,
  roster: { instructorCount: 0, assistantCount: 0 },
  lapsed: [],
};
