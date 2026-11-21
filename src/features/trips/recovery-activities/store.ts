import { createHash } from "node:crypto";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { loadActiveStaffRoles } from "../../../db/authz";
import type { AppDb, DbExecutor } from "../../../db/client";
import { boundLockWaits, isLockWaitRefusal } from "../../../db/lock-bounds";
import { isUniqueConstraintViolation } from "../../../db/query-helpers";
import {
  bookings,
  people,
  recoveryActivities,
  recoveryActivityEvents,
  recoveryActivityOffers,
  recoveryActivityParticipants,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
} from "../../../db/schema";
import { isStaff } from "../../../lib/authz";
import { nowDate } from "../../../lib/clock";
import { validRecoveryActivity } from "../../../lib/recovery-activities";
import { isUuid } from "../../../lib/uuid";

type Context = { shopId: string; tripId: string; actorPersonId: string; attemptId: string };
type Refusal =
  | "invalid"
  | "not_authorized"
  | "not_found"
  | "stale"
  | "unavailable"
  | "full"
  | "busy"
  | "already_prepared";
export type ActivityResult = { ok: true; revision: number } | { ok: false; reason: Refusal };
const fail = (reason: Refusal): ActivityResult => ({ ok: false, reason });
function validContext(input: Context) {
  return [input.shopId, input.tripId, input.actorPersonId, input.attemptId].every(isUuid);
}
function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value, Object.keys(value as object).sort()))
    .digest("hex");
}
async function authorized(tx: DbExecutor, input: Context) {
  const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
  return roles !== null && isStaff(roles);
}
async function liveStaff(tx: DbExecutor, shopId: string, personId: string) {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  return roles !== null && isStaff(roles);
}
/** Activity first; NOWAIT people locks prevent inversion with merge/erasure's person-first order. */
async function lockPeople(tx: DbExecutor, shopId: string, ids: string[]) {
  const locked = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        sql`${people.id} in (${sql.join(
          [...new Set(ids)].sort().map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .orderBy(asc(people.id))
    .for("share", { noWait: true });
  return locked.length === new Set(ids).size;
}
async function source(tx: DbExecutor, input: Context) {
  const [row] = await tx
    .select({ id: tripBlowouts.id })
    .from(tripBlowouts)
    .innerJoin(trips, and(eq(trips.id, tripBlowouts.tripId), eq(trips.shopId, input.shopId)))
    .where(
      and(
        eq(tripBlowouts.shopId, input.shopId),
        eq(trips.id, input.tripId),
        eq(trips.status, "cancelled"),
        isNull(trips.deletedAt),
      ),
    );
  return row;
}
async function replay(
  tx: DbExecutor,
  input: Context,
  requestHash: string,
): Promise<ActivityResult | null> {
  const [prior] = await tx
    .select()
    .from(recoveryActivityEvents)
    .where(
      and(
        eq(recoveryActivityEvents.shopId, input.shopId),
        eq(recoveryActivityEvents.id, input.attemptId),
      ),
    );
  return prior
    ? prior.requestHash === requestHash && prior.actorPersonId === input.actorPersonId
      ? { ok: true, revision: prior.resultRevision }
      : fail("invalid")
    : null;
}
async function activeCount(tx: DbExecutor, shopId: string, activityId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(recoveryActivityParticipants)
    .where(
      and(
        eq(recoveryActivityParticipants.shopId, shopId),
        eq(recoveryActivityParticipants.activityId, activityId),
        eq(recoveryActivityParticipants.status, "confirmed"),
      ),
    );
  return row.n;
}
function catchBusy(error: unknown): ActivityResult {
  if (isLockWaitRefusal(error)) return fail("busy");
  if (isUniqueConstraintViolation(error)) return fail("invalid");
  throw error;
}

export async function createRecoveryActivity(
  db: AppDb,
  input: Context & {
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string;
    capacity: number;
    coordinatorPersonId: string;
    arrangementsConfirmed: boolean;
  },
): Promise<ActivityResult> {
  if (
    !validContext(input) ||
    !isUuid(input.coordinatorPersonId) ||
    input.arrangementsConfirmed !== true ||
    !validRecoveryActivity(input, new Date(0))
  )
    return fail("invalid");
  const facts = {
    title: input.title.trim(),
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    location: input.location.trim(),
    capacity: input.capacity,
    coordinatorPersonId: input.coordinatorPersonId,
  };
  const requestHash = fingerprint({ ...input, ...facts });
  return db
    .transaction(async (tx): Promise<ActivityResult> => {
      await boundLockWaits(tx);
      if (!(await authorized(tx, input))) return fail("not_authorized");
      // Serialize creation retries without locking trips or any money/boarding aggregate.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.shopId}:classroom:${input.attemptId}`}, 0))`,
      );
      if (!(await authorized(tx, input))) return fail("not_authorized");
      const prior = await replay(tx, input, requestHash);
      if (prior) return prior;
      const blowout = await source(tx, input);
      if (!blowout) return fail("not_found");
      if (
        !validRecoveryActivity(input, nowDate()) ||
        !(await lockPeople(tx, input.shopId, [input.actorPersonId, input.coordinatorPersonId])) ||
        !(await liveStaff(tx, input.shopId, input.coordinatorPersonId))
      )
        return fail("unavailable");
      await tx.insert(recoveryActivities).values({
        id: input.attemptId,
        shopId: input.shopId,
        blowoutId: blowout.id,
        ...facts,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdByPersonId: input.actorPersonId,
        arrangementsConfirmedByPersonId: input.actorPersonId,
      });
      await tx.insert(recoveryActivityEvents).values({
        id: input.attemptId,
        shopId: input.shopId,
        activityId: input.attemptId,
        actorPersonId: input.actorPersonId,
        code: "created",
        transition: { expectedRevision: 0, capacity: input.capacity },
        requestHash,
        resultRevision: 0,
      });
      return { ok: true, revision: 0 };
    })
    .catch(catchBusy);
}

type TransitionInput = Context & { activityId: string; expectedRevision: number } & (
    | { kind: "offer"; blowoutDiverId: string }
    | { kind: "confirm" | "cancel_place"; blowoutDiverId: string; participantRevision: number }
    | { kind: "cancel_activity" }
    | { kind: "capacity"; capacity: number }
  );
export async function transitionRecoveryActivity(
  db: AppDb,
  input: TransitionInput,
): Promise<ActivityResult> {
  if (
    !["offer", "confirm", "cancel_place", "capacity", "cancel_activity"].includes(input.kind) ||
    !validContext(input) ||
    !isUuid(input.activityId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    ("blowoutDiverId" in input && !isUuid(input.blowoutDiverId)) ||
    ("participantRevision" in input &&
      (!Number.isSafeInteger(input.participantRevision) || input.participantRevision < 0)) ||
    (input.kind === "capacity" &&
      (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 500))
  )
    return fail("invalid");
  const requestHash = fingerprint(input);
  return db
    .transaction(async (tx): Promise<ActivityResult> => {
      await boundLockWaits(tx);
      if (!(await authorized(tx, input))) return fail("not_authorized");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.shopId}:classroom:${input.attemptId}`}, 0))`,
      );
      const [activity] = await tx
        .select()
        .from(recoveryActivities)
        .where(
          and(
            eq(recoveryActivities.shopId, input.shopId),
            eq(recoveryActivities.id, input.activityId),
          ),
        )
        .for("update");
      if (!activity) return fail("not_found");
      if (!(await authorized(tx, input))) return fail("not_authorized");
      // A successful attempt remains evidence even if the original departure was reinstated.
      const prior = await replay(tx, input, requestHash);
      if (prior) return prior;
      const blowout = await source(tx, input);
      if (!blowout || blowout.id !== activity.blowoutId) return fail("not_found");
      if (activity.revision !== input.expectedRevision) return fail("stale");
      if (activity.status !== "scheduled" || activity.deletedAt) return fail("unavailable");
      if (!(await lockPeople(tx, input.shopId, [input.actorPersonId]))) return fail("unavailable");
      if (
        (input.kind === "offer" || input.kind === "confirm") &&
        !(await lockPeople(tx, input.shopId, [activity.coordinatorPersonId]))
      )
        return fail("unavailable");
      let participantId: string | null = null;
      let resultRevision = activity.revision;
      if (input.kind === "offer" || input.kind === "confirm" || input.kind === "cancel_place") {
        const [diver] = await tx
          .select({ id: tripBlowoutDivers.id, personId: tripBlowoutDivers.personId })
          .from(tripBlowoutDivers)
          .innerJoin(
            bookings,
            and(
              eq(bookings.id, tripBlowoutDivers.bookingId),
              eq(bookings.shopId, input.shopId),
              input.kind === "cancel_place"
                ? undefined
                : eq(bookings.personId, tripBlowoutDivers.personId),
              input.kind === "cancel_place" ? undefined : isNull(bookings.identityUnconfirmedAt),
            ),
          )
          .where(
            and(
              eq(tripBlowoutDivers.shopId, input.shopId),
              eq(tripBlowoutDivers.id, input.blowoutDiverId),
              eq(tripBlowoutDivers.blowoutId, blowout.id),
            ),
          )
          .for("share", { of: bookings, noWait: true });
        // An erased identity still holds its promised place until staff explicitly cancel it.
        // diveday:allow-deleted-people: cancellation releases an existing allocation, never identifies or confirms someone.
        const subjectAvailable =
          diver &&
          (input.kind === "cancel_place"
            ? (
                await tx
                  .select({ id: people.id })
                  .from(people)
                  // diveday:allow-deleted-people: explicit cancellation releases an existing promised place without re-identifying its erased subject.
                  .where(and(eq(people.shopId, input.shopId), eq(people.id, diver.personId)))
                  .for("share", { noWait: true })
              ).length === 1
            : await lockPeople(tx, input.shopId, [diver.personId]));
        if (!diver || !subjectAvailable) return fail("unavailable");
        if (input.kind === "offer") {
          if (
            activity.startsAt <= nowDate() ||
            !(await liveStaff(tx, input.shopId, activity.coordinatorPersonId))
          )
            return fail("unavailable");
          const [existing] = await tx
            .select({ id: recoveryActivityOffers.id })
            .from(recoveryActivityOffers)
            .where(
              and(
                eq(recoveryActivityOffers.shopId, input.shopId),
                eq(recoveryActivityOffers.activityId, activity.id),
                eq(recoveryActivityOffers.blowoutDiverId, diver.id),
              ),
            );
          if (existing) return fail("already_prepared");
          await tx.insert(recoveryActivityOffers).values({
            id: input.attemptId,
            shopId: input.shopId,
            activityId: activity.id,
            blowoutDiverId: diver.id,
            actorPersonId: input.actorPersonId,
            snapshot: {
              title: activity.title,
              startsAt: activity.startsAt.toISOString(),
              endsAt: activity.endsAt.toISOString(),
              location: activity.location,
              revision: activity.revision,
            },
          });
        } else {
          const [participant] = await tx
            .select()
            .from(recoveryActivityParticipants)
            .where(
              and(
                eq(recoveryActivityParticipants.shopId, input.shopId),
                eq(recoveryActivityParticipants.activityId, activity.id),
                eq(recoveryActivityParticipants.blowoutDiverId, diver.id),
              ),
            );
          if ((participant?.revision ?? 0) !== input.participantRevision) return fail("stale");
          if (input.kind === "cancel_place") {
            if (participant?.status !== "confirmed") return fail("unavailable");
            await tx
              .update(recoveryActivityParticipants)
              .set({ status: "cancelled", revision: participant.revision + 1 })
              .where(eq(recoveryActivityParticipants.id, participant.id));
            participantId = participant.id;
          } else {
            if (
              activity.startsAt <= nowDate() ||
              !activity.arrangementsConfirmedAt ||
              !(await liveStaff(tx, input.shopId, activity.coordinatorPersonId))
            )
              return fail("unavailable");
            const [already] = await tx
              .select({ id: recoveryActivityParticipants.id })
              .from(recoveryActivityParticipants)
              .where(
                and(
                  eq(recoveryActivityParticipants.shopId, input.shopId),
                  eq(recoveryActivityParticipants.activityId, activity.id),
                  eq(recoveryActivityParticipants.personId, diver.personId),
                  eq(recoveryActivityParticipants.status, "confirmed"),
                ),
              );
            if (already) return fail("unavailable");
            if ((await activeCount(tx, input.shopId, activity.id)) >= activity.capacity)
              return fail("full");
            if (participant) {
              await tx
                .update(recoveryActivityParticipants)
                .set({
                  status: "confirmed",
                  revision: participant.revision + 1,
                  confirmedAt: nowDate(),
                  confirmedByPersonId: input.actorPersonId,
                })
                .where(eq(recoveryActivityParticipants.id, participant.id));
              participantId = participant.id;
            } else {
              const [inserted] = await tx
                .insert(recoveryActivityParticipants)
                .values({
                  shopId: input.shopId,
                  activityId: activity.id,
                  personId: diver.personId,
                  blowoutDiverId: diver.id,
                  status: "confirmed",
                  confirmedByPersonId: input.actorPersonId,
                })
                .returning({ id: recoveryActivityParticipants.id });
              participantId = inserted.id;
            }
          }
          resultRevision++;
        }
      } else if (input.kind === "capacity") {
        if (input.capacity < (await activeCount(tx, input.shopId, activity.id)))
          return fail("full");
        await tx
          .update(recoveryActivities)
          .set({ capacity: input.capacity })
          .where(eq(recoveryActivities.id, activity.id));
        resultRevision++;
      } else {
        resultRevision++;
      }
      if (resultRevision !== activity.revision)
        await tx
          .update(recoveryActivities)
          .set({
            revision: resultRevision,
            ...(input.kind === "cancel_activity" ? { status: "cancelled" as const } : {}),
          })
          .where(eq(recoveryActivities.id, activity.id));
      await tx.insert(recoveryActivityEvents).values({
        id: input.attemptId,
        shopId: input.shopId,
        activityId: activity.id,
        participantId,
        actorPersonId: input.actorPersonId,
        requestHash,
        resultRevision,
        code:
          input.kind === "offer"
            ? "offer_prepared"
            : input.kind === "confirm"
              ? "place_confirmed"
              : input.kind === "cancel_place"
                ? "place_cancelled"
                : input.kind === "capacity"
                  ? "capacity_changed"
                  : "activity_cancelled",
        transition: {
          expectedRevision: input.expectedRevision,
          ...("capacity" in input ? { capacity: input.capacity } : {}),
          ...("blowoutDiverId" in input ? { blowoutDiverId: input.blowoutDiverId } : {}),
        },
      });
      return { ok: true, revision: resultRevision };
    })
    .catch(catchBusy);
}
