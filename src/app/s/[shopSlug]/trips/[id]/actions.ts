"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { type BookingDeclaration, createBookingParty, getBookingForTrip } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
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
import { perDiverBookingPriceCents } from "@/lib/courses";
import {
  type DiveDeclaration,
  diveDeclarationInput,
  diveDeclarationInputAt,
  diveDeclarationSchema,
  toDiveDeclaration,
} from "@/lib/dive-declaration";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import {
  DIVER_NAME_MAX,
  DIVER_PHONE_MAX,
  diverEmailSchema,
  diverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { publicTripPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { type CertRequirementSource, combineCertRequirements } from "@/lib/readiness";
import {
  hasAnyRentalPricing,
  nitroxAvailableOn,
  offeredRentableItems,
  quoteRentalFit,
  type RentableItemKind,
} from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";
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

const emailField = diverEmailSchema;

/**
 * One diver's parsed answer, narrowed to what a booking may carry: the rung
 * they named — with the agency and card number, if they gave them — or the
 * statement that they hold no card at all. A declaration with neither is
 * dropped to `undefined`, the same as "Rather not say", so an empty select
 * never writes a row.
 *
 * **Narrowed by listing, which is why it is worth a function.** It drops the
 * nitrox tick, which no public form renders and which a hand-crafted post must
 * not smuggle through. The cost of that shape is that a field added upstream is
 * silently *not* carried until it is named here: the agency and number were
 * added to the declaration on 2026-08-21 and reached the writer only once this
 * function was told about them.
 */
function declarationFor(declared: DiveDeclaration | null): BookingDeclaration | undefined {
  if (declared?.level) {
    return {
      level: declared.level,
      noCertification: declared.noCertification,
      // The card the diver described, which travels only with a level — an
      // agency and a number are facts *about* a rung, and `toDiveDeclaration`
      // has already dropped both if there is no rung to describe.
      agency: declared.agency,
      identifier: declared.identifier,
    };
  }
  if (declared?.noCertification) return { noCertification: true };
  return undefined;
}

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
  const groupPreference = String(formData.get("groupPreference") ?? "").trim();
  if (phone.length > DIVER_PHONE_MAX) fieldErrors.phone = t("booking.fieldErrors.phoneTooLong");
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

  // **What each diver said about their own diving**, read for this decision and
  // written only if the booking completes (`persistDeclaration`). One answer
  // per seat, because a party booking is several people and the question used
  // to be asked once — leaving every seat but the lead's screened by nothing.
  //
  // A slot whose answer is unparseable or absent contributes `undefined`, which
  // is the same as "Rather not say": a malformed value must never be read as a
  // claim, and must never fail the booking for the other five people either.
  const declaredByIndex = validParty.map((_, index) => {
    const parsed = diveDeclarationSchema.safeParse(diveDeclarationInputAt(formData, index));
    return parsed.success ? toDiveDeclaration(parsed.data) : null;
  });

  const outcome = await createBookingParty(
    dbi,
    validParty.map((entry, index) => ({
      shopId: shopNow.id,
      tripId,
      actor: "public" as const,
      fullName: entry.fullName,
      // Only what the form actually renders. The nitrox tick appears on no
      // public form, so `diveDeclarationInputAt` never reads one — honouring a
      // hand-crafted `nitroxCertified=on` would clear a nitrox-gated sale by a
      // route no honest diver on this page has, and plant an enriched-air claim
      // on their record besides. Same discipline the gear checkboxes are held
      // to. The level is the whole question here.
      declared: declarationFor(declaredByIndex[index] ?? null),
      // The one caller that advises rather than refuses: this form asks each
      // diver what they hold and warns them, as they answer, when it is below
      // what the departure asks for — so the stop earned nothing and only ever
      // caught the diver who answered honestly and short. Readiness still
      // decides who boards. See `BookingRequest.admissionGate`.
      admissionGate: "advise" as const,
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
    redirect(checkoutUrl);
  }
  revalidateAndRedirect(base, landing);
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
    declaration: declaration.success ? toDiveDeclaration(declaration.data) : undefined,
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
