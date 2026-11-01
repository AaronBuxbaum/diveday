"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canPersonConfigureTrips } from "@/db/authz";
import { getBoatById, listBoats } from "@/db/boats";
import { type AppDb, getDb } from "@/db/client";
import { listActiveCourses } from "@/db/courses";
import { getDiveSite, listDiveSites } from "@/db/dive-sites";
import { discardFormDraft } from "@/db/form-drafts";
import { getMovePreflight } from "@/db/move-preflight";
import { recordShopActivity } from "@/db/shop-activity";
import { getShopById } from "@/db/shops";
import { getTripLens, listTripLenses } from "@/db/trip-lenses";
import { holdRescheduleNotice } from "@/db/trip-rescheduled";
import {
  countShopTrips,
  createTrip,
  createTripSeries,
  deleteTrip,
  duplicateTrip,
  listStaff,
  moveTrip,
  setTripCrew,
} from "@/db/trips";
import { weekdayPatternFor } from "@/db/weekday-pattern";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { staffTideWindowText } from "@/i18n/tide-labels";
import { trackEvent } from "@/lib/analytics";
import { calendarDateWeekday, isValidCalendarDate } from "@/lib/calendar-date";
import { tideWindowsForDeparture } from "@/lib/departure-tides";
import { parseDockDayRhythm } from "@/lib/diver-planning";
import { formatWallTime } from "@/lib/forgiving-fields";
import { parseForm } from "@/lib/form-parse";
import { formatTime } from "@/lib/format";
import { MAX_DECISION_HOURS, MAX_MINIMUM_BOOKINGS, MIN_DECISION_HOURS } from "@/lib/minimum-seats";
import { minorToMajor } from "@/lib/money";
import type { MovePreflight } from "@/lib/move-preflight";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  isValidWeekdaySet,
  MAX_INTERVAL_WEEKS,
  type WeekdaySet,
  weekdaySetFrom,
} from "@/lib/recurrence";
import { signScheduleMoveResult } from "@/lib/schedule-move-result";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { MAX_TRIP_DAYS, MIN_TRIP_DAYS } from "@/lib/trip-days";
import { tripDetailsPatch } from "@/lib/trip-details";
import { MAX_COURSE_DIVES } from "@/lib/trip-dive-limits";
import { hasTripDiveContent, tripDiveDraftsFromForm } from "@/lib/trip-dives";
import { uuidParam } from "@/lib/uuid";
import type { PatternDeparture } from "@/lib/weekday-pattern";
import { parseWallTime, wallTimeToUtc } from "@/lib/zoned";
import { builderCourseOptions } from "./_components/builder-course-options";
import type { BuilderPattern, BuilderTideWindowInput } from "./_components/ScheduleBuilder";
import { attachRequestedInterests } from "./attach-interests";
import { copyCrewIfAsked, duplicateSchema } from "./copy-departure";

const removeDepartureForm = z.object({ tripId: z.uuid() });

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

// `shopPath`, not a template literal. Every writing action in this file takes
// `shopSlug` as its first argument — client-supplied. `requireBoardAuthor`
// refuses a slug that is not the session's shop, and the escaping stays as the
// second layer: an unescaped slug traverses out of the `/shop/` namespace, and
// one carrying a `?` swallows the `?builder=` code appended after it
// (src/lib/staff-notices.ts).
const boardPath = (shopSlug: string) => shopPath(shopSlug, "schedule", "board");

/**
 * Trip definition is owner/manager/instructor work (H-20260724-staff-role-reach, ADR
 * 20260724-role-authorization) — re-checked against live roles, never trusted
 * from the session's JWT.
 */
