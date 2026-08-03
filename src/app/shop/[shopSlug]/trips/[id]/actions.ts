"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips, canPersonRefund } from "@/db/authz";
import {
  bookingDiverName,
  cancelBooking,
  confirmBookingIdentity,
  restoreBooking,
} from "@/db/bookings";
import { getDb } from "@/db/client";
import { queueAndAttemptMediaDeletion } from "@/db/media-deletions";
import { addInternalNote, deleteInternalNote, recordTripActivity } from "@/db/operations";
import { getBookingPayment, setBookingPayment } from "@/db/payments";
import { upsertTripRequirements } from "@/db/readiness";
import { deleteRecapPhoto, setTripRecapShoutout } from "@/db/recap";
import { type CancellationRefundOutcome, refundBookingOnCancellation } from "@/db/refunds";
import { people } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getShopCurrency } from "@/db/stripe-accounts";
import { sendLastMinuteDealBlast } from "@/db/trip-promos";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  changeTripCrew,
  extendTripSeries,
  getLatestSeriesInstance,
  getTripSeriesById,
  getTripWithBooked,
  listTripDiverContacts,
  setTripStatus,
  type TripCrewChange,
  updateTrip,
  updateTripConditions,
} from "@/db/trips";
import { inviteWaitlistDiver, joinTripWaitlist } from "@/db/waitlist";
import { recordInPersonWaiver, saveBookingEmergencyContact } from "@/db/waivers";
import { toDiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { emergencyContactSchema } from "@/lib/contact";
import { depthToMeters, maxEnteredVisibility } from "@/lib/depth-units";
import { isValidLastMinuteDiscountPercent } from "@/lib/last-minute-list";
import { MAX_PRICE_MINOR_UNITS, majorToMinor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { notify, publicAppUrl } from "@/lib/notifications";
import { publicTripPath } from "@/lib/public-routes";
import { MAX_SERIES_OCCURRENCES, weeklyOccurrencesAfter } from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import {
  maxEnteredTemperature,
  minEnteredTemperature,
  temperatureToCelsius,
  temperatureUnitFor,
} from "@/lib/temperature-units";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS, tripMeetingDays } from "@/lib/trip-days";
import { tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
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
const requirementsSchema = z.object({
  requiresWaiver: z.string().optional(),
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"]).nullable(),
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
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(30).optional(),
});

function parseAddDiver(formData: FormData) {
  return addDiverSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
  });
}

// Trip-config actions (details, conditions, crew, requirements, cancel) settle
// back on Overview — "what the dive is". Roster actions (add/remove diver,
// wait list, waiver, payment) settle on Guests — "who is attending" — the one
// place they live, so a mutation never bounces staff to a page without the row.
const backPath = (shopSlug: string, tripId: string) => `/shop/${shopSlug}/trips/${tripId}`;
const guestsPath = (shopSlug: string, tripId: string) => `/shop/${shopSlug}/trips/${tripId}/guests`;

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
 * cancellation — stay `requireStaffSession`, as do the roster/booking/recap
 * actions. Only trip definition and bulk schedule management run through here.
 */
async function requireTripConfig(shopSlug: string, tripId: string) {
  const s = await requireStaffSession();
  if (!(await canPersonConfigureTrips(await getDb(), s.user.shopId, s.user.personId))) {
    redirect(`${backPath(shopSlug, tripId)}?notice=not-authorized`);
  }
  return s;
}

