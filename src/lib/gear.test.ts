import { describe, expect, it } from "vitest";
import { shiftCalendarDateMonths } from "./calendar-date";
import {
  GEAR_SERVICE_DUE_SOON_DAYS,
  GEAR_SERVICE_DUE_SOON_DIVES,
  gearKindRank,
  gearServiceState,
  pickDisplayReservation,
  rankUnitsForSize,
  reservationPhase,
  suggestNextDueOn,
  tripReservationWindow,
} from "./gear";

describe("shiftCalendarDateMonths", () => {
  it("adds whole months", () => {
    expect(shiftCalendarDateMonths("2026-03-15", 12)).toBe("2027-03-15");
    expect(shiftCalendarDateMonths("2026-03-15", 60)).toBe("2031-03-15");
  });

  it("clamps to the destination month's last day instead of rolling over", () => {
    expect(shiftCalendarDateMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftCalendarDateMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(shiftCalendarDateMonths("2026-08-31", 3)).toBe("2026-11-30");
  });

  it("rolls years over", () => {
    expect(shiftCalendarDateMonths("2026-11-20", 3)).toBe("2027-02-20");
  });
});

describe("suggestNextDueOn", () => {
  it("suggests the conventional interval per clock", () => {
    expect(suggestNextDueOn("service", "2026-08-20")).toBe("2027-08-20");
    expect(suggestNextDueOn("visual_inspection", "2026-08-20")).toBe("2027-08-20");
    expect(suggestNextDueOn("o2_clean", "2026-08-20")).toBe("2027-08-20");
    expect(suggestNextDueOn("hydro_test", "2026-08-20")).toBe("2031-08-20");
  });

  it("suggests nothing for a condition note — it has no clock", () => {
    expect(suggestNextDueOn("note", "2026-08-20")).toBeNull();
  });
});

describe("gearServiceState", () => {
  const today = "2026-08-20";

  it("has no clock when nothing carries a deadline", () => {
    expect(gearServiceState([], today)).toEqual({ state: "no_clock" });
    expect(
      gearServiceState([{ kind: "note", servicedOn: "2026-08-01", nextDueOn: null }], today),
    ).toEqual({ state: "no_clock" });
  });

  it("is ok while the earliest deadline sits beyond the due-soon window", () => {
    expect(
      gearServiceState(
        [{ kind: "service", servicedOn: "2026-08-01", nextDueOn: "2027-08-01" }],
        today,
      ),
    ).toEqual({ state: "ok", kind: "service", nextDueOn: "2027-08-01" });
  });

  it("reads due soon inside the window, with days left", () => {
    const state = gearServiceState(
      [{ kind: "visual_inspection", servicedOn: "2025-09-01", nextDueOn: "2026-09-01" }],
      today,
    );
    expect(state).toEqual({
      state: "due_soon",
      kind: "visual_inspection",
      nextDueOn: "2026-09-01",
      daysLeft: 12,
    });
  });

  it("treats the boundary day as due soon, not overdue", () => {
    expect(
      gearServiceState([{ kind: "service", servicedOn: "2025-08-20", nextDueOn: today }], today),
    ).toMatchObject({ state: "due_soon", daysLeft: 0 });
    const edge = gearServiceState(
      [
        {
          kind: "service",
          servicedOn: "2025-08-20",
          nextDueOn: shiftCalendarDateMonths(today, 1) /* 2026-09-20, 31 days out */,
        },
      ],
      today,
    );
    expect(edge.state).toBe("ok");
    expect(GEAR_SERVICE_DUE_SOON_DAYS).toBe(30);
  });

  it("is overdue once the deadline passes, with days overdue", () => {
    expect(
      gearServiceState(
        [{ kind: "hydro_test", servicedOn: "2021-08-01", nextDueOn: "2026-08-01" }],
        today,
      ),
    ).toEqual({ state: "overdue", kind: "hydro_test", nextDueOn: "2026-08-01", daysOverdue: 19 });
  });

  it("lets the most urgent of independent clocks win — a lapsed VIP outranks a healthy hydro", () => {
    const state = gearServiceState(
      [
        { kind: "hydro_test", servicedOn: "2024-01-10", nextDueOn: "2029-01-10" },
        { kind: "visual_inspection", servicedOn: "2025-06-01", nextDueOn: "2026-06-01" },
      ],
      today,
    );
    expect(state).toMatchObject({ state: "overdue", kind: "visual_inspection" });
  });

  // "24 months or 100 dives, whichever comes first" is what manufacturers
  // publish, and a rental unit in season reaches the second number long before
  // the first.
  it("lets the dive clock run out first, on a date that is nowhere near due", () => {
    expect(
      gearServiceState(
        [
          {
            kind: "service",
            servicedOn: "2026-06-01",
            nextDueOn: "2028-06-01",
            nextDueDives: 100,
            divesSince: 104,
          },
        ],
        today,
      ),
    ).toMatchObject({
      state: "overdue",
      kind: "service",
      dives: { since: 104, due: 100 },
    });
  });

  it("reads due soon inside the last ten dives of the interval", () => {
    expect(
      gearServiceState(
        [
          {
            kind: "service",
            servicedOn: "2026-06-01",
            nextDueOn: "2028-06-01",
            nextDueDives: 100,
            divesSince: 91,
          },
        ],
        today,
      ),
    ).toMatchObject({ state: "due_soon", dives: { since: 91, due: 100 } });
    expect(GEAR_SERVICE_DUE_SOON_DIVES).toBe(10);
    // One dive earlier is still ok — the window is a window, not a slope.
    expect(
      gearServiceState(
        [
          {
            kind: "service",
            servicedOn: "2026-06-01",
            nextDueOn: "2028-06-01",
            nextDueDives: 100,
            divesSince: 89,
          },
        ],
        today,
      ),
    ).toMatchObject({ state: "ok" });
  });

  // The dive clock escalates and never relaxes: a unit well under its dive
  // count is not thereby fine, because its date can still have passed.
  it("keeps a passed date overdue even on a unit that has barely been dived", () => {
    expect(
      gearServiceState(
        [
          {
            kind: "service",
            servicedOn: "2025-06-01",
            nextDueOn: "2026-06-01",
            nextDueDives: 100,
            divesSince: 3,
          },
        ],
        today,
      ),
    ).toMatchObject({ state: "overdue", daysOverdue: 80 });
  });

  it("ignores a dive interval on a unit whose dives were never counted", () => {
    expect(
      gearServiceState(
        [
          {
            kind: "service",
            servicedOn: "2026-06-01",
            nextDueOn: "2028-06-01",
            nextDueDives: 100,
            divesSince: null,
          },
        ],
        today,
      ),
    ).toEqual({ state: "ok", kind: "service", nextDueOn: "2028-06-01" });
  });
});

describe("tripReservationWindow", () => {
  it("spans the departure's shop-local days", () => {
    // 6:00–13:00 local in Miami (UTC-4 in July) — one calendar day.
    const window = tripReservationWindow(
      {
        startsAt: new Date("2026-07-21T10:00:00.000Z"),
        endsAt: new Date("2026-07-21T17:00:00.000Z"),
      },
      "America/New_York",
    );
    expect(window).toEqual({ from: "2026-07-21", until: "2026-07-21" });
  });

  it("holds a multi-day course's kit for the whole run", () => {
    const window = tripReservationWindow(
      {
        startsAt: new Date("2026-07-21T12:00:00.000Z"),
        endsAt: new Date("2026-07-23T20:00:00.000Z"),
      },
      "America/New_York",
    );
    expect(window).toEqual({ from: "2026-07-21", until: "2026-07-23" });
  });

  it("reads the day in the shop's zone, not the server's", () => {
    // 20:00 UTC is already the 22nd in Tokyo.
    const window = tripReservationWindow(
      {
        startsAt: new Date("2026-07-21T20:00:00.000Z"),
        endsAt: new Date("2026-07-21T23:00:00.000Z"),
      },
      "Asia/Tokyo",
    );
    expect(window).toEqual({ from: "2026-07-22", until: "2026-07-22" });
  });

  it("never inverts a window when the rows disagree", () => {
    const window = tripReservationWindow(
      {
        startsAt: new Date("2026-07-21T10:00:00.000Z"),
        endsAt: new Date("2026-07-20T10:00:00.000Z"),
      },
      "America/New_York",
    );
    expect(window.until >= window.from).toBe(true);
  });
});

describe("reservationPhase", () => {
  const today = "2026-08-20";
  const base = { checkedOutAt: null, returnedAt: null };

  it("walks reserved → out → returned", () => {
    expect(reservationPhase({ ...base, reservedUntil: "2026-08-25" }, today)).toBe("reserved");
    expect(
      reservationPhase(
        { ...base, checkedOutAt: new Date("2026-08-20T14:00:00Z"), reservedUntil: "2026-08-25" },
        today,
      ),
    ).toBe("out");
    expect(
      reservationPhase(
        { ...base, returnedAt: new Date("2026-08-20T18:00:00Z"), reservedUntil: "2026-08-25" },
        today,
      ),
    ).toBe("returned");
  });

  it("reads due back today on the window's last day", () => {
    expect(reservationPhase({ ...base, reservedUntil: today }, today)).toBe("due_back_today");
  });

  it("splits a lapsed window on the handover stamp: out means overdue, on the wall means never picked up", () => {
    expect(
      reservationPhase(
        { ...base, checkedOutAt: new Date("2026-08-15T14:00:00Z"), reservedUntil: "2026-08-19" },
        today,
      ),
    ).toBe("overdue");
    expect(reservationPhase({ ...base, reservedUntil: "2026-08-19" }, today)).toBe(
      "never_picked_up",
    );
  });

  it("a returned reservation is settled whatever its dates say", () => {
    expect(
      reservationPhase(
        { ...base, returnedAt: new Date("2026-08-20T09:00:00Z"), reservedUntil: "2026-08-01" },
        today,
      ),
    ).toBe("returned");
  });
});

describe("rankUnitsForSize", () => {
  const units = [
    { label: "BCD #3", size: "L" },
    { label: "BCD #1", size: "M" },
    { label: "BCD #2", size: "m" },
    { label: "BCD #4", size: null },
  ];

  it("puts exact size matches first, case-insensitively, then unsized, then the rest", () => {
    expect(rankUnitsForSize(units, "M").map((unit) => unit.label)).toEqual([
      "BCD #1",
      "BCD #2",
      "BCD #4",
      "BCD #3",
    ]);
  });

  it("with no wanted size, unsized units lead and the rest stay alphabetical", () => {
    expect(rankUnitsForSize(units, null).map((unit) => unit.label)).toEqual([
      "BCD #4",
      "BCD #1",
      "BCD #2",
      "BCD #3",
    ]);
  });

  it("never mutates its input", () => {
    const before = [...units];
    rankUnitsForSize(units, "M");
    expect(units).toEqual(before);
  });
});

describe("pickDisplayReservation", () => {
  const today = "2026-08-20";
  const open = (from: string, until: string) => ({
    reservedFrom: from,
    reservedUntil: until,
    returnedAt: null as Date | null,
  });

  it("returns null when every reservation is settled", () => {
    expect(pickDisplayReservation([], today)).toBeNull();
    expect(
      pickDisplayReservation(
        [{ ...open("2026-08-01", "2026-08-02"), returnedAt: new Date("2026-08-02T21:00:00Z") }],
        today,
      ),
    ).toBeNull();
  });

  it("an overdue window outranks the one covering today", () => {
    const overdue = open("2026-08-10", "2026-08-15");
    const current = open("2026-08-20", "2026-08-21");
    expect(pickDisplayReservation([current, overdue], today)).toBe(overdue);
  });

  it("the window covering today outranks a future one", () => {
    const current = open("2026-08-19", "2026-08-21");
    const future = open("2026-09-01", "2026-09-02");
    expect(pickDisplayReservation([future, current], today)).toBe(current);
  });

  it("otherwise the nearest upcoming window wins", () => {
    const later = open("2026-09-10", "2026-09-11");
    const sooner = open("2026-08-25", "2026-08-26");
    expect(pickDisplayReservation([later, sooner], today)).toBe(sooner);
  });
});

describe("gearKindRank", () => {
  it("keeps the prep list's order for shared kinds and appends the register-only ones", () => {
    expect(gearKindRank("bcd")).toBeLessThan(gearKindRank("regulator"));
    expect(gearKindRank("gopro")).toBeLessThan(gearKindRank("tank"));
    expect(gearKindRank("tank")).toBeLessThan(gearKindRank("other"));
  });
});
