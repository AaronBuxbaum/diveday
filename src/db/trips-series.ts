import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  type CalendarDate,
  calendarDateInTimezone,
  calendarDaysBetween,
  isValidCalendarDate,
  shiftCalendarDate,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import {
  isValidWeeklyPattern,
  SERIES_HORIZON_DAYS,
  seriesFiresOn,
  seriesOccurrenceDates,
  type TripRecurrenceFrequency,
  type WeekdaySet,
} from "@/lib/recurrence";
import { utcToWallTime, type WallTime, wallTimeToUtc } from "@/lib/zoned";
import { type AppDb, type AppTransaction, queryAll } from "./client";
import {
  bookings,
  rollCallEvents,
  shops,
  tripDives,
  tripScheduleDays,
  tripSeries,
  tripSeriesSkips,
  trips,
} from "./schema";
import {
  insertTripInstance,
  type NewTrip,
  normalizedDiveCount,
  normalizedDiveDrafts,
  replaceTripDives,
  resolveCourse,
  type TripScheduleDayInput,
  validateDiveSites,
} from "./trips-create";

/**
 * Recurring series: a `trip_series` row plus one fully-formed, independent trip
 * per occurrence (ADR 20260719-recurring-trip-series, amended by
 * 20260810-open-ended-recurring-trips).
 *
 * The whole point is that instances are independent after creation — staff edit,
 * move, cancel, or delete any single date without touching its siblings. The
 * series-wide operations here (`applyDetailsToFutureSeries`,
 * `cancelFutureSeriesTrips`, `rollSeriesForward`) are therefore deliberate
 * fan-outs over the instance set, never a shared row every instance reads
 * through.
 *
 * What changed in the amendment is the *end* of a series, not its spine. A
 * series no longer counts out a fixed batch of dates: it carries a cadence and
 * an optional last date, and instances are materialized into a rolling window
 * `SERIES_HORIZON_DAYS` wide. `rollSeriesForward` is the one function that
 * fills that window, and it is idempotent by construction — it proposes the
 * cadence's dates and creates only the ones that have neither an instance nor a
 * skip. That is what lets a nightly cron, a staff button, and series creation
 * itself all be the same call.
 */

/** Where a materialization pass reads its per-occurrence shape from. */
type InstanceTemplate = {
  trip: typeof trips.$inferSelect;
  days: Array<{ startsAt: Date; endsAt: Date }>;
  drafts: Array<{
    diveNumber: number;
    title: string | null;
    diveSiteId: string | null;
    description: string | null;
    travelMinutes: number | null;
  }>;
};

/** The wall-clock time of day of an instant, placed on a different calendar date. */
function timeOfDayOnDate(instant: Date, date: CalendarDate, timeZone: string): WallTime {
  const wall = utcToWallTime(instant, timeZone);
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day, hour: wall.hour, minute: wall.minute };
}

/**
 * The template's meeting days re-placed on a new occurrence date.
 *
 * Each day keeps its own wall-clock start and end and its own offset from day
 * one, so a two-day course still meets on consecutive mornings and a night
 * charter that docks after midnight still ends on the following date. The
 * offsets are measured against the template's *actual* first day rather than
 * its cadence slot: an instance staff dragged to another day is still a
 * perfectly good shape to copy, and its move must not drag the cadence along
 * with it.
 *
 * Everything is rebuilt from wall-clock parts rather than by adding a
 * millisecond delta, so an occurrence on the far side of a daylight-saving
 * change departs at the hour the shop published, not an hour off it.
 */
function daysOnOccurrence(
  templateDays: ReadonlyArray<{ startsAt: Date; endsAt: Date }>,
  occurrenceDate: CalendarDate,
  timeZone: string,
): TripScheduleDayInput[] {
  const firstDay = templateDays[0];
  if (!firstDay) return [];
  const dayOneDate = calendarDateInTimezone(firstDay.startsAt, timeZone);
  return templateDays.map((day, index) => {
    const startOffset = calendarDaysBetween(
      dayOneDate,
      calendarDateInTimezone(day.startsAt, timeZone),
    );
    const endOffset = calendarDaysBetween(dayOneDate, calendarDateInTimezone(day.endsAt, timeZone));
    return {
      dayNumber: index + 1,
      startsAt: wallTimeToUtc(
        timeOfDayOnDate(day.startsAt, shiftCalendarDate(occurrenceDate, startOffset), timeZone),
        timeZone,
      ),
      endsAt: wallTimeToUtc(
        timeOfDayOnDate(day.endsAt, shiftCalendarDate(occurrenceDate, endOffset), timeZone),
        timeZone,
      ),
    };
  });
}

