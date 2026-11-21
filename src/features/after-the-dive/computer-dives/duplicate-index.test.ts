import { describe, expect, it } from "vitest";
import type { ParsedComputerDive } from "@/lib/computer-import";
import { createDuplicateIndex } from "./duplicate-index";

const dive = (over: Record<string, unknown>) =>
  ({
    localDate: null,
    localStart: null,
    startInstant: null,
    ...over,
  }) as unknown as ParsedComputerDive;

describe("createDuplicateIndex", () => {
  it("matches on the same start instant or local start", () => {
    const index = createDuplicateIndex();
    index.add({ startInstant: "2026-01-01T08:00:00.000Z", localStart: "2026-01-01T09:00:00" });
    expect(index.matches(dive({ startInstant: "2026-01-01T08:00:00.000Z" }))).toBe(true);
    expect(index.matches(dive({ localStart: "2026-01-01T09:00:00" }))).toBe(true);
    expect(index.matches(dive({ startInstant: "2026-01-02T08:00:00.000Z" }))).toBe(false);
  });

  it("matches the same day only when one side knows just the date", () => {
    const index = createDuplicateIndex();
    index.add({ localStart: "2026-03-04T10:00:00" });
    expect(index.matches(dive({ localStart: "2026-03-04T15:00:00" }))).toBe(false);
    expect(index.matches(dive({ localDate: "2026-03-04" }))).toBe(true);
    index.add({ localDate: "2026-05-06" });
    expect(index.matches(dive({ localStart: "2026-05-06T07:00:00" }))).toBe(true);
    expect(index.matches(dive({}))).toBe(false);
  });
});
