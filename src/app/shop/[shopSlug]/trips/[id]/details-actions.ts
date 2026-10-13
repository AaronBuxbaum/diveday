"use server";

/**
 * The departure's About and Details tab: what the dive is (details,
 * conditions, requirements, participant terms), its series, cancelling and
 * reinstating it, who crews it, and the print record. Everything that defines
 * the trip goes through `requireTripConfig`; the day-of doors take the
 * ordinary preamble (`actions.authz.test.ts` files each one).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getBoatById } from "@/db/boats";
import { getDb } from "@/db/client";
import { flushUrgentCrewNotices } from "@/db/crew-notices";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { sendNotification } from "@/db/notifications";
import { recordTripActivity } from "@/db/operations";
import { getShopPersonName } from "@/db/people";
import { getTripRequirements, listTripReadiness, upsertTripRequirements } from "@/db/readiness";
import { diveSpecialty } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getShopCurrency } from "@/db/stripe-accounts";
import { getTripLens } from "@/db/trip-lenses";
import { holdRescheduleNotice } from "@/db/trip-rescheduled";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  changeTripCrewOutcome,
  getTripWithBooked,
  listTripDiverContacts,
  reinstateTripClearingMinimum,
  setSeriesRepeat,
  setSeriesStandingCrew,
  setTripParticipantTerms,
  setTripStatus,
  type TripCrewChange,
  type UpdateTripOutcome,
  updateSeriesCadence,
  updateTrip,
  updateTripConditions,
} from "@/db/trips";
import { toDiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { depthToMeters, maxEnteredVisibility } from "@/lib/depth-units";
import { log } from "@/lib/log";
import { meetingPointMoved, meetingPointOfRows } from "@/lib/meeting-point";
import { MAX_DECISION_HOURS, MAX_MINIMUM_BOOKINGS, MIN_DECISION_HOURS } from "@/lib/minimum-seats";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications";
import { parseParticipantTerms } from "@/lib/participant-terms";
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
import { tripPath } from "./roster-booking";

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
  // The shop's own word for this kind of day (ADR
  // 20260904-reef-all-the-way-down, decision 2). An empty select clears it.
  lensId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid().optional()),
  isPrivate: z.preprocess((value) => value === "on", z.boolean()),
  // The shop's own divemaster target stops applying to this departure. Nothing
  // else moves: an agency training ratio still refuses a seat, and readiness,
  // admission and capacity never see this (issue #973).
  selfGuided: z.preprocess((value) => value === "on", z.boolean()),
  // The dives went past no-decompression limits: the recap then says nothing
  // about flying (H-84, issue #1555). Nothing else reads it.
  exceedsNoDecoLimits: z.preprocess((value) => value === "on", z.boolean()),
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

const specialtySchema = z.enum(diveSpecialty.enumValues);

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

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
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
    lensId,
    isPrivate,
    selfGuided,
    exceedsNoDecoLimits,
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
  // The same tenant rule the hull above obeys: a lens id arriving on this form
  // has to be one of *this* shop's live words, or the select becomes a
  // cross-tenant door.
  if (lensId && !(await getTripLens(dbi, s.user.shopId, lensId))) {
    redirect(noticeUrl(back, "invalid", { form: "details" }));
  }
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
      // And its certificate (H-107): no seat above it is sold.
      boatCertifiedPassengers: nextBoat?.certifiedPassengers ?? null,
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
    if (details.reason === "capacity_above_certificate") {
      redirect(
        noticeUrl(back, "capacity-above-certificate", { count: details.limit, form: "details" }),
      );
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
    // An empty select clears the word, which is why this is `?? null` rather
    // than the `undefined`-means-untouched shape the fields above use.
    lensId: lensId ?? null,
    isPrivate,
    selfGuided,
    exceedsNoDecoLimits,
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
  // **A retime tells the divers** (ux review 2026-10-11, item 1), the same
  // held send the board's move takes, and says where too when the meeting
  // point moved in the same save.
  const notice =
    tripNow && tripNow.startsAt.getTime() !== details.patch.startsAt.getTime()
      ? await holdRescheduleNotice(dbi, {
          shopId: s.user.shopId,
          tripId,
          movedFrom: tripNow.startsAt,
          meetingPointMoved: meetingPointMoved(
            meetingPointOfRows(shopNow, tripNow),
            meetingPointOfRows(shopNow, {
              meetingPointLabel: meetingPointLabel || null,
              meetingPointAddress: meetingPointAddress || null,
              arrivalLandmark: null,
              arrivalParkingNote: null,
            }),
          ),
          actorPersonId: s.user.personId,
        })
      : null;
  revalidateAndRedirect(
    back,
    noticeUrl(back, "saved", notice ? { held: notice.id, tell: notice.told } : undefined),
  );
}

export async function saveConditionsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
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
                sendNotification(db, {
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
  const back = tripPath(shopSlug, tripId);
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
  const back = tripPath(shopSlug, tripId);
  // A single trip's cancellation is the crew's weather go/no-go call (glossary):
  // the on-water lead must be able to take today's charter off the board so
  // divers are notified. It only flips status (no money moves — refunds stay
  // owner/manager on the per-booking path), so it's open to all staff. Bulk
  // schedule management (reinstate, whole-series cancel, create) stays config.
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  await setTripStatus(db, s.user.shopId, tripId, "cancelled", nowDate(), {
    actorPersonId: s.user.personId,
  });
  // Its crew hear it is off now, not on the hour (ADR 20261009-crew-hear-about-their-boats).
  await flushUrgentCrewNotices(db, { shopId: s.user.shopId, tripIds: [tripId] });
  revalidateAndRedirect(back, noticeUrl(back, "cancelled"));
}

export async function reinstateTripAction(shopSlug: string, tripId: string) {
  const back = tripPath(shopSlug, tripId);
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

/**
 * Push this date's editable details across every upcoming date in the series,
 * and, when the confirm's crew switch was on the form, its crew as the run's
 * standing crew too (`setSeriesStandingCrew`). The switch is only on the form
 * when this date has a crew to stand; absent, the run's standing crew is left
 * as it was.
 */
