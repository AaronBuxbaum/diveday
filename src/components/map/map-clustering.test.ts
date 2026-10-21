import { describe, expect, it } from "vitest";
import { clusterMapPoints } from "./map-clustering";

describe("clusterMapPoints", () => {
  it("groups nearby projected points and leaves distant pins separate", () => {
    const grouped = clusterMapPoints(
      [
        { pin: { id: "north" }, x: 10, y: 10 },
        { pin: { id: "south" }, x: 30, y: 30 },
        { pin: { id: "distant" }, x: 120, y: 10 },
      ],
      null,
      56,
    );

    expect(grouped).toEqual([[{ id: "north" }, { id: "south" }], [{ id: "distant" }]]);
  });

  it("keeps a selected pin out of its screen-cell cluster", () => {
    const grouped = clusterMapPoints(
      [
        { pin: { id: "selected" }, x: 10, y: 10 },
        { pin: { id: "nearby" }, x: 20, y: 20 },
        { pin: { id: "nearby-too" }, x: 25, y: 25 },
      ],
      "selected",
      56,
    );

    expect(grouped).toEqual([[{ id: "selected" }], [{ id: "nearby" }, { id: "nearby-too" }]]);
  });
});
