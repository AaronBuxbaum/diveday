import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { courses, people, tripAssignments, trips, userAccounts } from "../../db/schema";
import { livePublicTripForShop, notRehearsal } from "../../db/trips";
import { crewAwayByTrip } from "../../features/crew-away";
import { writeOwnStaffProfile } from "../../features/public-staff-profiles";
import type { FactContext } from "./index";

/** A private fixture's fictional instructor explicitly authors their own introduction. */
export async function introduceAssignedInstructor({ db, shop, now }: FactContext) {
  const candidates = await db
    .select({
      personId: people.id,
      tripId: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      courseSlug: courses.slug,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shop.id)))
    .innerJoin(people, and(eq(people.id, tripAssignments.personId), eq(people.shopId, shop.id)))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        livePublicTripForShop(shop.id),
        notRehearsal(),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, now),
        eq(courses.isActive, true),
        eq(tripAssignments.tripRole, "instructor"),
        isNull(people.deletedAt),
        eq(userAccounts.status, "active"),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(20);
  const away = await crewAwayByTrip(
    db,
    shop.id,
    candidates.map((row) => row.tripId),
    shop.timezone,
  );
  const instructor = candidates.find(
    (row) =>
      !(away.get(row.tripId) ?? []).some(
        (member) => member.personId === row.personId && !member.acknowledged,
      ),
  );
  if (!instructor)
    throw new Error("public staff profile fixture requires an available assigned instructor");
  const profile = {
    firstName: "Ocean Guide",
    role: "Instructor",
    sinceYear: 2014,
    languages: "English, Español",
    description: "I love the early reef.",
    photoUrls: [],
  };
  if (
    !(await writeOwnStaffProfile(db, {
      shopId: shop.id,
      personId: instructor.personId,
      actorPersonId: instructor.personId,
      enabled: true,
      profile,
    }))
  )
    throw new Error("public staff profile fixture could not publish its own introduction");
  return {
    tripId: instructor.tripId,
    courseSlug: instructor.courseSlug,
    firstName: profile.firstName,
    description: profile.description,
  };
}
