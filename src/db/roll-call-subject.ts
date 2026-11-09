import type { SQL } from "drizzle-orm";
import { type AnyColumn, and, count, eq, sql } from "drizzle-orm";
import type { RollCallSubjectKind } from "@/lib/roll-call";
import type { DbExecutor } from "./client";
import { rollCallEvents } from "./schema";

/**
 * The two halves of one ledger. `roll_call_events` holds both seat marks and
 * crew marks (issue #2700), so every read names which half it means: a diver
 * count that picked up a crew row, or a crew count that picked up a seat, would
 * put somebody aboard who is not. `scripts/check-roll-call-subject.mjs` refuses
 * a query on the table that names neither.
 *
 * Each helper takes the table (or an `alias()` of it) so a query that reads
 * both halves at once can scope each side.
 */
/** `rollCallEvents` or an `alias()` of it: anything with the subject columns. */
type MarksTable = { subjectKind: AnyColumn; bookingId: AnyColumn; crewPersonId: AnyColumn };

// The kind is written into the statement as a literal, not bound: the partial
// indexes are `where subject_kind = 'seat'` / `'crew'`, and a generic plan over
// a bound parameter cannot prove the predicate and would skip them.
export function seatMarks(table: MarksTable = rollCallEvents) {
  return sql`${table.subjectKind} = 'seat'`;
}

export function crewMarks(table: MarksTable = rollCallEvents) {
  return sql`${table.subjectKind} = 'crew'`;
}

/**
 * A seat mark's booking, typed as present. `booking_id` is nullable on the
 * table because a crew row has none, and `roll_call_events_subject` makes it
 * present on every seat row: project it with this inside a `seatMarks()` query.
 */
export function markBookingId(table: MarksTable = rollCallEvents) {
  return sql<string>`${table.bookingId}`;
}

/** A crew mark's person, typed as present: the crew half of {@link markBookingId}. */
export function markCrewPersonId(table: MarksTable = rollCallEvents) {
  return sql<string>`${table.crewPersonId}`;
}

/**
 * The subject id of a whole row read under `seatMarks()` or `crewMarks()`.
 * Throws rather than inventing an id: a seat row with no booking, or a crew
 * row with no person, is a broken `roll_call_events_subject` check, and a
 * head count must never key somebody under the empty string.
 */
export function markSubjectId(row: {
  subjectKind: RollCallSubjectKind;
  bookingId: string | null;
  crewPersonId: string | null;
}): string {
  const id = row.subjectKind === "seat" ? row.bookingId : row.crewPersonId;
  if (id === null) throw new Error(`roll_call_events: a ${row.subjectKind} mark with no subject`);
  return id;
}

type SubjectColumns = {
  subjectKind: RollCallSubjectKind;
  bookingId: string | null;
  crewPersonId: string | null;
};

/** A whole row read without a subject filter, split into its two halves, each typed as present. */
export function splitRollCallRows<T extends SubjectColumns>(
  rows: readonly T[],
): {
  seats: (T & { subjectKind: "seat"; bookingId: string })[];
  crew: (T & { subjectKind: "crew"; crewPersonId: string })[];
} {
  const seats: (T & { subjectKind: "seat"; bookingId: string })[] = [];
  const crew: (T & { subjectKind: "crew"; crewPersonId: string })[] = [];
  for (const row of rows) {
    const subjectId = markSubjectId(row);
    if (row.subjectKind === "seat")
      seats.push({ ...row, subjectKind: "seat", bookingId: subjectId });
    else crew.push({ ...row, subjectKind: "crew", crewPersonId: subjectId });
  }
  return { seats, crew };
}

/** How many marks of one kind a shop holds: the export page's count for each half's file. */
export async function countRollCallMarks(
  db: DbExecutor,
  shopId: string,
  kind: RollCallSubjectKind,
  exclusion?: SQL,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shopId), eq(rollCallEvents.subjectKind, kind), exclusion));
  return row?.n ?? 0;
}

/** One whole row read under `seatMarks()`, typed with its booking present. */
export function asSeatMark<T extends SubjectColumns>(
  row: T,
): T & { subjectKind: "seat"; bookingId: string } {
  if (row.subjectKind !== "seat") throw new Error("roll_call_events: a crew mark read as a seat");
  return { ...row, subjectKind: "seat", bookingId: markSubjectId(row) };
}

/** One whole row read under `crewMarks()`, typed with its person present. */
export function asCrewMark<T extends SubjectColumns>(
  row: T,
): T & { subjectKind: "crew"; crewPersonId: string } {
  if (row.subjectKind !== "crew") throw new Error("roll_call_events: a seat mark read as crew");
  return { ...row, subjectKind: "crew", crewPersonId: markSubjectId(row) };
}

/** The subject columns of a crew mark, for a writer to spread into its insert. */
export function crewSubject(personId: string) {
  return { subjectKind: "crew" as const, crewPersonId: personId };
}
