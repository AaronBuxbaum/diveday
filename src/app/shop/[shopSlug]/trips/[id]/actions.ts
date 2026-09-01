"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  canPersonConfigureTrips,
  canPersonManagePaymentSettings,
  canPersonRefund,
} from "@/db/authz";
import { getBoatById } from "@/db/boats";
import {
  bookingDiverName,
  cancelBooking,
  confirmBookingIdentity,
  restoreBooking,
  setBookingPickupDetails,
} from "@/db/bookings";
import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { sendNotification } from "@/db/notifications";
import { addInternalNote, deleteInternalNote, recordTripActivity } from "@/db/operations";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import {
  getTripRequirements,
  issueShopCertification,
  issueShopNitroxCertification,
  issueShopSpecialtyCertification,
  listTripReadiness,
  upsertTripRequirements,
} from "@/db/readiness";
import { type CancellationRefundOutcome, refundBookingOnCancellation } from "@/db/refunds";
import type { PaymentStatus } from "@/db/schema";
import { diveSpecialty, people } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getShopCurrency } from "@/db/stripe-accounts";
import {
  createDirectTripInvitation,
  getTripInvitation,
  listTripInvitations,
  recordTripInvitation,
} from "@/db/trip-invitations";
import { type SendLastMinuteDealOutcome, sendLastMinuteDealBlast } from "@/db/trip-promos";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  changeTripCrew,
  getTripWithBooked,
  listTripDiverContacts,
  reinstateTripClearingMinimum,
  setSeriesRepeat,
  setTripStatus,
  type TripCrewChange,
  type UpdateTripOutcome,
  updateSeriesCadence,
  updateTrip,
  updateTripConditions,
} from "@/db/trips";
import { inviteWaitlistDiver, joinTripWaitlist, type WaitlistOutcome } from "@/db/waitlist";
import {
  type InPersonWaiverOutcome,
  recordInPersonWaiver,
  saveBookingEmergencyContact,
} from "@/db/waivers";
import { toDiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { emergencyContactSchema } from "@/lib/contact";
import { depthToMeters, maxEnteredVisibility } from "@/lib/depth-units";
import { DECLARABLE_CERTIFICATION_LEVELS } from "@/lib/dive-declaration";
import { isValidLastMinuteDiscountPercent } from "@/lib/last-minute-list";
import { MAX_DECISION_HOURS, MAX_MINIMUM_BOOKINGS, MIN_DECISION_HOURS } from "@/lib/minimum-seats";
import { revalidateAndRedirect } from "@/lib/navigation";
import { notify, publicAppUrl, recipientLocale } from "@/lib/notifications";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import { diverEmailSchema, diverNameSchema, diverPhoneSchema } from "@/lib/person-fields";
import { publicTripPath } from "@/lib/public-routes";
import { paymentGateIsUnclearable, REQUIRABLE_CERTIFICATION_LEVELS } from "@/lib/readiness";
import {
  isValidWeekdaySet,
  MAX_INTERVAL_WEEKS,
  MIN_INTERVAL_WEEKS,
  weekdaySetFrom,
} from "@/lib/recurrence";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { deleteStoredImage, storeArrivalImage } from "@/lib/storage";
import {
  maxEnteredTemperature,
  minEnteredTemperature,
  temperatureToCelsius,
  temperatureUnitFor,
} from "@/lib/temperature-units";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { tripDetailsPatch } from "@/lib/trip-details";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { uuidParam } from "@/lib/uuid";

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  // Where this departure meets, when it isn't the shop's own front door
  // (issue #704 slice 2). Both blank means "the shop" everywhere this
  // renders — see meetingPointLabel's schema comment.
  meetingPointLabel: z.string().trim().max(120),
  meetingPointAddress: z.string().trim().max(200),
  // Public, practical arrival guidance. Optional here so an older cached form
  // can still save the rest of the trip without clearing newly authored copy.
  arrivalLandmark: z.string().trim().max(300).optional(),
  arrivalParkingNote: z.string().trim().max(300).optional(),
  arrivalTransitNote: z.string().trim().max(300).optional(),
  arrivalLookFor: z.string().trim().max(300).optional(),
  arrivalFirstInteraction: z.string().trim().max(300).optional(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
  // **The departure's own three**, editable since 2026-08-22 (issue #681).
  // They were writable only at creation, which made the commonest real edit —
  // "the boat that was going to run this is in for service" — impossible, with
  // no delete-and-recreate available because `deleteTrip` refuses a departure
  // carrying bookings.
  //
  // `courseId` is deliberately **not** here and should stay out: a departure's
  // curriculum is what its divers bought, and swapping it under them would
  // change what they turn up for. That is a decision, not the same oversight.
  diveMode: z.enum(["boat", "shore", "pool"]).optional(),
  boatId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid().optional()),
  isPrivate: z.preprocess((value) => value === "on", z.boolean()),
  // The shop's own divemaster target stops applying to this departure. Nothing
  // else moves: an agency training ratio still refuses a seat, and readiness,
  // admission and capacity never see this (issue #973).
  selfGuided: z.preprocess((value) => value === "on", z.boolean()),
  // How many consecutive days this departure meets on (src/lib/trip-days.ts).
  // Absent from an older cached form is one day, the shape every trip had
  // before multi-day existed.
  dayCount: z.preprocess(
    (value) => (value === "" || value === undefined ? MIN_TRIP_DAYS : value),
    z.coerce.number().int().min(MIN_TRIP_DAYS).max(MAX_TRIP_DAYS),
  ),
  priceDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
  depositDollars: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().nonnegative().finite().optional(),
  ),
  cancellationWindowHours: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(720).optional(),
  ),
  // The head count this departure needs to run, and when the call is made.
  // Blank clears the policy, which is also how staff take a swept departure
  // off the sweep's list by hand (src/lib/minimum-seats.ts).
  minimumBookings: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(MAX_MINIMUM_BOOKINGS).optional(),
  ),
  minimumDecisionHours: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(MIN_DECISION_HOURS).max(MAX_DECISION_HOURS).optional(),
  ),
});

/**
 * Water temperature and visibility arrive in whatever units the shop works in
 * (`shops.temperature_unit` / `shops.depth_unit`), so the real bounds can only
 * be applied once the unit is known — these are the loose outer guards, and
 * `saveConditionsAction` re-reads the shop and re-checks against the shop-unit
 * bounds before converting to the canonical Celsius/metres that get stored.
 * Same shape the dive-site depth entry uses (`shop/[shopSlug]/dive-sites/new`).
 */
const conditionsSchema = z.object({
  conditionsHold: z.string().optional(),
  conditionsSummary: z.string().trim().max(600),
  waterTemperature: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(-100).max(200).optional(),
  ),
  visibility: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(0).max(1_000).optional(),
  ),
  surfaceConditions: z.string().trim().max(300),
});

const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const paymentStatusSchema = z.enum(["unpaid", "deposit_paid", "paid", "waived", "refunded"]);

/**
 * Whether a payment status *records* money or *decides about* it — a free seat
 * and a refund-without-a-refund are the write-off that `canRefund` gates
 * everywhere else (issue #714).
 *
 * An exhaustive `Record`, not a `Set`: a sixth status added to the column would
 * silently fall outside a set and be treated as ordinary counter work, which is
 * the one direction this classification must never fail. Here it is a compile
 * error instead.
 */
