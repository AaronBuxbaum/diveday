import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seatName } from "@/lib/held-seat";
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
  mayDecideIncidentRecord,
  mayReadIncidentReport,
  mayStartIncidentReport,
  mayWriteIncidentReport,
} from "@/lib/incident-reports";
import { log } from "@/lib/log";
import type { NotificationProvider } from "@/lib/notifications";
import { OFFLINE_EVENT_SKEW_MS } from "@/lib/offline-events";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import {
  type MissingDiverAllClearOutcome,
  sendMissingDiverAlerts,
  sendMissingDiverAllClear,
} from "./missing-diver-alerts";
import {
  affectedSubjects,
  afterDiveEvents,
  backAboard,
  type MissingSubject,
  standingNotBackAboardSince,
  subjectOnDeparture,
} from "./missing-subject";
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

/** A report nobody has discarded: every live read carries this (ADR 20260820-every-delete-is-soft). */
const liveReport = isNull(incidentReports.deletedAt);

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

export type { MissingSubject } from "./missing-subject";
export { standingNotBackAboardSince } from "./missing-subject";

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
  | "too_long"
  | "held"
  /** A draft whose missing-diver alert was raised: the owners were told, so it is kept. */
  | "alerted";

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

export type MissingDiverStart =
  | { ok: true; reportId: string; reused: boolean }
  | { ok: false; reason: IncidentWriteRefusal | "not_missing" }
  /** Somebody else's open report already names them; who started it, nothing more. */
  | { ok: false; reason: "already_started"; startedByName: string }
  /** Somebody else's filed report already names them; who filed it, nothing more. */
  | { ok: false; reason: "already_filed"; filedByName: string };

/**
 * **"Start a missing diver report"** from a manifest row marked not back
 * aboard (safety sheet 2026-10-15, item 2): a diver's seat, or a crew member
 * of the departure (domain review 2026-10-16). One report per missing person:
 *
 * - A **Missing diver report on this departure that already names them as
 *   affected, started during this disappearance**, draft or filed, is the
 *   report, whoever started it (domain re-review 2026-10-16, items 1 and 2).
 *   Its writer, an owner or a manager gets it back, a filed one to add a
 *   note to. Anyone else (a second crew member tapping for the same diver)
 *   is told who started or filed it, and is given neither its contents nor a
 *   second report. "This disappearance" is the standing run of marks: a
 *   report started before the diver was last marked back aboard is about an
 *   earlier one, and a new report is started.
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
    const opened = await openMissingReport(tx, input);
    if (!opened.ok) return opened;
    if (opened.created) return { ok: true, reportId: opened.report.id, reused: false };
    return reuseOrName(tx, input, opened.report);
  });
}

/** The one report for this disappearance, as `openMissingReport` finds it. */
type MissingReportRow = {
  id: string;
  status: IncidentReportStatus;
  createdByPersonId: string;
  createdByName: string;
  filedByName: string | null;
  missingAlertRaisedAt: Date | null;
  missingAlertSentAt: Date | null;
  /** The report's row naming this person as affected. */
  subjectRowId: string;
};

/**
 * `startMissingDiverReport`'s and `raiseMissingDiverAlert`'s shared half:
 * the gate, the standing mark, the lock, and the one report for this
 * disappearance, started as a draft when there is none. Whoever's it is: the
 * caller decides what this viewer is told about it.
 */
async function openMissingReport(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; subject: MissingSubject; actorPersonId: string },
): Promise<
  | { ok: true; report: MissingReportRow; created: boolean }
  | { ok: false; reason: IncidentWriteRefusal | "not_missing" }
