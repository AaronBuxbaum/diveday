import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { buildDivePrepChecklist, rentalFitLine } from "@/lib/dive-prep";
import { tripReservationWindow } from "@/lib/gear";
import type { AppDb } from "./client";
import { countGearItemsByKind, listAvailableGearUnits, listTripGearAssignments } from "./gear";
import { listTripPrepDivers } from "./rental-fit";
import { getTripCrewIds, getTripWithBooked, listStaff } from "./trips";

/**
 * Everything the trip's Prep page is about, in one call — the pattern
 * `getTripManifests` already validates for Manifest and `getIncidentExport` for
 * Log. Prep, Overview and Guests each hand-assembled their own fan-out and then
 * derived on top of it, which put the join/filter/map that builds a `src/lib`
 * function's arguments outside every test: the `src/lib` modules themselves are
 * thoroughly unit-tested, and the four statements that decide what to pass them
 * were covered only by Playwright.
 *
 * **Takes the shop row rather than a shop id.** `getTripManifests` re-reads the
 * shop it was handed an id for, which is one of the duplicate round-trips issue
 * #632 counts; the caller has already resolved that row through
 * `requireShopSurface` before it can pick a locale, so asking for it here costs
 * nothing and removes a read instead of adding one.
 *
 * Returns `null` when the trip is absent so the page keeps its own `notFound()`.
 * Everything it returns is data — the words stay in the page (AGENTS.md).
 */

export type TripPrepShop = {
  id: string;
  timezone: string;
  rentalItems: string[];
};

export type TripPrep = {
  trip: NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
  checklist: ReturnType<typeof buildDivePrepChecklist>;
  /** Zero means the shop has no gear register at all, and none of it renders. */
  gearFleetTotal: number;
  /** Units free for this departure's whole window, bucketed by kind. */
  freeByKind: Map<string, Awaited<ReturnType<typeof listAvailableGearUnits>>>;
  /** One row per diver who either holds a unit or wants one this shop tags. */
  assignmentRows: {
    diver: Awaited<ReturnType<typeof listTripPrepDivers>>[number];
    assigned: NonNullable<ReturnType<Awaited<ReturnType<typeof listTripGearAssignments>>["get"]>>;
    wanted: Extract<ReturnType<typeof rentalFitLine>, { state: "rents" }>["items"];
  }[];
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
  const [divers, staff, crewIds, fleetByKind, assignmentsByBooking, freeUnits] = await Promise.all([
    listTripPrepDivers(db, shop.id, tripId),
    listStaff(db, shop.id),
    getTripCrewIds(db, shop.id, tripId),
    countGearItemsByKind(db, shop.id),
    listTripGearAssignments(db, shop.id, tripId),
    listAvailableGearUnits(db, shop.id, { ...gearWindow, todayLocal }),
  ]);

  // Only the crew who actually dive the trip need their own tank — a captain
  // or deckhand assigned for the boat stays dry and is not part of the plan.
  const divingCrew = staff
    .filter(
      (entry) =>
        crewIds.includes(entry.person.id) &&
        (entry.roles.includes("instructor") || entry.roles.includes("divemaster")),
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

  // The gear register's half of the page (ADR 20260815-minimal-gear-register).
  // Opt-in by presence: a shop with no units on the register sees none of it.
  const gearFleetTotal = [...fleetByKind.values()].reduce((sum, value) => sum + value, 0);
  const freeByKind = new Map<string, typeof freeUnits>();
  for (const unit of freeUnits) {
    const bucket = freeByKind.get(unit.kind) ?? [];
    bucket.push(unit);
    freeByKind.set(unit.kind, bucket);
  }

  const assignmentRows = divers
    .map((diver) => {
      const line = rentalFitLine(diver.fit);
      const assigned = assignmentsByBooking.get(diver.bookingId) ?? [];
      // Weights stay off: lead is bulk stock, never a tagged unit to be short
      // of (glossary, "Needs staff fit"). Kinds the fleet doesn't track at all
      // stay off too — no point offering a wetsuit picker to a shop that only
      // tags its regulators.
      const wanted =
        line.state === "rents"
          ? line.items.filter(
              (item) =>
                item.kind !== "weights" &&
                (fleetByKind.get(item.kind) ?? 0) > 0 &&
                !assigned.some((assignment) => assignment.kind === item.kind),
            )
          : [];
      return { diver, assigned, wanted };
    })
    .filter((row) => row.assigned.length > 0 || row.wanted.length > 0);

  return { trip, checklist, gearFleetTotal, freeByKind, assignmentRows };
}
