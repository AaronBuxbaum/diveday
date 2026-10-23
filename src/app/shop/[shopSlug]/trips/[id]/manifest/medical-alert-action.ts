"use server";

import { canPersonReadMedicalAlertOnTrip } from "@/db/authz";
import { medicalAlertForSeat, recordMedicalAlertTrailLine } from "@/db/medical-alerts";
import { requireShopSurface } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

export type ShowSeatMedicalAlertResult = { ok: true; text: string } | { ok: false };

/**
 * **Opening a diver's medical alert on the manifest or roll call** (issue
 * #2960). The chip on the row says one exists to every staffer; the words
 * leave the server only here, for the owner, a manager, or a staffer on this
 * departure's crew right now (`canPersonReadMedicalAlertOnTrip`, re-read on
 * every tap), and only for a seat booked on this departure.
 *
 * The read goes on the diver's trail (`medical_alert_read`) before the words
 * are handed back, the way "Show answers" records `medical_answers_read`; a
 * trail that refuses the line shows nothing. One line per reader, diver and
 * departure within ten minutes (`recordMedicalAlertTrailLine`); every tap
 * still gets the words. A page render never writes it and never carries them.
 * Every refusal is the same `{ ok: false }`.
 */
export async function showSeatMedicalAlertAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
): Promise<ShowSeatMedicalAlertResult> {
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const trip = uuidParam(tripId);
  const seat = uuidParam(bookingId);
  if (!trip || !seat) return { ok: false };
  const actor = session.user.personId;
  if (!(await canPersonReadMedicalAlertOnTrip(db, shop.id, actor, trip))) return { ok: false };
  const alert = await medicalAlertForSeat(db, shop.id, trip, seat);
  if (!alert) return { ok: false };
  const recorded = await recordMedicalAlertTrailLine(db, {
    shopId: shop.id,
    personId: alert.personId,
    actorPersonId: actor,
    code: "medical_alert_read",
    departureId: trip,
  });
  if (!recorded) return { ok: false };
  return { ok: true, text: alert.text };
}
