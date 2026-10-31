"use server";

/**
 * The departure's Details form, and cancelling or reinstating it. Trip definition
 * goes through `requireTripConfig`; a single trip's cancel is the crew's call and
 * takes the ordinary preamble (`actions.authz.test.ts` files each one). The rest
 * of the About and Details tab is split by what it changes: `series-actions.ts`,
 * `conditions-actions.ts`, `crew-actions.ts`, `terms-actions.ts` and
 * `print-actions.ts`.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { cancelDeparture } from "@/db/aboard-at-sea";
import { getBoatById } from "@/db/boats";
import { getDb } from "@/db/client";
import { flushUrgentCrewNotices } from "@/db/crew-notices";
import { publishManifestEvent } from "@/db/manifest-events";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { getTripRequirements } from "@/db/readiness";
import { getShopById } from "@/db/shops";
import { getTripLens } from "@/db/trip-lenses";
import { holdRescheduleNotice } from "@/db/trip-rescheduled";
import {
  getTripWithBooked,
  listTripScheduleDays,
  reinstateTripClearingMinimum,
  type TripPatch,
  type UpdateTripOutcome,
  updateTrip,
  updateTripSection,
} from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { checkbox, formValue, readForm } from "@/lib/form-parse";
import { parseWetsuitThicknessMm } from "@/lib/gear";
import { meetingPointMoved, meetingPointOfRows } from "@/lib/meeting-point";
import { MAX_DECISION_HOURS, MAX_MINIMUM_BOOKINGS, MIN_DECISION_HOURS } from "@/lib/minimum-seats";
import { minorToMajor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { deleteStoredImage, storeArrivalImage } from "@/lib/storage";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { firstOfferedDiveMode, shopOffersDiveMode, tripDetailsPatch } from "@/lib/trip-details";
import { MAX_COURSE_DIVES } from "@/lib/trip-dive-limits";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { toDateInputValue, toTimeInputValue, utcToWallTime } from "@/lib/zoned";
import {
  DEPARTURE_SECTION_FIELDS,
  type DepartureDetailsSection,
  departureSectionForm,
  departureSectionPatch,
  isDepartureDetailsSection,
} from "./departure-detail-sections";
import { tripPath } from "./roster-booking";
import { requireTripConfig } from "./trip-config";

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
  plannedDives: z.coerce.number().int().min(1).max(MAX_COURSE_DIVES),
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
  // Lunch is served aboard: the Day-of form then asks each diver for a lunch
  // preference, and Prep and the paper day say it (fifth-loop ideas, item 56).
  lunchAboard: z.preprocess((value) => value === "on", z.boolean()),
  // The wetsuit the boat is running today (issue #2206): whole millimetres,
  // or "" for not said. Only on the form of a shop that rents wetsuits, so
  // absent leaves the departure's answer alone.
  wetsuitThicknessMm: z
    .string()
    .trim()
    .max(2)
    .refine((value) => value === "" || parseWetsuitThicknessMm(value) !== null)
    .optional(),
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
 * A trip-save refusal's `?notice=` code. `invalid` and `not_found` both land on
 * the generic form error — the staffer's next move is the same either way — but
 * they are spelled out rather than reached by falling off the end of a ladder.
 */
const UPDATE_TRIP_NOTICE: Record<Extract<UpdateTripOutcome, { ok: false }>["reason"], string> = {
  invalid: "invalid",
  not_found: "invalid",
  capacity_below_booked: "capacity-below-booked",
  boat_not_found: "boat-not-found",
  capacity_above_certificate: "capacity-above-certificate",
  planned_dives_below_history: "planned-dives-below-history",
};

export async function saveDetailsSection(
  shopSlug: string,
  tripId: string,
  section: DepartureDetailsSection,
  submitted: FormData,
) {
  const s = await requireTripConfig(shopSlug, tripId);
  if (!isDepartureDetailsSection(section))
    redirect(noticeUrl(tripPath(shopSlug, tripId), "invalid", { form: "details" }));
  return saveDepartureDetails(
    shopSlug,
    tripId,
    departureSectionForm(section, submitted),
    s,
    section,
  );
}

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const s = await requireTripConfig(shopSlug, tripId);
  return saveDepartureDetails(shopSlug, tripId, formData, s);
}

