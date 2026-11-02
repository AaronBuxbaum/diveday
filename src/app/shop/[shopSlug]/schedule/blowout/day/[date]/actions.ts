"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPersonCallDayBlowout, canPersonRefund } from "@/db/authz";
import { callDayBlowout, listDayBlowoutDepartures } from "@/db/blowouts";
import { recordTripActivity } from "@/db/operations";
import { trackEvent } from "@/lib/analytics";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { dayBlowoutBounds, dayBlowoutCallable } from "@/lib/day-blowout";
import { log } from "@/lib/log";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/**
 * **One weather call for the selected departures of a day** (ADR
 * 20261009-day-weather-call). Owner, manager and captain only
 * (`canCallDayBlowout`, the owner's decision of 2026-10-09); the single-trip
 * call stays open to all staff. A caller without the refund right (`canRefund`,
 * H-20260724-staff-role-reach) cancels and tells the divers but leaves the money captured for an owner
 * or manager to release (H-20261013-call-off-queues-refunds).
 *
 * **The server decides what is called** (security review L2): the submitted
 * ids are re-read against this date's departures in the shop's own zone, and
 * only those that can still be called go ahead — another day's, one underway,
 * one already called. Every id it does not call is reported as skipped, never
 * silently dropped.
 *
 * Every departure goes through the single-trip blow-out, so its record,
 * refunds and messages are what calling it alone would have made; the day call
 * only orders the work so no diver is offered a sister it is cancelling.
 */
export async function callDayBlowoutAction(shopSlug: string, date: string, formData: FormData) {
  const back = shopPath(shopSlug, "schedule", "blowout", "day", date);
  const { db, shop, session } = await requireShopSurface(shopSlug, {
    allow: canPersonCallDayBlowout,
    refusal: { notice: "day-blowout-not-authorized" },
  });
  if (!isValidCalendarDate(date)) redirect(noticeUrl(back, "error"));
  const submitted = [
    ...new Set(
      formData
        .getAll("tripId")
        .map((value) => String(value))
        .filter((value) => uuidParam(value)),
    ),
  ];
  if (submitted.length === 0) redirect(noticeUrl(back, "day-none"));

  const now = nowDate();
  const departures = await listDayBlowoutDepartures(
    db,
    shop.id,
    dayBlowoutBounds(date, shop.timezone),
  );
  const { callable, skipped: refused } = dayBlowoutCallable(departures, submitted, now);
  const results =
    callable.length > 0
      ? await callDayBlowout(db, {
          shopId: shop.id,
          tripIds: callable,
          calledByPersonId: session.user.personId,
          now,
          // A captain may call the day; only a refund holder moves the money (H-20261013-call-off-queues-refunds).
          refunds: (await canPersonRefund(db, shop.id, session.user.personId))
            ? "release"
            : "queue",
        })
      : [];

  let called = 0;
  for (const { tripId, outcome } of results) {
    if (!outcome.ok) continue;
    called += 1;
    // Each departure's own trail, whatever happens to the next one's.
    try {
      await trackEvent({
        name: "blowout_called",
        resumed: outcome.resumed,
        total: outcome.total,
        sent: outcome.sent,
        failed: outcome.failed,
        noEmail: outcome.noEmail,
      });
      if (!outcome.resumed) {
        await recordTripActivity(db, {
          shopId: shop.id,
          tripId,
          actorPersonId: session.user.personId,
          entry: { code: "blowout_called" },
        });
      }
    } catch (error) {
      log("blowout.day_activity_failed", "error", {
        tripId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
    revalidatePath(shopPath(shopSlug, "schedule", "blowout", tripId));
    revalidatePath(shopPath(shopSlug, "trips", tripId));
  }
  revalidatePath(back);
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));

  const skipped = refused + (results.length - called);
  redirect(
    skipped > 0
      ? noticeUrl(back, "day-partly", { called, skipped })
      : noticeUrl(back, "day-called", { count: called }),
  );
}
