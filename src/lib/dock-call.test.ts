import { describe, expect, it } from "vitest";
import { dockCallAt } from "./dock-call";
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