/** The furthest-out instance of a series, with the shape a new date copies from. */
async function loadTemplate(
  tx: AppTransaction,
  shopId: string,
  seriesId: string,
): Promise<InstanceTemplate | null> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), eq(trips.shopId, shopId)))
    .orderBy(desc(trips.startsAt))
    .limit(1);
  if (!trip) return null;
  const days = await tx
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, trip.id))
    .orderBy(asc(tripScheduleDays.dayNumber));
  const dives = await tx
    .select()
    .from(tripDives)
    .where(eq(tripDives.tripId, trip.id))
    .orderBy(asc(tripDives.diveNumber));
  return {
    trip,
    days: days.length > 0 ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }],
    drafts: dives.map((dive) => ({
      diveNumber: dive.diveNumber,
      title: dive.title,
      diveSiteId: dive.diveSiteId,
      description: dive.description,
      // Every Saturday runs the same route, so every instance inherits the same
      // legs (ADR 20260815-per-leg-travel-minutes).
      travelMinutes: dive.travelMinutes,
    })),
  };
}

/**
 * Fill a series' window: create an instance for every cadence date between
 * `from` and `through` that does not already have one.
 *
 * Idempotent on purpose — this is called on creation, from the trip page, and
 * nightly by `/api/cron/trip-series`, and all three must be able to run over
 * the same window without doubling a departure. A date is "spoken for" when an
 * instance carries it (whatever that instance's status, and wherever staff have
 * since moved it) or when a skip row records that staff deleted it.
 *
 * Templates from the furthest-out instance, so a shop that improves next
 * month's charter sees the improvement on the dates that follow it. Returns the
 * created instances, or null when the series has nothing to template from or
 * its course has since been archived — guessing the cert gate on a safety
 * surface is never acceptable.
 */
async function materializeWindow(
  tx: AppTransaction,
  input: {
    series: typeof tripSeries.$inferSelect;
    timeZone: string;
    from: CalendarDate;
    through: CalendarDate;
  },
): Promise<Array<typeof trips.$inferSelect> | null> {
  const { series, timeZone } = input;
  const proposed = seriesOccurrenceDates({
    anchorDate: series.anchorDate,
    pattern: { intervalWeeks: series.intervalWeeks, weekdays: series.weekdayMask },
    from: input.from,
    through: input.through,
    endsOn: series.endsOn,
  });
  if (!proposed) return null;
  if (proposed.length === 0) return [];

  const template = await loadTemplate(tx, series.shopId, series.id);
  if (!template) return null;
  const { ok, course } = await resolveCourse(
    tx,
    series.shopId,
    template.trip.courseId ?? undefined,
  );
  if (!ok) return null;

  // `queryAll`, not `Promise.all`: the nightly roll materializes inside a
  // transaction, which is one pinned client. See `queryAll` in `src/db/client.ts`.
  const [taken, skipped] = await queryAll(tx, [
    () =>
      tx
        .select({ date: trips.seriesOccurrenceDate })
        .from(trips)
        .where(and(eq(trips.seriesId, series.id), eq(trips.shopId, series.shopId))),
    () =>
      tx
        .select({ date: tripSeriesSkips.occurrenceDate })
        .from(tripSeriesSkips)
        // Shop-scoped as well as series-scoped. A series id is globally unique,
        // so this is belt and braces today — but the house rule is that the query
        // carries the shop condition rather than trusting that every writer got
        // the pairing right, and a skip that silently applied across tenants
        // would take a departure off a board nobody could explain.
        .where(
          and(eq(tripSeriesSkips.seriesId, series.id), eq(tripSeriesSkips.shopId, series.shopId)),
        ),
  ]);
  const spokenFor = new Set<string>();
  for (const row of taken) if (row.date) spokenFor.add(row.date);
  for (const row of skipped) spokenFor.add(row.date);

  const created = [];
  for (const occurrenceDate of proposed) {
    if (spokenFor.has(occurrenceDate)) continue;
    const days = daysOnOccurrence(template.days, occurrenceDate, timeZone);
    const first = days[0];
    const last = days.at(-1);
    if (!first || !last) continue;
    created.push(
      await insertTripInstance(tx, {
        shopId: series.shopId,
        seriesId: series.id,
        seriesOccurrenceDate: occurrenceDate,
        courseId: template.trip.courseId ?? undefined,
        course,
        title: template.trip.title,
        description: template.trip.description ?? undefined,
        startsAt: first.startsAt,
        endsAt: last.endsAt,
        capacity: template.trip.capacity,
        plannedDives: template.trip.plannedDives,
        priceCents: template.trip.priceCents,
        depositCents: template.trip.depositCents,
        cancellationWindowHours: template.trip.cancellationWindowHours,
        drafts: template.drafts,
        scheduleDays: days,
      }),
    );
  }
  if (created.length > 0) {
    await tx
      .update(tripSeries)
      .set({ occurrenceCount: series.occurrenceCount + created.length })
      .where(eq(tripSeries.id, series.id));
  }
  return created;
}

