"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { consumeBookingHandoff, offerBookingHandoffByEmail } from "@/db/booking-handoff";
import { createBookingParty, createGiftBooking, getBookingForTrip } from "@/db/bookings";
import { recordBuddyReferral, resolveBuddyReferral } from "@/db/buddy-referrals";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { sendPendingGiftPasses } from "@/db/gifts";
import { setBookingNitrox } from "@/db/nitrox";
import { sendAndRecordNotification } from "@/db/notifications";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { saveRentalFit } from "@/db/rental-fit";
import { getRedeemableShopPromo } from "@/db/shop-promos";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getActiveTripPromoByCode } from "@/db/trip-promos";
import { getTripWithBooked } from "@/db/trips";
import { joinTripWaitlist } from "@/db/waitlist";
import { issueWaiverOnJoin } from "@/db/waiver-issue";
import { diverTranslator } from "@/i18n/messages";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { BUDDY_COOKIE, buddyReferralFromCookie } from "@/lib/buddy-links";
import { perDiverBookingPriceCents } from "@/lib/courses";
import {
  declarationWithinPersonBudget,
  diveDeclarationInput,
  diveDeclarationSchema,
  toDiveDeclaration,
} from "@/lib/dive-declaration";
import { signGiftToken } from "@/lib/gift-links";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import {
  DIVER_NAME_MAX,
  DIVER_PHONE_MAX,
  diverEmailSchema,
  diverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { giftLinkPath, publicTripPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { type CertRequirementSource, combineCertRequirements } from "@/lib/readiness";
import { partnerFromReferralCookie, REFERRAL_COOKIE } from "@/lib/referrals";
import {
  hasAnyRentalPricing,
  nitroxAvailableOn,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
  type RentalFitField,
} from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { ERROR_MESSAGE_KEYS, type ErrorCode } from "./_components/types";

/** Stands in for a trip with no requirement row of its own, so its dive sites' gates still compose. */
const NO_CERT_REQUIREMENT: CertRequirementSource = {
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
};

/**
 * Absolute readiness link, for the confirmation email — and for the redirect a
 * booked diver actually follows. One capability serves both: it is where a
 * booking lands now, so minting a second for the email would burn two of the
 * booking's `MAX_LIVE_CAPABILITIES_PER_PURPOSE` slots to say the same thing.
 * Undefined when no canonical origin is configured; the relative path is what
 * the redirect uses, so a missing origin costs the email its link, never the
 * landing.
 */
function readinessEmailUrl(token: string): string | undefined {
  const origin = publicAppUrl();
  return origin ? new URL(readinessLinkPath(token), `${origin}/`).toString() : undefined;
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
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
});

/**
 * **The gift's own fields** (ADR 20260908-one-hand, decision 6, lever W).
 *
 * Who is diving (a name, because the giver is the one who knows how to reach
 * them), the one line that goes on the pass, and the giver themselves — the
 * address the receipt and the claim link go to, and the name the till reads
 * back in "a gift from …". Nothing about anybody's diving: the certification
 * and the waiver are the receiver's, asked for on their own claim.
 */
const GIFT_MESSAGE_MAX = 280;

/**
 * **No control characters, and no invisible ones** (security review of this
 * slice, finding 2).
 *
 * Every value here is free text an anonymous caller typed, and all three end up
 * somewhere a line break or a bidi override changes what a reader sees: the
 * giver's line on the claim page, both names in a staff row on Orders and at
 * the counter, and the names in the plaintext part of an outbound mail, where a
 * newline forges a line of its own. `\p{Cc}` is the C0/C1 controls (the
 * newline, the tab, the escape), `\p{Cf}` the format characters (the bidi
 * overrides, the zero-width joiners, the soft hyphen), and the two literals are
 * the non-breaking and zero-width spaces that read as nothing at all.
 *
 * Refused rather than stripped: a name DiveDay silently rewrote is a name the
 * shop cannot match against the card in the diver's hand.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\u00a0\u200b]/u;

const plainText = <T extends z.ZodType<string>>(schema: T) =>
  schema.refine((value) => !CONTROL_OR_INVISIBLE.test(value));

/**
 * The runs of whitespace a person leaves behind become one space each, so what
 * is stored is what a reader sees. Applied after the refusal above, so this is
 * only ever collapsing ordinary spaces.
 */
function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const giftSchema = z.object({
  receiverName: plainText(diverNameSchema),
  giverName: plainText(diverNameSchema),
  giverEmail: diverEmailSchema,
  message: plainText(z.string().trim().max(GIFT_MESSAGE_MAX)).optional(),
});

const emailField = diverEmailSchema;

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
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  const ip = await clientIp();

  // **"Me", or "Someone else, as a gift"** — the first choice on the form (ADR
  // 20260908-one-hand, decision 6, lever W). A gift asks three different
  // questions and lands somewhere else, so it is its own path rather than four
  // conditionals threaded through the party one. Everything the two share —
  // the trip, the capacity rule, the promo code, the checkout — is shared by
  // calling the same functions, not by branching inside them.
  if (formData.get("bookingFor") === "gift") {
    return giftSeat({ shopSlug, tripId, embed }, formData, t, ip);
  }

  // Bounded, and the bound is measured — see MAX_PUBLIC_PARTY_SIZE for the
  // numbers and for why the lock, not the row count, is what decides it.
  const partySize = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PUBLIC_PARTY_SIZE)
    .safeParse(formData.get("partySize"));
  if (!partySize.success) return { error: t(ERROR_MESSAGE_KEYS.invalid) };

  // Validate per field so the form can point at the exact box that is wrong,
  // and keep everything else the diver typed.
  const fieldErrors: Record<string, string> = {};
  const validParty: { fullName: string; email: string }[] = [];
  for (let index = 0; index < partySize.data; index++) {
    const fullName = String(formData.get(`fullName-${index}`) ?? "").trim();
    const email = String(formData.get(`email-${index}`) ?? "").trim();
    if (!fullName) fieldErrors[`fullName-${index}`] = t("booking.fieldErrors.nameRequired");
    if (fullName.length > DIVER_NAME_MAX)
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
  if (phone.length > DIVER_PHONE_MAX) fieldErrors.phone = t("booking.fieldErrors.phoneTooLong");
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
  const passThroughFeeForGear = parsePassThroughFee(shopNow.passThroughFee);
  const payablePerDiverCentsForGear =
    perDiverPriceForGear === null
      ? null
      : perDiverPriceForGear + (passThroughFeeForGear?.amountCents ?? 0);
  const stripeAccountForGear = payablePerDiverCentsForGear
    ? await getShopStripeAccount(dbi, shopNow.id)
    : null;
  const payAtBookingForGear = Boolean(
    payablePerDiverCentsForGear && canAcceptPayments(stripeAccountForGear) && publicAppUrl(),
  );
  const offersGearAtCheckout = payAtBookingForGear && hasAnyRentalPricing(shopNow.rentalPricing);
  const offeredGearItems = offeredRentableItems(shopNow.rentalItems);
  // Both gates, re-derived server-side: the shop fills nitrox, and this
  // departure's course runs on it. The checkbox is absent from the form in
  // either case (`BookingGearFields`), so a `nitrox-N=on` arriving anyway is
  // hand-crafted and must not become a request the course cannot honour.
  const nitroxOfferedAtCheckout = nitroxAvailableOn(shopNow.rentalItems, tripForGear?.course);
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

  // **This form asks nothing about anybody's diving, so nothing here reads a
  // claim from it.** It asked each diver for a rung, an agency and a number
  // between 2026-08-20 and 2026-08-27; `/ready/<token>` asks the diver whose
  // booking it is instead (product owner). The parse is gone with the fields
  // rather than left standing, for the reason the nitrox tick was taken out of
  // this action: an action that accepts what no form renders is a route a
  // hand-crafted POST has and an honest diver does not — here, one that writes
  // a self-declared certification onto a named person's record from an
  // anonymous page. The two public wait lists still ask their own joiner, in
  // their own actions, through `diveDeclarationInput`.
  //
  // One POST is one unit. The count-scaled charge that stood here existed to
  // price the declaration writes this booking could make; with no declarations
  // to write, an empty submission's protection is what is left of it.
  if (!(await checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking)).allowed) {
    return { error: t(ERROR_MESSAGE_KEYS.rate_limited) };
  }

  // Which partner's link brought this diver here, set at the edge on the
  // storefront visit (`rememberPartnerReferral`, src/proxy.ts) and normalised
  // again inside `createBookingParty`. Read here rather than from the form: a
  // hidden field would be a value the page could set, and this one is a fact
  // about how the visitor arrived.
  //
  // **Matched against this shop, not merely read.** One cookie covers the whole
  // `/s/` namespace, so a guest who opened shop A's partner link and then books
  // at shop B arrives here carrying A's referral. Crediting it would hand shop B
  // a partner it has no relationship with — and hand it, by name, a commercial
  // fact about a competitor. `partnerFromReferralCookie` refuses anything not
  // minted on this shop's own storefront, and the refusal books exactly as an
  // unreferred visit does (security review of issue #1285, finding 1).
  //
  // **Every seat of a party carries it**, the organizer's included. One person
  // booking four seats through a hotel's link is four divers that hotel sent,
  // which is the number a shop counting its partners means.
  const referralSource = partnerFromReferralCookie(
    (await cookies()).get(REFERRAL_COOKIE)?.value,
    shopSlug,
  );

  const outcome = await createBookingParty(
    dbi,
    validParty.map((entry, index) => ({
      shopId: shopNow.id,
      tripId,
      actor: "public" as const,
      fullName: entry.fullName,
      // No `declared`, and so no `admissionGate: "advise"` either: advising
      // rather than refusing was earned by the form warning a diver as they
      // answered, and there is no answer to warn about now. The sale-time gate
      // judges this booking on the shop's own record alone — which is what it
      // did before 2026-08-20, and it is still not a boarding decision.
      // Empty for any non-lead diver who left the field to the "use the main
      // contact's email" checkbox — never the lead's own address (see the
      // comment above the loop that builds `validParty`).
      email: entry.email || undefined,
      // Only the lead booker's phone is collected, so the crew can reach the party.
      phone: index === 0 && phone ? phone : undefined,
      // **Nothing about the dive itself.** "What's this dive for?" and D18's
      // three offers were posted from this form until 2026-09-06 and written
      // onto the lead's row; `/ready/<token>` asks both after the sale, of the
      // diver whose seat it is, so this transaction records only the party and
      // how to reach it.
      referralSource,
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

    // The trip's own cert gate is the one refusal that must *not* fall through
    // to "isn't taking bookings right now": the page the diver is reading says
    // "4 spots left", so the generic sentence is false and visibly so. What it
    // says instead is what the *trip* requires — the same words for every
    // submitter, describing the boat rather than the person, and revealing only
    // what the page above the form already displays (see
    // `tripRequirementList`). H-22's rule is intact: nothing here is about that
    // diver's record.
    if (outcome.reason === "trip_prerequisite") {
      const [tripRequirement, siteRequirement] = await Promise.all([
        getTripRequirements(dbi, shopNow.id, tripId),
        getTripSiteRequirement(dbi, shopNow.id, tripId),
      ]);
      const list = tripRequirementList(
        t,
        combineCertRequirements(tripRequirement ?? NO_CERT_REQUIREMENT, siteRequirement),
        locale,
      );
      if (list) {
        return {
          error: shopNow.contactEmail
            ? t("booking.errors.tripRequirementWithContact", {
                list,
                contact: shopNow.contactEmail,
              })
            : t("booking.errors.tripRequirement", { list }),
        };
      }
    }

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
  // Which diver's link brought this party, if one did. Every seat of it, the
  // organizer's included, for the reason the partner referral above credits
  // every seat: one person booking four through a friend's link is four divers
  // that friend brought.
  await Promise.all(
    outcome.bookings.map(({ bookingId }) =>
      creditBuddyReferral(dbi, { shopId: shopNow.id, shopSlug, bookingId }),
    ),
  );
  const primaryBookingId = outcome.bookings[0]?.bookingId;
  if (!primaryBookingId) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=unavailable${embedParam(embed, "&")}`);
  }
  const [confirmedBooking, tripNow] = await Promise.all([
    getBookingForTrip(dbi, tripId, primaryBookingId),
    getTripWithBooked(dbi, shopNow.id, tripId),
  ]);
  // Where this booking now lands, and what the confirmation email links to:
  // the diver's own `/ready` page (ADR 20260820-one-page-after-booking). Minted
  // here, above the email send, so both uses share the one capability.
  const readinessCapability = await issueBookingCapability(dbi, {
    shopId: shopNow.id,
    bookingId: primaryBookingId,
    purpose: "readiness",
  });
  // The door remembers who opened it (ADR 20260906-before-you-ask, decision
  // 3): the handoff this page was opened through is single-use, and the
  // booking is its one use. A stale or forged value is a no-op.
  const handoff = z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,128}$/)
    .safeParse(formData.get("handoff"));
  if (handoff.success) {
    await consumeBookingHandoff(dbi, { shopId: shopNow.id, token: handoff.data });
  }
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
        readinessUrl: readinessCapability
          ? readinessEmailUrl(readinessCapability.token)
          : undefined,
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
        // **Every one of the eleven, checked by the compiler.** The writer's
        // flags went optional so a caller with nothing to say about a piece can
        // stay quiet (issue #1755) — but this caller is the checkout, where a
        // tick is a paid line item, and a flag dropped here would take a gear
        // line the diver has been charged for off the packing list with nothing
        // failing. `satisfies` makes that omission a type error instead
        // (`security-reviewer`, issue #1754).
        const rents = {
          rentsBcd: rentedSet.has("bcd"),
          rentsRegulator: rentedSet.has("regulator"),
          rentsWetsuit: rentedSet.has("wetsuit"),
          rentsMaskFins: rentedSet.has("mask_fins"),
          rentsWeights: rentedSet.has("weights"),
          rentsDiveComputer: rentedSet.has("dive_computer"),
          rentsGopro: rentedSet.has("gopro"),
          rentsDrysuit: rentedSet.has("drysuit"),
          rentsHoodGloves: rentedSet.has("hood_gloves"),
          rentsTorch: rentedSet.has("torch"),
          rentsSmb: rentedSet.has("smb"),
        } satisfies Record<RentalFitField, boolean>;
        try {
          await saveRentalFit(dbi, {
            shopId: shopNow.id,
            personId,
            ...rents,
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

  // Only inside the embed widget. Everywhere else a booked diver goes straight
  // to `/ready`, which is a capability of its own — but `/ready/**` is
  // deliberately outside the framing allowlist (ADR 20260726-schedule-embed),
  // so redirecting there from inside a shop's iframe would swap a working
  // widget for a frame the CSP blocks. The embed instead stays on this page and
  // renders a short read-only confirmation that this token authorizes, whose
  // one way onward is a `target="_top"` link out to `/ready`. A leaked or
  // guessed booking UUID must still not be enough to see someone else's
  // booking (CR-003), which is why the embed's landing bears a token at all.
  const confirmCapability = embed
    ? await issueBookingCapability(dbi, {
        shopId: shopNow.id,
        bookingId: primaryBookingId,
        purpose: "confirm",
      })
    : null;

  // Pay at booking: when the shop can take money and the trip is priced, the
  // party goes straight to the shop's own hosted Stripe Checkout. The seats
  // are already committed above, so any failure here — no connected account,
  // no configured origin, Stripe down — degrades to the ordinary
  // book-now-pay-later confirmation, never to a lost booking.
  const base = publicTripPath(shopSlug, tripId);
  // Where this booking finishes. One page, not two: outside the embed that is
  // the diver's own `/ready`, the durable link every confirmation email and
  // reminder already carries — `?booked=1` is what tells it a seat was just
  // taken, so it opens on the celebration rather than the checklist (ADR
  // 20260820-one-page-after-booking). Inside the embed it is this page, still
  // framed, bearing the read-only `confirm` token. Either way the destination
  // is decided once, here, and Stripe's return URLs are built from it below so
  // paying and not paying land in the same place.
  //
  // A capability that somehow failed to mint degrades to the plain trip page
  // rather than a broken link — and in the embed it degrades *within the
  // frame*, never out to a `/ready` the frame cannot show.
  const landing = embed
    ? confirmCapability
      ? `${base}?booking=${confirmCapability.token}&embed=1`
      : `${base}?embed=1`
    : readinessCapability
      ? `${readinessLinkPath(readinessCapability.token)}?booked=1`
      : base;
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
  const checkoutUrl = await startCheckoutUrl(dbi, {
    shopId: shopNow.id,
    tripId,
    bookingIds: outcome.bookings.map((entry) => entry.bookingId),
    landing,
    customerEmail: validParty[0]?.email ?? "",
    promotionCode:
      tripPromo?.stripePromotionCodeId ?? shopPromo?.stripePromotionCodeId ?? undefined,
    // Whichever of the two matched, handed on so the checkout row can
    // snapshot the discount it is actually applying (PAY-M3).
    tripPromo: tripPromo
      ? {
          id: tripPromo.id,
          code: tripPromo.code,
          discountPercent: tripPromo.discountPercent,
        }
      : undefined,
    shopPromo: shopPromo
      ? { id: shopPromo.id, code: shopPromo.code, discountPercent: shopPromo.discountPercent }
      : undefined,
    gearLines,
  });
  if (checkoutUrl) {
    revalidatePath(base);
    // Inside the embed the frame stays put: Stripe's hosted page refuses to be
    // framed, so a redirect there from a shop's iframe is a blank box at the
    // exact moment the diver reached for their card. The session exists —
    // the confirmation renders it as a `target="_top"` door out to the real
    // page (ADR 20260901-diveday-reimagined, decision 2: "payment still opens
    // the real page, stated").
    if (embed) redirect(`${landing}&pay=due`);
    redirect(checkoutUrl);
  }
  revalidateAndRedirect(base, landing);
}

/**
 * **Give a dive** (ADR 20260908-one-hand, decision 6, lever W; owner's call
 * (l): yes to the gift, gift cards stay parked).
 *
 * A gift is a booking. It takes a seat the moment it is paid for, it lives on
 * the same capacity rule as every other seat, and it refunds to the card that
 * bought it when the boat cannot go. Nothing is stored that is not a seat —
 * there is no balance, no code and nothing to reconcile after the departure.
 *
 * Three things this path does **not** do, each deliberately:
 *
 * - **No readiness capability, and no confirmation to the diver.** The seat's
 *   person row is a placeholder carrying the name the giver typed and no
 *   address; `/ready` belongs to whoever claims it. The giver lands on their
 *   own page instead, which reads four facts and nothing else.
 * - **No waiver on join.** `issueWaiverOnJoin` mails the diver their release,
 *   and there is no diver yet. The claim issues it, to the claimant, which is
 *   the one person who can sign it.
 * - **No declaration, no gear.** Both are the receiver's, asked for after they
 *   claim. The form renders neither in this mode, so nothing is parsed here.
 */
async function giftSeat(
  { shopSlug, tripId, embed }: TripRef,
  formData: FormData,
  t: ReturnType<typeof diverTranslator>,
  ip: Awaited<ReturnType<typeof clientIp>>,
): Promise<BookingFormState> {
  const parsed = giftSchema.safeParse({
    receiverName: formData.get("giftReceiverName"),
    giverName: formData.get("giftGiverName"),
    giverEmail: formData.get("giftGiverEmail"),
    message: formData.get("giftMessage") || undefined,
  });
  if (!parsed.success) {
    // Per field, so the form can point at the box that is wrong and keep
    // everything else typed — the same contract the party path holds.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "receiverName") {
        fieldErrors.giftReceiverName = t("booking.fieldErrors.nameRequired");
      }
      if (field === "giverName") fieldErrors.giftGiverName = t("booking.fieldErrors.nameRequired");
      if (field === "giverEmail") {
        fieldErrors.giftGiverEmail = t("booking.fieldErrors.emailInvalid");
      }
      if (field === "message") fieldErrors.giftMessage = t("booking.fieldErrors.giftLineTooLong");
    }
    return { error: t("booking.errors.checkFields"), fieldErrors };
  }

  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) return { error: t(ERROR_MESSAGE_KEYS.unavailable) };

  // The same code box the party form has, resolved before the seat is taken
  // rather than after (task 20's rule) — a giver typing a dud code must not
  // find out on Stripe's page having already committed a seat.
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

  // One POST is one seat, on the booking budget every other seat is bought
  // from — a gift is not a cheaper way to spend it.
  if (!(await checkRateLimit(rateLimitKey("booking", ip), RATE_LIMITS.booking)).allowed) {
    return { error: t(ERROR_MESSAGE_KEYS.rate_limited) };
  }

  const referralSource = partnerFromReferralCookie(
    (await cookies()).get(REFERRAL_COOKIE)?.value,
    shopSlug,
  );

  // Collapsed once, here, so the row, the pass and the till all read the same
  // string — never the raw submission with its runs of spaces in it.
  const gift = {
    giverName: collapseSpaces(parsed.data.giverName),
    giverEmail: parsed.data.giverEmail,
    receiverName: collapseSpaces(parsed.data.receiverName),
    message: parsed.data.message ? collapseSpaces(parsed.data.message) : undefined,
  };

  const outcome = await createGiftBooking(
    dbi,
    {
      shopId: shopNow.id,
      tripId,
      actor: "public" as const,
      // The receiver, as the giver named them, and **no address**: the form
      // asks for the giver's, because the giver is the one who knows how to
      // reach their friend. A placeholder person with no email is exactly the
      // walk-in shape `createBookingRecord` already books.
      fullName: gift.receiverName,
      referralSource,
    },
    gift,
  );
  if (!outcome.ok) {
    await trackEvent({ name: "booking_blocked", source: "diver", reason: outcome.reason });
    // The same narrow refusals the party path renders, and for the same reason
    // — this form is anonymous, so a refusal describes the departure and never
    // the person behind an address (H-22).
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
    const message =
      code === "unavailable" && shopNow.contactEmail
        ? t("booking.errors.unavailableWithContact", { contact: shopNow.contactEmail })
        : t(ERROR_MESSAGE_KEYS[code]);
    return { error: message };
  }
  await trackEvent({ name: "booking_completed", source: "diver", partySize: 1 });

  const bookingId = outcome.bookingId;
  await creditBuddyReferral(dbi, { shopId: shopNow.id, shopSlug, bookingId });

  const base = publicTripPath(shopSlug, tripId);
  // Where a gift finishes: the giver's page. Never `/ready` — that is the
  // receiver's, and handing it to the giver would hand them the receiver's
  // checklist. Inside the embed the frame stays put, so a gift lands back on
  // the trip page with no token at all rather than on a page the CSP refuses
  // to frame.
  const giftPath = giftLinkPath(signGiftToken(bookingId));
  const landing = embed ? `${base}?embed=1` : giftPath;
  const checkoutUrl = await startCheckoutUrl(dbi, {
    shopId: shopNow.id,
    tripId,
    bookingIds: [bookingId],
    landing,
    // **The giver's address, so the giver's card is the one charged** — which
    // is what makes the blow-out's refund go back where the money came from
    // (`refundBookingOnShopCancellation` reverses the original capture).
    customerEmail: gift.giverEmail,
    promotionCode:
      tripPromo?.stripePromotionCodeId ?? shopPromo?.stripePromotionCodeId ?? undefined,
    tripPromo: tripPromo
      ? { id: tripPromo.id, code: tripPromo.code, discountPercent: tripPromo.discountPercent }
      : undefined,
    shopPromo: shopPromo
      ? { id: shopPromo.id, code: shopPromo.code, discountPercent: shopPromo.discountPercent }
      : undefined,
  });

  if (checkoutUrl) {
    // **The pass waits for the money** (security review of this slice, finding
    // 1). Sending it here would put branded mail carrying a stranger's text
    // into any inbox an anonymous caller can type, and would say the seat "is
    // paid for" while the giver is still looking at Stripe's page. The webhook
    // sends it when the session settles (`sendPendingGiftPasses`).
    revalidatePath(base);
    if (embed) redirect(`${landing}&pay=due`);
    redirect(checkoutUrl);
  }

  // No checkout to run — an unpriced departure, or a shop that cannot take
  // money yet. There is no later moment, so the pass goes now: the seat is
  // booked and the money is settled at the counter.
  await sendPendingGiftPasses(dbi, {
    shopId: shopNow.id,
    bookingIds: [bookingId],
    // The giver is filling this form in right now, so their own request is the
    // only first-hand evidence of the language they read.
    locale: await requestFirstHandLocale(),
  });
  revalidateAndRedirect(base, landing);
}

/**
 * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W): record which
 * diver's recap link brought this one, when one did.
 *
 * Read from the cookie the edge set, never from a hidden field — the same
 * argument the partner referral makes one function up: a form value is
 * something the page can set, and this is a fact about how the visitor arrived.
 * Matched against this shop before it is resolved, so a diver carrying another
 * shop's link books exactly as an unreferred one does.
 *
 * Never throws. A seat is a seat whether or not the shop gets to count where it
 * came from.
 */
async function creditBuddyReferral(
  dbi: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; shopSlug: string; bookingId: string },
): Promise<void> {
  try {
    const referralId = buddyReferralFromCookie(
      (await cookies()).get(BUDDY_COOKIE)?.value,
      input.shopSlug,
    );
    if (!referralId) return;
    const referredByBookingId = await resolveBuddyReferral(dbi, {
      shopId: input.shopId,
      referralId,
      bookingId: input.bookingId,
    });
    if (!referredByBookingId) return;
    await recordBuddyReferral(dbi, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      referredByBookingId,
    });
  } catch {
    console.error("Buddy referral could not be recorded", { bookingId: input.bookingId });
  }
}

