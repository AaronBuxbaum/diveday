"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { rescheduleBooking, selfCancelBooking } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { sendAndRecordNotification } from "@/db/notifications";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { refundBookingOnCancellation } from "@/db/refunds";
import { saveRentalFit } from "@/db/rental-fit";
import { getTripWithBooked } from "@/db/trips";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { toDiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
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

/** Where a resolved action redirects when it can't proceed — a query param the page can turn into a real notice, never silence. */
function bounceTarget(token: string, reason: "rate_limited" | "invalid"): string {
  return reason === "rate_limited" ? `${base(token)}?error=rate` : base(token);
}

type ReadyContext = { db: AwaitedDb; bookingId: string; data: ReadyPageData };
type ReadyContextResult =
  | ({ ok: true } & ReadyContext)
  | { ok: false; reason: "rate_limited" | "invalid" };

type AwaitedDb = Awaited<ReturnType<typeof getDb>>;

/**
 * Resolve the token to its booking + shop context, or report why it can't be
 * used. Rate-limited by IP before verification, so this one chokepoint
 * throttles every action in this file against both token guessing and
 * replay spam of a known link (CR-013). Every call site distinguishes the
 * two failure reasons (task 49): a throttled attempt tells the diver to wait
 * a moment, rather than redirecting silently and looking like the button did
 * nothing at all — a stale/invalid token still just bounces to the plain
 * unavailable notice, since there's nothing actionable to say about it.
 */
async function contextFor(token: string): Promise<ReadyContextResult> {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction).allowed) {
    return { ok: false, reason: "rate_limited" };
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) return { ok: false, reason: "invalid" };
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data || data.detail.cancelled) return { ok: false, reason: "invalid" };
  return { ok: true, db, bookingId: capability.bookingId, data };
}

/**
 * Sign the waiver from the page. We can't reconstruct an existing bearer token
 * (only its hash is stored), so this issues a fresh link for the booking and
 * sends the diver straight to it. Reissuing supersedes any prior pending link,
 * which is the intended behaviour.
 */
export async function signWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) redirect(`${base(token)}?error=waiver`);
  redirect(`/waivers/${issued.token}`);
}

export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
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
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
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
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
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
  // the booking's own current payment status (Codex finding) — an edited or
  // replayed query string can't be used to claim a refund that didn't
  // happen, or hide one that did.
  //
  // Caught, not left to throw (Codex finding): the cancellation above already
  // committed and this token is already revoked, so a refund failure (a
  // transient DB error, say) must never turn an already-successful
  // cancellation into an error response — the diver would see a generic
  // failure with no way to tell the destructive action actually went
  // through, since refreshing the dead link only shows the unavailable
  // notice. Staff can still see and fix a missed refund from the booking's
  // payment record; the diver just needs the confirmation either way.
  try {
    const refund = await refundBookingOnCancellation(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
    });
    if (refund.status !== "no_policy" && refund.status !== "unpaid") {
      await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
    }
  } catch {
    console.error("Self-cancel refund could not be processed", { bookingId: ctx.bookingId });
  }
  redirect(`${base(token)}?cancelled=1`);
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
 * back an existing token for a booking id that changed. Also emails that
 * link the same way a fresh booking's confirmation does (Codex finding):
 * the redirect is the only copy of it that exists once the diver closes
 * this tab, since every link in the original confirmation email died with
 * the source booking.
 */
export async function rescheduleMyBookingAction(token: string, formData: FormData) {
  const ip = await clientIp();
  if (
    !checkRateLimit(rateLimitKey("booking-self-cancel", ip), RATE_LIMITS.bookingSelfCancel).allowed
  ) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));

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

  // The redirect below is the only copy of this link that exists the moment
  // the diver closes this tab — every readiness link from the original
  // confirmation email died with the source booking it belonged to. Deliver
  // a durable copy the same way a fresh booking does (Codex finding),
  // best-effort: the reschedule already committed, so a delivery failure
  // here must never turn it into an error page.
  if (ctx.data.person.email) {
    try {
      const origin = publicAppUrl();
      const newTrip = await getTripWithBooked(ctx.db, ctx.data.shop.id, parsedTripId.data);
      if (origin && newTrip) {
        await sendAndRecordNotification(ctx.db, {
          kind: "booking_confirmation",
          bookingId: result.newBookingId,
          shopId: ctx.data.shop.id,
          to: ctx.data.person.email,
          locale: toDiverLocale(ctx.data.shop.defaultLocale),
          diverName: ctx.data.detail.person.fullName,
          shopName: ctx.data.detail.shop.name,
          tripTitle: newTrip.title,
          startsAt: newTrip.startsAt,
          endsAt: newTrip.endsAt,
          timezone: ctx.data.detail.shop.timezone,
          readinessUrl: new URL(readinessLinkPath(capability.token), `${origin}/`).toString(),
          // `result.newBookingId` can be a *reactivated* row (the diver had,
          // and cancelled, a seat on this trip before) that already has an
          // earlier "booking_confirmation" send on record under the plain
          // per-booking key. Without this, a reschedule landing inside the
          // provider's own idempotency window would replay that earlier
          // response — the old, now-dead readiness link — instead of
          // delivering this one, and closing the tab would leave the diver
          // with only revoked links (Codex finding).
          confirmedAt: nowDate(),
        });
      }
    } catch {
      console.error("Reschedule confirmation notification could not be sent", {
        bookingId: result.newBookingId,
      });
    }
  }

  redirect(`${base(capability.token)}?saved=rescheduled`);
}
