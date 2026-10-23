// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARRIVAL_MAP_PROBES } from "@/lib/maps";
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

const answerAll = () => {
  for (const probe of probes) probe.onload?.();
};

const mount = () =>
  render(<ArrivalMap title="Map" src="https://www.openstreetmap.org/export/embed.html" />)
    .container;

describe("ArrivalMap", () => {
  it("draws nothing while online until the map host answers, then the map", () => {
    const container = mount();
    expect(container.querySelector("iframe")).toBeNull();
    expect(probes.map((probe) => probe.src)).toEqual([...ARRIVAL_MAP_PROBES]);
    act(() => answerAll());
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
    act(() => answerAll());
    expect(container.querySelector("iframe")).not.toBeNull();
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(container.querySelector("iframe")).toBeNull();
  });

  /**
   * **A failed probe is asked again** (issue #2669): once the signal comes back
   * or the page is looked at again, never on a timer, and never after a success.
   */
  it("asks again when the signal comes back after a failed probe, then draws the map", () => {
    const container = mount();
    act(() => probes[0]?.onerror?.());
    expect(container.querySelector("iframe")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(probes).toHaveLength(ARRIVAL_MAP_PROBES.length * 2);
    act(() => answerAll());
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("asks again when the page is visible again after a failed probe", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const container = mount();
    act(() => probes[0]?.onerror?.());
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(probes).toHaveLength(ARRIVAL_MAP_PROBES.length);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(probes).toHaveLength(ARRIVAL_MAP_PROBES.length * 2);
    act(() => answerAll());
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("asks nothing more after the host has answered", () => {
    mount();
    act(() => answerAll());
    act(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(probes).toHaveLength(ARRIVAL_MAP_PROBES.length);
  });

  it("stops listening once the map is gone", () => {
    const { unmount } = render(
      <ArrivalMap title="Map" src="https://www.openstreetmap.org/export/embed.html" />,
    );
    act(() => probes[0]?.onerror?.());
    unmount();
    act(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(probes).toHaveLength(ARRIVAL_MAP_PROBES.length);
  });
});
