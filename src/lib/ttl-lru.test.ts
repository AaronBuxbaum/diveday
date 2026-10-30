import { describe, expect, it, vi } from "vitest";
import { AsyncTtlCache, TtlLru } from "./ttl-lru";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("TtlLru", () => {
  it("returns what it was given until the TTL runs out, and nothing after", () => {
    const time = clock();
    const cache = new TtlLru<string>(10, 60_000, time.now);
    cache.set("a", "one");
    time.advance(59_999);
    expect(cache.get("a")).toBe("one");
    time.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("does not extend an entry's life by reading it", () => {
    const time = clock();
    const cache = new TtlLru<string>(10, 1_000, time.now);
    cache.set("a", "one");
    time.advance(900);
    expect(cache.get("a")).toBe("one");
    time.advance(200);
    expect(cache.get("a")).toBeUndefined();
  });

  it("holds at most its bound, dropping the least recently read first", () => {
    const time = clock();
    const cache = new TtlLru<number>(2, 60_000, time.now);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("forgets on delete and clear", () => {
    const cache = new TtlLru<number>(5, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("refuses a bound below one", () => {
    expect(() => new TtlLru(0, 1_000)).toThrow(RangeError);
  });
});

describe("AsyncTtlCache", () => {
  it("coalesces loads, bounds entries, and expires from settlement", async () => {
    const time = clock();
    const cache = new AsyncTtlCache<string, string>(2, time.now);
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => (resolve = done)));
    const first = cache.getOrLoad("a", load, { ttlMs: 100, ttlForValue: () => 10 });
    const joined = cache.getOrLoad("a", load, { ttlMs: 100 });
    expect(load).toHaveBeenCalledTimes(1);
    resolve("value");
    await expect(Promise.all([first, joined])).resolves.toEqual(["value", "value"]);

    time.advance(9);
    expect(await cache.getOrLoad("a", async () => "wrong", { ttlMs: 100 })).toBe("value");
    time.advance(1);
    expect(await cache.getOrLoad("a", async () => "fresh", { ttlMs: 100 })).toBe("fresh");
    await cache.getOrLoad("b", async () => "b", { ttlMs: 100 });
    await cache.getOrLoad("c", async () => "c", { ttlMs: 100 });
    expect(cache.size).toBe(2);
  });

  it("does not let an older load evict a concurrent replacement", async () => {
    const time = clock();
    const cache = new AsyncTtlCache<string, string>(2, time.now);
    let finishOld!: (value: string) => void;
    const old = cache.getOrLoad(
      "same",
      () => new Promise<string>((resolve) => (finishOld = resolve)),
      { ttlMs: 1 },
    );
    time.advance(1);
    expect(await cache.getOrLoad("same", async () => "new", { ttlMs: 100 })).toBe("new");
    finishOld("old");
    await old;
    expect(await cache.getOrLoad("same", async () => "wrong", { ttlMs: 100 })).toBe("new");
  });

  it("starts a negative TTL at settlement and leaves a newer replacement alone", async () => {
    const time = clock();
    const cache = new AsyncTtlCache<string, string | null>(2, time.now);
    let finishFailure!: (value: string | null) => void;
    const slowFailure = cache.getOrLoad(
      "slow",
      () => new Promise<string | null>((resolve) => (finishFailure = resolve)),
      {
        ttlMs: 24 * 60 * 60 * 1_000,
        ttlForValue: (value) => (value === null ? 60_000 : undefined),
      },
    );

    // The request takes two minutes, longer than the negative-result TTL.
    time.advance(120_000);
    finishFailure(null);
    await expect(slowFailure).resolves.toBeNull();
    const unexpectedRetry = vi.fn(async () => "wrong");
    await expect(
      cache.getOrLoad("slow", unexpectedRetry, {
        ttlMs: 24 * 60 * 60 * 1_000,
        ttlForValue: (value) => (value === null ? 60_000 : undefined),
      }),
    ).resolves.toBeNull();
    expect(unexpectedRetry).not.toHaveBeenCalled();

    time.advance(60_000);
    await expect(
      cache.getOrLoad("slow", async () => "recovered", {
        ttlMs: 24 * 60 * 60 * 1_000,
        ttlForValue: (value) => (value === null ? 60_000 : undefined),
      }),
    ).resolves.toBe("recovered");

    let finishLateFailure!: (value: string | null) => void;
    const lateFailure = cache.getOrLoad(
      "replace",
      () => new Promise<string | null>((resolve) => (finishLateFailure = resolve)),
      { ttlMs: 100, ttlForValue: (value) => (value === null ? 60_000 : undefined) },
    );
    time.advance(100);
    await expect(cache.getOrLoad("replace", async () => "newer", { ttlMs: 1_000 })).resolves.toBe(
      "newer",
    );
    finishLateFailure(null);
    await expect(lateFailure).resolves.toBeNull();
    await expect(cache.getOrLoad("replace", async () => "wrong", { ttlMs: 1_000 })).resolves.toBe(
      "newer",
    );
  });

  it("drops values callers mark uncacheable and rejected loads", async () => {
    const cache = new AsyncTtlCache<string, string | null>(2, () => 0);
    await cache.getOrLoad("partial", async () => null, {
      ttlMs: 100,
      shouldCache: (value) => value !== null,
    });
    await cache
      .getOrLoad("rejected", async () => Promise.reject(new Error("offline")), {
        ttlMs: 100,
      })
      .catch(() => undefined);
    expect(cache.size).toBe(0);
  });
});