export type NewTripSeries = Omit<NewTrip, "startsAt" | "endsAt" | "scheduleDays"> & {
  frequency: TripRecurrenceFrequency;
  intervalWeeks: number;
  /** Which weekdays each firing week departs on (src/lib/recurrence.ts bitmask). */
  weekdays: WeekdaySet;
  /** Shop-local date the cadence is counted from — the phase, not necessarily a departure. */
  anchorDate: CalendarDate;
  /** Shop-local last date, or null for a series that simply keeps going. */
  endsOn: CalendarDate | null;
  /** The shop's own zone; every occurrence date is resolved through it. */
  timeZone: string;
  /**
   * One occurrence's wall-clock shape, as if it fell on `anchorDate` — the
   * departure staff filled in. Every generated date is this shape re-placed on
   * its own day, so a multi-day departure keeps its meeting days and a series
   * that spans a daylight-saving change keeps its published hours.
   */
  template: { startsAt: Date; endsAt: Date; scheduleDays?: TripScheduleDayInput[] };
};

/**
 * Materialize a recurring series: one `trip_series` row plus one fully-formed,
 * independent trip for every cadence date inside the horizon, all in a single
 * transaction. Every instance starts identical; staff edit, move, cancel, or
 * delete any single date afterward without touching its siblings.
 *
 * The horizon is a materialization window, not the length of the series — a
 * series with `endsOn: null` keeps rolling forward for as long as the shop runs
 * it (20260810-open-ended-recurring-trips). Returns null on the same validation
 * failures as `createTrip`, plus an unusable cadence or a window that yields no
 * dates at all.
 */
export async function createTripSeries(db: AppDb, input: NewTripSeries) {
  return db.transaction(async (tx) => {
    if (!isValidWeeklyPattern({ intervalWeeks: input.intervalWeeks, weekdays: input.weekdays })) {
      return null;
    }
    if (!isValidCalendarDate(input.anchorDate)) return null;
    if (input.endsOn !== null && !isValidCalendarDate(input.endsOn)) return null;
    const plannedDives = normalizedDiveCount(input.plannedDives);
    if (!plannedDives) return null;
    const drafts = normalizedDiveDrafts(
      plannedDives,
      input.dives ?? (input.diveSiteId ? [{ diveSiteId: input.diveSiteId }] : undefined),
    );
    if (!(await validateDiveSites(tx, input.shopId, drafts))) return null;
    const { ok, course } = await resolveCourse(tx, input.shopId, input.courseId);
    if (!ok) return null;

    const [series] = await tx
      .insert(tripSeries)
      .values({
        shopId: input.shopId,
        title: input.title,
        frequency: input.frequency,
        intervalWeeks: input.intervalWeeks,
        weekdayMask: input.weekdays,
        anchorDate: input.anchorDate,
        endsOn: input.endsOn,
        occurrenceCount: 0,
      })
      .returning();
    if (!series) throw new Error("createTripSeries: insert returned no row");

    // The seed instance carries the shape every later date is re-placed from,
    // so it is written directly rather than through the window: there is
    // nothing to template off yet. It sits on the first cadence date on or
    // after the anchor — which is the anchor itself in the ordinary case, and
    // the following Monday when a shop starts a Mon+Thu run on a Saturday.
    const [seedDate] =
      seriesOccurrenceDates({
        anchorDate: input.anchorDate,
        pattern: { intervalWeeks: input.intervalWeeks, weekdays: input.weekdays },
        from: input.anchorDate,
        through: shiftCalendarDate(input.anchorDate, SERIES_HORIZON_DAYS),
        endsOn: input.endsOn,
      }) ?? [];
    if (!seedDate) return null;

    const seedDays = daysOnOccurrence(
      input.template.scheduleDays?.length
        ? input.template.scheduleDays
        : [{ startsAt: input.template.startsAt, endsAt: input.template.endsAt }],
      seedDate,
      input.timeZone,
    );
    const seedFirst = seedDays[0];
    const seedLast = seedDays.at(-1);
    if (!seedFirst || !seedLast) return null;
    const seed = await insertTripInstance(tx, {
      shopId: input.shopId,
      seriesId: series.id,
      seriesOccurrenceDate: seedDate,
      courseId: input.courseId,
      course,
      title: input.title,
      description: input.description,
      startsAt: seedFirst.startsAt,
      endsAt: seedLast.endsAt,
      capacity: input.capacity,
      plannedDives,
      priceCents: input.priceCents,
      depositCents: input.depositCents,
      cancellationWindowHours: input.cancellationWindowHours,
      drafts,
      scheduleDays: seedDays,
    });
    await tx.update(tripSeries).set({ occurrenceCount: 1 }).where(eq(tripSeries.id, series.id));

    // Measured from the series' own first date rather than from today, so a
    // shop that schedules next season's run gets that season on the board
    // rather than one lonely date and a promise. The nightly roll takes over
    // from there, measuring from today.
    const rest = await materializeWindow(tx, {
      series: { ...series, occurrenceCount: 1 },
      timeZone: input.timeZone,
      from: seedDate,
      through: shiftCalendarDate(seedDate, SERIES_HORIZON_DAYS),
    });
    if (!rest) return null;
    return { series, trips: [seed, ...rest] };
  });
}