/** The hosted payment page for these fresh bookings, or null when pay-at-booking can't run. */
async function startCheckoutUrl(
  dbi: Awaited<ReturnType<typeof getDb>>,
  input: {
    shopId: string;
    tripId: string;
    bookingIds: string[];
    /**
     * The same path a diver who never paid would have landed on — relative, and
     * already carrying its own query (`?booked=1`, or `?booking=…&embed=1`).
     * Paying is a detour, not a different destination: passing the decided
     * landing in rather than rebuilding it here is what stops the two from
     * drifting apart the next time either one moves.
     */
    landing: string;
    customerEmail: string;
    promotionCode?: string;
    tripPromo?: { id: string; code: string; discountPercent: number };
    shopPromo?: { id: string; code: string; discountPercent: number };
    /** Priced gear a diver chose at booking, threaded straight to `startBookingCheckout`. */
    gearLines?: Array<{ bookingId: string; description: string; amountCents: number }>;
  },
): Promise<string | null> {
  const origin = publicAppUrl();
  if (!origin || !input.customerEmail) return null;
  const returnBase = `${origin}${input.landing}`;
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
    // `&` or `?` depending on what the landing already carries — every live
    // landing has a query today, but a fallback one may not, and a malformed
    // `…/trips/x&pay=cancelled` would return the diver to a 404 at exactly the
    // moment they backed out of paying. `/ready` reads this shape already.
    cancelUrl: `${returnBase}${returnBase.includes("?") ? "&" : "?"}pay=cancelled`,
    promotionCode: input.promotionCode,
    tripPromo: input.tripPromo,
    shopPromo: input.shopPromo,
    gearLines: input.gearLines,
    describeLine: ({ isDeposit, tripTitle }) =>
      isDeposit ? t("checkoutLine.deposit", { tripTitle }) : t("checkoutLine.full", { tripTitle }),
  }).catch(() => null);
  return outcome?.ok ? (outcome.checkout.checkoutUrl ?? null) : null;
}

