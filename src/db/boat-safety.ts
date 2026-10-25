import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  type BoatChecklistAnswer,
  type BoatPaperRecord,
  type BoatRadioRecord,
  type BoatSafetyNotice,
  boatPaperNotices,
  boatSafetyNotices,
  boatSnapshotNotices,
  departureSafetyDate,
  expiredBoatSafetyNotices,
  isLifeSafetyKitKind,
  kitMissingNotices,
  lifeSafetyNotices,
  SAFETY_KIT_KINDS,
  type SafetyKitUnit,
  safetyKitNotices,
} from "@/lib/boat-safety";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { GearItemKind } from "@/lib/gear";
import { log } from "@/lib/log";
import { hasSailed } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { latestServiceClocks } from "./gear";
import { latestPreDepartureChecksForTrip, listChecklistItemsAsOf } from "./pre-departure-check";
import { queryAll } from "./query-helpers";
import { boats, departureBoatSafetySnapshots, gearItems, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The boat's papers and the safety kit aboard it, read for the pre-departure
 * check and Today (roadmap N-08, N-10). Readers only: the papers are written by
 * the fleet row (`updateBoat`) and the kit by the gear register
 * (`updateGearItem`, `recordGearService`). Every read is scoped by shop.
 */

type RegisteredSafetyKit = SafetyKitUnit & { aboardBoatId: string | null };

/**
 * Every live safety-kit unit the shop has, aboard any hull or ashore, with its
 * clocks. One read for the whole register rather than one per hull: the
 * must-carry check needs to know which kinds the shop keeps at all, and a shop
 * runs a handful of these units, not hundreds.
 */
async function listSafetyKit(db: DbExecutor, shopId: string): Promise<RegisteredSafetyKit[]> {
  const units = await db
    .select({
      id: gearItems.id,
      label: gearItems.label,
      kind: gearItems.kind,
      status: gearItems.status,
      aboardBoatId: gearItems.aboardBoatId,
    })
    .from(gearItems)
    .where(
      and(
        eq(gearItems.shopId, shopId),
        isNull(gearItems.deletedAt),
        inArray(gearItems.kind, [...SAFETY_KIT_KINDS]),
      ),
    )
    .orderBy(asc(gearItems.kind), asc(gearItems.label));
  if (units.length === 0) return [];
  const clocks = await latestServiceClocks(
    db,
    shopId,
    units.map((unit) => unit.id),
  );
  return units.map((unit) => ({ ...unit, clocks: clocks.get(unit.id) ?? [] }));
}

function kindsOf(kit: readonly RegisteredSafetyKit[]): Set<GearItemKind> {
  return new Set(kit.map((unit) => unit.kind));
}

const boatPaperColumns = {
  id: boats.id,
  name: boats.name,
  certifiedPassengers: boats.certifiedPassengers,
  certifiedTotalPersons: boats.certifiedTotalPersons,
  coiExpiresOn: boats.coiExpiresOn,
  inspectionDueOn: boats.inspectionDueOn,
  registrationExpiresOn: boats.registrationExpiresOn,
  insuranceExpiresOn: boats.insuranceExpiresOn,
};

export type DepartureBoatSafety = {
  boatId: string;
  boatName: string;
  notices: BoatSafetyNotice[];
};

/**
 * **What the pre-departure check says about this departure's boat**: the
 * people aboard against its certificate (passengers, and persons with the
 * crew), its papers, the O2 kit or AED it
 * should carry and does not, and every clock on the safety kit assigned aboard
 * it that has run out or will inside its horizon — all judged on `onDate`, the
 * departure's own local date.
 *
 * `null` when the departure has no boat. A boat the shop has since deleted is
 * still named (its papers and its kit say nothing any more), so a manifest
 * keeps naming the hull it sails on.
 */
export async function departureBoatSafety(
  db: DbExecutor,
  shopId: string,
  input: {
    boatId: string | null;
    passengers: { booked: number; boarded: number };
    /** The departure's named crew, and how many are recorded aboard (#2302). */
    crew: { assigned: number; boarded: number };
    onDate: CalendarDate;
    /** The shop's own date, when `onDate` is a later departure's. */
    today?: CalendarDate;
  },
): Promise<DepartureBoatSafety | null> {
  if (!input.boatId) return null;
  const [boat] = await db
    .select({ ...boatPaperColumns, deletedAt: boats.deletedAt })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, input.boatId)))
    .limit(1);
  if (!boat) return null;
  if (boat.deletedAt) return { boatId: boat.id, boatName: boat.name, notices: [] };
  const kit = await listSafetyKit(db, shopId);
  return {
    boatId: boat.id,
    boatName: boat.name,
    notices: boatSafetyNotices({
      boat,
      kit: kit.filter((unit) => unit.aboardBoatId === boat.id),
      kindsOnRegister: kindsOf(kit),
      passengers: input.passengers,
      crew: input.crew,
      onDate: input.onDate,
      today: input.today,
    }),
  };
}

