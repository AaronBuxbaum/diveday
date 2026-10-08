import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { divesOnTrip } from "@/lib/crew-roles";
import {
  buildDivePrepChecklist,
  buildHotelPickupList,
  type HotelPickupRun,
  rentalFitLine,
} from "@/lib/dive-prep";
import {
  type GearAssignmentNeed,
  type GearServiceState,
  gearAssignmentNeeds,
  gearServiceState,
  tripReservationWindow,
} from "@/lib/gear";
import { proposeRentalUnits } from "@/lib/gear-proposals";
import { rentsKind } from "@/lib/participant-types";
import type { AppDb } from "./client";
import {
  countGearItemsByKind,
  gearItemKindsById,
  latestServiceClocks,
  listAvailableGearUnits,
  listTripGearAssignments,
  openServiceConcerns,
  type TripGearAssignment,
} from "./gear";
import { listTripPrepDivers } from "./rental-fit";
import { getTripCrewAssignments, listStaff } from "./trips-crew";
import { getTripWithBooked } from "./trips-record";

export type TripPrepShop = {
  id: string;
  timezone: string;
  rentalItems: string[];
};

export type TripPrep = {
  trip: NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
  checklist: ReturnType<typeof buildDivePrepChecklist>;
  hotelPickups: HotelPickupRun[];
  /** Zero means the shop has no gear register at all, and none of it renders. */
  gearFleetTotal: number;
  /** Units free for this departure's whole window, bucketed by kind. */
  freeByKind: Map<string, Awaited<ReturnType<typeof listAvailableGearUnits>>>;
  /**
   * The cart this departure is loading: how much is on it, for how many
   * divers, and the two exceptions worth saying out loud (issue #1185).
   *
   * **Null when the shop has no gear register**, so the load-out cannot render
   * a cart for a shop that hands nothing over — the same opt-in-by-presence
   * rule `gearFleetTotal` states (ADR 20260815-minimal-gear-register).
   */
  loadOut: {
    units: number;
    divers: number;
    /** Sizes a diver asked for that no unit is against yet. */
    stillToPick: number;
    /**
     * Assigned units that need care before they go, each counted once: pulled
     * out of service since it was assigned, a lapsed service clock, or a
     * service concern from the last return nobody has answered since.
     */
    serviceFlagged: number;
  } | null;
  /** One row per diver who either holds a unit or wants one this shop tags. */
  assignmentRows: {
    diver: Awaited<ReturnType<typeof listTripPrepDivers>>[number];
    /**
     * The units this diver holds, each with what the picker said about its
     * care, so an assigned line keeps saying it once the pick is made.
     */
    assigned: (TripGearAssignment & { serviceState: GearServiceState; serviceConcern: boolean })[];
    wanted: GearAssignmentNeed[];
    /** Every unit on this row has left the counter — the whole set is out. */
    handedOver: boolean;
  }[];
  /**
   * The unit offered for each wanted piece the register can answer on its
   * own, keyed by `proposalKey(bookingId, kind)` (UX audit 2026-10-07, item
   * 9). A proposal, never a reservation: nothing is held until a staffer
   * confirms it. Empty on a cancelled departure, which reserves nothing.
   */
  proposals: Map<string, Awaited<ReturnType<typeof listAvailableGearUnits>>[number]>;
};

