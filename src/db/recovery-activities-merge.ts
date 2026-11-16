import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { recoveryActivities, recoveryActivityEvents, recoveryActivityParticipants } from "./schema";

/** Called after merge holds both people. Confirmation takes NOWAIT people locks after activity. */
export async function reconcileRecoveryActivityIdentity(
  tx: DbExecutor,
  input: {
    shopId: string;
    sourcePersonId: string;
    survivorPersonId: string;
    actorPersonId: string;
  },
) {
  const rows = await tx
    .select()
    .from(recoveryActivityParticipants)
    .where(
      and(
        eq(recoveryActivityParticipants.shopId, input.shopId),
        eq(recoveryActivityParticipants.personId, input.sourcePersonId),
      ),
    )
    .orderBy(asc(recoveryActivityParticipants.activityId), asc(recoveryActivityParticipants.id));
  for (const row of rows) {
    const [activity] = await tx
      .select()
      .from(recoveryActivities)
      .where(
        and(eq(recoveryActivities.shopId, input.shopId), eq(recoveryActivities.id, row.activityId)),
      )
      .for("update");
    if (!activity) continue;
    const [kept] = await tx
      .select()
      .from(recoveryActivityParticipants)
      .where(
        and(
          eq(recoveryActivityParticipants.shopId, input.shopId),
          eq(recoveryActivityParticipants.activityId, row.activityId),
          eq(recoveryActivityParticipants.personId, input.survivorPersonId),
          eq(recoveryActivityParticipants.status, "confirmed"),
        ),
      );
    if (kept && row.status === "confirmed")
      await tx
        .update(recoveryActivityParticipants)
        .set({ status: "cancelled", revision: row.revision + 1 })
        .where(eq(recoveryActivityParticipants.id, row.id));
    await tx
      .update(recoveryActivities)
      .set({ revision: activity.revision + 1 })
      .where(eq(recoveryActivities.id, activity.id));
    await tx.insert(recoveryActivityEvents).values({
      id: randomUUID(),
      shopId: input.shopId,
      activityId: activity.id,
      participantId: row.id,
      actorPersonId: input.actorPersonId,
      code: "identity_merged",
      requestHash: "identity_merge",
      resultRevision: activity.revision + 1,
      transition: {
        expectedRevision: activity.revision,
        priorPersonId: input.sourcePersonId,
        canonicalPersonId: input.survivorPersonId,
      },
    });
  }
}
