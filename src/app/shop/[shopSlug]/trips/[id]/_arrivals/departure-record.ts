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

/**
 * **What the Divers tab draws above and into its ledger**: the desk while
 * arrivals are open, or, once the departure is finished, its record (UX
 * review 2026-10-10, item 10). A finished departure has no desk: nobody is
 * checked in to a boat that is home. Its record is the crew's roll call, seat
 * by seat (`RosterRecord`). Neither on the Details tab.
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
    // The record, and under each seat what that diver could do next while the
    // boat is freshly home (fifth-loop ideas, item 4), read off the same roll
    // call so a diver not counted back aboard never gets a line.
    const { record, rollCall } = await departureRollCall(
      input.db,
      input.shopId,
      input.tripId,
      reading.unaccounted,
    );
    // When the crew said Home while that word stands (null when they have not).
    const homeAt = reading.shown?.stage === "home" ? reading.shown.recordedAt : null;
    const below = await sailedRebookBelow({ ...input, rollCall, homeAt });
    return { ...reading, desk: null, record: { ...record, below } };
  }
  return { ...reading, desk: await buildArrivalDesk(deskInput), record: undefined };
}

/**
 * The roll call a finished departure's record is filed from: each seat's
 * standing dock result, the seats with a standing after-dive result, whether
 * a dock roll call was taken at all, and the seats counted aboard while
 * blocked. Four reads keyed on one trip.
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
