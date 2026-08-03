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
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { saveRentalFit } from "@/db/rental-fit";
import { getRedeemableShopPromo } from "@/db/shop-promos";
import { getShopById, getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getActiveTripPromoByCode } from "@/db/trip-promos";
import { getTripWithBooked } from "@/db/trips";
import { joinTripWaitlist } from "@/db/waitlist";
import { issueWaiverOnJoin } from "@/db/waiver-issue";
import { issueWaiverRequest } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import {
  hasAnyRentalPricing,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
  shopOffersNitrox,
} from "@/lib/rentals";
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
  if (
    !(await checkRateLimit(rateLimitKey("confirm-token", ip), RATE_LIMITS.capabilityAction)).allowed
  ) {
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
  if (!(await checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking)).allowed) {
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

  // Gear selection ahead of the first checkout (docs ADR
  // 20260801-checkout-upsells-rental-gear): only when the shop has actually
  // priced rental gear online *and* checkout is actually going to run — a
  // shop that hasn't, or a trip/account that isn't payable, keeps today's
  // book-first, fit-later flow with no gear step at all. This must mirror
  // page.tsx's own `payAtBooking` computation exactly: `BookingGearFields`
  // only renders (and only submits `gear-${index}-*`/`nitrox-${index}` fields)
  // under that same condition, so parsing them under a looser one here would
  // read every checkbox as unchecked and silently zero out the diver's fit.
  const tripForGear = await getTripWithBooked(dbi, shopNow.id, tripId);
  const perDiverPriceForGear = tripForGear
    ? perDiverBookingPriceCents(tripForGear, tripForGear.course)
    : null;
  const stripeAccountForGear = perDiverPriceForGear
    ? await getShopStripeAccount(dbi, shopNow.id)
    : null;
  const payAtBookingForGear = Boolean(
    perDiverPriceForGear && canAcceptPayments(stripeAccountForGear) && publicAppUrl(),
  );
  const offersGearAtCheckout = payAtBookingForGear && hasAnyRentalPricing(shopNow.rentalPricing);
  const offeredGearItems = offeredRentableItems(shopNow.rentalItems);
  const nitroxOfferedAtCheckout = shopOffersNitrox(shopNow.rentalItems);
  const gearSelections: Array<{ rentedKinds: RentableItemKind[]; wantsNitrox: boolean }> = [];
  const plannedDives = tripForGear?.plannedDives ?? 2;
  if (offersGearAtCheckout && (offeredGearItems.length > 0 || nitroxOfferedAtCheckout)) {
    for (let index = 0; index < partySize.data; index++) {
      gearSelections.push({
        rentedKinds: offeredGearItems
          .filter((item) => formData.get(`gear-${index}-${item.name}`) === "on")
          .map((item) => item.kind),
        wantsNitrox: nitroxOfferedAtCheckout && formData.get(`nitrox-${index}`) === "on",
      });
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
  // This form is the diver's own — the public schedule page, submitted from
  // their device — so its `Accept-Language` is first-hand evidence of the
  // language the lead booker reads (docs ADR
  // 20260731-per-person-notification-locale). Only the lead's: every other
  // party member's name and address were typed *by* the lead, and this header
  // says nothing about what those divers read.
  const ownLocale = await requestFirstHandLocale();
  // Through the booking-scoped writer, not the person-scoped one: it refuses
  // an identity-unconfirmed booking, which is what stops someone who merely
  // knows a diver's email address from re-languaging that diver's mail by
  // booking a seat in their name (H-13, security-reviewer finding).
  await recordDiverOwnLocaleForBooking(dbi, {
    bookingId: primaryBookingId,
    locale: ownLocale,
  });
  if (confirmedBooking?.person.email && tripNow) {
    try {
      const delivery = await sendAndRecordNotification(dbi, {
        kind: "booking_confirmation",
        bookingId: primaryBookingId,
        shopId: shopNow.id,
        to: confirmedBooking.person.email,
        locale: recipientLocale(ownLocale ?? confirmedBooking.person.locale, shopNow.defaultLocale),
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

  // Persist each diver's chosen gear (and nitrox request) the moment their
  // booking exists — the same durable record `saveRentalFit`/`setBookingNitrox`
  // already write from the post-booking form, just written a step earlier. The
  // seats are already committed, so a write failure here is logged and
  // dropped, never turned into a booking error (docs ADR
  // 20260801-checkout-upsells-rental-gear).
  if (offersGearAtCheckout) {
    await Promise.all(
      outcome.bookings.map(async ({ bookingId, personId }, index) => {
        const selection = gearSelections[index];
        if (!selection) return;
        const rentedSet = new Set(selection.rentedKinds);
        try {
          await saveRentalFit(dbi, {
            shopId: shopNow.id,
            personId,
            rentsBcd: rentedSet.has("bcd"),
            rentsRegulator: rentedSet.has("regulator"),
            rentsWetsuit: rentedSet.has("wetsuit"),
            rentsMaskFins: rentedSet.has("mask_fins"),
            rentsWeights: rentedSet.has("weights"),
            rentsDiveComputer: rentedSet.has("dive_computer"),
            rentsGopro: rentedSet.has("gopro"),
          });
          if (nitroxOfferedAtCheckout) {
            await setBookingNitrox(dbi, {
              shopId: shopNow.id,
              bookingId,
              wantsNitrox: selection.wantsNitrox,
            });
          }
        } catch {
          console.error("Rental fit at booking could not be saved", { bookingId });
        }
      }),
    );
  }

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
  //
  // One priced gear line per diver whose selection actually quotes to
  // something — an item the shop hasn't priced online never reaches here
  // (quoteRentalFit already leaves it off the subtotal), so it stays
  // "settled at the shop" exactly as the post-booking form describes it.
  const gearLines = offersGearAtCheckout
    ? outcome.bookings
        .map(({ bookingId, personName }, index) => {
          const selection = gearSelections[index];
          if (!selection) return null;
          const quote = quoteRentalFit(shopNow.rentalPricing, {
            rentedKinds: selection.rentedKinds,
            offeredKinds: offeredGearItems.map((item) => item.kind),
            wantsNitrox: selection.wantsNitrox,
            plannedDives,
          });
          if (quote.subtotalCents <= 0) return null;
          return {
            bookingId,
            amountCents: quote.subtotalCents,
            description:
              validParty.length > 1
                ? t("checkoutLine.gearForDiver", { name: personName })
                : t("checkoutLine.gear"),
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null)
    : [];
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
        gearLines,
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
    /** Priced gear a diver chose at booking, threaded straight to `startBookingCheckout`. */
    gearLines?: Array<{ bookingId: string; description: string; amountCents: number }>;
  },
): Promise<string | null> {
  const origin = publicAppUrl();
  if (!origin || !input.customerEmail) return null;
  const returnBase = `${origin}/shop/${input.shopSlug}/schedule/${input.tripId}?booking=${input.confirmToken}${embedParam(input.embed, "&")}`;
  // The hosted Stripe line's words come from the diver's bundle, not from
  // `src/db` (docs ADR 20260731-domain-layer-copy-leaks). Both callers of this
  // helper are diver-initiated requests, so the negotiated request locale is
  // the language the diver is reading the page in right now.
  const t = diverTranslator(await requestLocale());
  const outcome = await startBookingCheckout(dbi, {
    shopId: input.shopId,
    tripId: input.tripId,
    bookingIds: input.bookingIds,
    customerEmail: input.customerEmail,
    successUrl: returnBase,
    cancelUrl: `${returnBase}&pay=cancelled`,
    promotionCode: input.promotionCode,
    shopPromo: input.shopPromo,
    gearLines: input.gearLines,
    describeLine: ({ isDeposit, tripTitle }) =>
      isDeposit ? t("checkoutLine.deposit", { tripTitle }) : t("checkoutLine.full", { tripTitle }),
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

/**
 * "Sign your waiver now" from the confirmation panel — the same one-hop shape
 * `/ready` already offers (`signWaiverFromReady`), moved to the moment a diver
 * actually finishes booking, when the waiver is the real next step.
 *
 * A waiver URL *is* its capability, so two things keep this honest. The booking
 * comes from the verified `confirm` capability and nothing else — never a
 * booking id, party index, or person id from the client — so this can only ever
 * reach the *lead* diver's own waiver, never another party member's, whatever a
 * caller submits. And the fresh signing link is only ever handed over as a
 * redirect: it is never rendered into the confirmation page, so the URL a diver
 * may screenshot, share, or leave in browser history never carries a waiver
 * capability of its own. `confirmContextFor` rate-limits by IP ahead of
 * verification, as it does for every other action bound to this token.
 */
export async function signWaiverFromConfirmation(
  { shopSlug, tripId, token, embed }: RentalFitRef,
  _formData: FormData,
) {
  const base = `/shop/${shopSlug}/schedule/${tripId}`;
  const failed = `${base}?booking=${token}&error=waiver${embedParam(embed, "&")}`;
  const ctx = await confirmContextFor(tripId, token);
  if (!ctx) redirect(failed);
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.capability.shopId,
    bookingId: ctx.capability.bookingId,
  });
  if (!issued.ok) redirect(failed);
  redirect(`/waivers/${issued.token}`);
}

export async function joinWaitlist({ shopSlug, tripId, embed }: TripRef, formData: FormData) {
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("waitlist", ip), RATE_LIMITS.waitlistJoin)).allowed) {
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
