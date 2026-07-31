"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty, getBookingForTrip } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { type AppDb, getDb } from "@/db/client";
import { setBookingNitrox } from "@/db/nitrox";
import { sendAndRecordNotification } from "@/db/notifications";
import { saveRentalFit } from "@/db/rental-fit";
import { getRedeemableShopPromo } from "@/db/shop-promos";
import { getShopById, getShopBySlug } from "@/db/shops";
import { getActiveTripPromoByCode } from "@/db/trip-promos";
import { getTripWithBooked } from "@/db/trips";
import { joinTripWaitlist } from "@/db/waitlist";
import { issueWaiverOnJoin } from "@/db/waiver-issue";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { toDiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { shopOffersNitrox } from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";
import { ERROR_MESSAGE_KEYS, type ErrorCode } from "./_components/types";

/** Absolute readiness link for the confirmation email, or undefined with no origin/booking. */
async function readinessEmailUrl(
  dbi: AppDb,
  shopId: string,
  bookingId: string,
): Promise<string | undefined> {
  const origin = publicAppUrl();
  if (!origin) return undefined;
  const capability = await issueBookingCapability(dbi, { shopId, bookingId, purpose: "readiness" });
  return capability
    ? new URL(readinessLinkPath(capability.token), `${origin}/`).toString()
    : undefined;
}

/** Bound to each action so the public page can stay a pure renderer. */
export type TripRef = {
  shopSlug: string;
  tripId: string;
  /** True inside the embed widget (docs ADR 20260726-schedule-embed) — every
   * redirect this file constructs carries it forward, so a book/waitlist/pay
   * transition never drops the diver out of the compact surface and back
   * into full page chrome. */
  embed?: boolean;
};

/** `&embed=1` after an existing query, `?embed=1` to start one — never plain mode. */
function embedParam(embed: boolean | undefined, delimiter: "&" | "?"): string {
  return embed ? `${delimiter}embed=1` : "";
}
/**
 * `token` is a purpose-bound `confirm` capability (src/db/booking-capabilities.ts), never a raw
 * booking id: every action below re-verifies it and derives shop/booking/person identity from
 * that verification, so a bound closure can never be used to act on a booking the token doesn't
 * actually authorize (CR-003).
 */
export type RentalFitRef = TripRef & { token: string };

/**
 * Resolve a `confirm` token to its live booking context, or null on anything
 * invalid. Rate-limited by IP before verification, so this one chokepoint
 * throttles every action in this file that confirms a booking token
 * (rental fit, pay-for-booking) against both guessing and replay spam of a
 * known link (CR-013).
 */
async function confirmContextFor(tripId: string, token: string) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("confirm-token", ip), RATE_LIMITS.capabilityAction).allowed) {
    return null;
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "confirm" });
  if (!capability) return null;
  const confirmed = await getBookingForTrip(db, tripId, capability.bookingId);
  if (!confirmed) return null;
  return { db, capability, confirmed };
}

/**
 * What a failed booking submit hands back to the form. A validation failure
 * returns per-field messages so the client re-renders in place with everything
 * still typed, instead of the old redirect that discarded the whole party.
 * Success never returns — it redirects to the confirmation (or Stripe).
 */
export type BookingFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const bookSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
});

const emailField = z.email().max(200);

