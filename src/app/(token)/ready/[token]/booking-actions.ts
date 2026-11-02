"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { addPartySeat, selfCancelBooking } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { recordMoveAsk } from "@/db/inbound-messages";
import { isLockWaitRefusal } from "@/db/lock-bounds";
import { alertStaffToMoveAsk } from "@/db/move-ask-alerts";
import { strandedMoveAsk } from "@/db/move-offer";
import { startPartySeatCheckout } from "@/db/party-seat-checkout";
import {
  planReadinessLinkRescue,
  type ReadinessLinkRescue,
  sendPlannedReadinessLink,
} from "@/db/readiness-link-rescue";
import { settleReleasedPartySeats, settleSelfCancelledSeat } from "@/db/self-cancel-settle";
import { getShopById } from "@/db/shops";
import { diverTranslator } from "@/i18n/messages";
import { describeCheckoutLine } from "@/i18n/participant-labels";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { formValue, parseForm, readForm, single, text } from "@/lib/form-parse";
import { formatPlannedDateTimeTz } from "@/lib/format";
import { log } from "@/lib/log";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { diverNameSchema } from "@/lib/person-fields";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  base,
  bounceTarget,
  contextFor,
  refuseWhileHeld,
  strandedContextFor,
} from "./action-helpers";

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
 * **Ask to move** (H-20261014-ask-to-move). Past the free-cancellation window, cancelling
 * forfeits what was paid; this files a request in the shop's Inbox naming the
 * seat instead, with the diver's optional note. Nothing moves here: moving a
 * paid seat stays staff-side (ADR 20260821-the-diver-may-release-their-own-seat).
 *
 * Re-derived from the page's own read, never the form: only an `open` ask is
 * filed, so a held seat, a seat inside the window or one already asked about
 * is refused for who is asking. A repeat is the same row (`recordMoveAsk`),
 * and only a row this tap filed says "Sent": an ask that already stood is
 * shown as the page's own asked line, never reported as news.
 */
const moveAskForm = z.object({ note: formValue(), tripId: single(z.uuid()) });

export async function askToMoveAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("booking-move-ask", ip), RATE_LIMITS.bookingSelfCancel))
      .allowed
  ) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  if (ctx.data.moveAsk && ctx.data.moveAsk !== "open") redirect(`${base(token)}#move-ask`);
  if (ctx.data.moveAsk !== "open") redirect(`${base(token)}?error=move-ask`);
  const parsed = parseForm(moveAskForm, formData);
  if (!parsed.ok || parsed.data.tripId !== ctx.data.trip.id) {
    redirect(`${base(token)}?error=move-ask`);
  }
  const { note } = parsed.data;
  const outcome = await recordMoveAsk(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    expectedTripId: ctx.data.trip.id,
    note: typeof note === "string" ? note : null,
    now: nowDate(),
  }).catch((error: unknown) => {
    if (isLockWaitRefusal(error)) return { status: "not_found" as const };
    throw error;
  });
  if (outcome.status === "not_found") redirect(`${base(token)}?error=move-ask`);
  if (outcome.status === "already") revalidateAndRedirect(base(token), `${base(token)}#move-ask`);
  // Within a day of the boat, owners and managers are emailed too (#2667);
  // farther out the Inbox row is enough. Never throws.
  await alertStaffToMoveAsk(ctx.db, {
    shopId: ctx.data.shop.id,
    messageId: outcome.id,
    now: nowDate(),
  });
  revalidateAndRedirect(base(token), `${base(token)}?saved=move-ask#move-ask`);
}

/**
 * **"Ask to move to Thu 12:00" from a called-off departure's card** (UX sheet
 * 2026-10-22, item 5; H-20261022-called-off-boat-offers). The same Inbox ask as `askToMoveAction`, filed
 * against the stranded seat with the offered boat written into its note; the
 * desk confirms it with its ordinary move, so nothing moves or is charged
 * here.
 *
 * The link opens nothing else (`strandedContextFor`). The offer is computed
 * again for the link's own booking and shop, and the posted trip id is only
 * compared against it: a forged or stale id, or a boat that filled since the
 * page drew it, files nothing and the card redraws with what is true now.
 */
