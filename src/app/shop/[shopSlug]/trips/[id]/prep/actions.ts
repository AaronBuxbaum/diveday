"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import {
  type GearReservationActionOutcome,
  type ReserveGearUnitOutcome,
  releaseGearReservation,
  reserveGearUnit,
} from "@/db/gear";
import { getShopById } from "@/db/shops";
import { getTripWithBooked } from "@/db/trips";
import { tripReservationWindow } from "@/lib/gear";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeCodeOf, noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * A gear refusal's `?notice=` code, one entry per reason the domain can answer.
 *
 * These used to be built as `` `gear-${outcome.reason}` ``. Every code that
 * produced happened to exist in the prep page's `GEAR_NOTICES` map — but
 * `scripts/check-notice-codes.mjs` cannot read an interpolated string, so
 * nothing checked it, and a reason added to either union tomorrow would have
 * produced a code with no map entry. That renders **no banner at all**, which
 * looks exactly like a dead link and fails nothing.
 *
 * The value type is a template over `NoticeCodeOf`, so each entry is pinned to
 * exactly one spelling: the domain layer says `unit_out_of_service` and the URL
 * must say `gear-unit-out-of-service`. A typo is a compile error rather than a
 * silent blank, and the literals are now greppable from the page that resolves
 * them.
 */
type GearRefusalOf<Outcome> =
  Extract<Outcome, { ok: false }> extends { reason: infer R extends string } ? R : never;

type GearNoticeTable<Reason extends string> = {
  [R in Reason]: `gear-${NoticeCodeOf<R>}`;
};

const RESERVE_GEAR_NOTICE: GearNoticeTable<GearRefusalOf<ReserveGearUnitOutcome>> = {
  not_found: "gear-not-found",
  booking_not_found: "gear-booking-not-found",
  invalid_window: "gear-invalid-window",
  unit_out_of_service: "gear-unit-out-of-service",
  unit_unavailable: "gear-unit-unavailable",
};

const RESERVATION_ACTION_NOTICE: GearNoticeTable<GearRefusalOf<GearReservationActionOutcome>> = {
  not_found: "gear-not-found",
  already_returned: "gear-already-returned",
  already_checked_out: "gear-already-checked-out",
};

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
    noticeUrl(prep, outcome.ok ? "gear-assigned" : RESERVE_GEAR_NOTICE[outcome.reason]),
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
    noticeUrl(prep, outcome.ok ? "gear-released" : RESERVATION_ACTION_NOTICE[outcome.reason]),
  );
}