/**
 * One owner/manager errand on Today: a live boat's papers inside their window
 * (`expired` once any has lapsed — the row escalates), or a safety-kit unit
 * with a clock that has run out.
 */
export type BoatSafetyErrand =
  | {
      subject: "boat";
      boatId: string;
      name: string;
      expired: boolean;
      notices: BoatSafetyNotice[];
    }
  | { subject: "kit"; gearItemId: string; label: string; notices: BoatSafetyNotice[] };

/** A departure sailing today whose life-safety kit has something to say. */
export type DepartureLifeSafety = {
  tripId: string;
  boatId: string;
  boatName: string;
  notices: BoatSafetyNotice[];
};

/**
 * **Everything Today says about boats and their kit**, in one pass over the
 * fleet and the register (two statements, three when the shop keeps safety
 * kit):
 *
 * - `departures`: for each departure sailing today on a live boat, the
 *   life-safety notices — O2 kit or AED missing aboard, and any oxygen, AED or
 *   flare clock run out or due inside the kit horizon. Every role's row, tied
 *   to that departure.
 * - `errands`: the owner's — each live boat with a paper inside its window,
 *   and each safety-kit unit with an expired clock that is **not** already
 *   said on a departure row (kit ashore, aboard a boat not sailing today, or a
 *   first-aid kit).
 */
export async function todayBoatSafety(
  db: DbExecutor,
  shopId: string,
  input: {
    todayLocal: CalendarDate;
    /** Today's departures that sail on a boat. */
    departures: readonly { tripId: string; boatId: string }[];
  },
): Promise<{ departures: DepartureLifeSafety[]; errands: BoatSafetyErrand[] }> {
  const fleet = await db
    .select(boatPaperColumns)
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(asc(boats.name));
  const kit = await listSafetyKit(db, shopId);
  const kindsOnRegister = kindsOf(kit);
  const boatsById = new Map(fleet.map((boat) => [boat.id, boat]));

  const departures: DepartureLifeSafety[] = [];
  const sailingBoatIds = new Set<string>();
  for (const departure of input.departures) {
    const boat = boatsById.get(departure.boatId);
    if (!boat) continue;
    sailingBoatIds.add(boat.id);
    const notices = lifeSafetyNotices([
      ...kitMissingNotices(
        kit.filter((unit) => unit.aboardBoatId === boat.id),
        kindsOnRegister,
      ),
      ...safetyKitNotices(
        kit.filter((unit) => unit.aboardBoatId === boat.id),
        input.todayLocal,
      ),
      // A lapsed certificate or inspection (dive-domain review D3).
      ...boatPaperNotices(boat, input.todayLocal),
    ]);
    if (notices.length > 0) {
      departures.push({ tripId: departure.tripId, boatId: boat.id, boatName: boat.name, notices });
    }
  }

  const errands: BoatSafetyErrand[] = [];
  for (const boat of fleet) {
    const notices = boatPaperNotices(boat, input.todayLocal);
    if (notices.length > 0) {
      errands.push({
        subject: "boat",
        boatId: boat.id,
        name: boat.name,
        expired: notices.some((notice) => notice.code === "paper" && notice.expired),
        notices,
      });
    }
  }
  for (const unit of kit) {
    // Already the lead of a departure row today: saying it twice would be the
    // same dead pads on two rows.
    if (
      isLifeSafetyKitKind(unit.kind) &&
      unit.aboardBoatId !== null &&
      sailingBoatIds.has(unit.aboardBoatId)
    ) {
      continue;
    }
    const notices = expiredBoatSafetyNotices(safetyKitNotices([unit], input.todayLocal));
    if (notices.length > 0) {
      errands.push({ subject: "kit", gearItemId: unit.id, label: unit.label, notices });
    }
  }
  return { departures, errands };
}

