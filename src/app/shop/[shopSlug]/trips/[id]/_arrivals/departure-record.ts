import type { AppDb } from "@/db/client";
import {
  departureRollCallTakenTripIds,
  listAfterDiveRollCallByTrip,
  listDepartureRollCallByTrip,
} from "@/db/manifests";
import type { RosterRecord } from "../_components/roster-model";
import { buildArrivalDesk } from "./arrival-desk";
import { sailedRebookBelow } from "./sailed-rebook-below";

/**
 * **What the Divers tab draws above and into its ledger**: the desk while
 * arrivals are open, or, once the departure is finished, its record (UX
 * review 2026-10-10, item 10). A finished departure has no desk: nobody is
 * checked in to a boat that is home. Its record is the crew's roll call, seat
 * by seat (`RosterRecord`). Neither on the Details tab.
 */
export async function diversTabState(
  input: Parameters<typeof buildArrivalDesk>[0] & { onDivers: boolean; finished: boolean },
): Promise<{
  desk: Awaited<ReturnType<typeof buildArrivalDesk>>;
  record: RosterRecord | undefined;
}> {
  const { onDivers, finished, ...deskInput } = input;
  if (!onDivers) return { desk: null, record: undefined };
  if (finished) {
    // The record, and under each seat what that diver could do next while the
    // boat is freshly home (fifth-loop ideas, item 4).
    const [record, below] = await Promise.all([
      departureRecord(input.db, input.shopId, input.tripId),
      sailedRebookBelow(input),
    ]);
    return { desk: null, record: { ...record, below } };
  }
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
): Promise<RosterRecord> {
  const [dock, afterDive, taken] = await Promise.all([
    listDepartureRollCallByTrip(db, shopId, [tripId]),
    listAfterDiveRollCallByTrip(db, shopId, [tripId]),
    departureRollCallTakenTripIds(db, shopId, [tripId]),
  ]);
  return {
    dock: dock.get(tripId) ?? new Map(),
    afterDive: new Set(afterDive.get(tripId)?.keys() ?? []),
    rollCallTaken: taken.has(tripId),
  };
}
