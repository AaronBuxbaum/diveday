"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPersonRefund } from "@/db/authz";
import { callTripBlowout, resumeTripBlowout, tripBlowoutCause } from "@/db/blowouts";
import { getDb } from "@/db/client";
import { recordTripActivity } from "@/db/operations";
import { refundBookingsForShopCancelledTrip } from "@/db/refunds";
import { getTripWithBooked } from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

// `shopPath`, not a template literal: `shopSlug` is a server-action argument and
// therefore client-supplied, and interpolating it raw let a slug traverse out of
// the `/shop/` namespace, or carry a `?`/`#` that swallowed the `?notice=`
// appended after it (see src/lib/staff-notices.ts). Each segment is escaped
// instead.
const blowoutPath = (shopSlug: string, tripId: string) =>
  shopPath(shopSlug, "schedule", "blowout", tripId);

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
export async function callBlowoutAction(shopSlug: string, tripId: string) {
  const back = blowoutPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const outcome = await callTripBlowout(db, {
    shopId: s.user.shopId,
    tripId,
    calledByPersonId: s.user.personId,
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
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonRefund,
    refusal: { notice: "refund-not-authorized", landing: ["schedule", "blowout", tripId] },
  });
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (trip?.status !== "cancelled") redirect(noticeUrl(back, "error"));
  if (!(await tripBlowoutCause(db, shop.id, tripId))) redirect(noticeUrl(back, "error"));
  await refundBookingsForShopCancelledTrip(db, { shopId: shop.id, tripId });
  refreshBlowoutSurfaces(shopSlug, tripId);
  redirect(noticeUrl(back, "refunds-released"));
}

/** The surfaces a blow-out changes: this page, the trip, the board, Today. */
function refreshBlowoutSurfaces(shopSlug: string, tripId: string) {
  revalidatePath(blowoutPath(shopSlug, tripId));
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
}
