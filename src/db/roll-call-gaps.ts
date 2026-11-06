/**
 * **The open head counts** (DOM-H3): which departures still have somebody who
 * may be in the water, read from the roll-call events. One reader, so Today,
 * the close-out, the schedule board, the stale-count alert
 * (`src/db/roll-call-alerts.ts`) and the post-trip recap (`src/db/recap.ts`)
 * ask the same question and cannot disagree. The words are
 * `src/i18n/today-labels.ts`'s; the codes are `src/lib/roll-call-gaps.ts`.
 *
 * It sits below Today (`src/features/today`) because those substrate callers
 * need it, and nothing in `src/db` may import a feature.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { isTurnedAwayOffBoat, isTurnedAwaySeat, rollCallCheckpoints } from "@/lib/manifests";
import { type DayMark, seenAfter, standingByDay } from "@/lib/roll-call-days";
import type { RollCallGapReason } from "@/lib/roll-call-gaps";
import { inAfterDivePopulation, isAccountedForAfterDive } from "@/lib/roll-call-population";
import { meetingDayWindows, rollCallDayOf, rollCallDayStarts } from "@/lib/trip-days";
import { hasReturned } from "@/lib/trips";
import type { AppDb } from "./client";
import { oldestMarkFirst } from "./roll-call-order";
import { crewMarks, markBookingId, markCrewPersonId, seatMarks } from "./roll-call-subject";
import {
  bookings,
  courses,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { seatNotCancelled } from "./trips";
import { liveTrip } from "./trips-live";

/**
 * How long an unclosed head count is still *dock work* (DOM-H3). Two days: long
 * enough that a boat which tied up late last night is still chased through the
 * next morning's shift — the case that matters — and short enough that the
 * queue stays a list of work someone can still do.
 */
export const RETURNED_ROLL_CALL_LOOKBACK_MS = 48 * HOUR_MS;

/**
 * How long an after-dive count that was *never closed* keeps saying so, at a
 * lower urgency, after it stops being dock work.
 *
 * Past `RETURNED_ROLL_CALL_LOOKBACK_MS` this used to age to **nothing**: at
 * hour 49 the row left Today and the schedule board with nothing anywhere
 * recording that a count was never closed. The old docstring called that fine
 * because "the trip's own manifest is where it gets reconstructed" — which only
 * works if somebody knows to look, and the only thing that would have told them
 * had just vanished. A missing-diver signal that self-clears is not a signal,
 * so it degrades instead: `stale` rows keep the same evidence, drop a urgency
 * band, and say plainly that the count was never closed.
 *
 * Only the two *after-dive* reasons age this way. An unfinished dock count and
 * a trip with no roll call at all are paperwork; carrying those for a month
 * would bury the rows that mean a person may be in the water, which is the
 * failure mode this whole change exists to remove.
 */
export const ROLL_CALL_RESIDUE_MS = 30 * 24 * HOUR_MS;

/**
 * One trip's unclosed head count, as codes and numbers — `src/i18n/today-labels.ts`
 * picks the words. Named `OpenRollCall` still because the schedule board reads
 * the same shape.
 */
export type OpenRollCall = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  priceCents: number | null;
  reason: RollCallGapReason;
  /**
   * 1-based dive number of the after-dive checkpoint this is about, or `0` when
   * the gap is at departure (`departure_uncounted`) or trip-wide (`no_roll_call`).
   */
  diveNumber: number;
  /**
   * People not accounted for at that checkpoint — awaiting *or* not back
   * aboard. Divers for a diver reason, crew for a crew one (`reason` says
   * which); the two are never summed into one row, because "2 unaccounted for"
   * that could mean either is exactly the wording that stops being read.
   */
  uncounted: number;
  /**
   * Of the people at that checkpoint, how many have no result yet: nobody has
   * recorded them missing or back aboard. Beside `uncounted` because a
   * missing row's `uncounted` is only the people recorded not back aboard,
   * and the stale-roll-call alert says both numbers (EAP review on H-20261014-stale-roll-call-recipients).
   */
  awaiting: number;
  /** How many people that checkpoint was counting (see `inAfterDivePopulation`). */
  total: number;
  /**
   * The trip's non-cancelled booking count, whatever this gap is about. The
   * schedule board renders a returned-with-an-open-count boat as an ordinary
   * departure card, and that card's "booked" figure is a fact about the trip —
   * not about whichever half of the head count happens to be open.
   */
  rosterSize: number;
  /**
   * Which meeting day of the departure this count is about (#2557), from 1;
   * `startsAt`/`endsAt` are that day's window. A one-day trip is always 1.
   */
  dayNumber?: number;
  /** The boat is still out: that day's `startsAt <= now`, not yet `hasReturned`. */
  underway: boolean;
  /** Older than the dock-work window — kept as residue rather than vanishing. */
  stale: boolean;
  /**
   * When the owners were alerted that this departure's count was still open
   * after the boat was due back (batch 6, item 6; src/db/roll-call-alerts.ts),
   * or null. Optional so a gap assembled by hand says nothing about it.
   */
  alertedAt?: Date | null;
  /**
   * When the shop's shore contact was sent the same alert (H-20261014-stale-roll-call-recipients,
   * `trips.roll_call_shore_alerted_at`), or null. Optional for the same reason.
   */
  shoreAlertedAt?: Date | null;
  /**
   * The latest after-dive checkpoint with any standing result on the trip,
   * diver or crew, `0` when none. The close-out softens an open count only
   * when it is this one (dive-domain review of 56ba7c1, auditor F2). Optional
   * so a gap assembled by hand says nothing, and nothing softens.
   */
  latestMarkedDive?: number;
  /**
   * When the newest standing result at `latestMarkedDive` was taken, diver or
   * crew, or null when there is none. The close-out softens an open count only
   * while this is recent (issue #2925). Optional for the same reason.
   */
  latestMarkAt?: Date | null;
  /**
   * Each person with no result at an after-dive checkpoint somebody started
   * (diver or crew counted there), mapped to the first such dive number (issue
   * #3895): by booking on a diver row, by person on a crew row. Not anyone
   * recorded not back aboard: they are named as missing. The departure record
   * names these apart from Sailed, and Home stores how many there were.
   */
  notCountedAfterDive?: ReadonlyMap<string, number>;
};

