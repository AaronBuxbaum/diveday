"use server";

import { redirect } from "next/navigation";
import { canPersonConfigureTrips } from "@/db/authz";
import { recordShopActivity } from "@/db/shop-activity";
import { copyWeekFromYearBefore } from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { calendarDateWeekday, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Last year's week, copied onto this empty one** (fifth loop, item 30).
 * Its own file so the builder's actions stay one page; the gate is the
 * builder's own: the slug must be the session's shop (`requireShopSurface`)
 * and the reader must define trips (H-20260724-staff-role-reach), re-checked against live roles.
 * The week must name its Monday; anything else is refused as invalid.
 */
export async function copyLastYearWeekAction(shopSlug: string, formData: FormData) {
  const back = shopPath(shopSlug, "schedule", "board");
  const { session, db, shop } = await requireShopSurface(shopSlug);
  if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
    redirect(`${back}?builder=not-authorized`);
  }
  const weekStart = String(formData.get("weekStart") ?? "");
  if (!isValidCalendarDate(weekStart) || calendarDateWeekday(weekStart) !== 1) {
    redirect(`${back}?builder=invalid`);
  }
  const outcome = await copyWeekFromYearBefore(db, shop.id, weekStart, shop.timezone, nowDate());
  const here = `${back}?week=${weekStart}`;
  if (!outcome.ok) {
    redirect(`${here}&builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  // Each copy is logged as the builder's own copy is, one line per departure.
  for (const tripId of outcome.tripIds) {
    await recordShopActivity(db, {
      shopId: shop.id,
      actorPersonId: session.user.personId,
      write: { code: "departure_copied", tripId },
    });
  }
  await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "ok" });
  revalidateAndRedirect(back, `${here}&builder=week-copied&count=${outcome.tripIds.length}`);
}
