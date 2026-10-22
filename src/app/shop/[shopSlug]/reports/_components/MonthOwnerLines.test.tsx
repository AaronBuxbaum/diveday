// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { assembleCrewSheet, buildCrewSheetCsv, type CrewSheetAssignment } from "@/lib/crew-sheet";
import { parseCsv } from "@/lib/import";
import { DepartureMoney } from "./DepartureMoney";
import { tipsSplitLine, WeatherLine } from "./MonthOwnerLines";

afterEach(cleanup);

const t = staffTranslator("en-US");
const money = (cents: number) => `$${(cents / 100).toFixed(0)}`;

const assignment = (tripId: string, personId: string, personName: string): CrewSheetAssignment => ({
  tripId,
  personId,
  personName,
  tripRole: null,
  minutes: 0,
});

const sharedCrew = [assignment("t1", "k", "Keiko"), assignment("t1", "s", "Sal")];

const reportTipLine = (
  rows: ReturnType<typeof assembleCrewSheet>,
  currency: string,
  locale = "en-US",
) => tipsSplitLine(rows, staffTranslator(locale), currency, locale)?.replace(/\u00a0/g, " ");

const crewExport = (rows: ReturnType<typeof assembleCrewSheet>, currency: string) =>
  parseCsv(
    buildCrewSheetCsv({
      rows,
      currency,
      header: ["Crew member", "Role", "Departures", "Hours", "Tips", "Currency"],
      roleLabels: {
        instructor: "Instructor",
        divemaster: "Divemaster",
        captain: "Captain",
        crew: "Crew",
      },
      roleUnspecifiedLabel: "Job not set",
      unassignedLabel: "No crew recorded",
      joinRoles: (roles) => roles.join(", "),
    }),
  )
    .slice(1)
    .filter((row) => row.length > 1)
    .map((row) => [row[0], row[4], row[5]]);

describe("tipsSplitLine (item 31)", () => {
  it("shows two $337.50 shares of a $675 pool, matching the crew export", () => {
    const rows = assembleCrewSheet({
      assignments: sharedCrew,
      tips: [{ tripId: "t1", amountCents: 67_500 }],
    });
    expect(reportTipLine(rows, "usd")).toBe("Equal shares: Keiko $337.50 · Sal $337.50");
    expect(crewExport(rows, "usd")).toEqual([
      ["Keiko", "337.5", "USD"],
      ["Sal", "337.5", "USD"],
    ]);
    expect(rows.reduce((sum, row) => sum + row.tipsCents, 0)).toBe(67_500);
  });

  it("shows the stable odd-cent remainder instead of rounding both shares up", () => {
    const rows = assembleCrewSheet({
      assignments: [...sharedCrew].reverse(),
      tips: [{ tripId: "t1", amountCents: 67_501 }],
    });
    expect(reportTipLine(rows, "usd")).toBe("Equal shares: Keiko $337.51 · Sal $337.50");
    expect(crewExport(rows, "usd")).toEqual([
      ["Keiko", "337.51", "USD"],
      ["Sal", "337.5", "USD"],
    ]);
    expect(rows.reduce((sum, row) => sum + row.tipsCents, 0)).toBe(67_501);
  });

  it("keeps zero-decimal currency shares in whole minor units, including the remainder", () => {
    const rows = assembleCrewSheet({
      assignments: sharedCrew,
      tips: [{ tripId: "t1", amountCents: 675 }],
    });
    expect(reportTipLine(rows, "jpy")).toBe("Equal shares: Keiko ¥338 · Sal ¥337");
    expect(crewExport(rows, "jpy")).toEqual([
      ["Keiko", "338", "JPY"],
      ["Sal", "337", "JPY"],
    ]);
    expect(rows.reduce((sum, row) => sum + row.tipsCents, 0)).toBe(675);
  });

  it("reconciles different departure crews and unassigned tips with the exported month", () => {
    const rows = assembleCrewSheet({
      assignments: [...sharedCrew, assignment("t2", "s", "Sal"), assignment("t2", "y", "Yusra")],
      tips: [
        { tripId: "t1", amountCents: 1_001 },
        { tripId: "t2", amountCents: 2_001 },
        { tripId: "uncrewed", amountCents: 3 },
      ],
    });
    expect(reportTipLine(rows, "usd")).toBe(
      "Equal shares: Sal $15.01 · Yusra $10.00 · Keiko $5.01 · No crew recorded $0.03",
    );
    expect(crewExport(rows, "usd")).toEqual([
      ["Keiko", "5.01", "USD"],
      ["Sal", "15.01", "USD"],
      ["Yusra", "10", "USD"],
      ["No crew recorded", "0.03", "USD"],
    ]);
    expect(rows.reduce((sum, row) => sum + row.tipsCents, 0)).toBe(3_005);
  });

  it("formats exact shares in the reader's Spanish locale", () => {
    const rows = assembleCrewSheet({
      assignments: sharedCrew,
      tips: [{ tripId: "t1", amountCents: 67_500 }],
    });
    expect(reportTipLine(rows, "usd", "es-ES")).toBe(
      "A partes iguales: Keiko 337,50 US$ · Sal 337,50 US$",
    );
  });

  it("lists each share, largest first, and keeps uncrewed tips on their own line", () => {
    const line = tipsSplitLine(
      [
        {
          personId: "s",
          personName: "Sal",
          roles: [],
          roleUnspecified: false,
          departures: 2,
          minutes: 0,
          tipsCents: 16_000,
        },
        {
          personId: "k",
          personName: "Keiko",
          roles: [],
          roleUnspecified: false,
          departures: 3,
          minutes: 0,
          tipsCents: 18_000,
        },
        {
          personId: "y",
          personName: "Yusra",
          roles: [],
          roleUnspecified: false,
          departures: 1,
          minutes: 0,
          tipsCents: 0,
        },
      ],
      t,
      "usd",
      "en-US",
    );
    expect(line?.replace(/ /g, " ")).toBe("Equal shares: Keiko $180.00 · Sal $160.00");
  });

  it("says nothing in a month with no tips", () => {
    expect(tipsSplitLine([], t, "usd", "en-US")).toBeUndefined();
  });
});