> {
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
  const filers = alias(people, "incident_missing_filers");
  const [open] = await tx
    .select({
      id: incidentReports.id,
      status: incidentReports.status,
      createdByPersonId: incidentReports.createdByPersonId,
      createdByName: creators.fullName,
      filedByName: filers.fullName,
      missingAlertRaisedAt: incidentReports.missingAlertRaisedAt,
      missingAlertSentAt: incidentReports.missingAlertSentAt,
      subjectRowId: incidentReportPeople.id,
    })
    .from(incidentReports)
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .leftJoin(filers, eq(filers.id, incidentReports.filedByPersonId))
    .innerJoin(incidentReportPeople, eq(incidentReportPeople.reportId, incidentReports.id))
    .where(
      and(
        eq(incidentReports.shopId, input.shopId),
        eq(incidentReports.tripId, input.tripId),
        eq(incidentReports.kind, "missing_diver"),
        isNull(incidentReports.deletedAt),
        // A report marked found is an earlier disappearance's: Found is
        // refused while the roll call stands not back aboard, so a mark that
        // stands now came after it, or reached the server after it, and is a
        // diver missing again (review 2026-10-17). Never the found report.
        isNull(incidentReports.missingFoundAt),
        // This disappearance's, not an earlier one's the diver came back
        // from. A tablet's clock may run ahead of the server's by the
        // offline skew, so the mark can postdate the report it opened.
        gte(incidentReports.createdAt, new Date(since.getTime() - OFFLINE_EVENT_SKEW_MS)),
        eq(incidentReportPeople.involvement, "affected"),
        subject.kind === "diver"
          ? eq(incidentReportPeople.bookingId, subject.bookingId)
          : eq(incidentReportPeople.personId, subject.personId),
      ),
    )
    // diveday:allow-time-id-order: picks the one report to reopen; nobody is shown this order.
    .orderBy(asc(incidentReports.createdAt), asc(incidentReports.id))
    .limit(1);
  if (open) return { ok: true, report: open, created: false };
  const reportId = await insertDraft(tx, input, { kind: "missing_diver", occurredAt: since });
  if (!reportId) return { ok: false, reason: "not_found" };
  const [row] = await tx
    .insert(incidentReportPeople)
    .values({
      shopId: input.shopId,
      reportId,
      involvement: "affected",
      ...(subject.kind === "diver"
        ? { bookingId: subject.bookingId }
        : { personId: subject.personId }),
    })
    .returning({ id: incidentReportPeople.id });
  if (!row) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    created: true,
    report: {
      id: reportId,
      status: "draft",
      createdByPersonId: input.actorPersonId,
      createdByName: "",
      filedByName: null,
      missingAlertRaisedAt: null,
      missingAlertSentAt: null,
      subjectRowId: row.id,
    },
  };
}

/**
 * An existing report for this disappearance: its writer, an owner or a
 * manager gets it back; anyone else is told who started or filed it, and is
 * given neither its contents nor a second report.
 */
async function reuseOrName(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; actorPersonId: string },
  open: MissingReportRow,
): Promise<MissingDiverStart> {
  const viewer = await loadIncidentViewer(tx, input.shopId, input.tripId, input.actorPersonId);
  if (mayReadIncidentReport(viewer, open)) return { ok: true, reportId: open.id, reused: true };
  if (open.status === "filed") {
    return { ok: false, reason: "already_filed", filedByName: open.filedByName ?? "" };
  }
  return { ok: false, reason: "already_started", startedByName: open.createdByName };
}

export type MissingDiverRaise =
  /**
   * The owners were asked for; `reportId` is the report this viewer may open,
   * when they may. `told` says whether every owner's email went, so the
   * screen never says "alerted" over a send that reached nobody.
   */
  | { ok: true; reportId: string | null; alreadyRaised: boolean; told: boolean }
  | { ok: false; reason: IncidentWriteRefusal | "not_missing" };

/**
 * **"Missing diver, alert owners now"** (issue #2694, decided by Aaron
 * 2026-10-17): one tap on a roll-call row marked not back aboard tells the
 * owners at once, apart from the report, which waits behind about nine
 * fields. The tap also starts the one report for this disappearance, the
 * diver and the time of the mark filled in, exactly as "Start a missing diver
 * report" does, and stamps it raised; the alert then goes by the filed
 * report's path (`sendMissingDiverAlerts`, H-20261016-missing-diver-report-alerts), once per report.
 *
 * - **A double tap is one alert.** The advisory lock on (departure, missing
 *   person) serializes two taps; the second finds the report raised. A report
 *   already filed was alerted by its filing.
 * - **A tap on a report not yet told sends again** (review 2026-10-17): when
 *   no send reached every owner (`missing_alert_sent_at` still null), the
 *   tap is the retry; the send's lease stops two at once. `told` answers
 *   whether the owners have it now.
 * - **Somebody else's report is still raised.** A second crew member's tap
 *   alerts the owners on the first one's report; it is not handed over
 *   (`reportId` null), only named.
 * - **Missing again after Found is a new report and a new alert**: a found
 *   report never answers for a mark that stands now (`openMissingReport`).
 * - Same people as the report button (`mayStartIncidentReport`), same
 *   `not_missing` refusal for a stale tap, and no alert for a rehearsal, a
 *   cancelled departure or a demo shop (the sender's own filter).
 */
