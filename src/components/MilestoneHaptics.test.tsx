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
});
