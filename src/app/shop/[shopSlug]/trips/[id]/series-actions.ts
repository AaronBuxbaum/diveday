"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  setSeriesRepeat,
  setSeriesStandingCrew,
  updateSeriesCadence,
} from "@/db/trips";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { checkbox, formValue, readForm } from "@/lib/form-parse";
import { log } from "@/lib/log";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  isValidWeekdaySet,
  MAX_INTERVAL_WEEKS,
  MIN_INTERVAL_WEEKS,
  weekdaySetFrom,
} from "@/lib/recurrence";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { tripPath } from "./roster-booking";
import { requireTripConfig } from "./trip-config";

// Series-wide operations. A series is materialized as independent trips
// (20260719-recurring-trip-series); these iterate that instance set so staff
// can manage the whole run without touching every date by hand. Each settles
// back on the source trip's Overview, the one page the series banner lives on.

/**
 * Push this date's editable details across every upcoming date in the series,
 * and, when the confirm's crew switch was on the form, its crew as the run's
 * standing crew too (`setSeriesStandingCrew`). The switch is only on the form
 * when this date has a crew to stand; absent, the run's standing crew is left
 * as it was.
 */
const seriesDetailsForm = z.object({
  crewSwitch: formValue(),
  standingCrew: checkbox(),
});

export async function applySeriesDetailsAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const form = readForm(seriesDetailsForm, formData);
  const db = await getDb();
  const result = await applyDetailsToFutureSeries(
    db,
    s.user.shopId,
    seriesId,
    tripId,
    undefined,
    s.user.personId,
  );
  const crew =
    result && form.crewSwitch === "shown"
      ? await setSeriesStandingCrew(db, {
          shopId: s.user.shopId,
          seriesId,
          sourceTripId: tripId,
          standing: form.standingCrew,
          actorPersonId: s.user.personId,
        })
      : null;
  if (!result) {
    revalidateAndRedirect(back, noticeUrl(back, "series-error"));
    return;
  }
  revalidatePath(shopPath(shopSlug, "staffing"));
  revalidatePath(shopPath(shopSlug));
  revalidateAndRedirect(
    back,
    crew && crew.skipped > 0
      ? noticeUrl(back, "series-applied-crew-partial", { count: crew.skipped })
      : result.skipped > 0
        ? noticeUrl(back, "series-applied-partial")
        : crew && crew.updated > 0
          ? noticeUrl(back, "series-applied-crew")
          : noticeUrl(back, "series-applied"),
  );
}

/**
 * Cancel every upcoming date in the series at once, each through the blow-out
 * cascade: its divers are told the run has stopped, card payments go back by
 * themselves, and what cannot is owed on Today (`cancelFutureSeriesTrips`).
 *
 * Config-gated like the rest of the series acts: a single date's call is the
 * crew's, a whole run's is the schedule's. The series id is a bound argument,
 * so the write is scoped by the session's shop, never by the id alone.
 */