export async function saveDetails(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const {
    title,
    description,
    date,
    startTime,
    endTime,
    capacity,
    plannedDives,
    dayCount,
    priceDollars,
    depositDollars,
    cancellationWindowHours,
  } = parsed.data;
  const sw = parseWallTime(date, startTime);
  const ew = parseWallTime(date, endTime);
  if (!sw || !ew) redirect(`${back}?notice=invalid`);
  const dbi = await getDb();
  const shopNow = await getShopById(dbi, s.user.shopId);
  if (!shopNow) redirect(`${back}?notice=invalid`);
  const startsAt = wallTimeToUtc(sw, shopNow.timezone);
  const endsAt = wallTimeToUtc(ew, shopNow.timezone);
  if (endsAt <= startsAt) redirect(`${back}?notice=end-before-start`);
  // Day one's window, repeated across however many days the departure runs.
  // Each day is converted on its own date so a trip that straddles a DST
  // change keeps the wall-clock time the shop actually promised.
  const meetingDays = tripMeetingDays({ start: sw, end: ew }, dayCount);
  if (!meetingDays) redirect(`${back}?notice=invalid`);
  const scheduleDays = meetingDays.map((day, index) => ({
    dayNumber: index + 1,
    startsAt: wallTimeToUtc(day.start, shopNow.timezone),
    endsAt: wallTimeToUtc(day.end, shopNow.timezone),
  }));
  const lastDay = scheduleDays.at(-1);
  if (!lastDay) redirect(`${back}?notice=invalid`);
  // What the numbers in the price boxes mean — the shop's own currency.
  const tripCurrency = toShopCurrency(shopNow.currency);
  const priceCents = priceDollars === undefined ? null : majorToMinor(priceDollars, tripCurrency);
  const depositCents =
    depositDollars === undefined ? null : majorToMinor(depositDollars, tripCurrency);
  // The ceiling every other price validator applies (course fees, rental
  // pricing, order line items). These two were the odd ones out with no
  // `.max()` at all, so a forged submit could store a ten-million-dollar trip
  // or overflow the integer column outright (security-reviewer finding).
  // Checked on the converted minor units, not the typed number, because the
  // schemas are module-level and parse before the shop's currency is known.
  if (
    (priceCents !== null && priceCents > MAX_PRICE_MINOR_UNITS) ||
    (depositCents !== null && depositCents > MAX_PRICE_MINOR_UNITS)
  ) {
    redirect(`${back}?notice=invalid`);
  }
  const outcome = await updateTrip(dbi, s.user.shopId, tripId, {
    title,
    description: description || undefined,
    startsAt,
    // The whole departure, first day's departure to last day's return.
    endsAt: lastDay.endsAt,
    scheduleDays,
    capacity,
    plannedDives,
    priceCents: priceDollars === undefined ? null : majorToMinor(priceDollars, tripCurrency),
    depositCents: depositDollars === undefined ? null : majorToMinor(depositDollars, tripCurrency),
    cancellationWindowHours: cancellationWindowHours ?? null,
    diveSiteId: tripDiveDraftsFromForm(formData, plannedDives)[0]?.diveSiteId ?? null,
    dives: tripDiveDraftsFromForm(formData, plannedDives),
  });
  if (!outcome.ok) {
    if (outcome.reason === "capacity_below_booked") {
      redirect(`${back}?notice=capacity-below-booked&count=${outcome.detail.bookedCount}`);
    }
    if (outcome.reason === "planned_dives_below_history") {
      redirect(
        `${back}?notice=planned-dives-below-history&count=${outcome.detail.recordedDiveCount}`,
      );
    }
    redirect(`${back}?notice=invalid`);
  }
  revalidateAndRedirect(back, `${back}?notice=saved`);
}

export async function saveConditionsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  // Predicted conditions are crew-entered — the divemaster/captain on the water
  // record water temp, viz, and surface state and own the go/no-go call
  // (glossary). This is operating work, not trip definition, so it stays open to
  // all staff even though the rest of Overview is config-gated (H-14).
  const s = await requireStaffSession();
  const parsed = conditionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const db = await getDb();
  // The units come from the shop row, never from the form. A hidden input would
  // let a crafted post store a 27 typed as °C as if it were °F — a 16-degree
  // error on every diver's brief — the same reason the dive-site depth entry
  // re-reads the shop rather than trusting what was submitted.
  const shop = await getShopById(db, s.user.shopId);
  if (!shop) redirect(`${back}?notice=invalid`);
  const temperatureUnit = temperatureUnitFor(shop);
  const { waterTemperature, visibility } = parsed.data;
  if (
    waterTemperature !== undefined &&
    (waterTemperature < minEnteredTemperature(temperatureUnit) ||
      waterTemperature > maxEnteredTemperature(temperatureUnit))
  ) {
    redirect(`${back}?notice=invalid`);
  }
  if (visibility !== undefined && visibility > maxEnteredVisibility(shop.depthUnit)) {
    redirect(`${back}?notice=invalid`);
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
  revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions" : "invalid"}`);
}

export async function clearConditionsAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  // Crew-entered conditions (see saveConditionsAction) — operating work, open to
  // all staff.
  const s = await requireStaffSession();
  const { trip: saved } = await updateTripConditions(await getDb(), s.user.shopId, tripId, {});
  revalidateAndRedirect(back, `${back}?notice=${saved ? "conditions-cleared" : "invalid"}`);
}

