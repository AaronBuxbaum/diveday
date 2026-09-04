import { and, asc, count, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  divemasterRatioGap,
  inWaterDivemasterCount,
} from "@/lib/divemaster-ratio";
import type { StaffGapCode, TripMeeting } from "@/lib/staffing-week";
import type { AppDb } from "./client";
import {
  bookings,
  courses,
  people,
  personRoles,
  staffShifts,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { courseCrewCountsByTrip } from "./today";
import { listStaff } from "./trips";
import { liveTrip } from "./trips-live";

/*
 * `capabilitiesForRoles` used to live here, deriving "Can teach" / "Can crew" /
 * "Captain" from a person's roles so the roster could badge every person with
 * all three. The week says it once instead — a row states the roles it has,
 * which is the same fact one step less derived — and the badges are gone with
 * the derivation, because `Badge` marks the exceptional state rather than
 * decorating every row (ADR 20260827-clearwater-surface-language, decision 3;
 * ADR 20260827-the-shops-shelves, decision 3). Nothing else ever read it.
 */

/**
 * How many of the window's departures still need somebody on the crew — a
 * *count*, and deliberately nothing more.
 *
 * The shift roster used to render its own per-departure coverage table, with
 * its own gap vocabulary (`over_ratio` / `course_needs_instructor`) beside
 * Today's word for the same fact (`instructor_missing`). Two surfaces, two
 * names, one computation, and only Today's could actually assign anyone —
 * the roster's rows dead-ended on a link. What survived that is this summary,
 * composed from the same readers Today's detection runs on
 * (`courseCrewCountsByTrip`, src/db/today.ts + `courseCrewGap`,
 * src/lib/course-ratios.ts + `divemasterRatioGap`,
 * src/lib/divemaster-ratio.ts). There is still no second detector, and still no
 * second set of words: {@link StaffingGapTrip} hands back the very departures
 * this walk counted, in Today's own codes, so the staffing week can put each
 * gap in the day it belongs to with a door into that trip's crew section —
 * which is the thing the retired table could not do
 * (ADR 20260806-staffing-is-the-shift-roster, ADR 20260803-not-ready-is-a-view,
 * ADR 20260827-the-shops-shelves).
 *
 * Advisory throughout: booking-time ratio enforcement stays in
 * `createBookingRecord` (src/db/bookings.ts). Nothing here refuses anything.
 */
export type StaffingCrewGaps = {
  /** Scheduled departures overlapping the window — the summary's denominator. */
  departures: number;
  /**
   * How many of them are short-handed by the one measurement every crew
   * surface shares. See {@link StaffingGapTrip} for what that means and what
   * it deliberately leaves alone.
   */
  needCrew: number;
};

/**
 * A trip a staff member crews, shown in their day cells (task 165).
 *
 * `meetings` rather than one `startsAt`/`endsAt` pair, because
 * `trips.starts_at`/`ends_at` bound the **whole run** of a multi-day
 * departure: a Thursday-to-Saturday course carries one window from Thu 08:00
 * to Sat 17:00, and a week that filed it by `startsAt` alone showed the
 * instructor busy on Thursday and free for the two days they are teaching.
 * The meeting windows are `trip_schedule_days`, the same rows the schedule
 * board's week reads for exactly this reason (`weekBoard`,
 * src/db/trips-queries.ts).
 */
export type StaffCrewingTrip = {
  tripId: string;
  title: string;
  /** Every window this departure meets in, ascending. Never empty. */
  meetings: TripMeeting[];
};

/**
 * A departure `needCrew` counted, handed back rather than only tallied.
 *
 * The count alone was the right answer while the roster had nowhere to put a
 * departure: it dead-ended on a link to Today, so naming the boat added
 * nothing a staffer could act on. The week has a day cell for it — the gap
 * renders where the work is, carrying its own Assign door into that trip's
 * crew section (ADR 20260827-the-shops-shelves, decision 3). Same pass, same
 * detectors, same vocabulary as Today's: `courseCrewGap`'s two codes for a
 * course session, and `divemasterRatioGap`'s `uncrewed_departure` /
 * `crew_below_target` for every departure the shop runs.
 *
 * **Absence of a gap means somebody is in the water with them, not that
 * somebody has a row.** This used to ask whether the departure had any
 * `trip_assignments` row at all, which said the opposite thing twice: a
 * twelve-diver reef charter with a captain rostered and no divemaster drew
 * nothing, while an empty boat nobody has crewed yet drew a warning. Both
 * answers now come from `divemasterRatioGap`, which is where that judgement
 * lives precisely "so the trip page, the Today queue and whatever reads this
 * next must not be able to disagree about whether one departure is short" —
 * so a self-guided departure and a departure with nobody booked are silent
 * here for the same reason they are silent on Today.
 */
export type StaffingGapTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
  gap: StaffGapCode;
  /** Its meeting windows, so the week can place it in a day it actually meets. */
  meetings: TripMeeting[];
};

