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
    )
    .limit(10001);
  if (rows.length > 10000) return false;
  const byId = new Map(rows.map((row) => [canonicalRollCallEvidenceId(row), row]));
  const reached = new Set<string>();
  const visiting = new Set<string>();
  const completed = new Set<string>();
  const stack = descendants.map((id) => ({ id, exiting: false }));
  let edges = 0;
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    const { id } = item;
    if (item.exiting) {
      visiting.delete(id);
      completed.add(id);
      continue;
    }
    if (completed.has(id)) continue;
    if (captured.has(id)) {
      reached.add(id);
      continue;
    }
    if (visiting.has(id)) return false;
    const row = byId.get(id);
    if (
      !row ||
      JSON.stringify(row.captureContext?.offlineWitnessFrontier) !==
        JSON.stringify([...captured].sort())
    )
      return false;
    const predecessors = row.observedEvidenceIds ?? [];
    edges += predecessors.length;
    if (edges > 200000) return false;
    visiting.add(id);
    stack.push({ id, exiting: true });
    for (const prior of predecessors) stack.push({ id: prior.toLowerCase(), exiting: false });
  }
  return [...captured].every((id) => reached.has(id) || current.includes(id));
}