const PAYMENT_STATUS_CLASS: Record<PaymentStatus, "record" | "write_off"> = {
  unpaid: "record",
  deposit_paid: "record",
  paid: "record",
  waived: "write_off",
  // Money went back out, so changing away from it is a decision about money
  // even though some is still held. Note it is absent from
  // `paymentStatusSchema` above on purpose: `partly_refunded` is only ever
  // reached by an actual Stripe partial refund, never set by hand from the
  // roster select (issue #699).
  partly_refunded: "write_off",
  refunded: "write_off",
};

function paymentStatusClass(status: PaymentStatus): "record" | "write_off" {
  return PAYMENT_STATUS_CLASS[status];
}
const requirementsSchema = z.object({
  requiresWaiver: z.string().optional(),
  // The requirable set, not the ladder: Divemaster and Instructor are working
  // ratings and a departure may not demand one of a paying diver (issue #630).
  // Read off `REQUIRABLE_CERTIFICATION_LEVELS` rather than respelled, so the
  // picker and the parse can never disagree about what a shop may ask for.
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(REQUIRABLE_CERTIFICATION_LEVELS).nullable(),
  ),
});

/**
 * Wait-listing still parses its own submission here: it is a different
 * mutation (`joinTripWaitlist`) with its own outcomes, and it shares only the
 * form. Seating a diver — hand-entered or picked — goes through the shared
 * `seatNewDiverAction`/`seatExistingDiverAction` (src/app/actions/seat-diver.ts)
 * so every door owes the same consequences.
 */
const addDiverSchema = z.object({
  // Shared diver person-field bounds (src/lib/person-fields.ts).
  fullName: diverNameSchema,
  email: diverEmailSchema,
  phone: diverPhoneSchema.optional(),
});

const directInvitationSchema = z.object({ personId: z.uuid() });

function parseAddDiver(formData: FormData) {
  return addDiverSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
}

// Trip-config actions (details, conditions, crew, requirements, cancel) settle
// back on Trip — "what the dive is". Roster actions (add/remove diver, wait
// list, waiver, payment) settle on Trip — "who is attending" — the one place
// they live, so a mutation never bounces staff to a page without the row.
//
// Built through `shopPath` rather than a template literal: `shopSlug` arrives
// as a server-action argument, so it is client-supplied, and interpolating it
// raw handed the caller the rest of the URL — `../../admin` traverses out of the
// `/shop/` namespace, and a `?` or `#` in it detaches the `?notice=` appended
// after it so the refusal renders nowhere. Every segment is escaped, so a
// hostile value stays inside one path segment and 404s
// (src/lib/staff-notices.ts).
const backPath = (shopSlug: string, tripId: string) => shopPath(shopSlug, "trips", tripId);
const tripPath = (shopSlug: string, tripId: string) => shopPath(shopSlug, "trips", tripId);

/**
 * Record the Trip surface's complete trip-packet action. The printable route
 * is opened by the browser in the same click, while this server action keeps
 * the event behind the same shop/session boundary as every other trip action.
 * It carries no trip id or diver data: the useful question is whether the
 * button is used, not which departure was printed.
 */
export async function recordTripPrintPdfAction(shopSlug: string, tripId: string) {
  if (!uuidParam(tripId)) return;
  const { session } = await requireShopSurface(shopSlug);
  const trip = await getTripWithBooked(await getDb(), session.user.shopId, tripId);
  if (!trip) return;
  await trackEvent({ name: "trip_print_pdf_clicked", surface: "trip_overview" });
}

/**
 * Trip *definition* — what the dive is and who it admits (details, admission
 * requirements, and the whole-series operations) — is owner/manager/instructor
 * work (H-14, ADR 20260724-role-authorization). Re-checks live roles against the
 * DB and bounces a disallowed staff member to the trip Overview with a
 * not-authorized notice.
 *
 * This is deliberately narrower than "everything on Overview": the *operating*
 * actions the glossary assigns to the day-of crew — predicted-conditions entry,
 * day-of crew assignment (manifest accuracy), and a single trip's weather
 * cancellation — stay on the ordinary shop-surface preamble, as do the
 * roster/booking/recap actions. Only trip definition and bulk schedule
 * management add the live role gate below.
 */
async function requireTripConfig(shopSlug: string, tripId: string) {
  const { session } = await requireShopSurface(shopSlug, {
    allow: canPersonConfigureTrips,
    refusal: { notice: "not-authorized", landing: ["trips", tripId] },
  });
  return session;
}

/**
 * A trip-save refusal's `?notice=` code. `invalid` and `not_found` both land on
 * the generic form error — the staffer's next move is the same either way — but
 * they are spelled out rather than reached by falling off the end of a ladder.
 */
const UPDATE_TRIP_NOTICE: Record<Extract<UpdateTripOutcome, { ok: false }>["reason"], string> = {
  invalid: "invalid",
  not_found: "invalid",
  capacity_below_booked: "capacity-below-booked",
  boat_not_found: "boat-not-found",
  planned_dives_below_history: "planned-dives-below-history",
};

/**
 * A last-minute blast refusal's `?notice=` code.
 *
 * This used to be `` `last-minute-${outcome.reason}` ``. Every code it produced
 * exists in `TripNoticeBanner`'s map today — but `scripts/check-notice-codes.mjs`
 * cannot read an interpolated string, so nothing proved it, and a seventh reason
 * would have redirected to a code with no banner behind it: indistinguishable
 * from a dead link, and green in every test.
 */
const LAST_MINUTE_NOTICE: Record<
  Extract<SendLastMinuteDealOutcome, { ok: false }>["reason"],
  string
> = {
  invalid_discount: "last-minute-invalid-discount",
  trip_unavailable: "last-minute-trip-unavailable",
  trip_full: "last-minute-trip-full",
  not_connected: "last-minute-not-connected",
  no_recipients: "last-minute-no-recipients",
  stripe_failed: "last-minute-stripe-failed",
};

/**
 * A wait-list refusal's `?notice=` code. `already_waitlisted` never reaches this
 * table — a repeat joiner is answered as success above, deliberately — but it is
 * spelled out because the union contains it, and a table that quietly omitted an
 * arm would be the ladder this replaced.
 */
const WAITLIST_NOTICE: Record<Extract<WaitlistOutcome, { ok: false }>["reason"], string> = {
  trip_available: "diver-waitlist-available",
  already_booked: "diver-already",
  already_waitlisted: "diver-waitlisted",
  trip_unavailable: "diver-unavailable",
};

/**
 * An in-person waiver refusal's `?notice=` code. Six of the seven share one
 * message — the staffer's next move is the same for every "that row is not what
 * you think it is" — but the seventh is the medical attestation, which is a
 * different act, and the ternary this replaces made the other six invisible.
 */
const IN_PERSON_WAIVER_NOTICE: Record<
  Extract<InPersonWaiverOutcome, { ok: false }>["reason"],
  string
