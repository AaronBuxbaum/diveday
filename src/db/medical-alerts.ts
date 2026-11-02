/**
 * **The medical alert for the crew, as the boat reads it** (glossary *Medical
 * alert for the crew*, issue #2960).
 *
 * The alert that counts is the one on the diver's **current standing
 * release**: the record readiness already resolves for the seat
 * (`effectiveWaiverForBooking`, carried as `waiver` on each
 * `listTripReadiness` row). Signing again replaces it, including with nothing.
 * A held seat (`identity_unconfirmed_at`) carries none: its release belongs to
 * the person it was matched to, who may not be the one walking up the
 * gangway (H-20260724-one-person-per-email).
 *
 * Two reads, never one: the **fact** (a set of booking ids) goes into every
 * manifest every staffer opens; the **text** is read only for a reader the
 * caller has already admitted with `canPersonReadMedicalAlertOnTrip`. The
 * alert informs and never gates: nothing here feeds readiness, admission,
 * roll call or a count.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { MINUTE_MS, nowDate, nowMs } from "@/lib/clock";
import type { OfflineMedicalAlertsResponse } from "@/lib/offline-manifests";
import {
  canPersonPrintMedicalAlerts,
  canPersonReadMedicalAlertOnTrip,
  emergencyMedicalAlertStanding,
} from "./authz";
import type { DbExecutor } from "./client";
import { recordDiverActivity } from "./operations";
import { listTripReadiness } from "./readiness";
import { activityEvents, bookings, people, trips, waiverRecords } from "./schema";
import { livePerson, liveTrip } from "./trips-live";

/** One readiness row as far as this module reads it. */
type StandingReleaseRow = {
  booking: { id: string; identityUnconfirmedAt: Date | null };
  waiver: { id: string } | null;
};

/**
 * The standing release behind each seat, by booking id, from rows readiness
 * already resolved. Held seats are left out.
 */
export function standingReleaseByBooking(rows: readonly StandingReleaseRow[]): Map<string, string> {
  const byBooking = new Map<string, string>();
  for (const row of rows) {
    if (row.booking.identityUnconfirmedAt || !row.waiver) continue;
    byBooking.set(row.booking.id, row.waiver.id);
  }
  return byBooking;
}

/**
 * The seats whose standing release carries an alert: the fact, never the
 * text, so it can ride on a manifest every staff role opens.
 */
export async function bookingsWithMedicalAlert(
  db: DbExecutor,
  shopId: string,
  releaseByBooking: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const recordIds = [...new Set(releaseByBooking.values())];
  if (recordIds.length === 0) return new Set();
  const rows = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.id, recordIds),
        isNotNull(waiverRecords.medicalAlert),
      ),
    );
  const alerted = new Set(rows.map((row) => row.id));
  return new Set(
    [...releaseByBooking].filter(([, recordId]) => alerted.has(recordId)).map(([id]) => id),
  );
}

/**
 * The alerts on one departure, by booking id, with the diver each belongs to,
 * **for a reader the caller has already admitted** for this departure. Seats
 * with none are absent.
 */
export async function medicalAlertsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, { personId: string; text: string }>> {
  const releaseByBooking = standingReleaseByBooking(await listTripReadiness(db, shopId, tripId));
  const recordIds = [...new Set(releaseByBooking.values())];
  if (recordIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: waiverRecords.id,
      personId: waiverRecords.personId,
      text: waiverRecords.medicalAlert,
    })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.id, recordIds),
        isNotNull(waiverRecords.medicalAlert),
      ),
    );
  const byRecord = new Map(rows.map((row) => [row.id, row] as const));
  const alerts = new Map<string, { personId: string; text: string }>();
  for (const [bookingId, recordId] of releaseByBooking) {
    const row = byRecord.get(recordId);
    if (row?.text) alerts.set(bookingId, { personId: row.personId, text: row.text });
  }
  return alerts;
}

/**
 * Whether any seat on the departure has an alert on its standing release: the
 * fact, never the text, for whether "Print with medical alerts" is offered.
 */
