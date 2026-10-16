import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  INCIDENT_SHORT_TEXT_MAX,
  INCIDENT_TEXT_MAX,
  type IncidentDraftFields,
  type IncidentFilingGap,
  type IncidentHandoverKind,
  type IncidentInvolvement,
  type IncidentKind,
  type IncidentReportStatus,
  type IncidentSeverity,
  type IncidentViewer,
  incidentFilingGaps,
  mayReadIncidentReport,
  mayStartIncidentReport,
  mayWriteIncidentReport,
} from "@/lib/incident-reports";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { recordTripActivity } from "./operations";
import { queryAll } from "./query-helpers";
import {
  bookings,
  diveSites,
  incidentReportAddenda,
  incidentReportPeople,
  incidentReports,
  people,
  personRoles,
  rollCallCrewEvents,
  rollCallEvents,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **Incident reports** (ADR 20261012-incident-reports): one per incident, on a
 * departure, started by its crew or an owner or manager, edited as a draft,
 * filed once, and amended only by dated addenda.
 *
 * Every function here checks the caller's **live** roles itself rather than
 * trusting the page or action above it: these rows are personal and medical
 * data, and "the route forgot to check" is not a control. A report someone may
 * not read answers exactly as a missing one does, so an id from another shop
 * or another staffer's report tells the caller nothing.
 *
 * Nothing here is read by readiness, roll call, booking or the close-out. A
 * report is a record, never a gate.
 */

/** Who started a report, read by name beside it. */
const creators = alias(people, "incident_creators");

/** The live roles and crew flag the rules in `src/lib/incident-reports.ts` read. */
export async function loadIncidentViewer(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<IncidentViewer> {
  const [roles, crew] = await queryAll(db, [
    () => loadActiveStaffRoles(db, shopId, personId),
    () =>
      db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .where(
          and(
            liveTrip(),
            eq(tripAssignments.tripId, tripId),
            eq(tripAssignments.personId, personId),
            eq(trips.shopId, shopId),
          ),
        )
        .limit(1),
  ]);
  return { personId, roles, onCrew: crew.length > 0 };
}

export type IncidentWriteRefusal =
  | "not_found"
  | "not_allowed"
  | "filed"
  | "draft"
  | "incomplete"
  | "site_not_found"
  | "subject_not_found"
  | "already_listed"
  | "blank"
  | "too_long";

type StartedDraft =
  | { ok: true; reportId: string; reused: boolean }
  | { ok: false; reason: IncidentWriteRefusal };

/** Every answer a draft holds; a draft whose answers are all null says nothing yet. */
const DRAFT_ANSWER_COLUMNS = [
  incidentReports.occurredAt,
  incidentReports.diveSiteId,
  incidentReports.locationText,
  incidentReports.whatHappened,
  incidentReports.kind,
  incidentReports.severity,
  incidentReports.firstAidGiven,
  incidentReports.oxygenGiven,
  incidentReports.oxygenMinutes,
  incidentReports.emergencyServicesCalled,
  incidentReports.handoverKind,
  incidentReports.handoverDetail,
  incidentReports.handedOverAt,
  incidentReports.followUp,
] as const;

/**
 * Start a draft on a departure, or reopen the **untouched** one this person
 * just started.
 *
 * **A double tap is not a second report** (safety sheet 2026-10-15, item 3):
 * a second tap of "Report an incident" (a slow phone at the dock) used to
 * insert a second empty draft into the list the owner and the insurer read.
 * Now it answers with the writer's own unfiled draft on that departure, but
 * only while that draft says nothing at all: no answer and nobody named
 * (domain review 2026-10-16). A draft about something else is a different
 * incident, and "one report per incident" (ADR 20261012-incident-reports,
 * amended by 20261016-incident-drafts) means the writer gets a new one.
 * Somebody else's draft is never handed over, so reuse widens nobody's view.
 *
 * Race-safe by a transaction-scoped advisory lock on (departure, writer):
 * two taps arriving together queue, and the second reads the draft the first
 * committed (`incident-reports.postgres.test.ts`). A hash collision only
 * serializes two unrelated starts for a moment.
 */
export async function startIncidentReport(
  db: AppDb,
  input: { shopId: string; tripId: string; actorPersonId: string },
): Promise<StartedDraft> {
  return db.transaction((tx) => openUntouchedDraft(tx, input));
}

/** The live departure, and whether this person may start a report on it. */
async function startGate(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; actorPersonId: string },
): Promise<IncidentWriteRefusal | null> {
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(liveTrip(), eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!trip) return "not_found";
  const viewer = await loadIncidentViewer(tx, input.shopId, input.tripId, input.actorPersonId);
  return mayStartIncidentReport(viewer) ? null : "not_allowed";
}

/** A new, empty draft by this writer. */
async function insertDraft(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; actorPersonId: string },
  fields: { kind?: IncidentKind; occurredAt?: Date } = {},
): Promise<string | null> {
  const now = nowDate();
  const [row] = await tx
    .insert(incidentReports)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      createdByPersonId: input.actorPersonId,
      createdAt: now,
      updatedAt: now,
      ...fields,
    })
    .returning({ id: incidentReports.id });
  return row?.id ?? null;
}