export async function getTripPrep(
  db: AppDb,
  shop: TripPrepShop,
  tripId: string,
  now: Date = nowDate(),
): Promise<TripPrep | null> {
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) return null;

  const gearWindow = tripReservationWindow(trip, shop.timezone);
  const todayLocal = calendarDateInTimezone(now, shop.timezone);
  const [divers, staff, crew, fleetByKind, assignmentsByBooking, freeUnits] = await Promise.all([
    listTripPrepDivers(db, shop.id, tripId),
    listStaff(db, shop.id),
    getTripCrewAssignments(db, shop.id, tripId),
    countGearItemsByKind(db, shop.id),
    listTripGearAssignments(db, shop.id, tripId),
    listAvailableGearUnits(db, shop.id, { ...gearWindow, todayLocal }),
  ]);

  // Only the crew who actually dive the trip need their own tank — a captain
  // or deckhand assigned for the boat stays dry and is not part of the plan.
  // The job rostered on *this* trip decides it, so a divemaster driving the
  // boat today gets no tank (issue #1851); with no job rostered, the standing
  // roles do (`divesOnTrip`, src/lib/crew-roles.ts).
  const tripRoleByPerson = new Map(crew.map((entry) => [entry.personId, entry.tripRole]));
  const divingCrew = staff
    .filter(
      (entry) =>
        tripRoleByPerson.has(entry.person.id) &&
        divesOnTrip({
          tripRole: tripRoleByPerson.get(entry.person.id),
          shopRoles: entry.roles,
        }),
    )
    .map((entry) => entry.person.fullName);

  const checklist = buildDivePrepChecklist({
    divers,
    plannedDives: trip.plannedDives,
    divingCrew,
    // The shop's own catalog, so "this diver is missing a size" is only ever
    // said about gear this shop still hands over (src/lib/rentals.ts).
    offeredKinds: shop.rentalItems,
  });

  const hotelPickups = buildHotelPickupList(divers);

  // The gear register's half of the page (ADR 20260815-minimal-gear-register).
  // Opt-in by presence: a shop with no units on the register sees none of it.
  const gearFleetTotal = [...fleetByKind.values()].reduce((sum, value) => sum + value, 0);
  const freeByKind = new Map<string, typeof freeUnits>();
  for (const unit of freeUnits) {
    const bucket = freeByKind.get(unit.kind) ?? [];
    bucket.push(unit);
    freeByKind.set(unit.kind, bucket);
  }

  // What each held unit's care says, read once for every unit on this
  // departure: the same clock and concern reads the picker's options carry
  // (`listAvailableGearUnits`), so a unit labeled in the picker stays labeled
  // once it is assigned (second dive-domain review of the proposals).
  const heldUnits = [...assignmentsByBooking.values()].flat();
  const [serviceClocks, concerns] = await Promise.all([
    latestServiceClocks(
      db,
      shop.id,
      heldUnits.map((assignment) => assignment.gearItemId),
    ),
    openServiceConcerns(
      db,
      shop.id,
      heldUnits.map((assignment) => ({ id: assignment.gearItemId, kind: assignment.kind })),
    ),
  ]);

  const assignmentRows = divers
    .map((diver) => {
      // The shop's own catalog, the same one the checklist above reads: a kind
      // the shop dropped must not send the picker hunting for a unit nobody is
      // handing over (`rentalFitLine`, src/lib/dive-prep.ts).
      const line = rentalFitLine(diver.fit, shop.rentalItems);
      const inDrysuit =
        line.state === "rents" && line.items.some((item) => item.kind === "drysuit");
      const assigned = (assignmentsByBooking.get(diver.bookingId) ?? []).map((assignment) => ({
        ...assignment,
        serviceState: gearServiceState(serviceClocks.get(assignment.gearItemId) ?? [], todayLocal),
        serviceConcern: concerns.has(assignment.gearItemId),
      }));
      // Weights stay off: lead is bulk stock, never a tagged unit to be short
      // of (glossary, "Needs staff fit"). Kinds the fleet doesn't track at all
      // stay off too — no point offering a wetsuit picker to a shop that only
      // tags its regulators.
      const wanted =
        line.state === "rents"
          ? line.items
              // A piece the catalog no longer offers still gets a picker.
              // Filtering it out was the obvious reading of issue #1804 and
              // the wrong one (`dive-domain-expert`, 2026-09-13):
              // `assignGearUnit` is the only door that creates a
              // booking-held reservation, so a shop that unticks drysuits
              // while six in-service suits hang on its wall could no longer
              // reserve one at all — the suit goes out on paper and the
              // register says "On the wall" while it is in a diver's car,
              // which breaks overdue and never-picked-up. The `notOffered`
              // marker on the line is the signal; closing the door is not.
              .flatMap((item) =>
                gearAssignmentNeeds(item).map((need) =>
                  // A drysuit diver's fins carry a shoe size that is a
                  // starting point, never the pull (`rentalFitLine`), and
                  // their gloves are wet or dry, still to settle. Neither
                  // is DiveDay's to propose.
                  item.drysuitFinFit || (need.kind === "gloves" && inDrysuit)
                    ? { ...need, sizeIsAStart: true as const }
                    : need,
                ),
              )
              .filter(
                (item) =>
                  // A rider takes nothing; a snorkeler only surface kit
                  // (ADR 20261007-participant-types). Units already held
                  // stay on the row whatever the type, so nothing is lost.
                  rentsKind(diver.participantType, item.kind) &&
                  item.kind !== "weights" &&
                  (fleetByKind.get(item.kind) ?? 0) > 0 &&
                  !assigned.some((assignment) => assignment.kind === item.kind),
              )
          : [];
      return {
        diver,
        assigned,
        wanted,
        handedOver:
          assigned.length > 0 && assigned.every((assignment) => assignment.checkedOutAt !== null),
      };
    })
    .filter((row) => row.assigned.length > 0 || row.wanted.length > 0);

  // The cart, derived from the rows rather than counted a second time: a
  // number the page and the rows could disagree about is worse than no number.
  const assignedUnits = assignmentRows.flatMap((row) => row.assigned);
  const loadOut =
    gearFleetTotal > 0
      ? {
          units: assignedUnits.length,
          divers: assignmentRows.length,
          stillToPick: assignmentRows.reduce((sum, row) => sum + row.wanted.length, 0),
          serviceFlagged: assignedUnits.filter(
            (assignment) =>
              assignment.status === "needs_service" ||
              assignment.serviceState.state === "overdue" ||
              assignment.serviceConcern,
          ).length,
        }
      : null;

  const proposals =
    trip.status === "cancelled"
      ? new Map()
      : proposeRentalUnits(
          assignmentRows.map((row) => ({
            bookingId: row.diver.bookingId,
            wanted: row.wanted,
            wantsNitrox: row.diver.wantsNitrox,
          })),
          freeByKind,
        );

  return {
    trip,
    checklist,
    hotelPickups,
    gearFleetTotal,
    freeByKind,
    loadOut,
    assignmentRows,
    proposals,
  };
}

