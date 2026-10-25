import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { notificationTripTitle } from "@/lib/notifications/kinds";
import { shopPath } from "@/lib/staff-notices";
import type { AppDb } from "./client";
import { affectedSubjects, rollCallHasThemBack } from "./missing-subject";
import { sendNotification } from "./notifications";
import { ownerLogins } from "./owner-logins";
import { pushTripAlert } from "./push-subscriptions";
import { incidentReports, people, shops, trips, userAccounts } from "./schema";
import { livePerson, liveTrip, notRehearsal } from "./trips-live";

/**
 * **A filed report of a missing diver tells the owners at once** (H-142,
 * decided 2026-10-16; the stale roll-call alert it rides beside is H-118,
 * `src/db/roll-call-alerts.ts`). Whoever filed the report chose "missing
 * diver" on purpose, so the shop does not wait for the roll call to go stale:
 * every active owner gets one email, and the devices following the
 * departure's manifest one push, for each report.
 *
 * The same recipients as the stale alert, re-read live at send time
 * (`ownerLogins`, `pushTripAlert`): a demoted owner, a disabled login or a
 * follower who left hears nothing. The shop's shore contact is not included:
 * their consent was given for the stale roll-call alert (H-118) and this is
 * not that message.
 *
 * **Counts nothing, names nobody.** The mail says a missing diver was reported
 * on this departure and when it happened, with a link to the report behind the
 * staff sign-in and one to the emergency reference; the report is personal and
 * medical data.
 *
 * **Told means every owner's email was sent.** A push is an extra and never
 * counts: a report whose owners were not all emailed is tried again, for the
 * owners not reached yet. Each sent email writes its owner into
 * `missing_alert_reached_person_ids` at once (issue #2828), which is what a
 * retry skips and what the all-clear is sent to. The pass takes a report under
 * a lease (`missing_alerted_at`, a conditional update, so two passes never
 * send at once) and writes `missing_alert_sent_at` only when every current
 * owner has been reached. A failure gives
 * the lease back at once; a crash leaves it to run out
 * (`MISSING_DIVER_LEASE_MS`), so no failure loses the alert. Filing a report
 * calls this for that report; the hourly crew-notices pass calls it for every
 * filed report of the last few hours, which is the retry, and says so to the
 * cron monitor when one stays unalerted (`overdue`).
 *
 * **Raised from the roll call, or filed** (issue #2694): "Missing diver, alert
 * owners now" stamps a draft `missing_alert_raised_at`, and it is told exactly
 * as a filed report is, from the raise; filing it afterwards sends nothing
 * new. A report marked found (`missing_found_at`) is never told: a found diver
 * must not wake anybody. Its all-clear is `sendMissingDiverAllClear` below.
 *
 * A report of something that happened long before it was filed
 * (`MISSING_DIVER_PUSH_STALE_MS`), or filed a while ago, goes by email only: a
 * push to the whole manifest's followers is for a diver who may be missing now.
 * Never for a rehearsal, a cancelled departure or a demo shop, and never for a
 * report that is a draft, discarded, or any other kind.
 */

/** How far back the hourly pass looks for a filed report whose owners were never told. */
export const MISSING_DIVER_ALERT_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** How long a pass holds a report before another may take it: past any send, short of the cron. */
export const MISSING_DIVER_LEASE_MS = 10 * 60 * 1000;

/** An incident this long before the report was filed is history, not an emergency: email only. */
export const MISSING_DIVER_PUSH_STALE_MS = 6 * 60 * 60 * 1000;

/** The push goes with the first sends only; a retry later than this emails alone. */
export const MISSING_DIVER_PUSH_WINDOW_MS = 15 * 60 * 1000;

/** The hourly pass retries an all-clear still owed to an owner for this long after Found. */
export const ALL_CLEAR_RETRY_MS = 24 * 60 * 60 * 1000;

/** How long an all-clear run holds the report before another may take it. */
export const ALL_CLEAR_LEASE_MS = 10 * 60 * 1000;

/** A filed report still not sent this long after filing is told to the cron monitor. */
export const MISSING_DIVER_OVERDUE_MS = 30 * 60 * 1000;

export type MissingDiverAlertSummary = {
  checked: number;
  /** Reports whose owners this pass told. */
  alerted: number;
  emails: number;
  pushes: number;
  /** Leases given back because an owner email, or all of them, did not go. */
  released: number;
  /** Reports still not told, filed longer ago than `MISSING_DIVER_OVERDUE_MS`. */
  overdue: number;
  /** Found reports whose all-clear this pass tried again for owners still owed one. */
  allClearsRetried: number;
};