export async function joinWaitlist({ shopSlug, tripId, embed }: TripRef, formData: FormData) {
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("waitlist", ip), RATE_LIMITS.waitlistJoin)).allowed) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=unavailable${embedParam(embed, "&")}`);
  }
  const parsed = bookSchema.safeParse({
    fullName: formData.get("fullName-0"),
    email: formData.get("email-0"),
    phone: formData.get("phone") || undefined,
  });
  // The optional "what can you dive?" pair, parsed apart from the identity
  // fields on purpose: it is not the diver's fault if a level code arrives
  // malformed, and a wait-list join must not be refused over an answer the form
  // said was optional. A declaration that fails validation is simply not said.
  const declaration = diveDeclarationSchema.safeParse(diveDeclarationInput(formData));
  if (!parsed.success) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=invalid${embedParam(embed, "&")}`);
  }
  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=unavailable${embedParam(embed, "&")}`);
  }
  const outcome = await joinTripWaitlist(dbi, {
    shopId: shopNow.id,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone || undefined,
    // Bounded per *subject* address rather than per IP — the only key a
    // rotating set of submitters cannot clear (RATE_LIMITS.declarationByPerson).
    // An exhausted budget drops the claim; the wait-list join still succeeds,
    // the same way a malformed declaration is simply not said.
    declaration: await declarationWithinPersonBudget(
      declaration.success ? toDiveDeclaration(declaration.data) : undefined,
      { shopId: shopNow.id, email: parsed.data.email },
    ),
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "diver" });
    revalidateAndRedirect(
      publicTripPath(shopSlug, tripId),
      `${publicTripPath(shopSlug, tripId)}?waitlist=${outcome.entryId}${embedParam(embed, "&")}`,
    );
  }
  const code =
    outcome.reason === "trip_available"
      ? "available"
      : outcome.reason === "already_booked"
        ? "already"
        : "unavailable";
  redirect(`${publicTripPath(shopSlug, tripId)}?error=${code}${embedParam(embed, "&")}`);
}

/**
 * **One link to an address typed cold** (ADR 20260906-before-you-ask, decision
 * 3; H-68 b). Called from the booking form's own lead-email blur, never a page
 * load. Returns nothing whatever happened: the page must not learn whether
 * the address is on file, and the delivery row keeps it to one an hour.
 */
export async function offerHandoff({ shopSlug, tripId }: TripRef, email: string): Promise<void> {
  const parsed = z
    .object({ email: diverEmailSchema, tripId: z.uuid() })
    .safeParse({ email, tripId });
  if (!parsed.success) return;
  // The same per-IP bucket every capability action sits behind: this one is
  // reachable by anyone, and without it is a way to make a shop mail a
  // person on demand.
  const ip = await clientIp();
  const limit = await checkRateLimit(
    rateLimitKey("booking-handoff-offer", ip),
    RATE_LIMITS.capabilityAction,
  );
  if (!limit.allowed) return;
  const origin = publicAppUrl();
  const locale = await requestLocale();
  // **Off the request path.** The lookup and the send run after the response
  // has gone, so the action returns in the same time and shape whether the
  // address is on file or not — a slower answer for a known address would be
  // the oracle the page itself is built not to be.
  after(async () => {
    try {
      const db = await getDb();
      const shop = await getShopBySlug(db, shopSlug);
      if (!shop) return;
      await offerBookingHandoffByEmail(db, {
        shopId: shop.id,
        tripId: parsed.data.tripId,
        email: parsed.data.email,
        origin,
        requestLocale: locale,
      });
    } catch {
      // A link that fails to send is the cold form the diver already has.
    }
  });
}
