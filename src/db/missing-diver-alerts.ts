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
import { liveTrip, notRehearsal } from "./trips-live";

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
        if (delivery.status === "sent") {
          summary.emails += 1;
          reached.add(owner.personId);
          await recordReached(db, report, owner.personId, {
            origin,
            provider: input.provider,
          });
        }
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

/**
 * **Write down that this owner's alarm was sent** (issue #2828), once per
 * person, the moment it went.
 *
 * One statement, so it is ordered against the all-clear's claim on the same
 * row: the claim returns the reached set as it stands, and this append returns
 * whether a claim came first. If one did, the all-clear has already read a set
 * without this owner, so they get theirs here and now; if the diver is found
 * and nobody has claimed yet, the all-clear runs now and finds them in the
 * set. Either way an owner who saw the alarm is never left without the
 * all-clear because the two crossed.
 */
async function recordReached(
  db: AppDb,
  report: { id: string; shopId: string },
  personId: string,
  send: { origin: string; provider?: NotificationProvider },
): Promise<void> {
  const column = incidentReports.missingAlertReachedPersonIds;
  const one = JSON.stringify([personId]);
  const [row] = await db
    .update(incidentReports)
    .set({
      missingAlertReachedPersonIds: sql`case when ${column} @> ${one}::jsonb then ${column} else ${column} || ${one}::jsonb end`,
    })
    .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)))
    .returning({
      foundAt: incidentReports.missingFoundAt,
      allClearClaimedAt: incidentReports.missingAllClearClaimedAt,
    });
  if (!row?.foundAt) return;
  if (row.allClearClaimedAt === null) {
    await sendMissingDiverAllClear(db, {
      shopId: report.shopId,
      reportId: report.id,
      origin: send.origin,
      provider: send.provider,
    });
    return;
  }
  // Claimed before this owner was in the set: theirs alone, now.
  const sent = await sendAllClearTo(db, {
    report: { id: report.id, shopId: report.shopId },
    personIds: [personId],
    origin: send.origin,
    provider: send.provider,
  });
  log("incident.missing_diver_all_clear_late", sent?.everyone ? "info" : "error", {
    reportId: report.id,
    sent: sent?.sent ?? 0,
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
 * **One quiet all-clear** (issue #2694, decided by Aaron 2026-10-17): when a
 * missing diver is marked found, each owner the alarm reached gets one email
 * saying the diver reported missing on this departure was found, and when,
 * and how many are still reported missing on it (a count, never a name).
 * Email only: no push wakes the boat's followers, who are the ones who found
 * them.
 *
 * **Exactly the owners the alarm reached** (issue #2828): the set its sends
 * wrote down (`missing_alert_reached_person_ids`), never the owner list as it
 * stands at Found. An owner promoted since never saw the alarm and is not
 * cleared of it; one demoted, or whose login was turned off since, saw it and
 * is. A partial alarm still clears whoever it reached: it no longer waits for
 * `missing_alert_sent_at`, which a partial send never writes. An alarm that
 * reached nobody has no all-clear to follow it.
 *
 * **At most once**: the report is claimed (`missing_all_clear_claimed_at`)
 * before any send, and the claim reads the reached set in the same statement,
 * so two taps or a retry never send a second all-clear, and an alarm sent as
 * the claim lands is cleared by its own send (`recordReached`).
 * `missing_all_clear_sent_at` is written only once every reached owner's email
 * went, so the report page says when it did not, and the pass logs it as an
 * error: a partial all-clear is never silent. A failed send is not retried:
 * the found stands on the report either way, and the owner's first
 * instruction was to call the boat. Never for a rehearsal or a demo shop,
 * which are never alerted; a departure cancelled or removed since the alarm
 * still gets it.
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
  const now = input.now ?? nowDate();
  const origin = input.origin === undefined ? publicAppUrl() : input.origin;
  const [report] = await db
    .update(incidentReports)
    .set({ missingAllClearClaimedAt: now })
    .where(
      and(
        eq(incidentReports.id, input.reportId),
        eq(incidentReports.shopId, input.shopId),
        eq(incidentReports.kind, "missing_diver"),
        or(eq(incidentReports.status, "filed"), isNotNull(incidentReports.missingAlertRaisedAt)),
        isNotNull(incidentReports.missingFoundAt),
        // An alarm that reached nobody has no all-clear to follow it.
        sql`jsonb_array_length(${incidentReports.missingAlertReachedPersonIds}) > 0`,
        isNull(incidentReports.missingAllClearClaimedAt),
        isNull(incidentReports.deletedAt),
      ),
    )
    .returning({
      id: incidentReports.id,
      shopId: incidentReports.shopId,
      tripId: incidentReports.tripId,
      foundAt: incidentReports.missingFoundAt,
      reached: incidentReports.missingAlertReachedPersonIds,
    });
  if (!report?.foundAt) return "skipped";
  const outcome = await sendAllClearTo(db, {
    report,
    personIds: report.reached,
    origin,
    provider: input.provider,
  });
  if (outcome === null) return "skipped";
  if (outcome.everyone) {
    await db
      .update(incidentReports)
      .set({ missingAllClearSentAt: nowDate() })
      .where(and(eq(incidentReports.id, report.id), eq(incidentReports.shopId, report.shopId)));
  }
  // Ids and counts only. A partial all-clear is an error, never a quiet line.
  log("incident.missing_diver_all_clear", outcome.everyone ? "info" : "error", {
    reportId: report.id,
    reached: report.reached.length,
    addressable: outcome.addressable,
    sent: outcome.sent,
  });
  return outcome.everyone ? "sent" : "partial";
}

/**
 * The all-clear's emails to these people, each re-read from their login at
 * send time and only within this shop. A person the shop can no longer
 * address (erased, or with no login) counts as not sent, so the caller never
 * reports "sent" for an owner who heard nothing. Null when the departure is
 * one that never alerts, or nothing can be linked.
 */
async function sendAllClearTo(
  db: AppDb,
  input: {
    report: { id: string; shopId: string };
    personIds: readonly string[];
    origin: string | null;
    provider?: NotificationProvider;
  },
): Promise<{ everyone: boolean; sent: number; addressable: number } | null> {
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
  const personIds = [...new Set(input.personIds)];
  const recipients = await reachedLogins(db, report.shopId, personIds);
  const stillMissing = await stillReportedMissing(db, report);
  const reportPath = shopPath(context.slug, "trips", report.tripId, "incidents", report.id);
  let sent = 0;
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
    if (delivery.status === "sent") sent += 1;
  }
  return {
    everyone: personIds.length > 0 && sent === personIds.length,
    sent,
    addressable: recipients.length,
  };
}

/**
 * The login of each person the alarm reached, this shop's only. Not filtered
 * by role or login status: an owner demoted, or turned off, since the alarm
 * still saw it and is owed the all-clear (#2828). An erased person has no
 * address left to use, and is left out.
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
        isNull(people.anonymizedAt),
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
