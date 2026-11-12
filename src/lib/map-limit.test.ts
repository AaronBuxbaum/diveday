import { describe, expect, it } from "vitest";
import { mapWithLimit } from "./map-limit";

describe("mapWithLimit", () => {
  it("never runs more than the limit at once and returns results in input order", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithLimit([5, 1, 4, 2, 3, 0], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 2;
    });
    expect(results).toEqual([10, 2, 8, 4, 6, 0]);
    expect(peak).toBe(3);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapWithLimit([], 3, async (n: number) => n)).toEqual([]);
    expect(await mapWithLimit([1, 2], 10, async (n) => n + 1)).toEqual([2, 3]);
  });

  it("rejects, and starts nothing new, once a call fails", async () => {
    const started: number[] = [];
    await expect(
      mapWithLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(started).not.toContain(6);
  });
});
