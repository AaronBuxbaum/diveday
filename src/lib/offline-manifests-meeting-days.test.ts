import { describe, expect, it } from "vitest";
import { latestOfflineCrewRollCall, latestOfflineRollCall } from "./offline-manifests";
import { crewSnapshot, snapshot } from "./offline-manifests-fixtures";

/**
 * **A course's later meeting day starts empty on the device too** (issue #3904,
 * ADR 20261104-roll-call-by-meeting-day). The copy is the server's manifest at
 * save time and knows nothing of the day boundary; it carries the boundary
 * (`rollCallDayBoundaries`) so a device past it reads what the server would.
 */
describe("an offline copy of a course that meets on two days", () => {
  const DAY_ONE = new Date("2026-07-20T15:00:00.000Z");
  const BOUNDARY = "2026-07-21T00:00:00.000Z";
  const DAY_TWO = new Date("2026-07-21T14:00:00.000Z");

  type SavedResult = { state: "boarded" | "not_boarded"; occurredAt: string };
  /** The day-one copy, with each diver's saved result per checkpoint. */
  function courseCopy(saved: Record<string, Record<string, SavedResult>>) {
    const copy = snapshot();
    copy.rollCallDayBoundaries = [BOUNDARY];
    for (const manifest of copy.manifests) {
      for (const diver of manifest.divers) {
        const result = saved[diver.bookingId]?.[manifest.checkpoint];
        if (result) diver.rollCall = { ...result, recordedByName: "Sal", implied: false };
      }
    }
    return copy;
  }
  const dockAndDive = {
    ready: {
      departure: { state: "boarded", occurredAt: "2026-07-20T11:00:00.000Z" },
      after_dive_1: { state: "boarded", occurredAt: "2026-07-20T13:00:00.000Z" },
    },
    blocked: {
      departure: { state: "boarded", occurredAt: "2026-07-20T11:01:00.000Z" },
      after_dive_1: { state: "not_boarded", occurredAt: "2026-07-20T13:01:00.000Z" },
    },
  } satisfies Record<string, Record<string, SavedResult>>;
  const event = (
    over: Partial<import("./offline-manifests").OfflineRollCallEvent>,
  ): import("./offline-manifests").OfflineRollCallEvent => ({
    clientEventId: "e1",
    snapshotId: "snapshot-1",
    snapshotSavedAt: "2026-07-20T11:00:00.000Z",
    tripId: "trip-1",
    bookingId: "ready",
    checkpoint: "departure",
    status: "boarded",
    occurredAt: "2026-07-21T13:00:00.000Z",
    syncStatus: "pending",
    ...over,
  });

  it("a snapshot saved on day one shows day two's checkpoints empty once the device clock passes the boundary", () => {
    const copy = courseCopy(dockAndDive);
    expect(latestOfflineRollCall(copy, [], "ready", "departure", DAY_ONE)?.state).toBe("boarded");
    expect(latestOfflineRollCall(copy, [], "ready", "after_dive_1", DAY_ONE)?.state).toBe(
      "boarded",
    );
    expect(latestOfflineRollCall(copy, [], "ready", "departure", DAY_TWO)).toBeUndefined();
    expect(latestOfflineRollCall(copy, [], "ready", "after_dive_1", DAY_TWO)).toBeUndefined();
  });

  it("keeps an earlier day's stated missing diver at its checkpoint, not as this device's to undo", () => {
    const copy = courseCopy(dockAndDive);
    expect(latestOfflineRollCall(copy, [], "blocked", "after_dive_1", DAY_TWO)).toMatchObject({
      state: "not_boarded",
      local: false,
      pending: false,
    });
    // The dock is not a missing-person statement: it starts empty.
    expect(latestOfflineRollCall(copy, [], "blocked", "departure", DAY_TWO)).toBeUndefined();
  });

  it("does not carry a missing diver that was back aboard after a later dive that day", () => {
    const copy = courseCopy({
      blocked: {
        after_dive_1: { state: "not_boarded", occurredAt: "2026-07-20T13:01:00.000Z" },
        after_dive_2: { state: "boarded", occurredAt: "2026-07-20T14:30:00.000Z" },
      },
    });
    expect(latestOfflineRollCall(copy, [], "blocked", "after_dive_1", DAY_TWO)).toBeUndefined();
  });

  it("lets a sighting on the new day settle the earlier day's missing diver", () => {
    const copy = courseCopy(dockAndDive);
    const events = [event({ bookingId: "blocked", checkpoint: "departure", status: "boarded" })];
    expect(latestOfflineRollCall(copy, events, "blocked", "departure", DAY_TWO)).toMatchObject({
      state: "boarded",
      local: true,
    });
    expect(latestOfflineRollCall(copy, events, "blocked", "after_dive_1", DAY_TWO)).toBeUndefined();
  });

  it("lets a retraction on the new day take the earlier day's mis-tap back", () => {
    const copy = courseCopy(dockAndDive);
    const events = [event({ bookingId: "blocked", checkpoint: "after_dive_1", status: "cleared" })];
    expect(latestOfflineRollCall(copy, events, "blocked", "after_dive_1", DAY_TWO)).toBeUndefined();
  });

  it("reads a mark queued on day two as day two's, and one queued on day one as day one's", () => {
    const copy = courseCopy(dockAndDive);
    const events = [
      event({
        clientEventId: "d1",
        checkpoint: "after_dive_1",
        status: "boarded",
        bookingId: "blocked",
        occurredAt: "2026-07-20T13:30:00.000Z",
      }),
    ];
    // Day one's queued "back aboard" settles day one's missing diver for good.
    expect(latestOfflineRollCall(copy, events, "blocked", "after_dive_1", DAY_TWO)).toBeUndefined();
    expect(latestOfflineRollCall(copy, events, "blocked", "after_dive_1", DAY_ONE)?.state).toBe(
      "boarded",
    );
  });

  it("reads the crew half the same way", () => {
    const copy = crewSnapshot();
    copy.rollCallDayBoundaries = [BOUNDARY];
    for (const manifest of copy.manifests) {
      const dana = manifest.crew[0];
      if (dana && manifest.checkpoint === "departure") {
        dana.rollCall = {
          state: "boarded",
          occurredAt: "2026-07-20T11:00:00.000Z",
          recordedByName: "Sal",
          implied: false,
        };
      }
    }
    expect(latestOfflineCrewRollCall(copy, [], "crew-dana", "departure", DAY_ONE)?.state).toBe(
      "boarded",
    );
    expect(latestOfflineCrewRollCall(copy, [], "crew-dana", "departure", DAY_TWO)).toBeUndefined();
  });

  it("reads a one-day departure as before, whatever the clock says", () => {
    const copy = snapshot();
    for (const manifest of copy.manifests) {
      const diver = manifest.divers[0];
      if (diver && manifest.checkpoint === "departure") {
        diver.rollCall = {
          state: "boarded",
          occurredAt: "2026-07-20T11:00:00.000Z",
          recordedByName: "Sal",
          implied: false,
        };
      }
    }
    expect(latestOfflineRollCall(copy, [], "ready", "departure", DAY_TWO)?.state).toBe("boarded");
  });

  it("reads the copy as saved when the clock is still on the day it was saved", () => {
    const copy = courseCopy(dockAndDive);
    expect(latestOfflineRollCall(copy, [], "blocked", "after_dive_1", DAY_ONE)?.state).toBe(
      "not_boarded",
    );
  });

  describe("a copy refreshed on day two", () => {
    const SUNDAY_SAVE = "2026-07-21T07:00:00.000Z";

    it("does not read day one's queued taps as day two's count", () => {
      const copy = courseCopy({});
      copy.savedAt = SUNDAY_SAVE;
      const events = [
        event({
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "boarded",
          occurredAt: "2026-07-20T13:00:00.000Z",
          syncStatus: "applied",
        }),
        event({
          clientEventId: "e2",
          bookingId: "ready",
          checkpoint: "departure",
          status: "boarded",
          occurredAt: "2026-07-20T11:00:00.000Z",
          syncStatus: "applied",
        }),
      ];
      expect(latestOfflineRollCall(copy, events, "ready", "after_dive_1", DAY_TWO)).toBeUndefined();
      expect(latestOfflineRollCall(copy, events, "ready", "departure", DAY_TWO)).toBeUndefined();
    });

    it("does the same for the crew half", () => {
      const copy = crewSnapshot();
      copy.rollCallDayBoundaries = [BOUNDARY];
      copy.savedAt = SUNDAY_SAVE;
      const events = [
        event({
          bookingId: undefined,
          crewPersonId: "crew-dana",
          checkpoint: "after_dive_1",
          status: "boarded",
          occurredAt: "2026-07-20T13:00:00.000Z",
          syncStatus: "applied",
        }),
      ];
      expect(
        latestOfflineCrewRollCall(copy, events, "crew-dana", "after_dive_1", DAY_TWO),
      ).toBeUndefined();
    });

    it("does not let day one's retraction hide a missing diver the copy brought home", () => {
      const copy = courseCopy({});
      copy.savedAt = SUNDAY_SAVE;
      for (const manifest of copy.manifests) {
        const diver = manifest.divers.find((entry) => entry.bookingId === "ready");
        if (diver && manifest.checkpoint === "after_dive_1") {
          diver.rollCall = {
            state: "not_boarded",
            occurredAt: "2026-07-21T10:00:00.000Z",
            recordedByName: "Sal",
            implied: false,
          };
        }
      }
      const events = [
        event({
          bookingId: "ready",
          checkpoint: "after_dive_1",
          status: "cleared",
          occurredAt: "2026-07-20T13:30:00.000Z",
          syncStatus: "applied",
        }),
      ];
      expect(latestOfflineRollCall(copy, events, "ready", "after_dive_1", DAY_TWO)?.state).toBe(
        "not_boarded",
      );
    });
  });

  it("clears day one's missing diver on day three once day two counted them, as the server does", () => {
    const copy = courseCopy(dockAndDive);
    copy.rollCallDayBoundaries = [BOUNDARY, "2026-07-22T00:00:00.000Z"];
    const DAY_THREE = new Date("2026-07-22T14:00:00.000Z");
    const events = [
      // Day two's dock count, tapped on this phone: ordinal 0, not "a later dive".
      event({ bookingId: "blocked", checkpoint: "departure", status: "boarded" }),
    ];
    expect(latestOfflineRollCall(copy, [], "blocked", "after_dive_1", DAY_THREE)?.state).toBe(
      "not_boarded",
    );
    expect(
      latestOfflineRollCall(copy, events, "blocked", "after_dive_1", DAY_THREE),
    ).toBeUndefined();
  });
});
