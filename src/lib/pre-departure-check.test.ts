import { describe, expect, it } from "vitest";
import { latestPreDepartureCheck } from "./pre-departure-check";

describe("latestPreDepartureCheck", () => {
  it("returns undefined for no history", () => {
    expect(latestPreDepartureCheck([])).toBeUndefined();
  });

  it("returns the sole checked event", () => {
    const event = { status: "checked" as const, occurredAt: "2026-08-24T07:00:00.000Z" };
    expect(latestPreDepartureCheck([event])).toBe(event);
  });

  it("picks the newest event by occurredAt, checked or cleared", () => {
    const first = { status: "checked" as const, occurredAt: "2026-08-24T07:00:00.000Z" };
    const second = { status: "checked" as const, occurredAt: "2026-08-24T07:05:00.000Z" };
    expect(latestPreDepartureCheck([first, second])).toBe(second);
    expect(latestPreDepartureCheck([second, first])).toBe(second);
  });

  it("collapses to undefined when the newest event is a retraction", () => {
    const checked = { status: "checked" as const, occurredAt: "2026-08-24T07:00:00.000Z" };
    const cleared = { status: "cleared" as const, occurredAt: "2026-08-24T07:05:00.000Z" };
    expect(latestPreDepartureCheck([checked, cleared])).toBeUndefined();
  });

  it("does not fall through to an older checked event once the newest is cleared", () => {
    // The same rule roll call's own readers apply: a retraction is not a
    // request to reveal what stood before it, it is a statement that nothing
    // stands here now.
    const events = [
      { status: "checked" as const, occurredAt: "2026-08-24T06:00:00.000Z" },
      { status: "cleared" as const, occurredAt: "2026-08-24T06:30:00.000Z" },
      { status: "checked" as const, occurredAt: "2026-08-24T07:00:00.000Z" },
    ];
    expect(latestPreDepartureCheck(events)).toBe(events[2]);
    expect(latestPreDepartureCheck(events.slice(0, 2))).toBeUndefined();
  });

  it("works with Date occurredAt values, not just ISO strings", () => {
    const first = { status: "checked" as const, occurredAt: new Date("2026-08-24T07:00:00.000Z") };
    const second = { status: "cleared" as const, occurredAt: new Date("2026-08-24T07:05:00.000Z") };
    expect(latestPreDepartureCheck([first, second])).toBeUndefined();
  });
});