> = {
  medical_attestation_required: "waiver-medical-attestation",
  booking_not_found: "waiver-error",
  booking_unavailable: "waiver-error",
  person_not_found: "waiver-error",
  template_not_found: "waiver-error",
  staff_not_found: "waiver-error",
  invalid_signature: "waiver-error",
};

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: "details" }));
  const {
    title,
    description,
    meetingPointLabel,
    meetingPointAddress,
    arrivalLandmark,
    arrivalParkingNote,
    arrivalTransitNote,
    arrivalLookFor,
    arrivalFirstInteraction,
    date,
    startTime,
    endTime,
    capacity,
    plannedDives,
    dayCount,
    priceDollars,
    depositDollars,
    cancellationWindowHours,
    minimumBookings,
    minimumDecisionHours,
    diveMode,
    boatId,
    isPrivate,
    selfGuided,
  } = parsed.data;
  const dbi = await getDb();
  const shopNow = await getShopById(dbi, s.user.shopId);
  if (!shopNow) redirect(noticeUrl(back, "invalid", { form: "details" }));
  // **The hull this departure will sail on after the edit** — the one just
  // submitted, or the one already stored when the form did not carry the
  // field. Checking the destination rather than the origin is what makes a
  // swap to a smaller boat land on the right number, and switching away from
  // `boat` drops the hull the same way `tripDetailsPatch` does.
  //
  // A departure with no boat, or a shore or pool dive, yields no capacity and
  // is not checked.
  const tripNow = await getTripWithBooked(dbi, s.user.shopId, tripId);
  const nextBoatId = diveMode && diveMode !== "boat" ? null : (boatId ?? tripNow?.boatId ?? null);
  const nextBoat = nextBoatId ? await getBoatById(dbi, s.user.shopId, nextBoatId) : null;
  // Read for one rule only: clearing the price off a departure that demands
  // payment leaves a gate nobody can clear (issue #692). This form has no
  // payment toggle, so the stored row is the only place to learn it — the same
  // reason the hull above is read rather than trusted from the submit.
  const gate = await getTripRequirements(dbi, s.user.shopId, tripId);
  // One pipeline, shared with the board's add panel (`src/lib/trip-details.ts`).
  // Editing a departure now applies the same rules creating one does — an
  // impossible calendar day is refused, and a free-cancellation window with no
  // minimum beside it is not stored as a policy. Both were the board's rules
  // only until that module existed.
  const details = tripDetailsPatch(
    {
      date,
      startTime,
      endTime,
      dayCount,
      priceDollars,
      depositDollars,
      cancellationWindowHours,
      minimumBookings,
      minimumDecisionHours,
      capacity,
      // The hull the edit is *moving to*, so a swap to a smaller boat is caught
      // against the boat it will actually sail on rather than the one it is
      // leaving.
      boatCapacity: nextBoat?.capacity ?? null,
      diveMode,
      boatId,
      requiresPayment: gate?.requiresPayment ?? false,
    },
    shopNow,
  );
  if (!details.ok) {
    if (details.reason === "end_before_start") redirect(noticeUrl(back, "end-before-start"));
    if (details.reason === "price_required_by_gate") {
      redirect(noticeUrl(back, "price-required-by-gate", { form: "details" }));
    }
    if (details.reason === "capacity_above_boat") {
      redirect(
        noticeUrl(back, "capacity-above-boat", {
          count: details.boatCapacity,
          form: "details",
        }),
      );
    }
    redirect(noticeUrl(back, "invalid", { form: "details" }));
  }
  const dives = tripDiveDraftsFromForm(formData, plannedDives);

  let uploadedArrivalPhotoUrl: string | undefined;
  const arrivalPhoto = formData.get("arrivalPhoto");
  if (arrivalPhoto instanceof File && arrivalPhoto.size > 0) {
    const stored = await storeArrivalImage({
      filename: arrivalPhoto.name,
      contentType: arrivalPhoto.type,
      bytes: await arrivalPhoto.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      redirect(noticeUrl(back, "arrival-photo-failed", { form: "details" }));
    }
    uploadedArrivalPhotoUrl = stored.url;
  }
  const removeArrivalPhoto = formData.get("removeArrivalPhoto") === "on";
  const previousArrivalPhotoUrl = tripNow?.arrivalPhotoUrl ?? null;
  const nextArrivalPhotoUrl = uploadedArrivalPhotoUrl ?? (removeArrivalPhoto ? null : undefined);
  const discardUploadedArrivalPhoto = async () => {
    if (uploadedArrivalPhotoUrl) await deleteStoredImage(uploadedArrivalPhotoUrl);
  };

  const outcome = await updateTrip(dbi, s.user.shopId, tripId, {
    title,
    description: description || undefined,
    meetingPointLabel: meetingPointLabel || null,
    meetingPointAddress: meetingPointAddress || null,
    ...(arrivalLandmark === undefined ? {} : { arrivalLandmark: arrivalLandmark || null }),
    ...(arrivalParkingNote === undefined ? {} : { arrivalParkingNote: arrivalParkingNote || null }),
    ...(arrivalTransitNote === undefined ? {} : { arrivalTransitNote: arrivalTransitNote || null }),
    ...(arrivalLookFor === undefined ? {} : { arrivalLookFor: arrivalLookFor || null }),
    ...(arrivalFirstInteraction === undefined
      ? {}
      : { arrivalFirstInteraction: arrivalFirstInteraction || null }),
    ...(nextArrivalPhotoUrl === undefined ? {} : { arrivalPhotoUrl: nextArrivalPhotoUrl }),
    changeActorPersonId: s.user.personId,
    startsAt: details.patch.startsAt,
    // The whole departure, first day's departure to last day's return.
    endsAt: details.patch.endsAt,
    scheduleDays: details.patch.scheduleDays,
    capacity,
    plannedDives,
    diveMode: details.patch.diveMode,
    boatId: details.patch.boatId,
    isPrivate,
    selfGuided,
    priceCents: details.patch.priceCents,
    depositCents: details.patch.depositCents,
    cancellationWindowHours: details.patch.cancellationWindowHours,
    minimumBookings: details.patch.minimumBookings,
    minimumDecisionHours: details.patch.minimumDecisionHours,
    diveSiteId: dives[0]?.diveSiteId ?? null,
    dives,
  });
  if (!outcome.ok) {
    await discardUploadedArrivalPhoto();
    // Two of the three refusals carry a number into the banner ("4 divers are
    // already booked"), which is why this is a ladder over a plain table lookup
    // — but the code itself comes from one.
    if (outcome.reason === "capacity_below_booked") {
      redirect(
        noticeUrl(back, UPDATE_TRIP_NOTICE[outcome.reason], {
          count: outcome.detail.bookedCount,
        }),
      );
    }
    if (outcome.reason === "planned_dives_below_history") {
      redirect(
        noticeUrl(back, UPDATE_TRIP_NOTICE[outcome.reason], {
          count: outcome.detail.recordedDiveCount,
        }),
      );
    }
    redirect(noticeUrl(back, "invalid", { form: "details" }));
  }
  if (
    nextArrivalPhotoUrl !== undefined &&
    previousArrivalPhotoUrl &&
    previousArrivalPhotoUrl !== nextArrivalPhotoUrl
  ) {
    await queueAndAttemptMediaDeletion(dbi, {
      shopId: s.user.shopId,
      kind: "arrival_photo",
      url: previousArrivalPhotoUrl,
    });
  }
  revalidateAndRedirect(back, noticeUrl(back, "saved"));
}