export type SeriesRollResult = { created: number };

/**
 * Roll one series' horizon forward: put every cadence date between today and
 * `SERIES_HORIZON_DAYS` out on the board that is not already there.
 *
 * This is the whole of "a series has no limit". Nothing schedules a series
 * *itself*; the board simply always holds the next four months of it, and this
 * call is what keeps that true — from the nightly cron, from the trip page's
 * own control, and from creation. Running it twice changes nothing the second
 * time.
 *
 * The window starts at today rather than at the series' anchor, so a date in
 * the past that staff deleted before this ledger existed is never resurrected,
 * and a series whose end date has passed generates nothing at all. Returns null
 * when the series is unknown to the shop, has no instance left to template
 * from, or its course was archived.
 */
export async function rollSeriesForward(
  db: AppDb,
  shopId: string,
  seriesId: string,
  now: Date = nowDate(),
): Promise<SeriesRollResult | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ series: tripSeries, timeZone: shops.timezone })
      .from(tripSeries)
      .innerJoin(shops, eq(shops.id, tripSeries.shopId))
      .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
      .limit(1)
      // The series row is the lock every roll of this series queues behind, and
      // it is load-bearing rather than defensive. `materializeWindow` decides
      // what to create by *reading* the instance set and then inserting, so
      // under READ COMMITTED two overlapping passes both read the same empty
      // slots and both fill them — a whole horizon of duplicate departures, on
      // the public schedule, each separately bookable. That is not a
      // hypothetical pairing: the nightly cron fires at 03:15 UTC while staff
      // can be pressing "Start repeating" or saving a cadence, and both land
      // here. `FOR UPDATE` on this one row serializes them; the second pass
      // then reads the first's rows and finds every slot spoken for, which is
      // exactly the no-op its idempotency already promises.
      //
      // The lock is taken on the *series*, not the trips, because the trips
      // whose absence is being read do not exist yet — there is no row to lock.
      // `createTripSeries` needs no such line: it inserted this row inside its
      // own transaction, so it already holds the lock.
      .for("update");
    if (!row) return null;
    const today = calendarDateInTimezone(now, row.timeZone);
    const created = await materializeWindow(tx, {
      series: row.series,
      timeZone: row.timeZone,
      from: today,
      through: shiftCalendarDate(today, SERIES_HORIZON_DAYS),
    });
    if (!created) return null;
    return { created: created.length };
  });
}

export type SeriesSweepResult = {
  seriesConsidered: number;
  seriesExtended: number;
  tripsCreated: number;
  failures: number;
  /** Runs that were due but did not fit in this pass — zero on a healthy night. */
  deferred: number;
};

/**
 * How many runs one nightly pass will roll.
 *
 * A bound, and a deliberately generous one: a roll that finds nothing to do is
 * two small queries, and only the few series crossing the horizon on any given
 * night write anything at all. What the cap actually buys is that no single
 * shop's schedule can push another shop's off the end of a 60-second function
 * — see `SERIES_SWEEP_ORDER` for why "off the end" would otherwise be
 * permanent rather than a one-night delay.
 */
export const SERIES_SWEEP_LIMIT = 500;

