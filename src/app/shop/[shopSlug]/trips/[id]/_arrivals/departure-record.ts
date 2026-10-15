import type { AppDb } from "@/db/client";
import {
  departureRollCallTakenTripIds,
  listAfterDiveRollCallByTrip,
  listCountedAboardBlockedByTrip,
  listDepartureRollCallByTrip,
  listUnaccountedForByTrip,
} from "@/db/manifests";
import type { latestTripStage } from "@/db/trip-stages";
import { departureStage } from "@/lib/trip-phase";
import type { RosterRecord } from "../_components/roster-model";
import { buildArrivalDesk } from "./arrival-desk";

/**
 * **What the Divers tab draws above and into its ledger**: the desk while
 * arrivals are open, or, once the departure is finished, its record (UX
 * review 2026-10-10, item 10). A finished departure has no desk: nobody is
 * checked in to a boat that is home. Its record is the crew's roll call, seat
 * by seat (`RosterRecord`). Neither on the Details tab.
 */
export async function diversTabState(
  input: Parameters<typeof buildArrivalDesk>[0] & {
    onDivers: boolean;
    finished: boolean;
    /** The seats said missing and not counted back (`readDepartureStage`). */
    unaccounted: ReadonlySet<string>;
  },
): Promise<{
  desk: Awaited<ReturnType<typeof buildArrivalDesk>>;
  record: RosterRecord | undefined;
}> {
  const { onDivers, finished, unaccounted, ...deskInput } = input;
  if (!onDivers) return { desk: null, record: undefined };
  if (finished)
    return {
      desk: null,
      record: await departureRecord(input.db, input.shopId, input.tripId, unaccounted),
    };
  return { desk: await buildArrivalDesk(deskInput), record: undefined };
}

/**
 * The roll call a finished departure's record is filed from: each seat's
 * standing dock result, the seats with a standing after-dive result, and
 * whether a dock roll call was taken at all. Three reads keyed on one trip.
 */
export async function departureRecord(
  db: AppDb,
  shopId: string,
  tripId: string,
  unaccounted: ReadonlySet<string>,
): Promise<RosterRecord> {
  const [dock, afterDive, taken, blocked] = await Promise.all([
    listDepartureRollCallByTrip(db, shopId, [tripId]),
    listAfterDiveRollCallByTrip(db, shopId, [tripId]),
    departureRollCallTakenTripIds(db, shopId, [tripId]),
    listCountedAboardBlockedByTrip(db, shopId, [tripId]),
  ]);
  return {
    dock: dock.get(tripId) ?? new Map(),
    afterDive: new Set(afterDive.get(tripId)?.keys() ?? []),
    rollCallTaken: taken.has(tripId),
    unaccounted,
    countedAboardBlocked: blocked.get(tripId) ?? new Map(),
  };
}

type StageReading = Awaited<ReturnType<typeof latestTripStage>>;

/**
 * **The departure stage both trip pages read**, with the one thing the clock
 * and the tap cannot say: whether a diver the crew counted out is still
 * unaccounted for (issue #2404). A boat does not read "home" with somebody
 * still in the water on the strength of the clock alone; only the crew's own
 * Home tap closes it over a missing diver (`departureStage`).
 */
export async function readDepartureStage(
  db: AppDb,
  shopId: string,
  tripId: string,
  reading: Omit<Parameters<typeof departureStage<NonNullable<StageReading>>>[0], "unaccountedFor">,
) {
  const unaccounted =
    (await listUnaccountedForByTrip(db, shopId, [tripId])).get(tripId) ?? new Set<string>();
  return {
    ...departureStage({ ...reading, unaccountedFor: unaccounted.size > 0 }),
    unaccounted: unaccounted as ReadonlySet<string>,
  };
}
