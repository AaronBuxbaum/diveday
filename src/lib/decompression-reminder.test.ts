import { describe, expect, it } from "vitest";
import { needsDecompressionCardReminder } from "./decompression-reminder";

describe("needsDecompressionCardReminder", () => {
  it("fires on a decompression departure with a diver aboard", () => {
    expect(needsDecompressionCardReminder(true, ["diver"])).toBe(true);
    expect(needsDecompressionCardReminder(true, ["rider", "snorkeler", "diver"])).toBe(true);
  });

  it("reads an absent type as a diver, the stricter reading", () => {
    expect(needsDecompressionCardReminder(true, [undefined])).toBe(true);
    expect(needsDecompressionCardReminder(true, [null])).toBe(true);
  });

  it("stays silent on a departure nobody marked as decompression diving", () => {
    expect(needsDecompressionCardReminder(false, ["diver"])).toBe(false);
    expect(needsDecompressionCardReminder(undefined, ["diver"])).toBe(false);
  });

  it("stays silent when only snorkelers and riders are booked", () => {
    expect(needsDecompressionCardReminder(true, ["snorkeler", "rider"])).toBe(false);
    expect(needsDecompressionCardReminder(true, ["rider"])).toBe(false);
  });

  it("stays silent on an empty boat", () => {
    expect(needsDecompressionCardReminder(true, [])).toBe(false);
  });
});