/**
 * Roll every still-running series in every shop forward — the nightly pass
 * behind `/api/cron/trip-series`.
 *
 * Candidates are the series that have not ended: `ends_on` is null (the
 * open-ended run) or still ahead of us. The date comparison is a deliberately
 * loose pre-filter — `ends_on` is a shop-local date and the cutoff here is a
 * UTC one, so a shop up to a day either side of the line is still considered
 * and `materializeWindow` makes the exact call in the shop's own zone.
 *
 * **Least-recently-rolled first, and bounded.** Ordering by creation date —
 * what this did first — would put every series created after a burst behind
 * that burst *every night*: one shop with a thousand runs would permanently
 * starve a shop that started later, and the starved shop sees only its board
 * quietly failing to advance four months out. Ordering by `last_rolled_at`
 * (never-rolled first) makes the queue a round robin, so a pass that hits the
 * cap defers work by one night rather than forever. The stamp is written on
 * every attempt, success or failure, for exactly that reason.
 *
 * A run left over is *reported*, never silently dropped: `deferred` is the
 * count the cron logs.
 *
 * One transaction per series, so a series whose course was archived (or whose
 * instances were all deleted) is reported as a failure and the rest still roll.
 */
export async function rollAllSeriesForward(
  db: AppDb,
  now: Date = nowDate(),
): Promise<SeriesSweepResult> {
  const cutoff = calendarDateInTimezone(shiftDaysUtc(now, -1), "UTC");
  // A run whose cadence cannot generate is not a candidate. The only way to
  // hold one is the deploy window this feature's migration describes: the
  // release *before* the cadence columns existed inserts a `trip_series` row
  // naming neither, so it lands on their inert defaults. Left in the sweep it
  // would fail every night forever — a permanently red monitor for a row that
  // was never going to generate a date — and staff can repair it from the trip
  // page's cadence editor whenever they notice.
  const runnable = and(
    gt(tripSeries.weekdayMask, 0),
    ne(tripSeries.anchorDate, ""),
    or(isNull(tripSeries.endsOn), gte(tripSeries.endsOn, cutoff)),
  );
  const candidates = await db
    .select({ id: tripSeries.id, shopId: tripSeries.shopId })
    .from(tripSeries)
    .where(runnable)
    // `nulls first` written into the ordering itself: Drizzle's `asc()` appends
    // its own keyword, which would put the null clause in front of it and make
    // the SQL unparseable. A never-rolled run has to sort first — it is the one
    // most in need of a pass.
    .orderBy(sql`${tripSeries.lastRolledAt} asc nulls first`, asc(tripSeries.id))
    .limit(SERIES_SWEEP_LIMIT + 1);

  const batch = candidates.slice(0, SERIES_SWEEP_LIMIT);
  const summary: SeriesSweepResult = {
    seriesConsidered: batch.length,
    seriesExtended: 0,
    tripsCreated: 0,
    failures: 0,
    // One extra row read is enough to know the queue was longer than the pass.
    // Not the true remainder, and it does not need to be: the number that
    // matters is "did anything wait?", and the next pass takes it first.
    deferred: candidates.length > SERIES_SWEEP_LIMIT ? candidates.length - SERIES_SWEEP_LIMIT : 0,
  };
  for (const candidate of batch) {
    const result = await rollSeriesForward(db, candidate.shopId, candidate.id, now);
    // Stamped whatever happened, so a series that fails every night still goes
    // to the back of the queue instead of holding the front of it.
    await db
      .update(tripSeries)
      .set({ lastRolledAt: now })
      .where(and(eq(tripSeries.id, candidate.id), eq(tripSeries.shopId, candidate.shopId)));
    if (!result) {
      summary.failures += 1;
      continue;
    }
    if (result.created > 0) {
      summary.seriesExtended += 1;
      summary.tripsCreated += result.created;
    }
  }
  return summary;
}

