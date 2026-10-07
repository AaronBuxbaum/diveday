/**
 * A bounded, per-process map whose entries expire — the smallest cache that
 * can sit in front of a database read on a hot path without becoming a second
 * source of truth for longer than its TTL.
 *
 * - **Bounded.** At most `maxEntries`; the least recently read entry goes
 *   first. A crawler walking a million slugs costs this map `maxEntries` rows,
 *   not a million.
 * - **Expiring.** An entry older than `ttlMs` is never returned. Timed on a
 *   monotonic counter (`performance.now()` by default), not the app clock: the
 *   e2e fleet freezes that clock, and a frozen clock would make every entry
 *   immortal.
 * - **Per instance.** Nothing is shared between serverless instances; each
 *   warms its own. That is the point — no network hop, no invalidation
 *   protocol — and the reason a caller must be content with an answer up to
 *   `ttlMs` stale.
 */
export class TtlLru<V> {
  private readonly entries = new Map<string, { value: V; storedAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (maxEntries < 1) throw new RangeError(`TtlLru: maxEntries must be at least 1`);
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (this.now() - entry.storedAt >= this.ttlMs) return undefined;
    // Re-inserted so Map's insertion order is recency order.
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
