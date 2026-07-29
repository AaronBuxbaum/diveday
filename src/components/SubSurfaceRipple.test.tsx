// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubSurfaceRipple } from "./SubSurfaceRipple";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SubSurfaceRipple", () => {
  it("renders null by default when not complete", () => {
    const { container } = render(<SubSurfaceRipple complete={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not trigger ripple if complete is true initially on mount", () => {
    const { container } = render(<SubSurfaceRipple complete={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("triggers ripple when complete transitions from false to true", () => {
    const { rerender } = render(<SubSurfaceRipple complete={false} />);
    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();

    rerender(<SubSurfaceRipple complete={true} />);
    expect(screen.getByTestId("sub-surface-ripple")).toBeInTheDocument();
    expect(screen.getByText("Board clean")).toBeInTheDocument();
  });

  it("cleans up/disappears after 3 seconds", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SubSurfaceRipple complete={false} />);

    rerender(<SubSurfaceRipple complete={true} />);
    expect(screen.getByTestId("sub-surface-ripple")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();
  });
});
