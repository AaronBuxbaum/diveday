import { describe, expect, it } from "vitest";
import {
  type DepartureRollCall,
  isAfterTheDive,
  readSeatLadder,
  type SeatRecords,
  sailingUnsaid,
} from "./seat-ladder";
import { seatSailed } from "./seat-sailed";

/** Every combination of the records a seat can carry: 2 × 2 × 3 × 2 × 2. */
function everySeat(): SeatRecords[] {
  const seats: SeatRecords[] = [];
  const dockResults: DepartureRollCall[] = ["boarded", "not_boarded", null];
  for (const noShow of [false, true])
    for (const arrived of [false, true])
      for (const dockResult of dockResults)
        for (const afterDiveResultStands of [false, true])
          for (const missingAfterDive of [false, true])
            seats.push({ noShow, arrived, dockResult, afterDiveResultStands, missingAfterDive });
  return seats;
}

const quiet: SeatRecords = {
  noShow: false,
  arrived: false,
  dockResult: null,
  afterDiveResultStands: false,
  missingAfterDive: false,
};

describe("readSeatLadder", () => {
  it("reads each rung from the record that writes it", () => {
    expect(readSeatLadder(quiet)).toEqual({ rung: "booked", evidence: "none", sailed: true });
    expect(readSeatLadder({ ...quiet, arrived: true })).toEqual({
      rung: "arrived",
      evidence: "desk_arrival",
      sailed: true,
    });
    expect(readSeatLadder({ ...quiet, noShow: true })).toEqual({
      rung: "released",
      evidence: "desk_release",
      sailed: false,
    });
    expect(readSeatLadder({ ...quiet, dockResult: "boarded" })).toEqual({
      rung: "aboard",
      evidence: "dock",
      sailed: true,
    });
    expect(readSeatLadder({ ...quiet, dockResult: "not_boarded" })).toEqual({
      rung: "ashore",
      evidence: "dock",
      sailed: false,
    });
    expect(readSeatLadder({ ...quiet, afterDiveResultStands: true })).toEqual({
      rung: "aboard",
      evidence: "after_dive",
      sailed: true,
    });
    expect(
      readSeatLadder({
        ...quiet,
        dockResult: "boarded",
        afterDiveResultStands: true,
        missingAfterDive: true,
      }),
    ).toEqual({ rung: "missing", evidence: "after_dive", sailed: true });
  });

  // Adversarial: ADR 20260907-the-counter-survives-offline, decision 4.
  describe("arrival never reads as aboard", () => {
    it("never puts a seat on the boat on the strength of the desk", () => {
      // Arrived, and nothing else: the rung the desk can reach and no higher.
      expect(readSeatLadder({ ...quiet, arrived: true }).rung).toBe("arrived");
      for (const seat of everySeat()) {
        const ladder = readSeatLadder(seat);
        if (ladder.rung === "aboard") {
          expect(seat.dockResult === "boarded" || seat.afterDiveResultStands).toBe(true);
          expect(seat.dockResult).not.toBe("not_boarded");
        }
      }
    });

    it("changes nothing but booked to arrived when an arrival is added to any seat", () => {
      for (const seat of everySeat().filter((s) => !s.arrived)) {
        const without = readSeatLadder(seat);
        const withArrival = readSeatLadder({ ...seat, arrived: true });
        expect(withArrival.sailed).toBe(without.sailed);
        expect(sailingUnsaid(withArrival)).toBe(sailingUnsaid(without));
        if (without.rung === "booked") {
          expect(withArrival).toEqual({ ...without, rung: "arrived", evidence: "desk_arrival" });
        } else {
          expect(withArrival).toEqual(without);
        }
      }
    });

    it("leaves an arrived seat's sailing unsaid, so the record never files it as Sailed", () => {
      expect(sailingUnsaid(readSeatLadder({ ...quiet, arrived: true }))).toBe(true);
    });

    it("lets the crew's not-boarded stand over an arrival", () => {
      // Checked in at the desk, held on a medical hold, left at the dock.
      const ladder = readSeatLadder({ ...quiet, arrived: true, dockResult: "not_boarded" });
      expect(ladder).toEqual({ rung: "ashore", evidence: "dock", sailed: false });
    });

    it("lets the desk's release stand over its own earlier arrival", () => {
      // Turned away at the counter after arriving: released, not arrived.
      const ladder = readSeatLadder({ ...quiet, arrived: true, noShow: true });
      expect(ladder).toEqual({ rung: "released", evidence: "desk_release", sailed: false });
    });
  });

  describe("a missing diver", () => {
    it("outranks every other record on the seat", () => {
      for (const seat of everySeat().filter((s) => s.missingAfterDive)) {
        expect(readSeatLadder(seat).rung).toBe("missing");
        expect(sailingUnsaid(readSeatLadder(seat))).toBe(false);
      }
    });

    it("is never missing without the after-dive word", () => {
      for (const seat of everySeat().filter((s) => !s.missingAfterDive)) {
        expect(readSeatLadder(seat).rung).not.toBe("missing");
      }
    });
  });

  it("answers sailed by seatSailed for every seat, so the ladder and the evening count agree", () => {
    for (const seat of everySeat()) {
      const { noShow, dockResult, afterDiveResultStands } = seat;
      expect(readSeatLadder(seat).sailed).toBe(
        seatSailed({ noShow, dockResult, afterDiveResultStands }),
      );
    }
  });

  it("never files a seat the crew or desk spoke for as aboard and not sailed, or ashore and sailed", () => {
    for (const seat of everySeat()) {
      const ladder = readSeatLadder(seat);
      if (ladder.rung === "aboard") expect(ladder.sailed).toBe(true);
      if (ladder.rung === "ashore" || ladder.rung === "released") expect(ladder.sailed).toBe(false);
    }
  });

  it("lets the dock outrank a later count, as the evening's does", () => {
    // Said ashore at the dock, then counted after the dive: a chase boat
    // brought them out. The vessel did not leave with them.
    const ladder = readSeatLadder({
      ...quiet,
      dockResult: "not_boarded",
      afterDiveResultStands: true,
    });
    expect(ladder).toEqual({ rung: "ashore", evidence: "dock", sailed: false });
  });

  it("lets a later count outrank the desk's release", () => {
    // Released at the counter, then counted aboard after dive one.
    const ladder = readSeatLadder({ ...quiet, noShow: true, afterDiveResultStands: true });
    expect(ladder).toEqual({ rung: "aboard", evidence: "after_dive", sailed: true });
  });
});