/** `startIncidentReport`'s body, inside the caller's transaction. */
async function openUntouchedDraft(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; actorPersonId: string },
): Promise<StartedDraft> {
  const refused = await startGate(tx, input);
  if (refused) return { ok: false, reason: refused };
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('incident_report_draft'), hashtext(${`${input.tripId}:${input.actorPersonId}`}))`,
  );
  const [open] = await tx
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, input.shopId),
        eq(incidentReports.tripId, input.tripId),
        eq(incidentReports.createdByPersonId, input.actorPersonId),
        eq(incidentReports.status, "draft"),
        isNull(incidentReports.deletedAt),
        ...DRAFT_ANSWER_COLUMNS.map((column) => isNull(column)),
        sql`not exists (select 1 from ${incidentReportPeople} where ${incidentReportPeople.reportId} = ${incidentReports.id})`,
      ),
    )
    // diveday:allow-time-id-order: picks the one draft to reopen; nobody is shown this order.
    .orderBy(asc(incidentReports.createdAt), asc(incidentReports.id))
    .limit(1);
  if (open) return { ok: true, reportId: open.id, reused: true };
  const reportId = await insertDraft(tx, input);
  if (!reportId) return { ok: false, reason: "not_found" };
  return { ok: true, reportId, reused: false };
}

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

/** The subject's after-dive roll-call events on this departure, oldest first. */
async function afterDiveEvents(
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
async function subjectOnDeparture(
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

export type MissingDiverStart =
  | { ok: true; reportId: string; reused: boolean }
  | { ok: false; reason: IncidentWriteRefusal | "not_missing" }
  /** Somebody else's open report already names them; who started it, nothing more. */
  | { ok: false; reason: "already_started"; startedByName: string };

/**
 * **"Start a missing diver report"** from a manifest row marked not back
 * aboard (safety sheet 2026-10-15, item 2): a diver's seat, or a crew member
 * of the departure (domain review 2026-10-16). One report per missing person:
 *
 * - An **unfiled Missing diver draft on this departure that already names
 *   them** is the report, whoever started it. Its writer, an owner or a
 *   manager gets it back. Anyone else (a second crew member tapping for the
 *   same diver) is told who started it, and is given neither its contents
 *   nor a second report.
 * - Otherwise a **new** draft, of kind Missing diver, timed at the earliest
 *   standing mark ({@link standingNotBackAboardSince}), naming them as
 *   affected. Never the writer's other draft: a missing diver folded into an
 *   injury report reads to an insurer as no missing-diver report at all.
 *
 * Race-safe by an advisory lock on (departure, missing person), so two crew
 * tapping together make one report. No new state or mode: the result is an
 * ordinary draft, filed the ordinary way.
 *
 * Refused as `not_missing` when they have no standing after-dive "not back
 * aboard" mark on this departure (marked back aboard meanwhile, or not on
 * this departure at all), so a stale tap writes nothing.
 */
export async function startMissingDiverReport(
  db: AppDb,
  input: { shopId: string; tripId: string; subject: MissingSubject; actorPersonId: string },
): Promise<MissingDiverStart> {
  return db.transaction(async (tx): Promise<MissingDiverStart> => {
    // Who may write first, so a refused caller learns nothing about the seat.
    const refused = await startGate(tx, input);
    if (refused) return { ok: false, reason: refused === "not_found" ? "not_allowed" : refused };
    if (!(await subjectOnDeparture(tx, input))) return { ok: false, reason: "not_missing" };
    const since = standingNotBackAboardSince(await afterDiveEvents(tx, input));
    if (!since) return { ok: false, reason: "not_missing" };
    const { subject } = input;
    const subjectId = subject.kind === "diver" ? subject.bookingId : subject.personId;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('incident_report_missing'), hashtext(${`${input.tripId}:${subjectId}`}))`,
    );
    const [open] = await tx
      .select({
        id: incidentReports.id,
        createdByPersonId: incidentReports.createdByPersonId,
        createdByName: creators.fullName,
      })
      .from(incidentReports)
      .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
      .innerJoin(incidentReportPeople, eq(incidentReportPeople.reportId, incidentReports.id))
      .where(
        and(
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.tripId, input.tripId),
          eq(incidentReports.status, "draft"),
          eq(incidentReports.kind, "missing_diver"),
          isNull(incidentReports.deletedAt),
          subject.kind === "diver"
            ? eq(incidentReportPeople.bookingId, subject.bookingId)
            : eq(incidentReportPeople.personId, subject.personId),
        ),
      )
      // diveday:allow-time-id-order: picks the one report to reopen; nobody is shown this order.
      .orderBy(asc(incidentReports.createdAt), asc(incidentReports.id))
      .limit(1);
    if (open) {
      const viewer = await loadIncidentViewer(tx, input.shopId, input.tripId, input.actorPersonId);
      if (mayReadIncidentReport(viewer, open)) return { ok: true, reportId: open.id, reused: true };
      return { ok: false, reason: "already_started", startedByName: open.createdByName };
    }
    const reportId = await insertDraft(tx, input, { kind: "missing_diver", occurredAt: since });
    if (!reportId) return { ok: false, reason: "not_found" };
    await tx.insert(incidentReportPeople).values({
      shopId: input.shopId,
      reportId,
      involvement: "affected",
      ...(subject.kind === "diver"
        ? { bookingId: subject.bookingId }
        : { personId: subject.personId }),
    });
    return { ok: true, reportId, reused: false };
  });
}

