import { describe, expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { diver, savedCopy } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

/**
 * **A turn-away on the dock copy holds only while the copy is current**
 * (#2907, independent domain review). The desk can put the diver back on the
 * list after the save, and a phone with no signal never hears it. So on an
 * aging or stale copy a turned-away row counts as awaiting again: the copy may
 * ask for one tap too many, never read "all aboard" with her uncounted.
 */
function copySavedMinutesAgo(minutes: number) {
  const copy = savedCopy();
  copy.snapshot.savedAt = new Date(nowMs() - minutes * MINUTE_MS).toISOString();
  const manifest = copy.snapshot.manifests[0];
  if (!manifest) throw new Error("manifest missing");
  const boarded = {
    state: "boarded" as const,
    occurredAt: copy.snapshot.savedAt,
    recordedByName: "Captain",
  };
  manifest.divers = [
    { ...diver("b-ana", "Ana Diaz"), rollCall: boarded },
    { ...diver("b-ben", "Ben Cho"), rollCall: boarded },
    { ...diver("b-priya", "Priya Shah"), notHere: true, turnedAway: true },
  ];
  return copy;
}

describe("a turned-away row on the offline copy (#2907)", () => {
  it("is off the boat on a current copy", () => {
    const trip = offlineTripView(copySavedMinutesAgo(5), "departure");
    expect(trip?.freshness).toBe("current");
    expect(trip?.awaiting).toBe(0);
    expect(trip?.totalDivers).toBe(2);
    expect(trip?.allBoarded).toBe(true);
    expect(trip?.missingDivers).toEqual([]);
  });

  for (const minutes of [30, 24 * 60]) {
    it(`counts as awaiting again on a copy saved ${minutes} minutes ago`, () => {
      const trip = offlineTripView(copySavedMinutesAgo(minutes), "departure");
      expect(trip?.freshness).not.toBe("current");
      expect(trip?.awaiting).toBe(1);
      expect(trip?.totalDivers).toBe(3);
      expect(trip?.allBoarded).toBe(false);
      expect(trip?.rollCallComplete).toBe(false);
      expect(trip?.missingDivers.map((entry) => entry.bookingId)).toEqual(["b-priya"]);
    });
  }
});
