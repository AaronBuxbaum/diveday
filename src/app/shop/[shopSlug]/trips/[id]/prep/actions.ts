"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { releaseGearReservation, reserveGearUnit } from "@/db/gear";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { tripReservationWindow } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

const assignSchema = z.object({
  tripId: z.uuid(),
  bookingId: z.uuid(),
  gearItemId: z.uuid(),
});

/**
 * Assign one unit to one diver for this departure's whole window. The window
 * is derived from the trip on the server — never posted from the form — so a
 * stale tab cannot reserve last week's dates, and the exclusion constraint
 * stays the only arbiter of availability (ADR 20260815-minimal-gear-register).
 */
export async function assignGearUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = assignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const db = await getDb();
  const [shop, trip] = await Promise.all([
    getShopById(db, session.user.shopId),
    getTripWithBooked(db, session.user.shopId, parsed.data.tripId),
  ]);
  if (!shop || !trip) revalidateAndRedirect(prep, noticeUrl(prep, "gear-invalid"));

  const window = tripReservationWindow(trip, shop.timezone);
  const outcome = await reserveGearUnit(db, {
    shopId: shop.id,
    gearItemId: parsed.data.gearItemId,
    bookingId: parsed.data.bookingId,
    // Pins the booking to this departure: the window above is this trip's, so
    // a stale tab pairing it with another trip's booking must be refused.
    tripId: parsed.data.tripId,
    reservedFrom: window.from,
    reservedUntil: window.until,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(prep, outcome.ok ? "gear-assigned" : `gear-${outcome.reason}`),
  );
}

const releaseSchema = z.object({ tripId: z.uuid(), reservationId: z.uuid() });

/** Un-assign a unit that never left the counter; an out unit gets returned instead. */
export async function releaseGearUnitAction(formData: FormData) {
  const session = await requireStaffSession();
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const gear = shopPath(session.user.shopSlug, "gear");
    revalidateAndRedirect(gear, noticeUrl(gear, "invalid"));
  }
  const prep = shopPath(session.user.shopSlug, "trips", parsed.data.tripId, "prep");

  const outcome = await releaseGearReservation(await getDb(), {
    shopId: session.user.shopId,
    reservationId: parsed.data.reservationId,
  });
  revalidateAndRedirect(
    prep,
    noticeUrl(prep, outcome.ok ? "gear-released" : `gear-${outcome.reason}`),
  );
}