const moveOfferForm = z.object({ tripId: text() });

export async function askToMoveFromCancelledAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("booking-move-ask", ip), RATE_LIMITS.bookingSelfCancel))
      .allowed
  ) {
    redirect(`${base(token)}?error=rate#move-ask`);
  }
  const ctx = await strandedContextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const now = nowDate();
  const ask = await strandedMoveAsk(ctx.db, { shopId: ctx.shopId, bookingId: ctx.bookingId, now });
  if (ask?.state === "asked") redirect(`${base(token)}#move-ask`);
  const { tripId } = readForm(moveOfferForm, formData);
  if (ask?.state !== "open" || ask.offer.tripId !== tripId) {
    redirect(`${base(token)}?error=move-ask#move-ask`);
  }
  const shop = await getShopById(ctx.db, ctx.shopId);
  if (!shop) redirect(`${base(token)}?error=move-ask#move-ask`);
  // In the shop's own language: the desk reads it, and it names the boat the
  // card offered so nobody has to work out which one.
  const locale = recipientLocale(null, shop.defaultLocale);
  const note = diverTranslator(locale)("ready.moveOffer.note", {
    title: ask.offer.title,
    when: formatPlannedDateTimeTz(ask.offer.startsAt, locale, shop.timezone),
  });
  const outcome = await recordMoveAsk(ctx.db, {
    shopId: ctx.shopId,
    bookingId: ctx.bookingId,
    calledOff: true,
    note,
    now,
  }).catch((error: unknown) => {
    // A bounded lock wait is the same quiet notice as `askToMoveAction`'s.
    if (isLockWaitRefusal(error)) return { status: "not_found" as const };
    throw error;
  });
  if (outcome.status === "not_found") redirect(`${base(token)}?error=move-ask#move-ask`);
  if (outcome.status === "already") revalidateAndRedirect(base(token), `${base(token)}#move-ask`);
  await alertStaffToMoveAsk(ctx.db, { shopId: ctx.shopId, messageId: outcome.id, now });
  revalidateAndRedirect(base(token), `${base(token)}?saved=move-ask#move-ask`);
}

/**
 * **A party lead pays for one seat they added** (issue #2474). The seat's id
 * arrives in the form, so it is the db function that decides whether it is
 * this lead's, unclaimed, unpaid and on this departure; here only the page's
 * own gate (`canPayPartySeats`) and a per-IP bucket come first. Every refusal
 * is the same quiet notice: the seat stays held, and a failure never reads as
 * a lost seat.
 */
const partySeatPayForm = z.object({ seatBookingId: formValue() });

export async function payForPartySeatFromReady(token: string, formData: FormData) {
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking)).allowed) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  const origin = publicAppUrl();
  const { seatBookingId } = readForm(partySeatPayForm, formData);
  if (
    !ctx.data.canPayPartySeats ||
    !origin ||
    !ctx.data.person.email ||
    typeof seatBookingId !== "string"
  ) {
    redirect(`${base(token)}?error=seat-pay`);
  }
  const returnBase = `${origin}${base(token)}`;
  const t = diverTranslator(recipientLocale(ctx.ownLocale, ctx.data.shop.defaultLocale));
  const outcome = await startPartySeatCheckout(ctx.db, {
    shopId: ctx.data.shop.id,
    tripId: ctx.data.trip.id,
    leadBookingId: ctx.bookingId,
    seatBookingId,
    customerEmail: ctx.data.person.email,
    successUrl: `${returnBase}?pay=seat-paid#party-seats`,
    cancelUrl: `${returnBase}?pay=cancelled#party-seats`,
    describeLine: (parts) => describeCheckoutLine(t, parts),
  }).catch(() => null);
  const url = outcome?.ok ? outcome.checkout.checkoutUrl : null;
  if (!url) redirect(`${base(token)}?error=seat-pay#party-seats`);
  redirect(url);
}

