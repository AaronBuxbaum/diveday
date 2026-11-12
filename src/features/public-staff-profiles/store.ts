import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { tripAssignments, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { crewAwayByTrip } from "@/features/crew-away";
import type { PublicStaffProfile } from "@/lib/public-staff-profile";
import { listPublicStaffProfiles } from "./profiles";

/** Profiles for assigned staff only; away notes and identifiers stop at this seam. */
export async function assignedPublicStaffProfiles(
  db: AppDb,
  shopId: string,
  departures: readonly { id: string; startsAt: Date; endsAt: Date }[],
  timeZone: string,
  instructorsOnly = false,
): Promise<PublicStaffProfile[]> {
  if (departures.length === 0) return [];
  const ids = departures.map((trip) => trip.id);
  const [assigned, away] = await Promise.all([
    db
      .select({ personId: tripAssignments.personId, tripId: tripAssignments.tripId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(
        and(
          eq(trips.shopId, shopId),
          liveTrip(),
          inArray(trips.id, ids),
          instructorsOnly ? eq(tripAssignments.tripRole, "instructor") : undefined,
        ),
      ),
    crewAwayByTrip(db, shopId, ids, timeZone),
  ]);
  const present = assigned.filter(
    (member) =>
      !(away.get(member.tripId) ?? []).some(
        (entry) => entry.personId === member.personId && !entry.acknowledged,
      ),
  );
  return listPublicStaffProfiles(db, shopId, [
    ...new Set(present.map((member) => member.personId)),
  ]);
}
