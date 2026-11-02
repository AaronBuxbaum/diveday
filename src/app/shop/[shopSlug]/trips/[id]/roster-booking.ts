import { redirect } from "next/navigation";
import { cancelBooking, getShopBookingTripId } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * **A roster row's booking belongs to the roster it was posted from.**
 *
 * Every roster door on a departure — a note, a removal, a waiver, an identity,
 * a payment, a check-in — reads its `bookingId` from the form. Each write is
 * scoped by the session's shop, so no other tenant's seat is reachable, but a
 * booking of the *same* shop on another departure was: a stale tab could cancel
 * a seat on tomorrow's boat from today's roster, and the activity line and the
 * revalidation would then describe the departure in the URL rather than the
 * one that changed. On a manifest, that is the record of who was taken off
 * which boat.
 *
 * One check, shared, so a new roster action cannot forget half of it:
 * the id is well-formed, it is a booking of this shop, and it sits on
 * `tripId`. Plain module rather than `"use server"`: exported from an action
 * file it would be an endpoint.
 */

/** The departure page every roster door sends the staffer back to. */
export const tripPath = (shopSlug: string, tripId: string) => shopPath(shopSlug, "trips", tripId);

/** True only for a well-formed id of a booking of `shopId` on `tripId`. */
export async function isRosterBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<boolean> {
  if (!uuidParam(bookingId) || !uuidParam(tripId)) return false;
  return (await getShopBookingTripId(db, shopId, bookingId)) === tripId;
}

/** {@link isRosterBooking}, or back to `back` without writing anything. */
export async function requireRosterBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
  bookingId: string,
  back: string,
): Promise<void> {
  if (!(await isRosterBooking(db, shopId, tripId, bookingId))) redirect(back);
}

/**
 * **Take a seat off the roster, or say why not.** A diver marked aboard a boat
 * that has left is refused (H-20261015-aboard-diver-removal-at): back to the row with
 * `booking-remove-aboard`, or `booking-remove-uncounted` for a seat nobody
 * counted at the dock, and nothing changed — no email, no refund, no trail
 * line. Otherwise the seat is cancelled, the trail names `actorPersonId`, and this returns what it was before,
 * which decides whether the diver is told.
 */
export async function removeSeat(
  db: AppDb,
  shopId: string,
  bookingId: string,
  back: string,
  actorPersonId: string,
) {
  // The trail's "who took this diver off the manifest?" line is written in
  // the removal's own transaction, named by record (security review
  // 2026-10-16, F1).
  const cancelled = await cancelBooking(db, shopId, bookingId, { trail: { actorPersonId } });
  if (!cancelled.ok && cancelled.reason === "aboard_at_sea") {
    const notice =
      cancelled.hold === "uncounted" ? "booking-remove-uncounted" : "booking-remove-aboard";
    revalidateAndRedirect(back, noticeUrl(back, notice, { bid: bookingId }));
  }
  return cancelled.ok ? cancelled.booking.previousStatus : "cancelled";
}
