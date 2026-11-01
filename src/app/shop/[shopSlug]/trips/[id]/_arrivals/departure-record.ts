import type { AppDb } from "@/db/client";
import {
  departureRollCallTakenTripIds,
  listAfterDiveRollCallByTrip,
  listCountedAboardBlockedByTrip,
  listDepartureRollCallByTrip,
  listUnaccountedForByTrip,
} from "@/db/manifests";
import type { SailedRollCall } from "@/db/sailed-rebooking";
import type { latestTripStage } from "@/db/trip-stages";
import { departureStage, type MeetingWindow } from "@/lib/trip-phase";
import type { RosterRecord } from "../_components/roster-model";
import { buildArrivalDesk } from "./arrival-desk";
import { sailedRebookBelow } from "./sailed-rebook-below";

/** The Divers tab shows the arrival desk while arrivals are open, then the
 * finished departure's roll-call record.
 */
export async function diversTabState(
  input: Parameters<typeof buildArrivalDesk>[0] & {
    trip: { endsAt: Date };
    onDivers: boolean;
    /** The crew's latest tap, whatever its age (`latestTripStage`). */
    stage: StageReading;
    cancelled: boolean;
    meetingWindows?: readonly MeetingWindow[];
  },
): Promise<
  Awaited<ReturnType<typeof readDepartureStage>> & {
    desk: Awaited<ReturnType<typeof buildArrivalDesk>>;
    record: RosterRecord | undefined;
  }
> {
  const { onDivers, stage, cancelled, meetingWindows, ...deskInput } = input;
  const reading = await readDepartureStage(input.db, input.shopId, input.tripId, {
    startsAt: input.trip.startsAt,
    endsAt: input.trip.endsAt,
    now: input.now,
    timeZone: input.timeZone,
    stage,
    cancelled,
    meetingWindows,
  });
  if (!onDivers) return { ...reading, desk: null, record: undefined };
  if (reading.finished) {
    // Rebooking lines use this same roll call; unaccounted divers get no line.
    const { record, rollCall } = await departureRollCall(
      input.db,
      input.shopId,
      input.tripId,
      reading.unaccounted,
    );
    // Keep the crew's Home timestamp for the rebooking offer, if recorded.
    const homeAt = reading.shown?.stage === "home" ? reading.shown.recordedAt : null;
    const below = await sailedRebookBelow({ ...input, rollCall, homeAt });
    return { ...reading, desk: null, record: { ...record, below } };
  }
  return { ...reading, desk: await buildArrivalDesk(deskInput), record: undefined };
}

/** Build the finished-departure record from shop- and trip-scoped dock,
 * after-dive, taken, and blocked-counted-aboard reads.
 */
export async function departureRollCall(
  db: AppDb,
  shopId: string,
  tripId: string,
  unaccounted: ReadonlySet<string>,
): Promise<{ record: RosterRecord; rollCall: SailedRollCall }> {
  const [dock, afterDive, taken, blocked] = await Promise.all([
    listDepartureRollCallByTrip(db, shopId, [tripId]),
    listAfterDiveRollCallByTrip(db, shopId, [tripId]),
    departureRollCallTakenTripIds(db, shopId, [tripId]),
    listCountedAboardBlockedByTrip(db, shopId, [tripId]),
  ]);
  const rollCall: SailedRollCall = {
    dock: dock.get(tripId) ?? new Map(),
    afterDive: afterDive.get(tripId) ?? new Map(),
  };
  return {
    record: {
      dock: rollCall.dock,
      afterDive: new Set(rollCall.afterDive.keys()),
      rollCallTaken: taken.has(tripId),
      unaccounted,
      countedAboardBlocked: blocked.get(tripId) ?? new Map(),
    },
    rollCall,
  };
}

type StageReading = Awaited<ReturnType<typeof latestTripStage>>;

/** Read departure timing and crew stage with shop-scoped unaccounted-diver
 * data; the clock alone cannot mark a departure home while someone is missing.
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
