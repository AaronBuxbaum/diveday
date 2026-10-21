import { describe, expect, it } from "vitest";
import { clusterMapPoints, mapTargetIsVisible, separateShopAnchor } from "./map-clustering";

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

  it("merges nearby targets across a screen-cell boundary", () => {
    const points = [
      { pin: { id: "west-one" }, x: 54, y: 20 },
      { pin: { id: "west-two" }, x: 55, y: 20 },
      { pin: { id: "east-one" }, x: 57, y: 20 },
      { pin: { id: "east-two" }, x: 58, y: 20 },
    ];

    expect(clusterMapPoints(points)).toEqual([points.map(({ pin }) => pin)]);
  });

  it("preserves every pin while keeping representative targets apart", () => {
    const points = Array.from({ length: 1_126 }, (_, index) => ({
      pin: { id: String(index) },
      x: ((index * 17) % 800) + 0.5,
      y: ((index * 29) % 400) + 0.5,
    }));
    const grouped = clusterMapPoints(points);
    const positions = new Map(points.map(({ pin, x, y }) => [pin.id, { x, y }]));

    expect(
      grouped
        .flat()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(points.map(({ pin }) => pin.id).sort());
    for (let index = 0; index < grouped.length; index += 1) {
      const here = positions.get(grouped[index][0].id);
      if (!here) throw new Error("Missing representative position");
      for (const other of grouped.slice(index + 1)) {
        const there = positions.get(other[0].id);
        if (!there) throw new Error("Missing neighboring position");
        expect(Math.hypot(here.x - there.x, here.y - there.y)).toBeGreaterThanOrEqual(56);
      }
    }
  });

  it("keeps a large colocated data set in one bounded marker group", () => {
    const points = Array.from({ length: 10_000 }, (_, index) => ({
      pin: { id: String(index) },
      x: 30,
      y: 40,
    }));
    const grouped = clusterMapPoints(points);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual(points.map(({ pin }) => pin));
  });
});

describe("separateShopAnchor", () => {
  const shop = { x: 0, y: 0 };
  const points = [
    { pin: { id: "near-shop" }, x: 30, y: 0 },
    { pin: { id: "clear-member" }, x: 80, y: 0 },
    { pin: { id: "neighbor" }, x: 150, y: 0 },
  ];

  it("chooses a clear real member without losing any clustered sites", () => {
    const groups = clusterMapPoints(points);
    const result = separateShopAnchor(groups, points, shop, () => true);

    expect(result.showShopAnchor).toBe(true);
    expect(result.groups[0].map(({ id }) => id)).toEqual(["clear-member", "near-shop"]);
    expect(
      result.groups
        .flat()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(points.map(({ pin }) => pin.id).sort());
    expect(points).toEqual([
      { pin: { id: "near-shop" }, x: 30, y: 0 },
      { pin: { id: "clear-member" }, x: 80, y: 0 },
      { pin: { id: "neighbor" }, x: 150, y: 0 },
    ]);
  });

  it("hides only the shop when moving its cluster would overlap another group", () => {
    const crowded = [...points.slice(0, 2), { pin: { id: "neighbor" }, x: 120, y: 0 }];
    const groups = clusterMapPoints(crowded);
    const result = separateShopAnchor(groups, crowded, shop, () => true);

    expect(result.showShopAnchor).toBe(false);
    expect(result.groups).toBe(groups);
    expect(result.groups.flat()).toHaveLength(3);
  });

  it("rejects a replacement hidden by the viewport or a map control", () => {
    const groups = clusterMapPoints(points);
    const result = separateShopAnchor(groups, points, shop, () => false);

    expect(result.showShopAnchor).toBe(false);
    expect(result.groups).toBe(groups);
  });

  it("keeps a large coincident cluster intact when no clear representative exists", () => {
    const coincident = Array.from({ length: 10_000 }, (_, index) => ({
      pin: { id: String(index) },
      x: 0,
      y: 0,
    }));
    const groups = clusterMapPoints(coincident);
    const result = separateShopAnchor(groups, coincident, shop, () => true);

    expect(result.showShopAnchor).toBe(false);
    expect(result.groups).toBe(groups);
    expect(result.groups[0]).toHaveLength(10_000);
  });

  it("keeps the selected site fixed and restores a clear shop target", () => {
    const selected = [{ pin: { id: "selected" }, x: 5, y: 0 }];
    const groups = clusterMapPoints(selected, "selected");
    expect(separateShopAnchor(groups, selected, shop, () => true)).toEqual({
      groups,
      showShopAnchor: false,
    });
    expect(separateShopAnchor(groups, selected, { x: 100, y: 0 }, () => true)).toEqual({
      groups,
      showShopAnchor: true,
    });
  });
});

describe("mapTargetIsVisible", () => {
  const viewport = { x: 800, y: 400 };

  it("keeps the whole interactive target inside the map", () => {
    expect(mapTargetIsVisible({ x: 22, y: 40 }, 46, viewport, [])).toBe(false);
    expect(mapTargetIsVisible({ x: 23, y: 40 }, 46, viewport, [])).toBe(true);
    expect(mapTargetIsVisible({ x: 780, y: 40 }, 46, viewport, [])).toBe(false);
    expect(mapTargetIsVisible({ x: 100, y: 380 }, 46, viewport, [])).toBe(false);
  });

  it("omits a target covered by the zoom controls and keeps a clear neighbor", () => {
    const zoomControl = { left: 10, top: 10, right: 42, bottom: 74 };
    expect(mapTargetIsVisible({ x: 64, y: 40 }, 46, viewport, [zoomControl])).toBe(false);
    expect(mapTargetIsVisible({ x: 66, y: 40 }, 46, viewport, [zoomControl])).toBe(true);
  });
});
