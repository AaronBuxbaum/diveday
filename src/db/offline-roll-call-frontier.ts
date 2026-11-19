import { and, eq, sql } from "drizzle-orm";
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
  if (current.length !== observed.size || current.some((id) => !observed.has(id))) return false;
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
        sql`lower(${rollCallEvents.captureContext}->>'offlineSnapshotId') = ${input.snapshotId.toLowerCase()}`,
      ),
    );
  const byId = new Map(rows.map((row) => [canonicalRollCallEvidenceId(row), row]));
  const reached = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (captured.has(id)) {
      reached.add(id);
      return true;
    }
    if (visiting.has(id)) return false;
    const row = byId.get(id);
    if (
      !row ||
      JSON.stringify(row.captureContext?.offlineWitnessFrontier) !==
        JSON.stringify([...captured].sort())
    )
      return false;
    visiting.add(id);
    const valid = (row.observedEvidenceIds ?? []).every((prior) => visit(prior.toLowerCase()));
    visiting.delete(id);
    return valid;
  };
  return (
    descendants.every(visit) && [...captured].every((id) => reached.has(id) || current.includes(id))
  );
}
