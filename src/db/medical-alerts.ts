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
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { listTripReadiness } from "./readiness";
import { bookings, waiverRecords } from "./schema";

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
 * The alert texts on one departure, by booking id, **for a reader the caller
 * has already admitted** for this departure. Seats with none are absent.
 */
export async function medicalAlertTextsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, string>> {
  const releaseByBooking = standingReleaseByBooking(await listTripReadiness(db, shopId, tripId));
  const recordIds = [...new Set(releaseByBooking.values())];
  if (recordIds.length === 0) return new Map();
  const rows = await db
    .select({ id: waiverRecords.id, text: waiverRecords.medicalAlert })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        inArray(waiverRecords.id, recordIds),
        isNotNull(waiverRecords.medicalAlert),
      ),
    );
  const textByRecord = new Map(rows.map((row) => [row.id, row.text ?? ""] as const));
  const texts = new Map<string, string>();
  for (const [bookingId, recordId] of releaseByBooking) {
    const text = textByRecord.get(recordId);
    if (text) texts.set(bookingId, text);
  }
  return texts;
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
