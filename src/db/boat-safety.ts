import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  type BoatSafetyNotice,
  boatPaperNotices,
  boatSafetyNotices,
  departureSafetyDate,
  expiredBoatSafetyNotices,
  isLifeSafetyKitKind,
  kitMissingNotices,
  lifeSafetyNotices,
  SAFETY_KIT_KINDS,
  type SafetyKitUnit,
  safetyKitNotices,
} from "@/lib/boat-safety";
import type { CalendarDate } from "@/lib/calendar-date";
import type { GearItemKind } from "@/lib/gear";
import type { DbExecutor } from "./client";
import { latestServiceClocks } from "./gear";
import { boats, gearItems, trips } from "./schema";
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
 * people aboard against its certificate, its papers, the O2 kit or AED it
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
    onDate: CalendarDate;
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
      onDate: input.onDate,
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
  },
): Promise<DepartureBoatSafety | null> {
  const onDate = departureSafetyDate(input.startsAt, input.now, input.timeZone);
  if (!onDate) return null;
  return departureBoatSafety(db, shopId, {
    boatId: await departureBoatId(db, shopId, input.tripId),
    passengers: input.passengers,
    onDate,
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
