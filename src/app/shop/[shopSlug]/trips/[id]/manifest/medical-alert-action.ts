"use server";

import { headers } from "next/headers";
import { canPersonReadMedicalAlertOnTrip } from "@/db/authz";
import {
  emergencyReadMedicalAlert,
  medicalAlertForSeat,
  recordMedicalAlertTrailLine,
} from "@/db/medical-alerts";
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

/**
 * Whether this action call came from another site: a `Sec-Fetch-Site:
 * cross-site` request, or an `Origin` whose host is not the one the request
 * was sent to. Next already refuses a server action whose origin does not
 * match; this is the same defense in depth the offline medical-alerts route
 * runs (`isCrossSiteRequest`), so the emergency read never rests on one
 * framework check alone.
 */
async function fromAnotherSite(): Promise<boolean> {
  const sent = await headers();
  if (sent.get("sec-fetch-site") === "cross-site") return true;
  const origin = sent.get("origin");
  if (origin === null) return false;
  const host = sent.get("x-forwarded-host") ?? sent.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * **"Emergency: show the alert"**, confirmed (issue #2990, H-153 amendment of
 * 2026-10-24). Offered in the reveal sheet to a staffer the crew rule refuses,
 * on the day the diver's departure leaves; this re-checks everything on the
 * server (`emergencyReadMedicalAlert`): an active staffer of this shop, today
 * in the shop's zone, the seat on this departure. The read goes on the
 * diver's trail as `medical_alert_emergency_read` first, every confirm its own
 * line, and the owner's Monday email lists last week's. Signed-in staff only
 * (`requireShopSurface`), so no bearer page reaches it; a cross-site call is
 * refused before anything is read. Every refusal is the same `{ ok: false }`.
 */
export async function emergencyShowSeatMedicalAlertAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
): Promise<ShowSeatMedicalAlertResult> {
  if (await fromAnotherSite()) return { ok: false };
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const trip = uuidParam(tripId);
  const seat = uuidParam(bookingId);
  if (!trip || !seat) return { ok: false };
  return emergencyReadMedicalAlert(db, {
    shopId: shop.id,
    tripId: trip,
    bookingId: seat,
    readerId: session.user.personId,
  });
}
