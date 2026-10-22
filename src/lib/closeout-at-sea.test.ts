import { describe, expect, it } from "vitest";
import {
  assembleDayCloseout,
  assembleEveningClose,
  type CloseoutRollCallGap,
  type CloseoutTripInput,
} from "./closeout";
import type { TripStage, TripStageReading } from "./trip-stages";
import { DEPARTURE_BUFFER_MS } from "./trips";

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
 * 10:00. While the clock and the crew both say she is out, an unfinished
 * count is a count in progress. A person recorded not back aboard is never
 * that: it stays the loudest thing on the page, out or home.
 */
describe("an open count on a boat still out", () => {
  const MINUTE = 60 * 1000;
  const atSea = (overrides: Partial<CloseoutTripInput> = {}) =>
    trip({
      tripId: "t1",
      startsAt: new Date(now.getTime() - 3 * HOUR),
      endsAt: new Date(now.getTime() + 30 * MINUTE),
      ...overrides,
    });
  const read = (input: CloseoutTripInput, gap: CloseoutRollCallGap, at: Date = now) =>
    assembleDayCloseout({ trips: [input], gaps: [gap], timeZone: TZ, now: at }).departures[0];
  const diveTwo = (reason: CloseoutRollCallGap["reason"]): CloseoutRollCallGap => ({
    tripId: "t1",
    reason,
    diveNumber: 2,
    uncounted: 2,
  });

  it("reads still out while she is out, for divers and for crew", () => {
    for (const reason of ["after_dive_uncounted", "crew_uncounted"] as const) {
      const departure = read(atSea(), diveTwo(reason));
      expect(departure?.status).toBe("still_out");
      expect(departure?.gapReason).toBeNull();
    }
  });

  it("reads still out through the late-arrival hour, and unreconciled the moment it passes", () => {
    const dueBack = atSea({ endsAt: new Date(now.getTime() - 5 * MINUTE) });
    expect(read(dueBack, diveTwo("after_dive_uncounted"))?.status).toBe("still_out");
    const pastBuffer = atSea({
      endsAt: new Date(now.getTime() - DEPARTURE_BUFFER_MS - MINUTE),
    });
    const departure = read(pastBuffer, diveTwo("after_dive_uncounted"));
    expect(departure?.status).toBe("unreconciled");
    expect(departure?.gapReason).toBe("after_dive_uncounted");
    expect(departure?.uncounted).toBe(2);
  });

  it("reads unreconciled once the crew taps her home with the count still open", () => {
    const tapped = atSea({
      endsAt: new Date(now.getTime() - 5 * MINUTE),
      stage: stage("home", new Date(now.getTime() - 2 * MINUTE)),
    });
    expect(read(tapped, diveTwo("after_dive_uncounted"))?.status).toBe("unreconciled");
    expect(read(tapped, diveTwo("crew_uncounted"))?.status).toBe("unreconciled");
  });

  it("never softens a person recorded not back aboard, however far from home she is", () => {
    for (const reason of ["missing_diver", "missing_crew"] as const) {
      const departure = read(atSea(), diveTwo(reason));
      expect(departure?.status).toBe("unreconciled");
      expect(departure?.gapReason).toBe(reason);
    }
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
  });
});