async function requireBoardAuthor(shopSlug: string) {
  // `requireShopSurface`, not `requireStaffSession`: the slug is the caller's
  // word, and every redirect and revalidation below is built from it, so a
  // slug that is not this session's shop ends here (scripts/check-slug-actions.mjs).
  const { session, db, shop } = await requireShopSurface(shopSlug);
  if (!(await canPersonConfigureTrips(db, session.user.shopId, session.user.personId))) {
    redirect(`${boardPath(shopSlug)}?builder=not-authorized`);
  }
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
 * cannot define trips (H-20260724-staff-role-reach) — the panel they would fill in isn't rendered for
 * them either.
 */
/**
 * The tide at a chosen site for the departure being added, worded for the
 * reader (ADR 20260907-noaa-tide-predictions). A brand-new departure states
 * no legs, so the boat reaches its first site after the shop's own ride out.
 * Null — no sentence — for a site with no station, an unparseable time, or a
 * station that answers nothing; the panel renders nothing in every case.
 */
export async function loadTideWindowAction(input: BuilderTideWindowInput): Promise<string | null> {
  const session = await requireStaffSession();
  const db = await getDb();
  const shopId = session.user.shopId;
  if (!(await canPersonConfigureTrips(db, shopId, session.user.personId))) return null;
  if (!uuidParam(input.diveSiteId) || !isValidCalendarDate(input.date)) return null;
  const [shop, site] = await Promise.all([
    getShopById(db, shopId),
    getDiveSite(db, shopId, input.diveSiteId),
  ]);
  if (!shop || !site?.tideStationId) return null;
  const wall = parseWallTime(input.date, input.startTime);
  const rhythm = parseDockDayRhythm(shop);
  if (!wall || !rhythm) return null;
  const diveMode =
    input.diveMode === "shore" || input.diveMode === "pool" ? input.diveMode : "boat";
  const [entry] = await tideWindowsForDeparture({
    startsAt: wallTimeToUtc(wall, shop.timezone),
    // Nothing has sailed: this departure is being typed, not read back. The
    // panel's own default start time is 8:30 AM, so without this the composer
    // answers nothing for the rest of any working day.
    proposed: true,
    plannedDives: 1,
    diveMode,
    dives: [
      {
        diveNumber: 1,
        travelMinutes: null,
        site: {
          name: site.name,
          tideStationId: site.tideStationId,
          tidePreference: site.tidePreference,
          expectedBottomTimeMinutes: site.expectedBottomTimeMinutes,
        },
      },
    ],
    rhythm,
    timeZone: shop.timezone,
  });
  if (!entry) return null;
  const locale = await requestLocale(shop.defaultLocale);
  return staffTideWindowText(
    staffTranslator(locale),
    entry.window,
    entry.preference,
    formatTime(entry.window.nearestTurn.at, locale, shop.timezone),
  );
}

export async function loadBuilderOptionsAction() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shopId = session.user.shopId;
  if (!(await canPersonConfigureTrips(db, shopId, session.user.personId))) {
    return {
      courses: [],
      diveSites: [],
      boats: [],
      lenses: [],
      hasBoatDiving: true,
      hasShoreDiving: false,
      hasPoolDiving: false,
    };
  }
  const [courseRows, diveSites, boats, lenses, shop] = await Promise.all([
    listActiveCourses(db, shopId),
    listDiveSites(db, shopId).then((rows) => rows.map((row) => ({ id: row.id, title: row.name }))),
    listBoats(db, shopId).then((rows) =>
      rows.map((row) => ({ id: row.id, name: row.name, capacity: row.capacity })),
    ),
    // The shop's trip tags (ADR 20260904-reef-all-the-way-down, decision 2).
    listTripLenses(db, shopId).then((rows) => rows.map((row) => ({ id: row.id, title: row.name }))),
    getShopById(db, shopId),
  ]);
  const courses = builderCourseOptions(courseRows, shop, await requestLocale(shop?.defaultLocale));
  return {
    courses,
    diveSites,
    // A shop with boat diving off keeps its hull rows — turning the option back
    // on should restore the fleet, not ask for it again — but the builder must
    // not offer them, or a departure lands on a boat the shop has said it does
    // not run.
    boats: shop?.hasBoatDiving === false ? [] : boats,
    lenses,
    hasBoatDiving: shop?.hasBoatDiving ?? true,
    hasShoreDiving: shop?.hasShoreDiving ?? false,
    hasPoolDiving: shop?.hasPoolDiving ?? false,
  };
}

