import { and, desc, eq, inArray } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { boatHasLeft } from "./aboard-at-sea";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { recordTripActivity } from "./operations";
import { diveNotMadeEvents, people, rollCallEvents, tripAssignments, trips } from "./schema";
import { rollCallCurrentDayIndex, rollCallDayIndex } from "./trip-meeting-windows";
import { liveTrip } from "./trips-live";

/**
 * **A planned dive recorded as not made** (issue #4681). The safety contract
 * Aaron accepted on 2026-11-19, kept here in one place:
 *
 * - **Who**: any active crew member on that departure (active staff of the
 *   shop, on the departure's crew), with no further permission. Who and when
 *   are recorded on every word.
 * - **When**: once the boat has left the dock (`boatHasLeft`), for a dive the
 *   departure plans, while nobody has begun that dive's count today. A dive
 *   somebody counted was made, so a count refuses the record; and once a count
 *   begins after the record, the count wins at every reader.
 * - **What it does**: closes only that dive's roll-call item on Wrapped up. It
 *   is never a count and never a completed dive, and it never hides an
 *   uncounted person, a missing-diver alert, or anybody not recorded back:
 *   nothing that decides those reads this table.
 * - **Correction**: an undo appends an `undone` word; nothing is edited or
 *   deleted, and both words go on the departure's activity trail too.
 */
export type DiveNotMadeRefusal =
  | "trip_unavailable"
  | "not_crew"
  | "boat_not_left"
  | "dive_not_planned"
  | "dive_counted"
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
    const standing = (await standingWords(tx, shopId, tripId)).get(diveNumber) ?? null;
    if (word === "undone") {
      if (standing?.word !== "not_made") return refused("not_recorded");
    } else {
      if (standing?.word === "not_made") return refused("already_not_made");
      if (!(await boatHasLeft(tx, { shopId, tripId, startsAt: trip.startsAt, now }))) {
        return refused("boat_not_left");
      }
      if (await countBegun(tx, { shopId, tripId, diveNumber, now })) return refused("dive_counted");
    }
    await tx.insert(diveNotMadeEvents).values({
      shopId,
      tripId,
      diveNumber,
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
      ),
    )
    .limit(1);
  return Boolean(assigned);
}

/**
 * Anybody, diver or crew, has a result at this dive's checkpoint on the day
 * being counted. Any `boarded` or `not_boarded` ever written there counts,
 * undone or not: a count once begun says the dive was made, and the record
 * is refused rather than weighed against it.
 */
async function countBegun(
  db: DbExecutor,
  input: { shopId: string; tripId: string; diveNumber: number; now: Date },
): Promise<boolean> {
  const rows = await db
    .select({ day: rollCallDayIndex(), currentDay: rollCallCurrentDayIndex(input.now) })
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
  return rows.some((row) => row.day === row.currentDay || row.day === -1);
}

type StandingWord = { word: "not_made" | "undone"; by: string; at: Date };

/** The newest word per dive on this departure. */
async function standingWords(
  db: DbExecutor,
  shopId: string,
  tripId: string,
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
    .where(and(eq(diveNotMadeEvents.shopId, shopId), eq(diveNotMadeEvents.tripId, tripId)))
    .orderBy(desc(diveNotMadeEvents.recordedAt), desc(diveNotMadeEvents.seq));
  const standing = new Map<number, StandingWord>();
  for (const row of rows) {
    if (!standing.has(row.diveNumber)) standing.set(row.diveNumber, row);
  }
  return standing;
}

/**
 * **The planned dives standing as not made**, by dive number: who recorded
 * it and when. A dive whose newest word is an undo is not here. Readers pair
 * it with the dive's count and let any count win (`waterStanding`).
 */
export async function diveNotMadeStanding(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<number, { by: string; at: Date }>> {
  const out = new Map<number, { by: string; at: Date }>();
  for (const [dive, row] of await standingWords(db, shopId, tripId)) {
    if (row.word === "not_made") out.set(dive, { by: row.by, at: row.at });
  }
  return out;
}
