import type { getTodayWork } from "./today-reader";

/** The roll-call rows Today raised for one departure (DOM-H3). */
export const rollCallRows = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
  work.actions.filter((action) => action.id.startsWith(`roll-call:${tripId}:`));
export const rollCallRow = (
  work: Awaited<ReturnType<typeof getTodayWork>>,
  tripId: string,
  reason: string,
) => work.actions.find((action) => action.id.startsWith(`roll-call:${tripId}:${reason}:`));
export const afterDiveRow = (work: Awaited<ReturnType<typeof getTodayWork>>, tripId: string) =>
  rollCallRow(work, tripId, "missing_diver") ?? rollCallRow(work, tripId, "after_dive_uncounted");
