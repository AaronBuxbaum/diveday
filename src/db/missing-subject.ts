import { and, asc, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  bookings,
  incidentReportPeople,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
} from "./schema";

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
 * When a standing "not back aboard" began, from one subject's after-dive
 * roll-call events oldest first: per checkpoint, the first `not_boarded` of
 * the unbroken run that ends with the checkpoint's latest event; across
 * checkpoints, the earliest. Null when no checkpoint stands that way now
 * (never marked, or marked back aboard or cleared since).
 *
 * The earliest, not the newest (domain review 2026-10-16): an offline copy of
 * the same alarm synced seven minutes later, or the same diver still missing
 * at the next count, is the same disappearance, and an insurer reads the
 * first time the crew said so. The dock's `not_boarded` is "never left",
 * never a missing diver, so the caller leaves the departure checkpoint out.
 */
export function standingNotBackAboardSince(
  events: readonly { checkpoint: string; status: string; occurredAt: Date }[],
): Date | null {
  const runStart = new Map<string, Date | null>();
  for (const event of events) {
    if (event.status !== "not_boarded") runStart.set(event.checkpoint, null);
    else if (!runStart.get(event.checkpoint)) runStart.set(event.checkpoint, event.occurredAt);
  }
  let since: Date | null = null;
  for (const start of runStart.values()) {
    if (start && (!since || start < since)) since = start;
  }
  return since;
}

/**
 * Whether these after-dive events (oldest first) say the person is back
 * aboard: the latest event is `boarded` and no checkpoint still stands "not
 * back aboard". A `cleared` undo is not "back": it takes the mark away
 * without saying anyone came aboard (review 2026-10-17), and no marks at all
 * is not back either.
 */
export function backAboard(
  events: readonly { checkpoint: string; status: string; occurredAt: Date }[],
): boolean {
  return events.at(-1)?.status === "boarded" && standingNotBackAboardSince(events) === null;
}

/** The subject's after-dive roll-call events on this departure, oldest first. */
export async function afterDiveEvents(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; subject: MissingSubject },
) {
  const { subject } = input;
  if (subject.kind === "diver") {
    return tx
      .select({
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.shopId, input.shopId),
          eq(rollCallEvents.tripId, input.tripId),
          eq(rollCallEvents.bookingId, subject.bookingId),
          ne(rollCallEvents.checkpoint, "departure"),
        ),
      )
      .orderBy(
        asc(rollCallEvents.occurredAt),
        asc(rollCallEvents.createdAt),
        asc(rollCallEvents.seq),
      );
  }
  return tx
    .select({
      checkpoint: rollCallCrewEvents.checkpoint,
      status: rollCallCrewEvents.status,
      occurredAt: rollCallCrewEvents.occurredAt,
    })
    .from(rollCallCrewEvents)
    .where(
      and(
        eq(rollCallCrewEvents.shopId, input.shopId),
        eq(rollCallCrewEvents.tripId, input.tripId),
        eq(rollCallCrewEvents.personId, subject.personId),
        ne(rollCallCrewEvents.checkpoint, "departure"),
      ),
    )
    .orderBy(
      asc(rollCallCrewEvents.occurredAt),
      asc(rollCallCrewEvents.createdAt),
      asc(rollCallCrewEvents.seq),
    );
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
