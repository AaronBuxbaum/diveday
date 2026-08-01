// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilestoneHaptics } from "./MilestoneHaptics";

describe("MilestoneHaptics", () => {
  let vibrateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vibrateMock = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not vibrate on initial mount", () => {
    render(<MilestoneHaptics total={10} boarded={5} />);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("vibrates with single tap at 25% milestone", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={0} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    rerender(<MilestoneHaptics total={10} boarded={3} />);
    expect(vibrateMock).toHaveBeenCalledWith(20);
  });

  it("vibrates with double tap at 50% milestone", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={3} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    rerender(<MilestoneHaptics total={10} boarded={5} />);
    expect(vibrateMock).toHaveBeenCalledWith([20, 50, 20]);
  });

  it("vibrates with triple tap at 75% milestone", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={5} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    rerender(<MilestoneHaptics total={10} boarded={8} />);
    expect(vibrateMock).toHaveBeenCalledWith([20, 50, 20, 50, 20]);
  });

  it("vibrates with victory pulse at 100% milestone", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={8} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    rerender(<MilestoneHaptics total={10} boarded={10} />);
    expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100, 50, 200]);
  });

  it("does not vibrate when progress decreases", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={5} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    rerender(<MilestoneHaptics total={10} boarded={2} />);
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("does not count no-shows as boarded", () => {
    const { rerender } = render(<MilestoneHaptics total={10} boarded={0} />);

    rerender(<MilestoneHaptics total={10} boarded={0} />);

    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it("a trip/checkpoint switch without a fresh instance would misfire — the reason the caller keys by trip id + checkpoint", () => {
    // Trip A ends its roll call low (20%, below every threshold).
    const { rerender } = render(<MilestoneHaptics total={10} boarded={2} />);
    expect(vibrateMock).not.toHaveBeenCalled();

    // Switching to Trip B, which happens to already be 80% boarded, as a
    // same-instance rerender (what happens without the caller's key) reads
    // as "progress jumped 20% -> 80%" and wrongly buzzes for a trip this
    // instance never watched climb.
    rerender(<MilestoneHaptics total={10} boarded={8} />);
    expect(vibrateMock).toHaveBeenCalled();
  });

  it("a fresh instance (the caller's key on trip id + checkpoint, the fix) never buzzes off another trip's numbers", () => {
    const { unmount } = render(<MilestoneHaptics total={10} boarded={2} />);
    expect(vibrateMock).not.toHaveBeenCalled();
    unmount();

    // A `key` change unmounts the old instance and mounts a brand new one —
    // fresh refs, so the first render is always treated as an initial
    // snapshot, never a jump to buzz for.
    render(<MilestoneHaptics total={10} boarded={8} />);
    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