/**
 * `not_boarded` means two opposite things depending on where it is recorded,
 * and conflating them is what silenced this alarm with the exact input that
 * should have raised it (DOM-H3):
 *
 * - at `departure` it means **never left the dock**. Benign, genuinely
 *   accounted for, and correctly true of every later checkpoint too.
 * - at `after_dive_n` it means **did not return to the boat**. That *is* the
 *   missing-diver event. The DM who taps the only control that isn't "Boarded"
 *   is saying "not back yet, check again", and the checkpoint must open, not
 *   close.
 *
 * So this module does not ask `carryForwardNotBoarded` (src/lib/roll-call.ts,
 * re-exported from src/lib/manifests.ts) what a diver's effective state is —
 * that helper carries *any* `not_boarded` forward as an accounted-for record,
 * which closes every later checkpoint too. The rule here is the boring one
 * instead: **at an after-dive checkpoint a diver is accounted for only if their
 * latest live result there is `boarded`.** Departure carry-forward then needs no
 * special case at all, because a diver left ashore never enters the after-dive
 * population below.
 *
 * **A second reader now mirrors this pair, so keep them saying one thing.** The
 * counter's no-show refusal asks `onTheWaterByRollCall` (src/db/manifests.ts)
 * whether the crew's roll call puts a diver on the water, and it is this
 * asymmetry read the other way round: the population counted at risk here is
 * the population the desk may not call absent. Widen who is at risk and that
 * gate must widen with it.
 *
 * **Who an after-dive count is counting.** Not everyone who bought a seat.
 *
 * Crews tap "Boarded" for the people standing in front of them and never touch
 * the two who didn't show; there is no bulk action, and the one act that does
 * write a walk-away down — the counter's no-show mark (`markBookingNoShow`,
 * src/db/no-show.ts, issue #1209) — writes `bookings.status` and an activity
 * line, never a `roll_call_events` row. So a walk-away reaches this count the
 * same way whether or not the desk released their seat: no result at any
 * checkpoint. Counting walk-aways as uncounted after every dive raised a
 * danger-toned row on most real trips, and a red row that fires on most trips
 * is read by nobody within a fortnight — at which point the row that means a
 * diver is in the water stops working too.
 *
 * The population at risk in the water is therefore the people who actually
 * boarded: `boarded` at departure, plus anyone explicitly recorded at an
 * after-dive checkpoint later (a diver who joined at the second site, or one
 * the crew counted without a dock result). A diver with no departure result at
 * all is a *departure*-count problem and gets its own, quieter row.
 *
 * Both rules are `isAccountedForAfterDive` and `inAfterDivePopulation` in
 * `src/lib/roll-call-population.ts`, imported here rather than copied, so the
 * Today queue and every other head count read one predicate.
 */

