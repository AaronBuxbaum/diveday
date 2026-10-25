"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueBookedReadinessLinks, issueBookingCapability } from "@/db/booking-capabilities";
import { consumeBookingHandoff, offerBookingHandoffByEmail } from "@/db/booking-handoff";
import { createBookingParty, getBookingForTrip } from "@/db/bookings";
import { recordBuddyReferral, resolveBuddyReferral } from "@/db/buddy-referrals";
import { type CheckoutPromo, startBookingCheckout } from "@/db/checkouts";
import { type AppDb, getDb } from "@/db/client";
import { recordShopMilestone } from "@/db/founder-metrics";
import { askForDeparture } from "@/db/interests";
import { busyOnLockWait } from "@/db/lock-bounds";
import { sendAndRecordNotification } from "@/db/notifications";
import { recordDiverOwnLocaleForBooking } from "@/db/people";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getRedeemableShopPromo } from "@/db/shop-promos";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { getActiveTripPromoByCode } from "@/db/trip-promos";
import { getTripWithBooked } from "@/db/trips";
import {
  issueJoinWaiverLink,
  issueWaiverOnJoin,
  settleJoinWaiverDelivery,
} from "@/db/waiver-issue";
import { diverTranslator } from "@/i18n/messages";
import { describeCheckoutLine } from "@/i18n/participant-labels";
import { tripRequirementList } from "@/i18n/readiness-labels";
import { requestFirstHandLocale, requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { readinessLinkPath } from "@/lib/booking-capabilities";
import { BUDDY_COOKIE, buddyReferralFromCookie } from "@/lib/buddy-links";
import { perDiverBookingPriceCents, readLearningMaterials } from "@/lib/courses";
import {
  declarationWithinPersonBudget,
  diveDeclarationInput,
  diveDeclarationSchema,
  toDiveDeclaration,
} from "@/lib/dive-declaration";
import { packsLogbook } from "@/lib/diver-planning";
import { formValue, parseForm, readForm, trimmedText } from "@/lib/form-parse";
import { log } from "@/lib/log";
import { revalidateAndRedirect } from "@/lib/navigation";
import { type Notification, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { confirmationExtras } from "@/lib/notifications/confirmation-extras";
import { isDiver, type ParticipantType, parsePartyTypes, rentsKind } from "@/lib/participant-types";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import {
  DIVER_NAME_MAX,
  DIVER_PHONE_MAX,
  diverEmailSchema,
  diverNameSchema,
  diverPhoneSchema,
} from "@/lib/person-fields";
import { publicTripPath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { partnerFromReferralCookie, REFERRAL_COOKIE } from "@/lib/referrals";
import {
  checkoutRentableItems,
  hasAnyRentalPricing,
  nitroxAvailableOn,
  type RentableItemKind,
  withOneSuit,
} from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";
import { unionRequirements } from "@/lib/requirement";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { ERROR_MESSAGE_KEYS, type ErrorCode } from "./_components/types";
import { checkoutGearLines, persistCheckoutGear } from "./_lib/checkout-gear";

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
  /**
   * The address the "already on this trip" refusal was about, as the diver
   * typed it, so the refusal can offer "Send me my link" to that inbox (UX
   * review 2026-10-11, item 8). It goes through `requestFindMyBookingAction`,
   * which answers the same whatever the address holds and mails only the
   * address on file, so echoing it back reveals nothing the refusal did not.
   */
  alreadyBookedEmail?: string;
};

const bookSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
});

const emailField = diverEmailSchema;

/**
 * Every field the booking form posts, each read the way `FormData.get` read
 * it, so this action still measures each box itself and points at the one
 * that is wrong. The party's own fields are numbered (`fullName-0`,
 * `gear-1-Mask`, `nitrox-2`), so they ride the catch-all.
 */
const bookingForm = z
  .object({
    partySize: formValue(),
    phone: trimmedText(),
    promoCode: trimmedText(),
    handoff: formValue(),
  })
  .catchall(formValue());

/**
 * The banner code for a booking `createBookingParty` refused. Anything not
 * named here is `unavailable`, which is deliberate for the refusals that
 * describe the person behind a typed email (see `ErrorCode`).
 */