describe("isAfterTheDive", () => {
  const endsAt = new Date("2026-08-29T18:30:00Z");
  const bufferGone = new Date("2026-08-29T19:31:00Z"); // endsAt + 1h + 1m
  const recapFloor = new Date("2026-08-29T22:31:00Z"); // endsAt + 4h + 1m

  it("never opens for a diver the crew recorded as not boarded", () => {
    // The one thing DiveDay actually knows about who got on the boat. A diver
    // who overslept, or who was held at the desk on a medical hold, opened the
    // durable link already in their inbox and got "Welcome back", a printable
    // dive record for the day, and an invitation to tip the crew who dived
    // without them. No amount of elapsed time makes that true.
    expect(isAfterTheDive({ endsAt, boarded: "not_boarded", now: bufferGone })).toBe(false);
    expect(isAfterTheDive({ endsAt, boarded: "not_boarded", now: recapFloor })).toBe(false);
    expect(
      isAfterTheDive({ endsAt, boarded: "not_boarded", now: new Date("2026-09-05T09:00:00Z") }),
    ).toBe(false);
  });

  it("opens at the late-arrival buffer for a diver the crew recorded aboard", () => {
    // With the dock's own record in hand the clock is no longer asserting
    // anything by itself, so the standing buffer is the whole wait.
    expect(isAfterTheDive({ endsAt, boarded: "boarded", now: endsAt })).toBe(false);
    expect(
      isAfterTheDive({ endsAt, boarded: "boarded", now: new Date("2026-08-29T19:29:59.999Z") }),
    ).toBe(false);
    expect(isAfterTheDive({ endsAt, boarded: "boarded", now: bufferGone })).toBe(true);
  });

  it("waits for the recap floor when the shop recorded no roll call", () => {
    // Four hours — `RECAP_AUTOMATIC_DELAY_HOURS`, the delay the recap *send*
    // has always taken before asserting the same thing by email. A shop that
    // does not run roll call gets that rule, not a looser one invented here.
    // The old buffer-only switch is the failing case: at `bufferGone` the
    // page used to be the afterglow.
    expect(isAfterTheDive({ endsAt, now: bufferGone })).toBe(false);
    expect(isAfterTheDive({ endsAt, boarded: null, now: bufferGone })).toBe(false);
    expect(isAfterTheDive({ endsAt, now: new Date("2026-08-29T22:30:00Z") })).toBe(false);
    expect(isAfterTheDive({ endsAt, now: recapFloor })).toBe(true);
    expect(isAfterTheDive({ endsAt, now: new Date("2026-08-30T09:00:00Z") })).toBe(true);
  });

  it("is never the after-state while the boat could still be out", () => {
    // Whatever the evidence says, the day itself has to be over: a roll call
    // is recorded at the dock *before* the boat leaves, so `boarded` is true
    // for every diver on the water right now.
    for (const boarded of ["boarded", "not_boarded", null] as const) {
      expect(isAfterTheDive({ endsAt, boarded, now: new Date("2026-08-29T17:00:00Z") })).toBe(
        false,
      );
    }
  });
});
