"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPersonRefund } from "@/db/authz";
import { callTripBlowout, resumeTripBlowout, tripBlowoutCause } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { refundBookingsForShopCancelledTrip } from "@/db/refunds";
import { getTripWithBooked } from "@/db/trips";
import { requireShopSurface } from "@/features/accounts/session";
import { recordRecoveryFollowUp } from "@/features/trips/disruption-recovery";
import {
  createRecoveryActivity,
  transitionRecoveryActivity,
} from "@/features/trips/recovery-activities";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { trackEvent } from "@/lib/analytics";
import { parseBlowoutPreferences } from "@/lib/blowout-preferences";
import { isRecoveryOutcome } from "@/lib/disruption-recovery";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";
import { blowoutPath } from "./_components/blowout/blowout-path";

/**
 * The one-tap blow-out (docs ADR 20260804-blowout-cascade). Open to all staff,
 * same as `cancelTripAction`: the weather go/no-go is the crew's call
 * (glossary). Calling it off is the crew's, but **the refunds it triggers are not**
 * (H-20261013-call-off-queues-refunds): a caller with the refund right (`canRefund`, H-20260724-staff-role-reach) sends each
 * seat's card capture back by itself (ADR 20260813-shop-cancellation-refunds-itself);
 * anyone else leaves the money captured, tells each diver a refund is owed, and
 * a refund holder releases it from this page (`releaseBlowoutRefundsAction`).
 * A counter payment, a disconnected account or a Stripe refusal is left to
 * staff either way.
 *
 * Safe to re-run: the cascade resumes pending rows and re-sends nobody
 * (`callTripBlowout`'s idempotency contract).
 */
export async function callBlowoutAction(
  shopSlug: string,
  tripId: string,
  formData: FormData = new FormData(),
) {
  const back = blowoutPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const preferredAlternativeTripIds = parseBlowoutPreferences(formData.getAll("alternativeTripId"));
  if (!preferredAlternativeTripIds) redirect(noticeUrl(back, "alternatives-invalid"));
  const outcome = await callTripBlowout(db, {
    shopId: s.user.shopId,
    tripId,
    calledByPersonId: s.user.personId,
    preferredAlternativeTripIds,
    refunds: (await canPersonRefund(db, s.user.shopId, s.user.personId)) ? "release" : "queue",
  });
  if (!outcome.ok) {
    redirect(noticeUrl(back, outcome.reason === "trip_departed" ? "departed" : "error"));
  }
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
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, outcome.resumed ? "resumed" : "called"));
}

/**
 * Retry the messages a previous pass left failed — flips them back to pending
 * and walks the cascade again. Never touches sent or queued rows.
 */
export async function resumeBlowoutAction(shopSlug: string, tripId: string) {
  const back = blowoutPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const outcome = await resumeTripBlowout(db, {
    shopId: s.user.shopId,
    tripId,
    calledByPersonId: s.user.personId,
    refunds: (await canPersonRefund(db, s.user.shopId, s.user.personId)) ? "release" : "queue",
  });
  if (!outcome.ok) redirect(noticeUrl(back, "error"));
  await trackEvent({
    name: "blowout_resumed",
    total: outcome.total,
    sent: outcome.sent,
    failed: outcome.failed,
  });
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, "resumed"));
}

/**
 * **Release the refunds a call-off left queued** (H-20261013-call-off-queues-refunds). Owner or manager
 * only (`canRefund`, H-20260724-staff-role-reach), re-checked here against the live roles rather than
 * trusted from the page. Refuses a departure that is not canceled with a
 * blow-out record: `refundBookingsForShopCancelledTrip` refunds every active
 * seat, which must never be reachable on a live trip. Safe to re-run: a seat
 * already refunded reads back as such and moves nothing twice.
 */