/**
 * **The add panel already knows the weekday** (ADR 20260906-before-you-ask,
 * decision 3). What this shop ran on this weekday over the last six weeks,
 * read fresh when a panel opens on a day with no draft to pick up, shaped for
 * the panel's own controls: every field as the string the control would hold,
 * the crew as names the chips can show, and the second departure most of
 * those days also carried as one row. Null for a shop with fewer than three
 * such days, for anyone who cannot define trips, and for a date that is not
 * one — the panel then opens blank, exactly as it always did.
 *
 * Reads only. The crew names come back with their ids so the panel can submit
 * them as `crewPersonIds`, which `setTripCrew` re-checks against the shop's
 * staff on the way in.
 */
export async function loadWeekdayPatternAction(dateIso: string): Promise<BuilderPattern | null> {
  if (!isValidCalendarDate(dateIso)) return null;
  const session = await requireStaffSession();
  const db = await getDb();
  const shopId = session.user.shopId;
  if (!(await canPersonConfigureTrips(db, shopId, session.user.personId))) return null;
  const shop = await getShopById(db, shopId);
  if (!shop) return null;
  const pattern = await weekdayPatternFor(db, shopId, dateIso, shop.timezone);
  if (!pattern) return null;
  const staff = await listStaff(db, shopId);
  const nameOf = (personId: string) =>
    staff.find((member) => member.person.id === personId)?.person.fullName ?? null;
  const fields: Record<string, string> = { startTime: pattern.startTime };
  const field = (name: string, value: string | number | null) => {
    if (value !== null && value !== "") fields[name] = String(value);
  };
  field("endTime", pattern.endTime);
  field("title", pattern.title);
  field("diveMode", pattern.diveMode);
  field("diveSiteId", pattern.diveSiteId);
  field("boatId", pattern.boatId);
  field("lensId", pattern.lensId);
  // After the hull, deliberately: the boat select's own change handler puts the
  // hull's number in the seats box, and the pattern's number has to land last.
  field("capacity", pattern.capacity);
  field(
    "priceDollars",
    pattern.priceCents === null ? null : minorToMajor(pattern.priceCents, shop.currency),
  );
  return {
    weekday: calendarDateWeekday(dateIso),
    sampledDays: pattern.sampledDays,
    fields,
    crew: pattern.crewPersonIds.flatMap((id) => {
      const name = nameOf(id);
      return name ? [{ id, name }] : [];
    }),
    alsoUsual: pattern.alsoUsual
      ? {
          startTime: pattern.alsoUsual.startTime,
          timeLabel: formatWallTime(
            pattern.alsoUsual.startTime,
            await requestLocale(shop.defaultLocale),
          ),
          title: pattern.alsoUsual.title,
          days: pattern.alsoUsual.days,
        }
      : null,
  };
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
  isPrivate: z.preprocess(
    (value) => value === "true" || value === true,
    z.boolean().optional().default(false),
  ),
  // A practice departure for training day (ADR 20261012-rehearsal-departures).
  isRehearsal: z.preprocess(
    (value) => value === "true" || value === true,
    z.boolean().optional().default(false),
  ),
  selfGuided: z.preprocess(
    (value) => value === "true" || value === true,
    z.boolean().optional().default(false),
  ),
  diveMode: z.preprocess(
    (value) => value || "boat",
    z.enum(["boat", "shore", "pool"]).default("boat"),
  ),
  boatId: z.preprocess((value) => value || undefined, z.uuid().optional()),
  // The shop's own word for this kind of day (ADR 20260904-reef-all-the-way-down).
  lensId: z.preprocess((value) => value || undefined, z.uuid().optional()),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  capacity: z.coerce.number().int().min(1).max(60),
  plannedDives: z.coerce.number().int().min(1).max(MAX_COURSE_DIVES),
  // Consecutive days share one roster, set of waivers and crew (src/lib/trip-days.ts).
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
  // The pattern's second departure, ticked on: its start time, which the
  // server re-reads from the board rather than trusting a field for.
  alsoUsualStart: z.preprocess(
    (value) => value || undefined,
    z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
  ),
});

/**
 * The crew chips the pattern offered, minus any the desk took off. Repeats of
 * one name, so read off the form directly like the weekday checkboxes.
 */
function crewPersonIdsFrom(formData: FormData): string[] | null {
  const parsed = z.array(z.uuid()).safeParse(formData.getAll("crewPersonIds"));
  return parsed.success ? parsed.data : null;
}