/**
 * Cancel the diver's own booking. Rate-limited harder than the rest of this
 * file — this is irreversible and, when paid, moves money. Cancellation and
 * refund stay the two independent steps the staff path uses (docs H-20260724-payment-deposit-cancellation-refund): the
 * seat is freed by `selfCancelBooking` first, and a refund failure afterward
 * never re-opens it or blocks the cancellation the diver already sees.
 *
 * A party lead's unclaimed seats go with them (batch 6 item 10), released in
 * the same transaction and then refunded one by one under the same policy as
 * the lead's own. A claimed seat stays, and the cancelled page says which.
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

  const shopId = ctx.data.shop.id;
  const cancelled = await selfCancelBooking(ctx.db, {
    shopId,
    bookingId: ctx.bookingId,
    withUnclaimedParty: true,
  });
  if (!cancelled.ok) redirect(`${base(token)}?error=cancel`);
  await trackEvent({ name: "booking_cancelled", source: "diver" });

  // The refund outcome itself is never trusted back from the client for the
  // notice: `?cancelled=1` here is only a trigger telling the page to look,
  // not the source of truth. The page re-derives what actually happened from
  // the booking's own current payment status — an edited or replayed query
  // string cannot be used to claim a refund that did not happen, or hide one
  // that did.
  await settleSelfCancelledSeat(ctx.db, {
    shopId,
    bookingId: ctx.bookingId,
    notify: true,
    partyOutcome: cancelled.party,
  });
  await settleReleasedPartySeats(ctx.db, {
    shopId,
    leadBookingId: ctx.bookingId,
    party: cancelled.party,
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

/**
 * **"Add a seat"** (UX review 2026-10-11, item 13): bring a friend on the
 * booking this page belongs to. Authorized by the verified readiness token
 * like every action here; `addPartySeat` re-checks the trip's capacity and
 * admission inside its own transaction, so this route only maps its answer to
 * a notice. The new seat's claim link appears in the party panel on the page
 * the redirect lands on.
 */
const addSeatForm = z.object({ seatName: single(diverNameSchema) });

export async function addSeatFromReady(token: string, formData: FormData) {
  // A seat is a booking, so it spends the same per-IP budget the schedule's
  // booking form does, on top of the token chokepoint every action here takes.
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking)).allowed) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  refuseWhileHeld(token, ctx.data);
  if (!ctx.data.canAddSeat) redirect(`${base(token)}?error=seat`);
  const parsed = parseForm(addSeatForm, formData);
  if (!parsed.ok) redirect(`${base(token)}?error=seat-name`);
  // **Per booking, decided first** (security review of layer 8, D3): the link
  // is shared by design, so the per-IP bucket above is not the cap on how many
  // seats one booking can add. Every holder of this link spends from one
  // bucket, and only once the page has said a seat may be added.
  if (
    !(
      await checkRateLimit(
        rateLimitKey("ready-add-seat", "booking", ctx.bookingId),
        RATE_LIMITS.readyAddSeatByBooking,
      )
    ).allowed
  ) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const outcome = await addPartySeat(ctx.db, {
    shopId: ctx.data.shop.id,
    leadBookingId: ctx.bookingId,
    seatName: parsed.data.seatName,
  }).catch((error: unknown) => {
    log("ready.add_seat_failed", "error", {
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return null;
  });
  if (!outcome) redirect(`${base(token)}?error=seat`);
  if (!outcome.ok) {
    const code =
      outcome.reason === "trip_full" || outcome.reason === "divers_full"
        ? "seat-full"
        : outcome.reason === "trip_prerequisite" ||
            outcome.reason === "course_prerequisite" ||
            outcome.reason === "course_ratio_full"
          ? "seat-ask-shop"
          : outcome.reason === "party_full"
            ? "seat-party-full"
            : "seat";
    redirect(`${base(token)}?error=${code}`);
  }
  await trackEvent({ name: "booking_completed", source: "diver", partySize: 1 });
  revalidateAndRedirect(base(token), `${base(token)}?saved=seat#party-seats`);
}