export async function cancelTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  // A single trip's cancellation is the crew's weather go/no-go call (glossary):
  // the on-water lead must be able to take today's charter off the board so
  // divers are notified. It only flips status (no money moves — refunds stay
  // owner/manager on the per-booking path), so it's open to all staff. Bulk
  // schedule management (reinstate, whole-series cancel, create) stays config.
  const s = await requireStaffSession();
  await setTripStatus(await getDb(), s.user.shopId, tripId, "cancelled");
  revalidateAndRedirect(back, `${back}?notice=cancelled`);
}

export async function reinstateTripAction(shopSlug: string, tripId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  await setTripStatus(await getDb(), s.user.shopId, tripId, "scheduled");
  revalidateAndRedirect(back, `${back}?notice=reinstated`);
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
  revalidateAndRedirect(back, `${back}?notice=${notice}`);
}

/** Cancel every upcoming date in the series at once; each stays reinstatable. */
export async function cancelSeriesAction(shopSlug: string, tripId: string, seriesId: string) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const cancelled = await cancelFutureSeriesTrips(await getDb(), s.user.shopId, seriesId);
  revalidateAndRedirect(
    back,
    `${back}?notice=${cancelled > 0 ? "series-cancelled" : "series-error"}`,
  );
}

const extendSeriesSchema = z.object({
  count: z.coerce.number().int().min(1).max(MAX_SERIES_OCCURRENCES),
});

/** Roll a finite series' horizon forward by adding more dates on the same cadence. */
export async function extendSeriesAction(
  shopSlug: string,
  tripId: string,
  seriesId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const parsed = extendSeriesSchema.safeParse({ count: formData.get("count") });
  if (!parsed.success) redirect(`${back}?notice=series-error`);
  const db = await getDb();
  const [shop, series, latest] = await Promise.all([
    getShopById(db, s.user.shopId),
    getTripSeriesById(db, s.user.shopId, seriesId),
    getLatestSeriesInstance(db, s.user.shopId, seriesId),
  ]);
  if (!shop || !series || !latest) redirect(`${back}?notice=series-error`);
  const walls = weeklyOccurrencesAfter(
    {
      start: utcToWallTime(latest.startsAt, shop.timezone),
      end: utcToWallTime(latest.endsAt, shop.timezone),
    },
    series.intervalWeeks,
    parsed.data.count,
  );
  if (!walls) redirect(`${back}?notice=series-error`);
  const result = await extendTripSeries(db, {
    shopId: s.user.shopId,
    seriesId,
    occurrences: walls.map((wall) => ({
      startsAt: wallTimeToUtc(wall.start, shop.timezone),
      endsAt: wallTimeToUtc(wall.end, shop.timezone),
    })),
  });
  revalidateAndRedirect(back, `${back}?notice=${result ? "series-extended" : "series-error"}`);
}

const recapShoutoutSchema = z.object({ recapShoutout: z.string().trim().max(400) });

/** Crew-authored post-trip note that rides along on every diver's recap. */
export async function saveRecapShoutoutAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = backPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = recapShoutoutSchema.safeParse({
    recapShoutout: formData.get("recapShoutout") ?? "",
  });
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const saved = await setTripRecapShoutout(
    await getDb(),
    s.user.shopId,
    tripId,
    parsed.data.recapShoutout,
  );
  revalidateAndRedirect(back, `${back}?notice=${saved ? "recap-note" : "invalid"}`);
}

/** Take down a diver's recap photo — the shop's moderation seam. */
export async function deleteRecapPhotoAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const photoId = String(formData.get("photoId") ?? "");
  if (!photoId) redirect(back);
  const db = await getDb();
  const result = await deleteRecapPhoto(db, s.user.shopId, photoId);
  // The row leaving is the diver-visible "removed" — never blocked on
  // storage. The blob object is queued for deletion and retried on its own
  // (CR-012); a provider failure surfaces on the reports page, not here.
  if (result.deleted) {
    await queueAndAttemptMediaDeletion(db, {
      shopId: s.user.shopId,
      kind: "recap_photo",
      url: result.imageUrl,
    });
  }
  revalidateAndRedirect(back, `${back}?notice=recap-photo-removed`);
}

