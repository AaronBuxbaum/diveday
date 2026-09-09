import { describe, expect, it } from "vitest";
import {
  assembleCrewSheet,
  buildCrewSheetCsv,
  type CrewSheetAssignment,
  crewSheetFileName,
  hoursFromMinutes,
  splitTipsEqually,
} from "./crew-sheet";

/**
 * The crew sheet's arithmetic (N-43). It is a bookkeeper's document, so the
 * property that matters most is not "the numbers are pretty" but **the tips
 * column adds back up to the month's tips** — a sheet that quietly loses three
 * cents a departure is worse than no sheet at all, because it looks right.
 */

const assignment = (
  overrides: Partial<CrewSheetAssignment> & Pick<CrewSheetAssignment, "tripId" | "personId">,
): CrewSheetAssignment => ({
  personName: "Crew",
  tripRole: null,
  minutes: 240,
  ...overrides,
});

describe("splitTipsEqually", () => {
  it("splits evenly when it divides", () => {
    expect([...splitTipsEqually(9000, ["a", "b", "c"])]).toEqual([
      ["a", 3000],
      ["b", 3000],
      ["c", 3000],
    ]);
  });

  it("hands the remainder cents out one each rather than dropping them", () => {
    const split = splitTipsEqually(1000, ["c", "a", "b"]);
    expect([...split.values()].reduce((sum, cents) => sum + cents, 0)).toBe(1000);
    // Stable order is by personId, not by the order they were assigned: two
    // crew can share a name, and the same month must produce the same file.
    expect([...split]).toEqual([
      ["a", 334],
      ["b", 333],
      ["c", 333],
    ]);
  });

  it("is exact for every crew size a boat can carry", () => {
    for (let crew = 1; crew <= 12; crew += 1) {
      for (const cents of [1, 7, 99, 100, 12345]) {
        const ids = Array.from({ length: crew }, (_, index) => `p${index}`);
        const split = splitTipsEqually(cents, ids);
        expect([...split.values()].reduce((sum, share) => sum + share, 0)).toBe(cents);
        // Nobody's share is more than a cent off anybody else's.
        const shares = [...split.values()];
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("splits nothing when there is nobody to split it between", () => {
    expect(splitTipsEqually(5000, []).size).toBe(0);
  });
});

describe("assembleCrewSheet", () => {
  it("counts a person's departures once each and sums their hours", () => {
    const rows = assembleCrewSheet({
      assignments: [
        assignment({ tripId: "t1", personId: "p1", personName: "Ana", minutes: 240 }),
        assignment({ tripId: "t2", personId: "p1", personName: "Ana", minutes: 180 }),
      ],
      tips: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: "p1", departures: 2, minutes: 420, tipsCents: 0 });
  });

  it("carries every job a person did across the month, in role order", () => {
    const rows = assembleCrewSheet({
      assignments: [
        assignment({ tripId: "t1", personId: "p1", personName: "Ana", tripRole: "crew" }),
        assignment({ tripId: "t2", personId: "p1", personName: "Ana", tripRole: "instructor" }),
        assignment({ tripId: "t3", personId: "p1", personName: "Ana", tripRole: "instructor" }),
        assignment({ tripId: "t4", personId: "p1", personName: "Ana", tripRole: null }),
      ],
      tips: [],
    });
    expect(rows[0]?.roles).toEqual(["instructor", "crew"]);
    expect(rows[0]?.roleUnspecified).toBe(true);
  });

  /**
   * **A departure with no tips.** The commonest row on the sheet: someone
   * worked, nobody tipped. It is a zero, never a blank and never an absence —
   * a bookkeeper reading a gap has to go and ask.
   */
  it("gives a crew member who took no tips a zero, not a gap", () => {
    const rows = assembleCrewSheet({
      assignments: [assignment({ tripId: "t1", personId: "p1", personName: "Ana" })],
      tips: [{ tripId: "t1", amountCents: 0 }],
    });
    expect(rows[0]?.tipsCents).toBe(0);
  });

  /**
   * **A crew member with no departures** never reaches this function at all —
   * the reader joins through `trip_assignments`, so somebody who worked
   * nothing in the month has no row to build. Pinned because the alternative
   * (a zero row per staff member on the payroll) is what would make this read
   * as a pay run rather than a record of the month.
   */
  it("prints nobody who worked no departures", () => {
    expect(assembleCrewSheet({ assignments: [], tips: [] })).toEqual([]);
  });

  it("splits one departure's tips across everyone who worked it", () => {
    const rows = assembleCrewSheet({
      assignments: [
        assignment({ tripId: "t1", personId: "p1", personName: "Ana" }),
        assignment({ tripId: "t1", personId: "p2", personName: "Ben" }),
      ],
      tips: [{ tripId: "t1", amountCents: 4001 }],
    });
    expect(rows.map((row) => row.tipsCents).reduce((sum, cents) => sum + cents, 0)).toBe(4001);
  });

  it("keeps a tip from a departure with no crew on its own line", () => {
    const rows = assembleCrewSheet({
      assignments: [assignment({ tripId: "t1", personId: "p1", personName: "Ana" })],
      tips: [
        { tripId: "t1", amountCents: 1000 },
        { tripId: "t-uncrewed", amountCents: 2500 },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.at(-1)).toMatchObject({ personId: null, departures: 0, tipsCents: 2500 });
    // The whole month's tips are still on the sheet.
    expect(rows.reduce((sum, row) => sum + row.tipsCents, 0)).toBe(3500);
  });

  it("orders crew by name for the reader, not by id", () => {
    const rows = assembleCrewSheet({
      assignments: [
        assignment({ tripId: "t1", personId: "zzz", personName: "Ana" }),
        assignment({ tripId: "t1", personId: "aaa", personName: "Ben" }),
      ],
      tips: [],
    });
    expect(rows.map((row) => row.personName)).toEqual(["Ana", "Ben"]);
  });
});

describe("hoursFromMinutes", () => {
  it("is a plain number a spreadsheet adds up", () => {
    expect(hoursFromMinutes(240)).toBe(4);
    expect(hoursFromMinutes(150)).toBe(2.5);
    expect(hoursFromMinutes(100)).toBe(1.67);
    expect(hoursFromMinutes(0)).toBe(0);
  });
});

describe("buildCrewSheetCsv", () => {
  const header = [
    "Crew member",
    "Role",
    "Departures",
    "Hours",
    "Tips",
    "Currency",
  ] as const satisfies readonly [string, string, string, string, string, string];

  const roleLabels = {
    instructor: "Instructor",
    divemaster: "Divemaster",
    captain: "Captain",
    crew: "Deck crew",
  } as const;

  const csv = (rows: Parameters<typeof buildCrewSheetCsv>[0]["rows"]) =>
    buildCrewSheetCsv({
      rows,
      currency: "usd",
      header,
      roleLabels,
      roleUnspecifiedLabel: "Job not set",
      unassignedLabel: "No crew recorded",
      joinRoles: (roles) => roles.join(", "),
    });

  it("writes the header the caller translated, then one line per crew member", () => {
    const out = csv(
      assembleCrewSheet({
        assignments: [
          assignment({
            tripId: "t1",
            personId: "p1",
            personName: "Ana Reyes",
            tripRole: "divemaster",
            minutes: 270,
          }),
        ],
        tips: [{ tripId: "t1", amountCents: 4250 }],
      }),
    );
    const lines = out.trim().split("\r\n");
    expect(lines[0]).toBe("Crew member,Role,Departures,Hours,Tips,Currency");
    expect(lines[1]).toBe("Ana Reyes,Divemaster,1,4.5,42.5,USD");
  });

  /**
   * The numbers stay machine-readable even though the words are translated:
   * a bookkeeper's spreadsheet sums a column of `42.5`, and would read a
   * localized `42,50 €` as text.
   */
  it("keeps money and hours as plain decimals, with the currency in its own column", () => {
    const out = csv([
      {
        personId: "p1",
        personName: "Ana",
        roles: ["captain"],
        roleUnspecified: false,
        departures: 3,
        minutes: 95,
        tipsCents: 1234,
      },
    ]);
    expect(out.trim().split("\r\n")[1]).toBe("Ana,Captain,3,1.58,12.34,USD");
  });

  it("names the unassigned remainder rather than leaving the line blank", () => {
    const out = csv([
      {
        personId: null,
        personName: null,
        roles: [],
        roleUnspecified: false,
        departures: 0,
        minutes: 0,
        tipsCents: 2500,
      },
    ]);
    expect(out.trim().split("\r\n")[1]).toBe("No crew recorded,,0,0,25,USD");
  });

  /**
   * A crew member's name is typed by a person, and this file is opened in
   * Excel. `buildCsv` neutralizes a cell that would execute as a formula, and
   * the property is pinned *here* too because it is the one that matters for a
   * file that leaves the tenant: a regression in the shared serializer would
   * otherwise be caught only by a test about a different export.
   */
  it("neutralizes a crew name that would open as a spreadsheet formula", () => {
    const out = csv([
      {
        personId: "p1",
        personName: "=cmd|'/c calc'!A1",
        roles: [],
        roleUnspecified: false,
        departures: 1,
        minutes: 60,
        tipsCents: 0,
      },
    ]);
    expect(out).toContain("'=cmd");
    expect(out.trim().split("\r\n")[1]?.startsWith("=")).toBe(false);
  });

  it("quotes a crew member whose name carries a comma", () => {
    const out = csv([
      {
        personId: "p1",
        personName: "Reyes, Ana",
        roles: [],
        roleUnspecified: false,
        departures: 1,
        minutes: 60,
        tipsCents: 0,
      },
    ]);
    expect(out).toContain('"Reyes, Ana"');
  });
});

describe("crewSheetFileName", () => {
  it("sorts by month in a folder and survives a mail client", () => {
    expect(crewSheetFileName("blue-mantis", "2026-07")).toBe("crew-sheet-blue-mantis-2026-07.csv");
  });
});