describe("WeatherLine (item 27)", () => {
  it("says what the weather called off", () => {
    render(
      <WeatherLine
        weather={{ departures: 3, days: 2, divers: 26, refundedCents: 184_000, moved: 9 }}
        t={t}
        money={money}
      />,
    );
    expect(
      screen.getByText(
        "Weather called off 3 departures: 26 divers, $1840 refunded, 9 moved to another date.",
      ),
    ).toBeTruthy();
  });

  it("says nothing in a month the weather left alone", () => {
    const { container } = render(
      <WeatherLine
        weather={{ departures: 0, days: 0, divers: 0, refundedCents: 0, moved: 0 }}
        t={t}
        money={money}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("DepartureMoney (item 26)", () => {
  const trip = {
    tripId: "a",
    title: "Reef",
    startsAt: new Date("2026-10-03T13:00:00Z"),
    capacity: 12,
    activeBookings: 9,
    waiverComplete: 9,
    netCents: 85_500,
    boatName: "Mantis I",
    kindName: "Two-tank reef",
    isCourse: false,
  };

  it("draws a line per hull and one by kind of trip", () => {
    render(
      <DepartureMoney
        trips={[trip, { ...trip, tripId: "b", kindName: null, isCourse: true, netCents: 34_000 }]}
        timeZone="America/New_York"
        t={t}
        money={money}
      />,
    );
    expect(screen.getByText("Mantis I")).toBeTruthy();
    expect(screen.getByText("$1195")).toBeTruthy();
    expect(screen.getByText(/1 day out · 75% full/)).toBeTruthy();
    expect(screen.getByText(/Two-tank reef \$855/)).toBeTruthy();
    expect(screen.getByText(/Courses\s\$340/)).toBeTruthy();
  });

  it("renders nothing when no departure named a boat or a kind", () => {
    const { container } = render(
      <DepartureMoney
        trips={[{ ...trip, boatName: null, kindName: null }]}
        timeZone="UTC"
        t={t}
        money={money}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