export async function raiseMissingDiverAlert(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    subject: MissingSubject;
    actorPersonId: string;
    provider?: NotificationProvider;
  },
): Promise<MissingDiverRaise> {
  const raised = await db.transaction(
    async (tx): Promise<{ result: MissingDiverRaise; send: string | null }> => {
      const opened = await openMissingReport(tx, input);
      if (!opened.ok) return { result: opened, send: null };
      const { report } = opened;
      let alreadyRaised = report.status === "filed" || report.missingAlertRaisedAt !== null;
      if (!alreadyRaised) {
        const now = nowDate();
        const stamped = await tx
          .update(incidentReports)
          .set({
            missingAlertRaisedAt: now,
            missingAlertRaisedByPersonId: input.actorPersonId,
            missingSubjectRowId: report.subjectRowId,
            updatedAt: now,
          })
          .where(
            and(
              eq(incidentReports.id, report.id),
              eq(incidentReports.shopId, input.shopId),
              eq(incidentReports.status, "draft"),
              isNull(incidentReports.missingAlertRaisedAt),
              isNull(incidentReports.missingFoundAt),
              liveReport,
            ),
          )
          .returning({ id: incidentReports.id });
        alreadyRaised = stamped.length === 0;
        if (!alreadyRaised) {
          await recordTripActivity(tx, {
            shopId: input.shopId,
            tripId: input.tripId,
            actorPersonId: input.actorPersonId,
            entry: { code: "missing_diver_alert_raised" },
          });
        }
      }
      const reuse = opened.created
        ? { ok: true as const, reportId: report.id }
        : await reuseOrName(tx, input, report);
      return {
        result: {
          ok: true,
          reportId: reuse.ok ? reuse.reportId : null,
          alreadyRaised,
          told: report.missingAlertSentAt !== null,
        },
        // A first raise sends; so does a re-tap on a report nobody was told of.
        send: report.missingAlertSentAt === null ? report.id : null,
      };
    },
  );
  const { result } = raised;
  if (!result.ok || !raised.send) return result;
  // After the commit, as filing does: the send never undoes the raise, and a
  // failed send is given back for the next tap or the hourly pass.
  try {
    await sendMissingDiverAlerts(db, { reportId: raised.send, provider: input.provider });
  } catch {
    log("incident.missing_diver_alert_failed", "error", { tripId: input.tripId });
  }
  return { ...result, told: await ownersTold(db, input.shopId, raised.send) };
}

/** Whether every owner's email for this report's alert went (`missing_alert_sent_at`). */
async function ownersTold(db: DbExecutor, shopId: string, reportId: string): Promise<boolean> {
  const [row] = await db
    .select({ sentAt: incidentReports.missingAlertSentAt })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, reportId), eq(incidentReports.shopId, shopId)))
    .limit(1);
  return row?.sentAt != null;
}

export type MissingDiverFound =
  /** `allClear` is what the all-clear really did on this tap ("skipped" when nobody was owed one). */
  | { ok: true; changed: boolean; allClear: MissingDiverAllClearOutcome | null }
  | { ok: false; reason: IncidentWriteRefusal | "not_alerted" | "still_missing" };

/**
 * **The diver was found** (issue #2694, decided by Aaron 2026-10-17): the
 * addendum that sends one quiet all-clear to the owners the alert told. On a
 * missing-diver report whose alert was raised or filed.
 *
 * - **Never over the roll call** (review 2026-10-17): refused as
 *   `still_missing` unless the roll call has every person the report names as
 *   affected back (`backAboard`): a `cleared` undo is not back aboard. "Mark back aboard" first; one
 *   wrong tap cannot silence a live disappearance.
 * - **Any of the departure's crew**, as well as the report's own readers:
 *   the people at the rail are the ones who see the diver surface.
 * - Recorded once; a second tap stamps nothing and sends only an all-clear
 *   that failed before (at most one success per owner). It stops
 *   any alert not yet sent. The all-clear is email only, no push, at most
 *   once (`sendMissingDiverAllClear`).
 */
