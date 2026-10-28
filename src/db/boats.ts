import { and, asc, count, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  type BoatPaperRecord,
  type BoatSeatsRefusal,
  boatPaperChanges,
  boatSeatsRefusal,
} from "@/lib/boat-safety";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { VesselIdentity } from "@/lib/emergency-reference";
import type { AppDb, DbExecutor } from "./client";
import { queueMediaDeletion, retryMediaDeletion } from "./media-deletions";
import { boats, trips } from "./schema";
import { recordShopActivityWithin } from "./shop-activity";
import { liveTrip } from "./trips-live";

export type Boat = typeof boats.$inferSelect;

/**
 * The certificate's two limits and the boat's four paper dates, as the fleet
 * row edits them. Every field nullable: a shop that has not typed one in has
 * said nothing (`src/lib/boat-safety.ts`).
 */
export type BoatPapersInput = {
  certifiedPassengers: number | null;
  /** Total persons, crew included (#2302); checked at the manifest only. */
  certifiedTotalPersons: number | null;
  /** The certificate's own expiry, apart from the annual inspection (#2302). */
  coiExpiresOn: string | null;
  inspectionDueOn: string | null;
  registrationExpiresOn: string | null;
  insuranceExpiresOn: string | null;
  /**
   * The boat's radio identity (fourth review, item 11), normalized by the
   * caller. Absent leaves it as it was; the fleet row always sends both.
   */
  callSign?: string | null;
  mmsi?: string | null;
  /** The boat's working channel (issue #2672), normalized by the caller. */
  workingChannel?: string | null;
};

/**
 * **The boat each departure sails on, as the emergency card names it** (fourth
 * review, item 11): name, call sign, MMSI and working channel (#2672), keyed by trip. A departure on no
 * boat is absent, and the card falls back to the shop's own vessel line.
 *
 * History, not the live fleet: a departure that sailed on a hull the shop has
 * since deleted still names it (ADR 20260820-every-delete-is-soft), because
 * which vessel was out is the first fact an incident review asks for.
 */
export async function departureVessels(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, VesselIdentity>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({
      tripId: trips.id,
      name: boats.name,
      callSign: boats.callSign,
      mmsi: boats.mmsi,
      workingChannel: boats.workingChannel,
    })
    .from(trips)
    .innerJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(and(eq(trips.shopId, shopId), inArray(trips.id, [...tripIds]), liveTrip()));
  return new Map(
    rows.map((row) => [
      row.tripId,
      {
        name: row.name,
        callSign: row.callSign,
        mmsi: row.mmsi,
        workingChannel: row.workingChannel,
      } satisfies VesselIdentity,
    ]),
  );
}

/**
 * **How many live boats hold neither a call sign nor an MMSI** (review B1):
 * the Settings hub names the number on the fleet's door, so the two fields
 * that arrived empty on every existing boat are a visible job rather than a
 * quiet gap. Until one is filled the emergency card keeps the shop's own
 * vessel line under that boat (`emergencyReferenceForDeparture`).
 */
export async function countBoatsWithoutRadioIdentity(db: DbExecutor, shopId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(boats)
    .where(
      and(
        eq(boats.shopId, shopId),
        isNull(boats.deletedAt),
        isNull(boats.callSign),
        isNull(boats.mmsi),
      ),
    );
  return row?.value ?? 0;
}

/** The shop's fleet: the hulls it has, never the ones it deleted. */
export async function listBoats(db: AppDb, shopId: string): Promise<Boat[]> {
  return db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(boats.name);
}

/**
 * One live hull — for the checks that ask what the shop currently runs, like a
 * departure's capacity against the vessel it sails on.
 */
export async function getBoatById(db: AppDb, shopId: string, boatId: string): Promise<Boat | null> {
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .limit(1);
  return boat ?? null;
}

/** Replace only the photo read before upload; queue the retired object in the same transaction. */
export async function replaceBoatPhoto(
  db: AppDb,
  shopId: string,
  boatId: string,
  expectedUrl: string | null,
  photoUrl: string | null,
): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const [boat] = await tx
      .update(boats)
      .set({ photoUrl })
      .where(
        and(
          eq(boats.shopId, shopId),
          eq(boats.id, boatId),
          isNull(boats.deletedAt),
          expectedUrl === null ? isNull(boats.photoUrl) : eq(boats.photoUrl, expectedUrl),
        ),
      )
      .returning({ id: boats.id });
    if (!boat) return { saved: false, attemptId: null };
    const attempt =
      expectedUrl && expectedUrl !== photoUrl
        ? await queueMediaDeletion(tx, { shopId, kind: "boat_photo", url: expectedUrl })
        : null;
    return { saved: true, attemptId: attempt?.id ?? null };
  });
  if (result.attemptId) await retryMediaDeletion(db, shopId, result.attemptId);
  return result.saved;
}

