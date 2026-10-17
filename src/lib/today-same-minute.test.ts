import { describe, expect, it } from "vitest";
import {
  assembleDaySpine,
  readNeedsYou,
  type SpineDeparture,
  sortStationRows,
  type TodayAction,
} from "./today";

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Do it",
    href: "/",
    dueAt: hoursFromNow(2),
    ...overrides,
  };
}

function departure(overrides: Partial<SpineDeparture> = {}): SpineDeparture {
  return {
    tripId: "t1",
    title: "Two-Tank Reef",
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(5),
    siteName: "Molasses Reef",
    courseTitle: null,
    boatName: "Mantis II",
    priceCents: 9500,
    capacity: 12,
    sellableCapacity: 12,
    booked: 10,
    boarded: 0,
    blocked: 0,
    crew: [{ fullName: "Keiko Tanaka" }],
    crewAccountedFor: true,
    crewReason: null,
    rehearsal: false,
    ...overrides,
  };
}

const boat = (tripId: string, label: string) => ({ tripId, label });

/**
 * **Two departures at the same minute** (issue #2788). The visual captures
 * today-boat-clash-* and today-crew-clash-* swapped the two 2:30 PM groups in
 * Needs you between runs, and the sentence's "N things before the 2:30 PM"
 * moved with them: the clash row sat on whichever boat the seed's fresh ids
 * put first, and the count read only the one boat `next` named. The reading
 * must be the same whichever order the boats arrive in, and whichever of the
 * two the row hangs on.
 */
describe("two departures at the same minute (#2788)", () => {
  const morning = departure({
    tripId: "trip-m",
    title: "Morning Two-Tank — Molasses Reef",
    startsAt: hoursFromNow(1),
    endsAt: hoursFromNow(4),
  });
  const reef = departure({
    tripId: "trip-r",
    title: "Two-Tank Reef — Molasses & French",
    startsAt: hoursFromNow(1),
    endsAt: hoursFromNow(4),
  });
  const evening = departure({
    tripId: "trip-e",
    title: "Sunset Cruise",
    startsAt: hoursFromNow(6),
    endsAt: hoursFromNow(8),
  });
  const clashOn = (trip: SpineDeparture) =>
    action({
      id: `crew-clash:${trip.tripId}`,
      kind: "crew_clash",
      subject: trip.title,
      aboutDeparture: true,
      dueAt: trip.startsAt,
      departure: boat(trip.tripId, trip.title),
    });
  const others = [
    action({
      id: "prep-m",
      kind: "dive_prep",
      subject: "4 sizes",
      departure: boat("trip-m", morning.title),
    }),
    action({
      id: "prep-r",
      kind: "dive_prep",
      subject: "4 sizes",
      departure: boat("trip-r", reef.title),
    }),
    action({ id: "messages", kind: "unanswered_messages", subject: "3", departure: undefined }),
  ];

  function read(departures: SpineDeparture[], actions: TodayAction[]) {
    const spine = assembleDaySpine({ departures, actions }, { departures: [], actions: [] });
    const reading = readNeedsYou(spine, { now: NOW });
    return {
      stations: spine.stations.map((station) => station.title),
      lead: reading.lead.map((row) => row.id),
      count: reading.count,
      dueBeforeNext: reading.dueBeforeNext,
      next: reading.next?.startsAt.getTime(),
    };
  }

  it("reads the same rows and counts in either input order", () => {
    for (const clashTrip of [morning, reef]) {
      const actions = [clashOn(clashTrip), ...others];
      const forward = read([morning, reef], actions);
      const backward = read([reef, morning], [...actions].reverse());
      expect(backward).toEqual(forward);
      expect(forward.stations).toEqual([morning.title, reef.title]);
    }
  });

  it("counts every row before that minute, whichever boat the clash hangs on", () => {
    const onMorning = read([morning, reef], [clashOn(morning), ...others]);
    const onReef = read([reef, morning], [clashOn(reef), ...others]);
    // The clash and both preps are before the 2:30 PM; the messages are not.
    expect(onMorning.dueBeforeNext).toBe(3);
    expect(onReef.dueBeforeNext).toBe(3);
    expect(onMorning.count).toBe(4);
    expect(onReef.count).toBe(4);
  });

  it("counts only the next minute's boats, never a later boat's rows", () => {
    const eveningPrep = action({
      id: "prep-e",
      kind: "dive_prep",
      subject: "4 sizes",
      departure: boat("trip-e", evening.title),
    });
    const reading = read([evening, reef, morning], [clashOn(morning), ...others, eveningPrep]);
    expect(reading.dueBeforeNext).toBe(3);
    expect(reading.count).toBe(5);
    expect(reading.count).not.toBe(reading.dueBeforeNext);
  });

  it("treats departures inside one clock minute as the same minute", () => {
    const early = departure({ ...morning, startsAt: new Date(hoursFromNow(1).getTime() + 5_000) });
    const late = departure({ ...reef, startsAt: new Date(hoursFromNow(1).getTime() + 50_000) });
    const spine = assembleDaySpine(
      { departures: [late, early], actions: [clashOn(early), ...others] },
      { departures: [], actions: [] },
    );
    expect(spine.stations.map((station) => station.title)).toEqual([morning.title, reef.title]);
    expect(readNeedsYou(spine, { now: NOW }).dueBeforeNext).toBe(3);
    // A later title does not jump ahead of an earlier title inside the same minute.
    const swapped = assembleDaySpine(
      {
        departures: [
          departure({ ...morning, startsAt: new Date(hoursFromNow(1).getTime() + 59_000) }),
          departure({ ...reef, startsAt: new Date(hoursFromNow(1).getTime() + 1_000) }),
        ],
        actions: [],
      },
      { departures: [], actions: [] },
    );
    expect(swapped.stations.map((station) => station.title)).toEqual([morning.title, reef.title]);
  });

  it("puts the boat name between title and id for two boats sharing a title", () => {
    const north = departure({
      tripId: "z-1",
      title: "Reef",
      boatName: "Alpha",
      startsAt: hoursFromNow(1),
    });
    const south = departure({
      tripId: "a-1",
      title: "Reef",
      boatName: "Bravo",
      startsAt: hoursFromNow(1),
    });
    for (const input of [
      [north, south],
      [south, north],
    ]) {
      const spine = assembleDaySpine(
        { departures: input, actions: [] },
        { departures: [], actions: [] },
      );
      expect(spine.stations.map((station) => station.boatName)).toEqual(["Alpha", "Bravo"]);
    }
  });

  it("orders two otherwise-equal rows by their departure, not by arrival", () => {
    const [m, r] = others;
    if (!m || !r) throw new Error("fixture");
    expect(sortStationRows([r, m]).map((row) => row.id)).toEqual(["prep-m", "prep-r"]);
    expect(sortStationRows([m, r]).map((row) => row.id)).toEqual(["prep-m", "prep-r"]);
  });
});