export type StaffingView = {
  from: Date;
  to: Date;
  staff: {
    person: typeof people.$inferSelect;
    roles: string[];
    shifts: (typeof staffShifts.$inferSelect)[];
    /** Trips in this window this person is on the crew of — a shift with no
     * boat and a boat with no shift are otherwise invisible to each other
     * (Lens 17 task 165). */
    crewingTrips: StaffCrewingTrip[];
  }[];
  /** The summary; see {@link StaffingCrewGaps}. */
  crewGaps: StaffingCrewGaps;
  /**
   * The departures behind `crewGaps.needCrew`, in departure order — the same
   * walk, not a second one. `gapTrips.length === crewGaps.needCrew`, always.
   */
  gapTrips: StaffingGapTrip[];
};

export async function getStaffingView(
  db: AppDb,
  shopId: string,
  from: Date,
  to: Date,
  options: {
    /**
     * The shop's own target (`shops.divers_per_divemaster`). Defaults for the
     * same reason `getTodayWork` defaults it: every pre-existing caller, tests
     * included, keeps working unchanged.
     */
    diversPerDivemaster?: number;
    /** Read through the clock so the frozen e2e instant reaches this too. */
    now?: Date;
  } = {},
): Promise<StaffingView> {
  const diversPerDivemaster = options.diversPerDivemaster ?? DEFAULT_DIVERS_PER_DIVEMASTER;
  const now = options.now ?? nowDate();
  const [staffRows, shiftRows, tripCourseRows, crewRows] = await Promise.all([
    listStaff(db, shopId),
    db
      .select({ shift: staffShifts })
      .from(staffShifts)
      .innerJoin(people, eq(people.id, staffShifts.personId))
      .where(
        and(
          eq(staffShifts.shopId, shopId),
          lt(staffShifts.startsAt, to),
          gt(staffShifts.endsAt, from),
        ),
      )
      .orderBy(asc(staffShifts.startsAt)),
    // Trip + course + booked count, independent of who (if anyone) crews it —
    // `courseCrewGap` needs the course's ratio inputs (agency,
    // minimumCertificationLevel) and the booked count on every trip in the
    // window, not just the ones with a crew gap.
    db
      .select({ trip: trips, course: courses, booked: count(bookings.id) })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
        ),
      )
      .groupBy(trips.id, courses.id)
      .orderBy(asc(trips.startsAt)),
    // Crew assignments, queried separately from the trip/course row above so
    // this join's fan-out never multiplies the booked count computed alongside
    // it. Who is rostered, not what they are qualified for: the ratio inputs
    // come from Today's own reader further down, so this no longer joins
    // `person_roles` at all.
    db
      .select({
        tripId: tripAssignments.tripId,
        personId: people.id,
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
          isNull(people.deletedAt),
        ),
      ),
  ]);

  const shiftsByPerson = new Map<string, (typeof staffShifts.$inferSelect)[]>();
  for (const row of shiftRows) {
    const shifts = shiftsByPerson.get(row.shift.personId) ?? [];
    shifts.push(row.shift);
    shiftsByPerson.set(row.shift.personId, shifts);
  }

  type TripEntry = {
    trip: typeof trips.$inferSelect;
    course: typeof courses.$inferSelect | null;
    booked: number;
    /** Person ids rostered on this trip, in no particular order. */
    crew: Set<string>;
  };
  const tripMap = new Map<string, TripEntry>();
  for (const row of tripCourseRows) {
    tripMap.set(row.trip.id, {
      trip: row.trip,
      course: row.course,
      booked: row.booked,
      crew: new Set(),
    });
  }
  for (const row of crewRows) {
    tripMap.get(row.tripId)?.crew.add(row.personId);
  }

  // When each departure actually meets. `trips.starts_at`/`ends_at` bound the
  // whole run, so a three-day course is one 57-hour window and nothing else
  // here can tell which days of it a person is committed to — the same reason
  // `weekBoard` joins these rows (src/db/trips-queries.ts). A departure with no
  // rows at all meets once, on its own window, which is every ordinary boat.
  const meetingsByTrip = await tripMeetings(db, [...tripMap.keys()]);
  const meetingsFor = (trip: typeof trips.$inferSelect): TripMeeting[] =>
    meetingsByTrip.get(trip.id) ?? [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];

  const crewingByPerson = new Map<string, StaffCrewingTrip[]>();
  for (const entry of tripMap.values()) {
    for (const personId of entry.crew) {
      const trips = crewingByPerson.get(personId) ?? [];
      trips.push({
        tripId: entry.trip.id,
        title: entry.trip.title,
        meetings: meetingsFor(entry.trip),
      });
      crewingByPerson.set(personId, trips);
    }
  }
  for (const trips of crewingByPerson.values()) {
    trips.sort(
      (a, b) => (a.meetings[0]?.startsAt.getTime() ?? 0) - (b.meetings[0]?.startsAt.getTime() ?? 0),
    );
  }

  const staff = staffRows.map((entry) => ({
    ...entry,
    shifts: shiftsByPerson.get(entry.person.id) ?? [],
    crewingTrips: crewingByPerson.get(entry.person.id) ?? [],
  }));

  // Today's own reader, not a second one: `courseCrewCountsByTrip`
  // (src/db/today.ts) is what `instructor_missing` is computed from, and it
  // counts in-water crew by the one definition every ratio gate shares
  // (`countInWaterCrew`, src/lib/crew-roles.ts) — a divemaster rostered as
  // this trip's captain is not their own assistant here either.
  const crewCounts = await courseCrewCountsByTrip(db, shopId, [...tripMap.keys()]);
  // A departure already home is nobody's morning. The week deliberately shows
  // up to six days behind the shop's own today, and `trip_status` is only
  // `scheduled`/`cancelled` — a boat that sailed on Monday is still
  // `scheduled` on Friday — so without this the loudest thing on a Friday
  // afternoon is a warning asking a manager to crew a boat that came home
  // three days ago: the expected state formatted as an alert, spending the one
  // warning channel this surface has. The hour of slack is the same
  // late-arrival buffer every "has it sailed" question in this repo carries,
  // and the same reading `weekBoard` takes.
  const sailedBefore = new Date(now.getTime() - HOUR_MS);
  // One walk, two answers: the count the summary reads and the departures the
  // week places in their own day cells. They cannot disagree, because the
  // count *is* the list's length.
  const gapTrips: StaffingGapTrip[] = [];
  for (const entry of tripMap.values()) {
    if (entry.trip.endsAt < sailedBefore) continue;
    const counts = crewCounts.get(entry.trip.id) ?? { instructorCount: 0, assistantCount: 0 };
    // The agency training ratio first, exactly as Today orders them: a course
    // session missing its instructor is the more precise fact, and firing the
    // shop's own target underneath it would name one gap in two vocabularies.
    const courseGap = courseCrewGap({
      course: entry.course,
      instructorCount: counts.instructorCount,
      assistantCount: counts.assistantCount,
      booked: entry.booked,
    });
    const place = (gap: StaffGapCode) =>
      gapTrips.push({
        tripId: entry.trip.id,
        title: entry.trip.title,
        startsAt: entry.trip.startsAt,
        gap,
        meetings: meetingsFor(entry.trip),
      });
    // Then the shop's own target, which reaches every departure it runs rather
    // than only the courses — and which owns the two exemptions this walk used
    // to miss: a self-guided departure, and one with nobody booked. Computed
    // before the course gap is placed rather than after, because the zero-crew
    // case below outranks it and needs this answer to know whether it applies.
    const ratioGap = divemasterRatioGap({
      divers: entry.booked,
      divemasterCount: inWaterDivemasterCount(counts),
      diversPerDivemaster,
      selfGuided: entry.trip.selfGuided,
    });
    // **Nobody in the water outranks the instructor gap** (issue #1338). A
    // course session with no crew at all satisfies both rules, and issue #732
    // settled that a departure carries one row — but #732's rule is about the
    // *count*, not about which code wins, and the course gap winning outright
    // meant an empty boat read as "Course needs instructor". A staffer takes
    // that to mean a divemaster is already on it. Since #1125 shortened the
    // chip to those three words there is no sentence beside it to correct the
    // inference.
    //
    // `divemasterRatioGap` decides, rather than `inWaterDivemasterCount(counts)
    // === 0` read directly, because the count alone is true of cases where
    // "No crew" would be wrong: a self-guided departure wants no supervisor,
    // and one with nobody booked has no one to supervise. Both still say
    // "Course needs instructor", which is the honest and actionable fact for
    // them — a session with no instructor cannot take an enrolment however
    // empty it is.
    if (ratioGap.code === "under_target" && ratioGap.divemasterCount === 0) {
      place("uncrewed_departure");
      continue;
    }
    if (courseGap.code !== "none") {
      place(courseGap.code);
      continue;
    }
    if (ratioGap.code === "none") continue;
    // Short of the shop's target but not empty — the zero case returned above,
    // so this is Today's quieter of the two words by construction.
    place("crew_below_target");
  }
  gapTrips.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return {
    from,
    to,
    staff,
    crewGaps: { departures: tripMap.size, needCrew: gapTrips.length },
    gapTrips,
  };
}

