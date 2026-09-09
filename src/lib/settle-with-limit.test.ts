import { describe, expect, it } from "vitest";
import { settleWithLimit } from "./settle-with-limit";

/** A promise a test can settle when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("settleWithLimit", () => {
  it("never has more than the limit in flight, at a day's worth of departures", async () => {
    // Twenty boats, which is the shape the demo shop never has and a busy shop
    // in season does — the count issue #1598 is about.
    const gates = Array.from({ length: 20 }, () => deferred<string>());
    let inFlight = 0;
    let peak = 0;
    const settled = settleWithLimit(gates, 3, async (gate) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await gate.promise;
      } finally {
        inFlight -= 1;
      }
    });

    // Nothing has been released yet, so the ceiling is all that can be running.
    await Promise.resolve();
    expect(peak).toBe(3);
    expect(inFlight).toBe(3);

    for (const gate of gates) gate.resolve("sheet");
    const results = await settled;
    expect(results).toHaveLength(20);
    expect(peak).toBe(3);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("returns results in the caller's order, not completion's", async () => {
    const results = await settleWithLimit([30, 20, 10, 0], 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `${index}:${delay}`;
    });
    expect(results.map((result) => (result.status === "fulfilled" ? result.value : null))).toEqual([
      "0:30",
      "1:20",
      "2:10",
      "3:0",
    ]);
  });

  /**
   * The property the paper day is built on: one departure deleted mid-request
   * throws `notFound()` from the composed manifest page, and that must cost the
   * captain one sheet rather than the whole day.
   */
  it("settles a rejection instead of taking the batch down with it", async () => {
    const boom = new Error("this departure was deleted");
    const results = await settleWithLimit(["a", "b", "c"], 2, async (item) => {
      if (item === "b") throw boom;
      return item.toUpperCase();
    });
    expect(results).toEqual([
      { status: "fulfilled", value: "A" },
      { status: "rejected", reason: boom },
      { status: "fulfilled", value: "C" },
    ]);
  });

  it("does no work and answers empty for an empty list", async () => {
    let calls = 0;
    expect(
      await settleWithLimit([], 3, async () => {
        calls += 1;
        return calls;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it("refuses a ceiling below one rather than hanging", async () => {
    await expect(settleWithLimit([1], 0, async (item) => item)).rejects.toThrow(RangeError);
  });
});
