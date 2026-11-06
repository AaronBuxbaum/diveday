import { and, eq, ne } from "drizzle-orm";
import { backAboardNow, notBackAboardSince, type TimedDayMark } from "@/lib/roll-call-days";
import type { DbExecutor } from "./client";
import { oldestMarkFirst } from "./roll-call-order";
import { crewMarks, seatMarks } from "./roll-call-subject";
import { bookings, incidentReportPeople, people, rollCallEvents, tripAssignments } from "./schema";
import { rollCallCurrentDayIndex, rollCallDayIndex } from "./trip-meeting-windows";

/**
 * **Who is missing, as the roll call says** (issue #2694): the subject of a
 * missing-diver report and whether their after-dive marks still stand "not
 * back aboard". Read by the report's start, its raise and its Found
 * (`incident-reports.ts`) and by the alert's send (`missing-diver-alerts.ts`),
 * so a found diver never pages and a missing one is never declared found.
 */

/** Who is missing: a diver by their seat, or a crew member of this departure. */
export type MissingSubject =
  | { kind: "diver"; bookingId: string }
  | { kind: "crew"; personId: string };

/**
 * When the subject's standing "not back aboard" began, as the live manifest
 * shows it now, carried earlier meeting days included (`notBackAboardSince`,
 * #4017); null when it shows them nowhere red after a dive.
 *
 * The earliest, not the newest (domain review 2026-10-16): an offline copy of
 * the same alarm synced seven minutes later, or the same diver still missing
 * at the next count, is the same disappearance, and an insurer reads the
 * first time the crew said so. The dock's `not_boarded` is "never left",
 * never a missing diver, so the reader leaves the departure checkpoint out.
 */
export function standingNotBackAboardSince(events: readonly AfterDiveEvent[]): Date | null {
  return notBackAboardSince(events, events[0]?.currentDay ?? 0);
}

/**
 * Whether these after-dive events (oldest first) say the person is back
 * aboard (`backAboardNow`): the latest is `boarded` and the manifest shows
 * them nowhere red. A `cleared` undo is not "back" (review 2026-10-17).
 */
export function backAboard(events: readonly AfterDiveEvent[]): boolean {
  return backAboardNow(events, events[0]?.currentDay ?? 0);
}

/** One after-dive roll-call event of one subject, filed under its meeting day. */
type AfterDiveEvent = TimedDayMark & { currentDay: number };

/**
 * The subject's after-dive roll-call events on this departure, oldest first,
 * each filed under its meeting day with the id a later undo may name (#4017).
 */
export async function afterDiveEvents(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; subject: MissingSubject },
): Promise<AfterDiveEvent[]> {
  const { subject } = input;
  const rows = await tx
    .select({
      id: rollCallEvents.id,
      retracts: rollCallEvents.retractsEventId,
      checkpoint: rollCallEvents.checkpoint,
      status: rollCallEvents.status,
      occurredAt: rollCallEvents.occurredAt,
      day: rollCallDayIndex(),
      currentDay: rollCallCurrentDayIndex(),
    })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, input.shopId),
        eq(rollCallEvents.tripId, input.tripId),
        subject.kind === "diver"
          ? and(seatMarks(), eq(rollCallEvents.bookingId, subject.bookingId))
          : and(crewMarks(), eq(rollCallEvents.crewPersonId, subject.personId)),
        ne(rollCallEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(...oldestMarkFirst());
  return rows.map((row) => ({ ...row, subject: "subject" }));
}

/** Whether the subject is on this departure: a seat booked on it, or its crew. */
export async function subjectOnDeparture(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; subject: MissingSubject },
): Promise<boolean> {
  const { subject } = input;
  if (subject.kind === "diver") {
    const [seat] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, subject.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
        ),
      )
      .limit(1);
    return Boolean(seat);
  }
  const [member] = await tx
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(
      and(
        eq(tripAssignments.tripId, input.tripId),
        eq(tripAssignments.personId, subject.personId),
        eq(people.shopId, input.shopId),
      ),
    )
    .limit(1);
  return Boolean(member);
}

/**
 * The people a report names as affected whom the roll call can speak for: a
 * diver by their seat, a staffer by their person row. An outsider named by
 * text has no marks and is left out.
 */
export async function affectedSubjects(
  db: DbExecutor,
  shopId: string,
  reportId: string,
): Promise<MissingSubject[]> {
  const rows = await db
    .select({ bookingId: incidentReportPeople.bookingId, personId: incidentReportPeople.personId })
    .from(incidentReportPeople)
    .where(
      and(
        eq(incidentReportPeople.shopId, shopId),
        eq(incidentReportPeople.reportId, reportId),
        eq(incidentReportPeople.involvement, "affected"),
      ),
    );
  const subjects: MissingSubject[] = [];
  for (const row of rows) {
    if (row.bookingId) subjects.push({ kind: "diver", bookingId: row.bookingId });
    else if (row.personId) subjects.push({ kind: "crew", personId: row.personId });
  }
  return subjects;
}

/**
 * Whether the roll call has every one of these people back (`backAboard`).
 * A subject with no marks at all, or whose latest mark was undone, is not
 * "back": the roll call never said so.
 */
export async function rollCallHasThemBack(
  db: DbExecutor,
  input: { shopId: string; tripId: string; subjects: readonly MissingSubject[] },
): Promise<boolean> {
  if (input.subjects.length === 0) return false;
  for (const subject of input.subjects) {
    const events = await afterDiveEvents(db, { ...input, subject });
    if (!backAboard(events)) return false;
  }
  return true;
}