/**
 * **The pre-departure check's boat section for one departure**, judged on the
 * departure's own local date (`departureSafetyDate`). Null for a departure
 * with no boat, one that is not this shop's, or one whose day is behind the
 * shop: what a sailed boat carried is not today's to say.
 */
export async function departureBoatSafetyFor(
  db: DbExecutor,
  shopId: string,
  input: {
    tripId: string;
    startsAt: Date;
    timeZone: string;
    now: Date;
    passengers: { booked: number; boarded: number };
    crew: { assigned: number; boarded: number };
  },
): Promise<DepartureBoatSafety | null> {
  const onDate = departureSafetyDate(input.startsAt, input.now, input.timeZone);
  if (!onDate) return null;
  return departureBoatSafety(db, shopId, {
    boatId: await departureBoatId(db, shopId, input.tripId),
    passengers: input.passengers,
    crew: input.crew,
    onDate,
    today: calendarDateInTimezone(input.now, input.timeZone),
  });
}

/**
 * The hull a departure sails on, for the manifest to ask `departureBoatSafety`
 * about. Null for a departure with no boat, or one that is not this shop's.
 */
export async function departureBoatId(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<string | null> {
  const [trip] = await db
    .select({ boatId: trips.boatId })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId), liveTrip()))
    .limit(1);
  return trip?.boatId ?? null;
}

/**
 * **The oxygen and first aid kit aboard a departure's boat, as the register
 * holds them** (fourth review, item 17). The printed packet left "Oxygen kit
 * is kept / Last checked / O2 pressure" as blanks even when the shop's gear
 * register says which kit is aboard this hull and when it was last serviced.
 *
 * Only what the shop recorded, never a guess: the in-service units aboard, by
 * their own labels, and the newest `service` record on an oxygen kit. A
 * cylinder's hydro test or visual inspection is not a kit service, and a note
 * is not a check, so neither counts (review F2). Null for a departure on no
 * boat; empty lists when the register has nothing aboard.
 *
 * The packet prints these as a line of their own above the kit blanks, never
 * in them: "kept ___" asks where on the boat, and "last checked ___ · O2
 * pressure ___" is the crew's own pre-trip check, which no register answers.
 */
export type DepartureKitRecord = {
  boatName: string;
  oxygenKits: string[];
  firstAidKits: string[];
  oxygenServicedOn: CalendarDate | null;
};