export async function releaseBlowoutRefundsAction(shopSlug: string, tripId: string) {
  const back = blowoutPath(shopSlug, tripId);
  // Checked here rather than through `requireShopSurface`'s refusal, whose landing
  // is path segments only: the refusal must land back on the blow-out, where
  // `refund-not-authorized` is worded and the held refunds still show.
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!(await canPersonRefund(db, shop.id, session.user.personId))) {
    redirect(noticeUrl(back, "refund-not-authorized"));
  }
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "cancelled") redirect(noticeUrl(back, "error"));
  if (!(await tripBlowoutCause(db, shop.id, tripId))) redirect(noticeUrl(back, "error"));
  await refundBookingsForShopCancelledTrip(db, { shopId: shop.id, tripId });
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, "refunds-released"));
}

/** The surfaces a blow-out changes: this page, the trip, the board, Today. */
function refreshBlowoutSurfaces(shopSlug: string, tripId: string) {
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
}

/** Record follow-up without changing the seat, payment or notification trail. */
export async function recordRecoveryFollowUpAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const back = blowoutPath(shopSlug, tripId);
  const outcome = String(formData.get("outcome") ?? "");
  if (!isRecoveryOutcome(outcome)) redirect(noticeUrl(back, "recovery-invalid"));
  const result = await recordRecoveryFollowUp(db, {
    shopId: shop.id,
    tripId,
    actorPersonId: session.user.personId,
    blowoutDiverId: String(formData.get("blowoutDiverId") ?? ""),
    attemptId: String(formData.get("attemptId") ?? ""),
    expectedRevision: Number(formData.get("revision")),
    outcome,
    replacementBookingId:
      outcome === "rebooked" ? String(formData.get("replacementBookingId") ?? "") : null,
  });
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(
    noticeUrl(
      back,
      result.ok
        ? "recovery-saved"
        : result.reason === "stale"
          ? "recovery-stale"
          : result.reason === "busy"
            ? "recovery-busy"
            : "recovery-invalid",
    ),
  );
}

/** Classroom actions do not call the cancellation, notification, money, seat or course writers. */
export async function createClassroomActivityAction(
  shopSlug: string,
  tripId: string,
  _previous: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const text = (name: string) => String(form.get(name) ?? "");
  const start = parseWallTime(text("date"), text("startTime"));
  const end = parseWallTime(text("endDate"), text("endTime"));
  if (!start || !end) return { error: t("blowout.classroom.invalid") };
  const result = await createRecoveryActivity(db, {
    shopId: shop.id,
    tripId,
    actorPersonId: session.user.personId,
    attemptId: text("attemptId"),
    title: text("title"),
    location: text("location"),
    startsAt: wallTimeToUtc(start, shop.timezone),
    endsAt: wallTimeToUtc(end, shop.timezone),
    capacity: Number(text("capacity")),
    coordinatorPersonId: text("coordinatorPersonId"),
    arrangementsConfirmed: form.get("arrangementsConfirmed") === "on",
  });
  if (!result.ok) return { error: t(`blowout.classroom.${result.reason}`) };
  refreshBlowoutSurfaces(shopSlug, tripId);
  return {};
}

export async function transitionClassroomActivityAction(
  shopSlug: string,
  tripId: string,
  _previous: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const { db, shop, session } = await requireShopSurface(shopSlug);
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  const text = (name: string) => String(form.get(name) ?? "");
  const context = {
    shopId: shop.id,
    tripId,
    actorPersonId: session.user.personId,
    attemptId: text("attemptId"),
    activityId: text("activityId"),
    expectedRevision: Number(text("revision")),
  };
  const kind = text("kind");
  const input =
    kind === "offer"
      ? ({ ...context, kind, blowoutDiverId: text("blowoutDiverId") } as const)
      : kind === "confirm" || kind === "cancel_place"
        ? ({
            ...context,
            kind,
            blowoutDiverId: text("blowoutDiverId"),
            participantRevision: Number(text("participantRevision")),
          } as const)
        : kind === "capacity"
          ? ({ ...context, kind, capacity: Number(text("capacity")) } as const)
          : kind === "cancel_activity"
            ? ({ ...context, kind } as const)
            : null;
  if (!input) return { error: t("blowout.classroom.invalid") };
  const result = await transitionRecoveryActivity(db, input);
  if (!result.ok) return { error: t(`blowout.classroom.${result.reason}`) };
  refreshBlowoutSurfaces(shopSlug, tripId);
  return {};
}
