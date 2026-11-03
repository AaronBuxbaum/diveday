import {
  type assembleEveningClose,
  type DaySpine,
  type roleLensFor,
  spineJobCount,
} from "@/features/today";

/** Whether Today has a boat, task, previous demo close, or instructor session to show. */
export function hasTodayWorkToShow(
  spine: DaySpine,
  eveningClose: ReturnType<typeof assembleEveningClose>,
  lens: ReturnType<typeof roleLensFor>,
  hasSessions: boolean,
) {
  return (
    spineJobCount(spine) > 0 ||
    spine.stations.length > 0 ||
    eveningClose.carryover != null ||
    (lens === "sessions" && hasSessions)
  );
}
