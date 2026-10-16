import { and, desc, eq, gte, isNotNull, isNull, lt, max, ne, notInArray, or } from "drizzle-orm";
import { INVITE_SUGGESTIONS_SHOWN, inviteCooldownStart } from "@/lib/invite-suggestions";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { bookings, diveSites, people, personRoles, tripInvitations, trips } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * **Past divers worth inviting to a departure** (fifth-loop ideas, item 44;
 * H-130): people who dived this departure's site with the shop before.
 *
 * The sameness is the one similar departures already apply to a site
 * (`src/lib/similar-departures.ts`); a course is not suggested here, since a
 * diver who took the course has no reason to take it again (the course ladder
 * on the Courses page is that list, item 45). Left out: anyone holding a seat
 * on this departure, anyone already invited to it, anyone contacted with an
 * invite inside the cooldown (`INVITE_COOLDOWN_DAYS`), anyone erased, deleted
 * or merged, anyone with no email, and anyone who turned off courtesy email.
 * Rehearsal departures count for nothing.
 */
export type InviteSuggestion = { personId: string; fullName: string; lastDivedAt: Date };

export type InviteSuggestions = {
  siteName: string;
  shown: InviteSuggestion[];
  /** Everyone who qualifies, `shown` included. */
  total: number;
};

/** People contacted with an invite (any departure) since the cooldown began. */
export async function recentlyInvitedPeople(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<Set<string>> {
  const since = inviteCooldownStart(now);
  const rows = await db
    .selectDistinct({ personId: tripInvitations.personId })
    .from(tripInvitations)
    .where(
      and(
        eq(tripInvitations.shopId, shopId),
        isNotNull(tripInvitations.personId),
        or(gte(tripInvitations.invitedAt, since), gte(tripInvitations.emailedAt, since)),
      ),
    );
  return new Set(rows.flatMap((row) => (row.personId ? [row.personId] : [])));
}

/** Whether `personId` was contacted with an invite since the cooldown began. */
export async function invitedWithinCooldown(
  db: DbExecutor,
  shopId: string,
  personId: string,
  now: Date,
): Promise<boolean> {
  const since = inviteCooldownStart(now);
  const [row] = await db
    .select({ id: tripInvitations.id })
    .from(tripInvitations)
    .where(
      and(
        eq(tripInvitations.shopId, shopId),
        eq(tripInvitations.personId, personId),
        or(gte(tripInvitations.invitedAt, since), gte(tripInvitations.emailedAt, since)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Past divers of `diveSiteId` who could be asked, most recent first, with the
 * people `exclude` names left out. The shared core of the departure's
 * suggestions and the quiet day's rows.
 */
export async function pastDiversOfSite(
  db: DbExecutor,
  input: { shopId: string; diveSiteId: string; now: Date; exclude: Iterable<string> },
): Promise<InviteSuggestion[]> {
  const sailedBefore = new Date(input.now.getTime() - DEPARTURE_BUFFER_MS);
  const rows = await db
    .select({
      personId: people.id,
      fullName: people.fullName,
      lastDivedAt: max(trips.startsAt),
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(personRoles, and(eq(personRoles.personId, people.id), eq(personRoles.role, "diver")))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(trips.diveSiteId, input.diveSiteId),
        lt(trips.startsAt, sailedBefore),
        liveTrip(),
        notRehearsal(),
        notInArray(bookings.status, ["cancelled", "no_show"]),
        eq(people.shopId, input.shopId),
        livePerson(),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
        isNull(people.courtesyEmailOptOutAt),
        isNotNull(people.email),
        ne(people.email, ""),
      ),
    )
    .groupBy(people.id, people.fullName)
    .orderBy(desc(max(trips.startsAt)), people.fullName);
  const excluded = new Set(input.exclude);
  return rows.flatMap((row) =>
    row.lastDivedAt && !excluded.has(row.personId)
      ? [{ personId: row.personId, fullName: row.fullName, lastDivedAt: row.lastDivedAt }]
      : [],
  );
}

/** The suggestions for one departure, or `null` when it has no site or no one qualifies. */
export async function listInviteSuggestions(
  db: DbExecutor,
  input: { shopId: string; tripId: string; now: Date },
): Promise<InviteSuggestions | null> {
  const [trip] = await db
    .select({ diveSiteId: trips.diveSiteId, siteName: diveSites.name })
    .from(trips)
    .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip?.diveSiteId) return null;

  const [aboard, invitedHere, recent] = await queryAll(db, [
    () =>
      db
        .select({ personId: bookings.personId })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.tripId, input.tripId),
            ne(bookings.status, "cancelled"),
          ),
        ),
    () =>
      db
        .select({ personId: tripInvitations.personId })
        .from(tripInvitations)
        .where(
          and(eq(tripInvitations.shopId, input.shopId), eq(tripInvitations.tripId, input.tripId)),
        ),
    () => recentlyInvitedPeople(db, input.shopId, input.now),
  ]);
  const exclude = new Set<string>(recent);
  for (const row of [...aboard, ...invitedHere]) if (row.personId) exclude.add(row.personId);

  const everyone = await pastDiversOfSite(db, {
    shopId: input.shopId,
    diveSiteId: trip.diveSiteId,
    now: input.now,
    exclude,
  });
  if (everyone.length === 0) return null;
  return {
    siteName: trip.siteName,
    shown: everyone.slice(0, INVITE_SUGGESTIONS_SHOWN),
    total: everyone.length,
  };
}