export async function saveConditionsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  // Predicted conditions are crew-entered — the divemaster/captain on the water
  // record water temp, viz, and surface state and own the go/no-go call
  // (glossary). This is operating work, not trip definition, so it stays open to
  // all staff even though the rest of Overview is config-gated (H-14).
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = conditionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  const db = await getDb();
  // The units come from the shop row, never from the form. A hidden input would
  // let a crafted post store a 27 typed as °C as if it were °F — a 16-degree
  // error on every diver's brief — the same reason the dive-site depth entry
  // re-reads the shop rather than trusting what was submitted.
  const shop = await getShopById(db, s.user.shopId);
  if (!shop) redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  const temperatureUnit = temperatureUnitFor(shop);
  const { waterTemperature, visibility } = parsed.data;
  if (
    waterTemperature !== undefined &&
    (waterTemperature < minEnteredTemperature(temperatureUnit) ||
      waterTemperature > maxEnteredTemperature(temperatureUnit))
  ) {
    redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  }
  if (visibility !== undefined && visibility > maxEnteredVisibility(shop.depthUnit)) {
    redirect(noticeUrl(back, "invalid", { form: "conditions" }));
  }
  const { trip: saved, holdStarted } = await updateTripConditions(db, s.user.shopId, tripId, {
    conditionsSummary: parsed.data.conditionsSummary,
    surfaceConditions: parsed.data.surfaceConditions,
    waterTemperatureC:
      waterTemperature === undefined
        ? undefined
        : temperatureToCelsius(waterTemperature, temperatureUnit),
    visibilityMeters:
      visibility === undefined ? undefined : depthToMeters(visibility, shop.depthUnit),
    conditionsHold: parsed.data.conditionsHold === "on",
    changeActorPersonId: s.user.personId,
  });
  if (saved && holdStarted) {
    const contacts = await listTripDiverContacts(db, s.user.shopId, tripId);
    const origin = publicAppUrl();
    if (origin) {
      const publishedAt = nowDate();
      await Promise.allSettled(
        contacts.flatMap((contact) =>
          contact.email
            ? [
                notify({
                  kind: "trip_conditions_hold",
                  tripId,
                  shopId: shop.id,
                  to: contact.email,
                  locale: toDiverLocale(shop.defaultLocale),
                  diverName: contact.fullName,
                  shopName: shop.name,
                  tripTitle: saved.title,
                  startsAt: saved.startsAt,
                  timezone: shop.timezone,
                  conditionsSummary: saved.conditionsSummary,
                  tripUrl: new URL(publicTripPath(shopSlug, tripId), `${origin}/`).toString(),
                  publishedAt,
                }),
              ]
            : [],
        ),
      );
    }
  }
  revalidateAndRedirect(
    back,
    noticeUrl(back, saved ? "conditions" : "invalid", { form: "conditions" }),
  );
}

export async function clearConditionsAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  // Crew-entered conditions (see saveConditionsAction) — operating work, open to
  // all staff.
  const s = (await requireShopSurface(shopSlug)).session;
  const { trip: saved } = await updateTripConditions(await getDb(), s.user.shopId, tripId, {
    changeActorPersonId: s.user.personId,
  });
  revalidateAndRedirect(
    back,
    noticeUrl(back, saved ? "conditions-cleared" : "invalid", { form: "conditions" }),
  );
}

export async function cancelTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  // A single trip's cancellation is the crew's weather go/no-go call (glossary):
  // the on-water lead must be able to take today's charter off the board so
  // divers are notified. It only flips status (no money moves — refunds stay
  // owner/manager on the per-booking path), so it's open to all staff. Bulk
  // schedule management (reinstate, whole-series cancel, create) stays config.
  const s = (await requireShopSurface(shopSlug)).session;
  await setTripStatus(await getDb(), s.user.shopId, tripId, "cancelled");
  revalidateAndRedirect(back, noticeUrl(back, "cancelled"));
}

export async function reinstateTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  // Status and minimum in one statement. Putting a departure back **is** the
  // shop saying "run it anyway", so the minimum it was cancelled under is
  // spent — and the two writes cannot be separate, or a sweep landing between
  // them would see a scheduled, still-short departure carrying its old minimum
  // and cancel it straight back out from under the staffer (ADR
  // 20260813-minimum-head-count-departures). A trip reinstated after an
  // ordinary cancellation had no minimum to clear, so this is the same
  // statement either way rather than a branch.
  await reinstateTripClearingMinimum(await getDb(), s.user.shopId, tripId);
  revalidateAndRedirect(back, noticeUrl(back, "reinstated"));
}

// Series-wide operations. A series is materialized as independent trips
// (20260719-recurring-trip-series); these iterate that instance set so staff
// can manage the whole run without touching every date by hand. Each settles
// back on the source trip's Overview, the one page the series banner lives on.

/** Push this date's editable details across every upcoming date in the series. */
export async function applySeriesDetailsAction(shopSlug: string, tripId: string, seriesId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const result = await applyDetailsToFutureSeries(await getDb(), s.user.shopId, seriesId, tripId);
  const notice = !result
    ? "series-error"
    : result.skipped > 0
      ? "series-applied-partial"
      : "series-applied";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/** Cancel every upcoming date in the series at once; each stays reinstatable. */
export async function cancelSeriesAction(shopSlug: string, tripId: string, seriesId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const cancelled = await cancelFutureSeriesTrips(await getDb(), s.user.shopId, seriesId);
  revalidateAndRedirect(back, noticeUrl(back, cancelled > 0 ? "series-cancelled" : "series-error"));
}

/**
 * Stop a series repeating, or start it going again — one switch, both ways.
 *
 * Stopping leaves every date already on the board exactly as it is (they are
 * ordinary trips, some with divers on them) and only closes the cadence, so
 * nothing new is generated. Starting again re-opens it and fills the horizon in
 * the same call, which is also how a shop takes a finite series scheduled
 * before this existed and simply lets it keep going.
 */
export async function setSeriesRepeatAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const keepRepeating = formData.get("keepRepeating") === "yes";
  const result = await setSeriesRepeat(await getDb(), s.user.shopId, seriesId, keepRepeating);
  const notice = !result ? "series-error" : keepRepeating ? "series-repeating" : "series-stopped";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

const cadenceSchema = z.object({
  repeatIntervalWeeks: z.coerce.number().int().min(MIN_INTERVAL_WEEKS).max(MAX_INTERVAL_WEEKS),
  // Blank is the answer, not a missing one: it means the run keeps going.
  repeatEndsOn: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.string().refine(isValidCalendarDate).optional(),
  ),
});

/**
 * Change a running series' cadence — which weekdays, how many weeks apart, and
 * when it ends.
 *
 * Widening (a weekday added, the end date pushed out) fills the horizon in the
 * same call. Narrowing cancels **nothing**: the dates that no longer fit are
 * counted and reported, and taking them off the board is a separate tap
 * (`cancelOffCadenceSeriesAction`). Those are real departures with real divers,
 * and a cadence edit that silently emptied a fortnight of the schedule is the
 * one outcome this whole two-step exists to prevent.
 */
export async function updateSeriesCadenceAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const parsed = cadenceSchema.safeParse(Object.fromEntries(formData));
  // The weekday chips repeat one field name, which `Object.fromEntries`
  // collapses to the last of them — read off the form itself, as the board's
  // add panel does.
  const weekdays = weekdaySetFrom(formData.getAll("repeatWeekday").map((value) => Number(value)));
  if (!parsed.success || !isValidWeekdaySet(weekdays)) {
    redirect(noticeUrl(back, "series-error"));
  }
  const result = await updateSeriesCadence(await getDb(), s.user.shopId, seriesId, {
    intervalWeeks: parsed.data.repeatIntervalWeeks,
    weekdays,
    endsOn: parsed.data.repeatEndsOn ?? null,
  });
  const notice = !result
    ? "series-error"
    : result.offCadence > 0
      ? "series-cadence-narrowed"
      : "series-cadence-saved";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * The second half of narrowing: take the upcoming dates the new cadence no
 * longer fires on off the public schedule. Cancels, never deletes, so each one
 * is reinstatable from its own trip page.
 */
export async function cancelOffCadenceSeriesAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const cancelled = await cancelOffCadenceSeriesTrips(await getDb(), s.user.shopId, seriesId);
  const notice = cancelled > 0 ? "series-off-cadence-cancelled" : "series-error";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * Adds a note **without navigating.** A note is written from a textarea inside
 * an open `<details>` two thirds of the way down a roster card, and the
 * `revalidateAndRedirect(...?notice=note-added)` this used to end with was a
 * real navigation: the page returned scrolled to its top with every disclosure
 * on it shut, so the staffer who had just written one note about diver seven
 * had to find diver seven again to write the second. `revalidatePath` alone
 * re-renders the same page in place — the note appears in the list directly
 * above the box it was typed in, which is the confirmation the banner was
 * standing in for (docs/design/forms-and-controls.md; design principle 9).
 * The form is keyed on the note count in `RosterSection`, so landing one
 * clears the box.
 *
 * A refusal still redirects: an empty or over-long note leaves nothing on the
 * page to read the outcome from, so it keeps the banner it has always had.
 */
export async function addInternalNoteAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("note") ?? "");
  const saved = await addInternalNote(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    actorPersonId: s.user.personId,
    bookingId,
    body,
  });
  if (!saved) revalidateAndRedirect(back, noticeUrl(back, "invalid"));
  revalidatePath(back);
}

/**
 * Land-then-undo (docs/design/principles.md §7): the note is a purely
 * reversible edit — recreating it is exactly what a text note supports — so
 * this lands immediately instead of holding for a blocking confirm. The
 * deleted booking + text ride along in the redirect so the toast on the next
 * render can offer a one-tap restore.
 */
export async function deleteInternalNoteAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const noteId = String(formData.get("noteId") ?? "");
  const result = await deleteInternalNote(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    actorPersonId: s.user.personId,
    noteId,
  });
  revalidateAndRedirect(
    back,
    result.deleted
      ? // The booking and the note's text ride along so the next render can offer
        // the one-tap restore; `noticeUrl` percent-encodes both, which is what the
        // hand-rolled `encodeURIComponent` here used to do for the body alone.
        noticeUrl(back, "note-deleted", {
          noteBookingId: result.bookingId,
          noteBody: result.body,
        })
      : noticeUrl(back, "invalid"),
  );
}

/**
 * Undo a note delete from the land-then-undo toast. Recreates a *new* note
 * with the same booking and text through the same `addInternalNote`
 * insert-and-log path a fresh note takes — the deleted row's id is gone and
 * isn't needed for that, since this doesn't resurrect the old row.
 */
export async function restoreInternalNoteAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("body") ?? "");
  const restored = bookingId
    ? await addInternalNote(await getDb(), {
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        bookingId,
        body,
      })
    : null;
  // Reuses the "note-added" notice: a restore is, from the banner's
  // perspective, indistinguishable from adding a fresh note with the same
  // text — no dedicated "note-restored" code needed.
  revalidateAndRedirect(back, noticeUrl(back, restored ? "note-added" : "invalid"));
}

/** Staff-entered wait-list entry — only valid once the trip is actually full. */
export async function addToWaitlistAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = parseAddDiver(formData);
  if (!parsed.success) redirect(noticeUrl(back, "diver-invalid"));
  const outcome = await joinTripWaitlist(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "staff" });
    revalidateAndRedirect(back, noticeUrl(back, "diver-waitlisted"));
  }
  redirect(noticeUrl(back, WAITLIST_NOTICE[outcome.reason]));
}

/**
 * What a one-tap wait-list invite reports back to the control: `sent` when the
 * freed-seat email actually went out through the notification seam, `fallback`
 * when it didn't (no provider configured, or the diver has no address on file)
 * so the UI opens the prewritten mailto/copy composer instead of pretending
 * mail is on its way. Either way the invite is stamped so nobody double-invites.
 */
export type WaitlistInviteResult = "sent" | "fallback";

/**
 * Invite a wait-list diver to grab a freed seat: stamps `invitedAt` (so the
 * entry reads "Invited just now" and two staff don't both reach out) and emails
 * them the trip's booking link through the shared notification seam. When email
 * isn't wired up, the control falls back to the composer — the send is the
 * default now, the composer is the safety net.
 */
export async function inviteWaitlistAction(
  shopSlug: string,
  tripId: string,
  entryId: string,
): Promise<WaitlistInviteResult> {
  const s = (await requireShopSurface(shopSlug)).session;
  const result = await inviteWaitlistDiver(await getDb(), {
    shopId: s.user.shopId,
    shopSlug,
    entryId,
  });
  revalidatePath(tripPath(shopSlug, tripId));
  // The freed-seat row also lives on Today, so refresh the queue after an invite
  // whether it was sent from the roster or straight from Today (WP-9 → §7).
  revalidatePath(shopPath(shopSlug));
  return result.ok && result.delivery === "sent" ? "sent" : "fallback";
}

/**
 * Records a staff outreach attempt for a request-origin invitation. The
 * browser then opens the same safe composer fallback used by the wait-list
 * invite; this deliberately does not turn a lead into a booking or consume a
 * seat.
 */
export async function recordTripInvitationAction(
  shopSlug: string,
  tripId: string,
  invitationId: string,
): Promise<"sent" | "fallback"> {
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const result = await sendTripInvitation(db, {
    shopId: s.user.shopId,
    shopSlug,
    tripId,
    invitationId,
  });
  revalidatePath(tripPath(shopSlug, tripId));
  return result;
}

/** Invites an existing diver without seating them on the departure. */
export async function createDirectTripInvitationAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const guests = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const parsed = directInvitationSchema.safeParse({ personId: formData.get("personId") });
  if (!uuidParam(tripId) || !parsed.success) redirect(`${guests}#invite-person`);
  const db = await getDb();
  const created = await createDirectTripInvitation(db, {
    shopId: s.user.shopId,
    tripId,
    personId: parsed.data.personId,
    createdByPersonId: s.user.personId,
  });
  if (created) {
    const invitation = (await listTripInvitations(db, s.user.shopId, tripId)).find(
      ({ invitation }) =>
        invitation.source === "direct" && invitation.personId === parsed.data.personId,
    );
    if (invitation) {
      await sendTripInvitation(db, {
        shopId: s.user.shopId,
        shopSlug,
        tripId,
        invitationId: invitation.invitation.id,
      });
    }
  }
  revalidatePath(guests);
  redirect(`${guests}#invitations`);
}

type TripInvitationDelivery = "sent" | "fallback";

async function sendTripInvitation(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { shopId: string; shopSlug: string; tripId: string; invitationId: string },
): Promise<TripInvitationDelivery> {
  const context = await getTripInvitation(db, input.shopId, input.tripId, input.invitationId);
  if (!context) return "fallback";
  const invitedAt = nowDate();
  const recorded = await recordTripInvitation(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    invitationId: input.invitationId,
    now: invitedAt,
  });
  if (!recorded) return "fallback";
  const email = context.person?.email ?? context.request?.email ?? null;
  const origin = publicAppUrl();
  if (!email || !origin) return "fallback";
  const delivery = await sendNotification(db, {
    kind: "trip_invitation",
    invitationId: context.invitation.id,
    shopId: input.shopId,
    to: email,
    locale: recipientLocale(context.person?.locale, context.shop.defaultLocale),
    diverName: context.person?.fullName ?? context.request?.name ?? "Diver",
    shopName: context.shop.name,
    tripTitle: context.trip.title,
    startsAt: context.trip.startsAt,
    endsAt: context.trip.endsAt,
    timezone: context.shop.timezone,
    bookingUrl: new URL(publicTripPath(input.shopSlug, context.trip.id), `${origin}/`).toString(),
    invitedAt,
  });
  return delivery.status === "sent" ? "sent" : "fallback";
}

