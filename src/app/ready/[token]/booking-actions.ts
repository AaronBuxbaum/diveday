"use server";

import { redirect } from "next/navigation";
import {
  type CancellationRefundSeen,
  sendBookingCancelledNotice,
} from "@/db/booking-cancelled-notice";
import { selfCancelBooking } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import {
  planReadinessLinkRescue,
  type ReadinessLinkRescue,
  sendPlannedReadinessLink,
} from "@/db/readiness-link-rescue";
import { refundBookingOnCancellation } from "@/db/refunds";
import { diverTranslator } from "@/i18n/messages";
import { describeCheckoutLine } from "@/i18n/participant-labels";
import { trackEvent } from "@/lib/analytics";
import { log } from "@/lib/log";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { base, bounceTarget, contextFor, refuseWhileHeld } from "./action-helpers";

/**
 * Pay for the trip from the page. Abandonment already degrades safely — the
 * seat is held regardless — so a failure here just returns the diver to the
 * page with a gentle notice, never to an error.
 */
export async function payFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  // The page draws no pay step on a held seat, and this refuses the hand-made
  // post: the address on the record may be the matched person's, not the
  // booker's, and Stripe would be handed it as the customer (issue #2125).
  refuseWhileHeld(token, ctx.data);
  const origin = publicAppUrl();
  if (!ctx.data.canPay || !origin || !ctx.data.person.email) {
    redirect(`${base(token)}?error=pay`);
  }
  const returnBase = `${origin}${base(token)}`;
  // The words on the hosted Stripe line come from the diver's own bundle here,
  // not from `src/db` (docs ADR 20260731-domain-layer-copy-leaks). Only
  // `startBookingCheckout` knows whether the trip's deposit policy makes this
  // a deposit or the whole fare, so it asks — the caller supplies the words for
  // both branches.
  const t = diverTranslator(recipientLocale(ctx.ownLocale, ctx.data.shop.defaultLocale));
  const outcome = await startBookingCheckout(ctx.db, {
    shopId: ctx.data.shop.id,
    tripId: ctx.data.trip.id,
    bookingIds: [ctx.bookingId],
    customerEmail: ctx.data.person.email,
    successUrl: `${returnBase}?pay=paid`,
    cancelUrl: `${returnBase}?pay=cancelled`,
    describeLine: (parts) => describeCheckoutLine(t, parts),
  }).catch(() => null);
  const url = outcome?.ok ? outcome.checkout.checkoutUrl : null;
  if (!url) redirect(`${base(token)}?error=pay`);
  redirect(url);
}

/**
 * Cancel the diver's own booking. Rate-limited harder than the rest of this
 * file — this is irreversible and, when paid, moves money. Cancellation and
 * refund stay the two independent steps the staff path uses (docs H-07): the
 * seat is freed by `selfCancelBooking` first, and a refund failure afterward
 * never re-opens it or blocks the cancellation the diver already sees.
 *
 * The move a diver cannot make here is a *move* — rescheduling is the shop's
 * (ADR 20260821-the-diver-may-release-their-own-seat).
 */
export async function cancelMyBookingAction(token: string) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("booking-self-cancel", ip), RATE_LIMITS.bookingSelfCancel))
      .allowed
  ) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));

  const cancelled = await selfCancelBooking(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!cancelled.ok) redirect(`${base(token)}?error=cancel`);
  await trackEvent({ name: "booking_cancelled", source: "diver" });

  // The refund outcome itself is never trusted back from the client for the
  // notice: `?cancelled=1` here is only a trigger telling the page to look,
  // not the source of truth. The page re-derives what actually happened from
  // the booking's own current payment status — an edited or replayed query
  // string cannot be used to claim a refund that did not happen, or hide one
  // that did.
  //
  // Caught, not left to throw: the cancellation above already committed and
  // this token is already revoked, so a refund failure (a transient DB error,
  // say) must never turn an already-successful cancellation into an error
  // response — the diver would see a generic failure with no way to tell the
  // destructive action actually went through, since refreshing the dead link
  // only shows the unavailable notice. Staff can still see and fix a missed
  // refund from the booking's payment record; the diver just needs the
  // confirmation either way.
  let refund: CancellationRefundSeen = { status: "not_attempted" };
  try {
    refund = await refundBookingOnCancellation(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
    });
    if (refund.status !== "no_policy" && refund.status !== "unpaid") {
      await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
    }
  } catch (error) {
    log("booking.self_cancel_refund_failed", "error", {
      bookingId: ctx.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
  // The written record of what just happened, with the money in it: the page
  // below says it once, and this is what the diver still has tomorrow.
  await sendBookingCancelledNotice(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    cancelledBy: "diver",
    // `selfCancelBooking` only ever cancels a booked seat.
    from: "booked",
    refund,
  });
  redirect(`${base(token)}?cancelled=1`);
}

/**
 * **The one transactional thing a dead trip-prep link still offers: send its
 * owner a fresh one.**
 *
 * Nothing here hands the caller new access. The replacement goes to the address
 * already on the booking, and only an outcome code comes back to the page — so
 * a leaked stale URL can trigger a delivery to its owner and nothing more. The
 * rules live with `planReadinessLinkRescue`; this is the two rate-limit nets
 * around it, and it is the waiver page's action with the nouns changed (issue
 * #850).
 */
const RESCUE_PARAM: Record<ReadinessLinkRescue, string> = {
  sent: "ok",
  no_email: "none",
  current_link_live: "live",
  unavailable: "unavailable",
  failed: "failed",
};

export async function emailFreshReadinessLinkAction(token: string) {
  const ip = await clientIp();
  // Two nets, because they bound different abuses: the shared per-IP bucket —
  // the same one every other action on this page spends from — stops one client
  // hammering many tokens, and the narrow bucket below stops many clients
  // hammering one diver's inbox.
  if (
    !(await checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction))
      .allowed
  ) {
    redirect(`${base(token)}?sent=rate`);
  }

  const db = await getDb();
  // **Decide first, spend second.** Every refusal is reached from reads alone,
  // and none of them costs the diver anything. Spending the per-inbox budget
  // before deciding meant a leaked dead URL could burn it on answers that sent
  // nothing — five taps at a booking holding a live link returned
  // `current_link_live` five times and left the real diver rate-limited for the
  // hour (`security-reviewer`, issue #850).
  const plan = await planReadinessLinkRescue(db, token);
  if (!plan.ok) redirect(`${base(token)}?sent=${RESCUE_PARAM[plan.reason]}`);

  // The narrow bucket belongs to the **inbox**, so it is keyed by the booking
  // the stale link resolves to — not by the URL. A booking accumulates a dead
  // capability every time one is issued, and keying by token would hand each of
  // those leaked URLs its own full budget: one holder with a handful of old
  // links could spray the same mailbox N times over. Keyed by booking, every
  // link ever issued for it spends from one budget. `rateLimitKey` hashes it,
  // so a booking id is never held as a literal key.
  const inboxKey = rateLimitKey("readiness-link-resend", "booking", plan.bookingId);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.readinessLinkResendByBooking)).allowed) {
    redirect(`${base(token)}?sent=rate`);
  }

  redirect(`${base(token)}?sent=${RESCUE_PARAM[await sendPlannedReadinessLink(db, plan)]}`);
}