export async function markMissingDiverFound(
  db: AppDb,
  input: WriteTarget & { provider?: NotificationProvider },
): Promise<MissingDiverFound> {
  const found = await db.transaction(async (tx): Promise<MissingDiverFound> => {
    const { report, allowed, viewer } = await lockForWrite(tx, input);
    if (!report || !viewer || !(allowed || mayStartIncidentReport(viewer))) {
      return { ok: false, reason: "not_found" };
    }
    if (report.kind !== "missing_diver") return { ok: false, reason: "not_alerted" };
    if (report.status !== "filed" && report.missingAlertRaisedAt === null) {
      return { ok: false, reason: "not_alerted" };
    }
    // Already found: no new stamp, but the tap retries any owner whose
    // all-clear failed (#2828).
    if (report.missingFoundAt !== null) return { ok: true, changed: false, allClear: null };
    const subjects = await affectedSubjects(tx, input.shopId, input.reportId);
    for (const subject of subjects) {
      const target = { shopId: input.shopId, tripId: report.tripId, subject };
      if (!backAboard(await afterDiveEvents(tx, target))) {
        return { ok: false, reason: "still_missing" };
      }
    }
    const now = nowDate();
    const stamped = await tx
      .update(incidentReports)
      .set({ missingFoundAt: now, missingFoundByPersonId: input.actorPersonId, updatedAt: now })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          isNull(incidentReports.missingFoundAt),
        ),
      )
      .returning({ id: incidentReports.id });
    // The row lock above already serializes two taps; this says so twice.
    if (stamped.length === 0) return { ok: true, changed: false, allClear: null };
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "missing_diver_found" },
    });
    return { ok: true, changed: true, allClear: null };
  });
  if (found.ok) {
    // What the all-clear really did, so the reply never claims more.
    let allClear: MissingDiverAllClearOutcome = "skipped";
    try {
      allClear = await sendMissingDiverAllClear(db, {
        shopId: input.shopId,
        reportId: input.reportId,
        provider: input.provider,
      });
    } catch {
      log("incident.missing_diver_all_clear_failed", "error", { reportId: input.reportId });
    }
    return { ...found, allClear };
  }
  return found;
}

/**
 * **Found from the roll-call row** (review 2026-10-17): the same Found, for
 * the open alerted report naming this diver or crew member as affected on
 * this departure. `not_alerted` when there is none.
 */
export async function markMissingSubjectFound(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    subject: MissingSubject;
    actorPersonId: string;
    provider?: NotificationProvider;
  },
): Promise<MissingDiverFound> {
  const open = (await openMissingAlerts(db, input.shopId, input.tripId)).find((row) =>
    input.subject.kind === "diver"
      ? row.bookingId === input.subject.bookingId
      : row.personId === input.subject.personId,
  );
  if (!open) return { ok: false, reason: "not_alerted" };
  return markMissingDiverFound(db, { ...input, reportId: open.reportId });
}

export type OpenMissingAlert = {
  reportId: string;
  bookingId: string | null;
  personId: string | null;
};

/**
 * The people on this departure an alert was raised or filed for and who are
 * not marked found yet: the manifest offers Found on their rows. Newest
 * report first per person.
 */
export async function openMissingAlerts(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<OpenMissingAlert[]> {
  return (
    db
      .select({
        reportId: incidentReports.id,
        bookingId: incidentReportPeople.bookingId,
        personId: incidentReportPeople.personId,
      })
      .from(incidentReports)
      .innerJoin(incidentReportPeople, eq(incidentReportPeople.reportId, incidentReports.id))
      .where(
        and(
          eq(incidentReports.shopId, shopId),
          eq(incidentReports.tripId, tripId),
          eq(incidentReports.kind, "missing_diver"),
          or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
          isNull(incidentReports.missingFoundAt),
          liveReport,
          eq(incidentReportPeople.involvement, "affected"),
        ),
      )
      // diveday:allow-time-id-order: picks the newest open report per person; nobody is shown this order.
      .orderBy(desc(incidentReports.createdAt), asc(incidentReports.id))
  );
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
      legalHoldAt: incidentReports.legalHoldAt,
      missingAlertRaisedAt: incidentReports.missingAlertRaisedAt,
      missingFoundAt: incidentReports.missingFoundAt,
      missingSubjectRowId: incidentReports.missingSubjectRowId,
    })
    .from(incidentReports)
    // A discarded draft is gone to every write, as a report that never existed.
    .where(and(eq(incidentReports.id, reportId), eq(incidentReports.shopId, shopId), liveReport))
    .limit(1)
    .for("update");
  // A report reached under another departure's address is not this report.
  if (!report || report.tripId !== tripId) {
    return { report: null, allowed: false, viewer: null } as const;
  }
  const viewer = await loadIncidentViewer(db, shopId, report.tripId, actorPersonId);
  return { report, allowed: mayWriteIncidentReport(viewer, report), viewer } as const;
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
        // The owners were told a diver is missing (issue #2694): the report
        // stays one, and a false alarm is answered by "Found", never by a
        // changed kind. The database holds this too.
        kind: report.missingAlertRaisedAt !== null ? "missing_diver" : fields.kind,
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
  input: WriteTarget & { provider?: NotificationProvider },
): Promise<
  | { ok: true }
  | { ok: false; reason: Exclude<IncidentWriteRefusal, "incomplete"> }
  | { ok: false; reason: "incomplete"; gaps: IncidentFilingGap[] }