/** Whole days added to an instant, for a UTC-only pre-filter bound. */
function shiftDaysUtc(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

/**
 * Close a cadence slot for good: the date staff deleted must not come back on
 * the next roll. Called inside `deleteTrip`'s own transaction, so a departure
 * is never removed without the ledger entry that keeps it removed. Silently
 * does nothing for a one-off trip or a pre-ledger instance with no slot.
 */
export async function recordSeriesSkip(
  tx: AppTransaction,
  trip: { shopId: string; seriesId: string | null; seriesOccurrenceDate: string | null },
): Promise<void> {
  if (!trip.seriesId || !trip.seriesOccurrenceDate) return;
  await tx
    .insert(tripSeriesSkips)
    .values({
      shopId: trip.shopId,
      seriesId: trip.seriesId,
      occurrenceDate: trip.seriesOccurrenceDate,
    })
    .onConflictDoNothing();
}

/**
 * The series a trip belongs to plus how many of its instances are still on the
 * schedule — provenance for the trip page's "part of a series" note. Null when
 * the trip is a one-off. `futureScheduledCount` is the subset series-wide edit,
 * cancel, and horizon-roll operate on: still-scheduled dates yet to depart.
 */
export async function getTripSeriesSummary(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
) {
  const [row] = await db
    .select({ series: tripSeries })
    .from(trips)
    .innerJoin(tripSeries, eq(tripSeries.id, trips.seriesId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  const [counts] = await db
    .select({
      scheduled: sql<number>`count(*) filter (where ${trips.status} = 'scheduled')::int`,
      future: sql<number>`count(*) filter (where ${trips.status} = 'scheduled' and ${trips.startsAt} >= ${now})::int`,
    })
    .from(trips)
    // Same reasoning as the skips read above: the shop condition travels with
    // the query, not with the caller's confidence in the series id.
    .where(and(eq(trips.seriesId, row.series.id), eq(trips.shopId, shopId)));
  return {
    ...row.series,
    scheduledCount: counts?.scheduled ?? 0,
    futureScheduledCount: counts?.future ?? 0,
  };
}

/** The series row itself, scoped to a shop — cadence for a horizon-roll. */
export async function getTripSeriesById(db: AppDb, shopId: string, seriesId: string) {
  const [row] = await db
    .select()
    .from(tripSeries)
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/** The furthest-out instance of a series — the template a new date is copied from. */
export async function getLatestSeriesInstance(db: AppDb, shopId: string, seriesId: string) {
  const [row] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), eq(trips.shopId, shopId)))
    .orderBy(desc(trips.startsAt))
    .limit(1);
  return row ?? null;
}

/**
 * An upcoming date that is on the board but no longer on the cadence — what a
 * shop is shown after narrowing a run. `booked` counts the divers who would be
 * turned around if it were cancelled, which is the whole reason this is offered
 * rather than done.
 */
export type OffCadenceSeriesTrip = {
  id: string;
  title: string;
  startsAt: Date;
  occurrenceDate: CalendarDate;
  booked: number;
};

/**
 * The still-scheduled, not-yet-departed instances whose cadence slot the series
 * no longer fires on.
 *
 * Only ever non-empty after staff *narrow* a run — dropping a weekday, widening
 * the interval, pulling the end date in. Those instances are ordinary trips with
 * ordinary rosters, so narrowing the cadence must not touch them; this is what
 * lets the surface offer them as an explicit second step instead
 * (`cancelOffCadenceSeriesTrips`).
 *
 * Judged on `series_occurrence_date`, not `starts_at`: an instance staff dragged
 * to another day still fills the slot it was generated for, and reading the moved
 * date would report a perfectly good departure as orphaned. An instance with no
 * slot at all (created before the ledger existed) is left out — there is nothing
 * to judge it against, and guessing would offer to cancel a real departure.
 */
export async function listOffCadenceSeriesTrips(
  db: AppDb,
  shopId: string,
  seriesId: string,
  now: Date = nowDate(),
): Promise<OffCadenceSeriesTrip[]> {
  const [series] = await db
    .select()
    .from(tripSeries)
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
    .limit(1);
  if (!series) return [];
  const rows = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      occurrenceDate: trips.seriesOccurrenceDate,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.seriesId, seriesId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
  const cadence = {
    anchorDate: series.anchorDate,
    pattern: { intervalWeeks: series.intervalWeeks, weekdays: series.weekdayMask },
    endsOn: series.endsOn,
  };
  return rows
    .filter(
      (row): row is typeof row & { occurrenceDate: string } =>
        row.occurrenceDate !== null && !seriesFiresOn(cadence, row.occurrenceDate),
    )
    .map((row) => ({ ...row }));
}

/**
 * Take the off-cadence upcoming dates off the public schedule — the second,
 * explicit half of narrowing a run.
 *
 * Cancels rather than deletes, through the same status every per-date cancel
 * uses, so each one is reinstatable from its own trip page and every booking's
 * history survives. Re-derives the list inside the transaction rather than
 * trusting ids from the form: a date can be booked, moved, or cancelled between
 * the page render and the tap, and cancelling a departure that has *since*
 * come back onto the cadence would be the exact silent bulk cancellation this
 * two-step exists to prevent. Returns how many were taken off.
 */
export async function cancelOffCadenceSeriesTrips(
  db: AppDb,
  shopId: string,
  seriesId: string,
  now: Date = nowDate(),
): Promise<number> {
  const stale = await listOffCadenceSeriesTrips(db, shopId, seriesId, now);
  if (stale.length === 0) return 0;
  const cancelled = await db
    .update(trips)
    // Same stamp as any other cancellation. An off-cadence occurrence being
    // taken off the board *is* the shop calling that departure off -- it can
    // carry booked, paid seats, which is exactly why narrowing a cadence lists
    // the orphaned dates with their head counts before doing it -- so the money
    // it leaves behind is owed from this instant like any other.
    .set({ status: "cancelled", cancelledAt: now })
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.seriesId, seriesId),
        eq(trips.status, "scheduled"),
        inArray(
          trips.id,
          stale.map((trip) => trip.id),
        ),
      ),
    )
    .returning({ id: trips.id });
  return cancelled.length;
}