/**
 * Sends a staff-picked discount blast to every last-minute-list diver whose
 * date range covers this trip (docs ADR 20260727-last-minute-fill-promos).
 * A plain form action, not a one-tap control like the wait-list invite — the
 * discount percent is a real commercial choice, not a re-runnable nudge.
 */
export async function sendLastMinuteDealAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const anchor = "#last-minute-deal";
  // **Discounting is money work, wherever the button sits.** This mints a real
  // percentage coupon on the shop's connected Stripe account and mails it to a
  // list of divers — the same act as a shop-wide promo code, which
  // `/shop/[shopSlug]/promos` gates on this very predicate on both its page and
  // its actions. Ungated, a captain who may not change a departure's price
  // (`canConfigureTrips` says so explicitly) could discount that same departure
  // by the allowed maximum and send it out (issue #714). `canManagePaymentSettings`
  // names discount codes in its own docstring; two spellings of one concept had
  // opposite answers.
  const s = (
    await requireShopSurface(shopSlug, {
      allow: canPersonManagePaymentSettings,
      refusal: { notice: "not-authorized", landing: ["trips", tripId] },
    })
  ).session;
  const discountPercent = Number(formData.get("discountPercent"));
  if (!isValidLastMinuteDiscountPercent(discountPercent)) {
    redirect(noticeUrl(`${back}${anchor}`, "last-minute-invalid-discount"));
  }
  const recipientPersonIds = formData.getAll("recipientPersonIds").map(String).filter(Boolean);
  if (recipientPersonIds.length === 0) {
    redirect(noticeUrl(`${back}${anchor}`, "last-minute-no-recipients"));
  }
  const outcome = await sendLastMinuteDealBlast(await getDb(), {
    shopId: s.user.shopId,
    shopSlug,
    tripId,
    discountPercent,
    createdByPersonId: s.user.personId,
    recipientPersonIds,
  });
  if (outcome.ok) {
    // Today's nudge disappears once any blast has been sent, so refresh it
    // alongside the trip page it was sent from.
    revalidatePath(back);
    revalidatePath(shopPath(shopSlug));
    redirect(noticeUrl(`${back}${anchor}`, "last-minute-sent", { count: outcome.recipientCount }));
  }
  // The anchor goes into the path `noticeUrl` is handed, which puts the query
  // ahead of the `#last-minute-deal` fragment where it belongs.
  redirect(noticeUrl(`${back}${anchor}`, LAST_MINUTE_NOTICE[outcome.reason]));
}

/**
 * Whether a just-cancelled booking held a captured payment, so a staff member
 * who lacks refund permission (H-14) can be told a refund may be owed rather
 * than a bare "spot is open". Deliberately coarse — it doesn't apply the
 * cancellation window; the owner/manager who picks it up runs the real
 * `refundBookingOnCancellation` path and its window/forfeit logic.
 */
async function bookingRefundMayBeOwed(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
): Promise<boolean> {
  const payment = await getBookingPayment(db, shopId, bookingId);
  return isCapturedPaymentStatus(payment?.status);
}

/**
 * What a removed booking's refund outcome is called in the URL.
 *
 * A table rather than the `switch` with a `default:` this replaces: the default
 * arm answered for `no_policy` and `unpaid` by name in a comment, and would have
 * silently answered for any status added later too. Keyed by the union, so a
 * seventh outcome is a compile error here instead of an unexplained "spot is
 * open" banner on a refund a shop is owed.
 */
const REFUND_NOTICE: Record<CancellationRefundOutcome["status"], string> = {
  refunded: "booking-removed-refunded",
  forfeit: "booking-removed-forfeit",
  failed: "booking-removed-refund-failed",
  manual: "booking-removed-refund-manual",
  // The booking-level refund lock's two refusals. Neither is `failed`: nothing
  // is wrong at Stripe, and pressing again is precisely what must not happen.
  in_progress: "booking-removed-refund-in-progress",
  needs_reconciliation: "booking-removed-refund-reconcile",
  // Nothing owed either way — today's plain "spot is open" notice.
  no_policy: "booking-removed",
  unpaid: "booking-removed",
};

function refundNotice(refund: CancellationRefundOutcome): string {
  // `not_refundable` is a data mismatch (local row says paid, Stripe captured
  // nothing) — a "review", not the "refund owed by hand" claim the
  // counter/disconnected cases make. The only refusal whose code depends on
  // more than the status.
  if (refund.status === "manual" && refund.reason === "not_refundable") {
    return "booking-removed-refund-review";
  }
  return REFUND_NOTICE[refund.status];
}

export async function removeBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const dbi = await getDb();
  await cancelBooking(dbi, s.user.shopId, bookingId);
  await trackEvent({ name: "booking_cancelled", source: "staff" });
  // Same activity line an add writes (addBookingAction), for the same reason:
  // the trip's log, read from the Trip surface, is the record of who touched
  // the roster and when. A removal is the entry that matters most of the two
  // — "who took this diver off the manifest?" is a question asked at the
  // dock, and until now the log could not answer it.
  const removedName = await bookingDiverName(dbi, s.user.shopId, bookingId);
  if (removedName) {
    await recordTripActivity(dbi, {
      shopId: s.user.shopId,
      tripId,
      actorPersonId: s.user.personId,
      action: `removed ${removedName} from the trip`,
    });
  }
  // Freeing the seat is roster work any staff member does, but moving money is
  // owner/manager work (H-14, ADR 20260724-role-authorization). A crew member
  // can cancel the booking; the auto-refund below only fires when the actor may
  // refund. When they can't, the seat is still freed and a paid booking hands
  // the refund up to an owner/manager instead of quietly refunding under a role
  // that isn't allowed to.
  if (!(await canPersonRefund(dbi, s.user.shopId, s.user.personId))) {
    const owed = await bookingRefundMayBeOwed(dbi, s.user.shopId, bookingId);
    const notice = owed ? "booking-removed-refund-owner" : "booking-removed";
    revalidateAndRedirect(back, noticeUrl(back, notice, { bid: bookingId }));
  }
  // A cancel inside the shop's stated window auto-refunds a Stripe payment;
  // everything else (no window, counter payment, Stripe off) degrades to the
  // staff-run refund the notice calls out. The seat is already freed above, so
  // a refund failure never blocks the cancellation (docs H-07).
  const refund = await refundBookingOnCancellation(dbi, {
    shopId: s.user.shopId,
    bookingId,
  });
  if (refund.status !== "no_policy" && refund.status !== "unpaid") {
    await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
  }
  revalidateAndRedirect(back, noticeUrl(back, refundNotice(refund), { bid: bookingId }));
}