/**
 * Whether this person may start a report on this departure: the manifest
 * shows "Start a missing diver report" only to them. The write re-checks.
 */
export async function mayStartTripIncidentReport(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<boolean> {
  return mayStartIncidentReport(await loadIncidentViewer(db, shopId, tripId, personId));
}

/** Which report a write is for: the shop, the departure it hangs off, and who is writing. */
type WriteTarget = { shopId: string; reportId: string; tripId: string; actorPersonId: string };

/**
 * The report, locked for the write that follows, and whether this actor may
 * write it. Reads the departure without `liveTrip()`: a report outlives a
 * deleted departure, and so does the right to add an addendum to it.
 */
async function lockForWrite(
  db: DbExecutor,
  { shopId, reportId, tripId, actorPersonId }: WriteTarget,
) {
  const [report] = await db
    .select({
      id: incidentReports.id,
      tripId: incidentReports.tripId,
      status: incidentReports.status,
      createdByPersonId: incidentReports.createdByPersonId,
      occurredAt: incidentReports.occurredAt,
      diveSiteId: incidentReports.diveSiteId,
      locationText: incidentReports.locationText,
      whatHappened: incidentReports.whatHappened,
      kind: incidentReports.kind,
      severity: incidentReports.severity,
      firstAidGiven: incidentReports.firstAidGiven,
      oxygenGiven: incidentReports.oxygenGiven,
      oxygenMinutes: incidentReports.oxygenMinutes,
      emergencyServicesCalled: incidentReports.emergencyServicesCalled,
      handoverKind: incidentReports.handoverKind,
      handoverDetail: incidentReports.handoverDetail,
      handedOverAt: incidentReports.handedOverAt,
      followUp: incidentReports.followUp,
    })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.id, reportId),
        eq(incidentReports.shopId, shopId),
        // A deleted draft answers every write as a missing report does.
        isNull(incidentReports.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  // A report reached under another departure's address is not this report.
  if (!report || report.tripId !== tripId) return { report: null, allowed: false } as const;
  const viewer = await loadIncidentViewer(db, shopId, report.tripId, actorPersonId);
  return { report, allowed: mayWriteIncidentReport(viewer, report) } as const;
}

/** Save a draft's fields. A filed report is refused: it changes only by addendum. */
export async function saveIncidentDraft(
  db: AppDb,
  input: WriteTarget & { fields: IncidentDraftFields },
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    const { fields } = input;
    if (fields.diveSiteId) {
      const [site] = await tx
        .select({ id: diveSites.id })
        .from(diveSites)
        .where(and(eq(diveSites.id, fields.diveSiteId), eq(diveSites.shopId, input.shopId)))
        .limit(1);
      if (!site) return { ok: false, reason: "site_not_found" } as const;
    }
    await tx
      .update(incidentReports)
      .set({
        ...fields,
        // Minutes only ever stand beside a "yes"; the database holds this too.
        oxygenMinutes: fields.oxygenGiven === true ? fields.oxygenMinutes : null,
        updatedAt: nowDate(),
      })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.status, "draft"),
        ),
      );
    return { ok: true } as const;
  });
}