> {
  let missingDiver = false;
  const filed = await db.transaction(async (tx) => {
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
    missingDiver = report.kind === "missing_diver";
    return { ok: true } as const;
  });
  // A report of a missing diver tells the owners at once (H-20261016-missing-diver-report-alerts). After the
  // commit, and never able to undo it: a failed send is given back and the
  // hourly pass tries again.
  if (filed.ok && missingDiver) {
    try {
      await sendMissingDiverAlerts(db, { reportId: input.reportId, provider: input.provider });
    } catch {
      log("incident.missing_diver_alert_failed", "error", { reportId: input.reportId });
    }
  }
  return filed;
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

/**
 * **Discard a draft that should never have been started** (a wrong departure,
 * a slip of the thumb). An owner only. It is the one way a report leaves the
 * product's screens, so what it refuses is the point:
 *
 * - **a filed report**, by any path: the code refuses it here and the
 *   database refuses it too (`incident_reports_only_a_draft_is_discarded`);
 * - **a held report**, until the hold is released;
 * - **anyone but an owner**, including the draft's own author and a manager.
 *
 * The delete is soft (`deleted_at`): the row, its people and its text stay in
 * the table until the seven-year prune takes them, and no screen reads it. The
 * departure's activity trail says who discarded one, with none of its words.
 * Somebody who could not read the report is told it does not exist.
 */
export async function discardIncidentDraft(
  db: AppDb,
  input: WriteTarget,
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed, viewer } = await lockForWrite(tx, input);
    if (!report || !allowed || !viewer) return { ok: false, reason: "not_found" } as const;
    if (!mayDecideIncidentRecord(viewer)) return { ok: false, reason: "not_allowed" } as const;
    if (report.status !== "draft") return { ok: false, reason: "filed" } as const;
    if (report.legalHoldAt !== null) return { ok: false, reason: "held" } as const;
    // The owners were told about it (issue #2694): it stays on the record.
    if (report.missingAlertRaisedAt !== null) return { ok: false, reason: "alerted" } as const;
    await tx
      .update(incidentReports)
      .set({ deletedAt: nowDate(), deletedByPersonId: input.actorPersonId })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.status, "draft"),
          isNull(incidentReports.legalHoldAt),
          liveReport,
        ),
      );
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "incident_draft_discarded" },
    });
    return { ok: true } as const;
  });
}

/**
 * **Put a legal hold on a report, or release it.** An owner only. The
 * seven-year prune skips a held report (`PRUNE_ARMS.incident_reports`); a held
 * report cannot be discarded. Setting a hold that is set, or releasing one that
 * is not, changes nothing and writes no trail line.
 */
