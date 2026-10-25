import { describe, expect, it } from "vitest";
import { closeoutDepartureDetailText } from "@/i18n/closeout-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  assembleDayCloseout,
  assembleEveningClose,
  type CloseoutRollCallGap,
  type CloseoutTripInput,
  OPEN_COUNT_QUIET_MS,
} from "./closeout";
import type { TripStage, TripStageReading } from "./trip-stages";
import { DEPARTURE_BUFFER_MS } from "./trips";

const en = staffTranslator("en-US");
const es = staffTranslator("es-ES");

const TZ = "America/New_York";
// 9:30 shop-local on 2026-07-21 (EDT, UTC-4), the e2e fleet's frozen morning.
const now = new Date("2026-07-21T13:30:00Z");
const HOUR = 60 * 60 * 1000;

function trip(overrides: Partial<CloseoutTripInput> & { tripId: string }): CloseoutTripInput {
  return {
    title: "Two-Tank Reef",
    startsAt: new Date(now.getTime() - 3 * HOUR),
    endsAt: new Date(now.getTime() + HOUR),
    booked: 11,
    sailed: 11,
    capacity: 12,
    plannedDives: 2,
    crew: [{ rollCall: { state: "boarded" } }],
    recapShoutout: null,
    ...overrides,
  };
}

/** One tap at the rail, as `latestTripStagesByTrip` hands it in. */
function stage(word: TripStage, recordedAt: Date): TripStageReading {
  return { stage: word, siteName: "Pickles Reef", recordedAt, recordedByName: "Marco Diaz" };
}

/**
 * **A boat at sea mid-count reads still out, not unreconciled** (visual
 * triage of PR #2918, item 1b). `listRollCallGaps` raises a count started
 * and left open while the boat is out, so Needs-you says "Boat is out,
 * dive 2 count still open"; the station card read the same gap as
 * "Unreconciled · The count was never closed" at 9:30 on a boat due back at
 * 10:00.
 *
 * The softening is narrow on purpose (dive-domain review of 56ba7c1, captain
 * and auditor framings). It holds only while every one of these is true:
 * the boat is not yet due back (not the late-arrival hour, which is when
 * shore has already been alerted), the trip lies within today's shop day,
 * the open count is the latest one anybody marked and no later dive is
 * logged, the page is not a past day's record, and nobody on the boat, diver
 * or crew, is recorded not back aboard. Anything else reads the gap loud.
 */