export async function sendMissingDiverAlerts(
  db: AppDb,
  input: {
    /** Only this report: the one just filed. Omitted, every filed report of the lookback. */
    reportId?: string;
    now?: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  } = {},
): Promise<MissingDiverAlertSummary> {
  const now = input.now ?? nowDate();
  const summary: MissingDiverAlertSummary = {
    checked: 0,
    alerted: 0,
    emails: 0,
    pushes: 0,
    released: 0,
    overdue: 0,
    allClearsRetried: 0,
  };
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  const leaseEnds = new Date(now.getTime() - MISSING_DIVER_LEASE_MS);
  const notLeased = or(
    isNull(incidentReports.missingAlertedAt),
    lte(incidentReports.missingAlertedAt, leaseEnds),
  );
  const lookbackFrom = new Date(now.getTime() - MISSING_DIVER_ALERT_LOOKBACK_MS);
  const due = await db
    .select({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      tripTitle: trips.title,
      filedAt: incidentReports.filedAt,
      raisedAt: incidentReports.missingAlertRaisedAt,
      occurredAt: incidentReports.occurredAt,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(incidentReports)
    .innerJoin(
      trips,
      and(eq(trips.id, incidentReports.tripId), eq(trips.shopId, incidentReports.shopId)),
    )
    .innerJoin(shops, eq(shops.id, incidentReports.shopId))
    .where(
      and(
        input.reportId ? eq(incidentReports.id, input.reportId) : undefined,
        alertStands,
        isNull(incidentReports.missingAlertSentAt),
        notLeased,
        or(
          gte(incidentReports.filedAt, lookbackFrom),
          gte(incidentReports.missingAlertRaisedAt, lookbackFrom),
        ),
        liveTrip(),
        // A cancelled departure never pages (as the stale roll-call alert).
        eq(trips.status, "scheduled"),
        // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures).
        notRehearsal(),
        // A demo shop's owner's address is anybody's.
        eq(shops.isDemo, false),
      ),
    );
  summary.checked = due.length;
  const overdueBefore = new Date(now.getTime() - MISSING_DIVER_OVERDUE_MS);
  const isOverdue = (startedAt: Date | null) => startedAt !== null && startedAt <= overdueBefore;
  if (!origin) {
    // Nothing can be linked, so nothing is sent: said loudly, because a filed
    // report is waiting on it. Counts only, never a name.
    if (due.length > 0)
      log("incident.missing_diver_alert_no_origin", "error", { reports: due.length });
    summary.overdue = due.filter((report) => isOverdue(alertStartedAt(report))).length;
    return summary;
  }
  let failure: unknown;

  for (const report of due) {
    // Raised from the roll call, and the roll call has them back since
    // (review 2026-10-17): nobody is paged for a diver already aboard.
    if (report.raisedAt) {
      const subjects = await affectedSubjects(db, report.shopId, report.id);
      if (await rollCallHasThemBack(db, { ...report, subjects })) continue;
    }
    const claimed = await db
      .update(incidentReports)
      .set({ missingAlertedAt: now })
      .where(
        and(
          eq(incidentReports.id, report.id),
          eq(incidentReports.shopId, report.shopId),
          alertStands,
          isNull(incidentReports.missingAlertSentAt),
          notLeased,
        ),
      )
      .returning({ id: incidentReports.id });
    if (claimed.length === 0) continue;
    let ownersTold = false;
    try {
      const reportPath = shopPath(report.slug, "trips", report.tripId, "incidents", report.id);
      const emergencyPath = shopPath(report.slug, "settings", "emergency-reference");
      // `trips.title` is unbounded and the kind caps it: clipped here, so a
      // long title shortens the subject rather than failing every send.
      const tripTitle = notificationTripTitle(report.tripTitle);
      const owners = await ownerLogins(db, report.shopId);
      // Who an earlier pass already reached (issue #2828): a retry pages only
      // the owners it has not, so nobody gets the alarm twice.
      const reached = new Set(await reachedPersonIds(db, report));
      for (const owner of owners) {
        if (reached.has(owner.personId)) continue;
        // Found meanwhile: no owner gets the alarm after the all-clear.
        if (await foundSince(db, report)) break;
        // Written down before the send (#2828): if this process dies before
        // the outcome is recorded, the all-clear still goes to this owner.
        await markAttempting(db, report, owner.personId);
        const delivery = await sendNotification(
          db,
          {
            kind: "incident_missing_diver",
            shopId: report.shopId,
            personId: owner.personId,
            tripId: report.tripId,
            incidentReportId: report.id,
            to: owner.email,
            locale: recipientLocale(owner.locale, report.defaultLocale),
            recipientName: owner.fullName,
            shopName: report.shopName,
            tripTitle,
            reportedAt: report.occurredAt ?? alertStartedAt(report) ?? now,
            timezone: report.timezone,
            reportUrl: `${origin}${reportPath}`,
            emergencyUrl: `${origin}${emergencyPath}`,
          },
          input.provider,
        );
        const sent = delivery.status === "sent";
        if (sent) {
          summary.emails += 1;
          reached.add(owner.personId);
        }
        await recordOutcome(db, report, owner.personId, sent, {
          origin,
          provider: input.provider,
        });
      }
      ownersTold = owners.length > 0 && owners.every((owner) => reached.has(owner.personId));
      // Found meanwhile: the boat's followers are not woken for a diver already found.
      if (withinPushWindow(report, now) && !(await foundSince(db, report))) {
        const pushes = await pushTripAlert(db, report.shopId, report.tripId, {
          url: reportPath,
          words: (t) => ({
            title: t("manifest.missingDiverAlert.pushTitle"),
            body: t("manifest.missingDiverAlert.pushBody", { title: tripTitle }),
          }),
        });
        summary.pushes += pushes;
      }
    } catch (error) {
      // The next report still gets its pass; the throw reaches the caller
      // once the pass is done.
      failure ??= error;
    } finally {
      if (ownersTold) {
        await db
          .update(incidentReports)
          .set({ missingAlertSentAt: now })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.missingAlertedAt, now)));
        summary.alerted += 1;
      } else {
        await db
          .update(incidentReports)
          .set({ missingAlertedAt: null })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.missingAlertedAt, now)));
        summary.released += 1;
        if (isOverdue(alertStartedAt(report))) summary.overdue += 1;
      }
    }
  }
  // The all-clear's retry (#2828): a found report still owing an owner theirs.
  if (!input.reportId) {
    const owing = await db
      .select({ id: incidentReports.id, shopId: incidentReports.shopId })
      .from(incidentReports)
      .where(
        and(
          eq(incidentReports.kind, "missing_diver"),
          isNotNull(incidentReports.missingAllClearClaimedAt),
          isNull(incidentReports.missingAllClearSentAt),
          isNull(incidentReports.deletedAt),
          gte(incidentReports.missingFoundAt, new Date(now.getTime() - ALL_CLEAR_RETRY_MS)),
        ),
      );
    for (const report of owing) {
      try {
        await sendMissingDiverAllClear(db, {
          shopId: report.shopId,
          reportId: report.id,
          now,
          origin,
          provider: input.provider,
        });
        summary.allClearsRetried += 1;
      } catch (error) {
        failure ??= error;
      }
    }
  }
  // Ids and counts only — never a name or an address.
  log("incident.missing_diver_alert_pass", "info", summary);
  if (failure !== undefined) throw failure;
  return summary;
}

