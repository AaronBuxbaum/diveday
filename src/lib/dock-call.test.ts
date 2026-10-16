import { describe, expect, it } from "vitest";
import { crewCallAt, dockCallAt } from "./dock-call";

describe("dockCallAt", () => {
  const sails = new Date("2030-08-01T13:00:00.000Z");

  it("is the departure minus the shop's lead time", () => {
    expect(dockCallAt(sails, 30)).toEqual(new Date("2030-08-01T12:30:00.000Z"));
    expect(dockCallAt(sails, 75)).toEqual(new Date("2030-08-01T11:45:00.000Z"));
  });

  it("is nothing when the shop asks for no lead time, or the setting is not a number", () => {
    expect(dockCallAt(sails, 0)).toBeNull();
    expect(dockCallAt(sails, -15)).toBeNull();
    expect(dockCallAt(sails, Number.NaN)).toBeNull();
  });
});

/** "At the dock 6:15 AM · leaves 7:00" on a crew member's week (item 47). */
describe("crewCallAt", () => {
  const sails = new Date("2030-08-01T13:00:00.000Z");
  const at = (iso: string) => new Date(`2030-08-01T${iso}:00.000Z`);

  it("is the divers' dock call when no shift says earlier", () => {
    expect(crewCallAt(sails, 30, [])).toEqual(at("12:30"));
    expect(crewCallAt(sails, 30, [{ startsAt: at("12:45"), endsAt: at("18:00") }])).toEqual(
      at("12:30"),
    );
  });

  it("is the start of their own shift when it covers the departure and starts earlier", () => {
    expect(crewCallAt(sails, 30, [{ startsAt: at("12:15"), endsAt: at("18:00") }])).toEqual(
      at("12:15"),
    );
  });

  it("ignores a shift that does not cover the departure", () => {
    expect(crewCallAt(sails, 30, [{ startsAt: at("06:00"), endsAt: at("10:00") }])).toEqual(
      at("12:30"),
    );
  });

  it("is null with no lead time and no covering shift", () => {
    expect(crewCallAt(sails, 0, [])).toBeNull();
  });
});