export async function applySeriesDetailsAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const result = await applyDetailsToFutureSeries(db, s.user.shopId, seriesId, tripId);
  const crew =
    result && formData.get("crewSwitch") === "shown"
      ? await setSeriesStandingCrew(db, {
          shopId: s.user.shopId,
          seriesId,
          sourceTripId: tripId,
          standing: formData.get("standingCrew") === "on",
          actorPersonId: s.user.personId,
        })
      : null;
  if (!result) {
    revalidateAndRedirect(back, noticeUrl(back, "series-error"));
    return;
  }
  revalidatePath(shopPath(shopSlug, "staffing"));
  revalidatePath(shopPath(shopSlug));
  revalidateAndRedirect(
    back,
    crew && crew.skipped > 0
      ? noticeUrl(back, "series-applied-crew-partial", { count: crew.skipped })
      : result.skipped > 0
        ? noticeUrl(back, "series-applied-partial")
        : crew && crew.updated > 0
          ? noticeUrl(back, "series-applied-crew")
          : noticeUrl(back, "series-applied"),
  );
}

/**
 * Cancel every upcoming date in the series at once, each through the blow-out
 * cascade: its divers are told the run has stopped, card payments go back by
 * themselves, and what cannot is owed on Today (`cancelFutureSeriesTrips`).
 *
 * Config-gated like the rest of the series acts: a single date's call is the
 * crew's, a whole run's is the schedule's. The series id is a bound argument,
 * so the write is scoped by the session's shop, never by the id alone.
 */
