import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { rollCallDayOf, rollCallDayStarts } from "@/lib/trip-days";
import { boatHasLeft } from "./aboard-at-sea";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { recordTripActivity } from "./operations";
import {
  diveNotMadeEvents,
  executedDives,
  people,
  rollCallEvents,
  tripAssignments,
  tripScheduleDays,
  trips,
} from "./schema";
import { rollCallDayIndex } from "./trip-meeting-windows";
import { liveTrip } from "./trips-live";

/**
 * **A planned dive recorded as not made** (issue #4681). The safety contract
 * Aaron accepted on 2026-11-19, kept here in one place:
 *
 * - **Who**: any active crew member on that departure (active staff of the
 *   shop, on the departure's crew), with no further permission. Who and when
 *   are recorded on every word.
 * - **When**: once the boat has left the dock (`boatHasLeft`), for a dive the
 *   departure plans, while nobody has begun that dive's count on the meeting
 *   day being counted and nobody has logged it. A dive somebody counted or
 *   logged was made, so either refuses the record; and once a count or a log
 *   comes after the record, it wins at every reader.
 * - **Which day**: each word belongs to the meeting day it was said on, the
 *   roll-call day being counted then (`rollCallDayOf`). On a departure that
 *   meets on several days, day one's dive 2 is not day two's: readers, the
 *   second tap and the undo look at the day being counted only.
 * - **What it does**: closes only that dive's roll-call item on Wrapped up and
 *   that dive's after-dive count on Today (`listRollCallGaps` through
 *   `divesStandingNotMade`, issue #4809). It is never a count and never a
 *   completed dive, and it never hides an uncounted person, a missing-diver
 *   alert, or anybody not recorded back: nothing that decides those reads
 *   this table, and the after-dive count it closes is the dive-level one only.
 * - **Correction**: an undo appends an `undone` word; nothing is edited or
 *   deleted, and both words go on the departure's activity trail too.
 */
export type DiveNotMadeRefusal =
  | "trip_unavailable"
  | "not_crew"
  | "boat_not_left"
  | "dive_not_planned"
  | "dive_counted"
  | "dive_logged"
  | "already_not_made"
  | "not_recorded";

export type DiveNotMadeOutcome = { ok: true } | { ok: false; reason: DiveNotMadeRefusal };

type DiveNotMadeInput = {
  shopId: string;
  tripId: string;
  diveNumber: number;
  /** The signed-in staffer; never taken from the form. */
  personId: string;
};

/** Record that a planned dive was not made. */
export async function recordDiveNotMade(
  db: AppDb,
  input: DiveNotMadeInput,
  now: Date = nowDate(),
): Promise<DiveNotMadeOutcome> {
  return writeWord(db, input, "not_made", now);
}

/** Undo the standing not-made record of a dive; the record stays on the trail. */
export async function undoDiveNotMade(
  db: AppDb,
  input: DiveNotMadeInput,
  now: Date = nowDate(),
): Promise<DiveNotMadeOutcome> {
  return writeWord(db, input, "undone", now);
}