/**
 * A report whose owners are owed the alert: a missing-diver report, filed or
 * raised from the roll call, not discarded, not found.
 */
const alertStands = and(
  eq(incidentReports.kind, "missing_diver"),
  or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
  isNull(incidentReports.deletedAt),
  isNull(incidentReports.missingFoundAt),
);

/** Whether the report was marked found since this pass took it. */
async function foundSince(db: AppDb, report: { id: string; shopId: string }): Promise<boolean> {
  const [row] = await db
    .select({ foundAt: incidentReports.missingFoundAt })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
    .limit(1);
  return row?.foundAt != null;
}

/** The owners an earlier send of this report's alarm reached (`missing_alert_reached_person_ids`). */
async function reachedPersonIds(
  db: AppDb,
  report: { id: string; shopId: string },
): Promise<string[]> {
  const [row] = await db
    .select({ reached: incidentReports.missingAlertReachedPersonIds })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
    .limit(1);
  return row?.reached ?? [];
}

/** Append one id to a jsonb id set, once (`case when col @> [id] ...`). */
function withId(column: typeof incidentReports.missingAlertReachedPersonIds, personId: string) {
  const one = JSON.stringify([personId]);
  return sql`case when ${column} @> ${one}::jsonb then ${column} else ${column} || ${one}::jsonb end`;
}

/** Take one id out of a jsonb id set. */
function withoutId(column: typeof incidentReports.missingAlertReachedPersonIds, personId: string) {
  return sql`${column} - ${personId}::text`;
}

