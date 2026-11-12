import { and, eq, inArray } from "drizzle-orm";
import { canonicalRollCallEvidenceId, foldRollCallEvidence } from "@/lib/roll-call-causality";
import type { DbExecutor } from "./client";
import { scopedCausalEvidence } from "./roll-call-causal-store";
import { crewMarks, markBookingId, markCrewPersonId, seatMarks } from "./roll-call-subject";
import { rollCallEvents } from "./schema";
import { rollCallDayIndex } from "./trip-meeting-windows";

/**
 * **Unwithdrawn original roll-call statements on these departures, both roles,**
 * in the shape `maxRecordedDiveNumber` (src/lib/manifests.ts) reads: the floor
 * under a departure's planned dives (CR-006), which a single edit
 * (`editTrip`) and a series apply both hold.
 *
 * Both halves, because the floor read the diver table alone until batch 6: a
 * crew member counted after dive 2 — the divemaster who went back down — was
 * history a lowered plan could orphan. A crew subject is keyed apart from any
 * booking (`crew:` before a person id; booking ids are bare uuids), so the
 * causal frontier is read per person, exactly as it is per diver. A neutral
 * unproven undo cannot erase an original positive from the plan floor.
 */
export async function recordedRollCallRows(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<
  {
    tripId: string;
    bookingId: string;
    checkpoint: string;
    status: string;
    occurredAt: Date;
    createdAt: Date;
    seq: number;
    day: number;
  }[]
> {
  if (tripIds.length === 0) return [];
  // Shop first in both: each append-only table's only index leads with it.
  const divers = await db
    .select({
      tripId: rollCallEvents.tripId,
      bookingId: markBookingId(),
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      id: rollCallEvents.id,
      clientEventId: rollCallEvents.clientEventId,
      statementStatus: rollCallEvents.statementStatus,
      observedEvidenceIds: rollCallEvents.observedEvidenceIds,
      reconcilesEvidence: rollCallEvents.reconcilesEvidence,
      retractsEventId: rollCallEvents.retractsEventId,
      occurredAt: rollCallEvents.occurredAt,
      createdAt: rollCallEvents.createdAt,
      seq: rollCallEvents.seq,
      day: rollCallDayIndex(),
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        seatMarks(),
        inArray(rollCallEvents.tripId, [...tripIds]),
      ),
    );
  const crew = await db
    .select({
      tripId: rollCallEvents.tripId,
      personId: markCrewPersonId(),
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      id: rollCallEvents.id,
      clientEventId: rollCallEvents.clientEventId,
      statementStatus: rollCallEvents.statementStatus,
      observedEvidenceIds: rollCallEvents.observedEvidenceIds,
      reconcilesEvidence: rollCallEvents.reconcilesEvidence,
      retractsEventId: rollCallEvents.retractsEventId,
      occurredAt: rollCallEvents.occurredAt,
      createdAt: rollCallEvents.createdAt,
      seq: rollCallEvents.seq,
      day: rollCallDayIndex(),
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shopId),
        crewMarks(),
        inArray(rollCallEvents.tripId, [...tripIds]),
      ),
    );
  const rows = [
    ...divers,
    ...crew.map(({ personId, ...row }) => ({ ...row, bookingId: `crew:${personId}` })),
  ];
  const scopes = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.tripId}/${row.bookingId}/${row.checkpoint}`;
    const group = scopes.get(key) ?? [];
    group.push(row);
    scopes.set(key, group);
  }
  return [...scopes.values()].flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const evidence = scopedCausalEvidence(
      group.map((row) => ({ ...row, meetingDay: row.day })),
      first.checkpoint,
    );
    const frontier = new Set(foldRollCallEvidence(evidence, first.checkpoint).frontier);
    return group
      .filter(
        (row) =>
          frontier.has(canonicalRollCallEvidenceId(row)) &&
          (row.statementStatus ?? row.status) !== "cleared",
      )
      .map((row) => ({
        tripId: row.tripId,
        bookingId: row.bookingId,
        checkpoint: row.checkpoint,
        status: row.statementStatus ?? row.status,
        occurredAt: row.occurredAt,
        createdAt: row.createdAt,
        seq: row.seq,
        day: row.day,
      }));
  });
}