export async function undoRemoveBookingAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const dbi = await getDb();
  const outcome = await restoreBooking(dbi, s.user.shopId, bookingId);
  if (outcome === "not_found") redirect(back);
  // The undo can be refused three ways, and they need different things done
  // about them: the boat's capacity, a course session's instructor-to-student
  // ratio (a walk-up may have taken the freed seat in between), or the trip
  // having been cancelled out from under the roster. Nothing about a wait
  // list helps with that last one — the fix is reinstating the trip — so it
  // gets its own words.
  const restoreNotice =
    outcome === "trip_full"
      ? "booking-restore-full"
      : outcome === "course_ratio_full"
        ? "booking-restore-ratio"
        : outcome === "trip_cancelled"
          ? "booking-restore-cancelled"
          : "booking-restored";
  if (outcome === "restored") {
    // Only a real restore is logged: a refused undo changed nothing, and an
    // activity line for it would read like the diver went back on the boat.
    const restoredName = await bookingDiverName(dbi, s.user.shopId, bookingId);
    if (restoredName) {
      await recordTripActivity(dbi, {
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        action: `put ${restoredName} back on the trip`,
      });
    }
  }
  revalidateAndRedirect(back, noticeUrl(back, restoreNotice));
}

/**
 * Staff confirm a flagged booking is the person it was attached to (H-13),
 * clearing the `identity_unconfirmed` readiness blocker. Same shop-scoped
 * session gate as every roster action; a no-op on an already-clear booking
 * still settles cleanly so a double-tap is harmless.
 */
export async function confirmDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const confirmed = await confirmBookingIdentity(await getDb(), s.user.shopId, bookingId);
  revalidateAndRedirect(
    back,
    noticeUrl(back, confirmed ? "identity-confirmed" : "invalid", { bid: bookingId }),
  );
}

/**
 * The one path from "this shop's own instructor taught and ran this course"
 * to a `certifications` row this shop's own booking gate will actually read
 * (issue #717) — a per-student tap on the course session's own roster,
 * never automatic. See `issueShopCertification`'s doc comment for why the
 * card lands `verified` immediately with no number yet.
 */
export async function certifyDiverFromRosterAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const award = String(formData.get("award") ?? "");
  if (!bookingId || !personId || !award) redirect(back);
  const db = await getDb();
  const issued = { shopId: s.user.shopId, personId, tripId, issuedByPersonId: s.user.personId };

  // **Three destinations, and two different landings.** A level card lands
  // `verified` on this tap — the instructor is the evidence (issue #717, ADR
  // 20260824-shop-issued-certification-is-verified). A specialty or nitrox card
  // lands `pending` and clears nothing until a staffer confirms it against the
  // physical card (issue #975, ADR
  // 20260827-shop-issued-specialty-cards-are-attested). The difference is
  // deliberate and the notice below says which happened, because a staffer who
  // believes a nitrox card is live when it is pending is the failure this whole
  // design is arranged to prevent.
  const level = DECLARABLE_CERTIFICATION_LEVELS.find((value) => value === award);
  const specialty = diveSpecialty.enumValues.find((value) => value === award);
  const written = level
    ? await issueShopCertification(db, { ...issued, level })
    : specialty
      ? await issueShopSpecialtyCertification(db, { ...issued, specialty })
      : award === "nitrox"
        ? await issueShopNitroxCertification(db, issued)
        : null;
  if (!level && !specialty && award !== "nitrox") redirect(back);

  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      written ? (level ? "certified" : "certified-awaiting-card") : "certify-failed",
      { bid: bookingId },
    ),
  );
}

/**
 * Staff records that a diver signed a paper release in person or on shore, for a
 * diver the app never sees sign. Same shop-scoped session gate as every other
 * roster action; the accountable staff member is stamped on the record. Requires
 * an explicit medical-clear attestation — a flagged medical must go through the
 * diver-facing link, which captures the questionnaire and routes to review.
 *
 * Success does not navigate. The control lives inside a `<details>` on one
 * card of a roster that can run a boat long, and redirecting for a success
 * banner threw the page back to its top with every disclosure shut — for news
 * the card itself delivers better: the waiver control the finger was just on
 * becomes "Signed on paper · <date>", and the blocker above it clears. Same
 * rule the counter queue already states in its own `noticeCopy` table. A
 * refusal keeps its redirect: the attestation was not given, so there is no
 * new row state to read the answer from.
 */
export async function markWaiverInPersonAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(noticeUrl(back, "waiver-error"));
  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: s.user.shopId,
    subject: { bookingId },
    recordedByPersonId: s.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  if (!outcome.ok) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, IN_PERSON_WAIVER_NOTICE[outcome.reason], {
        bid: bookingId,
      }),
    );
  }
  revalidatePath(back);
}

/**
 * Staff record (or correct) a diver's emergency contact straight from the
 * roster — the fallback for a diver who never filled it in themselves, and
 * the field Today's "ask at the counter" nudge used to have nowhere to land
 * (UX persona Lens 17, task 144). Writes through the same
 * `saveBookingEmergencyContact` the diver-facing /ready and /waivers capture
 * uses, so there is exactly one write path regardless of who fills it in.
 * Prints on the manifest — safety-adjacent, hence the shop-scoped booking
 * lookup inside `saveBookingEmergencyContact` rather than trusting the
 * `bookingId` field alone, and a blank submission is reported distinctly from
 * a genuine failure rather than silently landing on the same "invalid" notice.
 */
export async function saveRosterEmergencyContactAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const bookingId = String(formData.get("bookingId") ?? "");
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!bookingId || !parsed.success) redirect(noticeUrl(back, "invalid"));
  const name = (parsed.data.emergencyContactName ?? "").trim();
  const phone = (parsed.data.emergencyContactPhone ?? "").trim();
  await saveBookingEmergencyContact(await getDb(), {
    shopId: s.user.shopId,
    bookingId,
    name,
    phone,
  });
  // A contact is only usable with a reachable number, so only a name+phone
  // pair earns the "saved" confirmation — matches `saveEmergencyContactFromReady`.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    back,
    noticeUrl(back, complete ? "contact-saved" : "contact-incomplete", { bid: bookingId }),
  );
}