/**
 * Every trip whose head count is not closed — the number that says whether
 * anybody is still in the water (DOM-H3).
 *
 * **This is the one reader here that looks backwards, on purpose.** Every other
 * signal on this page hangs off `pagedUpcomingTripsWithCounts`, which only ever
 * returns trips whose `startsAt` is still ahead of `now`; a boat that sailed at
 * 07:00 has already fallen out of it by 07:01, and one that tied up late last
 * night was never in it at all. So this runs its own query over `endsAt`.
 *
 * Bounds: the time window *is* the bound. There is deliberately no row cap.
 * The old one (`limit(20)` over `asc(endsAt)`) applied before any openness test
 * ran, so a four-boat operation with two dozen trips in the window kept the
 * twenty oldest — mostly already closed — and silently dropped the 16:30 boat
 * that had just tied up with an open count. A cap that can hide exactly the
 * newest open count is worse than the scan it saves, and AGENTS.md forbids a
 * silent one. `desc(endsAt)` on top of that, so the freshest boat is examined
 * first whatever else changes.
 *
 * **Crew are counted here too** (ADR 20260803-per-person-crew-roll-call). The
 * per-person crew half used to reach this function not at all: a crew member
 * tapped "not back aboard" against a divemaster, the manifest went red with
 * `crew_not_back_aboard` — "the loudest thing on this list" — and Today showed
 * nothing, the board badged nothing, and none of the 48-hour dock-work chase or
 * the 30-day residue a *diver* gets applied to the people most reliably in the
 * water (review 20260803, D1). Crew rows are built by the same rules, in the
 * same pass, and age on the same schedule; only the words differ.
 *
 * "Not closed" is defined the same way the manifest defines it, except for the
 * `not_boarded` split above:
 *
 * - the roster is the manifest's roster — every booking that is not cancelled;
 * - a diver's result at a checkpoint is their *latest* event there, and a
 *   latest `cleared` is an undo that returns them to awaiting
 *   (`listLatestRollCallsByCheckpoint`, src/db/manifests.ts);
 * - a trip still underway raises only a checkpoint that was **started and
 *   abandoned** (at least one result and at least one diver still awaiting).
 *   A four-hour two-tank runs dive one's count about ninety minutes in; if the
 *   DM counts nine of twelve and gets pulled away, the boat is still on the
 *   mooring and the three are still findable. Waiting for `endsAt` costs three
 *   hours. Zero events while underway stays quiet — that checkpoint has not
 *   happened yet.
 *
 * **A departure with several meeting days is counted day by day** (#2557, ADR
 * 20261104-roll-call-by-meeting-day). A checkpoint is keyed per booking, not
 * per day, so each result belongs to the meeting day it was taken on
 * (`rollCallDayOf`), and each day that has begun is a head count of its own:
 * underway inside that day's window and its return hour, home after, stale
 * 48 hours after that day ended. Day one's "back aboard" never closes day
 * two's count, and between a course's two Saturdays nobody is on the water.
 * A person recorded on a later day (any `boarded`) is not missing from an
 * earlier one. The trip still gets at most one diver row, one crew row and
 * one dock row **per begun meeting day** (#2557 review M1), newest day first,
 * so an old "not back" never hides a later day's open count; `oneRowPerHalf`
 * folds them for a reader drawn per departure. A later day's `cleared` that
 * names an earlier day's "not back" takes it back (`standingByDay`). A one-day trip is one day
 * over its whole record, exactly as before.
 *
 * **`historical`: the record of named boats, not Today's queue** (issue
 * #2662; review dom-w4-dock B1). The thirty-day residue and the 48-hour dock
 * chase are about what *Today* should still raise; a past day's page asks
 * whether its boats' counts were ever closed, and must never read "All home"
 * because a gap aged out of the queue. In this mode both windows are off,
 * `home` is each trip's own `endsAt` against `now`, and `onlyTripIds` is
 * required, so the scan stays bounded by the boats asked about.
 */
