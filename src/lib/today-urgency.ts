import { HOUR_MS } from "./clock";

/**
 * **How soon a Today row's work is due**, read off the departure it belongs to.
 * Split from `src/lib/today.ts` so a row builder in `src/db` asks the one
 * question it needs without taking the whole queue with it.
 */

/** How soon the work has to be done, derived from the departure it belongs to. */
export type TodayUrgency = "imminent" | "now" | "soon" | "later";

/** The next boat out — close enough that "later today" isn't precise enough. */
const IMMINENT_WINDOW_MS = 3 * HOUR_MS;
/** Anything departing inside a day is "get it done today" work. */
const NOW_WINDOW_MS = 24 * HOUR_MS;
const SOON_WINDOW_MS = 72 * HOUR_MS;

export function urgencyFor(dueAt: Date | null, now: Date): TodayUrgency {
  if (!dueAt) return "later";
  const delta = dueAt.getTime() - now.getTime();
  if (delta <= IMMINENT_WINDOW_MS) return "imminent";
  if (delta <= NOW_WINDOW_MS) return "now";
  if (delta <= SOON_WINDOW_MS) return "soon";
  return "later";
}
