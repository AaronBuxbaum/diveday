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
 * gangway (H-13).
 *
 * Two reads, never one: the **fact** (a set of booking ids) goes into every
 * manifest every staffer opens; the **text** is read only for a reader the
 * caller has already admitted with `canPersonReadMedicalAlertOnTrip`. The
 * alert informs and never gates: nothing here feeds readiness, admission,
 * roll call or a count.
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { recordDiverActivity } from "./operations";
import { listTripReadiness } from "./readiness";
import { activityEvents, bookings, waiverRecords } from "./schema";

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
 * before another tap writes a second line (H-153 amendment): a divemaster
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
