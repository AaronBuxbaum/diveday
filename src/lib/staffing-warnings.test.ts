import { describe, expect, it } from "vitest";
import {
  expiredKinds,
  holdsCurrent,
  LONG_DAY_HOURS,
  minutesOnDuty,
  staffingWarnings,
  type WarningDeparture,
  type WarningPerson,
} from "./staffing-warnings";

/** Key Largo: UTC-4 in October, so a late shift crosses the UTC date line. */
const TZ = "America/New_York";
/** Monday 2026-10-12, 06:00 local. */
const NOW = new Date("2026-10-12T10:00:00Z");

/** A local wall time on a day, as an instant (UTC-4). */
function at(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCHours((h ?? 0) + 4, m ?? 0);
  return date;
}

function person(overrides: Partial<WarningPerson> = {}): WarningPerson {
  return { personId: "p-1", name: "Keiko Tanaka", shifts: [], credentials: [], ...overrides };
}

function departure(overrides: Partial<WarningDeparture> = {}): WarningDeparture {
  return {
    tripId: "t-1",
    title: "1 pm reef",
    meetings: [{ startsAt: at("2026-10-14", "13:00"), endsAt: at("2026-10-14", "17:00") }],
    crew: ["p-1"],
    ...overrides,
  };
}

function warn(input: { departures?: WarningDeparture[]; people?: WarningPerson[]; now?: Date }) {
  return staffingWarnings({
    departures: input.departures ?? [],
    people: input.people ?? [],
    timeZone: TZ,
    now: input.now ?? NOW,
  });
}

describe("holdsCurrent", () => {
  it("counts an undated credential as current", () => {
    expect(
      holdsCurrent([{ kind: "oxygen_provider", renewsAt: null }], "oxygen_provider", "2030-01-01"),
    ).toBe(true);
  });

  it("is good through the end of its renewal day", () => {
    const creds = [{ kind: "oxygen_provider", renewsAt: "2026-10-14" }];
    expect(holdsCurrent(creds, "oxygen_provider", "2026-10-14")).toBe(true);
    expect(holdsCurrent(creds, "oxygen_provider", "2026-10-15")).toBe(false);
  });

  it("is satisfied by one current record among lapsed ones", () => {
    const creds = [
      { kind: "oxygen_provider", renewsAt: "2025-01-01" },
      { kind: "oxygen_provider", renewsAt: "2027-01-01" },
    ];
    expect(holdsCurrent(creds, "oxygen_provider", "2026-10-14")).toBe(true);
  });

  it("does not let another kind stand in", () => {
    expect(
      holdsCurrent([{ kind: "first_aid_cpr", renewsAt: null }], "oxygen_provider", "2026-10-14"),
    ).toBe(false);
  });

  it("treats a renewal that is not a real date as current", () => {
    expect(
      holdsCurrent(
        [{ kind: "oxygen_provider", renewsAt: "2026-02-31" }],
        "oxygen_provider",
        "2026-10-14",
      ),
    ).toBe(true);
  });
});

describe("expiredKinds", () => {
  it("names a kind whose every record lapsed, with the latest date", () => {
    expect(
      expiredKinds(
        [
          { kind: "first_aid_cpr", renewsAt: "2026-01-01" },
          { kind: "first_aid_cpr", renewsAt: "2026-06-01" },
          { kind: "oxygen_provider", renewsAt: "2027-01-01" },
        ],
        "2026-10-14",
      ),
    ).toEqual([{ kind: "first_aid_cpr", renewsAt: "2026-06-01" }]);
  });

  it("says nothing when an undated record of the kind exists", () => {
    expect(
      expiredKinds(
        [
          { kind: "first_aid_cpr", renewsAt: "2026-01-01" },
          { kind: "first_aid_cpr", renewsAt: null },
        ],
        "2026-10-14",
      ),
    ).toEqual([]);
  });
});