/**
 * File a draft. Refused with the codes of what it still needs; once filed it
 * is never updated again, and the departure's trail says who filed it.
 */
export async function fileIncidentReport(
  db: AppDb,
  input: WriteTarget,
): Promise<
  | { ok: true }
  | { ok: false; reason: Exclude<IncidentWriteRefusal, "incomplete"> }
  | { ok: false; reason: "incomplete"; gaps: IncidentFilingGap[] }
> {
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    const gaps = incidentFilingGaps(report);
    if (gaps.length > 0) return { ok: false, reason: "incomplete", gaps } as const;
    const now = nowDate();
    await tx
      .update(incidentReports)
      .set({
        status: "filed",
        filedAt: now,
        filedByPersonId: input.actorPersonId,
        updatedAt: now,
      })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.status, "draft"),
        ),
      );
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "incident_report_filed" },
    });
    return { ok: true } as const;
  });
}

/** Add a dated, attributed addendum to a filed report. A draft is edited instead. */
export async function addIncidentAddendum(
  db: AppDb,
  input: WriteTarget & { body: string },
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  const body = input.body.trim();
  if (!body) return { ok: false, reason: "blank" };
  if (body.length > INCIDENT_TEXT_MAX) return { ok: false, reason: "too_long" };
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "filed") return { ok: false, reason: "draft" } as const;
    await tx.insert(incidentReportAddenda).values({
      shopId: input.shopId,
      reportId: input.reportId,
      body,
      authorPersonId: input.actorPersonId,
      createdAt: nowDate(),
    });
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "incident_report_addendum_added" },
    });
    return { ok: true } as const;
  });
}

export type IncidentSubject =
  | { kind: "booking"; bookingId: string }
  | { kind: "staff"; personId: string }
  | { kind: "outsider"; name: string };

/**
 * Name somebody in a draft: a diver by their seat on **this** departure, a
 * staffer of this shop, or anybody else by name. Each subject once.
 */
export async function addIncidentPerson(
  db: AppDb,
  input: WriteTarget & { subject: IncidentSubject; involvement: IncidentInvolvement },
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    const { subject } = input;
    const row: {
      bookingId?: string;
      personId?: string;
      outsiderName?: string;
    } = {};
    if (subject.kind === "booking") {
      const [seat] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.id, subject.bookingId),
            eq(bookings.shopId, input.shopId),
            eq(bookings.tripId, report.tripId),
          ),
        )
        .limit(1);
      if (!seat) return { ok: false, reason: "subject_not_found" } as const;
      row.bookingId = seat.id;
    } else if (subject.kind === "staff") {
      const roles = await loadActiveStaffRoles(tx, input.shopId, subject.personId);
      if (!roles || roles.every((role) => role === "diver")) {
        return { ok: false, reason: "subject_not_found" } as const;
      }
      row.personId = subject.personId;
    } else {
      const name = subject.name.trim();
      if (!name) return { ok: false, reason: "blank" } as const;
      if (name.length > INCIDENT_SHORT_TEXT_MAX) return { ok: false, reason: "too_long" } as const;
      row.outsiderName = name;
    }
    const [existing] = await tx
      .select({ id: incidentReportPeople.id })
      .from(incidentReportPeople)
      .where(
        and(
          eq(incidentReportPeople.reportId, input.reportId),
          row.bookingId
            ? eq(incidentReportPeople.bookingId, row.bookingId)
            : row.personId
              ? eq(incidentReportPeople.personId, row.personId)
              : sql`lower(${incidentReportPeople.outsiderName}) = lower(${row.outsiderName ?? ""})`,
        ),
      )
      .limit(1);
    if (existing) return { ok: false, reason: "already_listed" } as const;
    await tx.insert(incidentReportPeople).values({
      shopId: input.shopId,
      reportId: input.reportId,
      involvement: input.involvement,
      ...row,
    });
    return { ok: true } as const;
  });
}

