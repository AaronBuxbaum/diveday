// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_REACHABILITY_PROBE } from "@/lib/maps";
import { MapFrame } from "./MapFrame";

/**
 * **A map that cannot load fails silently** (UX review 2026-10-10, item 20).
 * The frame's own `load` fires for the browser's error page as well, so it is
 * the probe image that decides; until it answers, the frame keeps its box and
 * shows nothing.
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

const frame = () =>
  render(
    <MapFrame
      title="Terrain map"
      src="https://maps.google.com/x"
      className="h-full"
      interactive={false}
    />,
  ).container.querySelector("iframe") as HTMLIFrameElement;

describe("MapFrame", () => {
  it("keeps the frame invisible until the provider answers, then shows it", () => {
    const iframe = frame();
    expect(iframe).toHaveClass("invisible");
    expect(iframe).toHaveAttribute("aria-hidden", "true");
    expect(probes).toHaveLength(1);
    expect(probes[0]?.src).toBe(MAP_REACHABILITY_PROBE);
    act(() => probes[0]?.onload?.());
    expect(iframe).not.toHaveClass("invisible");
    expect(iframe).not.toHaveAttribute("aria-hidden");
  });

  it("stays invisible when the provider cannot be reached", () => {
    const iframe = frame();
    act(() => probes[0]?.onerror?.());
    expect(iframe).toHaveClass("invisible");
    // The box is still there, so the route's percentages still land.
    expect(iframe).toHaveClass("h-full");
  });

  it("does not ask at all with the radio off", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const iframe = frame();
    expect(probes).toHaveLength(0);
    expect(iframe).toHaveClass("invisible");
  });
});