function bookingRefusalCode(reason: string): ErrorCode {
  const codes: Record<string, ErrorCode> = {
    trip_full: "full",
    already_booked: "already",
    course_unstaffed: "course-unavailable",
    course_ratio_full: "course-ratio-full",
    divers_full: "divers-full",
    participant_type_unavailable: "type-unavailable",
  };
  return Object.hasOwn(codes, reason) ? (codes[reason] as ErrorCode) : "unavailable";
}

/** A wait-list joiner's identity fields; the dive declaration is read apart. */
const waitlistForm = z.object({
  "fullName-0": formValue(),
  "email-0": formValue(),
  partySize: formValue(),
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
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  const ip = await clientIp();
  const fields = readForm(bookingForm, formData);
  // Bounded, and the bound is measured — see MAX_PUBLIC_PARTY_SIZE for the
  // numbers and for why the lock, not the row count, is what decides it.
  const partySize = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PUBLIC_PARTY_SIZE)
    .safeParse(fields.partySize);
  if (!partySize.success) return { error: t(ERROR_MESSAGE_KEYS.invalid) };
  // Validate per field so the form can point at the exact box that is wrong,
  // and keep everything else the diver typed.
  const fieldErrors: Record<string, string> = {};
  const validParty: { fullName: string; email: string; minorDeclared: boolean }[] = [];
  for (let index = 0; index < partySize.data; index++) {
    const fullName = String(fields[`fullName-${index}`] ?? "").trim();
    const email = String(fields[`email-${index}`] ?? "").trim();
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
    validParty.push({ fullName, email, minorDeclared: fields[`minor-${index}`] === "on" });
  }
  const { phone, promoCode: promoCodeInput } = fields;
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
  // What each person is coming as (ADR 20261007-participant-types), checked
  // against what this departure sells rather than trusted from the form.
  const parsedTypes = parsePartyTypes(
    Array.from({ length: partySize.data }, (_, index) => fields[`participantType-${index}`]),
    tripForGear,
  );
  if (!parsedTypes.ok) {
    return {
      error: t("booking.errors.checkFields"),
      fieldErrors: {
        [`participantType-${parsedTypes.index}`]: t("booking.fieldErrors.participantTypeInvalid"),
      },
    };
  }
  const partyTypes = parsedTypes.types;
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
  // Nothing to rent on a course whose fee includes the gear (issue #2795): the
  // form offers no box there, so a `gear-N-*` arriving anyway is hand-built and
  // buys nothing, and the student's fit is left for `/ready` to ask.
  const offeredGearItems = checkoutRentableItems(shopNow.rentalItems, tripForGear?.course);
  const rentsAtCheckout = offersGearAtCheckout && offeredGearItems.length > 0;
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
        // One suit, held here as well as in `saveRentalFit`, so a post that
        // ticks both is charged for the suit that gets packed (H-78).
        rentedKinds: withOneSuit(
          offeredGearItems
            .filter((item) => rentsKind(partyTypes[index], item.kind))
            .filter((item) => fields[`gear-${index}-${item.name}`] === "on")
            .map((item) => item.kind),
        ),
        // A nitrox fill is a diver's alone; the database refuses it on any
        // other seat, so it is never asked for one.
        wantsNitrox:
          isDiver(partyTypes[index]) &&
          nitroxOfferedAtCheckout &&
          fields[`nitrox-${index}`] === "on",
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
  // Partner links switched off (the Features page) credit nobody, old cookie or not.
  const referralSource = shopNow.partnerLinksEnabled
    ? partnerFromReferralCookie((await cookies()).get(REFERRAL_COOKIE)?.value, shopSlug)
    : null;

  // A held boat refuses a waiter after five seconds: a crowd, worded "try again".
  const outcome = await createBookingParty(
    dbi,
    validParty.map((entry, index) => ({
      shopId: shopNow.id,
      tripId,
      actor: "public" as const,
      ...entry,
      participantType: partyTypes[index] ?? "diver",
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
  ).catch(busyOnLockWait);
  if (outcome === "busy") return { error: t(ERROR_MESSAGE_KEYS.busy) };
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
        unionRequirements(tripRequirement, siteRequirement),
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

    const code = bookingRefusalCode(outcome.reason);
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
    const alreadyBookedEmail =
      code === "already" ? validParty[outcome.failedIndex ?? 0]?.email || undefined : undefined;
    return { error: message, fieldErrors: memberFieldErrors, alreadyBookedEmail };
  }
  await trackEvent({ name: "booking_completed", source: "diver", partySize: validParty.length });
  // The shop's first booking through its own public pages is an activation
  // step the founder watches (ADR 20261007-founder-metrics); nothing on the
  // booking row says which door it came through, so it is recorded here, once.
  // Deferred and swallowed: the diver's confirmation never waits on it.
  after(() =>
    recordShopMilestone(dbi, { shopId: shopNow.id, milestone: "first_public_booking" }).catch(
      (error) => console.error("bookSpot: first_public_booking milestone failed", error),
    ),
  );
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
    getBookingForTrip(dbi, shopNow.id, tripId, primaryBookingId),
    getTripWithBooked(dbi, shopNow.id, tripId),
  ]);
  // Where this booking now lands, and what the confirmation email links to:
  // the diver's own `/ready` page (ADR 20260820-one-page-after-booking).
  const links = await issueBookedReadinessLinks(dbi, {
    shopId: shopNow.id,
    bookingId: primaryBookingId,
  });
  await consumeHandoffFromForm(dbi, shopNow.id, fields.handoff);
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
  // The confirmation and every diver's waiver, after the seats are committed:
  // nothing in it may turn a completed booking into an error.
  await sendJoinMail(dbi, {
    shop: shopNow,
    trip: tripNow,
    lead: confirmedBooking,
    primaryBookingId,
    bookings: outcome.bookings,
    ownLocale,
    readinessToken: links.mailed?.token,
    money: { chargesOnline: payAtBookingForGear, partyTypes },
  });

  if (offersGearAtCheckout) {
    await persistCheckoutGear(dbi, {
      shopId: shopNow.id,
      bookings: outcome.bookings,
      selections: gearSelections,
      rentsAtCheckout,
      nitroxOffered: nitroxOfferedAtCheckout,
    });
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
    : links.redirect
      ? `${readinessLinkPath(links.redirect.token)}?booked=1`
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
  const gearLines = offersGearAtCheckout
    ? checkoutGearLines({
        pricing: shopNow.rentalPricing,
        offeredKinds: offeredGearItems.map((item) => item.kind),
        plannedDives,
        bookings: outcome.bookings,
        selections: gearSelections,
        describe: (nitroxOnly, name) =>
          validParty.length > 1
            ? t(nitroxOnly ? "checkoutLine.nitroxForDiver" : "checkoutLine.gearForDiver", { name })
            : t(nitroxOnly ? "checkoutLine.nitrox" : "checkoutLine.gear"),
      })
    : [];
  const started = await startCheckoutUrl(dbi, {
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
          discountAmountCents: tripPromo.discountAmountCents,
        }
      : undefined,
    shopPromo: shopPromo
      ? {
          id: shopPromo.id,
          code: shopPromo.code,
          discountPercent: shopPromo.discountPercent,
          discountAmountCents: shopPromo.discountAmountCents,
        }
      : undefined,
    gearLines,
  });
  const checkoutUrl = started.url;
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
  // The seats are booked either way; a code with nothing left to give is said
  // where the diver lands, so they can pay the full fare from there.
  if (started.promoUsedUp) {
    revalidateAndRedirect(base, `${landing}${landing.includes("?") ? "&" : "?"}pay=code-used-up`);
  }
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
/**
 * The door remembers who opened it (ADR 20260906-before-you-ask, decision 3):
 * the handoff this page was opened through is single-use, and the booking is
 * its one use. A stale or forged value is a no-op.
 */
async function consumeHandoffFromForm(dbi: AppDb, shopId: string, value: unknown): Promise<void> {
  const handoff = z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,128}$/)
    .safeParse(value);
  if (handoff.success) {
    await consumeBookingHandoff(dbi, { shopId, token: handoff.data });
  }
}

