import { describe, expect, it, vi } from "vitest";
import { createDemoEntryTiming } from "./demo-entry-timing";

describe("demo entry timing", () => {
  it("does not emit anything when the e2e harness is disabled", () => {
    const write = vi.fn();
    expect(createDemoEntryTiming(false, () => 0, write)).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("emits only fixed phase labels and durations with a local sequence", () => {
    const write = vi.fn();
    let now = 100;
    const timing = createDemoEntryTiming(true, () => now, write);
    if (!timing) throw new Error("timing not enabled");
    now = 125;
    timing.mark("entry.preflight");
    timing.record("schedule.step.17", 3.4);
    timing.record("customer@example.com", 1);
    timing.record("mint.cap", Number.NaN);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(/^demo-entry-timing \d+:\d+ entry\.preflight 25ms$/),
      expect.stringMatching(/^demo-entry-timing \d+:\d+ schedule\.step\.17 3ms$/),
    ]);
  });
});
