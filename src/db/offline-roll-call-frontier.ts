import { and, eq, inArray } from "drizzle-orm";
import { canonicalRollCallEvidenceId } from "@/lib/roll-call-causality";
import type { DbExecutor } from "./client";
import { crewMarks, seatMarks } from "./roll-call-subject";
import { rollCallEvents } from "./schema";

/** A newer frontier is safe only when this device observed accepted descendants of the same signed copy. */
export async function offlineFrontierMatches(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    checkpoint: string;
    meetingDay: number;
    subject: { bookingId: string } | { personId: string };
    snapshotId: string;
    captured: readonly string[];
    current: readonly string[];
    observed: readonly string[];
  },
): Promise<boolean> {
  const observed = new Set(input.observed.map((id) => id.toLowerCase()));
  const captured = new Set(input.captured.map((id) => id.toLowerCase()));
  const current = input.current.map((id) => id.toLowerCase());
  if (current.some((id) => !observed.has(id))) return false;
  const descendants = current.filter((id) => !captured.has(id));
  if (descendants.length === 0) return current.length === captured.size;
  if (descendants.some((id) => !id.startsWith("client:"))) return false;
  const rows = await db
    .select()
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, input.shopId),
        eq(rollCallEvents.tripId, input.tripId),
        eq(rollCallEvents.checkpoint, input.checkpoint),
        eq(rollCallEvents.meetingDay, input.meetingDay),
        eq(rollCallEvents.source, "offline"),
        "bookingId" in input.subject ? seatMarks() : crewMarks(),
        "bookingId" in input.subject
          ? eq(rollCallEvents.bookingId, input.subject.bookingId)
          : eq(rollCallEvents.crewPersonId, input.subject.personId),
        inArray(
          rollCallEvents.clientEventId,
          descendants.map((id) => id.slice("client:".length)),
        ),
      ),
    );
  const proven = new Set(
    rows
      .filter(
        (row) =>
          row.captureContext?.offlineSnapshotId?.toLowerCase() === input.snapshotId.toLowerCase(),
      )
      .map(canonicalRollCallEvidenceId),
  );
  return descendants.every((id) => proven.has(id));
}
