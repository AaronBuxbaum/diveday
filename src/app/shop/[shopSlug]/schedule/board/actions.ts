"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { type AppDb, getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { listDiveSites } from "@/db/dive-sites";
import { canPersonViewShopReports } from "@/db/reporting";
import { getShopById } from "@/db/shops";
import { createTripRequestInvitations } from "@/db/trip-invitations";
import {
  countShopTrips,
  createTrip,
  createTripSeries,
  deleteTrip,
  duplicateTrip,
  moveTrip,
} from "@/db/trips";
import { trackEvent } from "@/lib/analytics";
import { isValidCalendarDate } from "@/lib/calendar-date";
import { MAX_DECISION_HOURS, MAX_MINIMUM_BOOKINGS, MIN_DECISION_HOURS } from "@/lib/minimum-seats";
import { MAX_PRICE_MINOR_UNITS, majorToMinor, toShopCurrency } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  isValidWeekdaySet,
  MAX_INTERVAL_WEEKS,
  type WeekdaySet,
  weekdaySetFrom,
} from "@/lib/recurrence";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS, tripMeetingDays } from "@/lib/trip-days";
import { hasTripDiveContent, tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";

/* -------------------------------------------------------------------------- *
 * The schedule builder
 *
 * Four small mutations behind the staff board's inline controls: put a
 * departure on the board, slide one to another day, copy one forward, and take
 * an untouched one back off. Each is a whole edit on its own — the builder never
 * holds a half-finished draft, so a staff member who closes the tab mid-thought
 * has changed exactly what they already saved and nothing more.
 *
 * "Add a departure" is the *only* way a trip is created — the whole former
 * `/trips/new` form lives here behind a "More options" disclosure (ADR
 * 20260806-one-trip-create-form). Everything about a departure that already
 * exists — crew, conditions, the roster, requirements — stays on the trip's own
 * page. Creating is one place; editing is the other.
 * -------------------------------------------------------------------------- */

// `shopPath`, not a template literal. Every exported action in this file takes
// `shopSlug` as its first argument — client-supplied — and `requireBoardAuthor`
// authorizes against `session.user.shopId` without ever comparing the two, so
// an unescaped slug traverses out of the `/shop/` namespace, and one carrying a
// `?` swallows the `?builder=` code appended after it (src/lib/staff-notices.ts).
const boardPath = (shopSlug: string) => shopPath(shopSlug, "schedule", "board");

/**
 * Trip definition is owner/manager/instructor work (H-14, ADR
 * 20260724-role-authorization) — re-checked against live roles, never trusted
 * from the session's JWT.
 */
async function requireBoardAuthor(shopSlug: string) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
    redirect(`${boardPath(shopSlug)}?builder=not-authorized`);
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect(boardPath(shopSlug));
  return { session, db, shop };
}

/**
 * The two option lists the add-a-departure panel's selects offer, fetched when
 * a staff member opens the panel rather than serialized into the builder's
 * client props on every board render. The board used to ship every active
 * course and every dive site with each render — for two selects inside a panel
 * that is closed by default — so this moves both the payload and the two
 * queries onto the path that actually uses them.
 *
 * Scoped by the session's own shop, never a slug, and empty for anyone who
 * cannot define trips (H-14) — the panel they would fill in isn't rendered for
 * them either.
 */
export async function loadBuilderOptionsAction() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shopId = session.user.shopId;
  if (!(await canPersonConfigureTrips(db, shopId, session.user.personId))) {
    return { courses: [], diveSites: [] };
  }
  const [courses, diveSites] = await Promise.all([
    listActiveCourses(db, shopId).then((rows) =>
      rows.map((row) => ({ id: row.id, title: row.title, agency: row.agency })),
    ),
    listDiveSites(db, shopId).then((rows) => rows.map((row) => ({ id: row.id, title: row.name }))),
  ]);
  return { courses, diveSites };
}

/**
 * Everything the one trip form asks. The quick path posts only the first
 * handful; every field the "More options" disclosure adds is optional or
 * defaulted, so a collapsed submission and a fully expanded one parse through
 * the same schema — this *is* the old `trips/new` `formSchema`, plus the
 * board's own `diveSiteId`.
 */
