// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";
import { ArrivalMap } from "./ArrivalMap";

/**
 * **"Where to go" never opens on an empty block** (fourth UX review, item 4).
 * The phone reporting itself online is not enough: one bar at the marina or a
 * network that blocks the map host still drew a gray 16:9 block. The map
 * takes no space until the host answers the same probe the dive-site map uses.
 */
const probes: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
class FakeImage {
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    probes.push(this);
  }
}

beforeEach(() => {
  probes.length = 0;
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = () => render(<ArrivalMap title="Map" src="https://maps.google.com/x" />).container;

describe("ArrivalMap", () => {
  it("draws nothing while online until the map host answers, then the map", () => {
    const container = mount();
    expect(container.querySelector("iframe")).toBeNull();
    expect(probes[0]?.src).toBe(MAP_REACHABILITY_PROBE);
    act(() => probes[0]?.onload?.());
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("draws nothing when the host cannot be reached on a live connection", () => {
    const container = mount();
    expect(probes[0]?.onerror).toBeTypeOf("function");
    act(() => probes[0]?.onerror?.());
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("steps aside when the connection drops", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const container = mount();
    act(() => probes[0]?.onload?.());
    expect(container.querySelector("iframe")).not.toBeNull();
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(container.querySelector("iframe")).toBeNull();
  });
});
