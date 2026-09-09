/**
 * **The sheets a document actually holds**, given one settled result per
 * departure asked for.
 *
 * A departure can go missing between the list read and its own: a manager taps
 * Delete on today's board while a captain's request for the paper day is in
 * flight. The composed manifest page answers a vanished trip the only way a
 * page can — `notFound()`, which throws — so a caller that awaits all of them
 * together gets the *day's* answer from one boat's absence, and the captain is
 * handed a 404 instead of the other eleven departures.
 *
 * So the day's page settles rather than races, and this is what it keeps: the
 * packets that resolved to something. It is exported and pure so that rule has
 * a test, because the race that produces it cannot be staged in a browser.
 */
export function keptSheets<T>(
  results: readonly PromiseSettledResult<T | null>[],
  ids: readonly string[],
): { id: string; packet: T }[] {
  return results.flatMap((result, index) =>
    result.status === "fulfilled" && result.value ? [{ id: ids[index], packet: result.value }] : [],
  );
}
