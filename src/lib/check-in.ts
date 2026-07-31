/**
 * Framework-free helpers for the counter check-in queue
 * (`src/app/shop/[shopSlug]/check-in/page.tsx` + `src/db/check-in.ts`).
 */

/**
 * True once every diver in today's queue has boarded — the trigger for
 * swapping the ordinary list for the "cleared queue" celebration (persona
 * task 71). An empty queue (no departures today, or a search with no
 * matches) is *not* a cleared queue — there is nothing to have cleared, so
 * this stays false and the page's plain empty state renders instead.
 */
export function allDiversCheckedIn(queue: readonly { bookingStatus: string }[]): boolean {
  return queue.length > 0 && queue.every((row) => row.bookingStatus === "checked_in");
}