export async function tripHasMedicalAlert(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<boolean> {
  const releaseByBooking = standingReleaseByBooking(await listTripReadiness(db, shopId, tripId));
  return (await bookingsWithMedicalAlert(db, shopId, releaseByBooking)).size > 0;
}

/** The texts alone, by booking id (`medicalAlertsForTrip`). */
export async function medicalAlertTextsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, string>> {
  const alerts = await medicalAlertsForTrip(db, shopId, tripId);
  return new Map([...alerts].map(([bookingId, alert]) => [bookingId, alert.text] as const));
}

/**
 * How long one reader's read of one diver's alert on one departure stands
 * before another tap writes a second line (H-20261023-medical-alert-for-the amendment): a divemaster
 * opening the same sheet three times at the rail is one read, and a script
 * cannot push earlier reads off the trail's first page.
 */
export const MEDICAL_ALERT_READ_WINDOW_MS = 10 * MINUTE_MS;

/**
 * **Puts one read of a diver's medical alert on their trail**, unless this
 * reader already has the same line for this diver and departure (or, with no
 * departure, the signed record) within {@link MEDICAL_ALERT_READ_WINDOW_MS}.
 * True when the trail holds the line, newly written or already there; false
 * when the trail refused it (`recordDiverActivity`), so the caller shows
 * nothing.
 *
 * The check and the insert run under one advisory lock on (shop, code,
 * reader, diver, departure), so parallel taps or parallel offline saves write
 * one line, not one each (security review 2, L5;
 * `medical-alerts.postgres.test.ts`).
 */
export async function recordMedicalAlertTrailLine(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    actorPersonId: string;
    code: "medical_alert_read" | "medical_alert_saved_offline";
    departureId: string | null;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('medical_alert_trail'), hashtext(${[
        input.shopId,
        input.code,
        input.actorPersonId,
        input.personId,
        input.departureId ?? "",
      ].join(":")}))`,
    );
    return recordUnlessRecent(tx, input);
  });
}

async function recordUnlessRecent(
  db: DbExecutor,
  input: Parameters<typeof recordMedicalAlertTrailLine>[1],
): Promise<boolean> {
  const [recent] = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.shopId, input.shopId),
        eq(activityEvents.code, input.code),
        eq(activityEvents.actorPersonId, input.actorPersonId),
        eq(activityEvents.subjectPersonId, input.personId),
        isNull(activityEvents.tripId),
        input.departureId
          ? sql`${activityEvents.params}->>'departure' = ${input.departureId}`
          : sql`${activityEvents.params}->>'departure' is null`,
        gte(activityEvents.occurredAt, new Date(nowMs() - MEDICAL_ALERT_READ_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (recent) return true;
  return recordDiverActivity(db, {
    shopId: input.shopId,
    personId: input.personId,
    actorPersonId: input.actorPersonId,
    code: input.code,
    ...(input.departureId ? { departureId: input.departureId } : {}),
  });
}

/**
 * One seat's alert on one departure, with the diver it belongs to, **for a
 * reader the caller has already admitted** for this departure; null when the
 * seat is not on it, is held, or its standing release carries none.
 */
export async function medicalAlertForSeat(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<{ personId: string; text: string } | null> {
  // The seat must be this shop's and on this departure before anything is
  // resolved: a booking id from elsewhere answers nothing.
  const [seat] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), eq(bookings.tripId, tripId)),
    )
    .limit(1);
  if (!seat) return null;
  const rows = await listTripReadiness(db, shopId, tripId);
  const row = rows.find((candidate) => candidate.booking.id === bookingId);
  if (!row || row.booking.identityUnconfirmedAt || !row.waiver) return null;
  const [record] = await db
    .select({ personId: waiverRecords.personId, text: waiverRecords.medicalAlert })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.id, row.waiver.id), eq(waiverRecords.shopId, shopId)))
    .limit(1);
  if (!record?.text) return null;
  return { personId: record.personId, text: record.text };
}

/**
 * **What the diver's box starts with on their own waiver page** (H-20261023-medical-alert-for-the
 * amendments): the link's own draft when there is one
 * (`draft_medical_answers` set means the diver saved, and a cleared box stays
 * cleared). Otherwise the box starts empty, and `earlierAlert` says whether
 * the same person's **latest** signed release at this shop carried an alert,
 * so the page can tell them to write it again if it still applies.
 *
 * Never the earlier words (security review 2, L-1): the link is a bearer
 * capability that may not be in the diver's hands (a forwarded link, a party
 * lead signing for someone), the same reason `getEmergencyContactForBearer`
 * keeps person-level data off it. Only the latest release counts (L-2), so an
 * alert the diver cleared on purpose stays cleared. The person is the
 * record's `person_id` as it reads now, so a link moved to someone else says
 * nothing about the first person. A held seat's page renders no form, and
 * this says nothing there either, as defense in depth.
 */
export async function medicalAlertPrefill(
  db: DbExecutor,
  record: {
    id: string;
    shopId: string;
    personId: string;
    bookingId: string | null;
    draftMedicalAlert: string | null;
    draftMedicalAnswers: unknown;
  },
): Promise<{ draft: string | null; earlierAlert: boolean }> {
  if (record.draftMedicalAlert !== null || record.draftMedicalAnswers !== null) {
    return { draft: record.draftMedicalAlert, earlierAlert: false };
  }
  const nothing = { draft: null, earlierAlert: false };
  if (record.bookingId) {
    const [booking] = await db
      .select({ identityUnconfirmedAt: bookings.identityUnconfirmedAt })
      .from(bookings)
      .where(and(eq(bookings.id, record.bookingId), eq(bookings.shopId, record.shopId)))
      .limit(1);
    if (booking?.identityUnconfirmedAt) return nothing;
  }
  const [latest] = await db
    .select({ hasAlert: sql<boolean>`${waiverRecords.medicalAlert} is not null` })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, record.shopId),
        eq(waiverRecords.personId, record.personId),
        ne(waiverRecords.id, record.id),
        isNotNull(waiverRecords.signedAt),
        isNull(waiverRecords.supersededAt),
        isNull(waiverRecords.anonymizedAt),
      ),
    )
    .orderBy(desc(waiverRecords.signedAt))
    .limit(1);
  return latest?.hasAlert ? { draft: null, earlierAlert: true } : nothing;
}

/**
 * **Hands one departure's medical alert words to an explicit offline save**
 * (H-20261023-medical-alert-for-the amendment; `POST /api/offline-manifests/[tripId]/medical-alerts`).
 * `not_found` for a departure that is not this shop's live one; `forbidden`
 * unless `canPersonReadMedicalAlertOnTrip` admits the reader now. Otherwise
 * one `medical_alert_saved_offline` line per diver on the trail first
 * (`recordMedicalAlertTrailLine`), and the words of each diver whose line the
 * trail took, with the reader as the copy records them.
 */
export async function medicalAlertsForOfflineSave(
  db: DbExecutor,
  input: { shopId: string; tripId: string; readerId: string },
): Promise<
  | { ok: true; body: OfflineMedicalAlertsResponse }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };
  if (!(await canPersonReadMedicalAlertOnTrip(db, input.shopId, input.readerId, trip.id))) {
    return { ok: false, reason: "forbidden" };
  }
  const [reader] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.readerId), eq(people.shopId, input.shopId), livePerson()))
    .limit(1);
  if (!reader) return { ok: false, reason: "forbidden" };
  const texts: Record<string, string> = {};
  for (const [bookingId, alert] of await medicalAlertsForTrip(db, input.shopId, trip.id)) {
    const recorded = await recordMedicalAlertTrailLine(db, {
      shopId: input.shopId,
      personId: alert.personId,
      actorPersonId: input.readerId,
      code: "medical_alert_saved_offline",
      departureId: trip.id,
    });
    if (recorded) texts[bookingId] = alert.text;
  }
  return {
    ok: true,
    body: {
      texts,
      savedBy: { personId: input.readerId, name: reader.name, savedAt: nowDate().toISOString() },
    },
  };
}

/**
 * What a packet printed **with** the medical alerts carries (issue #2990):
 * the words by booking id, who printed them and when.
 */
export type PrintedMedicalAlerts = {
  texts: ReadonlyMap<string, string>;
  printedBy: string;
  printedAt: Date;
};

/**
 * **Hands one departure's medical alert words to "Print with medical alerts"**
 * (issue #2990, H-20261023-medical-alert-for-the amendment of 2026-10-24). `not_found` for a departure
 * that is not this shop's live one; `forbidden` unless
 * `canPersonPrintMedicalAlerts` admits the printer now (the owner or a
 * manager). Otherwise one `medical_alert_printed` line per diver on the trail
 * first, every print its own line (each one is another sheet), and the words
 * of each diver whose line the trail took. A held seat prints none.
 */
export async function medicalAlertsForPrint(
  db: DbExecutor,
  input: { shopId: string; tripId: string; printerId: string },
): Promise<
  { ok: true; printed: PrintedMedicalAlerts } | { ok: false; reason: "not_found" | "forbidden" }
> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };
  if (!(await canPersonPrintMedicalAlerts(db, input.shopId, input.printerId))) {
    return { ok: false, reason: "forbidden" };
  }
  const [printer] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.printerId), eq(people.shopId, input.shopId), livePerson()))
    .limit(1);
  if (!printer) return { ok: false, reason: "forbidden" };
  const texts = new Map<string, string>();
  for (const [bookingId, alert] of await medicalAlertsForTrip(db, input.shopId, trip.id)) {
    const recorded = await recordDiverActivity(db, {
      shopId: input.shopId,
      personId: alert.personId,
      actorPersonId: input.printerId,
      code: "medical_alert_printed",
      departureId: trip.id,
    });
    if (recorded) texts.set(bookingId, alert.text);
  }
  return { ok: true, printed: { texts, printedBy: printer.name, printedAt: nowDate() } };
}

/**
 * **"Emergency: show the alert"** for one seat (issue #2990, H-20261023-medical-alert-for-the amendment
 * of 2026-10-24): a staffer the crew rule refuses, on the days of the trip in
 * the shop's zone (`emergencyMedicalAlertStanding`, re-read here on every
 * confirm). The seat must be on this departure and its standing release must
 * carry an alert. The read goes on the diver's trail as
 * `medical_alert_emergency_read` before the words are handed back, and it is
 * **never de-duplicated**: two confirms are two lines. A trail that refuses
 * the line shows nothing.
 *
 * A refusal says why only when the reason is the window and the reader is
 * someone the rule admits on the trip's days: `not_yet` (it opens on the day
 * of the trip) or `closed` (over: ask the owner or a manager). Every other
 * refusal is the same bare `{ ok: false }`, which says nothing about the seat.
 */
export async function emergencyReadMedicalAlert(
  db: DbExecutor,
  input: { shopId: string; tripId: string; bookingId: string; readerId: string },
): Promise<{ ok: true; text: string } | { ok: false; reason?: "not_yet" | "closed" }> {
  const standing = await emergencyMedicalAlertStanding(
    db,
    input.shopId,
    input.readerId,
    input.tripId,
  );
  if (standing === "refused") return { ok: false };
  if (standing !== "open") return { ok: false, reason: standing };
  const alert = await medicalAlertForSeat(db, input.shopId, input.tripId, input.bookingId);
  if (!alert) return { ok: false };
  const recorded = await recordDiverActivity(db, {
    shopId: input.shopId,
    personId: alert.personId,
    actorPersonId: input.readerId,
    code: "medical_alert_emergency_read",
    departureId: input.tripId,
  });
  if (!recorded) return { ok: false };
  return { ok: true, text: alert.text };
}
