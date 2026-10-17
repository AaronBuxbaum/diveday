import { describe, expect, it } from "vitest";
import { crewCallAt, dockCallAt } from "./dock-call";
import { formatTimeTz } from "./format";

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

/**
 * **Autumn fall-back day, America/New_York, 2026-11-01** (issue #2614): the
 * dock call is an instant, departure minus the lead time, so a departure in the
 * repeated 01:00 hour gets the right instant, and the zone abbreviation says
 * which pass through the hour it is.
 */
describe("dockCallAt on the fall-back day", () => {
  const say = (date: Date | null) => {
    if (!date) throw new Error("expected a dock call");
    return formatTimeTz(date, "en-US", "America/New_York").replace(/\s/g, " ");
  };

  it("names EST for a call inside the second pass through the hour", () => {
    const sails = new Date("2026-11-01T06:30:00.000Z"); // 01:30 EST
    const call = dockCallAt(sails, 30);
    expect(call).toEqual(new Date("2026-11-01T06:00:00.000Z"));
    expect(say(call)).toBe("1:00 AM EST");
  });

  it("names EDT for the same wall time one hour earlier, so the two never read alike", () => {
    const sails = new Date("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    const call = dockCallAt(sails, 30);
    expect(call).toEqual(new Date("2026-11-01T05:00:00.000Z"));
    expect(say(call)).toBe("1:00 AM EDT");
  });

  it("subtracts elapsed minutes across the change, not wall-clock minutes", () => {
    // Sails 01:15 EST; an hour of lead is 05:15Z, which reads 01:15 EDT, the
    // *same* wall time with a different zone. Wall-clock subtraction would say
    // 00:15 EDT, an hour early.
    const sails = new Date("2026-11-01T06:15:00.000Z");
    const call = dockCallAt(sails, 60);
    expect(call).toEqual(new Date("2026-11-01T05:15:00.000Z"));
    expect(say(call)).toBe("1:15 AM EDT");
  });
});

/**
 * "At the dock 6:15 AM · leaves 7:00" on a crew member's week (item 47), and
 * whose time it is (dive-domain review of layer r5-4, fix 4): the crew's only
 * when their own shift says so; otherwise it is the divers' call, and the line
 * says that rather than send crew to load tanks at the minute customers arrive.
 */
describe("crewCallAt", () => {
  const sails = new Date("2030-08-01T13:00:00.000Z");
  const at = (iso: string) => new Date(`2030-08-01T${iso}:00.000Z`);

  it("is the divers' dock call, named as theirs, when no shift covers the departure", () => {
    expect(crewCallAt(sails, 30, [])).toEqual({ at: at("12:30"), source: "divers" });
    expect(crewCallAt(sails, 30, [{ startsAt: at("06:00"), endsAt: at("10:00") }])).toEqual({
      at: at("12:30"),
      source: "divers",
    });
  });

  it("is the crew's own when their shift covers the departure", () => {
    expect(crewCallAt(sails, 30, [{ startsAt: at("12:15"), endsAt: at("18:00") }])).toEqual({
      at: at("12:15"),
      source: "shift",
    });
  });

  it("never asks crew later than the divers they meet", () => {
    expect(crewCallAt(sails, 30, [{ startsAt: at("12:45"), endsAt: at("18:00") }])).toEqual({
      at: at("12:30"),
      source: "shift",
    });
  });

  it("reads no shift that starts more than three hours before the departure", () => {
    // A long day's shift from 06:00 says nothing about when the 13:00 boat's
    // crew should be at the dock.
    expect(crewCallAt(sails, 30, [{ startsAt: at("09:59"), endsAt: at("18:00") }])).toEqual({
      at: at("12:30"),
      source: "divers",
    });
    expect(crewCallAt(sails, 30, [{ startsAt: at("10:00"), endsAt: at("18:00") }])).toEqual({
      at: at("10:00"),
      source: "shift",
    });
  });

  it("is null with no lead time and no covering shift", () => {
    expect(crewCallAt(sails, 0, [])).toBeNull();
    expect(crewCallAt(sails, 0, [{ startsAt: at("06:00"), endsAt: at("18:00") }])).toBeNull();
  });
});
