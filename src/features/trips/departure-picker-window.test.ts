import { describe, expect, it } from "vitest";
import { departurePickerWindow } from "./departure-picker-window";

const KEY_LARGO = "America/New_York";
// 2026-10-07 14:00 in Key Largo (EDT, UTC-4).
const NOW = new Date("2026-10-07T18:00:00.000Z");

describe("departurePickerWindow", () => {
  it("opens on today and tomorrow, starting now rather than at midnight", () => {
    const window = departurePickerWindow({ now: NOW, timeZone: KEY_LARGO, from: undefined });
    expect(window.today).toBe("2026-10-07");
    expect(window.day).toBe("2026-10-07");
    expect(window.start).toEqual(NOW);
    expect(window.end.toISOString()).toBe("2026-10-09T04:00:00.000Z");
    expect(window.earlier).toBeNull();
    expect(window.later).toBe("2026-10-09");
  });

  it("starts a later window at that day's midnight in the shop's zone", () => {
    const window = departurePickerWindow({ now: NOW, timeZone: KEY_LARGO, from: "2026-10-20" });
    expect(window.day).toBe("2026-10-20");
    expect(window.start.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-22T04:00:00.000Z");
    expect(window.earlier).toBe("2026-10-18");
    expect(window.later).toBe("2026-10-22");
  });

  it("never steps earlier than today", () => {
    const window = departurePickerWindow({ now: NOW, timeZone: KEY_LARGO, from: "2026-10-08" });
    expect(window.earlier).toBe("2026-10-07");
  });

  it.each([
    ["a past date", "2026-10-01"],
    ["a malformed date", "next tuesday"],
    ["an impossible date", "2026-02-31"],
    ["an empty value", ""],
  ])("reads %s as today", (_name, from) => {
    const window = departurePickerWindow({ now: NOW, timeZone: KEY_LARGO, from });
    expect(window.day).toBe("2026-10-07");
    expect(window.start).toEqual(NOW);
  });

  it("files a day by the shop's calendar, not the server's", () => {
    // 2026-10-08 01:30 UTC is still the 7th, 9:30 PM, in Key Largo.
    const lateEvening = new Date("2026-10-08T01:30:00.000Z");
    const window = departurePickerWindow({
      now: lateEvening,
      timeZone: KEY_LARGO,
      from: undefined,
    });
    expect(window.today).toBe("2026-10-07");
    expect(window.end.toISOString()).toBe("2026-10-09T04:00:00.000Z");
  });

  it("holds a spring-forward midnight to the day it opens", () => {
    // Santiago springs forward at midnight on 2026-09-06: 00:00 does not exist.
    const window = departurePickerWindow({
      now: new Date("2026-09-01T15:00:00.000Z"),
      timeZone: "America/Santiago",
      from: "2026-09-06",
    });
    expect(window.start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
  });
});