export async function listRollCallGaps(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
  onlyTripIds?: readonly string[],
  options: { historical?: boolean } = {},
): Promise<OpenRollCall[]> {
  if (onlyTripIds?.length === 0) return [];
  const historical = options.historical === true;
  if (historical && !onlyTripIds) return [];
  const sailed = await db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      capacity: trips.capacity,
      priceCents: trips.priceCents,
      isRehearsal: trips.isRehearsal,
      course: {
        title: courses.title,
        priceCents: courses.priceCents,
        eLearningPriceCents: courses.eLearningPriceCents,
      },
      plannedDives: trips.plannedDives,
      alertedAt: trips.rollCallAlertedAt,
      shoreAlertedAt: trips.rollCallShoreAlertedAt,
      // The run's meeting days in the same statement (#2557): the shop home
      // asks this reader twice and pays nothing extra for the days.
      meetingDays: sql<{ startsAt: string; endsAt: string }[] | null>`(
        select json_agg(json_build_object('startsAt', d.starts_at, 'endsAt', d.ends_at))
        from ${tripScheduleDays} d
        where d.trip_id = ${trips.id}
      )`,
    })
    .from(trips)
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, trips.shopId)))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        // A cancelled trip never sailed, so it has nobody to count back.
        eq(trips.status, "scheduled"),
        // Underway or home; a boat that has not left the dock has no count due.
        lte(trips.startsAt, now),
        ...(historical ? [] : [gte(trips.endsAt, new Date(now.getTime() - ROLL_CALL_RESIDUE_MS))]),
        ...(onlyTripIds ? [inArray(trips.id, [...onlyTripIds])] : []),
      ),
    )
    .orderBy(desc(trips.endsAt));
  if (sailed.length === 0) return [];
  const tripIds = sailed.map((trip) => trip.id);

  const [roster, events, crewEvents] = await Promise.all([
    db
      .select({
        tripId: bookings.tripId,
        bookingId: bookings.id,
        status: bookings.status,
        turnedAwayAt: bookings.turnedAwayAt,
      })
      .from(bookings)
      .where(and(eq(bookings.shopId, shopId), inArray(bookings.tripId, tripIds), seatNotCancelled)),
    db
      .select({
        bookingId: markBookingId(),
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
        id: rollCallEvents.id,
        retracts: rollCallEvents.retractsEventId,
      })
      .from(rollCallEvents)
      // Same guard `boardedCountsByTrip` applies: a booking cancelled after the
      // boat left keeps its event rows, and they must not answer for a roster
      // it is no longer on.
      .innerJoin(bookings, and(eq(bookings.id, rollCallEvents.bookingId), seatNotCancelled))
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          seatMarks(),
          inArray(rollCallEvents.tripId, tripIds),
        ),
      )
      // `seq` is the final key for the same reason `src/db/manifests.ts` gives:
      // `created_at` is transaction time, so a batched write inside one
      // transaction leaves the order arbitrary — and Today's missing-diver row
      // and the manifest must never disagree about who is still in the water.
      .orderBy(...oldestMarkFirst()),
    db
      .select({
        tripId: rollCallEvents.tripId,
        personId: markCrewPersonId(),
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
        id: rollCallEvents.id,
        retracts: rollCallEvents.retractsEventId,
      })
      .from(rollCallEvents)
      // The crew counterpart of the cancelled-booking guard above: a person
      // taken off the roster keeps their event rows, and they must not answer
      // for a crew list they are no longer on. (`changeTripCrew` refuses to
      // remove somebody who has roll-call history, so this is belt-and-braces
      // — but a head count is where belt-and-braces belongs.)
      .innerJoin(
        tripAssignments,
        and(
          eq(tripAssignments.tripId, rollCallEvents.tripId),
          eq(tripAssignments.personId, rollCallEvents.crewPersonId),
        ),
      )
      .where(
        and(
          eq(rollCallEvents.shopId, shopId),
          crewMarks(),
          inArray(rollCallEvents.tripId, tripIds),
        ),
      )
      .orderBy(...oldestMarkFirst()),
  ]);

  // Seats the desk turned away: off the boat at any checkpoint nobody at the
  // boat has recorded them at (`isTurnedAwayOffBoat`, issue #2907).
  const turnedAwayIds = new Set(
    roster.filter((row) => isTurnedAwaySeat(row)).map((row) => row.bookingId),
  );
  const rosterByTrip = new Map<string, string[]>();
  for (const row of roster) {
    const list = rosterByTrip.get(row.tripId) ?? [];
    list.push(row.bookingId);
    rosterByTrip.set(row.tripId, list);
  }

  // Which meeting day each result belongs to (#2557): checkpoints are keyed
  // per booking, not per day, so a course's day one would otherwise answer for
  // its day two. A trip with one day reads exactly as before.
  const daysByTrip = new Map(
    sailed.map(
      (trip) =>
        [
          trip.id,
          meetingDayWindows(
            trip,
            (trip.meetingDays ?? []).map((day) => ({
              startsAt: new Date(day.startsAt),
              endsAt: new Date(day.endsAt),
            })),
          ),
        ] as const,
    ),
  );
  const dayStartsByTrip = new Map(
    [...daysByTrip].map(([tripId, days]) => [tripId, rollCallDayStarts(days)] as const),
  );
  const tripOfBooking = new Map(roster.map((row) => [row.bookingId, row.tripId] as const));
  const dayOf = (tripId: string | undefined, at: Date) =>
    rollCallDayOf((tripId && dayStartsByTrip.get(tripId)) || [], at);

  // Each trip's results filed by meeting day, oldest first, folded by the one
  // rule every roll-call reader shares (`standingByDay`, src/lib/roll-call-days.ts):
  // the newest word per person, checkpoint and day stands, and a later day's
  // `cleared` that names an earlier day's "not back" takes it back.
  type DiverMark = (typeof events)[number] & DayMark;
  type CrewMark = (typeof crewEvents)[number] & DayMark;
  const diverMarksByTrip = new Map<string, DiverMark[]>();
  for (const event of events) {
    const tripId = tripOfBooking.get(event.bookingId);
    if (!tripId) continue;
    const marks = diverMarksByTrip.get(tripId) ?? [];
    marks.push({ ...event, subject: event.bookingId, day: dayOf(tripId, event.occurredAt) });
    diverMarksByTrip.set(tripId, marks);
  }

  // The crew half, filed the same way. The crew "roster" for a trip is whoever
  // has a result on it: a shop that has never tapped a crew roll call has no
  // crew subjects here, so it raises no crew rows at all rather than a red row
  // on every trip it ever ran.
  const crewByTripId = new Map<string, Set<string>>();
  const crewMarksByTrip = new Map<string, CrewMark[]>();
  for (const event of crewEvents) {
    const marks = crewMarksByTrip.get(event.tripId) ?? [];
    marks.push({ ...event, subject: event.personId, day: dayOf(event.tripId, event.occurredAt) });
    crewMarksByTrip.set(event.tripId, marks);
    const people = crewByTripId.get(event.tripId) ?? new Set<string>();
    people.add(event.personId);
    crewByTripId.set(event.tripId, people);
  }

  const gaps: OpenRollCall[] = [];
  for (const trip of sailed) {
    const bookingIds = rosterByTrip.get(trip.id) ?? [];
    const crewIds = [...(crewByTripId.get(trip.id) ?? [])];
    // An empty boat has nobody to count, exactly as the manifest's own
    // "complete" rule requires a `totalDivers > 0` before it says so — but a
    // crew member somebody recorded as not back aboard is a person to count
    // whether or not anybody bought a seat, so a crewed trip with no divers
    // still reaches the crew scan below.
    if (bookingIds.length === 0 && crewIds.length === 0) continue;
    const checkpoints = rollCallCheckpoints(trip.plannedDives);
    const days = daysByTrip.get(trip.id) ?? [];
    const dayStarts = dayStartsByTrip.get(trip.id) ?? [];
    const diverStanding = standingByDay(diverMarksByTrip.get(trip.id) ?? []);
    const crewStanding = standingByDay(crewMarksByTrip.get(trip.id) ?? []);
    const stateOf = (
      event: { status: "boarded" | "not_boarded" | "cleared" } | undefined,
    ): "boarded" | "not_boarded" | undefined =>
      // A latest `cleared` is staff undoing a mistake: the person reads as
      // awaiting again, so it must re-alarm rather than stay resolved. Only the
      // state decides a head count; the recorder's name and note are the
      // manifest's display fields, so they are deliberately not queried.
      !event || event.status === "cleared" ? undefined : event.status;
    // **Dives numbered on across the run.** A later day whose first result is
    // at a later checkpoint (a weekend course logging dives 3 and 4 on day
    // two) carries on the earlier days' numbering: the checkpoints below it
    // read the earlier days' results, not an empty count. A day whose results
    // start at the dock, or that has none yet, counts every checkpoint afresh.
    const firstCheckpointOf = (day: number) => {
      if (day === 0) return 0;
      let first = Number.POSITIVE_INFINITY;
      for (const standing of [diverStanding.get(day), crewStanding.get(day)]) {
        for (const mark of standing?.values() ?? []) {
          const index = (checkpoints as readonly string[]).indexOf(mark.checkpoint);
          if (index >= 0 && index < first) first = index;
        }
      }
      return Number.isFinite(first) ? first : 0;
    };
    const statesOf =
      (standing: typeof diverStanding | typeof crewStanding) => (day: number, subject: string) => {
        const first = firstCheckpointOf(day);
        return checkpoints.map((checkpoint, index) => {
          const key = `${subject}\u0000${checkpoint}`;
          if (index >= first) return stateOf(standing.get(day)?.get(key));
          for (let earlier = day - 1; earlier >= 0; earlier--) {
            const mark = standing.get(earlier)?.get(key);
            if (mark) return stateOf(mark);
          }
          return undefined;
        });
      };
    const diverStates = statesOf(diverStanding);
    const crewStates = statesOf(crewStanding);

    // Every meeting day that has begun, newest first: its window has opened,
    // or its roll-call boundary has passed and somebody was counted on it (a
    // boat that left before the hours on file still raises a "not back" at
    // once). A day that only ended longer ago than the residue window is
    // history, not Today's.
    const begun = days
      .map((window, index) => ({ window, index }))
      .filter(
        ({ window, index }) =>
          (window.startsAt.getTime() <= now.getTime() ||
            ((dayStarts[index] ?? Number.POSITIVE_INFINITY) <= now.getTime() &&
              ((diverStanding.get(index)?.size ?? 0) > 0 ||
                (crewStanding.get(index)?.size ?? 0) > 0))) &&
          (historical || window.endsAt.getTime() >= now.getTime() - ROLL_CALL_RESIDUE_MS),
      )
      .reverse();
    // **One head count per meeting day** (#2557 review M1): each begun day
    // puts out its own rows, newest day first, so a first-Saturday "not back"
    // never takes the place of the second Saturday's open count on Today, the
    // board or the stale alert. A one-day trip has one day, as before.
    for (const { window, index: day } of begun) {
      const found = dayGaps({
        trip,
        window,
        dayNumber: day + 1,
        now,
        historical,
        checkpoints,
        bookingIds,
        crewIds,
        turnedAwayIds,
        diverStates: (bookingId) => diverStates(day, bookingId),
        crewStates: (personId) => crewStates(day, personId),
        // Somebody counted back aboard on a later meeting day is not lost
        // from an earlier one: they stood on the dock since.
        diverSeenLater: (bookingId) => seenAfter(diverStanding, bookingId, day),
        crewSeenLater: (personId) => seenAfter(crewStanding, personId, day),
        latestEventAt: (checkpoint) => {
          let latest: Date | null = null;
          for (const standing of [diverStanding.get(day), crewStanding.get(day)]) {
            for (const event of standing?.values() ?? []) {
              if (event.checkpoint !== checkpoint || event.status === "cleared") continue;
              if (!latest || event.occurredAt > latest) latest = event.occurredAt;
            }
          }
          return latest;
        },
      });
      for (const row of [found.diver, found.crew, found.dock]) if (row) gaps.push(row);
    }
  }
  return gaps;
}