export type SeriesCadencePatch = {
  intervalWeeks: number;
  weekdays: WeekdaySet;
  /** The new last date, or null to let the run keep going. */
  endsOn: CalendarDate | null;
};

export type SeriesCadenceUpdate = {
  /** Dates the widened cadence put on the board in the same call. */
  created: number;
  /** Upcoming dates the narrowed cadence no longer fires on — offered, never cancelled here. */
  offCadence: number;
};

/**
 * Change a running series' cadence: which weekdays, how many weeks apart, and
 * when (or whether) it ends.
 *
 * **Widening is free; narrowing is never destructive.** Adding a weekday or
 * pushing the end date out just saves and rolls the horizon, and the new dates
 * appear. Dropping a weekday or pulling the end date in saves the cadence and
 * *reports* how many upcoming dates no longer fit — it cancels nothing. Those
 * are real trips with real divers on them, and a cadence edit that quietly
 * emptied a fortnight of the board would be a bulk cancellation nobody asked
 * for. The surface offers them as a separate, counted step
 * (`cancelOffCadenceSeriesTrips`).
 *
 * The anchor date never moves. It is the cadence's *phase*, not its start: an
 * every-other-week run that re-anchored on the day somebody edited it would
 * silently swap which fortnight it sails in.
 *
 * Returns null when the series is unknown to the shop or the cadence is
 * unusable — an empty weekday set would leave a run that generates nothing while
 * still claiming to repeat.
 */
export async function updateSeriesCadence(
  db: AppDb,
  shopId: string,
  seriesId: string,
  patch: SeriesCadencePatch,
  now: Date = nowDate(),
): Promise<SeriesCadenceUpdate | null> {
  if (!isValidWeeklyPattern({ intervalWeeks: patch.intervalWeeks, weekdays: patch.weekdays })) {
    return null;
  }
  if (patch.endsOn !== null && !isValidCalendarDate(patch.endsOn)) return null;
  const [row] = await db
    .select({ id: tripSeries.id })
    .from(tripSeries)
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
    .limit(1);
  if (!row) return null;

  await db
    .update(tripSeries)
    .set({
      intervalWeeks: patch.intervalWeeks,
      weekdayMask: patch.weekdays,
      endsOn: patch.endsOn,
    })
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)));

  const rolled = await rollSeriesForward(db, shopId, seriesId, now);
  const offCadence = await listOffCadenceSeriesTrips(db, shopId, seriesId, now);
  return { created: rolled?.created ?? 0, offCadence: offCadence.length };
}

/**
 * Stop a series repeating, or start it again — the two halves of one switch.
 *
 * Stopping sets `ends_on` to today in the shop's own zone: every date already
 * on the board stays exactly as it is (they are ordinary trips with divers on
 * them), and no new one is ever generated. Starting again clears `ends_on` and
 * refills the horizon in the same call, which is also how a shop takes a
 * finite, pre-existing series and lets it simply keep going.
 *
 * Returns null when the series is unknown to the shop; `created` is how many
 * dates the restart put on the board.
 */
export async function setSeriesRepeat(
  db: AppDb,
  shopId: string,
  seriesId: string,
  keepRepeating: boolean,
  now: Date = nowDate(),
): Promise<SeriesRollResult | null> {
  const [row] = await db
    .select({ id: tripSeries.id, timeZone: shops.timezone })
    .from(tripSeries)
    .innerJoin(shops, eq(shops.id, tripSeries.shopId))
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  await db
    .update(tripSeries)
    .set({ endsOn: keepRepeating ? null : calendarDateInTimezone(now, row.timeZone) })
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)));
  if (!keepRepeating) return { created: 0 };
  return (await rollSeriesForward(db, shopId, seriesId, now)) ?? { created: 0 };
}

