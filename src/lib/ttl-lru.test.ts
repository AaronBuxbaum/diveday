import { describe, expect, it } from "vitest";
import { TtlLru } from "./ttl-lru";

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