/**
 * The weekday checkboxes, which a `FormData` carries as repeats of one name and
 * `Object.fromEntries` therefore collapses to the last one — so they are read
 * off the form directly rather than through the schema above.
 */
function repeatWeekdaysFrom(formData: FormData): WeekdaySet {
  return weekdaySetFrom(formData.getAll("repeatWeekday").map((value) => Number(value)));
}

export async function addDepartureAction(shopSlug: string, formData: FormData) {
  const back = `${boardPath(shopSlug)}/new`;
  const submittedWeek = formData.get("boardWeek");
  const returnWeek =
    typeof submittedWeek === "string" && isValidCalendarDate(submittedWeek)
      ? `&week=${submittedWeek}`
      : "";
  const { db, shop, session } = await requireBoardAuthor(shopSlug);
  const invalid = async () => {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=invalid${returnWeek}`);
  };
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return await invalid();
  // The interest ids a Requests link carried are navigation context, not authority:
  // the writer reads each one inside this shop's date interests, so a shareable URL
  // or a hand-built POST reaches nothing outside it (issue #1679).
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
    isPrivate,
    isRehearsal,
    selfGuided,
    diveMode,
    boatId,
    lensId,
    alsoUsualStart,
  } = parsed.data;
  // **A rehearsal is one departure** (ADR 20261012-rehearsal-departures): a
  // series would re-mint practice days on the board every night. Refused
  // with its own sentence rather than quietly dropping the cadence.
  if (isRehearsal && repeatIntervalWeeks > 0) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "add",
      outcome: "invalid",
    });
    redirect(`${back}?builder=rehearsal-repeats${returnWeek}`);
  }
  const crewPersonIds = crewPersonIdsFrom(formData);
  if (!crewPersonIds) return await invalid();
  // One date per later day when the course skips days (third UX review, item
  // 10). Absent or empty is the consecutive run; `meetingDaysFor` checks the
  // rest, so a list that disagrees with the count is refused there.
  const laterDates = z.array(z.string()).safeParse(formData.getAll("meetingDate"));
  if (!laterDates.success) return await invalid();

  // The same tenant rule the hull obeys: a lens id arriving on this form has to
  // be one of *this* shop's live words.
  if (lensId && !(await getTripLens(db, shop.id, lensId))) return await invalid();

  // The hull the panel just assigned. Its own prefill puts this number in
  // the box, but the box is editable afterwards. The certificate remains a limit (H-20261009-certificate-caps-seats).
  const assignedBoat = boatId ? await getBoatById(db, shop.id, boatId) : null;
  const details = tripDetailsPatch(
    {
      date,
      startTime,
      endTime,
      dayCount,
      laterDates: laterDates.data,
      priceDollars,
      depositDollars,
      cancellationWindowHours,
      minimumBookings,
      minimumDecisionHours,
      diveMode,
      boatId,
      capacity,
      boatCapacity: assignedBoat?.capacity ?? null,
      boatCertifiedPassengers: assignedBoat?.certifiedPassengers ?? null,
    },
    shop,
  );
  if (!details.ok) {
    if (details.reason === "capacity_above_certificate") {
      await trackEvent({
        name: "schedule_builder_action",
        action: "add",
        outcome: "capacity_above_certificate",
      });
      redirect(`${back}?builder=capacity-above-certificate&count=${details.limit}${returnWeek}`);
    }
    if (details.reason === "end_before_start") {
      await trackEvent({
        name: "schedule_builder_action",
        action: "add",
        outcome: "end_before_start",
      });
      redirect(`${back}?builder=end-before-start${returnWeek}`);
    }
    if (details.reason === "days_out_of_order") {
      await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
      redirect(`${back}?builder=days-out-of-order${returnWeek}`);
    }
    return await invalid();
  }
  const { startsAt, endsAt, scheduleDays } = details.patch;
  // **A repeating departure ends before its next one begins.** Named days can
  // stretch one departure over weeks; on a weekly cadence that would lay each
  // occurrence over the next, two rosters for the same students. Refused with
  // its own sentence rather than trimmed.
  const lastDay = scheduleDays.at(-1);
  if (
    repeatIntervalWeeks > 0 &&
    lastDay &&
    lastDay.startsAt.getTime() - startsAt.getTime() >= repeatIntervalWeeks * 7 * 86_400_000
  ) {
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "invalid" });
    redirect(`${back}?builder=days-span-repeat${returnWeek}`);
  }

  // The per-dive cards only exist while the panel is expanded, so an all-blank
  // read means they were never on screen — fall back to the quick row's single
  // dive-site select rather than writing four empty dives over it.
  const diveDrafts = tripDiveDraftsFromForm(formData, plannedDives);
  const plannedDiveCards = hasTripDiveContent(diveDrafts) ? diveDrafts : undefined;

  const common = {
    shopId: shop.id,
    courseId,
    title,
    description: description || undefined,
    capacity,
    plannedDives,
    // Dive one's site from the quick row's select when no per-dive card was filled.
    dives: plannedDiveCards ?? (diveSiteId ? [{ diveSiteId }] : undefined),
    priceCents: details.patch.priceCents,
    depositCents: details.patch.depositCents,
    cancellationWindowHours: details.patch.cancellationWindowHours,
    minimumBookings: details.patch.minimumBookings,
    minimumDecisionHours: details.patch.minimumDecisionHours,
    isPrivate,
    isRehearsal,
    selfGuided,
    diveMode: details.patch.diveMode,
    boatId: details.patch.boatId,
    lensId: lensId ?? null,
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
      template: { startsAt, endsAt, scheduleDays },
    });
    if (!series) return await invalid();
    const firstTrip = series.trips[0];
    if (!firstTrip) return await invalid();
    for (const trip of series.trips) {
      if (crewPersonIds.length > 0) {
        await setTripCrew(db, shop.id, trip.id, crewPersonIds, {
          actorPersonId: session.user.personId,
        });
      }
    }
    // One line for the series, on its first instance, rather than one per
    // week it repeats (D5).
    await recordShopActivity(db, {
      shopId: shop.id,
      actorPersonId: session.user.personId,
      write: { code: "series_added", tripId: firstTrip.id },
    });
    await attachRequestedInterests(db, shop.id, firstTrip.id, session.user.personId, formData);
    await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "ok" });
    await discardFormDraft(db, shop.id, session.user.personId, "add_departure");
    return await landAfterAdd(db, shop, shopSlug, title, series.trips.length);
  }

  const created = await createTrip(db, {
    ...common,
    startsAt,
    endsAt,
    scheduleDays,
  });
  if (!created) return await invalid();
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: session.user.personId,
    write: { code: "departure_added", tripId: created.id },
  });
  if (crewPersonIds.length > 0) {
    await setTripCrew(db, shop.id, created.id, crewPersonIds, {
      actorPersonId: session.user.personId,
    });
  }
  // A rehearsal answers nobody's request, and the writer skips it.
  await attachRequestedInterests(db, shop.id, created.id, session.user.personId, formData);
  // "Add it as well": the pattern's second departure, read back off the board
  // here rather than taken from the form, so what goes up is what the shop
  // actually ran. Its own fields where the days agreed; this submission's
  // where they did not. Never on the repeat path — a series carries one
  // departure, and a second one on the anchor date alone would be a stray.
  const also =
    alsoUsualStart && !isRehearsal
      ? (await weekdayPatternFor(db, shop.id, date, shop.timezone))?.alsoUsual
      : null;
  const addedAlso =
    also && also.startTime === alsoUsualStart
      ? await addPatternDeparture(db, shop, {
          also,
          date,
          fallback: { title, endTime, capacity, plannedDives, crewPersonIds },
          boats: boatId ? await listBoats(db, shop.id) : null,
          actorPersonId: session.user.personId,
        })
      : false;
  await trackEvent({ name: "schedule_builder_action", action: "add", outcome: "ok" });
  await discardFormDraft(db, shop.id, session.user.personId, "add_departure");
  return await landAfterAdd(db, shop, shopSlug, title, addedAlso ? 2 : 1);
}

/**
 * The pattern's second departure on the same day. Its return time, when the
 * days disagreed, keeps this submission's — the desk can move it once it is on
 * the board, and a departure that is there is easier to fix than one that is
 * not. A shape the details reader refuses (a hull too small, an end before its
 * start) simply is not added; the first departure still lands.
 */
async function addPatternDeparture(
  db: AppDb,
  shop: NonNullable<Awaited<ReturnType<typeof getShopById>>>,
  input: {
    also: PatternDeparture;
    date: string;
    fallback: {
      title: string;
      endTime: string;
      capacity: number;
      plannedDives: number;
      crewPersonIds: string[];
    };
    boats: Awaited<ReturnType<typeof listBoats>> | null;
    /** The staffer adding it, who is not told about their own crew choice. */
    actorPersonId: string;
  },
): Promise<boolean> {
  const { also, date, fallback } = input;
  const boatId = also.boatId ?? undefined;
  const boats = boatId ? (input.boats ?? (await listBoats(db, shop.id))) : null;
  const details = tripDetailsPatch(
    {
      date,
      startTime: also.startTime,
      endTime: also.endTime ?? fallback.endTime,
      dayCount: MIN_TRIP_DAYS,
      priceDollars:
        also.priceCents === null ? undefined : minorToMajor(also.priceCents, shop.currency),
      diveMode: (also.diveMode as "boat" | "shore" | "pool" | null) ?? undefined,
      boatId,
      capacity: also.capacity ?? fallback.capacity,
      boatCapacity: boatId ? (boats?.find((boat) => boat.id === boatId)?.capacity ?? null) : null,
      boatCertifiedPassengers: boatId
        ? (boats?.find((boat) => boat.id === boatId)?.certifiedPassengers ?? null)
        : null,
    },
    shop,
  );
  if (!details.ok) return false;
  if (also.lensId && !(await getTripLens(db, shop.id, also.lensId))) return false;
  const created = await createTrip(db, {
    shopId: shop.id,
    title: also.title ?? fallback.title,
    capacity: also.capacity ?? fallback.capacity,
    plannedDives: fallback.plannedDives,
    priceCents: details.patch.priceCents,
    depositCents: details.patch.depositCents,
    cancellationWindowHours: details.patch.cancellationWindowHours,
    minimumBookings: details.patch.minimumBookings,
    minimumDecisionHours: details.patch.minimumDecisionHours,
    diveMode: details.patch.diveMode,
    boatId: details.patch.boatId,
    lensId: also.lensId,
    dives: also.diveSiteId ? [{ diveSiteId: also.diveSiteId }] : undefined,
    startsAt: details.patch.startsAt,
    endsAt: details.patch.endsAt,
    scheduleDays: details.patch.scheduleDays,
  });
  if (!created) return false;
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: input.actorPersonId,
    write: { code: "departure_added", tripId: created.id },
  });
  const crew = also.crewPersonIds.length > 0 ? also.crewPersonIds : fallback.crewPersonIds;
  if (crew.length > 0) {
    await setTripCrew(db, shop.id, created.id, crew, { actorPersonId: input.actorPersonId });
  }
  return true;
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

/**
 * **What moving this departure will cost**, fetched when a staff member opens
 * the Move panel (issue #1203, D43). Same shape as `loadBuilderOptionsAction`
 * above and for the same reason: a board page carries a page of departures, and
 * seven counts per row for panels that are all closed is a query bill nobody
 * asked for. One departure, on the path that opens it.
 *
 * **Reads only** — the boundary this feature is defined by. It calls no
 * mutation, writes nothing, and the move that follows is not conditioned on
 * anything it returned; `moveDepartureAction` below is unchanged by it, which
 * is what keeps the gear preview from becoming a pre-check the exclusion
 * constraint would then have to disagree with.
 *
 * Scoped by the session's own shop, never the slug, and null for anyone who
 * cannot define trips — the same gate as the panel itself.
 */
export async function loadMovePreflightAction(
  tripId: string,
  /**
   * The date and time the panel's fields currently name, when together they
   * are not where the departure already sits. Null on mount, and whenever
   * either field is empty or half-typed — which is the shape a date or time
   * input holds until every segment is filled.
   *
   * The parts of the preview that depend on it are the two crew lines (issue
   * #1310), so the panel re-calls this as the fields change rather than once
   * on mount. A native date or time input publishes a value only when it is
   * complete, so that is at most a handful of calls per open panel and needs
   * no debounce — deliberately not `input`-per-keystroke against a text field.
   */
  target: { date: string; startTime: string } | null = null,
): Promise<MovePreflight | null> {
  const parsed = z.uuid().safeParse(tripId);
  if (!parsed.success) return null;
  const session = await requireStaffSession();
  const db = await getDb();
  const shopId = session.user.shopId;
  if (!(await canPersonConfigureTrips(db, shopId, session.user.personId))) return null;
  const shop = await getShopById(db, shopId);
  // The zone is the shop's, read here rather than taken from the caller: a
  // date and a time of day are only an instant once somebody says where. A
  // pair the reader cannot parse is simply no target, exactly as no pair is.
  const wall = target ? parseWallTime(target.date, target.startTime) : null;
  return getMovePreflight(
    db,
    shopId,
    parsed.data,
    wall && shop
      ? { startsAt: wallTimeToUtc(wall, shop.timezone), timeZone: shop.timezone }
      : undefined,
  );
}

const moveSchema = z.object({
  tripId: z.uuid(),
  date: z.string(),
  startTime: z.string(),
});

export async function moveDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { session, db, shop } = await requireBoardAuthor(shopSlug);
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
    { actorPersonId: session.user.personId, captureRescheduleStart: true },
  );
  if (!outcome.ok) {
    await trackEvent({ name: "schedule_builder_action", action: "move", outcome: outcome.reason });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "move", outcome: "ok" });
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: session.user.personId,
    write: { code: "departure_moved", tripId: parsed.data.tripId },
  });
  // **Tell the divers** (ux review 2026-10-11, item 1): every booked seat
  // hears the new time after the same eight-second hold every staff send
  // takes; the board shows count-free progress with Undo. Nothing
  // is held for a departure with nobody on it.
  const notice = await holdRescheduleNotice(db, {
    shopId: shop.id,
    tripId: parsed.data.tripId,
    movedFrom: outcome.previousStartsAt,
    meetingPointMoved: false,
    actorPersonId: session.user.personId,
  });
  // The shop-bound proof keeps a copied or invented gear count from becoming a warning.
  const params = new URLSearchParams({ builder: "moved" });
  params.set("result", signScheduleMoveResult(shop.id, crypto.randomUUID(), outcome.gearReleased));
  if (notice) {
    params.set("held", notice.id);
    params.set("tell", String(notice.told));
  }
  revalidateAndRedirect(back, `${back}?${params}`);
}

export async function duplicateDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { session, db, shop } = await requireBoardAuthor(shopSlug);
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
  const crewCame = await copyCrewIfAsked(db, shop.id, parsed.data, copy.id, session.user.personId);
  await trackEvent({ name: "schedule_builder_action", action: "copy", outcome: "ok" });
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: session.user.personId,
    write: { code: "departure_copied", tripId: copy.id },
  });
  revalidateAndRedirect(back, `${back}?builder=${crewCame ? "copied" : "copied-no-crew"}`);
}

export async function removeDepartureAction(shopSlug: string, formData: FormData) {
  const back = boardPath(shopSlug);
  const { session, db, shop } = await requireBoardAuthor(shopSlug);
  const tripId = parseForm(removeDepartureForm, formData);
  if (!tripId.ok) {
    await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "invalid" });
    redirect(`${back}?builder=invalid`);
  }

  const outcome = await deleteTrip(db, shop.id, tripId.data.tripId);
  if (!outcome.ok) {
    await trackEvent({
      name: "schedule_builder_action",
      action: "remove",
      outcome: outcome.reason,
    });
    redirect(`${back}?builder=${outcome.reason.replace(/_/g, "-")}`);
  }
  await trackEvent({ name: "schedule_builder_action", action: "remove", outcome: "ok" });
  await recordShopActivity(db, {
    shopId: shop.id,
    actorPersonId: session.user.personId,
    write: { code: "departure_deleted", tripId: tripId.data.tripId },
  });
  revalidateAndRedirect(back, `${back}?builder=removed`);
}
