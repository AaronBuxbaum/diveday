// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubSurfaceRipple, type SubSurfaceRippleCopy } from "./SubSurfaceRipple";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const COPY: SubSurfaceRippleCopy = {
  iconTitle: "Roll call complete icon",
  message: "Roll call complete",
};

describe("SubSurfaceRipple", () => {
  it("renders null by default when not complete", () => {
    const { container } = render(<SubSurfaceRipple complete={false} copy={COPY} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not trigger ripple if complete is true initially on mount", () => {
    const { container } = render(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(container.firstChild).toBeNull();
  });

  it("triggers ripple when complete transitions from false to true", () => {
    const { rerender } = render(<SubSurfaceRipple complete={false} copy={COPY} />);
    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();

    rerender(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.getByTestId("sub-surface-ripple")).toBeInTheDocument();
    expect(screen.getByText("Roll call complete")).toBeInTheDocument();
  });

  it("cleans up/disappears after 3 seconds", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SubSurfaceRipple complete={false} copy={COPY} />);

    rerender(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.getByTestId("sub-surface-ripple")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();
  });
});
