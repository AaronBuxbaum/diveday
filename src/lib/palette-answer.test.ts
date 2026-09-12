import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { paletteAnswerView, paletteQueryNames } from "./palette-answer";

const t = staffTranslator("en-US");
const ctx = { shopSlug: "blue-mantis", locale: "en-US", timeZone: "America/New_York", t };
const TODAY = "2026-08-27";

/** ADR 20260906-before-you-ask, decision 3: ask it, and it answers. */
describe("paletteQueryNames", () => {
  const grace = { id: "p-grace", fullName: "Grace Mensah" };
  const trip = { id: "t-1" };

  it("names a day first: 'sat' is Saturday before it is anyone's surname", () => {
    expect(
      paletteQueryNames({
        query: "sat",
        today: TODAY,
        locale: "en-US",
        divers: [grace],
        trips: [],
      }),
    ).toEqual({ kind: "day", date: "2026-08-29" });
  });

  it("names one diver only when the results hold exactly one and no departure", () => {
    expect(
      paletteQueryNames({
        query: "gra",
        today: TODAY,
        locale: "en-US",
        divers: [grace],
        trips: [],
      }),
    ).toEqual({ kind: "diver", personId: "p-grace", fullName: "Grace Mensah" });
    expect(
      paletteQueryNames({
        query: "gra",
        today: TODAY,
        locale: "en-US",
        divers: [grace, { id: "p-2", fullName: "Graham Ellis" }],
        trips: [],
      }),
    ).toBeNull();
    expect(
      paletteQueryNames({
        query: "gra",
        today: TODAY,
        locale: "en-US",
        divers: [grace],
        trips: [trip],
      }),
    ).toBeNull();
  });

  it("names one departure the same way, and nothing on a short or empty query", () => {
    expect(
      paletteQueryNames({
        query: "night",
        today: TODAY,
        locale: "en-US",
        divers: [],
        trips: [trip],
      }),
    ).toEqual({ kind: "departure", tripId: "t-1" });
    expect(
      paletteQueryNames({ query: "n", today: TODAY, locale: "en-US", divers: [], trips: [trip] }),
    ).toBeNull();
    expect(
      paletteQueryNames({ query: "zzz", today: TODAY, locale: "en-US", divers: [], trips: [] }),
    ).toBeNull();
  });
});

describe("paletteAnswerView", () => {
  const startsAt = new Date("2026-08-27T11:00:00Z"); // 7:00 AM in New York

  it("reads a blocked diver's primary act off the fix table, as a door, never a send", () => {
    const view = paletteAnswerView(
      {
        kind: "diver",
        personId: "p-grace",
        fullName: "Grace Mensah",
        next: {
          bookingId: "b-1",
          tripId: "t-1",
          tripTitle: "Two-Tank Reef",
          startsAt,
          status: "blocked",
          blockers: [{ code: "waiver_not_sent" }],
        },
      },
      ctx,
    );
    expect(view.title).toBe("Grace Mensah on the 7:00 AM Thu, Aug 27 · Two-Tank Reef");
    expect(view.lines[0]).toMatch(/^Blocked · /);
    // The home's row would send the waiver in place; the palette never
    // mutates, so the act is the roster row that does.
    expect(view.act).toEqual({
      label: "Open the roster",
      href: "/shop/blue-mantis/trips/t-1#booking-b-1",
    });
    expect(view.more).toEqual({
      label: "Open Grace Mensah’s record",
      href: "/shop/blue-mantis/divers/p-grace",
    });
  });

  it("points a card blocker at the record, and offers no second door to the same place", () => {
    const view = paletteAnswerView(
      {
        kind: "diver",
        personId: "p-grace",
        fullName: "Grace Mensah",
        next: {
          bookingId: "b-1",
          tripId: "t-1",
          tripTitle: "Two-Tank Reef",
          startsAt,
          status: "blocked",
          blockers: [{ code: "certification_pending" }],
        },
      },
      ctx,
    );
    expect(view.act.href).toBe("/shop/blue-mantis/divers/p-grace");
    expect(view.more).toBeNull();
  });

  it("says a day's board in counts and crew, with the board as the act and the add panel beneath", () => {
    const view = paletteAnswerView(
      { kind: "day", date: "2026-08-29", departures: 1, divers: 12, crew: ["Keiko", "Sal"] },
      ctx,
    );
    expect(view.title).toBe("Sat, Aug 29");
    expect(view.lines).toEqual(["1 departure · 12 divers", "Keiko and Sal"]);
    expect(view.act).toEqual({
      label: "Open Sat, Aug 29 on the board",
      href: "/shop/blue-mantis/schedule/board?date=2026-08-29",
    });
    expect(view.more?.href).toBe("/shop/blue-mantis/schedule/board?date=2026-08-29&add=1");
    expect(
      paletteAnswerView(
        { kind: "day", date: "2026-09-05", departures: 0, divers: 0, crew: [] },
        ctx,
      ).lines,
    ).toEqual(["Nothing on the board yet"]);
  });

  it("says a departure's seats and who is blocked", () => {
    const view = paletteAnswerView(
      {
        kind: "departure",
        tripId: "t-1",
        title: "Night Skiff",
        startsAt,
        booked: 5,
        capacity: 10,
        blocked: 0,
      },
      ctx,
    );
    expect(view.title).toBe("7:00 AM Night Skiff");
    expect(view.lines).toEqual(["Thu, Aug 27 · 5 of 10 booked · everyone ready"]);
    expect(view.act.href).toBe("/shop/blue-mantis/trips/t-1");
    expect(view.more?.href).toBe("/shop/blue-mantis/trips/t-1/manifest");
  });
});