/**
 * **One row per half per departure**, for a reader drawn per departure rather
 * than per meeting day (the day's close-out, which subtracts one gap per
 * station): a stated missing person on any day first, newest day first, then
 * the newest day's open count; the newest day's dock row. A one-day trip's
 * rows pass through unchanged.
 */
export function oneRowPerHalf<G extends Pick<OpenRollCall, "tripId" | "reason" | "dayNumber">>(
  gaps: readonly G[],
): G[] {
  const half = (reason: G["reason"]) =>
    reason === "missing_diver" || reason === "after_dive_uncounted"
      ? "diver"
      : reason === "missing_crew" || reason === "crew_uncounted"
        ? "crew"
        : "dock";
  const kept = new Map<string, G>();
  for (const gap of gaps) {
    const key = `${gap.tripId}\u0000${half(gap.reason)}`;
    const current = kept.get(key);
    const missing = (row: G) => row.reason === "missing_diver" || row.reason === "missing_crew";
    const newer = (gap.dayNumber ?? 1) > (current?.dayNumber ?? 1);
    if (
      !current ||
      (missing(gap) && !missing(current)) ||
      (missing(gap) === missing(current) && newer)
    ) {
      kept.set(key, gap);
    }
  }
  return gaps.filter((gap) => [...kept.values()].includes(gap));
}

