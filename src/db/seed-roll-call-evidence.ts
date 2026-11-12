import { and, eq } from "drizzle-orm";
import { canonicalRollCallEvidenceId } from "@/lib/roll-call-causality";
import type { DbExecutor } from "./client";
import {
  causalMeetingDay,
  prepareCausalRollCall,
  refreshCausalRollCall,
} from "./roll-call-causal-store";
import { newestMarkFirst } from "./roll-call-order";
import { crewMarks, seatMarks } from "./roll-call-subject";
import { rollCallEvents, trips } from "./schema";
import { seedRollCallEvidenceBatch } from "./seed-roll-call-evidence-batch";
import { liveTrip } from "./trips-live";

export type SeedRollCallEvidenceInput = Omit<
  typeof rollCallEvents.$inferInsert,
  "statementStatus" | "causalFrontier" | "evidenceConflict" | "evidenceOrderingUnknown"
>;

/**
 * Author seeded/fixture evidence through the real causal projector. This is
 * fixture authorship, never the staff recorder: real taps use recordRollCall
 * and recordCrewRollCall with their captured basis and authorization gates.
 * `observesPrevious` explicitly describes the fixture author's intended act;
 * neither a capture clock nor receipt time supplies observation or meeting day.
 */
export async function seedRollCallEvidence(
  db: DbExecutor,
  input: SeedRollCallEvidenceInput | readonly SeedRollCallEvidenceInput[],
  options: { observesPrevious: boolean } = { observesPrevious: false },
): Promise<(typeof rollCallEvents.$inferSelect)[]> {
  if (Array.isArray(input))
    return seedRollCallEvidenceBatch(db, input, options, (tx, value) =>
      seedRollCallEvidence(tx, value, options),
    );
  return db.transaction(async (tx) => {
    const events: readonly SeedRollCallEvidenceInput[] = Array.isArray(input)
      ? input
      : [input as SeedRollCallEvidenceInput];
    const written: (typeof rollCallEvents.$inferSelect)[] = [];
    for (const value of events) {
      const kind = value.subjectKind ?? "seat";
      const checkpoint = value.checkpoint ?? "departure";
      const eventId = value.id ?? crypto.randomUUID();
      const day = await causalMeetingDay(tx, value.tripId, value.meetingDay ?? undefined);
      // The same lock order as real writers; bad fixture FKs still fail in SQL.
      await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(liveTrip(), eq(trips.shopId, value.shopId), eq(trips.id, value.tripId)))
        .for("no key update");
      const validSubject =
        kind === "crew"
          ? !!value.crewPersonId && !value.bookingId
          : !!value.bookingId && !value.crewPersonId;
      if (!validSubject) {
        // Preserve deliberate database-constraint fixtures. This row cannot
        // commit; supplying projection fields must not repair its bad subject.
        written.push(
          ...(await tx
            .insert(rollCallEvents)
            .values({
              ...value,
              id: eventId,
              statementStatus: value.status,
              causalFrontier: [
                canonicalRollCallEvidenceId({ id: eventId, clientEventId: value.clientEventId }),
              ],
            })
            .returning()),
        );
        continue;
      }
      const subject = {
        shopId: value.shopId,
        tripId: value.tripId,
        checkpoint,
        ...(kind === "crew"
          ? { personId: value.crewPersonId as string }
          : { bookingId: value.bookingId as string }),
      };
      let observed = value.observedEvidenceIds ?? undefined;
      let retractsEventId = value.retractsEventId ?? undefined;
      if (observed === undefined && options.observesPrevious) {
        const [previous] = await tx
          .select({
            frontier: rollCallEvents.causalFrontier,
            id: rollCallEvents.id,
            clientEventId: rollCallEvents.clientEventId,
          })
          .from(rollCallEvents)
          .where(
            and(
              eq(rollCallEvents.shopId, value.shopId),
              eq(rollCallEvents.tripId, value.tripId),
              eq(rollCallEvents.checkpoint, checkpoint),
              eq(rollCallEvents.meetingDay, day),
              kind === "crew" ? crewMarks() : seatMarks(),
              kind === "crew"
                ? eq(rollCallEvents.crewPersonId, value.crewPersonId as string)
                : eq(rollCallEvents.bookingId, value.bookingId as string),
            ),
          )
          .orderBy(...newestMarkFirst())
          .limit(1);
        observed = previous?.frontier ?? [];
        if (
          value.status === "cleared" &&
          !retractsEventId &&
          previous?.frontier.length === 1 &&
          previous.frontier.includes(canonicalRollCallEvidenceId(previous))
        )
          retractsEventId = previous.id;
      }
      const projection = await prepareCausalRollCall(tx, subject, {
        status: value.status,
        eventId,
        clientEventId: value.clientEventId ?? undefined,
        observedEvidenceIds: observed,
        reconcilesEvidence: value.reconcilesEvidence,
        meetingDay: day,
        retractsEventId,
      });
      const [event] = await tx
        .insert(rollCallEvents)
        .values({
          ...value,
          ...projection,
          statementStatus: value.status,
          captureContext: {
            occurredAt: value.occurredAt.toISOString(),
            meetingDay: value.meetingDay ?? undefined,
            retractsEventId,
          },
          retractsEventId: retractsEventId ?? null,
          observedEvidenceIds: observed ?? null,
        })
        .returning();
      if (!event) throw new Error("seedRollCallEvidence: insert returned no row");
      await refreshCausalRollCall(tx, subject);
      written.push(event);
    }
    return written;
  });
}
