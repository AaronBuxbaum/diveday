"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callDayBlowout } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { trackEvent } from "@/lib/analytics";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

/** At most this many departures in one call: a shop day, not a season. */
const MAX_DAY_DEPARTURES = 30;

/**
 * **One weather call for the ticked departures of a day** (ADR
 * 20261009-day-weather-call). Open to all staff, exactly as the single-trip
 * call is (`callBlowoutAction`): the go/no-go is the crew's, and no refund
 * here bypasses the H-14 role gate, because the cascade moves money only
 * through the same shop-cancellation path.
 *
 * Every departure goes through the single-trip blow-out, so its record,
 * refunds and messages are what calling it alone would have made; the day call
 * only orders the work so no diver is offered a sister it is cancelling.
 */
export async function callDayBlowoutAction(shopSlug: string, date: string, formData: FormData) {
  const back = shopPath(shopSlug, "schedule", "blowout", "day", date);
  const s = await requireStaffSession();
  if (!isValidCalendarDate(date)) redirect(noticeUrl(back, "error"));
  const tripIds = [
    ...new Set(
      formData
        .getAll("tripId")
        .map((value) => String(value))
        .filter((value) => uuidParam(value)),
    ),
  ].slice(0, MAX_DAY_DEPARTURES);
  if (tripIds.length === 0) redirect(noticeUrl(back, "day-none"));

  const db = await getDb();
  const results = await callDayBlowout(db, {
    shopId: s.user.shopId,
    tripIds,
    calledByPersonId: s.user.personId,
  });

  let called = 0;
  for (const { tripId, outcome } of results) {
    if (!outcome.ok) continue;
    called += 1;
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
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        entry: { code: "blowout_called" },
      });
    }
    revalidatePath(shopPath(shopSlug, "schedule", "blowout", tripId));
    revalidatePath(shopPath(shopSlug, "trips", tripId));
  }
  revalidatePath(back);
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));

  const skipped = results.length - called;
  redirect(
    skipped > 0
      ? noticeUrl(back, "day-partly", { called, skipped })
      : noticeUrl(back, "day-called", { count: called }),
  );
}