export async function markPaymentAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = paymentStatusSchema.safeParse(formData.get("status"));
  // **Recording money is crew work; deciding about money is not.** Counter cash
  // at the dock is exactly front-desk work, so `paid` and `deposit_paid` stay
  // open to every staff member. `waived` is a free seat and `refunded` marks a
  // booking refunded *without moving any money* — taking it out of
  // `COLLECTED_PAYMENT_STATUSES` and silently reducing the shop's reported
  // revenue for the month. Both are the write-off that `canRefund` gates
  // everywhere else, and this action accepted the whole enum from the form
  // (issue #714).
  //
  // **The gate is on the transition, not the destination.** Asking only "is
  // this staffer entering a write-off" left the way *out* of one wide open:
  // `setBookingPayment` trusts its caller (only `setBookingPaymentIfNotFinal`
  // refuses to overwrite a final status), so a captain could take a booking the
  // owner had already refunded and mark it `paid` again. That is not a wording
  // problem — it raises reported revenue on money that was returned, wipes the
  // row's pointer at the real Stripe refund, and puts the seat back into
  // `listOwedShopCancellationRefunds`, whose own docstring calls a `paid` row on
  // a cancelled trip "the obvious way to get this wrong". Found by
  // `security-reviewer` after #714 shipped.
  const db = await getDb();
  const s = (await requireShopSurface(shopSlug)).session;
  const current = bookingId ? await getBookingPayment(db, s.user.shopId, bookingId) : null;
  // Checked before the gate: the control keeps a booking's *current* status
  // selectable, so a captain looking at a waived seat can submit `waived`
  // unchanged. Nothing is decided by a tap that changes nothing, and refusing
  // it would be a confusing refusal rather than a protection.
  //
  // Compared against the **raw** submitted value rather than the parsed one.
  // `paymentStatusSchema` deliberately omits `partly_refunded` — no dropdown
  // may move money — but the control still renders the booking's current
  // status as an option, so on a part-refunded seat the unchanged submit
  // failed to parse, missed this branch, and dead-ended at `?notice=invalid`:
  // an unexplained refusal on a money row for a tap that changed nothing
  // (issue #699 security review).
  const submitted = String(formData.get("status") ?? "");
  if (current?.status !== undefined && current.status === submitted) {
    revalidateAndRedirect(back, noticeUrl(back, "payment", { bid: bookingId }));
  }
  const decidesAboutMoney =
    (status.success && paymentStatusClass(status.data) === "write_off") ||
    (current?.status !== undefined && paymentStatusClass(current.status) === "write_off");
  if (decidesAboutMoney && !(await canPersonRefund(db, s.user.shopId, s.user.personId))) {
    redirect(noticeUrl(back, "not-authorized"));
  }
  const saved =
    bookingId && status.success
      ? await setBookingPayment(db, {
          shopId: s.user.shopId,
          bookingId,
          status: status.data,
          // Counter cash is still money the shop took in its own currency —
          // stamping this row `usd` by default told a Mexican shop's diver
          // their balance was in dollars.
          currency: await getShopCurrency(db, s.user.shopId),
        })
      : null;
  // `bid` rides along so the roster can hold that diver's card open on the
  // way back: a settled card collapses, and the payment selector a staffer
  // just used must never be what collapses it out from under them.
  revalidateAndRedirect(
    back,
    saved ? noticeUrl(back, "payment", { bid: bookingId }) : noticeUrl(back, "invalid"),
  );
}

export async function saveRequirementsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  // Re-derive the course flag server-side rather than trusting a client field:
  // a course session's admission rules are frozen and must not be editable here,
  // and upsertTripRequirements has no independent course check.
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (trip?.courseId) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  const specialties = z.array(specialtySchema).safeParse(formData.getAll("specialty").map(String));
  if (!specialties.success) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  // A payment gate on an unpriced departure blocks every diver who books it,
  // forever, and nothing ever asks them for money — so this one combination is
  // refused rather than saved and explained afterwards (issue #692).
  if (
    paymentGateIsUnclearable(formData.get("requiresPayment") === "on", trip?.priceCents ?? null)
  ) {
    redirect(noticeUrl(back, "requirements-need-price", { form: "requirements" }));
  }
  // Who was already blocked, read *before* the write — see the count below.
  const blockedBefore = new Set(
    (await listTripReadiness(db, s.user.shopId, tripId))
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => row.booking.id),
  );
  const saved = await upsertTripRequirements(db, {
    shopId: s.user.shopId,
    tripId,
    requiresWaiver: parsed.data.requiresWaiver === "on",
    minimumCertificationLevel: parsed.data.minimumCertificationLevel,
    requiredSpecialties: specialties.data,
    requiresNitrox: formData.get("requiresNitrox") === "on",
    requiresPayment: formData.get("requiresPayment") === "on",
  });
  if (!saved) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  // **Who this just blocked.** Readiness is computed live from the trip's
  // current requirement row and the sites it visits, so a tightened gate
  // already reaches every booked diver the moment it is saved — they turn up
  // blocked on Today, the schedule board, the roster, and the manifest without
  // anything here re-checking them. What was missing is that the staffer who
  // tightened it walked away not knowing, and found out when a diver did.
  //
  // So this is a notice, not a gate: it never refuses the save (a shop may
  // legitimately tighten a gate and then work the roster), it just counts who
  // the new rule left behind.
  //
  // **Blocked status, differenced across the save** — not a filter on blocker
  // category. This counted only `certification` blockers, so ticking "Requires
  // waiver" on a roster nobody had signed, or "Requires payment" on a roster
  // nobody had paid, blocked every diver aboard and reported *zero* — and then
  // rendered the reassuring plain-success notice, which actively says nobody
  // was affected. Those two are the toggles most likely to block a whole
  // roster at once, because certification varies diver by diver while "has
  // anyone paid yet" is usually uniform: the notice was quietest exactly where
  // it had the most to say (issue #693).
  //
  // The difference, rather than the total, is what makes the sentence true —
  // it says these divers "no longer meet" the requirements, and a departure
  // where nobody had signed yet was already showing them as blocked. It also
  // needs no category list to maintain: a `setup` blocker cannot *appear* from
  // saving a requirement row (saving is what clears `requirements_not_configured`),
  // so nothing has to be excluded by hand. The cost is one extra readiness pass
  // over one boat's roster, on a form submit that already redirects.
  const blocked = (await listTripReadiness(db, s.user.shopId, tripId)).filter(
    (row) => row.readiness.status === "blocked" && !blockedBefore.has(row.booking.id),
  ).length;
  revalidateAndRedirect(
    back,
    blocked > 0
      ? noticeUrl(back, "requirements-blocking", { count: blocked })
      : noticeUrl(back, "requirements"),
  );
}

export async function updateTripCrewAction(
  shopSlug: string,
  tripId: string,
  change: TripCrewChange,
): Promise<{ ok: boolean }> {
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  const success = await changeTripCrew(db, s.user.shopId, tripId, change);
  if (success) {
    // One write path for crew (Today's board and the trip's CrewSection both
    // call this), so the trip's activity log — read from the Trip surface —
    // stays the single record of who touched the crew and when, regardless of
    // which surface they used.
    const [person] = await db
      .select({ fullName: people.fullName })
      .from(people)
      .where(and(eq(people.id, change.personId), eq(people.shopId, s.user.shopId)))
      .limit(1);
    if (person) {
      await recordTripActivity(db, {
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        action:
          change.operation === "assign"
            ? `assigned ${person.fullName} to crew`
            : `removed ${person.fullName} from crew`,
      });
    }
    revalidatePath(shopPath(shopSlug));
    revalidatePath(shopPath(shopSlug, "trips", tripId));
    revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
    return { ok: true };
  }
  return { ok: false };
}

const updatePickupSchema = z.object({
  pickupTime: z.string().trim().max(20).optional(),
  hotelPickupLocation: z.string().trim().max(300).optional(),
});

export async function updateBookingPickupAction(
  shopSlug: string,
  tripId: string,
  bookingId: string,
  formData: FormData,
) {
  const s = (await requireShopSurface(shopSlug)).session;
  const back = shopPath(shopSlug, "trips", tripId);
  const parsed = updatePickupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(noticeUrl(back, "pickup-invalid", { bid: bookingId }));
  }
  const db = await getDb();
  const pickupTime = parsed.data.pickupTime ? parsed.data.pickupTime.trim() || null : null;
  const hotelPickupLocation = parsed.data.hotelPickupLocation
    ? parsed.data.hotelPickupLocation.trim() || null
    : null;

  await setBookingPickupDetails(db, {
    shopId: s.user.shopId,
    bookingId,
    pickupTime,
    hotelPickupLocation,
  });

  revalidatePath(shopPath(shopSlug));
  revalidatePath(shopPath(shopSlug, "trips", tripId));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "prep"));
  revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
  revalidateAndRedirect(back, noticeUrl(back, "pickup-saved", { bid: bookingId }));
}
