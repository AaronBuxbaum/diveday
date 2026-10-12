import type { AppDb } from "@/db/client";
import { listDepartureBoardedBookingIds } from "@/db/manifests";
import type { RosterRecord } from "../_components/roster-model";
import { buildArrivalDesk } from "./arrival-desk";

/**
 * **What the Divers tab draws above and into its ledger**: the desk while
 * arrivals are open, or, once the departure is finished, its record (UX
 * review 2026-10-10, item 10). A finished departure has no desk: nobody is
 * checked in to a boat that is home. Its record is every booking the crew
 * boarded at the departure roll call, which the ledger files as "Sailed".
 * Neither on the Details tab.
 */
export async function diversTabState(
  input: Parameters<typeof buildArrivalDesk>[0] & { onDivers: boolean; finished: boolean },
): Promise<{
  desk: Awaited<ReturnType<typeof buildArrivalDesk>>;
  record: RosterRecord | undefined;
}> {
  const { onDivers, finished, ...deskInput } = input;
  if (!onDivers) return { desk: null, record: undefined };
  if (finished)
    return { desk: null, record: await departureRecord(input.db, input.shopId, input.tripId) };
  return { desk: await buildArrivalDesk(deskInput), record: undefined };
}

/** The bookings the crew boarded at this departure's roll call. */
export async function departureRecord(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<RosterRecord> {
  return { sailed: await listDepartureBoardedBookingIds(db, shopId, [tripId]) };
}