async function writeWord(
  db: AppDb,
  input: DiveNotMadeInput,
  word: "not_made" | "undone",
  now: Date,
): Promise<DiveNotMadeOutcome> {
  const { shopId, tripId, diveNumber, personId } = input;
  return db.transaction(async (tx) => {
    // The trip row's lock serializes two crew tapping the same dive at once,
    // the same lock the stage word and the roll call take.
    const [trip] = await tx
      .select({ startsAt: trips.startsAt, status: trips.status, plannedDives: trips.plannedDives })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip || trip.status === "cancelled") return refused("trip_unavailable");
    if (!(await activeCrewOn(tx, { shopId, tripId, personId }))) return refused("not_crew");
    if (!Number.isInteger(diveNumber) || diveNumber < 1 || diveNumber > trip.plannedDives) {
      return refused("dive_not_planned");
    }
    const day = await meetingDayAt(tx, tripId, now);
    const standing = (await standingWords(tx, shopId, tripId, day)).get(diveNumber) ?? null;
    if (word === "undone") {
      if (standing?.word !== "not_made") return refused("not_recorded");
    } else {
      if (standing?.word === "not_made") return refused("already_not_made");
      if (!(await boatHasLeft(tx, { shopId, tripId, startsAt: trip.startsAt, now }))) {
        return refused("boat_not_left");
      }
      if (await countBegun(tx, { shopId, tripId, diveNumber, day })) return refused("dive_counted");
      if (await diveLogged(tx, { shopId, tripId, diveNumber })) return refused("dive_logged");
    }
    await tx.insert(diveNotMadeEvents).values({
      shopId,
      tripId,
      diveNumber,
      meetingDay: day,
      word,
      recordedByPersonId: personId,
      recordedAt: now,
    });
    await recordTripActivity(tx, {
      shopId,
      tripId,
      actorPersonId: personId,
      entry: {
        code: word === "not_made" ? "dive_not_made" : "dive_not_made_undone",
        dive: String(diveNumber),
      },
    });
    return { ok: true as const };
  });
}

function refused(reason: DiveNotMadeRefusal): DiveNotMadeOutcome {
  return { ok: false, reason };
}

/** Active staff of this shop, on this departure's crew. */
export async function activeCrewOn(
  db: DbExecutor,
  input: { shopId: string; tripId: string; personId: string },
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles || !isStaff(roles)) return false;
  const [assigned] = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(
        eq(tripAssignments.tripId, input.tripId),
        eq(tripAssignments.personId, input.personId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  return Boolean(assigned);
}

/**
 * **The meeting day being counted at `now`** (0-based), as roll call reads it
 * (`rollCallDayOf` over `rollCallDayStarts`, the same boundary
 * `rollCallCurrentDayIndex` draws in SQL); 0 for a departure that meets once.
 */
async function meetingDayAt(db: DbExecutor, tripId: string, now: Date): Promise<number> {
  const windows = await db
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, tripId))
    .orderBy(asc(tripScheduleDays.startsAt));
  if (windows.length < 2) return 0;
  return rollCallDayOf(rollCallDayStarts(windows), now);
}

/**
 * Anybody, diver or crew, has a result at this dive's checkpoint on the day
 * being counted. Any `boarded` or `not_boarded` ever written there counts,
 * undone or not: a count once begun says the dive was made, and the record
 * is refused rather than weighed against it.
 */
async function countBegun(
  db: DbExecutor,
  input: { shopId: string; tripId: string; diveNumber: number; day: number },
): Promise<boolean> {
  const rows = await db
    .select({ day: rollCallDayIndex() })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, input.shopId),
        eq(rollCallEvents.tripId, input.tripId),
        // diveday:roll-call-both-subjects: a result for a diver or a crew member begins the count.
        eq(rollCallEvents.checkpoint, `after_dive_${input.diveNumber}`),
        inArray(rollCallEvents.status, ["boarded", "not_boarded"]),
      ),
    );
  // A result whose day is unknown (-1) may be today's, so it refuses too.
  return rows.some((row) => row.day === input.day || row.day === -1);
}

/**
 * **Somebody logged this dive** (`executed_dives`): an entry or exit time, or
 * a depth, on a live log. A logged dive was made. The log is the departure's,
 * not a day's, so it refuses the record on every day.
 */