describe("minutesOnDuty", () => {
  it("takes the union of overlapping windows, not their sum", () => {
    const windows = [
      { startsAt: at("2026-10-14", "07:00"), endsAt: at("2026-10-14", "15:00") },
      { startsAt: at("2026-10-14", "08:00"), endsAt: at("2026-10-14", "12:00") },
    ];
    expect(minutesOnDuty(windows, "2026-10-14", TZ)).toBe(8 * 60);
  });

  it("adds windows that do not overlap", () => {
    const windows = [
      { startsAt: at("2026-10-14", "06:00"), endsAt: at("2026-10-14", "12:00") },
      { startsAt: at("2026-10-14", "13:00"), endsAt: at("2026-10-14", "20:00") },
    ];
    expect(minutesOnDuty(windows, "2026-10-14", TZ)).toBe(13 * 60);
  });

  it("clips a window to the shop's own day", () => {
    // 20:00 to 04:00 local: four hours on each side of local midnight.
    const windows = [{ startsAt: at("2026-10-14", "20:00"), endsAt: at("2026-10-15", "04:00") }];
    expect(minutesOnDuty(windows, "2026-10-14", TZ)).toBe(4 * 60);
    expect(minutesOnDuty(windows, "2026-10-15", TZ)).toBe(4 * 60);
  });
});

describe("staffingWarnings: aboard credentials", () => {
  const holder = person({
    personId: "p-2",
    name: "Ana Ruiz",
    credentials: [{ kind: "oxygen_provider", renewsAt: null }],
  });

  it("warns when nobody on the crew holds a current oxygen credential", () => {
    const warnings = warn({ departures: [departure()], people: [person(), holder] });
    expect(warnings).toEqual([
      {
        code: "missing_aboard",
        kind: "oxygen_provider",
        tripId: "t-1",
        title: "1 pm reef",
        startsAt: at("2026-10-14", "13:00"),
      },
    ]);
  });

  it("is quiet when one crew member holds it", () => {
    expect(
      warn({ departures: [departure({ crew: ["p-1", "p-2"] })], people: [person(), holder] }),
    ).toEqual([]);
  });

  it("is quiet for a shop that records no credential of the kind", () => {
    expect(warn({ departures: [departure()], people: [person()] })).toEqual([]);
  });

  it("warns when the only holder's credential lapses before the departure", () => {
    const lapsed = person({ credentials: [{ kind: "oxygen_provider", renewsAt: "2026-10-13" }] });
    const warnings = warn({ departures: [departure()], people: [lapsed] });
    expect(warnings.map((w) => w.code)).toContain("missing_aboard");
  });

  it("checks first aid as well, separately", () => {
    const o2Only = person({ credentials: [{ kind: "oxygen_provider", renewsAt: null }] });
    const cpr = person({
      personId: "p-3",
      name: "Zed Ortiz",
      credentials: [{ kind: "first_aid_cpr", renewsAt: null }],
    });
    const warnings = warn({ departures: [departure()], people: [o2Only, cpr] });
    expect(warnings).toEqual([
      expect.objectContaining({ code: "missing_aboard", kind: "first_aid_cpr" }),
    ]);
  });

  it("leaves an uncrewed departure to the week's Needs crew", () => {
    expect(warn({ departures: [departure({ crew: [] })], people: [holder] })).toEqual([]);
  });

  it("ignores a crew id that is not on the roster", () => {
    const warnings = warn({ departures: [departure({ crew: ["ghost"] })], people: [holder] });
    expect(warnings.map((w) => w.code)).toEqual(["missing_aboard"]);
  });

  it("says nothing about a departure already home", () => {
    const past = departure({
      meetings: [{ startsAt: at("2026-10-11", "08:00"), endsAt: at("2026-10-11", "12:00") }],
    });
    expect(warn({ departures: [past], people: [person(), holder] })).toEqual([]);
  });
});