/**
 * One meeting day's head count, by the rules in {@link listRollCallGaps}'s
 * docblock: at most one diver row (a stated missing diver on any dive, else
 * the earliest open dive), one crew row by the same rule, and one dock row.
 * A one-day trip is one call of this over its whole record.
 */
function dayGaps(input: {
  trip: {
    id: string;
    title: string;
    capacity: number;
    isRehearsal: boolean;
    priceCents: number | null;
    course: Parameters<typeof perDiverBookingPriceCents>[1];
    alertedAt: Date | null;
    shoreAlertedAt: Date | null;
  };
  window: { startsAt: Date; endsAt: Date };
  dayNumber: number;
  now: Date;
  historical: boolean;
  checkpoints: readonly string[];
  bookingIds: readonly string[];
  crewIds: readonly string[];
  turnedAwayIds: ReadonlySet<string>;
  diverStates: (bookingId: string) => ("boarded" | "not_boarded" | undefined)[];
  crewStates: (personId: string) => ("boarded" | "not_boarded" | undefined)[];
  diverSeenLater: (bookingId: string) => boolean;
  crewSeenLater: (personId: string) => boolean;
  latestEventAt: (checkpoint: string) => Date | null;
}): { diver?: OpenRollCall; crew?: OpenRollCall; dock?: OpenRollCall } {
  const { trip, window, now, historical, checkpoints, bookingIds, crewIds } = input;
  const home = hasReturned(window.endsAt, now);
  const underway = !home;
  const stale =
    !historical && home && window.endsAt.getTime() < now.getTime() - RETURNED_ROLL_CALL_LOOKBACK_MS;

  // Per after-dive checkpoint index (index 0 is `departure` and stays 0):
  const population = checkpoints.map(() => 0);
  const recorded = checkpoints.map(() => 0);
  const unaccounted = checkpoints.map(() => 0);
  const notBackAboard = checkpoints.map(() => 0);
  // The crew half, scanned into its own arrays by the identical rules — one
  // pass, one set of predicates, so the two can never drift into disagreeing
  // about what "accounted for after a dive" means.
  const crewPopulation = checkpoints.map(() => 0);
  const crewRecorded = checkpoints.map(() => 0);
  const crewUnaccounted = checkpoints.map(() => 0);
  const crewNotBackAboard = checkpoints.map(() => 0);
  let departureAwaiting = 0;
  // Each seat with no result at an after-dive checkpoint, by booking, mapped
  // to that dive; kept to checkpoints someone started once the scan is done.
  const awaitingAt = new Map<string, number[]>();
  const crewAwaitingAt = new Map<string, number[]>();
  // Seats turned away at the desk with no dock result: not the dock count's.
  let dockOffBoat = 0;
  let anyEvent = false;

  for (const bookingId of bookingIds) {
    const states = input.diverStates(bookingId);
    if (states.some((state) => state !== undefined)) anyEvent = true;
    if (
      isTurnedAwayOffBoat({ turnedAway: input.turnedAwayIds.has(bookingId), rollCall: states[0] })
    ) {
      dockOffBoat += 1;
    } else if (states[0] === undefined) departureAwaiting += 1;
    if (!inAfterDivePopulation(states)) continue;
    const seenLater = input.diverSeenLater(bookingId);
    for (let dive = 1; dive < checkpoints.length; dive++) {
      const state = states[dive];
      population[dive] = (population[dive] ?? 0) + 1;
      if (state !== undefined) recorded[dive] = (recorded[dive] ?? 0) + 1;
      if (isAccountedForAfterDive(state) || seenLater) continue;
      // The latest checkpoint speaks (issue #2404): "not back" after dive 1
      // is settled by "back aboard" after a later dive, the rule
      // `listUnaccountedForByTrip` and `homewardCheckpointGap` keep.
      if (state === "not_boarded" && states.slice(dive + 1).includes("boarded")) continue;
      unaccounted[dive] = (unaccounted[dive] ?? 0) + 1;
      if (state === "not_boarded") notBackAboard[dive] = (notBackAboard[dive] ?? 0) + 1;
      // Counted back aboard after a later dive: they are back, and the record
      // has nothing to say about them.
      else if (!states.slice(dive + 1).includes("boarded")) {
        awaitingAt.set(bookingId, [...(awaitingAt.get(bookingId) ?? []), dive]);
      }
    }
  }

  for (const personId of crewIds) {
    const states = input.crewStates(personId);
    // A crew result is a roll call. A trip whose only head count is of its
    // crew has started one, so it is not a `no_roll_call` trip.
    if (states.some((state) => state !== undefined)) anyEvent = true;
    if (!inAfterDivePopulation(states)) continue;
    const seenLater = input.crewSeenLater(personId);
    // Recorded not back and not counted aboard since: missing, never "not counted".
    const missingCrew = states.some(
      (state, dive) =>
        dive >= 1 && state === "not_boarded" && !states.slice(dive + 1).includes("boarded"),
    );
    for (let dive = 1; dive < checkpoints.length; dive++) {
      const state = states[dive];
      crewPopulation[dive] = (crewPopulation[dive] ?? 0) + 1;
      if (state !== undefined) crewRecorded[dive] = (crewRecorded[dive] ?? 0) + 1;
      if (isAccountedForAfterDive(state) || seenLater) continue;
      // The latest checkpoint speaks for crew as it does for divers above: a
      // divemaster "not back" after dive 1 and counted aboard after dive 2
      // is back (dock review S2 of #3884).
      if (state === "not_boarded" && states.slice(dive + 1).includes("boarded")) continue;
      crewUnaccounted[dive] = (crewUnaccounted[dive] ?? 0) + 1;
      if (state === "not_boarded") crewNotBackAboard[dive] = (crewNotBackAboard[dive] ?? 0) + 1;
      // Named on the record as a diver is (dock review S1 of #3896).
      else if (!missingCrew && !states.slice(dive + 1).includes("boarded")) {
        crewAwaitingAt.set(personId, [...(crewAwaitingAt.get(personId) ?? []), dive]);
      }
    }
  }

  let latestMarkedDive = 0;
  for (let dive = 1; dive < checkpoints.length; dive++) {
    if ((recorded[dive] ?? 0) > 0 || (crewRecorded[dive] ?? 0) > 0) latestMarkedDive = dive;
  }
  // The newest standing result at that checkpoint: how recently anybody was
  // counted there, which tells a count being taken from one left half done.
  const latestMarkAt =
    latestMarkedDive > 0 ? input.latestEventAt(checkpoints[latestMarkedDive] as string) : null;

  // An owners' alert is only due once a day ends: one sent before this day
  // ended was about an earlier day (#2557 review).
  const sinceDay = (at: Date | null) => (at && at >= window.endsAt ? at : null);
  const base = {
    tripId: trip.id,
    title: trip.title,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    dayNumber: input.dayNumber,
    capacity: trip.capacity,
    priceCents: trip.isRehearsal ? null : perDiverBookingPriceCents(trip, trip.course),
    rosterSize: bookingIds.length,
    underway,
    stale,
    alertedAt: sinceDay(trip.alertedAt),
    shoreAlertedAt: sinceDay(trip.shoreAlertedAt),
    latestMarkedDive,
    latestMarkAt,
  };
  const found: { diver?: OpenRollCall; crew?: OpenRollCall; dock?: OpenRollCall } = {};

  // The first started checkpoint each awaiting seat has no result at (#3895).
  const firstStarted = (awaiting: ReadonlyMap<string, number[]>) => {
    const firsts = new Map<string, number>();
    for (const [id, dives] of awaiting) {
      const started = dives.find((dive) => (recorded[dive] ?? 0) + (crewRecorded[dive] ?? 0) > 0);
      if (started !== undefined) firsts.set(id, started);
    }
    return firsts;
  };
  const notCountedAfterDive = firstStarted(awaitingAt);
  const crewNotCountedAfterDive = firstStarted(crewAwaitingAt);

  // A human said a diver did not come back. That outranks every other gap on
  // this boat wherever it sits, so it is searched across all dives first — a
  // per-dive "first problem wins" scan would hide a dive-two missing diver
  // behind a dive-one clerical gap.
  const missingDive = checkpoints.findIndex(
    (_, dive) => dive >= 1 && (notBackAboard[dive] ?? 0) > 0,
  );
  // Index 0 is `departure`; the after-dive checkpoints start at 1 and their
  // index *is* their dive number.
  const openDive = checkpoints.findIndex(
    (_, dive) =>
      dive >= 1 &&
      (unaccounted[dive] ?? 0) > 0 &&
      // Underway: only a checkpoint someone started and abandoned.
      (home || (recorded[dive] ?? 0) > 0),
  );
  if (missingDive >= 1) {
    found.diver = {
      ...base,
      reason: "missing_diver",
      diveNumber: missingDive,
      uncounted: notBackAboard[missingDive] ?? 0,
      awaiting: (unaccounted[missingDive] ?? 0) - (notBackAboard[missingDive] ?? 0),
      total: population[missingDive] ?? 0,
      notCountedAfterDive,
    };
  } else if (openDive >= 1) {
    found.diver = {
      ...base,
      reason: "after_dive_uncounted",
      diveNumber: openDive,
      uncounted: unaccounted[openDive] ?? 0,
      awaiting: (unaccounted[openDive] ?? 0) - (notBackAboard[openDive] ?? 0),
      total: population[openDive] ?? 0,
      notCountedAfterDive,
    };
  }

  // The crew rows, scanned identically and pushed **beside** the diver row
  // rather than instead of it. A boat can be missing a diver and a divemaster
  // at once, and collapsing that into one row loses the name of one of them.
  const crewMissingDive = checkpoints.findIndex(
    (_, dive) => dive >= 1 && (crewNotBackAboard[dive] ?? 0) > 0,
  );
  const crewOpenDive = checkpoints.findIndex(
    (_, dive) =>
      dive >= 1 && (crewUnaccounted[dive] ?? 0) > 0 && (home || (crewRecorded[dive] ?? 0) > 0),
  );
  if (crewMissingDive >= 1) {
    found.crew = {
      ...base,
      reason: "missing_crew",
      diveNumber: crewMissingDive,
      uncounted: crewNotBackAboard[crewMissingDive] ?? 0,
      awaiting: (crewUnaccounted[crewMissingDive] ?? 0) - (crewNotBackAboard[crewMissingDive] ?? 0),
      total: crewPopulation[crewMissingDive] ?? 0,
      notCountedAfterDive: crewNotCountedAfterDive,
    };
  } else if (crewOpenDive >= 1) {
    found.crew = {
      ...base,
      reason: "crew_uncounted",
      diveNumber: crewOpenDive,
      uncounted: crewUnaccounted[crewOpenDive] ?? 0,
      awaiting: (crewUnaccounted[crewOpenDive] ?? 0) - (crewNotBackAboard[crewOpenDive] ?? 0),
      total: crewPopulation[crewOpenDive] ?? 0,
      notCountedAfterDive: crewNotCountedAfterDive,
    };
  }

  // The dock count. Never while the boat is out (nobody can settle it from
  // ashore) and never once the trip is only residue — it is paperwork, and
  // carrying a month of it would bury the rows above. Divers only: a
  // dock-side crew gap on a shop that has not adopted crew roll call is every
  // trip it has ever run.
  const dockRoster = bookingIds.length - dockOffBoat;
  if (home && !stale && dockRoster > 0) {
    if (!anyEvent) {
      found.dock = {
        ...base,
        reason: "no_roll_call",
        diveNumber: 0,
        uncounted: dockRoster,
        awaiting: dockRoster,
        total: dockRoster,
      };
    } else if (departureAwaiting > 0) {
      found.dock = {
        ...base,
        reason: "departure_uncounted",
        diveNumber: 0,
        uncounted: departureAwaiting,
        awaiting: departureAwaiting,
        total: dockRoster,
      };
    }
  }
  return found;
}