/**
 * Every departure's meeting windows, keyed by trip — the rows that say a
 * three-day course meets on three mornings rather than running continuously
 * for 57 hours.
 *
 * A trip with no `trip_schedule_days` rows is absent from the map rather than
 * given a synthetic entry: the caller already holds the trip row and its own
 * window is the honest fallback, and inventing one here would hide a trip
 * whose rows were never written.
 */
async function tripMeetings(db: AppDb, tripIds: string[]): Promise<Map<string, TripMeeting[]>> {
  const byTrip = new Map<string, TripMeeting[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: tripScheduleDays.tripId,
      startsAt: tripScheduleDays.startsAt,
      endsAt: tripScheduleDays.endsAt,
    })
    .from(tripScheduleDays)
    .where(inArray(tripScheduleDays.tripId, tripIds))
    .orderBy(asc(tripScheduleDays.tripId), asc(tripScheduleDays.dayNumber));
  for (const row of rows) {
    const windows = byTrip.get(row.tripId) ?? [];
    windows.push({ startsAt: row.startsAt, endsAt: row.endsAt });
    byTrip.set(row.tripId, windows);
  }
  return byTrip;
}

/**
 * Which of a trip's assigned crew (`personIds`) have a staff shift
 * overlapping the trip's own window — the other half of task 165's
 * cross-link, read from the trip's `CrewSection` rather than the staffing
 * page.
 *
 * `null` means the shop has never scheduled a shift at all, so the question
 * does not apply — a different answer from "nobody is covered". Without the
 * distinction, a shop that doesn't use the staffing feature saw a "Not on a
 * shift" warning on every crew member of every trip, forever: the expected
 * state formatted as an alert (design principle 9). The consumer renders no
 * coverage state at all on `null`; the warning is reserved for shops whose
 * own shift schedule says this sailing has a hole in it.
 */