/**
 * Cancel every still-scheduled, not-yet-departed instance of a series in one
 * action — the series-wide counterpart to `setTripStatus` on a single date.
 * Past and already-cancelled dates are left untouched (history is never
 * rewritten), and each cancelled row can still be reinstated on its own trip
 * page.
 *
 * **Also stops the series repeating.** Without that, a nightly roll would
 * cheerfully re-fill the horizon staff had just cleared, and "cancel every
 * upcoming date" would be a button that undoes itself by morning. Staff turn
 * the run back on from the same panel. Returns how many dates were taken off
 * the board.
 */
export async function cancelFutureSeriesTrips(
  db: AppDb,
  shopId: string,
  seriesId: string,
  now: Date = nowDate(),
): Promise<number> {
  const cancelled = await db
    .update(trips)
    .set({ status: "cancelled", cancelledAt: now })
    .where(
      and(
        eq(trips.seriesId, seriesId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .returning({ id: trips.id });
  await setSeriesRepeat(db, shopId, seriesId, false, now);
  return cancelled.length;
}

export type SeriesDetailApplyResult = { updated: number; skipped: number };

/**
 * Push one date's editable details out across the rest of a series — the
 * "edited as one, applied to the run" half of the ADR. Copies the source trip's
 * title, description, capacity, dive count, pricing, cancellation window, and
 * dive plan onto every future still-scheduled sibling; the per-instance date,
 * time, conditions, crew, roster, and status are deliberately left alone. A
 * sibling already carrying more divers than the new capacity is skipped rather
 * than stranding a booking, and the count is reported so staff can follow up.
 * Returns null when the source trip is not part of this series in this shop.
 */
export async function applyDetailsToFutureSeries(
  db: AppDb,
  shopId: string,
  seriesId: string,
  sourceTripId: string,
  now: Date = nowDate(),
): Promise<SeriesDetailApplyResult | null> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(trips)
      .where(
        and(eq(trips.id, sourceTripId), eq(trips.shopId, shopId), eq(trips.seriesId, seriesId)),
      )
      .limit(1);
    if (!source) return null;
    const sourceDives = await tx
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, sourceTripId))
      .orderBy(asc(tripDives.diveNumber));
    const drafts = sourceDives.map((dive) => ({
      diveNumber: dive.diveNumber,
      title: dive.title,
      diveSiteId: dive.diveSiteId,
      description: dive.description,
      travelMinutes: dive.travelMinutes,
    }));

    const siblings = await tx
      .select({ id: trips.id, booked: count(bookings.id) })
      .from(trips)
      .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
      .where(
        and(
          eq(trips.seriesId, seriesId),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          gte(trips.startsAt, now),
          ne(trips.id, sourceTripId),
        ),
      )
      .groupBy(trips.id);

    // Same operational-history invariant updateTrip enforces for a single
    // trip (CR-006) — a bulk apply must not silently orphan a sibling's
    // roll-call checkpoints either.
    const siblingIds = siblings.map((sibling) => sibling.id);
    const siblingCheckpoints =
      siblingIds.length > 0
        ? await tx
            .select({
              tripId: rollCallEvents.tripId,
              bookingId: rollCallEvents.bookingId,
              checkpoint: rollCallEvents.checkpoint,
              status: rollCallEvents.status,
              occurredAt: rollCallEvents.occurredAt,
              createdAt: rollCallEvents.createdAt,
            })
            .from(rollCallEvents)
            .where(inArray(rollCallEvents.tripId, siblingIds))
        : [];
    const checkpointsByTrip = new Map<string, typeof siblingCheckpoints>();
    for (const row of siblingCheckpoints) {
      const list = checkpointsByTrip.get(row.tripId) ?? [];
      list.push(row);
      checkpointsByTrip.set(row.tripId, list);
    }

    let updated = 0;
    let skipped = 0;
    for (const sibling of siblings) {
      if (source.capacity < sibling.booked) {
        skipped += 1;
        continue;
      }
      const recordedDiveCount = maxRecordedDiveNumber(checkpointsByTrip.get(sibling.id) ?? []);
      if (source.plannedDives < recordedDiveCount) {
        skipped += 1;
        continue;
      }
      await tx
        .update(trips)
        .set({
          title: source.title,
          description: source.description,
          capacity: source.capacity,
          plannedDives: source.plannedDives,
          priceCents: source.priceCents,
          depositCents: source.depositCents,
          cancellationWindowHours: source.cancellationWindowHours,
          diveSiteId: source.diveSiteId,
        })
        .where(and(eq(trips.id, sibling.id), eq(trips.shopId, shopId)));
      await replaceTripDives(tx, sibling.id, drafts);
      updated += 1;
    }
    return { updated, skipped };
  });
}
