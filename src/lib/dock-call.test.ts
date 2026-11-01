import { describe, expect, it } from "vitest";
import { CREW_LEAD_LIMITS, crewCallAt, dockCallAt, parseCrewLeadMinutes } from "./dock-call";
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
 * whose time it is (dive-domain review of layer r5-4, fix 4): the crew's own
 * when their shift or the shop's crew time says so; otherwise it is the divers'
 * call, and the line says that rather than send crew to load tanks at the
 * minute customers arrive.
 */
describe("crewCallAt", () => {
  const sails = new Date("2030-08-01T13:00:00.000Z");
  const at = (iso: string) => new Date(`2030-08-01T${iso}:00.000Z`);
  const shift = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });
  /** A shop that set no crew time: the divers' call, named as theirs. */
  const unset = (dockCallMinutes: number) => ({ dockCallMinutes, crewLeadMinutes: null });

  it("is the divers' dock call, named as theirs, when no shift is running and no crew time is set", () => {
    expect(crewCallAt(sails, unset(30), [])).toEqual({ at: at("12:30"), source: "divers" });
    // Over before the call: says nothing about this boat.
    expect(crewCallAt(sails, unset(30), [shift("06:00", "10:00")])).toEqual({
      at: at("12:30"),
      source: "divers",
    });
  });

  it("is the crew's own when their shift starts before the divers' call", () => {
    expect(crewCallAt(sails, unset(30), [shift("12:15", "18:00")])).toEqual({
      at: at("12:15"),
      source: "shift",
    });
  });

  it("never asks crew later than the divers they meet, and names the divers' time as theirs", () => {
    expect(crewCallAt(sails, unset(30), [shift("12:45", "18:00")])).toEqual({
      at: at("12:30"),
      source: "divers",
    });
  });

  it("is null with no lead time, no crew time and no shift", () => {
    expect(crewCallAt(sails, unset(0), [])).toBeNull();
    expect(crewCallAt(sails, unset(0), [shift("06:00", "10:00")])).toBeNull();
  });

  it("is their shift when nothing else leads the departure", () => {
    expect(crewCallAt(sails, unset(0), [shift("06:00", "18:00")])).toEqual({
      at: at("06:00"),
      source: "shift",
    });
  });

  /**
   * Ux-delight sheet 2026-10-22, item 2 (H-20261022-crew-arrive-before-divers): "Crew arrive N minutes
   * before divers", shop-wide, default 30. An entered shift wins only when it
   * is earlier (dive-domain review of layer 1, findings 1 and 2).
   */
  describe("with the shop's crew time", () => {
    const shop = { dockCallMinutes: 30, crewLeadMinutes: 30 };

    it("puts crew at the dock that many minutes before the divers", () => {
      expect(crewCallAt(sails, shop, [])).toEqual({ at: at("12:00"), source: "crew" });
      expect(crewCallAt(sails, { dockCallMinutes: 45, crewLeadMinutes: 60 }, [])).toEqual({
        at: at("11:15"),
        source: "crew",
      });
    });

    it("lets a shift win only when it starts earlier than the crew time", () => {
      expect(crewCallAt(sails, shop, [shift("11:00", "18:00")])).toEqual({
        at: at("11:00"),
        source: "shift",
      });
      // The muster time typed as a shift: the crew time still stands.
      expect(crewCallAt(sails, shop, [shift("12:15", "18:00")])).toEqual({
        at: at("12:00"),
        source: "crew",
      });
      expect(crewCallAt(sails, shop, [shift("12:45", "18:00")])).toEqual({
        at: at("12:00"),
        source: "crew",
      });
    });

    describe("a 07:00 departure, never contradicting the person's own earlier shift", () => {
      const seven = at("07:00");

      it("a sunrise prep shift from 03:30 is their dock time", () => {
        expect(crewCallAt(seven, shop, [shift("03:30", "12:00")])).toEqual({
          at: at("03:30"),
          source: "shift",
        });
      });

      it("a fill shift ending as the boat leaves is their dock time", () => {
        expect(crewCallAt(seven, shop, [shift("05:00", "07:00")])).toEqual({
          at: at("05:00"),
          source: "shift",
        });
      });

      it("a shift over before the crew time says nothing", () => {
        expect(crewCallAt(seven, shop, [shift("03:00", "05:30")])).toEqual({
          at: at("06:00"),
          source: "crew",
        });
      });
    });

    it("counts back from the departure when divers have no dock call", () => {
      expect(crewCallAt(sails, { dockCallMinutes: 0, crewLeadMinutes: 30 }, [])).toEqual({
        at: at("12:30"),
        source: "crew",
      });
    });

    it("reads a zero, negative or non-number crew time as unset, never as a later call", () => {
      for (const crewLeadMinutes of [0, -15, Number.NaN]) {
        expect(crewCallAt(sails, { dockCallMinutes: 30, crewLeadMinutes }, [])).toEqual({
          at: at("12:30"),
          source: "divers",
        });
      }
    });
  });
});

describe("parseCrewLeadMinutes", () => {
  it("reads an empty field as unset", () => {
    expect(parseCrewLeadMinutes("")).toEqual({ ok: true, minutes: null });
    expect(parseCrewLeadMinutes("  ")).toEqual({ ok: true, minutes: null });
    expect(parseCrewLeadMinutes(null)).toEqual({ ok: true, minutes: null });
  });

  it("takes a whole number inside the bounds", () => {
    expect(parseCrewLeadMinutes("30")).toEqual({ ok: true, minutes: 30 });
    expect(parseCrewLeadMinutes(String(CREW_LEAD_LIMITS.min))).toEqual({
      ok: true,
      minutes: CREW_LEAD_LIMITS.min,
    });
    expect(parseCrewLeadMinutes(String(CREW_LEAD_LIMITS.max))).toEqual({
      ok: true,
      minutes: CREW_LEAD_LIMITS.max,
    });
  });

  it("refuses anything else rather than clamping it", () => {
    for (const raw of ["0", "4", "181", "12.5", "abc", "-30"]) {
      expect(parseCrewLeadMinutes(raw), raw).toEqual({ ok: false });
    }
  });
});