export async function cancelSeriesAction(shopSlug: string, tripId: string, seriesId: string) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const now = nowDate();
  // An instructor may call a run off; only a refund holder moves the money (H-139).
  const refunds = (await canPersonRefund(db, s.user.shopId, s.user.personId)) ? "release" : "queue";
  const result = await cancelFutureSeriesTrips(db, {
    shopId: s.user.shopId,
    seriesId,
    calledByPersonId: s.user.personId,
    now,
    refunds,
  });
  // Null is the only failure: the run was not this shop's, and nothing
  // changed. Anything else stopped the repeat, so the notice says what the
  // dates did — a date that was underway still stands (review 2a, D3).
  if (!result) {
    revalidateAndRedirect(back, noticeUrl(back, "series-error"));
    return;
  }
  // One line on each date's own log, so a departure that disappeared from the
  // board says who took it and why.
  for (const tripOfRun of result.tripIds) {
    try {
      await recordTripActivity(db, {
        shopId: s.user.shopId,
        tripId: tripOfRun,
        actorPersonId: s.user.personId,
        entry: { code: "series_cancelled" },
      });
    } catch (error) {
      log("series.cancel_activity_failed", "error", {
        tripId: tripOfRun,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
  revalidateAndRedirect(
    back,
    result.skipped > 0
      ? noticeUrl(back, "series-cancelled-partly", { count: result.skipped })
      : noticeUrl(back, refunds === "queue" ? "series-cancelled-held" : "series-cancelled", {
          count: result.divers,
        }),
  );
}

/**
 * Stop a series repeating, or start it going again — one switch, both ways.
 *
 * Stopping leaves every date already on the board exactly as it is (they are
 * ordinary trips, some with divers on them) and only closes the cadence, so
 * nothing new is generated. Starting again re-opens it and fills the horizon in
 * the same call, which is also how a shop takes a finite series scheduled
 * before this existed and simply lets it keep going.
 */
const seriesRepeatForm = z.object({ keepRepeating: checkbox("yes") });

export async function setSeriesRepeatAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const { keepRepeating } = readForm(seriesRepeatForm, formData);
  const result = await setSeriesRepeat(await getDb(), s.user.shopId, seriesId, keepRepeating);
  const notice = !result ? "series-error" : keepRepeating ? "series-repeating" : "series-stopped";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

const cadenceSchema = z.object({
  repeatIntervalWeeks: z.coerce.number().int().min(MIN_INTERVAL_WEEKS).max(MAX_INTERVAL_WEEKS),
  // Blank is the answer, not a missing one: it means the run keeps going.
  repeatEndsOn: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.string().refine(isValidCalendarDate).optional(),
  ),
});

/**
 * Change a running series' cadence — which weekdays, how many weeks apart, and
 * when it ends.
 *
 * Widening (a weekday added, the end date pushed out) fills the horizon in the
 * same call. Narrowing cancels **nothing**: the dates that no longer fit are
 * counted and reported, and taking them off the board is a separate tap
 * (`cancelOffCadenceSeriesAction`). Those are real departures with real divers,
 * and a cadence edit that silently emptied a fortnight of the schedule is the
 * one outcome this whole two-step exists to prevent.
 */
export async function updateSeriesCadenceAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const parsed = cadenceSchema.safeParse(Object.fromEntries(formData));
  // The weekday chips repeat one field name, which `Object.fromEntries`
  // collapses to the last of them — read off the form itself, as the board's
  // add panel does.
  const weekdays = weekdaySetFrom(formData.getAll("repeatWeekday").map((value) => Number(value)));
  if (!parsed.success || !isValidWeekdaySet(weekdays)) {
    redirect(noticeUrl(back, "series-error"));
  }
  const result = await updateSeriesCadence(await getDb(), s.user.shopId, seriesId, {
    intervalWeeks: parsed.data.repeatIntervalWeeks,
    weekdays,
    endsOn: parsed.data.repeatEndsOn ?? null,
  });
  const notice = !result
    ? "series-error"
    : result.offCadence > 0
      ? "series-cadence-narrowed"
      : "series-cadence-saved";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * The second half of narrowing: take the upcoming dates the new cadence no
 * longer fires on off the public schedule. Cancels, never deletes, so each one
 * is reinstatable from its own trip page. Each goes through the blow-out
 * cascade like the run-wide cancel: its divers are told and, for a caller with
 * the refund right, refunded (issue #2453, H-138, H-139).
 */
export async function cancelOffCadenceSeriesAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const result = await cancelOffCadenceSeriesTrips(db, {
    shopId: s.user.shopId,
    seriesId,
    calledByPersonId: s.user.personId,
    refunds: (await canPersonRefund(db, s.user.shopId, s.user.personId)) ? "release" : "queue",
  });
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
  const notice = result.cancelled === 0 ? "series-error" : "series-off-cadence-cancelled";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}
