import { describe, expect, it } from "vitest";
import { savedCopy, view } from "./section-fixtures";
import { offlineTripView } from "./trip-view";

describe("offlineTripView", () => {
  it("counts nobody called as awaiting, and the checkpoint as open", () => {
    const trip = view();
    expect(trip.totalDivers).toBe(2);
    expect(trip.awaiting).toBe(2);
    expect(trip.boarded).toBe(0);
    expect(trip.rollCallComplete).toBe(false);
    expect(trip.missingDivers.map((entry) => entry.bookingId)).toEqual(["b-priya", "b-marcus"]);
  });

  it("is null for a copy that carries no manifest", () => {
    const copy = savedCopy();
    expect(
      offlineTripView({ ...copy, snapshot: { ...copy.snapshot, manifests: [] } }, "departure"),
    ).toBeNull();
  });
});
