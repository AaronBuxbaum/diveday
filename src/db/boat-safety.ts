import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  type BoatSafetyNotice,
  boatPaperNotices,
  boatSafetyNotices,
  expiredBoatSafetyNotices,
  SAFETY_KIT_KINDS,
  type SafetyKitUnit,
  safetyKitNotices,
} from "@/lib/boat-safety";
import type { CalendarDate } from "@/lib/calendar-date";
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

/** Live safety-kit units, with their clocks, optionally only those aboard one hull. */
async function listSafetyKit(
  db: DbExecutor,
  shopId: string,
  aboardBoatId?: string,
): Promise<(SafetyKitUnit & { aboardBoatId: string | null })[]> {
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
        aboardBoatId ? eq(gearItems.aboardBoatId, aboardBoatId) : undefined,
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

export type DepartureBoatSafety = {
  boatId: string;
  boatName: string;
  notices: BoatSafetyNotice[];
};

/**
 * **What the pre-departure check says about this departure's boat**: the
 * people booked aboard against its certificate, its papers, and every clock on
 * the safety kit assigned aboard it that has run out or will within 30 days.
 *
 * `null` when the departure has no boat. A boat the shop has since deleted is
 * still read (its papers and its kit are history now, and say nothing), so a
 * past manifest keeps naming the hull it sailed on.
 */
export async function departureBoatSafety(
  db: DbExecutor,
  shopId: string,
  input: { boatId: string | null; passengersAboard: number; todayLocal: CalendarDate },
): Promise<DepartureBoatSafety | null> {
  if (!input.boatId) return null;
  const [boat] = await db
    .select({
      id: boats.id,
      name: boats.name,
      deletedAt: boats.deletedAt,
      certifiedPassengers: boats.certifiedPassengers,
      inspectionDueOn: boats.inspectionDueOn,
      registrationExpiresOn: boats.registrationExpiresOn,
      insuranceExpiresOn: boats.insuranceExpiresOn,
    })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, input.boatId)))
    .limit(1);
  if (!boat) return null;
  if (boat.deletedAt) return { boatId: boat.id, boatName: boat.name, notices: [] };
  const kit = await listSafetyKit(db, shopId, boat.id);
  return {
    boatId: boat.id,
    boatName: boat.name,
    notices: boatSafetyNotices({
      boat,
      kit,
      passengersAboard: input.passengersAboard,
      todayLocal: input.todayLocal,
    }),
  };
}

export type ExpiredBoatSafetyRow =
  | { subject: "boat"; boatId: string; name: string; notices: BoatSafetyNotice[] }
  | { subject: "kit"; gearItemId: string; label: string; notices: BoatSafetyNotice[] };

/**
 * **Everything that has already run out**, for Today's owner row: a live
 * boat's expired paper, and an expired clock on any live safety-kit unit,
 * aboard or ashore — an AED with dead pads on the shelf is still the AED the
 * shop will grab. One row per boat and one per unit, each carrying every
 * expired notice it has.
 */
export async function listExpiredBoatSafety(
  db: DbExecutor,
  shopId: string,
  todayLocal: CalendarDate,
): Promise<ExpiredBoatSafetyRow[]> {
  const fleet = await db
    .select({
      id: boats.id,
      name: boats.name,
      inspectionDueOn: boats.inspectionDueOn,
      registrationExpiresOn: boats.registrationExpiresOn,
      insuranceExpiresOn: boats.insuranceExpiresOn,
    })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(asc(boats.name));
  const rows: ExpiredBoatSafetyRow[] = [];
  for (const boat of fleet) {
    const notices = expiredBoatSafetyNotices(boatPaperNotices(boat, todayLocal));
    if (notices.length > 0) {
      rows.push({ subject: "boat", boatId: boat.id, name: boat.name, notices });
    }
  }
  for (const unit of await listSafetyKit(db, shopId)) {
    const notices = expiredBoatSafetyNotices(safetyKitNotices([unit], todayLocal));
    if (notices.length > 0) {
      rows.push({ subject: "kit", gearItemId: unit.id, label: unit.label, notices });
    }
  }
  return rows;
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