/** Take somebody off a draft's list. A filed report's list is fixed. */
export async function removeIncidentPerson(
  db: AppDb,
  input: WriteTarget & { rowId: string },
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    await tx
      .delete(incidentReportPeople)
      .where(
        and(
          eq(incidentReportPeople.id, input.rowId),
          eq(incidentReportPeople.reportId, input.reportId),
          eq(incidentReportPeople.shopId, input.shopId),
        ),
      );
    return { ok: true } as const;
  });
}

/**
 * **Delete an unfiled draft** (ADR 20261016-incident-drafts; domain review
 * 2026-10-16): a double start, a test, something that turned out to be
 * nothing. Its writer, an owner or a manager may (`mayWriteIncidentReport`);
 * a filed report is refused, since it changes only by addendum. Soft: the row
 * stays and the departure log lists it as a deleted draft; it leaves every
 * working list, Today's line and the report's own door. The departure's trail
 * names who deleted it and nothing of what it said.
 */
export async function deleteIncidentDraft(
  db: AppDb,
  input: WriteTarget,
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed } = await lockForWrite(tx, input);
    if (!report || !allowed) return { ok: false, reason: "not_found" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    await tx
      .update(incidentReports)
      .set({ deletedAt: nowDate(), deletedByPersonId: input.actorPersonId })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.status, "draft"),
          isNull(incidentReports.deletedAt),
        ),
      );
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "incident_draft_deleted" },
    });
    return { ok: true } as const;
  });
}

export type IncidentPersonLine = {
  id: string;
  kind: "booking" | "staff" | "outsider";
  name: string;
  involvement: IncidentInvolvement;
};

export type IncidentReportView = {
  id: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
  status: IncidentReportStatus;
  fields: IncidentDraftFields;
  diveSiteName: string | null;
  createdByPersonId: string;
  createdByName: string;
  createdAt: Date;
  filedAt: Date | null;
  filedByName: string | null;
  people: IncidentPersonLine[];
  addenda: { id: string; body: string; authorName: string; createdAt: Date }[];
  /** Whether this viewer may edit the draft or add an addendum. */
  mayWrite: boolean;
};

/**
 * One report, for a viewer who may read it, or `null` — for a report that is
 * not this shop's, does not exist, or is somebody else's and the viewer is not
 * an owner or manager. The three are deliberately indistinguishable.
 */