export async function addInternalNoteAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("note") ?? "");
  const saved = await addInternalNote(await getDb(), {
    shopId: s.user.shopId,
    actorPersonId: s.user.personId,
    bookingId,
    body,
  });
  revalidateAndRedirect(back, `${back}?notice=${saved ? "note-added" : "invalid"}`);
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
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const noteId = String(formData.get("noteId") ?? "");
  const result = await deleteInternalNote(await getDb(), {
    shopId: s.user.shopId,
    actorPersonId: s.user.personId,
    noteId,
  });
  revalidateAndRedirect(
    back,
    result.deleted
      ? `${back}?notice=note-deleted&noteBookingId=${result.bookingId}&noteBody=${encodeURIComponent(result.body)}`
      : `${back}?notice=invalid`,
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
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("body") ?? "");
  const restored = bookingId
    ? await addInternalNote(await getDb(), {
        shopId: s.user.shopId,
        actorPersonId: s.user.personId,
        bookingId,
        body,
      })
    : null;
  // Reuses the "note-added" notice: a restore is, from the banner's
  // perspective, indistinguishable from adding a fresh note with the same
  // text — no dedicated "note-restored" code needed.
  revalidateAndRedirect(back, `${back}?notice=${restored ? "note-added" : "invalid"}`);
}

/** Staff-entered wait-list entry — only valid once the trip is actually full. */
export async function addToWaitlistAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const parsed = parseAddDiver(formData);
  if (!parsed.success) redirect(`${back}?notice=diver-invalid`);
  const outcome = await joinTripWaitlist(await getDb(), {
    shopId: s.user.shopId,
    tripId,
    fullName: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
  });
  if (outcome.ok || outcome.reason === "already_waitlisted") {
    await trackEvent({ name: "waitlist_joined", source: "staff" });
    revalidateAndRedirect(back, `${back}?notice=diver-waitlisted`);
  }
  const code =
    outcome.reason === "trip_available"
      ? "diver-waitlist-available"
      : outcome.reason === "already_booked"
        ? "diver-already"
        : "diver-unavailable";
  redirect(`${back}?notice=${code}`);
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
  const s = await requireStaffSession();
  const result = await inviteWaitlistDiver(await getDb(), {
    shopId: s.user.shopId,
    shopSlug,
    entryId,
  });
  revalidatePath(guestsPath(shopSlug, tripId));
  // The freed-seat row also lives on Today, so refresh the queue after an invite
  // whether it was sent from the roster or straight from Today (WP-9 → §7).
  revalidatePath(`/shop/${shopSlug}`);
  return result.ok && result.delivery === "sent" ? "sent" : "fallback";
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
  const back = guestsPath(shopSlug, tripId);
  const anchor = "#last-minute-deal";
  const s = await requireStaffSession();
  const discountPercent = Number(formData.get("discountPercent"));
  if (!isValidLastMinuteDiscountPercent(discountPercent)) {
    redirect(`${back}?notice=last-minute-invalid-discount${anchor}`);
  }
  const outcome = await sendLastMinuteDealBlast(await getDb(), {
    shopId: s.user.shopId,
    shopSlug,
    tripId,
    discountPercent,
    createdByPersonId: s.user.personId,
  });
  if (outcome.ok) {
    // Today's nudge disappears once any blast has been sent, so refresh it
    // alongside the trip page it was sent from.
    revalidatePath(back);
    revalidatePath(`/shop/${shopSlug}`);
    redirect(`${back}?notice=last-minute-sent&count=${outcome.recipientCount}${anchor}`);
  }
  redirect(`${back}?notice=last-minute-${outcome.reason.replaceAll("_", "-")}${anchor}`);
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
  return payment?.status === "paid" || payment?.status === "deposit_paid";
}

function refundNotice(refund: CancellationRefundOutcome): string {
  switch (refund.status) {
    case "refunded":
      return "booking-removed-refunded";
    case "forfeit":
      return "booking-removed-forfeit";
    case "failed":
      return "booking-removed-refund-failed";
    case "manual":
      // `not_refundable` is a data mismatch (local row says paid, Stripe
      // captured nothing) — a "review", not the "refund owed by hand" claim the
      // counter/disconnected cases make.
      return refund.reason === "not_refundable"
        ? "booking-removed-refund-review"
        : "booking-removed-refund-manual";
    default:
      // no_policy or unpaid: nothing owed, today's plain "spot is open" notice.
      return "booking-removed";
  }
}

