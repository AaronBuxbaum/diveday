import { describe, expect, it } from "vitest";
import { moveServerClock, restoreBootClock } from "./rules";

describe("the harness clock", () => {
  it("restores the instant the server booted at after any number of moves", () => {
    const env: Record<string, string | undefined> = { DIVEDAY_CLOCK: "2026-07-21T13:30:00.000Z" };
    moveServerClock(new Date("2026-07-21T23:00:00.000Z"), env);
    moveServerClock(new Date("2026-07-22T01:00:00.000Z"), env);
    expect(env.DIVEDAY_CLOCK).toBe("2026-07-22T01:00:00.000Z");
    expect(restoreBootClock(env)).toBe(true);
    expect(env.DIVEDAY_CLOCK).toBe("2026-07-21T13:30:00.000Z");
  });

  it("does nothing when the clock never moved", () => {
    const env: Record<string, string | undefined> = { DIVEDAY_CLOCK: "2026-07-21T13:30:00.000Z" };
    expect(restoreBootClock(env)).toBe(false);
    expect(env.DIVEDAY_CLOCK).toBe("2026-07-21T13:30:00.000Z");
  });

  it("unfreezes a server that booted on the live clock", () => {
    const env: Record<string, string | undefined> = {};
    moveServerClock(new Date("2026-07-21T23:00:00.000Z"), env);
    expect(restoreBootClock(env)).toBe(true);
    expect(env.DIVEDAY_CLOCK).toBeUndefined();
  });
});
