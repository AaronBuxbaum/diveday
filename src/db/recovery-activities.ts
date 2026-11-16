import { and, asc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { nowDate } from "../lib/clock";
import { isUuid } from "../lib/uuid";
import type { DbExecutor } from "./client";
import {
  people,
  recoveryActivities,
  recoveryActivityOffers,
  recoveryActivityParticipants,
} from "./schema";
export async function readRecoveryActivities(db: DbExecutor, shopId: string, blowoutId: string) {
  const activities = await db
    .select()
    .from(recoveryActivities)
    .where(
      and(
        eq(recoveryActivities.shopId, shopId),
        eq(recoveryActivities.blowoutId, blowoutId),
        isNull(recoveryActivities.deletedAt),
      ),
    )
    .orderBy(
      asc(recoveryActivities.startsAt),
      asc(recoveryActivities.title),
      asc(recoveryActivities.id),
    );
  const result = [];
  for (const activity of activities) {
    const offers = await db
      .select()
      .from(recoveryActivityOffers)
      .where(
        and(
          eq(recoveryActivityOffers.shopId, shopId),
          eq(recoveryActivityOffers.activityId, activity.id),
        ),
      );
    const participants = await db
      .select({
        participant: recoveryActivityParticipants,
        available: sql<boolean>`${people.deletedAt} is null and ${people.anonymizedAt} is null`,
      })
      .from(recoveryActivityParticipants)
      .innerJoin(
        people,
        and(eq(people.id, recoveryActivityParticipants.personId), eq(people.shopId, shopId)),
      )
      .where(
        and(
          eq(recoveryActivityParticipants.shopId, shopId),
          eq(recoveryActivityParticipants.activityId, activity.id),
        ),
      );
    const [coordinator] = await db
      .select({ name: people.fullName })
      .from(people)
      .where(
        and(
          eq(people.shopId, shopId),
          eq(people.id, activity.coordinatorPersonId),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      );
    const conflicts = await db
      .select({ id: recoveryActivities.id, title: recoveryActivities.title })
      .from(recoveryActivities)
      .where(
        and(
          eq(recoveryActivities.shopId, shopId),
          ne(recoveryActivities.id, activity.id),
          eq(recoveryActivities.status, "scheduled"),
          isNull(recoveryActivities.deletedAt),
          eq(recoveryActivities.coordinatorPersonId, activity.coordinatorPersonId),
          lt(recoveryActivities.startsAt, activity.endsAt),
          gt(recoveryActivities.endsAt, activity.startsAt),
        ),
      );
    result.push({
      ...activity,
      conflicts,
      coordinatorName: coordinator?.name ?? null,
      offers,
      participants,
      confirmed:
        activity.status === "scheduled"
          ? participants.filter((row) => row.participant.status === "confirmed").length
          : 0,
    });
  }
  return result;
}
/** Public context only: never returns people, coordinator identity, offers, or roster. */
export async function publicRecoveryActivity(db: DbExecutor, shopId: string, activityId: string) {
  if (!isUuid(activityId)) return null;
  const [activity] = await db
    .select({
      id: recoveryActivities.id,
      title: recoveryActivities.title,
      startsAt: recoveryActivities.startsAt,
      endsAt: recoveryActivities.endsAt,
      location: recoveryActivities.location,
    })
    .from(recoveryActivities)
    .where(
      and(
        eq(recoveryActivities.shopId, shopId),
        eq(recoveryActivities.id, activityId),
        eq(recoveryActivities.status, "scheduled"),
        isNull(recoveryActivities.deletedAt),
        gt(recoveryActivities.startsAt, nowDate()),
        sql`exists (select 1 from ${recoveryActivityOffers} where ${recoveryActivityOffers.shopId} = ${shopId} and ${recoveryActivityOffers.activityId} = ${recoveryActivities.id})`,
      ),
    );
  return activity ?? null;
}