const addSchema = z.object({
  title: z.string().trim().min(1).max(120),
  // Absent entirely from a collapsed submission, so optional rather than
  // required-but-empty.
  description: z.string().trim().max(500).optional(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(4),
  // A departure that meets on consecutive days is one trip, not a week of
  // look-alikes: one roster, one set of waivers, one crew (src/lib/trip-days.ts).
  dayCount: z.preprocess(
    (value) => (value === "" || value === undefined ? MIN_TRIP_DAYS : value),
    z.coerce.number().int().min(MIN_TRIP_DAYS).max(MAX_TRIP_DAYS),
  ),
  // Optional, and optional in the honest sense: an empty box still puts the
  // departure on the board, and the row wears the "No price set" badge until
  // somebody prices it. Same preprocess as every other price box in the app —
  // an empty string is "not answered", not zero.
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
  // The head count this departure needs to run, and how long before it leaves
  // the shop makes that call. Blank is every trip that exists today — the boat
  // goes with whoever booked (src/lib/minimum-seats.ts).
  minimumBookings: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(MAX_MINIMUM_BOOKINGS).optional(),
  ),
  minimumDecisionHours: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(MIN_DECISION_HOURS).max(MAX_DECISION_HOURS).optional(),
  ),
  courseId: z.preprocess((value) => value || undefined, z.uuid().optional()),
  diveSiteId: z.preprocess((value) => value || undefined, z.uuid().optional()),
  // "0" means it does not repeat; any other value is the number of weeks between
  // firing weeks. The days *within* a firing week arrive separately, as
  // `repeatWeekday` checkboxes — see `repeatWeekdaysFrom` below.
  repeatIntervalWeeks: z.preprocess(
    (value) => (value === "" || value === undefined ? "0" : value),
    z.coerce.number().int().min(0).max(MAX_INTERVAL_WEEKS),
  ),
  // Blank means the run simply keeps going, which is the default a repeating
  // departure is offered on: a standing Saturday charter has no last date, and
  // making a shop invent one was the old form's real limit.
  repeatEndsOn: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.string().refine(isValidCalendarDate).optional(),
  ),
});

/**
 * The weekday checkboxes, which a `FormData` carries as repeats of one name and
 * `Object.fromEntries` therefore collapses to the last one — so they are read
 * off the form directly rather than through the schema above.
 */
function repeatWeekdaysFrom(formData: FormData): WeekdaySet {
  return weekdaySetFrom(formData.getAll("repeatWeekday").map((value) => Number(value)));
}

export async function addDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop, session } = await requireBoardAuthor(shopSlug);
  const invalid = async () => {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  };
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return await invalid();
  const requestIds = z.array(z.uuid()).safeParse(formData.getAll("inquiryId"));
  if (!requestIds.success) return await invalid();
  // The request ids arrive from a client form and the builder URL is shareable.
  // A staffer who can create a departure is not automatically allowed to read
  // the private lead details that would be attached to it.
  if (
    requestIds.data.length > 0 &&
    !(await canPersonViewShopReports(db, shop.id, session.user.personId))
  ) {
    return await invalid();
  }
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
    minimumBookings,
    minimumDecisionHours,
    courseId,
    diveSiteId,
    repeatIntervalWeeks,
    repeatEndsOn,
  } = parsed.data;

  const startWall = parseWallTime(date, startTime);
  const endWall = parseWallTime(date, endTime);
  // `parseWallTime` accepts a shape; `isValidCalendarDate` accepts a *day* —
  // and a series stores this string as the anchor its whole cadence is counted
  // from, so "2026-02-31" has to die here rather than three months later.
  if (!startWall || !endWall || !isValidCalendarDate(date)) return await invalid();
  // The times must be a coherent single day before we shift them across days
  // or weeks; every meeting day and every occurrence inherits this same
  // wall-clock start/end.
  const startsAt = wallTimeToUtc(startWall, shop.timezone);
  const endsAt = wallTimeToUtc(endWall, shop.timezone);
  if (endsAt <= startsAt) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "add",
      outcome: "end_before_start",
    });
    redirect(`${back}?builder=end-before-start`);
  }

  // Day by day rather than one offset: a multi-day trip can straddle a DST
  // change, and what a shop promises is the wall-clock time — "back at the
  // dock at 12:30" on both days.
  //
  // For a repeating departure this is also the *shape* every later date is
  // rebuilt from: the query layer re-places these meeting days on each cadence
  // date in the shop's own zone, so a two-day course stays a two-day course
  // wherever it lands (`daysOnOccurrence` in src/db/trips-series.ts).
  const meetingDays = tripMeetingDays({ start: startWall, end: endWall }, dayCount);
  const scheduleDays = meetingDays?.map((meeting, index) => ({
    dayNumber: index + 1,
    startsAt: wallTimeToUtc(meeting.start, shop.timezone),
    endsAt: wallTimeToUtc(meeting.end, shop.timezone),
  }));
  if (!scheduleDays) return await invalid();
  // The trip itself spans its first day's departure to its last day's return,
  // so every "is it over?" question in the app — sailed guards, the board's
  // upcoming window, calendar feeds — sees the whole departure.
  const lastDay = scheduleDays.at(-1);
  if (!lastDay) return await invalid();

  // The per-dive cards only exist while the panel is expanded, so an all-blank
  // read means they were never on screen — fall back to the quick row's single
  // dive-site select rather than writing four empty dives over it.
  const diveDrafts = tripDiveDraftsFromForm(formData, plannedDives);
  const plannedDiveCards = hasTripDiveContent(diveDrafts) ? diveDrafts : undefined;

  // The shop's currency decides the multiplier: 5000 in a JPY shop's price box
  // is ¥5,000 and stores 5000, not a hundredfold ¥500,000. Same ceiling every
  // other price validator applies (trips/[id]/actions.ts).
  const currency = toShopCurrency(shop.currency);
  const priceCents = priceDollars === undefined ? null : majorToMinor(priceDollars, currency);
  const depositCents = depositDollars === undefined ? null : majorToMinor(depositDollars, currency);
  if (
    (priceCents !== null && priceCents > MAX_PRICE_MINOR_UNITS) ||
    (depositCents !== null && depositCents > MAX_PRICE_MINOR_UNITS)
  ) {
    return await invalid();
  }

  const common = {
    shopId: shop.id,
    courseId,
    title,
    description: description || undefined,
    capacity,
    plannedDives,
    dives: plannedDiveCards,
    priceCents,
    depositCents,
    cancellationWindowHours: cancellationWindowHours ?? null,
    minimumBookings: minimumBookings ?? null,
    // A window with no minimum beside it is not a policy — it would sit in the
    // row saying nothing and read as one on the next edit.
    minimumDecisionHours: minimumBookings ? (minimumDecisionHours ?? null) : null,
  };

  if (repeatIntervalWeeks > 0) {
    // No fallback set: the panel pre-checks the chosen date's own weekday the
    // moment a cadence is picked, so an empty set here is a malformed
    // submission, not a shop that meant "Saturdays".
    const weekdays = repeatWeekdaysFrom(formData);
    if (!isValidWeekdaySet(weekdays)) return await invalid();
    // A series does not count out a batch of dates any more: it carries the
    // cadence, an optional last date, and the one departure staff filled in.
    // The query layer places that shape on every cadence date inside the
    // horizon and keeps doing so (ADR 20260810-open-ended-recurring-trips) —
    // `repeatEndsOn` left blank is a run with no end at all.
    const series = await createTripSeries(db, {
      ...common,
      frequency: "weekly",
      intervalWeeks: repeatIntervalWeeks,
      weekdays,
      anchorDate: date,
      endsOn: repeatEndsOn ?? null,
      timeZone: shop.timezone,
      template: { startsAt, endsAt: lastDay.endsAt, scheduleDays },
    });
    if (!series) return await invalid();
    const firstTrip = series.trips[0];
    if (!firstTrip) return await invalid();
    await createTripRequestInvitations(db, {
      shopId: shop.id,
      tripId: firstTrip.id,
      requestIds: requestIds.data,
      createdByPersonId: session.user.personId,
    });
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "ok" });
    return await landAfterAdd(db, shop, shopSlug, title, series.trips.length);
  }

  const created = await createTrip(db, {
    ...common,
    diveSiteId: plannedDiveCards ? undefined : diveSiteId,
    startsAt,
    endsAt: lastDay.endsAt,
    scheduleDays,
  });
  if (!created) return await invalid();
  await createTripRequestInvitations(db, {
    shopId: shop.id,
    tripId: created.id,
    requestIds: requestIds.data,
    createdByPersonId: session.user.personId,
  });
  await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "ok" });
  return await landAfterAdd(db, shop, shopSlug, title, 1);
}