async function diveLogged(
  db: DbExecutor,
  input: { shopId: string; tripId: string; diveNumber: number },
): Promise<boolean> {
  const [row] = await db
    .select({ id: executedDives.id })
    .from(executedDives)
    .where(
      and(
        eq(executedDives.shopId, input.shopId),
        eq(executedDives.tripId, input.tripId),
        eq(executedDives.diveNumber, input.diveNumber),
        liveLog(),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** A live log with an entry or exit time, or a depth: the dive was made. */
function liveLog() {
  return and(
    isNull(executedDives.deletedAt),
    or(
      isNotNull(executedDives.enteredAt),
      isNotNull(executedDives.exitedAt),
      isNotNull(executedDives.maxDepthMeters),
    ),
  );
}

type StandingWord = { word: "not_made" | "undone"; by: string; at: Date };

/** The newest word per dive on this departure's meeting day `day`. */
async function standingWords(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  day: number,
): Promise<Map<number, StandingWord>> {
  const rows = await db
    .select({
      diveNumber: diveNotMadeEvents.diveNumber,
      word: diveNotMadeEvents.word,
      at: diveNotMadeEvents.recordedAt,
      // diveday:allow-deleted-people: the trail names whoever recorded it, as recorded.
      by: people.fullName,
    })
    .from(diveNotMadeEvents)
    .innerJoin(people, eq(people.id, diveNotMadeEvents.recordedByPersonId))
    .where(
      and(
        eq(diveNotMadeEvents.shopId, shopId),
        eq(diveNotMadeEvents.tripId, tripId),
        eq(diveNotMadeEvents.meetingDay, day),
      ),
    )
    .orderBy(desc(diveNotMadeEvents.recordedAt), desc(diveNotMadeEvents.seq));
  const standing = new Map<number, StandingWord>();
  for (const row of rows) {
    if (!standing.has(row.diveNumber)) standing.set(row.diveNumber, row);
  }
  return standing;
}

/**
 * **The planned dives standing as not made** on the meeting day being counted
 * at `now`, by dive number: who recorded it and when. A dive whose newest word
 * is an undo is not here, nor is another meeting day's. Readers pair it with
 * the dive's count and log and let either win (`waterStanding`).
 */
export async function diveNotMadeStanding(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
): Promise<Map<number, { by: string; at: Date }>> {
  const out = new Map<number, { by: string; at: Date }>();
  const day = await meetingDayAt(db, tripId, now);
  for (const [dive, row] of await standingWords(db, shopId, tripId, day)) {
    if (row.word === "not_made") out.set(dive, { by: row.by, at: row.at });
  }
  return out;
}

/**
 * **The standing not-made dives of the departure in the enclosing query**
 * (issue #4809), as a column for the open head counts (`listRollCallGaps`),
 * so the detector pays no extra statement: each meeting day (0-based) and dive
 * whose newest word that day is `not_made` and that nobody has logged, or
 * null for none. A count of the dive is the reader's to weigh, since it holds
 * the roll call; the log is weighed here, and either wins over the record.
 */
export function standingNotMadeDivesOf(trip: { id: typeof trips.id; shopId: typeof trips.shopId }) {
  return sql<{ day: number; dive: number }[] | null>`(
    select json_agg(json_build_object('day', newest.meeting_day, 'dive', newest.dive_number))
    from (
      select distinct on (${diveNotMadeEvents.meetingDay}, ${diveNotMadeEvents.diveNumber})
        ${diveNotMadeEvents.meetingDay} as meeting_day,
        ${diveNotMadeEvents.diveNumber} as dive_number,
        ${diveNotMadeEvents.word} as word
      from ${diveNotMadeEvents}
      where ${diveNotMadeEvents.tripId} = ${trip.id} and ${diveNotMadeEvents.shopId} = ${trip.shopId}
      order by ${diveNotMadeEvents.meetingDay}, ${diveNotMadeEvents.diveNumber},
        ${diveNotMadeEvents.recordedAt} desc, ${diveNotMadeEvents.seq} desc
    ) newest
    where newest.word = 'not_made'
      and not exists (
        select 1 from ${executedDives}
        where ${executedDives.tripId} = ${trip.id}
          and ${executedDives.shopId} = ${trip.shopId}
          and ${executedDives.diveNumber} = newest.dive_number
          and ${liveLog()}
      )
  )`;
}