export async function setIncidentLegalHold(
  db: AppDb,
  input: WriteTarget & { held: boolean },
): Promise<{ ok: true } | { ok: false; reason: IncidentWriteRefusal }> {
  return db.transaction(async (tx) => {
    const { report, allowed, viewer } = await lockForWrite(tx, input);
    if (!report || !allowed || !viewer) return { ok: false, reason: "not_found" } as const;
    if (!mayDecideIncidentRecord(viewer)) return { ok: false, reason: "not_allowed" } as const;
    if ((report.legalHoldAt !== null) === input.held) return { ok: true } as const;
    await tx
      .update(incidentReports)
      .set({ legalHoldAt: input.held ? nowDate() : null })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          liveReport,
        ),
      );
    await recordTripActivity(tx, {
      shopId: input.shopId,
      tripId: report.tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: input.held ? "incident_legal_hold_set" : "incident_legal_hold_released" },
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
    // The person the owners were told is missing stays on the report (review
    // 2026-10-17); the foreign key on `missing_subject_row_id` refuses too.
    if (report.missingSubjectRowId === input.rowId) {
      return { ok: false, reason: "alerted" } as const;
    }
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
  /** Whether an owner has put a legal hold on it (retention skips it). */
  legalHold: boolean;
  /** Whether this viewer may discard the draft or set or release the hold: owners. */
  mayDecide: boolean;
  /**
   * For a report of a missing diver whose alert was filed (H-20261016-missing-diver-report-alerts) or raised
   * from the roll call (issue #2694): when every owner's email was sent, or
   * `null` while they are not all told yet; and when the diver was marked
   * found, and by whom.
   */
  ownersAlert: {
    sentAt: Date | null;
    foundAt: Date | null;
    foundByName: string | null;
    /**
     * The all-clear after Found: sent to every owner, claimed but not reaching
     * every owner, or never sent (a demo shop, no public origin). Null before
     * Found.
     */
    allClear: { state: "sent"; sentAt: Date } | { state: "partial" | "none" } | null;
  } | null;
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
  const finders = alias(people, "incident_finders");
  const [row] = await db
    .select({
      report: incidentReports,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      siteName: diveSites.name,
      createdByName: creators.fullName,
      filedByName: filers.fullName,
      foundByName: finders.fullName,
    })
    .from(incidentReports)
    // diveday:allow-deleted-trips: a report outlives a deleted departure.
    .innerJoin(trips, and(eq(trips.id, incidentReports.tripId), eq(trips.shopId, shopId)))
    .innerJoin(creators, eq(creators.id, incidentReports.createdByPersonId))
    .leftJoin(filers, eq(filers.id, incidentReports.filedByPersonId))
    .leftJoin(finders, eq(finders.id, incidentReports.missingFoundByPersonId))
    .leftJoin(diveSites, eq(diveSites.id, incidentReports.diveSiteId))
    .where(and(eq(incidentReports.id, reportId), eq(incidentReports.shopId, shopId), liveReport))
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
          identityUnconfirmedAt: bookings.identityUnconfirmedAt,
          identityBookedAs: bookings.identityBookedAs,
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
          sql`coalesce(${heldSeatName(seatPeople.fullName)}, ${people.fullName}, ${incidentReportPeople.outsiderName})`,
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
      // A held seat by the name it was booked as (issue #2128): the person it
      // was matched to may be somebody else.
      name:
        (person.seatName !== null ? seatName(person.seatName, person) : null) ??
        person.staffName ??
        person.outsiderName ??
        "",
      involvement: person.involvement,
    })),
    addenda: addendumRows,
    mayWrite: mayWriteIncidentReport(viewer, report),
    legalHold: report.legalHoldAt !== null,
    mayDecide: mayDecideIncidentRecord(viewer),
    ownersAlert:
      report.kind === "missing_diver" &&
      (report.status === "filed" || report.missingAlertRaisedAt !== null)
        ? {
            sentAt: report.missingAlertSentAt,
            foundAt: report.missingFoundAt,
            foundByName: report.missingFoundAt ? (row.foundByName ?? null) : null,
            allClear: !report.missingFoundAt
              ? null
              : report.missingAllClearSentAt
                ? { state: "sent", sentAt: report.missingAllClearSentAt }
                : { state: report.missingAllClearClaimedAt ? "partial" : "none" },
          }
        : null,
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
        liveReport,
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
    .where(and(eq(incidentReports.shopId, shopId), liveReport, gte(at, from), lt(at, to)))
    .orderBy(desc(at), desc(incidentReports.id));
  return rows.map(toLine);
}

/**
 * A seat's name in SQL, as `seatName` gives it: a held seat (issue #2128) by
 * the name it was booked as, any other by the person on it. Reads `bookings`.
 */
function heldSeatName(fullName: AnyColumn) {
  return sql<string>`case when ${bookings.identityUnconfirmedAt} is not null then coalesce(nullif(btrim(${bookings.identityBookedAs}), ''), ${fullName}) else ${fullName} end`;
}

/** The bookings on a departure a draft may name, with the diver's name, a held seat's as booked. */
export async function listIncidentSeatChoices(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ bookingId: string; name: string }[]> {
  const name = heldSeatName(people.fullName);
  return db
    .select({ bookingId: bookings.id, name })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(name), asc(bookings.id));
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
 * for the retention window (seven years, H-20261013-incident-report-retention) instead.
 */
export async function deleteDemoSafetyTrail(db: DbExecutor, shopId: string): Promise<void> {
  await db.delete(incidentReportAddenda).where(eq(incidentReportAddenda.shopId, shopId));
  // Each report takes its people rows with it (cascade): a raised report
  // points at its subject's row, so that row cannot go first.
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