export async function cancelSeriesAction(shopSlug: string, tripId: string, seriesId: string) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const now = nowDate();
  const result = await cancelFutureSeriesTrips(db, {
    shopId: s.user.shopId,
    seriesId,
    calledByPersonId: s.user.personId,
    now,
  });
  // Null is the only failure: the run was not this shop's, and nothing
  // changed. Anything else stopped the repeat, so the notice says what the
  // dates did — a date that was underway still stands (review 2a, D3).
  if (!result) {
    revalidateAndRedirect(back, noticeUrl(back, "series-error"));
    return;
  }
  // One line on each date's own log, so a departure that disappeared from the
  // board says who took it and why.
  for (const tripOfRun of result.tripIds) {
    try {
      await recordTripActivity(db, {
        shopId: s.user.shopId,
        tripId: tripOfRun,
        actorPersonId: s.user.personId,
        entry: { code: "series_cancelled" },
      });
    } catch (error) {
      log("series.cancel_activity_failed", "error", {
        tripId: tripOfRun,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }
  revalidatePath(shopPath(shopSlug, "schedule", "board"));
  revalidatePath(shopPath(shopSlug));
  revalidateAndRedirect(
    back,
    result.skipped > 0
      ? noticeUrl(back, "series-cancelled-partly", { count: result.skipped })
      : noticeUrl(back, "series-cancelled", { count: result.divers }),
  );
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
  const back = tripPath(shopSlug, tripId);
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
  const back = tripPath(shopSlug, tripId);
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
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const cancelled = await cancelOffCadenceSeriesTrips(
    await getDb(),
    s.user.shopId,
    seriesId,
    nowDate(),
    { actorPersonId: s.user.personId },
  );
  const notice = cancelled > 0 ? "series-off-cadence-cancelled" : "series-error";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

/**
 * A departure's snorkeler price, rider price and diver seats (ADR
 * 20261007-participant-types). Trip configuration, so the same gate as the
 * requirements form; the parse is `parseParticipantTerms` and the rules the
 * database holds under the trip lock are `setTripParticipantTerms`.
 */
export async function saveParticipantTermsAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (!trip) redirect(back);
  const parsed = parseParticipantTerms(
    {
      snorkelerPrice: formData.get("snorkelerPrice"),
      riderPrice: formData.get("riderPrice"),
      diverSeats: formData.get("diverSeats"),
    },
    { currency: await getShopCurrency(db, s.user.shopId), capacity: trip.capacity },
  );
  if (!parsed.ok) redirect(noticeUrl(back, "participant-terms-invalid"));
  const outcome = await setTripParticipantTerms(db, s.user.shopId, tripId, parsed.patch);
  if (!outcome.ok) {
    redirect(
      outcome.reason === "diver_seats_below_booked"
        ? noticeUrl(back, "participant-terms-below-booked", { count: outcome.detail.divers })
        : noticeUrl(back, "participant-terms-invalid"),
    );
  }
  revalidateAndRedirect(back, noticeUrl(back, "participant-terms-saved"));
}

export async function saveRequirementsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
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
): Promise<{ ok: boolean; refusal?: "crew_clash" | "refused" }> {
  const s = (await requireShopSurface(shopSlug)).session;
  const db = await getDb();
  // The outcome rather than the boolean, because the Crew panel has something
  // to say about one of the refusals: "you cannot put this person on two boats
  // at once" is a sentence a staffer can act on, and "that didn't save" is one
  // they can only tap again over (issue #1695).
  const outcome = await changeTripCrewOutcome(db, s.user.shopId, tripId, change, {
    actorPersonId: s.user.personId,
  });
  if (outcome.ok) {
    // One write path for crew (Today's board and the trip's CrewSection both
    // call this), so the trip's activity log — read from the Trip surface —
    // stays the single record of who touched the crew and when, regardless of
    // which surface they used.
    const crewName = await getShopPersonName(db, s.user.shopId, change.personId);
    if (crewName !== null) {
      await recordTripActivity(db, {
        shopId: s.user.shopId,
        tripId,
        actorPersonId: s.user.personId,
        entry:
          change.operation === "assign"
            ? { code: "crew_assigned", crew: crewName }
            : { code: "crew_removed", crew: crewName },
      });
    }
    revalidatePath(shopPath(shopSlug));
    revalidatePath(shopPath(shopSlug, "trips", tripId));
    revalidatePath(shopPath(shopSlug, "trips", tripId, "manifest"));
    return { ok: true };
  }
  return { ok: false, refusal: outcome.refusal };
}
