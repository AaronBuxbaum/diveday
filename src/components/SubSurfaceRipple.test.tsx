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

  it("a trip/checkpoint switch without a fresh instance would misfire — the reason the caller keys by trip id + checkpoint", () => {
    // Trip A's roll call finishes complete.
    const { rerender } = render(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();

    // Switching to Trip B, mid-roll-call (not complete), as a same-instance
    // rerender (what happens without the caller's key): no ripple here,
    // since `complete` didn't newly flip to true — but the ref is now
    // carrying Trip B's not-yet-complete state forward from Trip A's
    // already-complete one, ready to misfire if Trip B was *already*
    // complete when switched to.
    rerender(<SubSurfaceRipple complete={false} copy={COPY} />);
    // Now simulate arriving at an *already-complete* Trip C on the same
    // instance: since the carried-forward ref reads "was false", this wrongly
    // reads as a fresh 0->100% transition and ripples for a trip this
    // instance never watched complete.
    rerender(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.getByTestId("sub-surface-ripple")).toBeInTheDocument();
  });

  it("a fresh instance (the caller's key on trip id + checkpoint, the fix) never ripples off another trip's already-complete state", () => {
    const { unmount } = render(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();
    unmount();

    // A `key` change unmounts the old instance and mounts a brand new one —
    // `prevComplete` starts fresh at the new instance's own initial value, so
    // an already-complete trip on arrival never reads as a transition.
    render(<SubSurfaceRipple complete={true} copy={COPY} />);
    expect(screen.queryByTestId("sub-surface-ripple")).toBeNull();
  });
});