export async function departureKitRecord(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<DepartureKitRecord | null> {
  const boatId = await departureBoatId(db, shopId, tripId);
  if (!boatId) return null;
  const [boat] = await db
    .select({ name: boats.name })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .limit(1);
  if (!boat) return null;
  const aboard = (await listSafetyKit(db, shopId)).filter(
    (unit) => unit.aboardBoatId === boatId && unit.status === "in_service",
  );
  const oxygen = aboard.filter((unit) => unit.kind === "o2_kit");
  const services = oxygen
    .flatMap((unit) => unit.clocks)
    .filter((clock) => clock.kind === "service")
    .map((clock) => clock.servicedOn)
    .sort();
  return {
    boatName: boat.name,
    oxygenKits: oxygen.map((unit) => unit.label),
    firstAidKits: aboard.filter((unit) => unit.kind === "first_aid_kit").map((unit) => unit.label),
    oxygenServicedOn: services.at(-1) ?? null,
  };
}

/**
 * **Keep the boat's papers and kit notices as they stand at the departure
 * checkpoint** (#2300). Called after every departure-checkpoint roll-call
 * write, diver or crew, live or offline, with that tap's own `occurredAt` as
 * `asOf`. Before sailing, taps and a hull swap may refresh the record. A kept
 * sailed record is immutable; a first late offline tap may fill an absent
 * record only when its tap was before sailing (`hasSailed`). An older tap
 * never overwrites a newer one. A deleted hull supplies no fresh evidence.
 *
 * Never throws. The roll call it follows is already committed, and a missing
 * snapshot is stated on the log as missing; a failure is logged, not raised
 * into the rail.
 */
export async function captureDepartureBoatSafety(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  asOf: Date = nowDate(),
): Promise<"captured" | "kept_newer" | "kept_unknown" | "sailed" | "no_boat" | "failed"> {
  try {
    // Its own transaction (a savepoint when the caller holds one), so a failed
    // statement here never aborts the caller's.
    return await db.transaction((tx) => captureInTransaction(tx, shopId, tripId, asOf));
  } catch (error) {
    log("boat_safety.snapshot_failed", "error", {
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return "failed";
  }
}

async function captureInTransaction(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  asOf: Date,
): Promise<"captured" | "kept_newer" | "kept_unknown" | "sailed" | "no_boat"> {
  const [trip] = await db
    .select({ startsAt: trips.startsAt, boatId: trips.boatId, timeZone: shops.timezone })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.shopId, shopId), eq(trips.id, tripId), liveTrip()))
    .limit(1)
    .for("update", { of: trips });
  if (!trip?.boatId) return "no_boat";
  if (hasSailed(trip.startsAt, asOf)) return "sailed";
  // Share updateTrip's lock: a capture cannot read hull A, wait on the
  // snapshot, then overwrite the evidence a swap has just kept for hull B.
  // A first late offline tap may fill an absent record, but never rewrite
  // evidence already kept for a departure that has sailed.
  const [kept] = await db
    .select({ departureStartsAt: departureBoatSafetySnapshots.departureStartsAt })
    .from(departureBoatSafetySnapshots)
    .where(
      and(
        eq(departureBoatSafetySnapshots.shopId, shopId),
        eq(departureBoatSafetySnapshots.tripId, tripId),
      ),
    )
    .limit(1);
  if (kept) {
    if (kept.departureStartsAt === null) return "kept_unknown";
    const now = nowDate();
    if (hasSailed(kept.departureStartsAt, now) || hasSailed(trip.startsAt, now)) return "sailed";
  }
  const [boat] = await db
    .select({
      ...boatPaperColumns,
      callSign: boats.callSign,
      mmsi: boats.mmsi,
      workingChannel: boats.workingChannel,
    })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, trip.boatId), isNull(boats.deletedAt)))
    .limit(1);
  if (!boat) return "no_boat";
  const judgedOn = calendarDateInTimezone(trip.startsAt, trip.timeZone);
  const kit = await listSafetyKit(db, shopId);
  const notices = boatSnapshotNotices(
    boatSafetyNotices({
      boat,
      kit: kit.filter((unit) => unit.aboardBoatId === boat.id),
      kindsOnRegister: kindsOf(kit),
      // The head count is the roll call's own record; nothing here counts it.
      passengers: { booked: 0, boarded: 0 },
      crew: { assigned: 0, boarded: 0 },
      onDate: judgedOn,
    }),
  );
  const papers: BoatPaperRecord = {
    certifiedPassengers: boat.certifiedPassengers,
    certifiedTotalPersons: boat.certifiedTotalPersons,
    coiExpiresOn: boat.coiExpiresOn,
    inspectionDueOn: boat.inspectionDueOn,
    registrationExpiresOn: boat.registrationExpiresOn,
    insuranceExpiresOn: boat.insuranceExpiresOn,
  };
  // What the emergency card printed for this boat (records review S1, #2672).
  const radio: BoatRadioRecord = {
    callSign: boat.callSign,
    mmsi: boat.mmsi,
    workingChannel: boat.workingChannel,
  };
  const row = {
    boatId: boat.id,
    boatName: boat.name,
    judgedOn,
    departureStartsAt: trip.startsAt,
    papers,
    radio,
    notices,
    capturedAt: asOf,
  };
  const written = await db
    .insert(departureBoatSafetySnapshots)
    .values({ shopId, tripId, ...row })
    .onConflictDoUpdate({
      target: departureBoatSafetySnapshots.tripId,
      set: row,
      // An offline tap from before the last one kept arrives second: keep the newer.
      setWhere: lte(departureBoatSafetySnapshots.capturedAt, asOf),
    })
    .returning({ id: departureBoatSafetySnapshots.id });
  return written.length > 0 ? "captured" : "kept_newer";
}