/**
 * **The departures Today is raising a missing-diver or missing-crew row on**,
 * out of the trips asked about — `listRollCallGaps` itself, narrowed to those
 * trips, so a caller that must stay quiet while somebody may be in the water
 * (issue #2123: the post-trip recap) reads the alarm rather than a second
 * opinion of it. Same checkpoints (the trip's planned dives), same window
 * (sailed, and home no longer than `ROLL_CALL_RESIDUE_MS`), same roster rules.
 */
export async function tripsWithSomebodyMissing(
  db: AppDb,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Set<string>> {
  const gaps = await listRollCallGaps(db, shopId, now, tripIds);
  return new Set(
    gaps
      .filter((gap) => gap.reason === "missing_diver" || gap.reason === "missing_crew")
      .map((gap) => gap.tripId),
  );
}

/**
 * The after-dive subset, for the schedule board's per-trip badge — it links
 * straight at `after_dive_${diveNumber}`, so a departure-count or
 * no-roll-call gap has no checkpoint for it to point at. Residue rows are
 * Today's job too: the board is the forward schedule, not the audit trail.
 */
export async function openAfterDiveRollCalls(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<OpenRollCall[]> {
  const gaps = await listRollCallGaps(db, shopId, now);
  return gaps.filter((gap) => gap.diveNumber >= 1 && !gap.stale);
}