/**
 * Every hull the shop has ever had, deleted ones included — for resolving the
 * *name* a past departure sailed under. See `getBoatForHistory` below for why
 * this is a separate read from `listBoats`.
 */
export async function listBoatsForHistory(db: AppDb, shopId: string): Promise<Boat[]> {
  return db.select().from(boats).where(eq(boats.shopId, shopId)).orderBy(boats.name);
}

/**
 * One hull **whatever its state** — for the surfaces that name the vessel a
 * departure sailed on.
 *
 * This is the deliberate opposite of `getBoatById` above, and the whole point of
 * soft-deleting a boat: a manifest, a departure log or a close-out record from
 * two seasons ago must still say which vessel, long after the shop sold it. A
 * read that hid a deleted hull here would leave exactly the blank the hard
 * delete used to leave.
 */
export async function getBoatForHistory(
  db: AppDb,
  shopId: string,
  boatId: string,
): Promise<Boat | null> {
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .limit(1);
  return boat ?? null;
}

/**
 * How many departures this hull is on, for the confirm to say so before a shop
 * taps Delete.
 *
 * Counted rather than refused: retiring a sold boat is an ordinary thing a shop
 * does, a refusal would leave the fleet list permanently cluttered, and with a
 * soft delete nothing is lost either way. A hull that never sailed goes quietly.
 */
export async function countDeparturesByBoat(
  db: AppDb,
  shopId: string,
): Promise<Map<string, number>> {
  // One read for the fleet, grouped by hull (code review 2026-10-13b, item
  // 36): the settings page asked one hull at a time. A hull with no departure
  // is absent, and reads as 0.
  const rows = await db
    .select({ boatId: trips.boatId, departures: count(trips.id) })
    .from(trips)
    // diveday:allow-deleted-trips: a hull's history is the point — a departure
    // the shop took off the board still sailed on this boat, and the confirm is
    // telling the shop how much history the delete touches.
    .where(and(eq(trips.shopId, shopId), isNotNull(trips.boatId), ne(trips.status, "cancelled")))
    .groupBy(trips.boatId);
  return new Map(rows.flatMap((row) => (row.boatId ? [[row.boatId, row.departures]] : [])));
}

/**
 * The seats and start of each upcoming departure on this hull, soonest first, dated in the shop’s zone —
 * live, scheduled and not yet started — for the certificate check a boat save runs (H-107,
 * `boatSeatsRefusal`). A departure that has started is history the
 * certificate can no longer change.
 */
