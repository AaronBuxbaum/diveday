import type { DivePrepChecklist, HotelPickupRun } from "@/lib/dive-prep";
import type { LunchSummary } from "@/lib/lunch-aboard";

export type GearToPackInput = {
  checklist: Pick<
    DivePrepChecklist,
    "tanks" | "diverLines" | "lines" | "diversWithIncompleteFit" | "diversNeedingStaffFit"
  >;
  hotelPickups: readonly HotelPickupRun[];
  lunch?: Pick<LunchSummary, "count"> | null;
};

/** Gear to pack, the day before: the Gear page's own list, read as four lines. */
export type GearToPack = {
  tanks: { air: number; nitrox: number };
  /** Guests renting a set; how many of those sets have every size; who is fitted at the dock. */
  rentals: { total: number; sized: number; fitAtCheckIn: string[] };
  /** Null when nobody rents weights. */
  weights: { unsaid: string[] } | null;
  /** Lunches aboard, or null when the trip serves none. */
  lunch: number | null;
  pickups: number;
};

/**
 * **Gear to pack** (ADR 20261117-trip-page-clock, Getting ready): the packing
 * list the Gear page draws (`getTripPrep`), read as a summary, so the day
 * before says what is short without a second rule about gear. Codes and
 * counts; the page words them.
 */
export function gearToPack({ checklist, hotelPickups, lunch }: GearToPackInput): GearToPack {
  const renters = checklist.diverLines.filter(
    (line) => line.state === "rents" || line.state === "not_recorded",
  );
  const unsized = new Set([
    ...checklist.diversWithIncompleteFit.map((diver) => diver.personId),
    ...checklist.diversNeedingStaffFit.map((diver) => diver.personId),
  ]);
  const weightLines = checklist.lines.filter((line) => line.kind === "weights");
  return {
    tanks: { air: checklist.tanks.air, nitrox: checklist.tanks.nitrox },
    rentals: {
      total: renters.length,
      sized: renters.filter((line) => !unsized.has(line.personId)).length,
      fitAtCheckIn: checklist.diversNeedingStaffFit.map((diver) => diver.fullName),
    },
    weights:
      weightLines.length === 0
        ? null
        : {
            // A drysuit diver's lead is settled in the water, and a flagged diver's at the dock.
            unsaid: weightLines
              .filter(
                (line) => line.size === null && !line.drysuitWeightCheck && !line.fitAtCheckIn,
              )
              .flatMap((line) => line.divers.map((diver) => diver.fullName)),
          },
    lunch: lunch?.count ?? null,
    pickups: hotelPickups.length,
  };
}