export async function crewShiftCoverage(
  db: AppDb,
  shopId: string,
  trip: { startsAt: Date; endsAt: Date },
  personIds: readonly string[],
): Promise<Set<string> | null> {
  // Existence probe, deliberately unscoped to the trip window: "does this
  // shop schedule shifts" is a fact about the shop, and a week nobody entered
  // shifts for at a shop that does schedule them is exactly when the warning
  // is earned.
  const usesShifts = await db
    .select({ personId: staffShifts.personId })
    .from(staffShifts)
    .where(eq(staffShifts.shopId, shopId))
    .limit(1);
  if (usesShifts.length === 0) return null;
  if (personIds.length === 0) return new Set();
  const rows = await db
    .select({ personId: staffShifts.personId })
    .from(staffShifts)
    .where(
      and(
        eq(staffShifts.shopId, shopId),
        inArray(staffShifts.personId, [...personIds]),
        lt(staffShifts.startsAt, trip.endsAt),
        gt(staffShifts.endsAt, trip.startsAt),
      ),
    );
  return new Set(rows.map((row) => row.personId));
}

export type CreateStaffShiftOutcome =
  | { ok: true; shift: typeof staffShifts.$inferSelect }
  | { ok: false; reason: "staff_not_found" | "overlap" | "invalid" };

export async function createStaffShift(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    startsAt: Date;
    endsAt: Date;
    note?: string | null;
    createdByPersonId?: string | null;
  },
): Promise<CreateStaffShiftOutcome> {
  if (input.endsAt <= input.startsAt) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };
    const [overlap] = await tx
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.shopId, input.shopId),
          eq(staffShifts.personId, input.personId),
          lt(staffShifts.startsAt, input.endsAt),
          gt(staffShifts.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (overlap) return { ok: false, reason: "overlap" };
    const [shift] = await tx
      .insert(staffShifts)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note?.trim() || null,
        createdByPersonId: input.createdByPersonId ?? null,
      })
      .returning();
    if (!shift) return { ok: false, reason: "invalid" };
    return { ok: true, shift };
  });
}

export async function deleteStaffShift(
  db: AppDb,
  shopId: string,
  shiftId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(staffShifts)
    .where(and(eq(staffShifts.id, shiftId), eq(staffShifts.shopId, shopId)))
    .returning({ id: staffShifts.id });
  return deleted.length > 0;
}