describe("staffingWarnings: long days", () => {
  it("warns past twelve hours of shifts and departures in one day", () => {
    const captain = person({
      shifts: [{ startsAt: at("2026-10-14", "06:00"), endsAt: at("2026-10-14", "14:00") }],
    });
    const late = departure({
      meetings: [{ startsAt: at("2026-10-14", "15:00"), endsAt: at("2026-10-14", "20:00") }],
    });
    expect(warn({ departures: [late], people: [captain] })).toEqual([
      {
        code: "long_day",
        personId: "p-1",
        name: "Keiko Tanaka",
        day: "2026-10-14",
        minutes: 13 * 60,
      },
    ]);
  });

  it("is quiet at exactly twelve hours", () => {
    const captain = person({
      shifts: [{ startsAt: at("2026-10-14", "06:00"), endsAt: at("2026-10-14", "18:00") }],
    });
    expect(LONG_DAY_HOURS).toBe(12);
    expect(warn({ people: [captain] })).toEqual([]);
  });

  it("does not count a departure inside the shift twice", () => {
    const captain = person({
      shifts: [{ startsAt: at("2026-10-14", "06:00"), endsAt: at("2026-10-14", "17:00") }],
    });
    expect(warn({ departures: [departure()], people: [captain] })).toEqual([]);
  });

  it("counts somebody else's departure for nobody", () => {
    const captain = person({
      shifts: [{ startsAt: at("2026-10-14", "06:00"), endsAt: at("2026-10-14", "12:00") }],
    });
    expect(warn({ departures: [departure({ crew: ["p-9"] })], people: [captain] })).toEqual([]);
  });

  it("says nothing about a day already behind", () => {
    const captain = person({
      shifts: [{ startsAt: at("2026-10-11", "05:00"), endsAt: at("2026-10-11", "20:00") }],
    });
    expect(warn({ people: [captain] })).toEqual([]);
  });
});

describe("staffingWarnings: expired credentials", () => {
  it("names an expired credential on somebody crewing this week, once", () => {
    const lapsed = person({ credentials: [{ kind: "captains_licence", renewsAt: "2026-09-30" }] });
    const second = departure({
      tripId: "t-2",
      title: "Night dive",
      meetings: [{ startsAt: at("2026-10-15", "19:00"), endsAt: at("2026-10-15", "21:00") }],
    });
    expect(warn({ departures: [second, departure()], people: [lapsed] })).toEqual([
      {
        code: "credential_expired",
        personId: "p-1",
        name: "Keiko Tanaka",
        kind: "captains_licence",
        renewsAt: "2026-09-30",
        tripId: "t-1",
        title: "1 pm reef",
      },
    ]);
  });

  it("catches a credential that lapses between today and the departure", () => {
    const lapsing = person({ credentials: [{ kind: "captains_licence", renewsAt: "2026-10-13" }] });
    expect(warn({ departures: [departure()], people: [lapsing] }).map((w) => w.code)).toEqual([
      "credential_expired",
    ]);
  });

  it("is quiet for somebody expired who crews nothing", () => {
    const lapsed = person({ credentials: [{ kind: "captains_licence", renewsAt: "2026-09-30" }] });
    expect(warn({ departures: [departure({ crew: ["p-2"] })], people: [lapsed] })).toEqual([]);
  });

  it("orders departures before people, and people by name", () => {
    const zed = person({
      personId: "p-z",
      name: "Zed",
      credentials: [{ kind: "first_aid_cpr", renewsAt: "2026-01-01" }],
    });
    const amy = person({
      personId: "p-a",
      name: "Amy",
      credentials: [{ kind: "first_aid_cpr", renewsAt: "2026-01-01" }],
    });
    const warnings = warn({
      departures: [departure({ crew: ["p-z", "p-a"] })],
      people: [zed, amy],
    });
    expect(
      warnings.map((w) => (w.code === "missing_aboard" ? w.code : `${w.code}:${w.name}`)),
    ).toEqual(["missing_aboard", "credential_expired:Amy", "credential_expired:Zed"]);
  });
});