/**
 * The crew's pre-departure answer at the boat snapshot's instant (issue 2725):
 * the checklist lines as they stood at `asOf` and the wording of each whose
 * newest tap at or before `asOf` was not a check. Derived when the log is
 * read, never stored: taps are append-only and keep the time they were made,
 * so a tap synced from an offline tablet after the count (or a live tap that
 * committed after the count's read) still counts as of when it happened.
 */
export async function departureChecklistAnswer(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  asOf: Date,
): Promise<BoatChecklistAnswer> {
  const [items, checks] = await queryAll(db, [
    () => listChecklistItemsAsOf(db, shopId, asOf),
    () => latestPreDepartureChecksForTrip(db, shopId, tripId, asOf),
  ]);
  return {
    itemCount: items.length,
    unchecked: items.filter((item) => !checks.has(item.id)).map((item) => item.label),
  };
}

/**
 * Rebind known-unsailed safety provenance when the schedule changes. The
 * caller owns the trip row lock and writes its new start in this transaction.
 * Unknown provenance and already-sailed evidence remain unchanged.
 */
export async function rebindDepartureBoatSafetyTime(
  db: DbExecutor,
  shopId: string,
  tripId: string,
  previousStartsAt: Date,
  nextStartsAt: Date,
  asOf: Date = nowDate(),
): Promise<void> {
  if (hasSailed(previousStartsAt, asOf)) return;
  const [kept] = await db
    .select({ departureStartsAt: departureBoatSafetySnapshots.departureStartsAt })
    .from(departureBoatSafetySnapshots)
    .where(
      and(
        eq(departureBoatSafetySnapshots.shopId, shopId),
        eq(departureBoatSafetySnapshots.tripId, tripId),
      ),
    )
    .limit(1);
  if (!kept?.departureStartsAt || hasSailed(kept.departureStartsAt, asOf)) return;
  await db
    .update(departureBoatSafetySnapshots)
    .set({ departureStartsAt: nextStartsAt })
    .where(
      and(
        eq(departureBoatSafetySnapshots.shopId, shopId),
        eq(departureBoatSafetySnapshots.tripId, tripId),
      ),
    );
}

/** The departure-checkpoint snapshot of this departure's boat, or null if none was taken. */
export async function departureBoatSafetySnapshot(db: DbExecutor, shopId: string, tripId: string) {
  const [row] = await db
    .select({
      boatId: departureBoatSafetySnapshots.boatId,
      boatName: departureBoatSafetySnapshots.boatName,
      judgedOn: departureBoatSafetySnapshots.judgedOn,
      papers: departureBoatSafetySnapshots.papers,
      radio: departureBoatSafetySnapshots.radio,
      notices: departureBoatSafetySnapshots.notices,
      capturedAt: departureBoatSafetySnapshots.capturedAt,
    })
    .from(departureBoatSafetySnapshots)
    .where(
      and(
        eq(departureBoatSafetySnapshots.shopId, shopId),
        eq(departureBoatSafetySnapshots.tripId, tripId),
      ),
    )
    .limit(1);
  return row ?? null;
}
