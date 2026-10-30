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

type AsyncEntry<V> = { expiresAt: number; value: Promise<V> };

/**
 * A bounded cache for values loaded asynchronously. The entry is installed
 * before the loader settles, so concurrent callers share its promise. Callers
 * choose the TTL for the in-flight entry and the settled value, and whether a
 * settled value is worth retaining.
 */
export class AsyncTtlCache<K, V> {
  private readonly entries = new Map<K, AsyncEntry<V>>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {
    if (maxEntries < 1) throw new RangeError(`AsyncTtlCache: maxEntries must be at least 1`);
  }

  getOrLoad(
    key: K,
    load: () => Promise<V>,
    options: {
      ttlMs: number;
      /** Return a TTL to start at settlement, or `undefined` to keep request-start expiry. */
      ttlForValue?: (value: V) => number | undefined;
      shouldCache?: (value: V) => boolean;
    },
  ): Promise<V> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    if (cached) this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    const entry: AsyncEntry<V> = { expiresAt: this.now() + options.ttlMs, value: load() };
    this.entries.set(key, entry);
    void entry.value.then(
      (value) => {
        if (this.entries.get(key) !== entry) return;
        if (options.shouldCache?.(value) === false) {
          this.entries.delete(key);
          return;
        }
        const settledTtlMs = options.ttlForValue?.(value);
        if (settledTtlMs !== undefined) entry.expiresAt = this.now() + settledTtlMs;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return entry.value;
  }

  get size(): number {
    return this.entries.size;
  }
}