export async function removeBookingAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const dbi = await getDb();
  await cancelBooking(dbi, s.user.shopId, bookingId);
  await trackEvent({ name: "booking_cancelled", source: "staff" });
  // Same activity line an add writes (addBookingAction), for the same reason:
  // the trip's log, read from the Guests tab, is the record of who touched
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
    revalidateAndRedirect(back, `${back}?notice=${notice}&bid=${bookingId}`);
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
  revalidateAndRedirect(back, `${back}?notice=${refundNotice(refund)}&bid=${bookingId}`);
}

export async function undoRemoveBookingAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
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
  revalidateAndRedirect(back, `${back}?notice=${restoreNotice}`);
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
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(back);
  const confirmed = await confirmBookingIdentity(await getDb(), s.user.shopId, bookingId);
  revalidateAndRedirect(
    back,
    `${back}?notice=${confirmed ? "identity-confirmed" : "invalid"}&bid=${bookingId}`,
  );
}

/**
 * Staff records that a diver signed a paper release in person or on shore, for a
 * diver the app never sees sign. Same shop-scoped session gate as every other
 * roster action; the accountable staff member is stamped on the record. Requires
 * an explicit medical-clear attestation — a flagged medical must go through the
 * diver-facing link, which captures the questionnaire and routes to review.
 */
export async function markWaiverInPersonAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) redirect(`${back}?notice=waiver-error`);
  const outcome = await recordInPersonWaiver(await getDb(), {
    shopId: s.user.shopId,
    bookingId,
    recordedByPersonId: s.user.personId,
    medicalAttested: formData.get("medicalAttested") === "on",
  });
  const notice = outcome.ok
    ? "waiver-in-person"
    : outcome.reason === "medical_attestation_required"
      ? "waiver-medical-attestation"
      : "waiver-error";
  revalidateAndRedirect(back, `${back}?notice=${notice}&bid=${bookingId}`);
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
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!bookingId || !parsed.success) redirect(`${back}?notice=invalid`);
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
    `${back}?notice=${complete ? "contact-saved" : "contact-incomplete"}&bid=${bookingId}`,
  );
}

export async function markPaymentAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = guestsPath(shopSlug, tripId);
  const s = await requireStaffSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const status = paymentStatusSchema.safeParse(formData.get("status"));
  const db = await getDb();
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
  revalidateAndRedirect(back, `${back}?notice=${saved ? "payment" : "invalid"}`);
}

export async function saveRequirementsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = backPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  // Re-derive the course flag server-side rather than trusting a client field:
  // a course session's admission rules are frozen and must not be editable here,
  // and upsertTripRequirements has no independent course check.
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (trip?.courseId) redirect(`${back}?notice=invalid`);
  const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${back}?notice=invalid`);
  const specialties = z.array(specialtySchema).safeParse(formData.getAll("specialty").map(String));
  if (!specialties.success) redirect(`${back}?notice=invalid`);
  const saved = await upsertTripRequirements(db, {
    shopId: s.user.shopId,
    tripId,
    requiresWaiver: parsed.data.requiresWaiver === "on",
    minimumCertificationLevel: parsed.data.minimumCertificationLevel,
    requiredSpecialties: specialties.data,
    requiresNitrox: formData.get("requiresNitrox") === "on",
    requiresPayment: formData.get("requiresPayment") === "on",
  });
  revalidateAndRedirect(back, `${back}?notice=${saved ? "requirements" : "invalid"}`);
}

export async function updateTripCrewAction(
  shopSlug: string,
  tripId: string,
  change: TripCrewChange,
): Promise<{ ok: boolean }> {
  const s = await requireStaffSession();
  const db = await getDb();
  const success = await changeTripCrew(db, s.user.shopId, tripId, change);
  if (success) {
    // One write path for crew (Today's board and the trip's CrewSection both
    // call this), so the trip's activity log — read from the Guests tab —
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
    revalidatePath(`/shop/${shopSlug}`);
    revalidatePath(`/shop/${shopSlug}/trips/${tripId}`);
    revalidatePath(`/shop/${shopSlug}/trips/${tripId}/manifest`);
    return { ok: true };
  }
  return { ok: false };
}