/** Before an owner's alarm email: they are being told, outcome unknown until recorded. */
async function markAttempting(
  db: AppDb,
  report: { id: string; shopId: string },
  personId: string,
): Promise<void> {
  await db
    .update(incidentReports)
    .set({
      missingAlertAttemptingPersonIds: withId(
        incidentReports.missingAlertAttemptingPersonIds,
        personId,
      ),
    })
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
}

/**
 * **Write down how this owner's alarm went** (issue #2828), the moment it
 * did: sent moves them from attempting to reached; a failure the provider
 * reported takes them out, so the all-clear never goes to an owner known not
 * to have been told. A write that fails here leaves them attempting, which
 * the all-clear treats as told.
 *
 * Then, if the diver is already found, the all-clear runs: it sends to every
 * owner still owed one, this one included, or, if another run holds it, that
 * run looks again before it lets go (`sendMissingDiverAllClear`). Either way
 * an owner who saw the alarm is never left without the all-clear because the
 * two crossed.
 */
async function recordOutcome(
  db: AppDb,
  report: { id: string; shopId: string },
  personId: string,
  sent: boolean,
  send: { origin: string; provider?: NotificationProvider },
): Promise<void> {
  let foundAt: Date | null = null;
  try {
    const [row] = await db
      .update(incidentReports)
      .set({
        missingAlertAttemptingPersonIds: withoutId(
          incidentReports.missingAlertAttemptingPersonIds,
          personId,
        ),
        ...(sent
          ? {
              missingAlertReachedPersonIds: withId(
                incidentReports.missingAlertReachedPersonIds,
                personId,
              ),
            }
          : {}),
      })
      .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
      .returning({ foundAt: incidentReports.missingFoundAt });
    foundAt = row?.foundAt ?? null;
  } catch (error) {
    // Left attempting, so the all-clear still counts them told. Loud: the
    // record of who heard the alarm is short of the truth.
    log("incident.missing_diver_alert_unrecorded", "error", { reportId: report.id, personId });
    throw error;
  }
  if (!foundAt) return;
  await sendMissingDiverAllClear(db, {
    shopId: report.shopId,
    reportId: report.id,
    origin: send.origin,
    provider: send.provider,
  });
}

/** When the alert was first asked for: the raise from the roll call, or else the filing. */
function alertStartedAt(report: { filedAt: Date | null; raisedAt: Date | null }): Date | null {
  return report.raisedAt ?? report.filedAt;
}

/** A push is for a diver who may be missing now: a recent raise or filing of a recent incident. */
function withinPushWindow(
  report: { filedAt: Date | null; raisedAt: Date | null; occurredAt: Date | null },
  now: Date,
): boolean {
  const startedAt = alertStartedAt(report);
  if (!startedAt || !report.occurredAt) return false;
  if (now.getTime() - startedAt.getTime() > MISSING_DIVER_PUSH_WINDOW_MS) return false;
  return startedAt.getTime() - report.occurredAt.getTime() <= MISSING_DIVER_PUSH_STALE_MS;
}

export type MissingDiverAllClearOutcome = "sent" | "partial" | "skipped";

/**
 * **One quiet all-clear per owner** (issue #2694, decided by Aaron
 * 2026-10-17): when a missing diver is marked found, each owner the alarm
 * reached gets one email saying the diver reported missing on this departure
 * was found, and when, and how many are still reported missing on it (a
 * count, never a name). Email only: no push wakes the boat's followers, who
 * are the ones who found them.
 *
 * **Who is owed one** (issue #2828, H-142 amendment 2026-10-24): the owners
 * the alarm reached (`missing_alert_reached_person_ids`) and any whose send
 * never reported back (`missing_alert_attempting_person_ids`, the process
 * died mid-send), never one whose send is known to have failed, and never
 * the owner list as it stands at Found. An alarm told by an older build that
 * wrote nobody down (`missing_alert_sent_at` set, both sets empty) falls back
 * to the shop's active owners, logged. Of those, only people the shop still
 * lets it reach are sent to (`reachedLogins`). An alarm that reached nobody
 * has no all-clear.
 *
 * **At most one per owner, and retried until each has theirs.** One run at a
 * time under a lease (`missing_all_clear_leased_at`); each sent email appends
 * its owner to `missing_all_clear_sent_person_ids`, which every later run
 * skips. A second Found tap and the hourly pass call this again, so an owner
 * whose all-clear failed gets it later. Letting go of the lease, a run looks
 * once more for an owner who joined the set meanwhile (an alarm that went out
 * as the diver was found) and takes the lease back if there is one.
 * `missing_all_clear_sent_at` is set only while nobody is owed one, and
 * cleared when somebody is again, so the report never reads "sent" over an
 * owner who heard nothing. A failed send is logged as an error. Never for a
 * rehearsal or a demo shop, which are never alerted; a departure cancelled or
 * removed since the alarm still gets it.
 */