export async function getIncidentReport(
  db: DbExecutor,
  shopId: string,
  reportId: string,
  viewerPersonId: string,
): Promise<IncidentReportView | null> {
  const filers = alias(people, "incident_filers");
  const [row] = await db
    .select({
      report: incidentReports,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      siteName: diveSites.name,
      createdByName: creators.fullName,
      filedByName: filers.fullName,
    })
    .from(incidentReports)
    // diveday:allow-deleted-trips: a report outlives a deleted departure.
    .innerJoin(trips, and(eq(trips.id, incidentReports.tripId), eq(trips.shopId, shopId)))
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .leftJoin(filers, eq(filers.id, incidentReports.filedByPersonId))
    .leftJoin(diveSites, eq(diveSites.id, incidentReports.diveSiteId))
    .where(
      and(
        eq(incidentReports.id, reportId),
        eq(incidentReports.shopId, shopId),
        isNull(incidentReports.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const viewer = await loadIncidentViewer(db, shopId, row.report.tripId, viewerPersonId);
  if (!mayReadIncidentReport(viewer, row.report)) return null;

  const seatPeople = alias(people, "incident_seat_people");
  const authors = alias(people, "incident_addendum_authors");
  const [personRows, addendumRows] = await queryAll(db, [
    () =>
      db
        .select({
          id: incidentReportPeople.id,
          bookingId: incidentReportPeople.bookingId,
          personId: incidentReportPeople.personId,
          outsiderName: incidentReportPeople.outsiderName,
          involvement: incidentReportPeople.involvement,
          seatName: seatPeople.fullName,
          staffName: people.fullName,
        })
        .from(incidentReportPeople)
        .leftJoin(bookings, eq(bookings.id, incidentReportPeople.bookingId))
        .leftJoin(seatPeople, eq(seatPeople.id, bookings.personId))
        .leftJoin(people, eq(people.id, incidentReportPeople.personId))
        .where(
          and(eq(incidentReportPeople.reportId, reportId), eq(incidentReportPeople.shopId, shopId)),
        )
        // Affected first, then witnesses, then responders (the enum's order), by
        // name within each: the order an insurer reads a list of people in.
        .orderBy(
          asc(incidentReportPeople.involvement),
          sql`coalesce(${seatPeople.fullName}, ${people.fullName}, ${incidentReportPeople.outsiderName})`,
          asc(incidentReportPeople.id),
        ),
    () =>
      db
        .select({
          id: incidentReportAddenda.id,
          body: incidentReportAddenda.body,
          createdAt: incidentReportAddenda.createdAt,
          authorName: authors.fullName,
        })
        .from(incidentReportAddenda)
        .innerJoin(authors, eq(authors.id, incidentReportAddenda.authorPersonId))
        .where(
          and(
            eq(incidentReportAddenda.reportId, reportId),
            eq(incidentReportAddenda.shopId, shopId),
          ),
        )
        // Oldest first; the writer and the words settle notes written in one instant.
        .orderBy(
          asc(incidentReportAddenda.createdAt),
          asc(authors.fullName),
          asc(incidentReportAddenda.body),
          asc(incidentReportAddenda.id),
        ),
  ]);

  const { report } = row;
  return {
    id: report.id,
    tripId: report.tripId,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    status: report.status,
    fields: {
      occurredAt: report.occurredAt,
      diveSiteId: report.diveSiteId,
      locationText: report.locationText,
      whatHappened: report.whatHappened,
      kind: report.kind,
      severity: report.severity,
      firstAidGiven: report.firstAidGiven,
      oxygenGiven: report.oxygenGiven,
      oxygenMinutes: report.oxygenMinutes,
      emergencyServicesCalled: report.emergencyServicesCalled,
      handoverKind: report.handoverKind as IncidentHandoverKind | null,
      handoverDetail: report.handoverDetail,
      handedOverAt: report.handedOverAt,
      followUp: report.followUp,
    },
    diveSiteName: row.siteName,
    createdByPersonId: report.createdByPersonId,
    createdByName: row.createdByName,
    createdAt: report.createdAt,
    filedAt: report.filedAt,
    filedByName: row.filedByName,
    people: personRows.map((person) => ({
      id: person.id,
      kind: person.bookingId ? "booking" : person.personId ? "staff" : "outsider",
      name: person.seatName ?? person.staffName ?? person.outsiderName ?? "",
      involvement: person.involvement,
    })),
    addenda: addendumRows,
    mayWrite: mayWriteIncidentReport(viewer, report),
  };
}

export type IncidentReportLine = {
  id: string;
  tripId: string;
  tripTitle: string;
  status: IncidentReportStatus;
  /** When it happened, or when the draft was started if it does not say yet. */
  at: Date;
  occurredAt: Date | null;
  /** What kind of incident, and how serious; null on a draft that does not say yet. */
  kind: IncidentKind | null;
  severity: IncidentSeverity | null;
  createdByName: string;
};

const LINE_FIELDS = {
  id: incidentReports.id,
  tripId: incidentReports.tripId,
  tripTitle: trips.title,
  status: incidentReports.status,
  occurredAt: incidentReports.occurredAt,
  kind: incidentReports.kind,
  severity: incidentReports.severity,
  createdAt: incidentReports.createdAt,
  createdByName: creators.fullName,
};

function toLine(row: {
  id: string;
  tripId: string;
  tripTitle: string;
  status: IncidentReportStatus;
  occurredAt: Date | null;
  kind: IncidentKind | null;
  severity: IncidentSeverity | null;
  createdAt: Date;
  createdByName: string;
}): IncidentReportLine {
  return {
    id: row.id,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    status: row.status,
    at: row.occurredAt ?? row.createdAt,
    occurredAt: row.occurredAt,
    kind: row.kind,
    severity: row.severity,
    createdByName: row.createdByName,
  };
}

/**
 * A departure's reports as this viewer may see them — every one for an owner
 * or manager, their own for anyone else — and whether they may start one.
 */
export async function listTripIncidentReports(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  viewerPersonId: string,
): Promise<{ mayStart: boolean; reports: IncidentReportLine[] }> {
  const viewer = await loadIncidentViewer(db, shopId, tripId, viewerPersonId);
  if (viewer.roles === null) return { mayStart: false, reports: [] };
  const seesAll = mayReadIncidentReport(viewer, { createdByPersonId: "" });
  const rows = await db
    .select(LINE_FIELDS)
    .from(incidentReports)
    .innerJoin(trips, and(liveTrip(), eq(trips.id, incidentReports.tripId)))
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .where(
      and(
        eq(incidentReports.shopId, shopId),
        eq(incidentReports.tripId, tripId),
        isNull(incidentReports.deletedAt),
        seesAll ? undefined : eq(incidentReports.createdByPersonId, viewerPersonId),
      ),
    )
    .orderBy(desc(incidentReports.createdAt), asc(creators.fullName), desc(incidentReports.id));
  return { mayStart: mayStartIncidentReport(viewer), reports: rows.map(toLine) };
}

/** One unfiled draft, as Today's line names it: who started it and when. */
export type UnfiledIncidentDraft = {
  id: string;
  tripId: string;
  createdAt: Date;
  createdByName: string;
};

/**
 * **Every unfiled draft in the shop, oldest first**, for the owner's and
 * managers' one line on Today (safety sheet 2026-10-15, item 3): an injury
 * started on the boat and left as a private draft while the insurer's notice
 * window runs. Owners and managers only, re-read live here: they may already
 * read every report, so the line widens nobody's view. Anyone else, or no
 * viewer at all, gets nothing. A report outlives a deleted departure, and so
 * does an unfiled one's line.
 */
export async function listUnfiledIncidentDrafts(
  db: DbExecutor,
  shopId: string,
  viewerPersonId: string,
): Promise<UnfiledIncidentDraft[]> {
  const roles = await loadActiveStaffRoles(db, shopId, viewerPersonId);
  if (
    !mayReadIncidentReport(
      { personId: viewerPersonId, roles, onCrew: false },
      { createdByPersonId: "" },
    )
  ) {
    return [];
  }
  return (
    db
      .select({
        id: incidentReports.id,
        tripId: incidentReports.tripId,
        createdAt: incidentReports.createdAt,
        createdByName: creators.fullName,
      })
      .from(incidentReports)
      .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
      // diveday:allow-deleted-trips: a report outlives a deleted departure, and so does its line.
      .innerJoin(trips, and(eq(trips.id, incidentReports.tripId), notRehearsal()))
      .where(
        and(
          eq(incidentReports.shopId, shopId),
          eq(incidentReports.status, "draft"),
          isNull(incidentReports.deletedAt),
        ),
      )
      .orderBy(asc(incidentReports.createdAt), asc(creators.fullName), asc(incidentReports.id))
  );
}

/** Who filed a report, read by name beside it on the departure log. */
const filers = alias(people, "incident_filers");
/** Who deleted an unfiled draft, read by name on the departure log. */
const deleters = alias(people, "incident_deleters");

/** One report as the departure log lists it: where it stands, never what it says. */
export type DepartureLogIncidentReport = {
  reportId: string;
  status: IncidentReportStatus;
  kind: IncidentKind | null;
  severity: IncidentSeverity | null;
  filedAt: Date | null;
  filedByName: string | null;
  addendaCount: number;
  createdAt: Date;
  createdByName: string;
  /** A draft deleted unfiled, and by whom; null on every other report. */
  deletedAt: Date | null;
  deletedByName: string | null;
};

/**
 * **A departure's reports, for its log** (safety sheet 2026-10-15, item 5),
 * oldest first: kind, severity, when filed and by whom, how many addenda, and
 * who started an unfiled draft. Never what happened, nor who was involved.
 * Only for a reader who may already read every report (owners and managers),
 * re-read live here; anyone else gets null, so the log widens nobody's
 * view. Reads the departure without `liveTrip()`: a report outlives it.
 */
export async function listDepartureLogIncidentReports(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  viewerPersonId: string,
): Promise<DepartureLogIncidentReport[] | null> {
  const roles = await loadActiveStaffRoles(db, shopId, viewerPersonId);
  if (
    !mayReadIncidentReport(
      { personId: viewerPersonId, roles, onCrew: false },
      { createdByPersonId: "" },
    )
  ) {
    // Null, never an empty list: a log built for someone who may not read the
    // list must fail, not say the departure has no reports.
    return null;
  }
  return db
    .select({
      reportId: incidentReports.id,
      status: incidentReports.status,
      kind: incidentReports.kind,
      severity: incidentReports.severity,
      filedAt: incidentReports.filedAt,
      filedByName: filers.fullName,
      addendaCount: sql<number>`(
        select count(*)::int from ${incidentReportAddenda}
        where ${incidentReportAddenda.reportId} = ${incidentReports.id}
      )`,
      createdAt: incidentReports.createdAt,
      createdByName: creators.fullName,
      deletedAt: incidentReports.deletedAt,
      deletedByName: deleters.fullName,
    })
    .from(incidentReports)
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .leftJoin(filers, eq(filers.id, incidentReports.filedByPersonId))
    .leftJoin(deleters, eq(deleters.id, incidentReports.deletedByPersonId))
    .where(and(eq(incidentReports.shopId, shopId), eq(incidentReports.tripId, tripId)))
    .orderBy(asc(incidentReports.createdAt), asc(creators.fullName), asc(incidentReports.id));
}

/**
 * Every report in the shop whose incident falls in `[from, to)` — or, for a
 * draft that does not yet say when, that was started then. Owners and managers
 * only; the caller's gate is re-read here.
 */
export async function listShopIncidentReports(
  db: DbExecutor,
  shopId: string,
  viewerPersonId: string,
  from: Date,
  to: Date,
): Promise<IncidentReportLine[]> {
  const roles = await loadActiveStaffRoles(db, shopId, viewerPersonId);
  if (
    !mayReadIncidentReport(
      { personId: viewerPersonId, roles, onCrew: false },
      {
        createdByPersonId: "",
      },
    )
  ) {
    return [];
  }
  const at = sql`coalesce(${incidentReports.occurredAt}, ${incidentReports.createdAt})`;
  const rows = await db
    .select(LINE_FIELDS)
    .from(incidentReports)
    // diveday:allow-deleted-trips: a report outlives a deleted departure.
    .innerJoin(trips, eq(trips.id, incidentReports.tripId))
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .where(
      and(
        eq(incidentReports.shopId, shopId),
        isNull(incidentReports.deletedAt),
        gte(at, from),
        lt(at, to),
      ),
    )
    .orderBy(desc(at), desc(incidentReports.id));
  return rows.map(toLine);
}

/** The bookings on a departure a draft may name, with the diver's name. */
export async function listIncidentSeatChoices(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ bookingId: string; name: string }[]> {
  const rows = await db
    .select({ bookingId: bookings.id, name: people.fullName })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(people.fullName), asc(bookings.id));
  return rows;
}

/** The departure's crew, first, for naming a staffer; then nobody else is offered. */
export async function listIncidentCrewChoices(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ personId: string; name: string }[]> {
  return db
    .select({ personId: people.id, name: people.fullName })
    .from(tripAssignments)
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(and(eq(tripAssignments.tripId, tripId), eq(people.shopId, shopId)))
    .orderBy(asc(people.fullName), asc(people.id));
}

/**
 * **Clear a shop's departure safety trail**: its incident reports (addenda and
 * people first) and both roll-call trails. Only the demo reset calls this
 * (`resetDemoSchedule`), which wipes the schedule they hang off; nothing a
 * live shop reaches deletes an incident report, which outlives its departure
 * for the retention window (seven years, H-112) instead.
 */
export async function deleteDemoSafetyTrail(db: DbExecutor, shopId: string): Promise<void> {
  await db.delete(incidentReportAddenda).where(eq(incidentReportAddenda.shopId, shopId));
  await db.delete(incidentReportPeople).where(eq(incidentReportPeople.shopId, shopId));
  await db.delete(incidentReports).where(eq(incidentReports.shopId, shopId));
  await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.shopId, shopId));
  await db.delete(rollCallEvents).where(eq(rollCallEvents.shopId, shopId));
}

/**
 * The shop's active staff who are not on this departure's crew, for naming a
 * staffer ashore — the person who took the call, or drove to the clinic.
 * Only staff with an active account; the write re-checks it.
 */
export async function listIncidentShopStaffChoices(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ personId: string; name: string }[]> {
  const crew = await listIncidentCrewChoices(db, shopId, tripId);
  const onCrew = new Set(crew.map((member) => member.personId));
  const rows = await db
    .selectDistinct({ personId: people.id, name: people.fullName })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        inArray(personRoles.role, [...STAFF_ROLES]),
        eq(userAccounts.status, "active"),
      ),
    )
    .orderBy(asc(people.fullName), asc(people.id));
  return rows.filter((row) => !onCrew.has(row.personId));
}