export async function upcomingBoatDepartures(
  db: DbExecutor,
  input: { shopId: string; boatId: string; timeZone: string; now?: Date },
): Promise<{ capacity: number; on: CalendarDate }[]> {
  const { shopId, boatId, timeZone, now = nowDate() } = input;
  const rows = await db
    .select({ capacity: trips.capacity, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.boatId, boatId),
        eq(trips.status, "scheduled"),
        liveTrip(),
        gt(trips.startsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows.map((row) => ({
    capacity: row.capacity,
    on: calendarDateInTimezone(row.startsAt, timeZone),
  }));
}

export async function createBoat(
  db: AppDb,
  shopId: string,
  name: string,
  capacity: number,
  description: string | null = null,
  papers?: BoatPapersInput,
  /** The staffer saving it, for the papers' activity line (records review 2). */
  actorPersonId?: string,
): Promise<Boat> {
  const [boat] = await db
    .insert(boats)
    .values({
      shopId,
      name,
      capacity,
      description,
      ...papers,
    })
    .returning();
  if (!boat) {
    throw new Error("createBoat: failed to insert boat");
  }
  if (actorPersonId) await recordPaperChanges(db, shopId, actorPersonId, null, boat);
  return boat;
}

function paperRecord(boat: Boat): BoatPaperRecord {
  return {
    certifiedPassengers: boat.certifiedPassengers,
    certifiedTotalPersons: boat.certifiedTotalPersons,
    coiExpiresOn: boat.coiExpiresOn,
    inspectionDueOn: boat.inspectionDueOn,
    registrationExpiresOn: boat.registrationExpiresOn,
    insuranceExpiresOn: boat.insuranceExpiresOn,
  };
}

/** One activity line per certificate or paper field the save moved (records review 2). */
async function recordPaperChanges(
  db: DbExecutor,
  shopId: string,
  actorPersonId: string,
  before: Boat | null,
  after: Boat,
): Promise<void> {
  for (const change of boatPaperChanges(before ? paperRecord(before) : null, paperRecord(after))) {
    await recordShopActivityWithin(db, {
      shopId,
      actorPersonId,
      write: { code: "boat_papers_changed", boat: after.name, ...change },
    });
  }
}

export async function updateBoat(
  db: AppDb,
  shopId: string,
  boatId: string,
  name: string,
  capacity: number,
  description: string | null = null,
  /** Absent leaves the papers as they were; the fleet row always sends them. */
  papers?: BoatPapersInput,
): Promise<Boat | null> {
  const [boat] = await db
    .update(boats)
    .set({ name, capacity, description, ...papers })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .returning();
  return boat ?? null;
}

export type BoatSaveOutcome =
  | { ok: true; boat: Boat }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "certificate"; refusal: BoatSeatsRefusal };

/**
 * **Save a hull under its certificate, in one transaction** (H-107, #2324).
 *
 * The check and the write used to be two steps in the settings action, so a
 * departure edited between them could slip past the certificate the save had
 * just approved. Here the boat row is locked, then each of its upcoming
 * departures (`for no key update`, in id order, so two saves of one hull
 * queue rather than cross), and only then are their seats read and the
 * refusal decided — a trip edit either lands before and is counted, or waits
 * behind the save. The booking transaction still enforces the certificate at
 * the point of sale whatever this says.
 */
export async function updateBoatWithinCertificate(
  db: AppDb,
  input: {
    shopId: string;
    boatId: string;
    name: string;
    capacity: number;
    description: string | null;
    papers: BoatPapersInput;
    timeZone: string;
    now?: Date;
    /** The staffer saving it, for the papers' activity line (records review 2). */
    actorPersonId?: string;
  },
): Promise<BoatSaveOutcome> {
  const { shopId, boatId, now = nowDate() } = input;
  return db.transaction(async (tx): Promise<BoatSaveOutcome> => {
    const [boat] = await tx
      .select()
      .from(boats)
      .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
      .limit(1)
      // Not `for update`: a trip edit that points a departure at this hull
      // takes a `KEY SHARE` on it through the foreign key while holding its
      // trip, and must not be made to wait here while this waits on that trip.
      .for("no key update");
    if (!boat) return { ok: false, reason: "not_found" };
    if (input.papers.certifiedPassengers !== null) {
      await tx
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.shopId, shopId),
            eq(trips.boatId, boatId),
            eq(trips.status, "scheduled"),
            liveTrip(),
            gt(trips.startsAt, now),
          ),
        )
        .orderBy(asc(trips.id))
        .for("no key update");
    }
    const refusal = boatSeatsRefusal({
      capacity: input.capacity,
      ...input.papers,
      upcomingDepartures:
        input.papers.certifiedPassengers !== null
          ? await upcomingBoatDepartures(tx, { shopId, boatId, timeZone: input.timeZone, now })
          : [],
    });
    if (refusal) return { ok: false, reason: "certificate", refusal };
    const [saved] = await tx
      .update(boats)
      .set({
        name: input.name,
        capacity: input.capacity,
        description: input.description,
        ...input.papers,
      })
      .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
      .returning();
    if (!saved) return { ok: false, reason: "not_found" };
    if (input.actorPersonId) {
      await recordPaperChanges(tx, shopId, input.actorPersonId, boat, saved);
    }
    return { ok: true, boat: saved };
  });
}

/**
 * **Stamps, never removes** (ADR 20260820-every-delete-is-soft).
 *
 * A real `delete` here did not fail loudly the way a foreign key normally
 * would: `trips.boat_id` is `onDelete: "set null"`, so it quietly rewrote every
 * past departure that used the hull to say no vessel was ever recorded. That is
 * the fact an insurer or a coast-guard inquiry asks for first, and nothing
 * warned, counted or undid it.
 *
 * Already-deleted rows are left alone rather than re-stamped, so the date keeps
 * saying when the shop actually retired the boat.
 */
export async function deleteBoat(db: AppDb, shopId: string, boatId: string): Promise<boolean> {
  const result = await db
    .update(boats)
    .set({ deletedAt: nowDate() })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .returning({ id: boats.id });
  return result.length > 0;
}
