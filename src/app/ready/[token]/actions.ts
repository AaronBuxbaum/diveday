"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { rescheduleBooking, selfCancelBooking } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { getReadyPageData } from "@/db/ready";
import { type CancellationRefundOutcome, refundBookingOnCancellation } from "@/db/refunds";
import { saveRentalFit } from "@/db/rental-fit";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { emergencyContactSchema } from "@/lib/contact";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { shopOffersNitrox } from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";

/**
 * The transactional half of the diver's readiness page. Every action is
 * authorized the same way: the signed readiness token proves the diver owns
 * this booking, and every write is then scoped to that booking's shop/person.
 * A bearer of this token can only ever touch its own booking — never another
 * diver's — and the readiness state itself stays server-authoritative.
 */

const base = (token: string) => `/ready/${token}`;

/**
 * Resolve the token to its booking + shop context, or bounce to a plain
 * notice. Rate-limited by IP before verification, so this one chokepoint
 * throttles every action in this file against both token guessing and
 * replay spam of a known link (CR-013).
 */
async function contextFor(token: string) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction).allowed) {
    return null;
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) return null;
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data || data.detail.cancelled) return null;
  return { db, bookingId: capability.bookingId, data };
}

/**
 * Sign the waiver from the page. We can't reconstruct an existing bearer token
 * (only its hash is stored), so this issues a fresh link for the booking and
 * sends the diver straight to it. Reissuing supersedes any prior pending link,
 * which is the intended behaviour.
 */
export async function signWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) redirect(`${base(token)}?error=waiver`);
  redirect(`/waivers/${issued.token}`);
}

export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=contact`);
  const name = (parsed.data.emergencyContactName ?? "").trim();
  const phone = (parsed.data.emergencyContactPhone ?? "").trim();
  await saveBookingEmergencyContact(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    name,
    phone,
  });
  // A contact is only usable with a reachable number, so only a name+phone pair
  // earns the "saved" confirmation; a partial entry is nudged, never thanked.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    base(token),
    `${base(token)}?saved=${complete ? "contact" : "contact-empty"}`,
  );
}

const fitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  nitrox: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  bootSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
  note: z.string().trim().max(300),
});

export async function saveFitFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const parsed = fitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=fit`);
  const saved = await saveRentalFit(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    bootSize: parsed.data.bootSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    note: parsed.data.note,
  });
  // The nitrox checkbox is only in this form when the shop currently offers
  // nitrox (RentalFitForm.tsx) — when it isn't, the field is simply absent
  // from every submission, whatever the diver's actual request. Only write it
  // when the checkbox could have been there at all, so an unrelated save
  // (a note, a size) never silently clears a request recorded while the shop
  // still offered it.
  if (shopOffersNitrox(ctx.data.shop.rentalItems)) {
    await setBookingNitrox(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
      wantsNitrox: parsed.data.nitrox === "on",
    });
  }
  const result = saved ? "saved=fit" : "error=fit";
  revalidateAndRedirect(base(token), `${base(token)}?${result}`);
}

/**
 * Pay for the trip from the page. Abandonment already degrades safely — the
 * seat is held regardless — so a failure here just returns the diver to the
 * page with a gentle notice, never to an error.
 */
export async function payFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));
  const origin = publicAppUrl();
  if (!ctx.data.canPay || !origin || !ctx.data.person.email) {
    redirect(`${base(token)}?error=pay`);
  }
  const returnBase = `${origin}${base(token)}`;
  const outcome = await startBookingCheckout(ctx.db, {
    shopId: ctx.data.shop.id,
    tripId: ctx.data.trip.id,
    bookingIds: [ctx.bookingId],
    customerEmail: ctx.data.person.email,
    successUrl: `${returnBase}?pay=paid`,
    cancelUrl: `${returnBase}?pay=cancelled`,
  }).catch(() => null);
  const url = outcome?.ok ? outcome.checkout.checkoutUrl : null;
  if (!url) redirect(`${base(token)}?error=pay`);
  redirect(url);
}

/** Diver-facing notice code for a refund outcome — mirrors `refundNotice` on the staff roster. */
function cancelRefundNotice(refund: CancellationRefundOutcome): string {
  switch (refund.status) {
    case "refunded":
      return "cancelled-refunded";
    case "forfeit":
      return "cancelled-forfeit";
    case "failed":
    case "manual":
      return "cancelled-refund-manual";
    case "no_policy":
      // Genuinely paid — refundBookingOnCancellation only reaches no_policy
      // after confirming captured payment — but the trip states no
      // cancellation window, so automation stayed out of it and nothing was
      // refunded. This is not the same as "nothing was owed" (unpaid): the
      // diver needs to know the shop, not Stripe, decides this one.
      return "cancelled-no-policy";
    default:
      // unpaid: nothing was owed.
      return "cancelled";
  }
}

/**
 * Cancel the diver's own booking. Rate-limited harder than the rest of this
 * file (docs ADR 20260727-diver-self-service-cancel) — this is irreversible
 * and, when paid, moves money. Cancellation and refund stay the two
 * independent steps the staff path uses (docs H-07): the seat is freed by
 * `selfCancelBooking` first, and a refund failure afterward never re-opens
 * it or blocks the cancellation the diver already sees.
 */
export async function cancelMyBookingAction(token: string) {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("booking-self-cancel", ip), RATE_LIMITS.bookingSelfCancel).allowed
  ) {
    redirect(base(token));
  }
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));

  const cancelled = await selfCancelBooking(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!cancelled.ok) redirect(`${base(token)}?error=cancel`);

  const refund = await refundBookingOnCancellation(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  redirect(`${base(token)}?cancelled=${cancelRefundNotice(refund)}`);
}

/**
 * Move the diver's own booking to a different trip. Atomic (docs ADR
 * 20260727-diver-self-service-cancel): the destination is booked before the
 * old seat is freed, so a full or newly-unavailable trip leaves the original
 * booking untouched rather than stranding the diver with neither. Only
 * offered for an unpaid booking — `rescheduleBooking` re-enforces that
 * itself, this is not the only guard.
 *
 * The old token dies with the old booking (capabilities are revoked on
 * cancel), so a successful reschedule mints a fresh readiness link for the
 * new booking and sends the diver straight there — there is no way to hand
 * back an existing token for a booking id that changed.
 */
export async function rescheduleMyBookingAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("booking-self-cancel", ip), RATE_LIMITS.bookingSelfCancel).allowed
  ) {
    redirect(base(token));
  }
  const ctx = await contextFor(token);
  if (!ctx) redirect(base(token));

  const parsedTripId = z.uuid().safeParse(formData.get("newTripId"));
  if (!parsedTripId.success) redirect(`${base(token)}?error=reschedule`);

  const result = await rescheduleBooking(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    newTripId: parsedTripId.data,
  });
  if (!result.ok) redirect(`${base(token)}?error=reschedule`);

  const capability = await issueBookingCapability(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: result.newBookingId,
    purpose: "readiness",
  });
  // The reschedule already committed even if minting this new link somehow
  // fails — the diver just won't have a bookmark to it. A shop can still
  // find them on the new trip's roster.
  if (!capability) redirect(base(token));
  redirect(`${base(capability.token)}?saved=rescheduled`);
}