const rentalFitSchema = z.object({
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

export async function bookSpot(
  { shopSlug, tripId, embed }: TripRef,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  // Locale for every error this action can hand back, resolved once up
  // front — a Client Component reads `state.error` straight from
  // `useActionState` with no further round trip through a Server Component,
  // so it has to arrive already translated (unlike the `?error=` codes that
  // flow back through page.tsx, which resolves them itself).
  const t = diverTranslator(await requestLocale());
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking).allowed) {
    return { error: t(ERROR_MESSAGE_KEYS.rate_limited) };
  }

  const partySize = z.coerce.number().int().min(1).max(6).safeParse(formData.get("partySize"));
  if (!partySize.success) return { error: t(ERROR_MESSAGE_KEYS.invalid) };

  // Validate per field so the form can point at the exact box that is wrong,
  // and keep everything else the diver typed.
  const fieldErrors: Record<string, string> = {};
  const validParty: { fullName: string; email: string }[] = [];
  for (let index = 0; index < partySize.data; index++) {
    const fullName = String(formData.get(`fullName-${index}`) ?? "").trim();
    const email = String(formData.get(`email-${index}`) ?? "").trim();
    if (!fullName) fieldErrors[`fullName-${index}`] = t("booking.fieldErrors.nameRequired");
    if (fullName.length > 120)
      fieldErrors[`fullName-${index}`] = t("booking.fieldErrors.nameTooLong");
    // The lead booker's email is the one address DiveDay actually uses (the
    // confirmation, the waiver, the readiness link) and stays required.
    // Every other party member's is optional (task 21) — a disabled "use the
    // main contact's email" checkbox in BookingPartyFields.tsx simply omits
    // the field from the submission, and an empty non-lead email books that
    // diver through the same no-email walk-in path a counter booking already
    // uses (src/db/bookings.ts), never by writing the lead's own address onto
    // a second person row (which would collide as "already booked" the
    // moment a third member also opted in).
    if (index === 0 && !email) {
      fieldErrors[`email-${index}`] = t("booking.fieldErrors.emailInvalid");
    } else if (email && !emailField.safeParse(email).success) {
      fieldErrors[`email-${index}`] = t("booking.fieldErrors.emailInvalid");
    }
    validParty.push({ fullName, email });
  }
  const phone = String(formData.get("phone") ?? "").trim();
  const groupPreference = String(formData.get("groupPreference") ?? "").trim();
  if (phone.length > 30) fieldErrors.phone = t("booking.fieldErrors.phoneTooLong");
  if (groupPreference.length > 300)
    fieldErrors.groupPreference = t("booking.fieldErrors.noteTooLong");
  if (Object.keys(fieldErrors).length > 0) {
    return { error: t("booking.errors.checkFields"), fieldErrors };
  }

  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) return { error: t(ERROR_MESSAGE_KEYS.unavailable) };

  // Validate a typed promo code before the party is booked, not after (task
  // 20) — the old order resolved it only once building the Stripe checkout,
  // so an invalid code silently didn't discount and the diver found out on
  // Stripe's own page having already committed seats. `isPromoRedeemable`'s
  // own contract is that every failure reason looks identical to the diver
  // (unknown code, wrong scope, expired, not started) — reusing that here
  // keeps this check from becoming a second oracle for enumerating a shop's
  // live codes; it only ever says "doesn't apply".
  const promoCodeInput = String(formData.get("promoCode") ?? "").trim();
  let tripPromo: Awaited<ReturnType<typeof getActiveTripPromoByCode>> = null;
  let shopPromo: Awaited<ReturnType<typeof getRedeemableShopPromo>> = null;
  if (promoCodeInput) {
    const tripForPromo = await getTripWithBooked(dbi, shopNow.id, tripId);
    tripPromo = await getActiveTripPromoByCode(dbi, {
      shopId: shopNow.id,
      tripId,
      code: promoCodeInput,
    });
    shopPromo = tripPromo
      ? null
      : await getRedeemableShopPromo(dbi, {
          shopId: shopNow.id,
          code: promoCodeInput,
          kind: tripForPromo?.courseId ? "course" : "trip",
        });
    if (!tripPromo && !shopPromo) {
      return {
        error: t("booking.errors.checkFields"),
        fieldErrors: { promoCode: t("booking.fieldErrors.promoInvalid") },
      };
    }
  }

  const outcome = await createBookingParty(
    dbi,
    validParty.map((entry, index) => ({
      shopId: shopNow.id,
      tripId,
      actor: "public" as const,
      fullName: entry.fullName,
      // Empty for any non-lead diver who left the field to the "use the main
      // contact's email" checkbox — never the lead's own address (see the
      // comment above the loop that builds `validParty`).
      email: entry.email || undefined,
      // Only the lead booker's phone is collected, so the crew can reach the party.
      phone: index === 0 && phone ? phone : undefined,
      groupPreference: groupPreference || undefined,
    })),
  );
  if (!outcome.ok) {
    // This form is anonymous (the schedule route is auth-exempt), and the
    // submitter is only ever asked for a name and an email — never proof that
    // either is theirs. So a refusal here must not describe *the person behind
    // that email*, only the trip. `course_min_age` in particular would
    // otherwise answer "is the holder of this address a child under N?" to
    // anyone who can guess an address, and the seeded course minimums (10, 12,
    // 15, 18) let a handful of probes bracket a real child's age. It runs
    // before the capacity check, so probing a full trip is free and leaves no
    // booking behind. Staff surfaces keep the specific wording — there the
    // actor is authenticated and entitled to the diver's record.
    await trackEvent({ name: "booking_blocked", source: "diver", reason: outcome.reason });
    const code: ErrorCode =
      outcome.reason === "trip_full"
        ? "full"
        : outcome.reason === "already_booked"
          ? "already"
          : outcome.reason === "course_unstaffed"
            ? "course-unavailable"
            : outcome.reason === "course_ratio_full"
              ? "course-ratio-full"
              : "unavailable";
    // "already_booked" is the one refusal that names a specific party member
    // (task 25) — `createBookingParty` reports which index it rolled back
    // on, so the form can highlight that diver's fieldset instead of the
    // generic top-of-form banner reading as if diver 1 were the problem when
    // it was diver 4 (src/db/bookings.ts "rolls back the whole party" is the
    // contract this reads off of). Every other refusal reason isn't about
    // any one member, so it stays the plain banner.
    const memberFieldErrors =
      code === "already" && outcome.failedIndex !== undefined
        ? { [`email-${outcome.failedIndex}`]: t(ERROR_MESSAGE_KEYS[code]) }
        : undefined;
    const message =
      code === "unavailable" && shopNow.contactEmail
        ? t("booking.errors.unavailableWithContact", { contact: shopNow.contactEmail })
        : t(ERROR_MESSAGE_KEYS[code]);
    return { error: message, fieldErrors: memberFieldErrors };
  }
  await trackEvent({ name: "booking_completed", source: "diver", partySize: validParty.length });
  const primaryBookingId = outcome.bookings[0]?.bookingId;
  if (!primaryBookingId) {
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable${embedParam(embed, "&")}`);
  }
  const [confirmedBooking, tripNow] = await Promise.all([
    getBookingForTrip(dbi, tripId, primaryBookingId),
    getTripWithBooked(dbi, shopNow.id, tripId),
  ]);
  if (confirmedBooking?.person.email && tripNow) {
    try {
      const delivery = await sendAndRecordNotification(dbi, {
        kind: "booking_confirmation",
        bookingId: primaryBookingId,
        shopId: shopNow.id,
        to: confirmedBooking.person.email,
        locale: toDiverLocale(shopNow.defaultLocale),
        diverName: confirmedBooking.person.fullName,
        shopName: shopNow.name,
        tripTitle: tripNow.title,
        startsAt: tripNow.startsAt,
        endsAt: tripNow.endsAt,
        timezone: shopNow.timezone,
        dockCallMinutes: shopNow.dockCallMinutes,
        readinessUrl: await readinessEmailUrl(dbi, shopNow.id, primaryBookingId),
        packingList: shopNow.packingList,
      });
      if (delivery.status === "failed") {
        console.error("Booking confirmation notification failed", {
          bookingId: primaryBookingId,
        });
      }
    } catch {
      // Email must never turn a completed, capacity-safe booking into an error page.
      console.error("Booking confirmation notification could not be prepared", {
        bookingId: primaryBookingId,
      });
    }
  }
  // Send each diver their waiver the moment they join, when the trip needs one
  // and they aren't already covered (issueWaiverOnJoin makes that call). The
  // seats are already committed, so a delivery failure is logged and dropped —
  // it must never turn a completed booking into an error.
  await Promise.all(
    outcome.bookings.map(async ({ bookingId }) => {
      try {
        await issueWaiverOnJoin(dbi, shopNow.id, bookingId);
      } catch {
        console.error("Waiver-on-join could not be issued", { bookingId });
      }
    }),
  );

  // The confirmation URL/action bears a purpose-bound `confirm` capability,
  // never the raw booking id — a leaked/guessed booking UUID must not be
  // enough to view or mutate someone else's booking (CR-003). A same-shop
  // recheck right after creation should never fail, but if it somehow does,
  // fall back to the plain trip page rather than a broken/unauthenticated link.
  const confirmCapability = await issueBookingCapability(dbi, {
    shopId: shopNow.id,
    bookingId: primaryBookingId,
    purpose: "confirm",
  });

  // Pay at booking: when the shop can take money and the trip is priced, the
  // party goes straight to the shop's own hosted Stripe Checkout. The seats
  // are already committed above, so any failure here — no connected account,
  // no configured origin, Stripe down — degrades to the ordinary
  // book-now-pay-later confirmation, never to a lost booking.
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  // `tripPromo`/`shopPromo` were already resolved above, before the party was
  // booked (task 20) — an invalid/expired/wrong-scope code now fails the
  // submit itself with a field error, rather than being silently dropped
  // here and only surfacing on Stripe's own page. Two kinds of code share
  // this one field, and the diver can't tell them apart: a trip-scoped
  // last-minute deal (docs ADR 20260727-last-minute-fill-promos) and a
  // shop-wide code (docs ADR 20260729-shop-promo-codes) — the trip-scoped
  // lookup ran first, as the more specific match, and only one is ever
  // applied: Stripe Checkout takes a single promotion code.
  const checkoutUrl = confirmCapability
    ? await startCheckoutUrl(dbi, {
        shopId: shopNow.id,
        shopSlug,
        tripId,
        bookingIds: outcome.bookings.map((entry) => entry.bookingId),
        confirmToken: confirmCapability.token,
        customerEmail: validParty[0]?.email ?? "",
        embed,
        promotionCode:
          tripPromo?.stripePromotionCodeId ?? shopPromo?.stripePromotionCodeId ?? undefined,
        shopPromo: shopPromo ? { id: shopPromo.id, code: shopPromo.code } : undefined,
      })
    : null;
  if (checkoutUrl) {
    revalidatePath(base);
    redirect(checkoutUrl);
  }
  revalidateAndRedirect(
    base,
    confirmCapability
      ? `${base}?booking=${confirmCapability.token}${embedParam(embed, "&")}`
      : `${base}${embedParam(embed, "?")}`,
  );
}

/** The hosted payment page for these fresh bookings, or null when pay-at-booking can't run. */
async function startCheckoutUrl(
  dbi: Awaited<ReturnType<typeof getDb>>,
  input: {
    shopId: string;
    shopSlug: string;
    tripId: string;
    bookingIds: string[];
    confirmToken: string;
    customerEmail: string;
    embed?: boolean;
    promotionCode?: string;
    shopPromo?: { id: string; code: string };
  },
): Promise<string | null> {
  const origin = publicAppUrl();
  if (!origin || !input.customerEmail) return null;
  const returnBase = `${origin}/shop/${input.shopSlug}/schedule/${input.tripId}?booking=${input.confirmToken}${embedParam(input.embed, "&")}`;
  const outcome = await startBookingCheckout(dbi, {
    shopId: input.shopId,
    tripId: input.tripId,
    bookingIds: input.bookingIds,
    customerEmail: input.customerEmail,
    successUrl: returnBase,
    cancelUrl: `${returnBase}&pay=cancelled`,
    promotionCode: input.promotionCode,
    shopPromo: input.shopPromo,
  }).catch(() => null);
  return outcome?.ok ? (outcome.checkout.checkoutUrl ?? null) : null;
}

/**
 * "Finish paying" from the confirmation panel: reuses the open Stripe session
 * when one exists, mints a new one after an expiry, and sends the diver to it.
 */
export async function payForBooking(
  { shopSlug, tripId, token, embed }: RentalFitRef,
  _formData: FormData,
) {
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const ctx = await confirmContextFor(tripId, token);
  const checkoutUrl = ctx?.confirmed.person.email
    ? await startCheckoutUrl(ctx.db, {
        shopId: ctx.capability.shopId,
        shopSlug,
        tripId,
        bookingIds: [ctx.capability.bookingId],
        confirmToken: token,
        customerEmail: ctx.confirmed.person.email,
        embed,
      })
    : null;
  if (checkoutUrl) redirect(checkoutUrl);
  redirect(`${base}?booking=${token}&error=pay${embedParam(embed, "&")}`);
}

export async function joinWaitlist({ shopSlug, tripId, embed }: TripRef, formData: FormData) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("waitlist", ip), RATE_LIMITS.waitlistJoin).allowed) {
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable${embedParam(embed, "&")}`);
  }
  const parsed = bookSchema.safeParse({
    fullName: formData.get("fullName-0"),
    email: formData.get("email-0"),
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) {
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=invalid${embedParam(embed, "&")}`);
  }
  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) {
    redirect(`/shop/${shopSlug}/schedule/${tripId}?error=unavailable${embedParam(embed, "&")}`);
  }
  const outcome = await joinTripWaitlist(dbi, {
    shopId: shopNow.id,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone || undefined,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "diver" });
    revalidateAndRedirect(
      `/shop/${shopSlug}/schedule/${tripId}`,
      `/shop/${shopSlug}/schedule/${tripId}?waitlist=${outcome.entryId}${embedParam(embed, "&")}`,
    );
  }
  const code =
    outcome.reason === "trip_available"
      ? "available"
      : outcome.reason === "already_booked"
        ? "already"
        : "unavailable";
  redirect(`/shop/${shopSlug}/schedule/${tripId}?error=${code}${embedParam(embed, "&")}`);
}

/**
 * Saves the diver's reusable rental fit and, separately, whether they want
 * enriched air on this booking. A diver may request nitrox before their card is
 * verified: the request is recorded and flagged (src/db/nitrox.ts), and the fill
 * is re-checked against a verified card downstream, so an uncertified request
 * never becomes a nitrox tank on its own.
 */
export async function saveRentalFitRequest(
  { shopSlug, tripId, token, embed }: RentalFitRef,
  formData: FormData,
) {
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const ctx = await confirmContextFor(tripId, token);
  if (!ctx) redirect(`${base}?booking=${token}&error=fit${embedParam(embed, "&")}`);
  const parsed = rentalFitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base}?booking=${token}&error=fit${embedParam(embed, "&")}`);
  const saved = await saveRentalFit(ctx.db, {
    shopId: ctx.capability.shopId,
    personId: ctx.confirmed.person.id,
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
  // when the checkbox could have been there at all, so an unrelated save (a
  // note, a size) never silently clears a request recorded while the shop
  // still offered it.
  const shop = await getShopById(ctx.db, ctx.capability.shopId);
  if (shop && shopOffersNitrox(shop.rentalItems)) {
    await setBookingNitrox(ctx.db, {
      shopId: ctx.capability.shopId,
      bookingId: ctx.capability.bookingId,
      wantsNitrox: parsed.data.nitrox === "on",
    });
  }
  const result = saved ? "fit=saved" : "error=fit";
  revalidateAndRedirect(base, `${base}?booking=${token}&${result}${embedParam(embed, "&")}`);
}