describe("an open count on a boat still out", () => {
  const MINUTE = 60 * 1000;
  const atSea = (overrides: Partial<CloseoutTripInput> = {}) =>
    trip({
      tripId: "t1",
      startsAt: new Date(now.getTime() - 3 * HOUR),
      endsAt: new Date(now.getTime() + 30 * MINUTE),
      loggedDives: 2,
      ...overrides,
    });
  const read = (
    input: CloseoutTripInput,
    gaps: CloseoutRollCallGap | readonly CloseoutRollCallGap[],
    at: Date = now,
    options: { historical?: boolean } = {},
  ) =>
    assembleDayCloseout({
      trips: [input],
      gaps: Array.isArray(gaps) ? gaps : [gaps as CloseoutRollCallGap],
      timeZone: TZ,
      now: at,
      ...options,
    }).departures[0];
  const diveTwo = (reason: CloseoutRollCallGap["reason"]): CloseoutRollCallGap => ({
    tripId: "t1",
    reason,
    diveNumber: 2,
    uncounted: 2,
    latestMarkedDive: 2,
    latestMarkAt: new Date(now.getTime() - 5 * MINUTE),
  });
  const expectLoud = (
    departure: ReturnType<typeof read>,
    reason: CloseoutRollCallGap["reason"],
    diveNumber = 2,
  ) => {
    expect(departure?.status).toBe("unreconciled");
    expect(departure?.gapReason).toBe(reason);
    expect(departure?.diveNumber).toBe(diveNumber);
  };

  it("reads still out while she is out, for divers and for crew, and keeps the open checkpoint", () => {
    for (const reason of ["after_dive_uncounted", "crew_uncounted"] as const) {
      const departure = read(atSea(), diveTwo(reason));
      expect(departure?.status).toBe("still_out");
      expect(departure?.gapReason).toBeNull();
      // The Open roll call button and the manifest link go to after_dive_2.
      expect(departure?.diveNumber).toBe(2);
      expect(departure?.uncounted).toBe(2);
    }
    // Each half's open count is carried apart, so the station can name both.
    expect(read(atSea(), diveTwo("after_dive_uncounted"))?.openCount).toEqual({
      people: 2,
      crew: 0,
    });
    expect(read(atSea(), diveTwo("crew_uncounted"))?.openCount).toEqual({ people: 0, crew: 2 });
    const both = read(atSea(), [
      diveTwo("after_dive_uncounted"),
      { ...diveTwo("crew_uncounted"), uncounted: 1 },
    ]);
    expect(both?.status).toBe("still_out");
    expect(both?.openCount).toEqual({ people: 2, crew: 1 });
  });

  it("never softens when the other half's count is open at an earlier dive (re-review B1)", () => {
    const diveOne = (reason: "after_dive_uncounted" | "crew_uncounted"): CloseoutRollCallGap => ({
      tripId: "t1",
      reason,
      diveNumber: 1,
      uncounted: 1,
      latestMarkedDive: 2,
    });
    // Divers mid-count at dive 2; a divemaster never marked back after dive 1.
    expectLoud(
      read(atSea(), [diveTwo("after_dive_uncounted"), diveOne("crew_uncounted")]),
      "after_dive_uncounted",
    );
    const crewLeft = read(atSea(), [diveTwo("after_dive_uncounted"), diveOne("crew_uncounted")]);
    expect(crewLeft?.openCount).toBeUndefined();
    // The mirror: crew mid-count at dive 2; a diver never marked back after dive 1.
    expectLoud(
      read(atSea(), [diveTwo("crew_uncounted"), diveOne("after_dive_uncounted")]),
      "after_dive_uncounted",
      1,
    );
  });

  it("reads unreconciled from the moment she is due back, not an hour later (captain F1)", () => {
    for (const minutesPast of [0, 5]) {
      const dueBack = atSea({ endsAt: new Date(now.getTime() - minutesPast * MINUTE) });
      const departure = read(dueBack, diveTwo("after_dive_uncounted"));
      expectLoud(departure, "after_dive_uncounted");
      expect(departure?.uncounted).toBe(2);
    }
    const pastBuffer = atSea({
      endsAt: new Date(now.getTime() - DEPARTURE_BUFFER_MS - MINUTE),
    });
    expectLoud(read(pastBuffer, diveTwo("crew_uncounted")), "crew_uncounted");
  });

  it("reads unreconciled once the crew taps her home with the count still open", () => {
    const tapped = atSea({
      stage: stage("home", new Date(now.getTime() - 2 * MINUTE)),
    });
    expectLoud(read(tapped, diveTwo("after_dive_uncounted")), "after_dive_uncounted");
    expectLoud(read(tapped, diveTwo("crew_uncounted")), "crew_uncounted");
  });

  it("never softens a person recorded not back aboard, however far from home she is", () => {
    for (const reason of ["missing_diver", "missing_crew"] as const) {
      expectLoud(read(atSea(), diveTwo(reason)), reason);
    }
  });

  it("never softens an open count beside a person recorded not back aboard, diver or crew (captain F4)", () => {
    const missing = (reason: "missing_diver" | "missing_crew"): CloseoutRollCallGap => ({
      tripId: "t1",
      reason,
      diveNumber: 1,
      uncounted: 1,
      latestMarkedDive: 2,
    });
    expectLoud(
      read(atSea(), [diveTwo("after_dive_uncounted"), missing("missing_crew")]),
      "missing_crew",
      1,
    );
    expectLoud(
      read(atSea(), [diveTwo("crew_uncounted"), missing("missing_diver")]),
      "missing_diver",
      1,
    );
  });

  it("never softens on a trip that spans more than one shop day (auditor F1)", () => {
    // Day 1 08:00 to day 2 16:00 EDT, four dives; one student never tapped
    // back aboard after day 1's last dive.
    const course = atSea({
      startsAt: new Date("2026-07-20T12:00:00Z"),
      endsAt: new Date("2026-07-21T20:00:00Z"),
      plannedDives: 4,
    });
    const gap = { ...diveTwo("after_dive_uncounted"), uncounted: 1 };
    // Day 1 at 20:00, the boat on her mooring.
    expectLoud(read(course, gap, new Date("2026-07-21T00:00:00Z")), "after_dive_uncounted");
    // Day 2 at 10:00, day 1's count still open.
    expectLoud(read(course, gap, new Date("2026-07-21T14:00:00Z")), "after_dive_uncounted");
  });

  it("never softens on a past day's record (auditor F1)", () => {
    expectLoud(
      read(atSea(), diveTwo("after_dive_uncounted"), now, { historical: true }),
      "after_dive_uncounted",
    );
  });

  it("never softens an earlier dive's count once the boat has moved on (auditor F2)", () => {
    // Dive 1 open, dive 2 already counted: a diver left at the first site.
    const diveOneOpen: CloseoutRollCallGap = {
      tripId: "t1",
      reason: "after_dive_uncounted",
      diveNumber: 1,
      uncounted: 1,
      latestMarkedDive: 2,
    };
    expectLoud(read(atSea(), diveOneOpen), "after_dive_uncounted", 1);
    // Dive 2 open on a three-tank boat whose dive 3 is already logged.
    const thirdLogged = atSea({ plannedDives: 3, loggedDives: 3 });
    expectLoud(read(thirdLogged, diveTwo("crew_uncounted")), "crew_uncounted");
  });

  it("reads loud when it cannot tell which count is the latest", () => {
    const { latestMarkedDive: _, ...unknownLatest } = diveTwo("after_dive_uncounted");
    expectLoud(read(atSea(), unknownLatest), "after_dive_uncounted");
    expectLoud(
      read(atSea({ loggedDives: undefined }), diveTwo("after_dive_uncounted")),
      "after_dive_uncounted",
    );
  });

  /**
   * **A count nobody is taking any more reads loud** (issue #2925). Crew mark
   * half the boat after a dive and stop; without a clock on the marks the
   * station read "count open" until she was due back, hours later.
   */
  it("reads loud once nobody has marked anyone for the quiet window (#2925)", () => {
    const markedAgo = (minutes: number) => ({
      ...diveTwo("after_dive_uncounted"),
      latestMarkAt: new Date(now.getTime() - minutes * MINUTE),
    });
    expect(OPEN_COUNT_QUIET_MS).toBe(20 * MINUTE);
    for (const minutes of [0, 1, 19]) {
      expect(read(atSea(), markedAgo(minutes))?.status).toBe("still_out");
    }
    // The window is shut at its own edge, and stays shut.
    for (const minutes of [20, 21, 90, 180]) {
      expectLoud(read(atSea(), markedAgo(minutes)), "after_dive_uncounted");
    }
    // Abandoned after dive 1 on a two-tank boat that never logged dive 2.
    const diveOneAbandoned: CloseoutRollCallGap = {
      tripId: "t1",
      reason: "crew_uncounted",
      diveNumber: 1,
      uncounted: 1,
      latestMarkedDive: 1,
      latestMarkAt: new Date(now.getTime() - 2 * HOUR),
    };
    expectLoud(read(atSea({ loggedDives: 1 }), diveOneAbandoned), "crew_uncounted", 1);
    // The same count with a mark a minute ago is still being taken.
    expect(
      read(atSea({ loggedDives: 1 }), {
        ...diveOneAbandoned,
        latestMarkAt: new Date(now.getTime() - MINUTE),
      })?.status,
    ).toBe("still_out");
  });

  it("reads loud when the newest mark has no time, or one later than now (#2925)", () => {
    const { latestMarkAt: _, ...noTime } = diveTwo("after_dive_uncounted");
    expectLoud(read(atSea(), noTime), "after_dive_uncounted");
    expectLoud(
      read(atSea(), { ...diveTwo("after_dive_uncounted"), latestMarkAt: null }),
      "after_dive_uncounted",
    );
    expectLoud(
      read(atSea(), { ...diveTwo("crew_uncounted"), latestMarkAt: new Date(Number.NaN) }),
      "crew_uncounted",
    );
    // A device clock ahead of shore cannot hold the count soft.
    expectLoud(
      read(atSea(), {
        ...diveTwo("after_dive_uncounted"),
        latestMarkAt: new Date(now.getTime() + 3 * HOUR),
      }),
      "after_dive_uncounted",
    );
  });

  it("reads loud when either half of the count has gone quiet or lost its time (#2925)", () => {
    const stale = {
      ...diveTwo("crew_uncounted"),
      uncounted: 1,
      latestMarkAt: new Date(now.getTime() - 45 * MINUTE),
    };
    expectLoud(read(atSea(), [diveTwo("after_dive_uncounted"), stale]), "after_dive_uncounted");
    const { latestMarkAt: _, ...noTime } = diveTwo("crew_uncounted");
    expectLoud(read(atSea(), [diveTwo("after_dive_uncounted"), noTime]), "after_dive_uncounted");
  });

  it("says the count is open and how many are left to mark (captain F3, auditor F3)", () => {
    const departure = read(atSea(), diveTwo("after_dive_uncounted"));
    if (!departure) throw new Error("no departure");
    const open = (people: number, crew: number) => ({ ...departure, openCount: { people, crew } });
    const time = "10:00\u00a0AM";
    expect(closeoutDepartureDetailText(en, departure, time)).toBe(
      "Dive 2 count open, 2 people to mark · due back at 10:00\u00a0AM",
    );
    expect(closeoutDepartureDetailText(en, open(1, 0), time)).toBe(
      "Dive 2 count open, 1 person to mark · due back at 10:00\u00a0AM",
    );
    expect(closeoutDepartureDetailText(en, open(0, 1), time)).toBe(
      "Dive 2 count open, 1 crew member to mark · due back at 10:00\u00a0AM",
    );
    expect(closeoutDepartureDetailText(en, open(2, 2), time)).toBe(
      "Dive 2 count open, 2 people and 2 crew members to mark · due back at 10:00\u00a0AM",
    );
    expect(closeoutDepartureDetailText(es, open(1, 0), "10:00")).toBe(
      "Recuento de la inmersión 2 abierto, falta 1 persona por marcar · vuelve a las 10:00",
    );
    expect(closeoutDepartureDetailText(es, departure, "10:00")).toBe(
      "Recuento de la inmersión 2 abierto, faltan 2 personas por marcar · vuelve a las 10:00",
    );
    expect(closeoutDepartureDetailText(es, open(0, 2), "10:00")).toBe(
      "Recuento de la inmersión 2 abierto, faltan 2 tripulantes por marcar · vuelve a las 10:00",
    );
    expect(closeoutDepartureDetailText(es, open(1, 1), "10:00")).toBe(
      "Recuento de la inmersión 2 abierto, faltan 1 persona y 1 tripulante por marcar · vuelve a las 10:00",
    );
    // A boat with no count started still reads its plain return time.
    expect(
      closeoutDepartureDetailText(
        en,
        { status: "still_out", gapReason: null, diveNumber: 0, uncounted: 0 },
        "10:00\u00a0AM",
      ),
    ).toBe("Due back at 10:00\u00a0AM");
  });

  it("never settles the day over her: still out holds the closing block back", () => {
    const departures = assembleDayCloseout({
      trips: [atSea()],
      gaps: [diveTwo("after_dive_uncounted")],
      timeZone: TZ,
      now,
    }).departures;
    const evening = assembleEveningClose(departures, now);
    expect(evening.closing).toBe(false);
    expect(evening.allHome).toBe(false);
    // The open count subtracts nobody from the homecoming numbers while softened.
    expect(evening.stations[0]?.back).toBe(11);
  });
});
