/**
 * **`Promise.allSettled` with a ceiling on how many are in flight** (issue
 * #1598).
 *
 * The paper day composes one packet per departure of today, and each packet is
 * roughly forty database round trips: `getTripOverview`'s fifteen parallel
 * reads, the manifest page's twelve and its field-guide follow-up, and the prep
 * page's own. Started all at once, a twenty-boat day is about eight hundred
 * queries from one request — against a pool of five connections
 * (`DEFAULT_POOL_MAX` in src/lib/db-pool-config.ts). They do not run at once;
 * they queue, and while they queue that one document owns the instance's whole
 * pool. Any staff role can open the page and hold refresh.
 *
 * So the day asks for a few boats at a time. Three keeps five connections busy
 * with a short queue behind them, and leaves the rest of the app able to reach
 * the database while a captain is printing.
 *
 * Two properties the caller depends on, both of them tested:
 *
 * - **Order is the caller's, not completion's.** Result `i` belongs to item
 *   `i`, so a document's sheets stay in clock order however the reads finish.
 * - **It never rejects.** A departure deleted between the day's list read and
 *   its own packet answers with `notFound()`, which throws; inside a plain
 *   `Promise.all` that one boat's absence becomes the *day's* answer and the
 *   captain gets a 404 instead of the other eleven sheets. Every outcome comes
 *   back settled, exactly as `Promise.allSettled` would hand it over, and
 *   `keptSheets` decides what to do with it.
 */
export async function settleWithLimit<Item, Value>(
  items: readonly Item[],
  limit: number,
  work: (item: Item, index: number) => Promise<Value>,
): Promise<PromiseSettledResult<Value>[]> {
  if (limit < 1) throw new RangeError(`settleWithLimit: limit must be at least 1, got ${limit}`);
  const results: PromiseSettledResult<Value>[] = new Array(items.length);
  let next = 0;
  // Each worker takes the next unclaimed index until there are none left, so a
  // slow item holds up only itself. `next` is read and incremented in one
  // synchronous step — there is no await between them, and JavaScript runs this
  // function's own statements to completion, so two workers cannot claim the
  // same index.
  const worker = async () => {
    for (;;) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      const item = items[index] as Item;
      try {
        results[index] = { status: "fulfilled", value: await work(item, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