export type GearPick = { bookingId: string; gearItemId: string };

/**
 * **The picks this departure still wants, read fresh before anything is
 * reserved** (dive-domain review of the Gear tab's proposals).
 *
 * A Gear tab left open is a list of what the boat wanted when it loaded. A
 * pick from it is kept only when its booking is still on this departure and
 * still wants a unit of that kind: not when the diver already holds one (a
 * colleague assigned BCD #7 from another tab, and this tab still proposes
 * BCD #4), and not for a kind the diver never asked for. Within one request
 * the first pick for a booking's kind is the one kept.
 *
 * A **proposed** pick (`options.proposed`) is also re-read for care: one
 * whose unit, still free, now has a lapsed service clock or an open service
 * concern is refused and counted in `needsCare` as well as `refused`. A
 * proposal was offered because neither was true when the page loaded, so a
 * staffer confirming it never knowingly chose a labeled unit. A hand pick
 * from the picker saw the label in the option and may still choose it: the
 * dock decides (H-06).
 *
 * Availability is still not checked here: the exclusion constraint inside
 * `reserveGearUnit` stays the only thing that can say a unit is free. A
 * proposed unit no longer in the free list is left for that write to refuse,
 * so its row says why in that write's own words.
 */
export async function screenGearPicks<P extends GearPick>(
  db: AppDb,
  shop: TripPrepShop,
  tripId: string,
  picks: readonly P[],
  options: { proposed: boolean },
): Promise<{ kept: P[]; refused: number; needsCare: number }> {
  const [prep, kinds] = await Promise.all([
    getTripPrep(db, shop, tripId),
    gearItemKindsById(
      db,
      shop.id,
      picks.map((pick) => pick.gearItemId),
    ),
  ]);
  if (!prep) return { kept: [], refused: picks.length, needsCare: 0 };
  const wants = new Map(
    prep.assignmentRows.map((row) => [
      row.diver.bookingId,
      new Set<string>(row.wanted.map((need) => need.kind)),
    ]),
  );
  // The same reading the page's proposals came from (`listAvailableGearUnits`
  // inside `getTripPrep`), taken now rather than when the tab loaded.
  const freeUnits = new Map(
    [...prep.freeByKind.values()].flat().map((unit) => [unit.id, unit] as const),
  );
  const kept: P[] = [];
  let needsCare = 0;
  for (const pick of picks) {
    const kind = kinds.get(pick.gearItemId);
    const wanted = wants.get(pick.bookingId);
    if (!kind || !wanted?.has(kind)) continue;
    if (options.proposed) {
      const unit = freeUnits.get(pick.gearItemId);
      if (unit && (unit.serviceState.state === "overdue" || unit.serviceConcern)) {
        needsCare += 1;
        continue;
      }
    }
    wanted.delete(kind);
    kept.push(pick);
  }
  return { kept, refused: picks.length - kept.length, needsCare };
}