/**
 * The mail a completed booking sends, in order: the lead's confirmation, with
 * their waiver riding in it as its first step when one is owed, then every
 * other diver's waiver on its own. The seats are already committed before this
 * runs, so every failure in here is logged and dropped — it must never turn a
 * capacity-safe booking into an error page.
 */
async function sendJoinMail(
  dbi: AppDb,
  {
    shop,
    trip,
    lead,
    primaryBookingId,
    bookings,
    ownLocale,
    readinessToken,
    money: { chargesOnline, partyTypes },
  }: {
    shop: NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
    trip: Awaited<ReturnType<typeof getTripWithBooked>>;
    lead: Awaited<ReturnType<typeof getBookingForTrip>>;
    primaryBookingId: string;
    bookings: readonly { bookingId: string }[];
    ownLocale: Awaited<ReturnType<typeof requestFirstHandLocale>>;
    /** The lead's `/ready` capability, when one was minted. */
    readinessToken: string | undefined;
    money: {
      /** Whether this booking went to a checkout, the rule the form used. */
      chargesOnline: boolean;
      /** What each seat of the party is, the lead's first: the money line sums them. */
      partyTypes: readonly ParticipantType[];
    };
  },
): Promise<void> {
  // One booking, one email (UX review 2026-10-11, item 7): the lead's waiver,
  // when one is owed, rides in the confirmation as its first step instead of
  // following it seconds later in a mail of its own. Issued before the send
  // so the confirmation can carry it; settled after, by how the send went.
  const leadWaiver = await issueJoinWaiverLink(dbi, shop.id, primaryBookingId).catch(
    (error: unknown) => {
      log("booking.waiver_link_failed", "error", {
        bookingId: primaryBookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      return null;
    },
  );
  let confirmationSent = false;
  let confirmationMessageId: string | undefined;
  if (lead?.person.email && trip) {
    try {
      const delivery = await sendAndRecordNotification(
        dbi,
        bookSpotConfirmation({
          shop,
          trip,
          confirmed: lead,
          to: lead.person.email,
          locale: recipientLocale(ownLocale ?? lead.person.locale, shop.defaultLocale),
          readinessUrl: readinessToken ? readinessEmailUrl(readinessToken) : undefined,
          waiver: leadWaiver,
          chargesOnline,
          otherSeatTypes: partyTypes.slice(1),
        }),
      );
      confirmationSent = delivery.status === "sent";
      if (delivery.status === "sent") confirmationMessageId = delivery.providerMessageId;
      if (delivery.status === "failed") {
        log("booking.confirmation_send_failed", "error", { bookingId: primaryBookingId });
      }
    } catch (error) {
      // Email must never turn a completed, capacity-safe booking into an error page.
      log("booking.confirmation_prepare_failed", "error", {
        bookingId: primaryBookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  // Send each diver their waiver on joining, when the trip needs one and they
  // aren't covered (issueWaiverOnJoin). The lead's rode in the confirmation;
  // settling records that, or mails it alone. A failure is logged, never thrown.
  await Promise.all(
    bookings.map(async ({ bookingId }) => {
      try {
        if (bookingId === primaryBookingId && leadWaiver) {
          await settleJoinWaiverDelivery(dbi, {
            shopId: shop.id,
            bookingId,
            link: leadWaiver,
            confirmationSent,
            confirmationProviderMessageId: confirmationMessageId,
          });
          return;
        }
        await issueWaiverOnJoin(dbi, shop.id, bookingId);
      } catch (error) {
        log("booking.waiver_on_join_failed", "error", {
          bookingId,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      }
    }),
  );
}

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
  } catch (error) {
    log("booking.buddy_referral_failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
  }
}

/**
 * The hosted payment page for these fresh bookings, or a null url when
 * pay-at-booking can't run — with `promoUsedUp` when the reason is a capped
 * code that has nothing left.
 */
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
    tripPromo?: CheckoutPromo;
    shopPromo?: CheckoutPromo;
    /** Priced gear a diver chose at booking, threaded straight to `startBookingCheckout`. */
    gearLines?: Array<{ bookingId: string; description: string; amountCents: number }>;
  },
): Promise<{ url: string | null; promoUsedUp: boolean }> {
  const origin = publicAppUrl();
  if (!origin || !input.customerEmail) return { url: null, promoUsedUp: false };
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
    describeLine: (parts) => describeCheckoutLine(t, parts),
  }).catch(() => null);
  return {
    url: outcome?.ok ? (outcome.checkout.checkoutUrl ?? null) : null,
    promoUsedUp: outcome?.ok === false && outcome.reason === "promo_used_up",
  };
}

export async function joinWaitlist({ shopSlug, tripId, embed }: TripRef, formData: FormData) {
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("waitlist", ip), RATE_LIMITS.waitlistJoin)).allowed) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=unavailable${embedParam(embed, "&")}`);
  }
  const joiner = parseForm(waitlistForm, formData);
  const parsed = bookSchema.safeParse(
    joiner.ok
      ? {
          fullName: joiner.data["fullName-0"],
          email: joiner.data["email-0"],
        }
      : {},
  );
  // The optional "what can you dive?" pair, parsed apart from the identity
  // fields on purpose: it is not the diver's fault if a level code arrives
  // malformed, and a wait-list join must not be refused over an answer the form
  // said was optional. A declaration that fails validation is simply not said.
  const declaration = diveDeclarationSchema.safeParse(diveDeclarationInput(formData));
  if (!parsed.success) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=invalid${embedParam(embed, "&")}`);
  }
  // How many wait together (fourth review, item 34), within the booking form's
  // own bound. The lead's details are the entry; the party is a count.
  const partySize = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PUBLIC_PARTY_SIZE)
    .safeParse(joiner.ok ? joiner.data.partySize : undefined);
  if (!partySize.success) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=invalid${embedParam(embed, "&")}`);
  }
  const dbi = await getDb();
  const shopNow = await getShopBySlug(dbi, shopSlug);
  if (!shopNow) {
    redirect(`${publicTripPath(shopSlug, tripId)}?error=unavailable${embedParam(embed, "&")}`);
  }
  const outcome = await askForDeparture(dbi, {
    shopId: shopNow.id,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    // No phone: the wait list asks a name and an email only (B57), so a
    // posted number was never given under the SMS consent's words (H-09).
    partySize: partySize.data,
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
      `${publicTripPath(shopSlug, tripId)}?interest=${outcome.interestId}${embedParam(embed, "&")}`,
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

/**
 * The confirmation `bookSpot` sends the lead booker, composed out of the
 * action so the action stays readable: the time, the dock call, the diver's
 * trip prep, a course's materials, and (ux review 2026-10-11, items 4 and 5)
 * where to go, the calendar, this seat's money and the free-cancellation
 * window. Online money exactly when this booking went to a checkout, the rule
 * the form used.
 */
function bookSpotConfirmation(input: {
  shop: NonNullable<Awaited<ReturnType<typeof getShopBySlug>>>;
  trip: NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
  confirmed: NonNullable<Awaited<ReturnType<typeof getBookingForTrip>>>;
  /** The lead's own address, already checked present. */
  to: string;
  locale: DiverLocale;
  readinessUrl: string | undefined;
  /** The lead's waiver, riding in the confirmation as its first step when one is owed. */
  waiver: { url: string; expiresAt: Date } | null;
  chargesOnline: boolean;
  /** The party's other seats, all still the lead's at booking (fourth UX review, item 5). */
  otherSeatTypes: readonly ParticipantType[];
}): Notification {
  const { shop, trip, confirmed } = input;
  return {
    kind: "booking_confirmation",
    bookingId: confirmed.booking.id,
    shopId: shop.id,
    to: input.to,
    locale: input.locale,
    diverName: confirmed.person.fullName,
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    timezone: shop.timezone,
    dockCallMinutes: shop.dockCallMinutes,
    readinessUrl: input.readinessUrl,
    waiverUrl: input.waiver?.url,
    waiverExpiresAt: input.waiver?.expiresAt,
    packingList: shop.packingList,
    // The diver's cards are not read here: a try-dive's email leaves the
    // logbook off, and the thread adds it back for a certified diver.
    packingLogbook: packsLogbook({
      shopSuggests: shop.packingLogbook,
      introCourseSession: trip.course?.isIntroCourse === true,
      holdsCertification: false,
    }),
    // A course session's learning materials, delivered with the seat
    // (ADR 20261008-course-learning-materials).
    learningMaterials: trip.course
      ? readLearningMaterials(trip.course.learningMaterials)
      : undefined,
    ...confirmationExtras({
      shop,
      trip,
      course: trip.course ?? null,
      participantType: confirmed.booking.participantType,
      partyTypes: input.otherSeatTypes,
      chargesOnline: input.chargesOnline,
      origin: publicAppUrl(),
    }),
  };
}