async function saveDepartureDetails(
  shopSlug: string,
  tripId: string,
  formData: FormData,
  s: Awaited<ReturnType<typeof requireTripConfig>>,
  section?: DepartureDetailsSection,
) {
  const back = tripPath(shopSlug, tripId);
  const dbi = await getDb();
  const shopNow = await getShopById(dbi, s.user.shopId);
  const tripNow = await getTripWithBooked(dbi, s.user.shopId, tripId);
  if (!shopNow || !tripNow) redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
  const sectionSchemas = {
    departure: detailsSchema.pick({ title: true, description: true, lensId: true }),
    plan: detailsSchema.pick({
      plannedDives: true,
      wetsuitThicknessMm: true,
      exceedsNoDecoLimits: true,
      lunchAboard: true,
    }),
    meeting: detailsSchema.pick({
      meetingPointLabel: true,
      meetingPointAddress: true,
      arrivalLandmark: true,
      arrivalParkingNote: true,
      arrivalTransitNote: true,
      arrivalLookFor: true,
      arrivalFirstInteraction: true,
    }),
    timing: detailsSchema.pick({ date: true, startTime: true, endTime: true, dayCount: true }),
    booking: detailsSchema.pick({
      capacity: true,
      priceDollars: true,
      depositDollars: true,
      cancellationWindowHours: true,
      minimumBookings: true,
      minimumDecisionHours: true,
      isPrivate: true,
    }),
    boat: detailsSchema.pick({ diveMode: true, boatId: true, selfGuided: true }),
  };
  if (section && !sectionSchemas[section].safeParse(Object.fromEntries(formData)).success)
    redirect(noticeUrl(back, "invalid", { form: section }));
  const days = section ? await listTripScheduleDays(dbi, s.user.shopId, tripId) : [];
  const start = utcToWallTime(tripNow.startsAt, shopNow.timezone);
  const end = utcToWallTime(days[0]?.endsAt ?? tripNow.endsAt, shopNow.timezone);
  const money = (value: number | null) =>
    value === null ? "" : String(minorToMajor(value, shopNow.currency));
  const defaults = section
    ? {
        title: tripNow.title,
        description: tripNow.description ?? "",
        meetingPointLabel: tripNow.meetingPointLabel ?? "",
        meetingPointAddress: tripNow.meetingPointAddress ?? "",
        date: toDateInputValue(start),
        startTime: toTimeInputValue(start),
        endTime: toTimeInputValue(end),
        dayCount: days.length || 1,
        capacity: tripNow.capacity,
        plannedDives: tripNow.plannedDives,
        priceDollars: money(tripNow.priceCents),
        depositDollars: money(tripNow.depositCents),
        cancellationWindowHours: tripNow.cancellationWindowHours ?? "",
        minimumBookings: tripNow.minimumBookings ?? "",
        minimumDecisionHours: tripNow.minimumDecisionHours ?? "",
        ...Object.fromEntries(
          (["isPrivate", "selfGuided", "exceedsNoDecoLimits", "lunchAboard"] as const)
            .filter((key) => !new Set<string>(DEPARTURE_SECTION_FIELDS[section]).has(key))
            .map((key) => [key, tripNow[key] ? "on" : ""]),
        ),
      }
    : {};
  const parsed = detailsSchema.safeParse({ ...defaults, ...Object.fromEntries(formData) });
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
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
    lunchAboard,
    wetsuitThicknessMm,
  } = parsed.data;
  // **The hull this departure will sail on after the edit** — the one just
  // submitted, or the one already stored when the form did not carry the
  // field. Checking the destination rather than the origin is what makes a
  // swap to a smaller boat land on the right number, and switching away from
  // `boat` drops the hull the same way `tripDetailsPatch` does.
  //
  // A departure with no boat, or a shore or pool dive, yields no capacity and
  // is not checked.
  // A blank submitted selector clears the hull; an absent selector preserves it.
  // In a single-mode shop the form omits diveMode, but its boat selector can
  // still change the hull, so carry the current mode through the shared patch.
  const hasBoatSelector = formData.has("boatId");
  const patchDiveMode = diveMode ?? (hasBoatSelector ? (tripNow?.diveMode ?? "boat") : undefined);
  const nextMode = patchDiveMode
    ? shopOffersDiveMode(shopNow, patchDiveMode)
      ? patchDiveMode
      : firstOfferedDiveMode(shopNow)
    : tripNow?.diveMode;
  const nextBoatId =
    nextMode === "boat" ? (hasBoatSelector ? (boatId ?? null) : (tripNow?.boatId ?? null)) : null;
  const nextBoat = nextBoatId ? await getBoatById(dbi, s.user.shopId, nextBoatId) : null;
  // The same tenant rule the hull above obeys: a lens id arriving on this form
  // has to be one of *this* shop's live words, or the select becomes a
  // cross-tenant door.
  if (lensId && !(await getTripLens(dbi, s.user.shopId, lensId))) {
    redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
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
  // The later days' dates when they are not consecutive (third UX review,
  // item 10); empty is the consecutive run.
  const laterDates = z.array(z.string()).safeParse(formData.getAll("meetingDate"));
  if (!laterDates.success) redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
  const courseOwnsPrice = tripNow.course !== null && tripNow.course.priceCents !== null;
  const details = tripDetailsPatch(
    {
      date,
      startTime,
      endTime,
      dayCount,
      laterDates: laterDates.data,
      // A catalog-priced course owns its full enrollment amount. Ignore any
      // stale or forged trip fee and clear it from this departure on save.
      priceDollars: courseOwnsPrice ? undefined : priceDollars,
      paymentGatePriceCents: courseOwnsPrice
        ? perDiverBookingPriceCents(tripNow, tripNow.course)
        : undefined,
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
      diveMode: patchDiveMode,
      boatId: nextBoatId,
      requiresPayment: gate?.requiresPayment ?? false,
    },
    shopNow,
  );
  if (!details.ok) redirectDetailsRefusal(back, details, section);
  const dives = tripDiveDraftsFromForm(formData, plannedDives);
  const photo = await arrivalPhotoChange(formData, back, section);
  const previousArrivalPhotoUrl = tripNow?.arrivalPhotoUrl ?? null;
  const nextArrivalPhotoUrl = photo.nextUrl;

  const patch: TripPatch = {
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
    lunchAboard,
    wetsuitThicknessMm:
      wetsuitThicknessMm === undefined ? undefined : parseWetsuitThicknessMm(wetsuitThicknessMm),
    priceCents: details.patch.priceCents,
    depositCents: details.patch.depositCents,
    cancellationWindowHours: details.patch.cancellationWindowHours,
    minimumBookings: details.patch.minimumBookings,
    minimumDecisionHours: details.patch.minimumDecisionHours,
    dives,
  };
  if (section && !formData.has("lensId")) delete patch.lensId;
  const outcome = section
    ? await updateTripSection(dbi, s.user.shopId, tripId, departureSectionPatch(section, patch), {
        captureRescheduleStart: true,
      })
    : await updateTrip(dbi, s.user.shopId, tripId, patch, { captureRescheduleStart: true });
  if (!outcome.ok) {
    await photo.discardUpload();
    redirectUpdateRefusal(back, outcome, section);
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
  // point moved in the same save. A save that moved only the meeting point
  // holds the same notice, about the place alone (#2443): otherwise the
  // divers turn up at the old dock.
  const placeMoved =
    (!section || section === "meeting") &&
    !!tripNow &&
    meetingPointMoved(
      meetingPointOfRows(shopNow, tripNow),
      meetingPointOfRows(shopNow, {
        meetingPointLabel: meetingPointLabel || null,
        meetingPointAddress: meetingPointAddress || null,
        arrivalLandmark: null,
        arrivalParkingNote: null,
      }),
    );
  const timeMoved = outcome.startMoved;
  const notice =
    tripNow && (timeMoved || placeMoved)
      ? await holdRescheduleNotice(dbi, {
          shopId: s.user.shopId,
          tripId,
          movedFrom: tripNow.startsAt,
          meetingPointMoved: placeMoved,
          actorPersonId: s.user.personId,
        })
      : null;
  // The save sent any fly-safe corrections it owed (#2927, `updateTrip`); one
  // that reached nobody, or threw, is said here, never as a failed save.
  const flySafe = outcome.flySafe;
  const savedNotice =
    flySafe === "failed"
      ? "saved-fly-safe-failed"
      : flySafe && flySafe.unreached.length > 0
        ? "saved-fly-safe-unreached"
        : "saved";
  revalidateAndRedirect(
    back,
    noticeUrl(back, savedNotice, {
      view: "details",
      ...(section ? { form: section } : {}),
      ...(notice ? { held: notice.id, tell: notice.told } : {}),
      ...(savedNotice === "saved-fly-safe-unreached" && flySafe && flySafe !== "failed"
        ? { count: flySafe.unreached.length }
        : {}),
    }),
  );
}

/** The Details form's refusal from `tripDetailsPatch`, as its notice. */
function redirectDetailsRefusal(
  back: string,
  details: Extract<ReturnType<typeof tripDetailsPatch>, { ok: false }>,
  section?: DepartureDetailsSection,
): never {
  if (details.reason === "end_before_start")
    redirect(noticeUrl(back, "end-before-start", { form: section ?? "details" }));
  if (details.reason === "days_out_of_order") {
    redirect(noticeUrl(back, "days-out-of-order", { form: section ?? "details" }));
  }
  if (details.reason === "price_required_by_gate") {
    redirect(noticeUrl(back, "price-required-by-gate", { form: section ?? "details" }));
  }
  if (details.reason === "capacity_above_certificate") {
    redirect(
      noticeUrl(back, "capacity-above-certificate", {
        count: details.limit,
        form: section ?? "details",
      }),
    );
  }
  redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
}

/**
 * The arrival photo the form asks for: a new upload stored now, a removal, or
 * no change (`nextUrl` undefined). `discardUpload` deletes the new file again
 * when the save that would have pointed at it is refused.
 */
const arrivalPhotoForm = z.object({ arrivalPhoto: formValue(), removeArrivalPhoto: checkbox() });

async function arrivalPhotoChange(
  formData: FormData,
  back: string,
  section?: DepartureDetailsSection,
) {
  let uploadedUrl: string | undefined;
  const { arrivalPhoto, removeArrivalPhoto: remove } = readForm(arrivalPhotoForm, formData);
  if (arrivalPhoto instanceof File && arrivalPhoto.size > 0) {
    const stored = await storeArrivalImage({
      filename: arrivalPhoto.name,
      contentType: arrivalPhoto.type,
      bytes: await arrivalPhoto.arrayBuffer(),
    });
    if (stored.status !== "stored") {
      redirect(noticeUrl(back, "arrival-photo-failed", { form: section ?? "details" }));
    }
    uploadedUrl = stored.url;
  }
  return {
    nextUrl: uploadedUrl ?? (remove ? null : undefined),
    discardUpload: async () => {
      if (uploadedUrl) await deleteStoredImage(uploadedUrl);
    },
  };
}

/** `updateTrip`'s refusal, as its notice. */
function redirectUpdateRefusal(
  back: string,
  outcome: Extract<UpdateTripOutcome, { ok: false }>,
  section?: DepartureDetailsSection,
): never {
  // Two of the three refusals carry a number into the banner ("4 divers are
  // already booked"), which is why this is a ladder over a plain table lookup
  // — but the code itself comes from one.
  if (outcome.reason === "capacity_above_certificate") {
    redirect(
      noticeUrl(back, "capacity-above-certificate", {
        count: outcome.detail.limit,
        form: section ?? "details",
      }),
    );
  }
  if (outcome.reason === "capacity_below_booked") {
    redirect(
      noticeUrl(back, UPDATE_TRIP_NOTICE[outcome.reason], {
        count: outcome.detail.bookedCount,
        form: section ?? "details",
      }),
    );
  }
  if (outcome.reason === "planned_dives_below_history") {
    redirect(
      noticeUrl(back, UPDATE_TRIP_NOTICE[outcome.reason], {
        count: outcome.detail.recordedDiveCount,
        form: section ?? "details",
      }),
    );
  }
  redirect(noticeUrl(back, "invalid", { form: section ?? "details" }));
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
  // Never while the boat may be on the water (`cancelDeparture`): a missing
  // diver would drop off Today and the shore alert.
  const outcome = await cancelDeparture(db, s.user.shopId, tripId, nowDate(), {
    actorPersonId: s.user.personId,
  });
  if (!outcome.ok) {
    redirect(
      outcome.reason === "trip_departed"
        ? noticeUrl(back, "cancel-underway")
        : noticeUrl(back, "invalid", { form: "lifecycle" }),
    );
  }
  // Its crew hear it is off now, not on the hour (ADR 20261009-crew-hear-about-their-boats).
  await flushUrgentCrewNotices(db, { shopId: s.user.shopId, tripIds: [tripId] });
  await publishManifestEvent(db, s.user.shopId, tripId);
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