/**
 * Where a staff member lands once the departure is on the board: back on the
 * board, with the departure named in the notice.
 *
 * The exception is a shop's first departure ever, which hands over to Today's
 * `FirstBookableCard`. "First" must stay *exactly* the home page's own test
 * (`src/app/shop/[shopSlug]/page.tsx`) — total equals what was just created,
 * demo shops excluded — or one of the two renders a card the other denies.
 */
async function landAfterAdd(
  db: AppDb,
  shop: { id: string; isDemo: boolean },
  shopSlug: string,
  title: string,
  createdCount: number,
): Promise<never> {
  const back = boardPath(shopSlug);
  const firstBookableMoment =
    !shop.isDemo && (await countShopTrips(db, shop.id)) === Math.max(createdCount, 1);
  if (firstBookableMoment) {
    const home = `/shop/${shopSlug}`;
    const query = new URLSearchParams({ created: title });
    if (createdCount > 1) query.set("series", String(createdCount));
    revalidateAndRedirect(home, `${home}?${query.toString()}`);
  }
  const query = new URLSearchParams({ builder: "added", created: title });
  if (createdCount > 1) query.set("series", String(createdCount));
  revalidateAndRedirect(back, `${back}?${query.toString()}`);
}

const moveSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
});

export async function moveDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const parsed = moveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const wall = parseWallTime(parsed.data.date, parsed.data.startTime);
  if (!wall) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const outcome = await moveTrip(
    db,
    shop.id,
    parsed.data.tripId,
    wallTimeToUtc(wall, shop.timezone),
  );
  if (!outcome.ok) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: outcome.reason });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=moved`);
}

const duplicateSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
});

export async function duplicateDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const parsed = duplicateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const wall = parseWallTime(parsed.data.date, parsed.data.startTime);
  if (!wall) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  const copy = await duplicateTrip(
    db,
    shop.id,
    parsed.data.tripId,
    wallTimeToUtc(wall, shop.timezone),
  );
  if (!copy) {
    await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=copied`);
}

export async function removeDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { db, shop } = await requireBoardAuthor(shopSlug);
  const tripId = z.uuid().safeParse(formData.get("tripId"));
  if (!tripId.success) {
    await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const outcome = await deleteTrip(db, shop.id, tripId.data);
  if (!outcome.ok) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "remove",
      outcome: outcome.reason,
    });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "ok" });
  revalidateAndRedirect(back, `${back}?builder=removed`);
}