export async function sendMissingDiverAllClear(
  db: AppDb,
  input: {
    shopId: string;
    reportId: string;
    now?: Date;
    origin?: string | null;
    provider?: NotificationProvider;
  },
): Promise<MissingDiverAllClearOutcome> {
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  let outcome: MissingDiverAllClearOutcome = "skipped";
  // Each owner one try per call: a failure waits for the next call.
  const tried = new Set<string>();
  for (;;) {
    const now = input.now ?? nowDate();
    const leaseEnds = new Date(now.getTime() - ALL_CLEAR_LEASE_MS);
    const [report] = await db
      .update(incidentReports)
      .set({
        missingAllClearLeasedAt: now,
        missingAllClearClaimedAt: sql`coalesce(${incidentReports.missingAllClearClaimedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(incidentReports.id, input.reportId),
          eq(incidentReports.shopId, input.shopId),
          eq(incidentReports.kind, "missing_diver"),
          or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
          isNotNull(incidentReports.missingFoundAt),
          isNull(incidentReports.deletedAt),
          or(
            isNull(incidentReports.missingAllClearLeasedAt),
            lte(incidentReports.missingAllClearLeasedAt, leaseEnds),
          ),
        ),
      )
      .returning({ id: incidentReports.id, shopId: incidentReports.shopId });
    if (!report) return outcome;
    let owed: string[] = [];
    try {
      owed = await owedAllClear(db, report);
      const pending = owed.filter((personId) => !tried.has(personId));
      if (pending.length > 0) {
        for (const personId of pending) tried.add(personId);
        const sent = await sendAllClearTo(db, {
          report,
          personIds: pending,
          origin,
          provider: input.provider,
        });
        if (sent === null) return "skipped";
        owed = await owedAllClear(db, report);
      }
      // A call that tried nobody leaves the report as it reads.
      if (tried.size > 0) {
        outcome = owed.length === 0 ? "sent" : "partial";
        await db
          .update(incidentReports)
          .set({ missingAllClearSentAt: owed.length === 0 ? nowDate() : null })
          .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
      }
    } finally {
      await db
        .update(incidentReports)
        .set({ missingAllClearLeasedAt: null })
        .where(
          and(eq(incidentReports.id, report.id), eq(incidentReports.missingAllClearLeasedAt, now)),
        );
    }
    // Let go, then look once more: an owner who joined the set while this run
    // held the lease found it taken and left them to this run.
    const after = await owedAllClear(db, report);
    if (!after.some((personId) => !tried.has(personId))) return outcome;
  }
}

/**
 * The owners still owed this report's all-clear, among those the shop still
 * lets it reach: reached or attempting, minus those already sent theirs. The
 * legacy fallback (told, nobody written down) is written back as the reached
 * set, so it is decided once.
 */
async function owedAllClear(db: AppDb, report: { id: string; shopId: string }): Promise<string[]> {
  const [row] = await db
    .select({
      sentAt: incidentReports.missingAlertSentAt,
      reached: incidentReports.missingAlertReachedPersonIds,
      attempting: incidentReports.missingAlertAttemptingPersonIds,
      cleared: incidentReports.missingAllClearSentPersonIds,
    })
    .from(incidentReports)
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
    .limit(1);
  if (!row) return [];
  let told = [...new Set([...row.reached, ...row.attempting])];
  if (told.length === 0 && row.sentAt !== null) {
    told = (await ownerLogins(db, report.shopId)).map((owner) => owner.personId);
    log("incident.missing_diver_all_clear_legacy_set", "warn", {
      reportId: report.id,
      owners: told.length,
    });
    await db
      .update(incidentReports)
      .set({ missingAlertReachedPersonIds: told })
      .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
  }
  const cleared = new Set(row.cleared);
  const owed = told.filter((personId) => !cleared.has(personId));
  if (owed.length === 0) return [];
  const reachable = new Set(
    (await reachedLogins(db, report.shopId, owed)).map((login) => login.personId),
  );
  if (reachable.size < owed.length) {
    // A login the shop turned off, or a person it removed: left out on purpose.
    log("incident.missing_diver_all_clear_revoked", "warn", {
      reportId: report.id,
      revoked: owed.length - reachable.size,
    });
  }
  return owed.filter((personId) => reachable.has(personId));
}

/**
 * The all-clear's emails to these people, each re-read from their login at
 * send time and only within this shop; each one sent is written into
 * `missing_all_clear_sent_person_ids` at once. Null when the departure is one
 * that never alerts, or nothing can be linked.
 */
async function sendAllClearTo(
  db: AppDb,
  input: {
    report: { id: string; shopId: string };
    personIds: readonly string[];
    origin: string | null;
    provider?: NotificationProvider;
  },
): Promise<{ sent: number; failed: number } | null> {
  const [report] = await db
    .select({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      foundAt: incidentReports.missingFoundAt,
    })
    .from(incidentReports)
    .where(
      and(eq(incidentReports.id, input.report.id), eq(incidentReports.shopId, input.report.shopId)),
    )
    .limit(1);
  if (!report?.foundAt) return null;
  const [context] = await db
    .select({
      tripTitle: trips.title,
      slug: shops.slug,
      shopName: shops.name,
      defaultLocale: shops.defaultLocale,
      timezone: shops.timezone,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(
      and(
        eq(trips.id, report.tripId),
        eq(trips.shopId, report.shopId),
        // diveday:allow-deleted-trips: an owner told of a missing diver is told they were found, whatever became of the departure since.
        notRehearsal(),
        eq(shops.isDemo, false),
      ),
    )
    .limit(1);
  if (!context || !input.origin) {
    if (context && !input.origin) log("incident.missing_diver_all_clear_no_origin", "error", {});
    return null;
  }
  const recipients = await reachedLogins(db, report.shopId, [...new Set(input.personIds)]);
  const stillMissing = await stillReportedMissing(db, report);
  const reportPath = shopPath(context.slug, "trips", report.tripId, "incidents", report.id);
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const delivery = await sendNotification(
      db,
      {
        kind: "incident_missing_diver_found",
        shopId: report.shopId,
        personId: recipient.personId,
        tripId: report.tripId,
        incidentReportId: report.id,
        to: recipient.email,
        locale: recipientLocale(recipient.locale, context.defaultLocale),
        recipientName: recipient.fullName,
        shopName: context.shopName,
        tripTitle: notificationTripTitle(context.tripTitle),
        foundAt: report.foundAt,
        stillMissing,
        timezone: context.timezone,
        reportUrl: `${input.origin}${reportPath}`,
      },
      input.provider,
    ).catch(() => ({ status: "failed" as const }));
    if (delivery.status === "sent") {
      sent += 1;
      await db
        .update(incidentReports)
        .set({
          missingAllClearSentPersonIds: withId(
            incidentReports.missingAllClearSentPersonIds,
            recipient.personId,
          ),
        })
        .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
    } else {
      failed += 1;
    }
  }
  // Ids and counts only. A failed all-clear is an error, never a quiet line.
  log("incident.missing_diver_all_clear", failed > 0 ? "error" : "info", {
    reportId: report.id,
    sent,
    failed,
  });
  return { sent, failed };
}

/**
 * The login of each person the alarm reached that the shop still lets it
 * reach, this shop's only (#2828, security review): an active login on a
 * person neither removed nor erased. Not filtered by role: an owner demoted
 * since, still active, saw the alarm and is owed the all-clear. A login the
 * shop turned off, or a person it removed, gets nothing.
 */
async function reachedLogins(db: AppDb, shopId: string, personIds: readonly string[]) {
  if (personIds.length === 0) return [];
  return db
    .select({
      personId: people.id,
      fullName: people.fullName,
      email: userAccounts.email,
      locale: people.locale,
    })
    .from(people)
    .innerJoin(userAccounts, eq(userAccounts.personId, people.id))
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(people.id, [...personIds]),
        livePerson(),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
      ),
    );
}

/** Other alerted reports on the departure whose person is not found yet: a count for the all-clear. */
async function stillReportedMissing(
  db: AppDb,
  report: { id: string; shopId: string; tripId: string },
): Promise<number> {
  const rows = await db
    .select({ id: incidentReports.id })
    .from(incidentReports)
    .where(
      and(
        eq(incidentReports.shopId, report.shopId),
        eq(incidentReports.tripId, report.tripId),
        ne(incidentReports.id, report.id),
        alertStands,
      ),
    );
  return rows.length;
}
